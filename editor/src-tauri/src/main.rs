#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

use std::{
    collections::{HashMap, HashSet},
    fs,
    fs::{File, OpenOptions},
    io::{self, Read, Seek, SeekFrom, Write},
    net::{SocketAddr, TcpStream},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicU16, Ordering},
        Arc, Mutex, OnceLock,
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

#[cfg(target_os = "windows")]
use std::os::windows::{ffi::OsStrExt, fs::symlink_file, process::CommandExt};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{Emitter, Manager};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
use zip::{write::SimpleFileOptions, CompressionMethod, ZipArchive, ZipWriter};

mod preview_process;
mod native_cartridge;
mod renpy_gui_import;
mod gui_pack_library;
mod novel_card_position;
mod owned_process;
mod project_bundle_output;

use native_cartridge::{NativeCartridgeAsset, NativeCartridgeTextFile};
use owned_process::OwnedProcess;
use project_bundle_output::directory_write_error;

struct DevProcesses {
    backend: Mutex<Option<OwnedProcess>>,
    frontend: Mutex<Option<OwnedProcess>>,
    gamecli_preview: Mutex<Option<OwnedProcess>>,
    gamecli_preview_cartridge: Mutex<Option<PathBuf>>,
    gamecli_preview_disk_upload: Mutex<Option<GameCliPreviewDiskUploadMeta>>,
    gamecli_preview_directory: Mutex<Option<GameCliPreviewDirectorySession>>,
    standalone_package_upload: Mutex<Option<StandalonePackageUploadSession>>,
}

static ACTIVE_BACKEND_PORT: AtomicU16 = AtomicU16::new(8278);
static ACTIVE_ANDROID_BUILD: OnceLock<Mutex<bool>> = OnceLock::new();

struct GameCliPreviewDiskUploadMeta {
    upload_id: String,
    expected_size: Option<u64>,
    written_bytes: u64,
}

struct GameCliPreviewDirectorySession {
    session_id: String,
    expected_file_count: Option<u64>,
    expected_asset_count: Option<u64>,
    asset_uploads: HashMap<String, GameCliPreviewAssetUploadMeta>,
}

struct GameCliPreviewAssetUploadMeta {
    expected_size: Option<u64>,
    written_bytes: u64,
}

struct StandalonePackageUploadSession {
    upload_id: String,
    root_dir: PathBuf,
    cartridge: StandalonePackageUploadFile,
    icon: Option<StandalonePackageUploadFile>,
}

struct StandalonePackageUploadFile {
    path: PathBuf,
    expected_size: u64,
    written_bytes: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProjectBundleAssetSource {
    zip_path: String,
    file_path: String,
    #[serde(default)]
    temporary: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectBundleAssetUpload {
    upload_id: String,
    path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectBundleWriteResult {
    output_path: String,
    asset_count: usize,
    total_bytes: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct StandalonePackageUploadBegin {
    upload_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct StandalonePackageUploadAppendResult {
    written_bytes: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct GameCliPreviewUpload {
    upload_id: String,
    path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct GameCliPreviewUploadAppendResult {
    written_bytes: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct GameCliPreviewDirectoryBegin {
    session_id: String,
    path: String,
}

#[derive(Debug, Serialize)]
struct PreviewChecksumManifest {
    checksum_version: String,
    algorithm: String,
    generated_at: String,
    files: Vec<PreviewChecksumFileEntry>,
}

#[derive(Debug, Serialize)]
struct PreviewChecksumFileEntry {
    path: String,
    size_bytes: u64,
    hash_sha256: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PackageBuildArtifact {
    kind: String,
    path: String,
    bytes: Option<u64>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct StandalonePackageBuildResult {
    ok: bool,
    status: String,
    message: String,
    artifacts: Vec<PackageBuildArtifact>,
    warnings: Vec<String>,
    verify_report_path: String,
    build_log_path: String,
    manifest_path: String,
    diagnostics_dir: String,
    diagnostics_archive_path: String,
    failure_code: Option<String>,
    permission_details: Option<serde_json::Value>,
    release_identity: Option<serde_json::Value>,
    icon_source: Option<String>,
    audio_normalization: Option<serde_json::Value>,
    post_build_inspection: Option<serde_json::Value>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PackageBuildLogEvent {
    run_id: String,
    level: String,
    source: String,
    message: String,
    timestamp_ms: u64,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AndroidEnvironmentImportProgressEvent {
    run_id: String,
    phase: String,
    message: String,
    percent: u8,
    processed_bytes: u64,
    total_bytes: u64,
    processed_files: usize,
    total_files: usize,
    reclaimed_bytes: u64,
    install_source: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PackageEnvironmentOperationProgressEvent {
    run_id: String,
    platform: String,
    operation: String,
    phase: String,
    message: String,
    percent: u8,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ElevatedAndroidBuildRequest {
    schema_version: u32,
    run_id: String,
    cache_dir: PathBuf,
    run_root: PathBuf,
    output_dir: PathBuf,
    diagnostics_dir: PathBuf,
    cartridge_path: PathBuf,
    icon_path: Option<PathBuf>,
    optimization_profile: String,
    runner_path: PathBuf,
    skip_environment_check: bool,
    release_identity: serde_json::Value,
    icon_source: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AndroidSymlinkCapability {
    schema_version: u32,
    probe_root: String,
    #[serde(default)]
    resolved_probe_root: Option<String>,
    success: bool,
    win32_error_code: Option<i32>,
    error: Option<String>,
    #[serde(default)]
    failed_operation: Option<String>,
    windows_build: String,
    checked_at: u128,
    is_elevated: bool,
    developer_mode_enabled: bool,
    symbolic_link_privilege_present: bool,
    symbolic_link_privilege_enabled: bool,
    symbolic_link_privilege_query_error: Option<String>,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AndroidEnvironmentPackFormat {
    schema_version: u32,
    kind: String,
    package_id: String,
    pack_version: String,
    complete: bool,
    platform: String,
    api_level: String,
    build_tools_version: String,
    ndk_version: String,
    gradle_version: String,
    payload_root: String,
    total_bytes: u64,
    file_count: usize,
    required_paths: Vec<String>,
    files: Vec<AndroidEnvironmentPackFile>,
}

#[derive(Debug, Deserialize, Clone)]
struct AndroidEnvironmentPackFile {
    path: String,
    bytes: u64,
    sha256: String,
}

#[derive(Debug, Clone)]
struct AndroidManagedEnvironmentPaths {
    tool_root: PathBuf,
    gradle_home: PathBuf,
    pass_cache_path: PathBuf,
    import_cache_root: PathBuf,
    lock_path: PathBuf,
}

struct AndroidEnvironmentOperationLock {
    path: PathBuf,
}

impl Drop for AndroidEnvironmentOperationLock {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ElevatedAndroidBuildStatus {
    schema_version: u32,
    run_id: String,
    state: String,
    phase: String,
    message: String,
    updated_at: u128,
    heartbeat_seq: u64,
    exit_code: Option<i32>,
}

const PROJECT_BACKUP_KEEP_COUNT: usize = 10;
const PROJECT_BACKUP_SAFE_FALLBACK_MAX_BYTES: u64 = 4 * 1024 * 1024;
const MAX_ERROR_LOG_BYTES: u64 = 10 * 1024 * 1024;
const ERROR_LOG_BACKUP_COUNT: usize = 10;
const MAX_ERROR_LOG_LINE_BYTES: usize = 64 * 1024;
const MAX_STANDALONE_CARTRIDGE_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const MAX_STANDALONE_UNPACKED_BYTES: u64 = 4 * 1024 * 1024 * 1024;
const MAX_STANDALONE_CARTRIDGE_FILES: usize = 100_000;
const ENVIRONMENT_PASS_CACHE_SCHEMA_VERSION: u64 = 1;
static ERROR_LOG_WRITE_LOCK: Mutex<()> = Mutex::new(());
static ERROR_LOG_RECENT: OnceLock<Mutex<HashMap<String, Instant>>> = OnceLock::new();
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

fn background_command<S: AsRef<std::ffi::OsStr>>(program: S) -> Command {
    let mut command = Command::new(program);
    #[cfg(target_os = "windows")]
    command.creation_flags(CREATE_NO_WINDOW);
    command
}

fn redact_ascii_token_after_marker(
    mut value: String,
    marker: &str,
    preserve_marker: bool,
) -> String {
    let mut cursor = 0;
    loop {
        let lowered = value.to_ascii_lowercase();
        let Some(relative_index) = lowered[cursor..].find(marker) else {
            break;
        };
        let marker_start = cursor + relative_index;
        let mut token_start = marker_start + marker.len();
        let bytes = value.as_bytes();
        while token_start < bytes.len()
            && matches!(
                bytes[token_start],
                b' ' | b'\t' | b':' | b'=' | b'"' | b'\''
            )
        {
            token_start += 1;
        }
        let mut token_end = token_start;
        while token_end < bytes.len()
            && matches!(
                bytes[token_end],
                b'a'..=b'z'
                    | b'A'..=b'Z'
                    | b'0'..=b'9'
                    | b'_'
                    | b'-'
                    | b'.'
                    | b'~'
                    | b'+'
                    | b'/'
                    | b'='
            )
        {
            token_end += 1;
        }
        if token_end.saturating_sub(token_start) < 4 {
            cursor = marker_start + marker.len();
            continue;
        }
        let replacement_start = if preserve_marker {
            marker_start + marker.len()
        } else {
            token_start
        };
        value.replace_range(replacement_start..token_end, "***");
        cursor = replacement_start + 3;
    }
    value
}

fn sanitize_error_log_text(value: &str) -> String {
    let mut sanitized = value.to_string();
    for marker in [
        "bearer ",
        "api_key",
        "api-key",
        "authorization",
        "token",
        "secret",
        "password",
    ] {
        sanitized = redact_ascii_token_after_marker(sanitized, marker, false);
    }
    sanitized = redact_ascii_token_after_marker(sanitized, "sk-", true);
    redact_url_query_values(sanitized)
}

fn redact_url_query_values(value: String) -> String {
    let mut output = String::with_capacity(value.len());
    let mut in_query = false;
    let mut hiding_value = false;
    for character in value.chars() {
        if hiding_value {
            if matches!(
                character,
                '&' | '#' | '"' | '\'' | ',' | '}' | ']' | ' ' | '\t' | '\r' | '\n'
            ) {
                hiding_value = false;
            } else {
                continue;
            }
        }
        if character == '?' {
            in_query = true;
            output.push(character);
        } else if in_query && character == '=' {
            output.push('=');
            output.push_str("***");
            hiding_value = true;
        } else {
            if matches!(character, '#' | '"' | '\'' | ' ' | '\t' | '\r' | '\n') {
                in_query = false;
            }
            output.push(character);
        }
    }
    output
}

fn should_write_error_log(source: &str, message: &str) -> bool {
    let recent = ERROR_LOG_RECENT.get_or_init(|| Mutex::new(HashMap::new()));
    let mut recent = recent
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let now = Instant::now();
    recent.retain(|_, timestamp| now.duration_since(*timestamp) <= Duration::from_secs(30));
    let fingerprint = format!("{source}\n{}", sanitize_error_log_text(message));
    let duplicate = recent
        .get(&fingerprint)
        .is_some_and(|timestamp| now.duration_since(*timestamp) <= Duration::from_secs(1));
    recent.insert(fingerprint, now);
    !duplicate
}

fn truncate_error_log_text(value: String) -> String {
    if value.len() <= MAX_ERROR_LOG_LINE_BYTES {
        return value;
    }
    let suffix = "\n[后续内容已省略]";
    let mut end = MAX_ERROR_LOG_LINE_BYTES.saturating_sub(suffix.len());
    while end > 0 && !value.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}{}", &value[..end], suffix)
}

fn rotated_error_log_path(path: &Path, index: usize) -> PathBuf {
    let file_name = path
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| "agentvn.log".to_string());
    path.with_file_name(format!("{file_name}.{index}"))
}

fn rotate_error_log_if_needed(path: &Path, additional_bytes: u64) -> io::Result<()> {
    let current_bytes = fs::metadata(path).map(|meta| meta.len()).unwrap_or(0);
    if current_bytes.saturating_add(additional_bytes) <= MAX_ERROR_LOG_BYTES {
        return Ok(());
    }
    for index in (1..=ERROR_LOG_BACKUP_COUNT).rev() {
        let source = if index == 1 {
            path.to_path_buf()
        } else {
            rotated_error_log_path(path, index - 1)
        };
        if !source.exists() {
            continue;
        }
        let destination = rotated_error_log_path(path, index);
        if destination.exists() {
            fs::remove_file(&destination)?;
        }
        fs::rename(source, destination)?;
    }
    Ok(())
}

fn append_error_log_line(path: &Path, line: &str) -> io::Result<()> {
    let _guard = ERROR_LOG_WRITE_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let safe_line = truncate_error_log_text(sanitize_error_log_text(line));
    rotate_error_log_if_needed(path, safe_line.len() as u64 + 1)?;
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)?;
    writeln!(file, "{safe_line}")
}

fn append_desktop_host_log(message: &str) {
    let root = error_report_dir();
    let path = root.join("editor-desktop.log");
    if !should_write_error_log("editor.desktop", message) {
        return;
    }
    let timestamp = error_report_timestamp();
    let _ = append_error_log_line(&path, &format!("[{timestamp}] {message}"));
}

macro_rules! eprintln {
    ($($arg:tt)*) => {{
        let message = format!($($arg)*);
        append_desktop_host_log(&message);
        #[cfg(debug_assertions)]
        std::eprintln!("{message}");
    }};
}

fn install_desktop_panic_hook() {
    std::panic::set_hook(Box::new(|panic_info| {
        append_desktop_host_log(&format!("PANIC: {panic_info}"));
    }));
}

#[derive(Debug, Deserialize)]
struct ProjectBackupFile {
    project_id: String,
    title: String,
    nodes: Vec<serde_json::Value>,
    edges: Vec<serde_json::Value>,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Serialize, Clone)]
struct ProjectBackupEntry {
    file_name: String,
    project_id: String,
    title: String,
    created_at: String,
    updated_at: String,
    timestamp_ms: u64,
    node_count: Option<usize>,
    edge_count: Option<usize>,
    trigger: String,
    content_hash: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectBackupMeta {
    #[serde(default, rename = "backupFormat", alias = "backup_format")]
    backup_format: Option<String>,
    trigger: String,
    project_id: Option<String>,
    title: Option<String>,
    created_at: Option<String>,
    updated_at: Option<String>,
    timestamp_ms: Option<u64>,
    node_count: Option<usize>,
    edge_count: Option<usize>,
    content_hash: Option<String>,
}

fn port_is_open(port: u16) -> bool {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    TcpStream::connect_timeout(&addr, Duration::from_millis(250)).is_ok()
}

fn backend_health_ok(port: u16) -> bool {
    backend_get_response_body(port, "/api/health").is_some()
}

fn backend_supports_project_container_protocol(port: u16) -> bool {
    let Some(body) = backend_get_response_body(port, "/api/health") else {
        return false;
    };
    let Ok(health) = serde_json::from_str::<serde_json::Value>(&body) else {
        return false;
    };
    health
        .get("project_container_protocol")
        .and_then(serde_json::Value::as_u64)
        .is_some_and(|version| version >= 2)
}

fn backend_is_compatible(port: u16) -> bool {
    backend_health_ok(port) && backend_supports_project_container_protocol(port)
}

fn backend_get_response_body(port: u16, path: &str) -> Option<String> {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let mut stream = match TcpStream::connect_timeout(&addr, Duration::from_millis(500)) {
        Ok(stream) => stream,
        Err(_) => return None,
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(800)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(800)));
    let request =
        format!("GET {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n");
    if std::io::Write::write_all(&mut stream, request.as_bytes()).is_err() {
        return None;
    }
    let mut response = String::new();
    if std::io::Read::read_to_string(&mut stream, &mut response).is_err() {
        return None;
    }
    if !(response.starts_with("HTTP/1.1 200") || response.starts_with("HTTP/1.0 200")) {
        return None;
    }
    response
        .split_once("\r\n\r\n")
        .map(|(_, body)| body.to_string())
}

fn wait_for_backend_health(port: u16, timeout_secs: u64) -> bool {
    let start = Instant::now();
    while start.elapsed().as_secs() < timeout_secs {
        if backend_is_compatible(port) {
            return true;
        }
        std::thread::sleep(Duration::from_millis(500));
    }
    false
}

#[cfg(target_os = "windows")]
fn terminate_stale_packaged_backend() -> bool {
    let _ = background_command("taskkill.exe")
        .args(["/F", "/T", "/IM", "creator-backend.exe"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
    let deadline = Instant::now() + Duration::from_secs(5);
    while port_is_open(8278) && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(150));
    }
    !port_is_open(8278)
}

#[cfg(not(target_os = "windows"))]
fn terminate_stale_packaged_backend() -> bool {
    false
}

fn is_workspace_root(path: &std::path::Path) -> bool {
    path.join("backend").join("pyproject.toml").exists()
        && path.join("editor").join("package.json").exists()
}

fn exe_parent_dir() -> PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(PathBuf::from))
        .unwrap_or_else(|| PathBuf::from("."))
}

#[cfg(target_os = "windows")]
fn embedded_android_offline_pack_candidates() -> Vec<PathBuf> {
    let exe_dir = exe_parent_dir();
    let mut candidates = Vec::new();
    if let Ok(value) = std::env::var("AGENTVN_ANDROID_OFFLINE_PACK") {
        candidates.push(PathBuf::from(value));
    }
    candidates.extend([
        exe_dir.join("android-offline-pack"),
        exe_dir.join("resources").join("android-offline-pack"),
        exe_dir
            .join("bundle-workspace")
            .join("android-offline-pack"),
    ]);
    candidates
}

#[cfg(not(target_os = "windows"))]
fn embedded_android_offline_pack_candidates() -> Vec<PathBuf> {
    Vec::new()
}

fn resolve_embedded_android_offline_pack() -> Option<PathBuf> {
    embedded_android_offline_pack_candidates()
        .into_iter()
        .map(|path| fs::canonicalize(&path).unwrap_or(path))
        .find(|path| path.join("manifest.json").is_file())
}

#[cfg(all(debug_assertions, target_os = "windows"))]
fn configure_dev_webview_data_directory() {
    if std::env::var_os("WEBVIEW2_USER_DATA_FOLDER").is_some() {
        return;
    }

    let data_directory = exe_parent_dir().join("data").join("webview2-dev");
    if let Err(error) = fs::create_dir_all(&data_directory) {
        eprintln!(
            "[AgentVN] WARNING: Failed to create isolated Dev WebView2 data directory {}: {error}",
            data_directory.display()
        );
        return;
    }

    std::env::set_var("WEBVIEW2_USER_DATA_FOLDER", &data_directory);
    eprintln!(
        "[AgentVN] Dev WebView2 data directory: {}",
        data_directory.display()
    );
}

#[cfg(not(all(debug_assertions, target_os = "windows")))]
fn configure_dev_webview_data_directory() {}

fn install_data_dir() -> PathBuf {
    exe_parent_dir().join("data")
}

fn find_workspace_root() -> Option<PathBuf> {
    if let Ok(value) = std::env::var("AGENTVN_WORKSPACE_ROOT") {
        let candidate = PathBuf::from(value);
        if is_workspace_root(&candidate) {
            return Some(candidate);
        }
    }

    let mut starts = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            starts.push(parent.to_path_buf());
        }
    }
    if let Ok(current_dir) = std::env::current_dir() {
        starts.push(current_dir);
    }

    for start in starts {
        for ancestor in start.ancestors() {
            if is_workspace_root(ancestor) {
                return Some(ancestor.to_path_buf());
            }
        }
    }

    None
}

fn project_root() -> PathBuf {
    find_workspace_root().unwrap_or_else(exe_parent_dir)
}

// Kept for environment diagnostics and legacy compatibility tests. Active
// imports must still go through the user-facing native picker; this helper is
// intentionally not called by `import_android_environment_package`.
fn find_android_environment_archive_in(root: &Path) -> Option<PathBuf> {
    let preferred_names = [
        "AgentVN-Android-Environment.avnenv",
        "AgentVN-Android-Environment.zip",
    ];
    for name in preferred_names {
        let candidate = root.join(name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }

    let mut candidates = fs::read_dir(root)
        .ok()?
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| {
            path.is_file()
                && path
                    .extension()
                    .and_then(|extension| extension.to_str())
                    .map(|extension| extension.eq_ignore_ascii_case("avnenv"))
                    .unwrap_or(false)
        })
        .collect::<Vec<_>>();
    candidates.sort_by(|left, right| left.to_string_lossy().cmp(&right.to_string_lossy()));
    (candidates.len() == 1).then(|| candidates.remove(0))
}

fn find_android_environment_archive() -> Option<PathBuf> {
    let mut roots = Vec::new();
    if let Ok(value) = std::env::var("AGENTVN_ANDROID_ENVIRONMENT_PACKAGE") {
        let candidate = PathBuf::from(value);
        if candidate.is_file() {
            return Some(candidate);
        }
        if candidate.is_dir() {
            roots.push(candidate);
        }
    }
    roots.push(exe_parent_dir());
    if let Ok(current_dir) = std::env::current_dir() {
        roots.push(current_dir);
    }
    #[cfg(debug_assertions)]
    if let Some(workspace) = find_workspace_root() {
        roots.push(workspace);
    }
    roots
        .into_iter()
        .map(|root| fs::canonicalize(&root).unwrap_or(root))
        .collect::<Vec<_>>()
        .into_iter()
        .find_map(|root| find_android_environment_archive_in(&root))
}

#[cfg(target_os = "windows")]
fn stop_managed_android_tool_processes(
    paths: &AndroidManagedEnvironmentPaths,
) -> Result<(), String> {
    let root = fs::canonicalize(&paths.tool_root)
        .unwrap_or_else(|_| paths.tool_root.clone())
        .to_string_lossy()
        .replace('\'', "''");
    let script = format!(
        "$root = '{root}'; \
         Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | \
         Where-Object {{ $_.ExecutablePath -and $_.ExecutablePath.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase) }} | \
         ForEach-Object {{ Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }}"
    );
    let output = background_command("powershell.exe")
        .args([
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            &script,
        ])
        .output()
        .map_err(|error| format!("failed to release managed Android processes: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "failed to release managed Android processes (exit code {})",
            output.status
        ));
    }
    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn stop_managed_android_tool_processes(
    _paths: &AndroidManagedEnvironmentPaths,
) -> Result<(), String> {
    Ok(())
}

fn app_data_override_dir() -> Option<PathBuf> {
    std::env::var("AGENTVN_EDITOR_DATA_DIR")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .map(PathBuf::from)
}

fn legacy_editor_app_data_dir(app: &tauri::AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| exe_parent_dir().join("AgentVN Editor Data"))
}

fn editor_app_data_dir(app: &tauri::AppHandle) -> PathBuf {
    app_data_override_dir().unwrap_or_else(|| legacy_editor_app_data_dir(app))
}

fn database_migration_decision_path(target_data_dir: &Path) -> PathBuf {
    target_data_dir.join("database-migration-decision.json")
}

fn database_migration_message(target_db: &Path, sources: &[PathBuf]) -> String {
    let source_text = sources
        .iter()
        .map(|path| path.display().to_string())
        .collect::<Vec<_>>()
        .join("\n");
    format!(
        "发现旧版本 AgentVN 数据库。\n\n来源数据库：\n{}\n\n目标共享数据库：\n{}\n\n共享数据库中的同名项目会保留。是否现在迁移？",
        source_text,
        target_db.display()
    )
}

fn confirm_legacy_database_migration(
    app: &tauri::AppHandle,
    target_data_dir: &Path,
    legacy_dirs: &[PathBuf],
) -> Vec<PathBuf> {
    let target_db = target_data_dir.join("vn_engine.db");
    let mut sources = Vec::new();
    let mut seen = HashSet::new();
    for directory in legacy_dirs {
        let source = directory.join("vn_engine.db");
        if !source.is_file() || source == target_db {
            continue;
        }
        let key = source.to_string_lossy().to_ascii_lowercase();
        if seen.insert(key) {
            sources.push(source);
        }
    }
    if sources.is_empty() {
        return Vec::new();
    }

    let decision_path = database_migration_decision_path(target_data_dir);
    if let Ok(raw) = fs::read_to_string(&decision_path) {
        if let Ok(value) = serde_json::from_str::<serde_json::Value>(&raw) {
            if value.get("sources").and_then(|item| item.as_array()).is_some() {
                let approved = value.get("approved").and_then(|item| item.as_bool()).unwrap_or(false);
                return if approved { sources } else { Vec::new() };
            }
        }
    }

    let approved = app
        .dialog()
        .message(database_migration_message(&target_db, &sources))
        .title("迁移 AgentVN 项目数据")
        .buttons(MessageDialogButtons::YesNo)
        .blocking_show();
    let _ = fs::create_dir_all(target_data_dir);
    let decision = serde_json::json!({
        "schemaVersion": 1,
        "approved": approved,
        "sources": sources.iter().map(|path| path.to_string_lossy().to_string()).collect::<Vec<_>>(),
        "decidedAt": error_report_timestamp(),
    });
    if let Ok(raw) = serde_json::to_vec_pretty(&decision) {
        let _ = fs::write(&decision_path, raw);
    }
    if approved { sources } else { Vec::new() }
}

fn start_workspace_backend(app: &tauri::AppHandle, root: &Path, port: u16) -> Option<OwnedProcess> {
    let backend_dir = root.join("backend");

    if !backend_dir.join("pyproject.toml").exists() {
        eprintln!(
            "[AgentVN] Backend dir not found at {}",
            backend_dir.display()
        );
        return None;
    }

    if backend_is_compatible(port) {
        eprintln!("[AgentVN] Compatible backend detected on {port}; reusing.");
        return None;
    }

    if port_is_open(port) {
        eprintln!("[AgentVN] Backend port {port} is occupied by an incompatible service; workspace backend startup may fail.");
    }

    let legacy_data_dir = backend_dir.join("data");
    let data_dir = editor_app_data_dir(app).join("backend");
    let _ = std::fs::create_dir_all(&data_dir);
    let legacy_database_paths = confirm_legacy_database_migration(
        app,
        &data_dir,
        &[
            legacy_editor_app_data_dir(app).join("backend"),
            exe_parent_dir().join("data").join("backend"),
            legacy_data_dir.clone(),
        ],
    );
    let db_path = data_dir.join("vn_engine.db");
    let backend_error_log_dir = error_report_dir();
    let _ = fs::create_dir_all(&backend_error_log_dir);
    let backend_log_path = backend_error_log_dir.join("backend.log");

    eprintln!("[AgentVN] Workspace root: {}", root.display());
    eprintln!(
        "[AgentVN] Legacy database path: {}",
        legacy_data_dir.join("vn_engine.db").display()
    );
    eprintln!("[AgentVN] Database path: {}", db_path.display());
    eprintln!("[AgentVN] Starting Python backend...");

    let port_text = port.to_string();
    let uvicorn_args = [
        "-m".to_string(),
        "uvicorn".to_string(),
        "app.main:app".to_string(),
        "--host".to_string(),
        "127.0.0.1".to_string(),
        "--port".to_string(),
        port_text,
        "--reload".to_string(),
    ];

    // Try uv first, fall back to python
    let mut uv_command = background_command("uv");
    uv_command.args(["run"])
        .args(&uvicorn_args)
        .current_dir(&backend_dir)
        .env(
            "DATABASE_PATH",
            db_path.to_str().unwrap_or("./data/vn_engine.db"),
        )
        .env("AGENTVN_WORKSPACE_ROOT", root.to_string_lossy().to_string())
        .env(
            "AGENTVN_BACKEND_DATA_DIR",
            data_dir.to_string_lossy().to_string(),
        )
        .env(
            "AGENTVN_LEGACY_DATABASE_PATHS",
            legacy_database_paths
                .iter()
                .map(|path| path.to_string_lossy().to_string())
                .collect::<Vec<_>>()
                .join(";"),
        )
        .env(
            "AGENTVN_BACKEND_LOG",
            backend_log_path.to_string_lossy().to_string(),
        )
        .env(
            "AGENTVN_ERROR_LOG_DIR",
            backend_error_log_dir.to_string_lossy().to_string(),
        )
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    let child = OwnedProcess::spawn(&mut uv_command);

    match child {
        Ok(child) => {
            eprintln!("[AgentVN] Backend started (uv, pid {}).", child.id());
            return Some(child);
        }
        Err(_) => {
            eprintln!("[AgentVN] uv not found, trying python -m uvicorn...");
            let mut python_command = background_command("python");
            python_command.args(&uvicorn_args)
                .current_dir(&backend_dir)
                .env(
                    "DATABASE_PATH",
                    db_path.to_str().unwrap_or("./data/vn_engine.db"),
                )
                .env("AGENTVN_WORKSPACE_ROOT", root.to_string_lossy().to_string())
                .env(
                    "AGENTVN_BACKEND_DATA_DIR",
                    data_dir.to_string_lossy().to_string(),
                )
                .env(
                    "AGENTVN_BACKEND_LOG",
                    backend_log_path.to_string_lossy().to_string(),
                )
                .env(
                    "AGENTVN_ERROR_LOG_DIR",
                    backend_error_log_dir.to_string_lossy().to_string(),
                )
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null());
            match OwnedProcess::spawn(&mut python_command) {
                Ok(child) => {
                    eprintln!("[AgentVN] Backend started (python, pid {}).", child.id());
                    return Some(child);
                }
                Err(e) => {
                    eprintln!("[AgentVN] Failed to start backend: {e}");
                    return None;
                }
            }
        }
    }
}

fn bundled_backend_candidates(
    app: &tauri::AppHandle,
    workspace_root: Option<&Path>,
) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join("creator-backend.exe"));
        candidates.push(resource_dir.join("binaries").join("creator-backend.exe"));
    }
    candidates.push(exe_parent_dir().join("creator-backend.exe"));
    if let Some(root) = workspace_root {
        candidates.push(
            root.join("editor")
                .join("src-tauri")
                .join("binaries")
                .join("creator-backend.exe"),
        );
    }
    candidates
}

fn start_packaged_backend(
    app: &tauri::AppHandle,
    workspace_root: Option<&Path>,
    port: u16,
) -> Option<OwnedProcess> {
    if backend_is_compatible(port) {
        eprintln!("[AgentVN] Compatible backend detected on {port}; reusing.");
        return None;
    }

    if port == 8278 && port_is_open(port) {
        eprintln!("[AgentVN] Backend port 8278 is occupied by an incompatible service; attempting to stop a stale packaged backend.");
        if !terminate_stale_packaged_backend() {
            eprintln!("[AgentVN] Incompatible backend on 8278 could not be stopped.");
        }
    }

    let backend_exe = match bundled_backend_candidates(app, workspace_root)
        .into_iter()
        .find(|candidate| candidate.exists())
    {
        Some(path) => path,
        None => {
            eprintln!("[AgentVN] Packaged backend sidecar was not found. Rebuild the editor installer so creator-backend.exe is bundled.");
            return None;
        }
    };

    let app_data_dir = editor_app_data_dir(app);
    let data_dir = app_data_dir.join("backend");
    let _ = fs::create_dir_all(&data_dir);
    let mut legacy_database_paths = confirm_legacy_database_migration(
        app,
        &data_dir,
        &[
            legacy_editor_app_data_dir(app).join("backend"),
            exe_parent_dir().join("data").join("backend"),
        ],
    );
    if let Some(root) = workspace_root {
        legacy_database_paths.extend(confirm_legacy_database_migration(
            app,
            &data_dir,
            &[root.join("backend").join("data")],
        ));
        legacy_database_paths.sort();
        legacy_database_paths.dedup();
    }
    let db_path = data_dir.join("vn_engine.db");
    let backend_error_log_dir = error_report_dir();
    let _ = fs::create_dir_all(&backend_error_log_dir);
    let backend_log_path = backend_error_log_dir.join("backend.log");

    eprintln!(
        "[AgentVN] Starting packaged backend: {}",
        backend_exe.display()
    );
    eprintln!(
        "[AgentVN] Packaged backend data dir: {}",
        data_dir.display()
    );
    let mut backend_command = background_command(&backend_exe);
    backend_command.current_dir(backend_exe.parent().unwrap_or_else(|| Path::new(".")))
        .env(
            "DATABASE_PATH",
            db_path.to_str().unwrap_or("./vn_engine.db"),
        )
        .env(
            "AGENTVN_BACKEND_DATA_DIR",
            data_dir.to_string_lossy().to_string(),
        )
        .env(
            "AGENTVN_LEGACY_DATABASE_PATHS",
            legacy_database_paths
                .iter()
                .map(|path| path.to_string_lossy().to_string())
                .collect::<Vec<_>>()
                .join(";"),
        )
        .env(
            "AGENTVN_BACKEND_LOG",
            backend_log_path.to_string_lossy().to_string(),
        )
        .env(
            "AGENTVN_ERROR_LOG_DIR",
            backend_error_log_dir.to_string_lossy().to_string(),
        )
        .env("AGENTVN_BACKEND_HOST", "127.0.0.1")
        .env("AGENTVN_BACKEND_PORT", port.to_string())
        .env(
            "AGENTVN_WORKSPACE_ROOT",
            app_data_dir.to_string_lossy().to_string(),
        )
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    let child = OwnedProcess::spawn(&mut backend_command);

    match child {
        Ok(child) => {
            eprintln!("[AgentVN] Packaged backend started (pid {}).", child.id());
            Some(child)
        }
        Err(error) => {
            eprintln!(
                "[AgentVN] Failed to start packaged backend {}: {error}",
                backend_exe.display()
            );
            None
        }
    }
}

fn start_backend_for_runtime(
    app: &tauri::AppHandle,
    workspace_root: Option<&Path>,
) -> (Option<OwnedProcess>, u16) {
    let explicit_port = std::env::var("AGENTVN_BACKEND_PORT")
        .ok()
        .and_then(|value| value.trim().parse::<u16>().ok())
        .filter(|port| *port >= 1024);
    let port = if let Some(port) = explicit_port {
        if port_is_open(port) && !backend_is_compatible(port) {
            eprintln!(
                "[AgentVN] Explicit backend port {port} is occupied by an incompatible service; selecting a fallback port."
            );
            (8279..=8299)
                .find(|candidate| backend_is_compatible(*candidate) || !port_is_open(*candidate))
                .unwrap_or(8279)
        } else {
            port
        }
    } else if backend_is_compatible(8278) || !port_is_open(8278) {
        8278
    } else {
        let fallback = (8279..=8299)
            .find(|candidate| backend_is_compatible(*candidate) || !port_is_open(*candidate))
            .unwrap_or(8279);
        eprintln!(
            "[AgentVN] Backend 8278 does not support ZIP project protocol v2; using fallback port {fallback}."
        );
        fallback
    };
    if cfg!(debug_assertions) {
        if let Some(root) = workspace_root {
            return (start_workspace_backend(app, root, port), port);
        }
    }

    let packaged = start_packaged_backend(app, workspace_root, port);
    if packaged.is_some() || !cfg!(debug_assertions) {
        return (packaged, port);
    }

    (
        workspace_root.and_then(|root| start_workspace_backend(app, root, port)),
        port,
    )
}

fn start_frontend(root: &Path) -> Option<OwnedProcess> {
    let editor_dir = root.join("editor");

    if !editor_dir.join("package.json").exists() {
        eprintln!("[AgentVN] Editor dir not found at {}", editor_dir.display());
        return None;
    }

    if port_is_open(6767) {
        eprintln!("[AgentVN] Frontend port 6767 already in use; reusing.");
        return None;
    }

    eprintln!("[AgentVN] Starting Vite dev server...");
    let mut attempted = Vec::new();
    for npm in npm_command_candidates() {
        attempted.push(npm.display().to_string());
        let mut npm_command = background_command(&npm);
        npm_command.args(["run", "dev"])
            .current_dir(&editor_dir)
            .env("AGENTVN_WORKSPACE_ROOT", root.to_string_lossy().to_string())
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        match OwnedProcess::spawn(&mut npm_command) {
            Ok(child) => {
                eprintln!(
                    "[AgentVN] Frontend started with {} (pid {}).",
                    npm.display(),
                    child.id()
                );
                return Some(child);
            }
            Err(e) if e.kind() == io::ErrorKind::NotFound => {
                eprintln!("[AgentVN] Frontend launcher not found: {}", npm.display());
            }
            Err(e) => {
                eprintln!(
                    "[AgentVN] Failed to start frontend with {}: {e}",
                    npm.display()
                );
                return None;
            }
        }
    }
    eprintln!(
        "[AgentVN] Failed to start frontend: npm launcher not found. Tried: {}",
        attempted.join(", ")
    );
    None
}

fn npm_command_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(npm) = std::env::var("NPM") {
        candidates.push(PathBuf::from(npm));
    }

    #[cfg(windows)]
    {
        candidates.push(PathBuf::from("npm.cmd"));
        candidates.push(PathBuf::from("npm"));
        if let Ok(program_files) = std::env::var("ProgramFiles") {
            candidates.push(PathBuf::from(program_files).join("nodejs").join("npm.cmd"));
        }
        if let Ok(program_files_x86) = std::env::var("ProgramFiles(x86)") {
            candidates.push(
                PathBuf::from(program_files_x86)
                    .join("nodejs")
                    .join("npm.cmd"),
            );
        }
    }

    #[cfg(not(windows))]
    {
        candidates.push(PathBuf::from("npm"));
    }

    candidates
}

fn cleanup_host_processes(app: &tauri::AppHandle) {
    let state = app.state::<DevProcesses>();
    // Taking the owner drops its job and reaps the launcher; repeated exit
    // notifications are harmless. Reused services are represented by None.
    drop(state.backend.lock().unwrap().take());
    drop(state.frontend.lock().unwrap().take());
    if let Err(error) = close_gamecli_preview_process(state.inner()) {
        eprintln!("[AgentVN] Preview cleanup on exit failed: {error}");
    }
    if let Err(error) = cleanup_active_standalone_package_upload(app, state.inner()) {
        eprintln!("[AgentVN] Standalone package upload cleanup on exit failed: {error}");
    }
}

fn close_gamecli_preview_process(state: &DevProcesses) -> Result<(), String> {
    let mut owner = state.gamecli_preview.lock().map_err(|error| error.to_string())?;
    if let Some(process) = owner.as_mut() {
        process.stop().map_err(|error| format!("Failed to close owned GameCLI preview: {error}"))?;
    }
    owner.take();
    state.gamecli_preview_cartridge.lock().map_err(|error| error.to_string())?.take();
    Ok(())
}

fn workspace_root() -> PathBuf {
    project_root()
}

fn has_standalone_build_workspace(root: &Path, script_name: &str) -> bool {
    root.join("scripts").join(script_name).exists()
        && root.join("scripts").join("verify-vncart.cjs").exists()
        && root.join("GameCli_framework").join("package.json").exists()
        && root.join("shared").join("cartridge").exists()
}

fn standalone_build_root_candidates(app: &tauri::AppHandle) -> Vec<PathBuf> {
    let exe_parent = exe_parent_dir();
    let mut candidates = vec![exe_parent.clone()];
    #[cfg(debug_assertions)]
    candidates.insert(0, workspace_root());
    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir);
    }

    let mut unique = Vec::new();
    for candidate in candidates {
        if !unique.iter().any(|item: &PathBuf| item == &candidate) {
            unique.push(candidate);
        }
    }
    unique
}

fn should_skip_bundled_workspace_dir(name: &str, include_node_modules: bool) -> bool {
    if include_node_modules {
        return false;
    }
    matches!(
        name,
        "dist" | "target" | ".git" | ".gradle" | "build" | "gen"
    ) || name == "node_modules"
}

fn copy_dir_for_package_build(
    source: &Path,
    destination: &Path,
    include_node_modules: bool,
) -> io::Result<()> {
    fs::create_dir_all(destination)?;
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let source_path = entry.path();
        let target_path = destination.join(entry.file_name());
        let file_type = entry.file_type()?;
        if file_type.is_dir() {
            let directory_name = entry.file_name().to_string_lossy().to_string();
            if should_skip_bundled_workspace_dir(&directory_name, include_node_modules) {
                continue;
            }
            copy_dir_for_package_build(&source_path, &target_path, include_node_modules)?;
        } else if file_type.is_file() {
            if let Some(parent) = target_path.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::copy(&source_path, &target_path)?;
        }
    }
    Ok(())
}

fn materialize_standalone_build_workspace(
    source_root: &Path,
    destination_root: &Path,
) -> Result<(), String> {
    // Both installed and development sources become the same isolated build root.
    // Resolve provenance before copying the large runtime dependency tree.
    let config_path = source_root.join("editor/src-tauri/tauri.conf.json");
    let versions_path = source_root.join("build-versions.json");
    let (version_path, version_key) = if cfg!(debug_assertions) && config_path.is_file() {
        (config_path, "version")
    } else {
        (versions_path, "editorVersion")
    };
    let version_failure = |code: &str, detail: String| {
        format!("{code}: editor build version {}: {detail}. 请重新安装当前版本的完整编辑器安装包；不要手工创建版本文件。", version_path.display())
    };
    let version_bytes = fs::read(&version_path).map_err(|error| version_failure(
        if error.kind() == std::io::ErrorKind::NotFound { "EDITOR_BUILD_VERSION_MISSING" } else { "EDITOR_BUILD_VERSION_UNREADABLE" },
        error.to_string(),
    ))?;
    let version_data: serde_json::Value = serde_json::from_slice(&version_bytes)
        .map_err(|error| version_failure("EDITOR_BUILD_VERSION_INVALID", error.to_string()))?;
    let editor_version = version_data[version_key].as_str().filter(|value| !value.trim().is_empty())
        .ok_or_else(|| version_failure("EDITOR_BUILD_VERSION_INVALID", format!("Missing or empty {version_key}")))?;
    if editor_version != env!("CARGO_PKG_VERSION") {
        return Err(version_failure("EDITOR_BUILD_VERSION_MISMATCH",
            format!("expected={}, actual={editor_version}", env!("CARGO_PKG_VERSION"))));
    }
    fs::create_dir_all(destination_root).map_err(|error| {
        format!(
            "Failed to create standalone build workspace {}: {error}",
            destination_root.display()
        )
    })?;
    fs::write(destination_root.join("build-versions.json"),
        serde_json::to_vec_pretty(&serde_json::json!({"editorVersion": editor_version})).unwrap())
        .map_err(|error| format!("Cannot write isolated editor build version: {error}"))?;

    for directory in [
        "scripts",
        "GameCli_framework",
        "shared",
        "windows-offline-tools",
    ] {
        let source = source_root.join(directory);
        let destination = destination_root.join(directory);
        if !source.exists() {
            return Err(format!(
                "Bundled standalone build workspace is missing {}",
                source.display()
            ));
        }
        let include_node_modules = directory == "GameCli_framework";
        copy_dir_for_package_build(&source, &destination, include_node_modules).map_err(
            |error| {
                format!(
                    "Failed to copy bundled standalone build workspace from {} to {}: {error}",
                    source.display(),
                    destination.display()
                )
            },
        )?;
    }

    Ok(())
}

fn resolve_gamecli_exe(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    if let Ok(path) = std::env::var("AGENTVN_GAMECLI_EXE") {
        let candidate = PathBuf::from(path);
        if candidate.exists() {
            return Ok(candidate);
        }
    }

    let root = workspace_root();
    let exe_parent = exe_parent_dir();
    let parent_root = root
        .parent()
        .map(PathBuf::from)
        .unwrap_or_else(|| root.clone());
    let mut candidates = Vec::new();

    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join("agentvn-player.exe"));
        candidates.push(resource_dir.join("binaries").join("agentvn-player.exe"));
    }

    candidates.extend([
        exe_parent.join("agentvn-player.exe"),
        exe_parent.join("resources").join("agentvn-player.exe"),
        root.join("agentvn-player.exe"),
        root.join("GameCli_framework")
            .join("src-tauri")
            .join("target")
            .join("release")
            .join("agentvn-player.exe"),
        root.join("editor")
            .join("src-tauri")
            .join("binaries")
            .join("agentvn-player.exe"),
        root.join("releases")
            .join("player-shell")
            .join("AgentVN Player.exe"),
        parent_root
            .join("GameCli_framework")
            .join("src-tauri")
            .join("target")
            .join("release")
            .join("agentvn-player.exe"),
        root.join("output")
            .join("game-shell")
            .join("AgentVN Player.exe"),
        parent_root
            .join("output")
            .join("game-shell")
            .join("AgentVN Player.exe"),
    ]);

    candidates
        .into_iter()
        .find(|path| path.exists())
        .ok_or_else(|| "GameCLI executable was not found. The installed editor should include agentvn-player.exe; reinstall or run scripts/build-game-shell-windows.ps1, then set AGENTVN_GAMECLI_EXE.".to_string())
}

fn gamecli_preview_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let preview_dir = app
        .path()
        .app_cache_dir()
        .map_err(|error| format!("Failed to locate preview cache dir: {error}"))?
        .join("gamecli-preview");
    fs::create_dir_all(&preview_dir)
        .map_err(|error| format!("Failed to create preview cache dir: {error}"))?;
    Ok(preview_dir)
}

fn remove_path_if_exists(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }
    if path.is_dir() {
        fs::remove_dir_all(path)
    } else {
        fs::remove_file(path)
    }
    .map_err(|error| format!("Failed to remove {}: {error}", path.display()))
}

fn gamecli_preview_incoming_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(gamecli_preview_dir(app)?.join("incoming"))
}

fn gamecli_preview_current_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(gamecli_preview_dir(app)?.join("current"))
}

fn gamecli_preview_incoming_cartridge_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(gamecli_preview_dir(app)?.join("incoming.vncart"))
}

fn cleanup_gamecli_preview_disk_workspace(
    app: &tauri::AppHandle,
    keep_current: bool,
) -> Result<(), String> {
    let preview_dir = gamecli_preview_dir(app)?;
    remove_path_if_exists(&preview_dir.join("incoming"))?;
    remove_path_if_exists(&preview_dir.join("incoming.vncart"))?;
    if !keep_current {
        remove_path_if_exists(&preview_dir.join("current"))?;
    }
    Ok(())
}

fn cleanup_gamecli_preview_cartridges(
    app: &tauri::AppHandle,
    keep_path: Option<&Path>,
) -> Result<(), String> {
    let preview_dir = gamecli_preview_dir(app)?;
    let keep_path = keep_path.and_then(|path| path.canonicalize().ok());
    let entries = fs::read_dir(&preview_dir).map_err(|error| {
        format!(
            "Failed to scan temporary preview cartridge dir {}: {error}",
            preview_dir.display()
        )
    })?;

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let Some(file_name) = path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };
        if !file_name.ends_with(".vncart") {
            continue;
        }
        let is_kept = keep_path
            .as_ref()
            .and_then(|kept| path.canonicalize().ok().map(|current| current == *kept))
            .unwrap_or(false);
        if is_kept {
            continue;
        }
        match fs::remove_file(&path) {
            Ok(()) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => eprintln!(
                "[AgentVN] Failed to remove old temporary preview cartridge {}: {error}",
                path.display()
            ),
        }
    }
    Ok(())
}

fn is_dangerous_preview_extension(path: &str) -> bool {
    let lower = path.to_ascii_lowercase();
    [
        ".exe", ".dll", ".bat", ".cmd", ".ps1", ".vbs", ".js", ".msi", ".scr", ".com", ".pif",
    ]
    .iter()
    .any(|extension| lower.ends_with(extension))
}

fn validate_preview_zip_path(path: &str, is_dir: bool) -> Result<PathBuf, String> {
    let normalized = if is_dir {
        path.trim_end_matches('/')
    } else {
        path
    };
    if normalized.trim().is_empty() {
        return Err("Preview cartridge contains an empty path.".to_string());
    }
    if normalized.contains('\0')
        || normalized.contains('\\')
        || normalized.starts_with('/')
        || normalized.starts_with('\\')
    {
        return Err(format!("Preview cartridge contains an unsafe path: {path}"));
    }
    if normalized
        .split('/')
        .any(|part| part == ".." || part.is_empty())
    {
        return Err(format!(
            "Preview cartridge contains an unsafe path segment: {path}"
        ));
    }
    if normalized.len() > 512 {
        return Err(format!("Preview cartridge path is too long: {path}"));
    }
    if is_dangerous_preview_extension(normalized) {
        return Err(format!(
            "Preview cartridge contains a forbidden executable file: {path}"
        ));
    }
    Ok(PathBuf::from(normalized))
}

fn frontend_http_ready(port: u16) -> bool {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let mut stream = match TcpStream::connect_timeout(&addr, Duration::from_millis(500)) {
        Ok(stream) => stream,
        Err(_) => return false,
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(1200)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(1200)));
    let request = format!("GET / HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n");
    if std::io::Write::write_all(&mut stream, request.as_bytes()).is_err() {
        return false;
    }
    let mut response = String::new();
    if std::io::Read::read_to_string(&mut stream, &mut response).is_err() {
        return false;
    }
    (response.starts_with("HTTP/1.1 200") || response.starts_with("HTTP/1.0 200"))
        && response.contains("<html")
}

fn wait_for_frontend_http(port: u16, timeout_secs: u64) -> bool {
    let start = Instant::now();
    while start.elapsed().as_secs() < timeout_secs {
        if frontend_http_ready(port) {
            return true;
        }
        std::thread::sleep(Duration::from_millis(500));
    }
    false
}

fn validate_directory_preview_path(path: &str) -> Result<PathBuf, String> {
    let relative = validate_preview_zip_path(path, false)?;
    let normalized = relative.to_string_lossy().replace('\\', "/");
    let allowed_exact = matches!(
        normalized.as_str(),
        "manifest.json" | "script.json" | "gallery.json" | "checksum.json" | "ui/layout.json"
    );
    let allowed_prefix = normalized.starts_with("assets/") || normalized.starts_with("ui/assets/");
    if !allowed_exact && !allowed_prefix {
        return Err(format!(
            "Preview directory path is not allowed: {path}. Allowed files are manifest.json, script.json, gallery.json, checksum.json, ui/layout.json, assets/**, ui/assets/**."
        ));
    }
    Ok(relative)
}

fn gamecli_preview_incoming_path(
    app: &tauri::AppHandle,
    relative_path: &str,
) -> Result<PathBuf, String> {
    let relative = validate_directory_preview_path(relative_path)?;
    let incoming_dir = gamecli_preview_incoming_dir(app)?;
    let target = incoming_dir.join(relative);
    let incoming_canonical = incoming_dir.canonicalize().map_err(|error| {
        format!(
            "Failed to resolve preview incoming directory {}: {error}",
            incoming_dir.display()
        )
    })?;
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "Failed to create preview directory parent {}: {error}",
                parent.display()
            )
        })?;
        let parent_canonical = parent.canonicalize().map_err(|error| {
            format!(
                "Failed to resolve preview directory parent {}: {error}",
                parent.display()
            )
        })?;
        if !parent_canonical.starts_with(&incoming_canonical) {
            return Err(format!(
                "Preview directory path escapes incoming directory: {}",
                target.display()
            ));
        }
    }
    Ok(target)
}

fn assert_preview_directory_session(state: &DevProcesses, session_id: &str) -> Result<(), String> {
    let guard = state
        .gamecli_preview_directory
        .lock()
        .map_err(|_| "GameCLI directory preview lock is poisoned.".to_string())?;
    let session = guard
        .as_ref()
        .ok_or_else(|| "GameCLI directory preview session was not initialized.".to_string())?;
    if session.session_id != session_id {
        return Err(
            "GameCLI directory preview session id does not match the active session.".to_string(),
        );
    }
    Ok(())
}

fn collect_preview_files(root: &Path, dir: &Path, files: &mut Vec<PathBuf>) -> Result<(), String> {
    for entry in fs::read_dir(dir).map_err(|error| {
        format!(
            "Failed to scan preview directory {}: {error}",
            dir.display()
        )
    })? {
        let entry =
            entry.map_err(|error| format!("Failed to read preview directory entry: {error}"))?;
        let path = entry.path();
        if entry
            .file_type()
            .map_err(|error| format!("Failed to read preview file type: {error}"))?
            .is_dir()
        {
            collect_preview_files(root, &path, files)?;
        } else if path.file_name().and_then(|value| value.to_str()) != Some("checksum.json") {
            let relative = path.strip_prefix(root).map_err(|error| {
                format!(
                    "Failed to compute preview file relative path {}: {error}",
                    path.display()
                )
            })?;
            validate_directory_preview_path(&relative.to_string_lossy().replace('\\', "/"))?;
            files.push(path);
        }
    }
    Ok(())
}

fn sha256_file(path: &Path) -> Result<String, String> {
    let metadata = fs::metadata(path).map_err(|error| {
        format!(
            "Failed to stat preview file for checksum {}: {error}",
            path.display()
        )
    })?;
    if metadata.len() <= 16 * 1024 * 1024 {
        let bytes = fs::read(path).map_err(|error| {
            format!(
                "Failed to read preview file for checksum {}: {error}",
                path.display()
            )
        })?;
        return Ok(hex::encode(Sha256::digest(&bytes)));
    }
    let mut file = File::open(path).map_err(|error| {
        format!(
            "Failed to open preview file for checksum {}: {error}",
            path.display()
        )
    })?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let count = file.read(&mut buffer).map_err(|error| {
            format!(
                "Failed to read preview file for checksum {}: {error}",
                path.display()
            )
        })?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
    }
    Ok(hex::encode(hasher.finalize()))
}

fn create_gamecli_preview_checksum(root: &Path) -> Result<(), String> {
    eprintln!(
        "[AgentVN] Creating GameCLI preview checksum for {}",
        root.display()
    );
    let mut files = Vec::new();
    collect_preview_files(root, root, &mut files)?;
    eprintln!(
        "[AgentVN] GameCLI preview checksum will include {} files.",
        files.len()
    );
    files.sort();
    let mut entries = Vec::new();
    for path in files {
        let relative = path
            .strip_prefix(root)
            .map_err(|error| {
                format!(
                    "Failed to compute checksum path {}: {error}",
                    path.display()
                )
            })?
            .to_string_lossy()
            .replace('\\', "/");
        eprintln!("[AgentVN] Hashing GameCLI preview file: {relative}");
        entries.push(PreviewChecksumFileEntry {
            path: relative,
            size_bytes: fs::metadata(&path)
                .map_err(|error| {
                    format!("Failed to stat preview file {}: {error}", path.display())
                })?
                .len(),
            hash_sha256: sha256_file(&path)?,
        });
    }
    let checksum = PreviewChecksumManifest {
        checksum_version: "1.0.0".to_string(),
        algorithm: "sha256".to_string(),
        generated_at: error_report_timestamp().to_string(),
        files: entries,
    };
    let json = serde_json::to_string_pretty(&checksum)
        .map_err(|error| format!("Failed to encode preview checksum.json: {error}"))?;
    fs::write(root.join("checksum.json"), json)
        .map_err(|error| format!("Failed to write preview checksum.json: {error}"))
}

fn unpack_gamecli_preview_cartridge(
    app: &tauri::AppHandle,
    cartridge_path: &Path,
) -> Result<PathBuf, String> {
    let incoming_dir = gamecli_preview_incoming_dir(app)?;
    let current_dir = gamecli_preview_current_dir(app)?;
    remove_path_if_exists(&incoming_dir)?;
    fs::create_dir_all(&incoming_dir).map_err(|error| {
        format!(
            "Failed to create preview unpack directory {}: {error}",
            incoming_dir.display()
        )
    })?;
    let incoming_canonical = incoming_dir.canonicalize().map_err(|error| {
        format!(
            "Failed to resolve preview unpack directory {}: {error}",
            incoming_dir.display()
        )
    })?;

    let file = File::open(cartridge_path).map_err(|error| {
        format!(
            "Failed to open temporary preview cartridge {}: {error}",
            cartridge_path.display()
        )
    })?;
    let mut archive = ZipArchive::new(file).map_err(|error| {
        format!(
            "Failed to read temporary preview cartridge as zip {}: {error}",
            cartridge_path.display()
        )
    })?;

    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(|error| {
            format!("Failed to read preview cartridge zip entry {index}: {error}")
        })?;
        let name = entry.name().to_string();
        let is_dir = entry.is_dir();
        let relative_path = validate_preview_zip_path(&name, is_dir)?;
        let target = incoming_dir.join(relative_path);

        if is_dir {
            fs::create_dir_all(&target).map_err(|error| {
                format!(
                    "Failed to create preview cartridge directory {}: {error}",
                    target.display()
                )
            })?;
            continue;
        }

        let parent = target
            .parent()
            .ok_or_else(|| format!("Preview cartridge path has no parent: {}", target.display()))?;
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "Failed to create preview cartridge parent directory {}: {error}",
                parent.display()
            )
        })?;
        let parent_canonical = parent.canonicalize().map_err(|error| {
            format!(
                "Failed to resolve preview cartridge parent directory {}: {error}",
                parent.display()
            )
        })?;
        if !parent_canonical.starts_with(&incoming_canonical) {
            return Err(format!(
                "Preview cartridge path escapes unpack directory: {}",
                target.display()
            ));
        }

        let mut output = File::create(&target).map_err(|error| {
            format!(
                "Failed to create unpacked preview cartridge file {}: {error}",
                target.display()
            )
        })?;
        io::copy(&mut entry, &mut output).map_err(|error| {
            format!(
                "Failed to unpack preview cartridge file {}: {error}",
                target.display()
            )
        })?;
        let target_canonical = target.canonicalize().map_err(|error| {
            format!(
                "Failed to resolve unpacked preview cartridge file {}: {error}",
                target.display()
            )
        })?;
        if !target_canonical.starts_with(&incoming_canonical) {
            return Err(format!(
                "Preview cartridge file escapes unpack directory: {}",
                target.display()
            ));
        }
    }

    for required in ["manifest.json", "script.json", "checksum.json"] {
        if !incoming_dir.join(required).is_file() {
            return Err(format!(
                "Preview cartridge is missing required file: {required}"
            ));
        }
    }

    remove_path_if_exists(&current_dir)?;
    fs::rename(&incoming_dir, &current_dir)
        .or_else(|_| {
            fs::create_dir_all(&current_dir)?;
            copy_dir_recursive(&incoming_dir, &current_dir)?;
            fs::remove_dir_all(&incoming_dir)
        })
        .map_err(|error| {
            format!(
                "Failed to promote unpacked preview cartridge {} -> {}: {error}",
                incoming_dir.display(),
                current_dir.display()
            )
        })?;
    let _ = fs::remove_file(cartridge_path);
    Ok(current_dir)
}

fn copy_dir_recursive(source: &Path, destination: &Path) -> io::Result<()> {
    fs::create_dir_all(destination)?;
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let source_path = entry.path();
        let destination_path = destination.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir_recursive(&source_path, &destination_path)?;
        } else {
            fs::copy(&source_path, &destination_path)?;
        }
    }
    Ok(())
}

fn validate_gamecli_preview_upload_id(upload_id: &str) -> Result<(), String> {
    if upload_id.trim().is_empty()
        || upload_id.contains("..")
        || upload_id
            .chars()
            .any(|ch| !ch.is_ascii_alphanumeric() && !matches!(ch, '-' | '_' | '.'))
    {
        return Err("Invalid GameCLI preview upload id.".to_string());
    }
    Ok(())
}

fn gamecli_preview_upload_path(app: &tauri::AppHandle, upload_id: &str) -> Result<PathBuf, String> {
    validate_gamecli_preview_upload_id(upload_id)?;
    Ok(gamecli_preview_dir(app)?.join(upload_id))
}

fn write_gamecli_preview_cartridge(
    app: &tauri::AppHandle,
    file_name: &str,
    cartridge_bytes: Vec<u8>,
) -> Result<PathBuf, String> {
    cleanup_gamecli_preview_cartridges(app, None)?;
    let cartridge_path = gamecli_preview_dir(app)?.join(safe_package_file_name(file_name));
    fs::write(&cartridge_path, cartridge_bytes)
        .map_err(|error| format!("Failed to write temporary cartridge: {error}"))?;
    Ok(cartridge_path)
}

fn start_gamecli_preview(
    app: &tauri::AppHandle,
    state: &DevProcesses,
    cartridge_path: PathBuf,
) -> Result<String, String> {
    close_gamecli_preview_process(state)?;
    cleanup_gamecli_preview_cartridges(app, Some(&cartridge_path))?;

    let exe = resolve_gamecli_exe(app)?;
    eprintln!(
        "[AgentVN] Starting GameCLI preview: exe={}, cartridge={}",
        exe.display(),
        cartridge_path.display()
    );

    let mut player_command = background_command(&exe);
    player_command
        .args(["--mode", "preview", "--cartridge"])
        .arg(&cartridge_path)
        .current_dir(exe.parent().unwrap_or_else(|| Path::new(".")))
        .env_remove("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS")
        .env_remove("WEBVIEW2_USER_DATA_FOLDER")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    let child = OwnedProcess::spawn(&mut player_command)
        .map_err(|error| format!("Failed to start GameCLI: {error}"))?;

    *state.gamecli_preview.lock().unwrap() = Some(child);
    *state.gamecli_preview_cartridge.lock().unwrap() = Some(cartridge_path.clone());
    Ok(cartridge_path.to_string_lossy().to_string())
}

fn start_gamecli_preview_from_unpacked_dir(
    app: &tauri::AppHandle,
    state: &DevProcesses,
    preview_root: PathBuf,
) -> Result<String, String> {
    close_gamecli_preview_process(state)?;
    cleanup_gamecli_preview_disk_workspace(app, true)?;
    cleanup_gamecli_preview_cartridges(app, None)?;
    launch_gamecli_preview_from_unpacked_dir(app, state, preview_root)
}

fn launch_gamecli_preview_from_unpacked_dir(
    app: &tauri::AppHandle,
    state: &DevProcesses,
    preview_root: PathBuf,
) -> Result<String, String> {
    let exe = resolve_gamecli_exe(app)?;
    eprintln!(
        "[AgentVN] Starting GameCLI disk preview: exe={}, preview_root={}",
        exe.display(),
        preview_root.display()
    );

    let mut player_command = background_command(&exe);
    let gamecli_cdp_args = std::env::var("AGENTVN_GAMECLI_PREVIEW_WEBVIEW2_ARGS")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| {
            std::env::var("AGENTVN_GAMECLI_PREVIEW_CDP_PORT")
                .ok()
                .filter(|value| !value.trim().is_empty())
                .map(|port| format!("--remote-debugging-port={port}"))
        });
    player_command
        .args(["--mode", "preview", "--preview-root"])
        .arg(&preview_root)
        .current_dir(exe.parent().unwrap_or_else(|| Path::new(".")))
        .env_remove("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS")
        .env_remove("WEBVIEW2_USER_DATA_FOLDER")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    if let Some(args) = gamecli_cdp_args {
        player_command.env("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", args);
    }
    let child = OwnedProcess::spawn(&mut player_command)
        .map_err(|error| format!("Failed to start GameCLI disk preview: {error}"))?;

    *state.gamecli_preview.lock().unwrap() = Some(child);
    *state.gamecli_preview_cartridge.lock().unwrap() = Some(preview_root.clone());
    Ok(preview_root.to_string_lossy().to_string())
}

#[tauri::command]
fn open_gamecli_preview(
    app: tauri::AppHandle,
    state: tauri::State<'_, DevProcesses>,
    cartridge_bytes: Vec<u8>,
    file_name: String,
) -> Result<String, String> {
    let cartridge_path = write_gamecli_preview_cartridge(&app, &file_name, cartridge_bytes)?;
    start_gamecli_preview(&app, state.inner(), cartridge_path)
}

#[tauri::command]
fn begin_gamecli_preview_disk_upload(
    app: tauri::AppHandle,
    state: tauri::State<'_, DevProcesses>,
    file_name: String,
    expected_size: Option<u64>,
) -> Result<GameCliPreviewUpload, String> {
    let _safe_name = safe_package_file_name(&file_name);
    close_gamecli_preview_process(state.inner())?;
    cleanup_gamecli_preview_disk_workspace(&app, false)?;
    cleanup_gamecli_preview_cartridges(&app, None)?;
    let cartridge_path = gamecli_preview_incoming_cartridge_path(&app)?;
    fs::File::create(&cartridge_path)
        .map_err(|error| format!("Failed to create disk preview cartridge upload: {error}"))?;
    *state
        .gamecli_preview_disk_upload
        .lock()
        .map_err(|_| "GameCLI disk preview upload lock is poisoned.".to_string())? =
        Some(GameCliPreviewDiskUploadMeta {
            upload_id: "incoming.vncart".to_string(),
            expected_size,
            written_bytes: 0,
        });
    Ok(GameCliPreviewUpload {
        upload_id: "incoming.vncart".to_string(),
        path: cartridge_path.to_string_lossy().to_string(),
    })
}

#[tauri::command]
fn append_gamecli_preview_disk_chunk(
    app: tauri::AppHandle,
    state: tauri::State<'_, DevProcesses>,
    upload_id: String,
    offset_bytes: Option<u64>,
    chunk_bytes: Vec<u8>,
) -> Result<GameCliPreviewUploadAppendResult, String> {
    if upload_id != "incoming.vncart" {
        return Err("Invalid GameCLI disk preview upload id.".to_string());
    }
    let cartridge_path = gamecli_preview_incoming_cartridge_path(&app)?;
    let mut meta_guard = state
        .gamecli_preview_disk_upload
        .lock()
        .map_err(|_| "GameCLI disk preview upload lock is poisoned.".to_string())?;
    let meta = meta_guard
        .as_mut()
        .ok_or_else(|| "GameCLI disk preview upload was not initialized.".to_string())?;
    if meta.upload_id != upload_id {
        return Err("GameCLI disk preview upload id does not match the active upload.".to_string());
    }
    if let Some(offset_bytes) = offset_bytes {
        if offset_bytes != meta.written_bytes {
            return Err(format!(
                "GameCLI disk preview upload offset mismatch: expected {}, got {}.",
                meta.written_bytes, offset_bytes
            ));
        }
    }
    if let Some(expected_size) = meta.expected_size {
        let next_size = meta
            .written_bytes
            .checked_add(chunk_bytes.len() as u64)
            .ok_or_else(|| "GameCLI disk preview upload size overflow.".to_string())?;
        if next_size > expected_size {
            return Err(format!(
                "GameCLI disk preview upload exceeds expected size: {} > {} bytes.",
                next_size, expected_size
            ));
        }
    }
    let mut file = fs::OpenOptions::new()
        .append(true)
        .open(&cartridge_path)
        .map_err(|error| {
            format!(
                "Failed to open disk preview cartridge upload {}: {error}",
                cartridge_path.display()
            )
        })?;
    file.write_all(&chunk_bytes).map_err(|error| {
        format!(
            "Failed to append disk preview cartridge chunk to {}: {error}",
            cartridge_path.display()
        )
    })?;
    file.flush().map_err(|error| {
        format!(
            "Failed to flush disk preview cartridge chunk to {}: {error}",
            cartridge_path.display()
        )
    })?;
    meta.written_bytes += chunk_bytes.len() as u64;
    let actual_size = fs::metadata(&cartridge_path)
        .map_err(|error| {
            format!(
                "Failed to stat disk preview cartridge upload {}: {error}",
                cartridge_path.display()
            )
        })?
        .len();
    if actual_size != meta.written_bytes {
        return Err(format!(
            "GameCLI disk preview upload write verification failed: file has {} bytes, expected {} bytes.",
            actual_size, meta.written_bytes
        ));
    }
    Ok(GameCliPreviewUploadAppendResult {
        written_bytes: meta.written_bytes,
    })
}

#[tauri::command]
fn open_gamecli_preview_disk_upload(
    app: tauri::AppHandle,
    state: tauri::State<'_, DevProcesses>,
    upload_id: String,
) -> Result<String, String> {
    if upload_id != "incoming.vncart" {
        return Err("Invalid GameCLI disk preview upload id.".to_string());
    }
    let cartridge_path = gamecli_preview_incoming_cartridge_path(&app)?;
    if !cartridge_path.exists() {
        return Err("Temporary disk preview cartridge upload was not found.".to_string());
    }
    let actual_size = fs::metadata(&cartridge_path)
        .map_err(|error| {
            format!(
                "Failed to stat temporary disk preview cartridge {}: {error}",
                cartridge_path.display()
            )
        })?
        .len();
    {
        let meta_guard = state
            .gamecli_preview_disk_upload
            .lock()
            .map_err(|_| "GameCLI disk preview upload lock is poisoned.".to_string())?;
        let meta = meta_guard
            .as_ref()
            .ok_or_else(|| "GameCLI disk preview upload was not initialized.".to_string())?;
        if meta.upload_id != upload_id {
            return Err(
                "GameCLI disk preview upload id does not match the active upload.".to_string(),
            );
        }
        if actual_size != meta.written_bytes {
            return Err(format!(
                "GameCLI disk preview upload is incomplete: file has {} bytes, but {} bytes were acknowledged.",
                actual_size, meta.written_bytes
            ));
        }
        if let Some(expected_size) = meta.expected_size {
            if actual_size != expected_size {
                return Err(format!(
                    "GameCLI disk preview upload is incomplete: received {} / {} bytes. Please start preview again.",
                    actual_size, expected_size
                ));
            }
        }
    }
    let preview_root = unpack_gamecli_preview_cartridge(&app, &cartridge_path)?;
    *state
        .gamecli_preview_disk_upload
        .lock()
        .map_err(|_| "GameCLI disk preview upload lock is poisoned.".to_string())? = None;
    start_gamecli_preview_from_unpacked_dir(&app, state.inner(), preview_root)
}

#[tauri::command]
fn begin_gamecli_preview_directory(
    app: tauri::AppHandle,
    state: tauri::State<'_, DevProcesses>,
    expected_file_count: Option<u64>,
    expected_asset_count: Option<u64>,
) -> Result<GameCliPreviewDirectoryBegin, String> {
    close_gamecli_preview_process(state.inner())?;
    cleanup_gamecli_preview_disk_workspace(&app, false)?;
    cleanup_gamecli_preview_cartridges(&app, None)?;
    let incoming_dir = gamecli_preview_incoming_dir(&app)?;
    fs::create_dir_all(&incoming_dir).map_err(|error| {
        format!(
            "Failed to create GameCLI directory preview incoming dir {}: {error}",
            incoming_dir.display()
        )
    })?;
    let session_id = format!("directory-{}", error_report_timestamp());
    *state
        .gamecli_preview_directory
        .lock()
        .map_err(|_| "GameCLI directory preview lock is poisoned.".to_string())? =
        Some(GameCliPreviewDirectorySession {
            session_id: session_id.clone(),
            expected_file_count,
            expected_asset_count,
            asset_uploads: HashMap::new(),
        });
    Ok(GameCliPreviewDirectoryBegin {
        session_id,
        path: incoming_dir.to_string_lossy().to_string(),
    })
}

#[tauri::command]
fn write_gamecli_preview_text_file(
    app: tauri::AppHandle,
    state: tauri::State<'_, DevProcesses>,
    session_id: String,
    relative_path: String,
    contents: String,
) -> Result<(), String> {
    assert_preview_directory_session(state.inner(), &session_id)?;
    let target = gamecli_preview_incoming_path(&app, &relative_path)?;
    fs::write(&target, contents).map_err(|error| {
        format!(
            "Failed to write preview text file {}: {error}",
            target.display()
        )
    })
}

#[tauri::command]
fn link_or_copy_gamecli_preview_asset(
    app: tauri::AppHandle,
    state: tauri::State<'_, DevProcesses>,
    session_id: String,
    relative_path: String,
    source_file_path: String,
) -> Result<(), String> {
    assert_preview_directory_session(state.inner(), &session_id)?;
    if source_file_path.trim().is_empty() || source_file_path.contains('\0') {
        return Err("Invalid source asset path for directory preview.".to_string());
    }
    let source = PathBuf::from(source_file_path);
    if !source.is_file() {
        return Err(format!(
            "Preview source asset file was not found: {}",
            source.display()
        ));
    }
    let target = gamecli_preview_incoming_path(&app, &relative_path)?;
    if target.exists() {
        fs::remove_file(&target).map_err(|error| {
            format!(
                "Failed to replace existing preview asset {}: {error}",
                target.display()
            )
        })?;
    }
    match fs::hard_link(&source, &target) {
        Ok(()) => Ok(()),
        Err(_) => fs::copy(&source, &target).map(|_| ()).map_err(|error| {
            format!(
                "Failed to copy preview asset {} -> {}: {error}",
                source.display(),
                target.display()
            )
        }),
    }
}

#[tauri::command]
fn begin_gamecli_preview_asset_upload(
    app: tauri::AppHandle,
    state: tauri::State<'_, DevProcesses>,
    session_id: String,
    relative_path: String,
    expected_size: Option<u64>,
) -> Result<(), String> {
    let target = gamecli_preview_incoming_path(&app, &relative_path)?;
    File::create(&target).map_err(|error| {
        format!(
            "Failed to create preview asset upload file {}: {error}",
            target.display()
        )
    })?;
    let mut guard = state
        .gamecli_preview_directory
        .lock()
        .map_err(|_| "GameCLI directory preview lock is poisoned.".to_string())?;
    let session = guard
        .as_mut()
        .ok_or_else(|| "GameCLI directory preview session was not initialized.".to_string())?;
    if session.session_id != session_id {
        return Err(
            "GameCLI directory preview session id does not match the active session.".to_string(),
        );
    }
    session.asset_uploads.insert(
        relative_path,
        GameCliPreviewAssetUploadMeta {
            expected_size,
            written_bytes: 0,
        },
    );
    Ok(())
}

#[tauri::command]
fn append_gamecli_preview_asset_chunk(
    app: tauri::AppHandle,
    state: tauri::State<'_, DevProcesses>,
    session_id: String,
    relative_path: String,
    offset_bytes: Option<u64>,
    chunk_bytes: Vec<u8>,
) -> Result<GameCliPreviewUploadAppendResult, String> {
    let target = gamecli_preview_incoming_path(&app, &relative_path)?;
    let mut guard = state
        .gamecli_preview_directory
        .lock()
        .map_err(|_| "GameCLI directory preview lock is poisoned.".to_string())?;
    let session = guard
        .as_mut()
        .ok_or_else(|| "GameCLI directory preview session was not initialized.".to_string())?;
    if session.session_id != session_id {
        return Err(
            "GameCLI directory preview session id does not match the active session.".to_string(),
        );
    }
    let upload = session
        .asset_uploads
        .get_mut(&relative_path)
        .ok_or_else(|| "Preview asset upload was not initialized.".to_string())?;
    if let Some(offset_bytes) = offset_bytes {
        if offset_bytes != upload.written_bytes {
            return Err(format!(
                "Preview asset upload offset mismatch: expected {}, got {}.",
                upload.written_bytes, offset_bytes
            ));
        }
    }
    let next_size = upload
        .written_bytes
        .checked_add(chunk_bytes.len() as u64)
        .ok_or_else(|| "Preview asset upload size overflow.".to_string())?;
    if let Some(expected_size) = upload.expected_size {
        if next_size > expected_size {
            return Err(format!(
                "Preview asset upload exceeds expected size: {} > {} bytes.",
                next_size, expected_size
            ));
        }
    }
    let mut file = fs::OpenOptions::new()
        .append(true)
        .open(&target)
        .map_err(|error| {
            format!(
                "Failed to open preview asset upload {}: {error}",
                target.display()
            )
        })?;
    file.write_all(&chunk_bytes).map_err(|error| {
        format!(
            "Failed to append preview asset upload {}: {error}",
            target.display()
        )
    })?;
    file.flush().map_err(|error| {
        format!(
            "Failed to flush preview asset upload {}: {error}",
            target.display()
        )
    })?;
    upload.written_bytes = next_size;
    Ok(GameCliPreviewUploadAppendResult {
        written_bytes: upload.written_bytes,
    })
}

#[tauri::command]
fn finalize_gamecli_preview_directory(
    app: tauri::AppHandle,
    state: tauri::State<'_, DevProcesses>,
    session_id: String,
) -> Result<String, String> {
    {
        let guard = state
            .gamecli_preview_directory
            .lock()
            .map_err(|_| "GameCLI directory preview lock is poisoned.".to_string())?;
        let session = guard
            .as_ref()
            .ok_or_else(|| "GameCLI directory preview session was not initialized.".to_string())?;
        if session.session_id != session_id {
            return Err(
                "GameCLI directory preview session id does not match the active session."
                    .to_string(),
            );
        }
        for (relative_path, upload) in &session.asset_uploads {
            if let Some(expected_size) = upload.expected_size {
                if upload.written_bytes != expected_size {
                    return Err(format!(
                        "Preview asset upload is incomplete: {} has {} / {} bytes.",
                        relative_path, upload.written_bytes, expected_size
                    ));
                }
            }
        }
        if let Some(expected_asset_count) = session.expected_asset_count {
            let _ = expected_asset_count;
        }
        if let Some(expected_file_count) = session.expected_file_count {
            let _ = expected_file_count;
        }
    }
    let incoming_dir = gamecli_preview_incoming_dir(&app)?;
    let current_dir = gamecli_preview_current_dir(&app)?;
    let finalize_result = (|| -> Result<(), String> {
        eprintln!(
            "[AgentVN] Finalizing GameCLI directory preview: incoming={}, current={}",
            incoming_dir.display(),
            current_dir.display()
        );
        for required in ["manifest.json", "script.json"] {
            if !incoming_dir.join(required).is_file() {
                return Err(format!(
                    "Preview directory is missing required file: {required}"
                ));
            }
        }
        create_gamecli_preview_checksum(&incoming_dir)?;
        if !incoming_dir.join("checksum.json").is_file() {
            return Err("Preview directory checksum.json was not generated.".to_string());
        }
        remove_path_if_exists(&current_dir)?;
        fs::rename(&incoming_dir, &current_dir)
            .or_else(|_| {
                fs::create_dir_all(&current_dir)?;
                copy_dir_recursive(&incoming_dir, &current_dir)?;
                fs::remove_dir_all(&incoming_dir)
            })
            .map_err(|error| {
                format!(
                    "Failed to promote directory preview {} -> {}: {error}",
                    incoming_dir.display(),
                    current_dir.display()
                )
            })?;
        cleanup_gamecli_preview_disk_workspace(&app, true)?;
        cleanup_gamecli_preview_cartridges(&app, None)?;
        Ok(())
    })();
    if let Err(error) = finalize_result {
        let _ = cleanup_gamecli_preview_disk_workspace(&app, true);
        return Err(error);
    }
    *state
        .gamecli_preview_directory
        .lock()
        .map_err(|_| "GameCLI directory preview lock is poisoned.".to_string())? = None;
    launch_gamecli_preview_from_unpacked_dir(&app, state.inner(), current_dir)
}

#[tauri::command]
fn begin_gamecli_preview_upload(
    app: tauri::AppHandle,
    state: tauri::State<'_, DevProcesses>,
    file_name: String,
) -> Result<GameCliPreviewUpload, String> {
    close_gamecli_preview_process(state.inner())?;
    cleanup_gamecli_preview_cartridges(&app, None)?;
    let preview_dir = gamecli_preview_dir(&app)?;
    let safe_name = safe_package_file_name(&file_name);
    let upload_id = format!("preview-{}-{safe_name}", error_report_timestamp());
    let cartridge_path = preview_dir.join(&upload_id);
    fs::File::create(&cartridge_path)
        .map_err(|error| format!("Failed to create temporary preview cartridge: {error}"))?;
    Ok(GameCliPreviewUpload {
        upload_id,
        path: cartridge_path.to_string_lossy().to_string(),
    })
}

#[tauri::command]
fn append_gamecli_preview_chunk(
    app: tauri::AppHandle,
    upload_id: String,
    chunk_bytes: Vec<u8>,
) -> Result<(), String> {
    let cartridge_path = gamecli_preview_upload_path(&app, &upload_id)?;
    let mut file = fs::OpenOptions::new()
        .append(true)
        .open(&cartridge_path)
        .map_err(|error| {
            format!(
                "Failed to open temporary preview cartridge {}: {error}",
                cartridge_path.display()
            )
        })?;
    file.write_all(&chunk_bytes).map_err(|error| {
        format!(
            "Failed to append preview cartridge chunk to {}: {error}",
            cartridge_path.display()
        )
    })
}

#[tauri::command]
fn open_gamecli_preview_upload(
    app: tauri::AppHandle,
    state: tauri::State<'_, DevProcesses>,
    upload_id: String,
) -> Result<String, String> {
    let cartridge_path = gamecli_preview_upload_path(&app, &upload_id)?;
    if !cartridge_path.exists() {
        return Err("Temporary preview cartridge upload was not found.".to_string());
    }
    start_gamecli_preview(&app, state.inner(), cartridge_path)
}

#[tauri::command]
fn get_gamecli_preview_running(state: tauri::State<'_, DevProcesses>) -> Result<bool, String> {
    let mut child = state.gamecli_preview.lock().map_err(|error| error.to_string())?;
    preview_process::is_running(&mut child)
}

#[tauri::command]
fn close_gamecli_preview(state: tauri::State<'_, DevProcesses>) -> Result<(), String> {
    eprintln!("[AgentVN] Closing GameCLI preview process.");
    close_gamecli_preview_process(state.inner())
}

#[tauri::command]
fn read_project_asset_file_bytes(file_path: String) -> Result<Vec<u8>, String> {
    if file_path.trim().is_empty() || file_path.contains('\0') {
        return Err("Invalid project asset file path.".to_string());
    }
    let path = PathBuf::from(file_path);
    if !path.is_file() {
        return Err(format!(
            "Project asset file was not found: {}",
            path.display()
        ));
    }
    fs::read(&path).map_err(|error| {
        format!(
            "Failed to read project asset file {}: {error}",
            path.display()
        )
    })
}

#[tauri::command]
fn project_asset_file_is_readable(file_path: String) -> bool {
    if file_path.trim().is_empty() || file_path.contains('\0') {
        return false;
    }
    File::open(PathBuf::from(file_path)).is_ok()
}

fn renpy_gui_import_cache_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_cache_dir()
        .map_err(|error| format!("无法定位 GUI 导入暂存目录：{error}"))
}

#[tauri::command]
async fn select_renpy_gui_import_directory(app: tauri::AppHandle) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let selected = app.dialog()
            .file()
            .set_title("选择 Ren’Py GUI 资源目录")
            .blocking_pick_folder();
        let Some(selected) = selected else { return Ok(None); };
        let source = selected.into_path()
            .map_err(|error| format!("无法读取所选 GUI 目录：{error}"))?;
        let cache = renpy_gui_import_cache_root(&app)?;
        renpy_gui_import::stage_directory_as_zip(&source, &cache)
            .map(|path| Some(path.to_string_lossy().to_string()))
    })
    .await
    .map_err(|error| format!("GUI 目录扫描任务失败：{error}"))?
}

#[tauri::command]
fn get_renpy_gui_import_archive_size(
    app: tauri::AppHandle,
    archive_path: String,
) -> Result<u64, String> {
    renpy_gui_import::staged_archive_size(
        &renpy_gui_import_cache_root(&app)?,
        Path::new(&archive_path),
    )
}

#[tauri::command]
fn read_renpy_gui_import_archive_chunk(
    app: tauri::AppHandle,
    archive_path: String,
    offset: u64,
    length: usize,
) -> Result<Vec<u8>, String> {
    renpy_gui_import::read_staged_archive_chunk(
        &renpy_gui_import_cache_root(&app)?,
        Path::new(&archive_path),
        offset,
        length,
    )
}

#[tauri::command]
fn cleanup_renpy_gui_import_archive(
    app: tauri::AppHandle,
    archive_path: String,
) -> Result<(), String> {
    renpy_gui_import::remove_staged_archive(
        &renpy_gui_import_cache_root(&app)?,
        Path::new(&archive_path),
    )
}

#[tauri::command]
async fn list_renpy_gui_packs(app: tauri::AppHandle) -> Result<Vec<gui_pack_library::Summary>, String> {
    let root = editor_app_data_dir(&app);
    tauri::async_runtime::spawn_blocking(move || gui_pack_library::list_at(&root))
        .await.map_err(|e| format!("GUI_LIBRARY_WORKER: {e}"))?
}

#[tauri::command]
async fn read_renpy_gui_pack(app: tauri::AppHandle, id: String) -> Result<String, String> {
    let root = editor_app_data_dir(&app);
    tauri::async_runtime::spawn_blocking(move || gui_pack_library::read_at(&root, &id))
        .await.map_err(|e| format!("GUI_LIBRARY_WORKER: {e}"))?
}

#[tauri::command]
async fn save_renpy_gui_pack(app: tauri::AppHandle, payload: String) -> Result<gui_pack_library::Summary, String> {
    let root = editor_app_data_dir(&app);
    tauri::async_runtime::spawn_blocking(move || gui_pack_library::save_at(&root, &payload))
        .await.map_err(|e| format!("GUI_LIBRARY_WORKER: {e}"))?
}

fn project_bundle_upload_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|error| format!("无法定位工程包暂存目录：{error}"))?
        .join("project-bundle-uploads");
    fs::create_dir_all(&dir)
        .map_err(|error| format!("无法创建工程包暂存目录 {}：{error}", dir.display()))?;
    Ok(dir)
}

fn project_bundle_upload_path(app: &tauri::AppHandle, upload_id: &str) -> Result<PathBuf, String> {
    if upload_id.is_empty()
        || upload_id.len() > 160
        || !upload_id
            .chars()
            .all(|value| value.is_ascii_alphanumeric() || matches!(value, '-' | '_' | '.'))
    {
        return Err("PROJECT_ZIP_PATH_UNSAFE: invalid upload id".to_string());
    }
    let root = project_bundle_upload_dir(app)?
        .canonicalize()
        .map_err(|error| format!("无法规范化工程包暂存目录：{error}"))?;
    let path = root.join(upload_id);
    if path.parent() != Some(root.as_path()) {
        return Err("PROJECT_ZIP_PATH_UNSAFE: upload path escaped cache".to_string());
    }
    Ok(path)
}

#[tauri::command]
fn begin_project_bundle_asset_upload(
    app: tauri::AppHandle,
    file_name: String,
) -> Result<ProjectBundleAssetUpload, String> {
    let safe_name = safe_package_file_name(&file_name);
    let upload_id = format!(
        "asset-{}-{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0),
        safe_name
    );
    let path = project_bundle_upload_path(&app, &upload_id)?;
    File::create(&path).map_err(|error| format!("无法创建素材暂存文件：{error}"))?;
    Ok(ProjectBundleAssetUpload {
        upload_id,
        path: path.to_string_lossy().to_string(),
    })
}

#[tauri::command]
fn append_project_bundle_asset_chunk(
    app: tauri::AppHandle,
    upload_id: String,
    offset: u64,
    chunk_bytes: Vec<u8>,
) -> Result<u64, String> {
    let path = project_bundle_upload_path(&app, &upload_id)?;
    let current = fs::metadata(&path)
        .map_err(|error| format!("无法检查素材暂存文件：{error}"))?
        .len();
    if current != offset {
        return Err(format!(
            "PROJECT_IMPORT_INTERRUPTED: 素材分块偏移不匹配，期望 {current}，收到 {offset}"
        ));
    }
    let mut file = fs::OpenOptions::new()
        .append(true)
        .open(&path)
        .map_err(|error| format!("无法打开素材暂存文件：{error}"))?;
    file.write_all(&chunk_bytes)
        .map_err(|error| format!("无法写入素材暂存分块：{error}"))?;
    Ok(current.saturating_add(chunk_bytes.len() as u64))
}

#[tauri::command]
fn cleanup_project_bundle_asset_upload(
    app: tauri::AppHandle,
    upload_id: String,
) -> Result<(), String> {
    let path = project_bundle_upload_path(&app, &upload_id)?;
    fs::remove_file(&path)
        .or_else(|error| {
            if error.kind() == io::ErrorKind::NotFound {
                Ok(())
            } else {
                Err(error)
            }
        })
        .map_err(|error| format!("无法清理素材暂存文件：{error}"))
}

fn next_project_bundle_path(output_dir: &Path, requested_name: &str) -> Result<PathBuf, String> {
    let mut output_path = output_dir.join(requested_name);
    let stem = requested_name.trim_end_matches(".vnproj");
    for sequence in 1.. {
        if !output_path.exists() { return Ok(output_path); }
        output_path = output_dir.join(format!("{stem}-{sequence}.vnproj"));
        if sequence >= 10_000 {
            return Err("PROJECT_EXPORT_NAME_COLLISION: 保存目录中同名工程包过多，请重新选择目录。".to_string());
        }
    }
    unreachable!()
}

#[tauri::command]
fn write_project_bundle(
    app: tauri::AppHandle,
    file_name: String,
    output_directory: Option<String>,
    project_json: String,
    assets: Vec<ProjectBundleAssetSource>,
) -> Result<ProjectBundleWriteResult, String> {
    let output_dir = match output_directory {
        Some(directory) if !directory.trim().is_empty() => {
            let candidate = PathBuf::from(directory.trim());
            if !candidate.is_absolute() || !candidate.is_dir() {
                return Err(format!("PROJECT_EXPORT_DIRECTORY_INVALID: 工程保存目录不存在或不是绝对目录：{}。请在项目设置中重新选择。", candidate.display()));
            }
            candidate.canonicalize().map_err(|error| format!(
                "PROJECT_EXPORT_DIRECTORY_INVALID: 无法访问工程保存目录 {}：{error}。请在项目设置中重新选择。",
                candidate.display()
            ))?
        }
        _ => {
            let default = app.path().download_dir().map_err(|error| format!(
                "PROJECT_EXPORT_DIRECTORY_INVALID: 无法定位系统下载目录：{error}。请在选项的项目设置中选择本工程的保存目录。"
            ))?;
            fs::create_dir_all(&default)
                .map_err(|error| directory_write_error(&default, "创建系统下载目录", error))?;
            default
        }
    };
    let safe_name = file_name
        .replace(['\\', '/', ':', '*', '?', '"', '<', '>', '|'], "_")
        .trim()
        .to_string();
    let requested_name = if safe_name.ends_with(".vnproj") {
        safe_name
    } else {
        format!("{safe_name}.vnproj")
    };
    let output_path = next_project_bundle_path(&output_dir, &requested_name)?;
    let temporary_path = output_path.with_extension("vnproj.tmp");
    let upload_root = project_bundle_upload_dir(&app)?
        .canonicalize()
        .map_err(|error| format!("无法规范化工程包暂存目录：{error}"))?;
    let mut temporary_sources = Vec::new();
    let write_result = (|| -> Result<(u64, usize), String> {
        let mut project: serde_json::Value = serde_json::from_str(&project_json)
            .map_err(|error| format!("PROJECT_CONTAINER_INVALID: project.json 无效：{error}"))?;
        let manifest = project
            .get_mut("asset_manifest")
            .and_then(serde_json::Value::as_array_mut)
            .ok_or_else(|| "PROJECT_CONTAINER_INVALID: asset_manifest 无效".to_string())?;
        let mut manifest_paths = HashSet::new();
        for item in manifest.iter() {
            let project_path = item
                .get("metadata")
                .and_then(|value| value.get("project_path"))
                .and_then(serde_json::Value::as_str)
                .ok_or_else(|| "PROJECT_ASSET_MISSING: 素材缺少 project_path".to_string())?;
            if !manifest_paths.insert(project_path.to_string()) {
                return Err(format!(
                    "PROJECT_ZIP_PATH_UNSAFE: duplicate entry {project_path}"
                ));
            }
        }
        if manifest_paths.len() != assets.len() {
            return Err("PROJECT_ASSET_MISSING: 素材清单与写入来源数量不一致".to_string());
        }

        let file = project_bundle_output::create_temporary(&output_dir, &temporary_path)?;
        let mut zip = ZipWriter::new(file);
        let json_options = SimpleFileOptions::default()
            .compression_method(CompressionMethod::Deflated)
            .large_file(true);
        let asset_options = SimpleFileOptions::default()
            .compression_method(CompressionMethod::Stored)
            .large_file(true);
        let mut seen_paths = HashSet::new();
        let mut integrity = HashMap::<String, (u64, String)>::new();
        let mut total_bytes = 0_u64;
        for asset in &assets {
            if asset.zip_path.starts_with('/')
                || asset.zip_path.contains('\\')
                || asset.zip_path.contains('\0')
                || asset.zip_path.split('/').any(|part| part == "..")
                || !asset.zip_path.starts_with("assets/")
            {
                return Err(format!("PROJECT_ZIP_PATH_UNSAFE: {}", asset.zip_path));
            }
            if !seen_paths.insert(asset.zip_path.clone()) {
                return Err(format!(
                    "PROJECT_ZIP_PATH_UNSAFE: duplicate entry {}",
                    asset.zip_path
                ));
            }
            if !manifest_paths.contains(&asset.zip_path) {
                return Err(format!("PROJECT_ASSET_MISSING: {}", asset.zip_path));
            }
            let source = PathBuf::from(&asset.file_path);
            if asset.temporary {
                let canonical = source
                    .canonicalize()
                    .map_err(|error| format!("无法规范化素材暂存路径：{error}"))?;
                canonical.strip_prefix(&upload_root).map_err(|_| {
                    "PROJECT_ZIP_PATH_UNSAFE: temporary asset escaped cache".to_string()
                })?;
                if canonical.parent() != Some(upload_root.as_path()) {
                    return Err("PROJECT_ZIP_PATH_UNSAFE: nested temporary asset path".to_string());
                }
                temporary_sources.push(canonical);
            }
            let mut input = File::open(&source)
                .map_err(|error| format!("无法读取素材 {}：{error}", source.display()))?;
            zip.start_file(&asset.zip_path, asset_options)
                .map_err(|error| directory_write_error(&output_dir, &format!("写入素材条目 {}", asset.zip_path), error))?;
            let mut hasher = Sha256::new();
            let mut copied = 0_u64;
            let mut buffer = vec![0_u8; 1024 * 1024];
            loop {
                let count = input
                    .read(&mut buffer)
                    .map_err(|error| format!("读取素材 {} 失败：{error}", source.display()))?;
                if count == 0 {
                    break;
                }
                zip.write_all(&buffer[..count])
                    .map_err(|error| directory_write_error(&output_dir, &format!("写入素材内容 {}", asset.zip_path), error))?;
                hasher.update(&buffer[..count]);
                copied = copied.saturating_add(count as u64);
            }
            total_bytes = total_bytes.saturating_add(copied);
            integrity.insert(
                asset.zip_path.clone(),
                (copied, hex::encode(hasher.finalize())),
            );
        }

        for item in manifest.iter_mut() {
            let metadata = item
                .get_mut("metadata")
                .and_then(serde_json::Value::as_object_mut)
                .ok_or_else(|| "PROJECT_CONTAINER_INVALID: 素材 metadata 无效".to_string())?;
            let project_path = metadata
                .get("project_path")
                .and_then(serde_json::Value::as_str)
                .ok_or_else(|| "PROJECT_ASSET_MISSING: 素材缺少 project_path".to_string())?
                .to_string();
            let (size, hash) = integrity
                .get(&project_path)
                .ok_or_else(|| format!("PROJECT_ASSET_MISSING: {project_path}"))?;
            metadata.insert("path".to_string(), serde_json::Value::String(project_path));
            metadata.insert("size_bytes".to_string(), serde_json::Value::from(*size));
            metadata.insert(
                "hash_sha256".to_string(),
                serde_json::Value::String(hash.clone()),
            );
            for key in [
                "data_url",
                "blob_url",
                "filePath",
                "url",
                "backend_asset_path",
            ] {
                metadata.remove(key);
            }
        }
        let normalized_project = serde_json::to_string_pretty(&project)
            .map_err(|error| format!("无法生成 project.json：{error}"))?;
        let project_hash = hex::encode(Sha256::digest(normalized_project.as_bytes()));
        zip.start_file("project.json", json_options)
            .map_err(|error| directory_write_error(&output_dir, "创建 project.json 条目", error))?;
        zip.write_all(normalized_project.as_bytes())
            .map_err(|error| directory_write_error(&output_dir, "写入 project.json", error))?;

        let mut asset_integrity = integrity
            .iter()
            .map(|(path, (size, hash))| {
                serde_json::json!({
                    "path": path,
                    "sizeBytes": size,
                    "hashSha256": hash
                })
            })
            .collect::<Vec<_>>();
        asset_integrity.sort_by(|left, right| {
            left["path"]
                .as_str()
                .unwrap_or_default()
                .cmp(right["path"].as_str().unwrap_or_default())
        });
        zip.start_file("format.json", json_options)
            .map_err(|error| directory_write_error(&output_dir, "创建 format.json 条目", error))?;
        let format = serde_json::json!({
            "format": "agentvn-vnproj-zip",
            "version": 1,
            "assetCount": assets.len(),
            "totalAssetBytes": total_bytes,
            "projectHashSha256": project_hash,
            "assets": asset_integrity
        });
        zip.write_all(
            serde_json::to_string_pretty(&format)
                .map_err(|error| format!("无法生成 format.json：{error}"))?
                .as_bytes(),
        )
        .map_err(|error| directory_write_error(&output_dir, "写入 format.json", error))?;
        let output = zip
            .finish()
            .map_err(|error| directory_write_error(&output_dir, "封存工程包", error))?;
        output
            .sync_all()
            .map_err(|error| directory_write_error(&output_dir, "工程包刷盘", error))?;
        Ok((total_bytes, assets.len()))
    })();
    for source in &temporary_sources {
        let _ = fs::remove_file(source);
    }
    let (total_bytes, asset_count) = match write_result {
        Ok(value) => value,
        Err(error) => {
            let _ = fs::remove_file(&temporary_path);
            return Err(error);
        }
    };
    #[cfg(target_os = "windows")]
    {
        use windows_sys::Win32::Storage::FileSystem::{
            MoveFileExW, MOVEFILE_WRITE_THROUGH,
        };
        let source = wide_null(&temporary_path);
        let destination = wide_null(&output_path);
        let moved = unsafe {
            MoveFileExW(
                source.as_ptr(),
                destination.as_ptr(),
                MOVEFILE_WRITE_THROUGH,
            )
        };
        if moved == 0 {
            let error = io::Error::last_os_error();
            let _ = fs::remove_file(&temporary_path);
            return Err(directory_write_error(&output_dir,
                &format!("原子提交工程包 {}", output_path.display()), error));
        }
    }
    #[cfg(not(target_os = "windows"))]
    fs::hard_link(&temporary_path, &output_path).map_err(|error| {
        let _ = fs::remove_file(&temporary_path);
        directory_write_error(&output_dir, &format!("原子提交工程包 {}", output_path.display()), error)
    })?;
    #[cfg(not(target_os = "windows"))]
    fs::remove_file(&temporary_path).map_err(|error| format!("已保存工程包，但无法清理暂存文件：{error}"))?;
    Ok(ProjectBundleWriteResult {
        output_path: output_path.to_string_lossy().to_string(),
        asset_count,
        total_bytes,
    })
}

#[tauri::command]
async fn select_package_output_dir(app: tauri::AppHandle) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_title("选择软件包导出目录")
            .blocking_pick_folder()
            .map(|path| {
                path.into_path()
                    .map(|value| value.to_string_lossy().to_string())
                    .map_err(|error| format!("Failed to resolve selected output folder: {error}"))
            })
            .transpose()
    })
    .await
    .map_err(|error| format!("Failed to open output folder picker: {error}"))?
}

#[tauri::command]
async fn select_project_export_dir(app: tauri::AppHandle) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_title("选择当前工程的 .vnproj 保存目录")
            .blocking_pick_folder()
            .map(|path| path.into_path()
                .map(|value| value.to_string_lossy().to_string())
                .map_err(|error| format!("无法读取所选工程目录：{error}")))
            .transpose()
    })
    .await
    .map_err(|error| format!("无法打开工程目录选择器：{error}"))?
}

#[tauri::command]
async fn select_project_import_file(app: tauri::AppHandle) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let selected = app
            .dialog()
            .file()
            .set_title("选择 AgentVN 工程文件")
            .blocking_pick_file();
        let Some(selected) = selected else {
            return Ok(None);
        };
        let source_path = selected
            .into_path()
            .map_err(|error| format!("Failed to resolve selected project file: {error}"))?;
        let extension = source_path
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase();
        if !matches!(extension.as_str(), "vnproj" | "json") {
            return Err("请选择 .vnproj 或 .json 工程文件。".to_string());
        }
        let metadata = fs::metadata(&source_path).map_err(|error| {
            format!(
                "Failed to inspect selected project file {}: {error}",
                source_path.display()
            )
        })?;
        if !metadata.is_file() {
            return Err("选择的工程路径不是文件。".to_string());
        }
        let created_at = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        let token = format!(
            "ticket_{}_{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        );
        let ticket = serde_json::json!({
            "path": source_path.to_string_lossy().to_string(),
            "size_bytes": metadata.len(),
            "created_at": created_at,
        });
        let ticket_bytes = serde_json::to_vec(&ticket)
            .map_err(|error| format!("Failed to encode project import ticket: {error}"))?;
        let mut ticket_dirs = vec![editor_app_data_dir(&app)
            .join("backend")
            .join("project-import-tickets")];
        if let Some(workspace_root) = find_workspace_root() {
            let workspace_ticket_dir = workspace_root
                .join("backend")
                .join("data")
                .join("project-import-tickets");
            if !ticket_dirs.contains(&workspace_ticket_dir) {
                ticket_dirs.push(workspace_ticket_dir);
            }
        }
        let mut written_tickets = 0;
        let mut write_errors = Vec::new();
        for ticket_dir in ticket_dirs {
            if let Err(error) = fs::create_dir_all(&ticket_dir) {
                write_errors.push(format!("{}: {error}", ticket_dir.display()));
                continue;
            }
            if let Ok(entries) = fs::read_dir(&ticket_dir) {
                for entry in entries.flatten() {
                    let stale = entry
                        .metadata()
                        .ok()
                        .and_then(|value| value.modified().ok())
                        .and_then(|value| value.elapsed().ok())
                        .is_some_and(|elapsed| elapsed > Duration::from_secs(60 * 60));
                    if stale {
                        let _ = fs::remove_file(entry.path());
                    }
                }
            }
            let ticket_path = ticket_dir.join(format!("{token}.json"));
            match fs::write(&ticket_path, &ticket_bytes) {
                Ok(()) => written_tickets += 1,
                Err(error) => write_errors.push(format!("{}: {error}", ticket_path.display())),
            }
        }
        if written_tickets == 0 {
            return Err(format!(
                "Failed to write project import ticket: {}",
                write_errors.join("; ")
            ));
        }
        Ok(Some(token))
    })
    .await
    .map_err(|error| format!("Failed to open project file picker: {error}"))?
}

#[tauri::command]
fn get_native_capabilities() -> Vec<String> {
    vec![
        "project-import-ticket-v1".to_string(),
        format!(
            "backend-base-url=http://127.0.0.1:{}",
            ACTIVE_BACKEND_PORT.load(Ordering::Relaxed)
        ),
    ]
}

fn safe_package_file_name(value: &str) -> String {
    let source = if value.ends_with(".vncart") {
        value
    } else {
        "game.vncart"
    };
    let mut safe = String::new();
    for ch in source.chars() {
        if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.') {
            safe.push(ch);
        }
    }
    if safe.ends_with(".vncart") && !safe.trim_matches('.').is_empty() {
        safe
    } else {
        "game.vncart".to_string()
    }
}

fn safe_package_icon_file_name(value: Option<String>) -> String {
    let source = value
        .as_deref()
        .filter(|item| !item.trim().is_empty())
        .unwrap_or("standalone-icon.png");
    let mut safe = String::new();
    for ch in source.chars() {
        if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.') {
            safe.push(ch);
        }
    }
    if safe.trim_matches('.').is_empty() {
        return "standalone-icon.png".to_string();
    }
    let lower = safe.to_ascii_lowercase();
    if lower.ends_with(".png")
        || lower.ends_with(".jpg")
        || lower.ends_with(".jpeg")
        || lower.ends_with(".bmp")
        || lower.ends_with(".gif")
        || lower.ends_with(".ico")
    {
        safe
    } else {
        format!("{safe}.png")
    }
}

fn standalone_package_uploads_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_cache_dir()
        .map_err(|error| format!("Failed to locate package upload cache dir: {error}"))?
        .join("standalone-package")
        .join("uploads"))
}

fn validate_standalone_package_upload_id(upload_id: &str) -> Result<(), String> {
    if upload_id.trim().is_empty()
        || upload_id.contains("..")
        || upload_id
            .chars()
            .any(|ch| !ch.is_ascii_alphanumeric() && ch != '-')
    {
        return Err("Invalid standalone package upload id.".to_string());
    }
    Ok(())
}

fn append_standalone_package_upload_file(
    upload: &mut StandalonePackageUploadFile,
    offset_bytes: u64,
    chunk_bytes: &[u8],
) -> Result<u64, String> {
    if offset_bytes != upload.written_bytes {
        return Err(format!(
            "Standalone package upload offset mismatch: expected {}, got {}.",
            upload.written_bytes, offset_bytes
        ));
    }
    let actual_before = fs::metadata(&upload.path)
        .map_err(|error| {
            format!(
                "Failed to stat standalone package upload {}: {error}",
                upload.path.display()
            )
        })?
        .len();
    if actual_before != upload.written_bytes {
        return Err(format!(
            "Standalone package upload length mismatch before append: file has {} bytes, expected {}.",
            actual_before, upload.written_bytes
        ));
    }
    let next_size = upload
        .written_bytes
        .checked_add(chunk_bytes.len() as u64)
        .ok_or_else(|| "Standalone package upload size overflow.".to_string())?;
    if next_size > upload.expected_size {
        return Err(format!(
            "Standalone package upload exceeds expected size: {} > {} bytes.",
            next_size, upload.expected_size
        ));
    }
    let mut file = fs::OpenOptions::new()
        .append(true)
        .open(&upload.path)
        .map_err(|error| {
            format!(
                "Failed to open standalone package upload {}: {error}",
                upload.path.display()
            )
        })?;
    file.write_all(chunk_bytes).map_err(|error| {
        format!(
            "Failed to append standalone package upload {}: {error}",
            upload.path.display()
        )
    })?;
    file.flush().map_err(|error| {
        format!(
            "Failed to flush standalone package upload {}: {error}",
            upload.path.display()
        )
    })?;
    let actual_after = fs::metadata(&upload.path)
        .map_err(|error| {
            format!(
                "Failed to verify standalone package upload {}: {error}",
                upload.path.display()
            )
        })?
        .len();
    if actual_after != next_size {
        return Err(format!(
            "Standalone package upload write verification failed: file has {} bytes, expected {}.",
            actual_after, next_size
        ));
    }
    upload.written_bytes = next_size;
    Ok(upload.written_bytes)
}

fn validate_standalone_package_upload_file(
    upload: &StandalonePackageUploadFile,
) -> Result<(), String> {
    let actual_size = fs::metadata(&upload.path)
        .map_err(|error| {
            format!(
                "Failed to stat completed standalone package upload {}: {error}",
                upload.path.display()
            )
        })?
        .len();
    if upload.written_bytes != upload.expected_size || actual_size != upload.expected_size {
        return Err(format!(
            "Standalone package upload is incomplete: received {} acknowledged / {} on disk / {} expected bytes.",
            upload.written_bytes, actual_size, upload.expected_size
        ));
    }
    Ok(())
}

fn standalone_package_upload_file_mut<'a>(
    session: &'a mut StandalonePackageUploadSession,
    file_kind: &str,
) -> Result<&'a mut StandalonePackageUploadFile, String> {
    match file_kind {
        "cartridge" => Ok(&mut session.cartridge),
        "icon" => session
            .icon
            .as_mut()
            .ok_or_else(|| "Standalone package upload has no icon file.".to_string()),
        _ => Err("Invalid standalone package upload file kind.".to_string()),
    }
}

fn cleanup_standalone_package_upload_session(
    session: StandalonePackageUploadSession,
) -> Result<(), String> {
    remove_path_if_exists(&session.root_dir)
}

fn cleanup_active_standalone_package_upload(
    app: &tauri::AppHandle,
    state: &DevProcesses,
) -> Result<(), String> {
    if let Some(session) = state
        .standalone_package_upload
        .lock()
        .map_err(|_| "Standalone package upload lock is poisoned.".to_string())?
        .take()
    {
        cleanup_standalone_package_upload_session(session)?;
    }
    remove_path_if_exists(&standalone_package_uploads_dir(app)?)
}

#[tauri::command]
fn begin_standalone_package_upload(
    app: tauri::AppHandle,
    state: tauri::State<'_, DevProcesses>,
    file_name: String,
    expected_size: u64,
    icon_file_name: Option<String>,
    expected_icon_size: Option<u64>,
) -> Result<StandalonePackageUploadBegin, String> {
    if expected_size == 0 {
        return Err("Standalone package cartridge upload cannot be empty.".to_string());
    }
    if icon_file_name.is_some() != expected_icon_size.is_some() {
        return Err(
            "Standalone package icon file name and expected size must be provided together."
                .to_string(),
        );
    }
    cleanup_active_standalone_package_upload(&app, state.inner())?;
    let uploads_dir = standalone_package_uploads_dir(&app)?;
    fs::create_dir_all(&uploads_dir).map_err(|error| {
        format!(
            "Failed to create standalone package uploads directory {}: {error}",
            uploads_dir.display()
        )
    })?;
    let upload_id = format!("standalone-upload-{}", error_report_timestamp());
    validate_standalone_package_upload_id(&upload_id)?;
    let root_dir = uploads_dir.join(&upload_id);
    fs::create_dir_all(&root_dir).map_err(|error| {
        format!(
            "Failed to create standalone package upload directory {}: {error}",
            root_dir.display()
        )
    })?;
    let cartridge_path = root_dir.join(safe_package_file_name(&file_name));
    fs::File::create(&cartridge_path).map_err(|error| {
        format!(
            "Failed to create standalone package cartridge upload {}: {error}",
            cartridge_path.display()
        )
    })?;
    let icon = if let Some(expected_icon_size) = expected_icon_size {
        let icon_path = root_dir.join(safe_package_icon_file_name(icon_file_name));
        fs::File::create(&icon_path).map_err(|error| {
            format!(
                "Failed to create standalone package icon upload {}: {error}",
                icon_path.display()
            )
        })?;
        Some(StandalonePackageUploadFile {
            path: icon_path,
            expected_size: expected_icon_size,
            written_bytes: 0,
        })
    } else {
        None
    };
    let session = StandalonePackageUploadSession {
        upload_id: upload_id.clone(),
        root_dir,
        cartridge: StandalonePackageUploadFile {
            path: cartridge_path,
            expected_size,
            written_bytes: 0,
        },
        icon,
    };
    *state
        .standalone_package_upload
        .lock()
        .map_err(|_| "Standalone package upload lock is poisoned.".to_string())? = Some(session);
    Ok(StandalonePackageUploadBegin { upload_id })
}

#[tauri::command]
fn append_standalone_package_upload_chunk(
    state: tauri::State<'_, DevProcesses>,
    upload_id: String,
    file_kind: String,
    offset_bytes: u64,
    chunk_bytes: Vec<u8>,
) -> Result<StandalonePackageUploadAppendResult, String> {
    validate_standalone_package_upload_id(&upload_id)?;
    if chunk_bytes.is_empty() {
        return Err("Standalone package upload chunk cannot be empty.".to_string());
    }
    let mut guard = state
        .standalone_package_upload
        .lock()
        .map_err(|_| "Standalone package upload lock is poisoned.".to_string())?;
    let session = guard
        .as_mut()
        .ok_or_else(|| "Standalone package upload was not initialized.".to_string())?;
    if session.upload_id != upload_id {
        return Err("Standalone package upload id does not match the active upload.".to_string());
    }
    let upload = standalone_package_upload_file_mut(session, &file_kind)?;
    let written_bytes = append_standalone_package_upload_file(upload, offset_bytes, &chunk_bytes)?;
    Ok(StandalonePackageUploadAppendResult { written_bytes })
}

#[tauri::command]
fn abort_standalone_package_upload(
    state: tauri::State<'_, DevProcesses>,
    upload_id: String,
) -> Result<(), String> {
    validate_standalone_package_upload_id(&upload_id)?;
    let session = {
        let mut guard = state
            .standalone_package_upload
            .lock()
            .map_err(|_| "Standalone package upload lock is poisoned.".to_string())?;
        let active = guard
            .as_ref()
            .ok_or_else(|| "Standalone package upload was not initialized.".to_string())?;
        if active.upload_id != upload_id {
            return Err(
                "Standalone package upload id does not match the active upload.".to_string(),
            );
        }
        guard
            .take()
            .expect("active upload disappeared while locked")
    };
    cleanup_standalone_package_upload_session(session)
}

fn package_build_result(
    status: &str,
    message: String,
    artifacts: Vec<PackageBuildArtifact>,
    warnings: Vec<String>,
    verify_report_path: &Path,
    build_log_path: &Path,
    manifest_path: &Path,
) -> StandalonePackageBuildResult {
    StandalonePackageBuildResult {
        ok: status == "PASS",
        status: status.to_string(),
        message,
        artifacts,
        warnings,
        verify_report_path: verify_report_path.to_string_lossy().to_string(),
        build_log_path: build_log_path.to_string_lossy().to_string(),
        manifest_path: manifest_path.to_string_lossy().to_string(),
        diagnostics_dir: manifest_path
            .parent()
            .unwrap_or_else(|| Path::new(""))
            .to_string_lossy()
            .to_string(),
        diagnostics_archive_path: String::new(),
        failure_code: None,
        permission_details: None,
        release_identity: None,
        icon_source: None,
        audio_normalization: None,
        post_build_inspection: None,
    }
}

fn read_script_manifest(
    manifest_path: &Path,
    fallback_verify_report_path: &Path,
    fallback_build_log_path: &Path,
) -> Option<StandalonePackageBuildResult> {
    let raw = fs::read_to_string(manifest_path).ok()?;
    let value: serde_json::Value = serde_json::from_str(raw.trim_start_matches('\u{feff}')).ok()?;
    let artifacts = value
        .get("artifacts")
        .and_then(|item| item.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    Some(PackageBuildArtifact {
                        kind: item.get("kind")?.as_str()?.to_string(),
                        path: item.get("path")?.as_str()?.to_string(),
                        bytes: item.get("bytes").and_then(|value| value.as_u64()),
                    })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let warnings = value
        .get("warnings")
        .and_then(|item| item.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str().map(ToString::to_string))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let verify_report_path = value
        .get("verifyReportPath")
        .and_then(|item| item.as_str())
        .map(PathBuf::from)
        .unwrap_or_else(|| fallback_verify_report_path.to_path_buf());
    let build_log_path = value
        .get("buildLogPath")
        .and_then(|item| item.as_str())
        .map(PathBuf::from)
        .unwrap_or_else(|| fallback_build_log_path.to_path_buf());
    let status = value
        .get("status")
        .and_then(|item| item.as_str())
        .unwrap_or("FAIL");
    let message = value
        .get("message")
        .and_then(|item| item.as_str())
        .unwrap_or("Standalone package build finished without a message.")
        .to_string();

    let mut result = package_build_result(
        status,
        message,
        artifacts,
        warnings,
        &verify_report_path,
        &build_log_path,
        manifest_path,
    );
    result.failure_code = value
        .get("failureCode")
        .and_then(|item| item.as_str())
        .map(ToString::to_string);
    result.permission_details = value.get("permissionDetails").cloned();
    result.release_identity = value.get("releaseIdentity").cloned();
    result.icon_source = value
        .get("iconSource")
        .and_then(|item| item.as_str())
        .map(ToString::to_string);
    result.audio_normalization = value.get("audioNormalization").cloned();
    result.post_build_inspection = value.get("postBuildInspection").cloned();
    Some(result)
}

fn powershell_command() -> &'static str {
    if cfg!(target_os = "windows") {
        "powershell.exe"
    } else {
        "pwsh"
    }
}

fn shell_display_path(path: &Path) -> String {
    let value = path.to_string_lossy().to_string();
    if let Some(rest) = value.strip_prefix(r"\\?\UNC\") {
        return format!(r"\\{rest}");
    }
    if let Some(rest) = value.strip_prefix(r"\\?\") {
        return rest.to_string();
    }
    value
}

fn write_json_atomic<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("JSON path has no parent: {}", path.display()))?;
    fs::create_dir_all(parent).map_err(|error| {
        format!(
            "Failed to create JSON parent directory {}: {error}",
            parent.display()
        )
    })?;
    let temporary = parent.join(format!(
        ".{}.tmp-{}-{}",
        path.file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("agentvn-json"),
        std::process::id(),
        error_report_timestamp()
    ));
    let bytes = serde_json::to_vec_pretty(value)
        .map_err(|error| format!("Failed to encode UTF-8 JSON {}: {error}", path.display()))?;
    let mut file = File::create(&temporary).map_err(|error| {
        format!(
            "Failed to create temporary JSON {}: {error}",
            temporary.display()
        )
    })?;
    file.write_all(&bytes)
        .and_then(|_| file.write_all(b"\n"))
        .and_then(|_| file.sync_all())
        .map_err(|error| {
            format!(
                "Failed to write UTF-8 JSON {}: {error}",
                temporary.display()
            )
        })?;

    #[cfg(target_os = "windows")]
    {
        use windows_sys::Win32::Storage::FileSystem::{
            MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
        };
        let source = wide_null(&temporary);
        let destination = wide_null(path);
        let moved = unsafe {
            MoveFileExW(
                source.as_ptr(),
                destination.as_ptr(),
                MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
            )
        };
        if moved == 0 {
            let error = io::Error::last_os_error();
            let _ = fs::remove_file(&temporary);
            return Err(format!(
                "Failed to publish JSON {} atomically: {error}",
                path.display()
            ));
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        fs::rename(&temporary, path).map_err(|error| {
            let _ = fs::remove_file(&temporary);
            format!(
                "Failed to publish JSON {} atomically: {error}",
                path.display()
            )
        })?;
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn wide_null(value: impl AsRef<std::ffi::OsStr>) -> Vec<u16> {
    value.as_ref().encode_wide().chain(Some(0)).collect()
}

#[cfg(target_os = "windows")]
fn windows_process_is_elevated() -> bool {
    use windows_sys::Win32::{
        Foundation::CloseHandle,
        Security::{GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY},
        System::Threading::{GetCurrentProcess, OpenProcessToken},
    };
    unsafe {
        let mut token = std::ptr::null_mut();
        if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) == 0 {
            return false;
        }
        let mut elevation = TOKEN_ELEVATION::default();
        let mut returned = 0u32;
        let ok = GetTokenInformation(
            token,
            TokenElevation,
            (&mut elevation as *mut TOKEN_ELEVATION).cast(),
            std::mem::size_of::<TOKEN_ELEVATION>() as u32,
            &mut returned,
        ) != 0;
        let _ = CloseHandle(token);
        ok && elevation.TokenIsElevated != 0
    }
}

#[cfg(not(target_os = "windows"))]
fn windows_process_is_elevated() -> bool {
    false
}

#[cfg(target_os = "windows")]
fn windows_version_number() -> String {
    use windows_sys::Win32::System::SystemInformation::{GetVersionExW, OSVERSIONINFOW};
    let mut version = OSVERSIONINFOW::default();
    version.dwOSVersionInfoSize = std::mem::size_of::<OSVERSIONINFOW>() as u32;
    if unsafe { GetVersionExW(&mut version) } == 0 {
        return String::new();
    }
    format!(
        "{}.{}.{}",
        version.dwMajorVersion, version.dwMinorVersion, version.dwBuildNumber
    )
}

#[cfg(not(target_os = "windows"))]
fn windows_version_number() -> String {
    std::env::consts::OS.to_string()
}

#[cfg(target_os = "windows")]
fn windows_developer_mode_enabled() -> bool {
    use windows_sys::Win32::System::Registry::{
        RegGetValueW, HKEY_LOCAL_MACHINE, RRF_RT_REG_DWORD,
    };
    let subkey = wide_null(r"SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock");
    let value_name = wide_null("AllowDevelopmentWithoutDevLicense");
    let mut value = 0u32;
    let mut size = std::mem::size_of::<u32>() as u32;
    unsafe {
        RegGetValueW(
            HKEY_LOCAL_MACHINE,
            subkey.as_ptr(),
            value_name.as_ptr(),
            RRF_RT_REG_DWORD,
            std::ptr::null_mut(),
            (&mut value as *mut u32).cast(),
            &mut size,
        ) == 0
            && value == 1
    }
}

#[cfg(not(target_os = "windows"))]
fn windows_developer_mode_enabled() -> bool {
    false
}

#[cfg(target_os = "windows")]
fn windows_symbolic_link_privilege_state() -> (bool, bool, Option<String>) {
    use windows_sys::Win32::{
        Foundation::{CloseHandle, LUID},
        Security::{
            GetTokenInformation, LookupPrivilegeValueW, TokenPrivileges, LUID_AND_ATTRIBUTES,
            SE_PRIVILEGE_ENABLED, TOKEN_PRIVILEGES, TOKEN_QUERY,
        },
        System::Threading::{GetCurrentProcess, OpenProcessToken},
    };

    unsafe {
        let mut token = std::ptr::null_mut();
        if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) == 0 {
            return (
                false,
                false,
                Some(format!(
                    "OpenProcessToken failed with Win32 error {}",
                    io::Error::last_os_error()
                        .raw_os_error()
                        .unwrap_or_default()
                )),
            );
        }

        let privilege_name = wide_null("SeCreateSymbolicLinkPrivilege");
        let mut target_luid = LUID::default();
        if LookupPrivilegeValueW(std::ptr::null(), privilege_name.as_ptr(), &mut target_luid) == 0 {
            let failure = io::Error::last_os_error();
            let _ = CloseHandle(token);
            return (
                false,
                false,
                Some(format!(
                    "LookupPrivilegeValueW failed with Win32 error {}",
                    failure.raw_os_error().unwrap_or_default()
                )),
            );
        }

        let mut required = 0u32;
        let _ = GetTokenInformation(
            token,
            TokenPrivileges,
            std::ptr::null_mut(),
            0,
            &mut required,
        );
        if required < std::mem::size_of::<TOKEN_PRIVILEGES>() as u32 {
            let failure = io::Error::last_os_error();
            let _ = CloseHandle(token);
            return (
                false,
                false,
                Some(format!(
                    "GetTokenInformation size query failed with Win32 error {}",
                    failure.raw_os_error().unwrap_or_default()
                )),
            );
        }

        let mut buffer = vec![0u8; required as usize];
        if GetTokenInformation(
            token,
            TokenPrivileges,
            buffer.as_mut_ptr().cast(),
            required,
            &mut required,
        ) == 0
        {
            let failure = io::Error::last_os_error();
            let _ = CloseHandle(token);
            return (
                false,
                false,
                Some(format!(
                    "GetTokenInformation failed with Win32 error {}",
                    failure.raw_os_error().unwrap_or_default()
                )),
            );
        }
        let _ = CloseHandle(token);

        let privileges = buffer.as_ptr().cast::<TOKEN_PRIVILEGES>();
        let count = (*privileges).PrivilegeCount as usize;
        let entries = std::slice::from_raw_parts(
            std::ptr::addr_of!((*privileges).Privileges).cast::<LUID_AND_ATTRIBUTES>(),
            count,
        );
        for entry in entries {
            if entry.Luid.LowPart == target_luid.LowPart
                && entry.Luid.HighPart == target_luid.HighPart
            {
                return (true, entry.Attributes & SE_PRIVILEGE_ENABLED != 0, None);
            }
        }
        (false, false, None)
    }
}

#[cfg(not(target_os = "windows"))]
fn windows_symbolic_link_privilege_state() -> (bool, bool, Option<String>) {
    (false, false, None)
}

#[cfg(target_os = "windows")]
fn probe_android_symlink_capability(probe_root: &Path) -> AndroidSymlinkCapability {
    let mut probe_directory = probe_root.join(format!(
        ".agentvn-symlink-probe-{}-{}",
        std::process::id(),
        error_report_timestamp()
    ));
    let mut source = probe_directory.join("source.txt");
    let mut link = probe_directory.join("link.txt");
    let mut resolved_probe_root = None;
    let mut error = None;
    let mut win32_error_code = None;
    let mut operation = "create-probe-directory";
    let mut failed_operation = None;
    let success = (|| -> io::Result<bool> {
        fs::create_dir_all(&probe_directory)?;
        // Packaged hosts can redirect AppData writes while the kernel follows
        // symlink targets without that redirection. Use physical paths for
        // both ends, not a logical AppData target which does not exist on disk.
        operation = "resolve-probe-directory";
        probe_directory = fs::canonicalize(&probe_directory)?;
        resolved_probe_root = probe_directory.parent().map(|path| path.to_string_lossy().into_owned());
        source = probe_directory.join("source.txt");
        link = probe_directory.join("link.txt");
        operation = "write-probe-source";
        fs::write(&source, "agentvn-symlink-probe")?;
        operation = "create-symbolic-link";
        symlink_file(&source, &link)?;
        operation = "read-symbolic-link";
        if fs::read_to_string(&link)? != "agentvn-symlink-probe" {
            return Err(io::Error::new(io::ErrorKind::InvalidData, "Symbolic-link readback did not match the probe source"));
        }
        Ok(true)
    })()
    .unwrap_or_else(|failure| {
        win32_error_code = failure.raw_os_error();
        failed_operation = Some(operation.to_string());
        error = Some(format!(
            "{operation}: {failure}; source={}; source_readable={}; link_target={:?}",
            source.display(), fs::read_to_string(&source).is_ok(), fs::read_link(&link)
        ));
        false
    });
    let _ = fs::remove_file(&link);
    let _ = fs::remove_file(&source);
    let _ = fs::remove_dir_all(&probe_directory);

    let (privilege_present, privilege_enabled, privilege_query_error) =
        windows_symbolic_link_privilege_state();
    AndroidSymlinkCapability {
        schema_version: 3,
        probe_root: probe_root.to_string_lossy().to_string(),
        resolved_probe_root,
        success,
        win32_error_code,
        error,
        failed_operation,
        windows_build: windows_version_number(),
        checked_at: error_report_timestamp(),
        is_elevated: windows_process_is_elevated(),
        developer_mode_enabled: windows_developer_mode_enabled(),
        symbolic_link_privilege_present: privilege_present,
        symbolic_link_privilege_enabled: privilege_enabled,
        symbolic_link_privilege_query_error: privilege_query_error,
    }
}

#[cfg(not(target_os = "windows"))]
fn probe_android_symlink_capability(probe_root: &Path) -> AndroidSymlinkCapability {
    AndroidSymlinkCapability {
        schema_version: 3,
        probe_root: probe_root.to_string_lossy().to_string(),
        resolved_probe_root: None,
        success: true,
        win32_error_code: None,
        error: None,
        failed_operation: None,
        windows_build: windows_version_number(),
        checked_at: error_report_timestamp(),
        is_elevated: false,
        developer_mode_enabled: false,
        symbolic_link_privilege_present: false,
        symbolic_link_privilege_enabled: false,
        symbolic_link_privilege_query_error: None,
    }
}

fn classify_android_symlink_failure(capability: &AndroidSymlinkCapability) -> Option<&'static str> {
    if capability.success {
        return None;
    }
    if capability.failed_operation.as_deref().is_some_and(|step| step != "create-symbolic-link") {
        return Some("SYMLINK_PROBE_IO_FAILED");
    }
    let permission_failure = capability
        .win32_error_code
        .is_none_or(|code| matches!(code, 5 | 1314));
    if !permission_failure {
        return Some("SYMLINK_UNSUPPORTED");
    }
    if capability.is_elevated {
        return Some("ELEVATED_SYMLINK_DENIED");
    }
    Some("SYMLINK_PRIVILEGE_REQUIRED")
}

#[cfg(target_os = "windows")]
fn android_build_requires_default_elevation(capability: &AndroidSymlinkCapability) -> bool {
    // Android standalone builds run Tauri/Gradle in a workspace that may need
    // symbolic links even when Developer Mode makes a non-elevated probe pass.
    // Require the elevated helper by default so the build does not fail later
    // after spending time preparing the project and assets.
    !capability.is_elevated
}

fn write_elevated_status(
    path: &Path,
    run_id: &str,
    state: &str,
    phase: &str,
    message: &str,
    heartbeat_seq: u64,
    exit_code: Option<i32>,
) -> Result<(), String> {
    write_json_atomic(
        path,
        &ElevatedAndroidBuildStatus {
            schema_version: 2,
            run_id: run_id.to_string(),
            state: state.to_string(),
            phase: phase.to_string(),
            message: message.to_string(),
            updated_at: error_report_timestamp(),
            heartbeat_seq,
            exit_code,
        },
    )
}

fn write_elevated_failure_manifest(
    request: &ElevatedAndroidBuildRequest,
    failure_code: &str,
    message: &str,
    permission_details: Option<&AndroidSymlinkCapability>,
) -> Result<(), String> {
    let manifest_path = request.diagnostics_dir.join("package-build-manifest.json");
    write_json_atomic(
        &manifest_path,
        &serde_json::json!({
            "ok": false,
            "status": "BLOCKED",
            "platform": "android",
            "runId": request.run_id,
            "message": message,
            "outputDir": request.output_dir,
            "diagnosticsDir": request.diagnostics_dir,
            "artifacts": [],
            "warnings": [
                "Windows Developer Mode is optional. The actual symbolic-link capability probe is authoritative."
            ],
            "verifyReportPath": request.diagnostics_dir.join("standalone-android-verify.json"),
            "buildLogPath": request.diagnostics_dir.join("standalone-android-build.log"),
            "manifestPath": manifest_path,
            "failureCode": failure_code,
            "permissionDetails": permission_details,
            "generatedAt": error_report_timestamp()
        }),
    )
}

fn validate_manifest_run_id(manifest_path: &Path, expected_run_id: &str) -> Result<(), String> {
    let raw = fs::read_to_string(manifest_path).map_err(|error| {
        format!(
            "Failed to read Android build manifest {}: {error}",
            manifest_path.display()
        )
    })?;
    let value: serde_json::Value =
        serde_json::from_str(raw.trim_start_matches('\u{feff}')).map_err(|error| {
            format!(
                "Android build manifest is invalid JSON {}: {error}",
                manifest_path.display()
            )
        })?;
    let actual = value
        .get("runId")
        .and_then(|item| item.as_str())
        .unwrap_or_default();
    if actual != expected_run_id {
        return Err(format!(
            "Android build manifest runId mismatch: expected {expected_run_id}, received {}.",
            if actual.is_empty() { "<missing>" } else { actual }
        ));
    }
    Ok(())
}

fn canonical_path_within(path: &Path, parent: &Path, label: &str) -> Result<PathBuf, String> {
    let canonical = fs::canonicalize(path)
        .map_err(|error| format!("Failed to resolve {label} {}: {error}", path.display()))?;
    if canonical != parent && !canonical.starts_with(parent) {
        return Err(format!(
            "{label} escaped the elevated Android build cache: {}",
            canonical.display()
        ));
    }
    Ok(canonical)
}

fn run_elevated_android_build_request(request_path: &Path) -> Result<i32, String> {
    let raw = fs::read_to_string(request_path).map_err(|error| {
        format!(
            "Failed to read elevated Android build request {}: {error}",
            request_path.display()
        )
    })?;
    if raw.contains('\u{fffd}') {
        return Err("Elevated Android build request contains invalid UTF-8.".to_string());
    }
    let mut request: ElevatedAndroidBuildRequest =
        serde_json::from_str(raw.trim_start_matches('\u{feff}')).map_err(|error| {
            format!(
                "Elevated Android build request is invalid JSON {}: {error}",
                request_path.display()
            )
        })?;
    if request.schema_version != 2
        || request.run_id.trim().is_empty()
        || request.run_id.contains('\0')
        || !matches!(
            request.optimization_profile.as_str(),
            "balanced" | "lossless" | "off"
        )
        || !request.release_identity.is_object()
        || !matches!(
            request.icon_source.as_str(),
            "project" | "default" | "fallback"
        )
    {
        return Err("Elevated Android build request contains unsupported values.".to_string());
    }

    let cache = fs::canonicalize(&request.cache_dir).map_err(|error| {
        format!(
            "Failed to resolve elevated Android cache {}: {error}",
            request.cache_dir.display()
        )
    })?;
    canonical_path_within(request_path, &cache, "Request file")?;
    request.run_root = canonical_path_within(&request.run_root, &cache, "Build workspace")?;
    request.diagnostics_dir =
        canonical_path_within(&request.diagnostics_dir, &cache, "Diagnostics directory")?;
    request.cartridge_path =
        canonical_path_within(&request.cartridge_path, &cache, "Cartridge path")?;
    if let Some(icon_path) = request.icon_path.as_ref() {
        request.icon_path = Some(canonical_path_within(icon_path, &cache, "Icon path")?);
    }
    request.runner_path =
        canonical_path_within(&request.runner_path, &request.run_root, "Android runner")?;
    fs::create_dir_all(&request.output_dir).map_err(|error| {
        format!(
            "Failed to create elevated Android output directory {}: {error}",
            request.output_dir.display()
        )
    })?;
    request.output_dir = fs::canonicalize(&request.output_dir).map_err(|error| {
        format!(
            "Failed to resolve elevated Android output directory {}: {error}",
            request.output_dir.display()
        )
    })?;

    let status_path = request.diagnostics_dir.join("android-build-status.json");
    let done_path = request.diagnostics_dir.join("android-build.done");
    let environment_report_path = request.diagnostics_dir.join("android-env-check.json");
    let elevated_probe_path = request
        .diagnostics_dir
        .join("android-symlink-capability-elevated.json");
    let _ = fs::remove_file(&done_path);
    // The parent process may have published a non-elevated environment
    // snapshot before requesting UAC. It is not valid evidence for the
    // elevated helper, so keep the path empty until the authoritative probe
    // has completed.
    let _ = fs::remove_file(&environment_report_path);
    write_elevated_status(
        &status_path,
        &request.run_id,
        "running",
        "symlink-probe",
        "Elevated helper is checking symbolic-link capability.",
        0,
        None,
    )?;
    if !windows_process_is_elevated() {
        let message =
            "The elevated Android helper did not receive an Administrator token.".to_string();
        write_elevated_failure_manifest(&request, "ADMINISTRATOR_REQUIRED", &message, None)?;
        write_elevated_status(
            &status_path,
            &request.run_id,
            "blocked",
            "elevation",
            &message,
            1,
            Some(2),
        )?;
        fs::write(&done_path, b"blocked\n")
            .map_err(|error| format!("Failed to write elevated completion marker: {error}"))?;
        return Ok(2);
    }
    let probe_root = request.run_root.join("GameCli_framework").join("src-tauri");
    let probe = probe_android_symlink_capability(&probe_root);
    write_json_atomic(&elevated_probe_path, &probe)?;
    if !probe.success {
        let message = format!(
            "Administrator elevation did not provide symbolic-link capability in {}. Win32 error: {}. Check account/group policy or filesystem restrictions.",
            probe_root.display(),
            probe
                .win32_error_code
                .map(|value| value.to_string())
                .unwrap_or_else(|| "unknown".to_string())
        );
        write_elevated_failure_manifest(
            &request,
            classify_android_symlink_failure(&probe).unwrap_or("ELEVATED_SYMLINK_DENIED"),
            &message,
            Some(&probe),
        )?;
        write_elevated_status(
            &status_path,
            &request.run_id,
            "blocked",
            "symlink-probe",
            &message,
            1,
            Some(2),
        )?;
        fs::write(&done_path, b"blocked\n")
            .map_err(|error| format!("Failed to write elevated completion marker: {error}"))?;
        return Ok(2);
    }

    let stop_heartbeat = Arc::new(AtomicBool::new(false));
    let heartbeat_stop = Arc::clone(&stop_heartbeat);
    let heartbeat_path = status_path.clone();
    let heartbeat_run_id = request.run_id.clone();
    let heartbeat = std::thread::spawn(move || {
        let mut sequence = 1u64;
        while !heartbeat_stop.load(Ordering::Relaxed) {
            let _ = write_elevated_status(
                &heartbeat_path,
                &heartbeat_run_id,
                "running",
                "android-build",
                "Elevated Android build is running.",
                sequence,
                None,
            );
            sequence = sequence.saturating_add(1);
            for _ in 0..50 {
                if heartbeat_stop.load(Ordering::Relaxed) {
                    return;
                }
                std::thread::sleep(Duration::from_millis(100));
            }
        }
    });

    let helper_log_path = request
        .diagnostics_dir
        .join("standalone-elevated-helper.log");
    let helper_stdout = File::create(&helper_log_path).map_err(|error| {
        format!(
            "Failed to create elevated helper log {}: {error}",
            helper_log_path.display()
        )
    })?;
    let helper_stderr = helper_stdout
        .try_clone()
        .map_err(|error| format!("Failed to clone elevated helper log handle: {error}"))?;
    let node_path = native_windows_tool_candidates("node")
        .into_iter()
        .find(|candidate| candidate.is_file())
        .ok_or_else(|| {
            "ANDROID_RUNNER_START_FAILED: absolute Node.js executable was not found.".to_string()
        })?;
    let runner_path = shell_display_path(&request.runner_path);
    let request_path_value = shell_display_path(request_path);
    let mut command = background_command(node_path);
    command
        // Pass the request through the environment and load the runner with
        // -e. This avoids Windows command-line reparsing of C:\... paths
        // under an elevated token (which previously reduced them to `C:`).
        .args(["-e", "require(process.env.AGENTVN_ANDROID_RUNNER)"])
        .env("AGENTVN_ANDROID_RUNNER", runner_path)
        .env("AGENTVN_ANDROID_BUILD_REQUEST", request_path_value)
        .current_dir(&request.run_root)
        .stdin(Stdio::null())
        .stdout(Stdio::from(helper_stdout))
        .stderr(Stdio::from(helper_stderr));
    if let Some(offline_pack) = resolve_embedded_android_offline_pack() {
        command.env("AGENTVN_ANDROID_OFFLINE_PACK", offline_pack);
    }
    let status = command
        .status()
        .map_err(|error| format!("Failed to start elevated Android Node runner: {error}"));
    stop_heartbeat.store(true, Ordering::Relaxed);
    let _ = heartbeat.join();

    let exit_code = status
        .as_ref()
        .ok()
        .and_then(|value| value.code())
        .unwrap_or(1);
    let manifest_path = request.diagnostics_dir.join("package-build-manifest.json");
    if status.is_err() || !manifest_path.is_file() {
        let (failure_code, message) = match status {
            Err(error) => (
                "ANDROID_RUNNER_START_FAILED",
                format!("Failed to start elevated Android Node runner: {error}"),
            ),
            Ok(_) => (
                "ELEVATED_HELPER_LOST",
                "Elevated Android runner exited without a manifest.".to_string(),
            ),
        };
        write_elevated_failure_manifest(&request, failure_code, &message, Some(&probe))?;
    }
    write_elevated_status(
        &status_path,
        &request.run_id,
        if exit_code == 0 {
            "completed"
        } else {
            "failed"
        },
        "complete",
        if exit_code == 0 {
            "Elevated Android build completed."
        } else {
            "Elevated Android build finished with an error."
        },
        u64::MAX,
        Some(exit_code),
    )?;
    fs::write(&done_path, b"done\n")
        .map_err(|error| format!("Failed to write elevated completion marker: {error}"))?;
    Ok(exit_code)
}

#[cfg(target_os = "windows")]
struct ElevatedProcessHandle(windows_sys::Win32::Foundation::HANDLE);

#[cfg(target_os = "windows")]
impl ElevatedProcessHandle {
    fn has_exited(&self) -> bool {
        use windows_sys::Win32::{
            Foundation::WAIT_OBJECT_0, System::Threading::WaitForSingleObject,
        };
        unsafe { WaitForSingleObject(self.0, 0) == WAIT_OBJECT_0 }
    }

    fn terminate(&self) {
        unsafe {
            let _ = windows_sys::Win32::System::Threading::TerminateProcess(self.0, 1);
        }
    }
}

#[cfg(target_os = "windows")]
impl Drop for ElevatedProcessHandle {
    fn drop(&mut self) {
        unsafe {
            let _ = windows_sys::Win32::Foundation::CloseHandle(self.0);
        }
    }
}

#[cfg(target_os = "windows")]
fn launch_elevated_android_helper(request_path: &Path) -> Result<ElevatedProcessHandle, u32> {
    use windows_sys::Win32::{
        Foundation::GetLastError,
        UI::{
            Shell::{
                ShellExecuteExW, SEE_MASK_NOASYNC, SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW,
            },
            WindowsAndMessaging::SW_HIDE,
        },
    };
    let executable = std::env::current_exe().map_err(|_| 2u32)?;
    let verb = wide_null("runas");
    let file = wide_null(&executable);
    let parameters = wide_null(format!(
        "--agentvn-elevated-android-build --request \"{}\"",
        shell_display_path(request_path).replace('"', r#"\""#)
    ));
    let directory = executable
        .parent()
        .map(wide_null)
        .unwrap_or_else(|| wide_null("."));
    let mut info = SHELLEXECUTEINFOW {
        cbSize: std::mem::size_of::<SHELLEXECUTEINFOW>() as u32,
        fMask: SEE_MASK_NOCLOSEPROCESS | SEE_MASK_NOASYNC,
        lpVerb: verb.as_ptr(),
        lpFile: file.as_ptr(),
        lpParameters: parameters.as_ptr(),
        lpDirectory: directory.as_ptr(),
        nShow: SW_HIDE,
        ..Default::default()
    };
    let launched = unsafe { ShellExecuteExW(&mut info) };
    if launched == 0 {
        return Err(unsafe { GetLastError() });
    }
    if info.hProcess.is_null() {
        return Err(6);
    }
    Ok(ElevatedProcessHandle(info.hProcess))
}

fn emit_package_build_log(
    app: &tauri::AppHandle,
    run_id: &str,
    level: &str,
    source: &str,
    message: impl Into<String>,
) {
    if run_id.trim().is_empty() {
        return;
    }
    let _ = app.emit(
        "agentvn://package-build-log",
        PackageBuildLogEvent {
            run_id: run_id.to_string(),
            level: level.to_string(),
            source: source.to_string(),
            message: message.into(),
            timestamp_ms: u64::try_from(error_report_timestamp()).unwrap_or(u64::MAX),
        },
    );
}

fn emit_package_environment_operation_progress(
    app: Option<&tauri::AppHandle>,
    run_id: &str,
    platform: &str,
    operation: &str,
    phase: &str,
    message: impl Into<String>,
    percent: u8,
) {
    if run_id.trim().is_empty() {
        return;
    }
    let Some(app) = app else {
        return;
    };
    let _ = app.emit(
        "agentvn://package-environment-operation-progress",
        PackageEnvironmentOperationProgressEvent {
            run_id: run_id.to_string(),
            platform: platform.to_string(),
            operation: operation.to_string(),
            phase: phase.to_string(),
            message: message.into(),
            percent,
        },
    );
}

fn emit_android_environment_import_progress(
    app: Option<&tauri::AppHandle>,
    run_id: &str,
    phase: &str,
    message: impl Into<String>,
    percent: u8,
    processed_bytes: u64,
    total_bytes: u64,
    processed_files: usize,
    total_files: usize,
    reclaimed_bytes: u64,
    install_source: &str,
) {
    if run_id.trim().is_empty() {
        return;
    }
    let message = message.into();
    let operation = if install_source == "avnenv" {
        "import"
    } else {
        "install"
    };
    emit_package_environment_operation_progress(
        app,
        run_id,
        "android",
        operation,
        phase,
        message.clone(),
        percent,
    );
    let Some(app) = app else {
        return;
    };
    let _ = app.emit(
        "agentvn://android-env-import-progress",
        AndroidEnvironmentImportProgressEvent {
            run_id: run_id.to_string(),
            phase: phase.to_string(),
            message,
            percent,
            processed_bytes,
            total_bytes,
            processed_files,
            total_files,
            reclaimed_bytes,
            install_source: install_source.to_string(),
        },
    );
}

fn emit_new_log_file_lines(
    app: &tauri::AppHandle,
    run_id: &str,
    path: &Path,
    offset: &mut u64,
    source: &str,
) {
    let mut file = match fs::File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return,
        Err(error) => {
            emit_package_build_log(
                app,
                run_id,
                "warning",
                source,
                format!("Failed to read live log {}: {error}", path.display()),
            );
            return;
        }
    };
    let size = file.metadata().map(|metadata| metadata.len()).unwrap_or(0);
    if size < *offset {
        *offset = 0;
    }
    if size == *offset {
        return;
    }
    if file.seek(SeekFrom::Start(*offset)).is_err() {
        return;
    }
    let mut buffer = Vec::new();
    if file.read_to_end(&mut buffer).is_err() {
        return;
    }
    *offset += buffer.len() as u64;
    let text = strip_ansi_escape_sequences(&String::from_utf8_lossy(&buffer));
    for line in text.lines() {
        let trimmed = line.trim_end();
        if trimmed.trim().is_empty() {
            continue;
        }
        emit_package_build_log(app, run_id, "info", source, trimmed.to_string());
    }
}

fn strip_ansi_escape_sequences(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    let mut characters = value.chars().peekable();
    while let Some(character) = characters.next() {
        if character == '\u{1b}' && characters.peek() == Some(&'[') {
            let _ = characters.next();
            for control in characters.by_ref() {
                if ('@'..='~').contains(&control) {
                    break;
                }
            }
            continue;
        }
        output.push(character);
    }
    output
}

fn write_command_output(path: &Path, output: &std::process::Output) -> Result<(), String> {
    let mut text = String::new();
    text.push_str("== stdout ==\n");
    text.push_str(&strip_ansi_escape_sequences(&String::from_utf8_lossy(
        &output.stdout,
    )));
    text.push_str("\n== stderr ==\n");
    text.push_str(&strip_ansi_escape_sequences(&String::from_utf8_lossy(
        &output.stderr,
    )));
    fs::write(path, text)
        .map_err(|error| format!("Failed to write command log {}: {error}", path.display()))
}

fn add_diagnostics_directory_to_zip(
    writer: &mut ZipWriter<File>,
    root: &Path,
    current: &Path,
) -> Result<(), String> {
    let entries = fs::read_dir(current).map_err(|error| {
        format!(
            "Failed to read diagnostics directory {}: {error}",
            current.display()
        )
    })?;
    for entry in entries {
        let entry = entry.map_err(|error| {
            format!(
                "Failed to enumerate diagnostics directory {}: {error}",
                current.display()
            )
        })?;
        let path = entry.path();
        let file_type = entry.file_type().map_err(|error| {
            format!(
                "Failed to inspect diagnostics entry {}: {error}",
                path.display()
            )
        })?;
        if file_type.is_symlink() {
            continue;
        }
        if file_type.is_dir() {
            add_diagnostics_directory_to_zip(writer, root, &path)?;
            continue;
        }
        if !file_type.is_file() {
            continue;
        }
        let relative = path
            .strip_prefix(root)
            .map_err(|_| format!("Diagnostics entry escaped its root: {}", path.display()))?;
        let zip_name = relative
            .components()
            .map(|component| component.as_os_str().to_string_lossy())
            .collect::<Vec<_>>()
            .join("/");
        if zip_name.is_empty() || zip_name.contains("..") {
            return Err(format!("Unsafe diagnostics archive entry: {zip_name}"));
        }
        writer
            .start_file(
                zip_name,
                SimpleFileOptions::default().compression_method(CompressionMethod::Deflated),
            )
            .map_err(|error| format!("Failed to add diagnostics entry to ZIP: {error}"))?;
        let mut source = File::open(&path).map_err(|error| {
            format!(
                "Failed to open diagnostics file {}: {error}",
                path.display()
            )
        })?;
        io::copy(&mut source, writer).map_err(|error| {
            format!(
                "Failed to archive diagnostics file {}: {error}",
                path.display()
            )
        })?;
    }
    Ok(())
}

fn create_standalone_diagnostics_archive(
    diagnostics_dir: &Path,
    archive_path: &Path,
) -> Result<PathBuf, String> {
    if !diagnostics_dir.is_dir() {
        return Err(format!(
            "Standalone diagnostics directory does not exist: {}",
            diagnostics_dir.display()
        ));
    }
    if let Some(parent) = archive_path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "Failed to create diagnostics archive directory {}: {error}",
                parent.display()
            )
        })?;
    }
    let temporary_path = archive_path.with_extension("zip.tmp");
    let _ = fs::remove_file(&temporary_path);
    let file = File::create(&temporary_path).map_err(|error| {
        format!(
            "Failed to create diagnostics archive {}: {error}",
            temporary_path.display()
        )
    })?;
    let mut writer = ZipWriter::new(file);
    add_diagnostics_directory_to_zip(&mut writer, diagnostics_dir, diagnostics_dir)?;
    writer
        .finish()
        .map_err(|error| format!("Failed to finish diagnostics archive: {error}"))?;
    fs::rename(&temporary_path, archive_path).map_err(|error| {
        let _ = fs::remove_file(&temporary_path);
        format!(
            "Failed to publish diagnostics archive {}: {error}",
            archive_path.display()
        )
    })?;
    Ok(archive_path.to_path_buf())
}

fn persist_standalone_package_failure(
    mut result: StandalonePackageBuildResult,
    diagnostics_dir: &Path,
    archive_path: &Path,
) -> StandalonePackageBuildResult {
    result.diagnostics_dir = diagnostics_dir.to_string_lossy().to_string();
    result.diagnostics_archive_path = archive_path.to_string_lossy().to_string();
    if !result.build_log_path.is_empty() {
        if let Err(error) = append_error_log_line(Path::new(&result.build_log_path), &format!(
            "[{}] {}: {}", error_report_timestamp(),
            result.failure_code.as_deref().unwrap_or("PACKAGE_BUILD_FAILED"), result.message,
        )) {
            result.warnings.push(format!("Failed to preserve build failure log: {error}"));
        }
    }
    let _ = write_json_atomic(Path::new(&result.manifest_path), &result);
    if let Err(error) = create_standalone_diagnostics_archive(diagnostics_dir, archive_path) {
        result.diagnostics_archive_path.clear();
        result
            .warnings
            .push(format!("Failed to create diagnostics ZIP: {error}"));
        let _ = write_json_atomic(Path::new(&result.manifest_path), &result);
    }
    result
}

fn prepare_standalone_cartridge_safely(
    cartridge_path: &Path,
    destination: &Path,
    report_path: &Path,
) -> Result<(), String> {
    let metadata = fs::metadata(cartridge_path).map_err(|error| {
        format!(
            "Failed to inspect standalone cartridge {}: {error}",
            cartridge_path.display()
        )
    })?;
    if !metadata.is_file() {
        return Err(format!(
            "Standalone cartridge is not a regular file: {}",
            cartridge_path.display()
        ));
    }
    if metadata.len() > MAX_STANDALONE_CARTRIDGE_BYTES {
        return Err(format!(
            "Standalone cartridge exceeds the 2 GiB safety limit: {} bytes",
            metadata.len()
        ));
    }

    remove_path_if_exists(destination)?;
    fs::create_dir_all(destination).map_err(|error| {
        format!(
            "Failed to create prepared cartridge directory {}: {error}",
            destination.display()
        )
    })?;
    let destination_root = destination.canonicalize().map_err(|error| {
        format!(
            "Failed to resolve prepared cartridge directory {}: {error}",
            destination.display()
        )
    })?;

    let preparation = (|| -> Result<serde_json::Value, String> {
        let file = File::open(cartridge_path).map_err(|error| {
            format!(
                "Failed to open standalone cartridge {}: {error}",
                cartridge_path.display()
            )
        })?;
        let mut archive = ZipArchive::new(file).map_err(|error| {
            format!(
                "Failed to read standalone cartridge as ZIP {}: {error}",
                cartridge_path.display()
            )
        })?;
        if archive.len() > MAX_STANDALONE_CARTRIDGE_FILES {
            return Err(format!(
                "Standalone cartridge contains too many entries: {} (limit {})",
                archive.len(),
                MAX_STANDALONE_CARTRIDGE_FILES
            ));
        }

        let mut seen = HashSet::new();
        let mut files = 0usize;
        let mut total_unpacked_bytes = 0u64;
        for index in 0..archive.len() {
            let mut entry = archive
                .by_index(index)
                .map_err(|error| format!("Failed to read cartridge ZIP entry {index}: {error}"))?;
            let name = entry.name().to_string();
            let is_dir = entry.is_dir();
            let relative = validate_preview_zip_path(&name, is_dir)?;
            let normalized = relative.to_string_lossy().replace('\\', "/");
            if !seen.insert(normalized.clone()) {
                return Err(format!(
                    "Standalone cartridge contains a duplicate path: {normalized}"
                ));
            }
            if entry
                .unix_mode()
                .map(|mode| mode & 0o170000 == 0o120000)
                .unwrap_or(false)
            {
                return Err(format!(
                    "Standalone cartridge contains a symbolic link entry: {normalized}"
                ));
            }
            total_unpacked_bytes = total_unpacked_bytes
                .checked_add(entry.size())
                .ok_or_else(|| "Standalone cartridge unpacked size overflowed.".to_string())?;
            if total_unpacked_bytes > MAX_STANDALONE_UNPACKED_BYTES {
                return Err(format!(
                    "Standalone cartridge exceeds the 4 GiB unpacked safety limit: {total_unpacked_bytes} bytes"
                ));
            }

            let target = destination.join(&relative);
            if is_dir {
                fs::create_dir_all(&target).map_err(|error| {
                    format!(
                        "Failed to create prepared cartridge directory {}: {error}",
                        target.display()
                    )
                })?;
                continue;
            }
            let parent = target.parent().ok_or_else(|| {
                format!(
                    "Prepared cartridge path has no parent: {}",
                    target.display()
                )
            })?;
            fs::create_dir_all(parent).map_err(|error| {
                format!(
                    "Failed to create prepared cartridge parent {}: {error}",
                    parent.display()
                )
            })?;
            let parent_canonical = parent.canonicalize().map_err(|error| {
                format!(
                    "Failed to resolve prepared cartridge parent {}: {error}",
                    parent.display()
                )
            })?;
            if !parent_canonical.starts_with(&destination_root) {
                return Err(format!(
                    "Standalone cartridge path escaped the prepared directory: {normalized}"
                ));
            }
            let mut output = File::create(&target).map_err(|error| {
                format!(
                    "Failed to create prepared cartridge file {}: {error}",
                    target.display()
                )
            })?;
            let copied = io::copy(&mut entry, &mut output).map_err(|error| {
                format!(
                    "Failed to unpack standalone cartridge file {}: {error}",
                    target.display()
                )
            })?;
            if copied != entry.size() {
                return Err(format!(
                    "Standalone cartridge entry size changed while unpacking {normalized}: expected {}, wrote {copied}",
                    entry.size()
                ));
            }
            files += 1;
        }

        for required in ["manifest.json", "script.json", "checksum.json"] {
            let required_path = destination.join(required);
            if !required_path.is_file() {
                return Err(format!(
                    "Standalone cartridge is missing required file: {required}"
                ));
            }
            let raw = fs::read_to_string(&required_path).map_err(|error| {
                format!(
                    "Failed to read prepared cartridge JSON {}: {error}",
                    required_path.display()
                )
            })?;
            serde_json::from_str::<serde_json::Value>(raw.trim_start_matches('\u{feff}')).map_err(
                |error| format!("Prepared cartridge {required} is invalid JSON: {error}"),
            )?;
        }

        Ok(serde_json::json!({
            "ok": true,
            "cartridge": cartridge_path.to_string_lossy(),
            "destination": destination.to_string_lossy(),
            "archiveBytes": metadata.len(),
            "unpackedBytes": total_unpacked_bytes,
            "files": files,
            "entryLimit": MAX_STANDALONE_CARTRIDGE_FILES,
            "archiveByteLimit": MAX_STANDALONE_CARTRIDGE_BYTES,
            "unpackedByteLimit": MAX_STANDALONE_UNPACKED_BYTES
        }))
    })();

    match preparation {
        Ok(report) => {
            let json = serde_json::to_string_pretty(&report)
                .map_err(|error| format!("Failed to encode cartridge safety report: {error}"))?;
            fs::write(report_path, format!("{json}\n")).map_err(|error| {
                format!(
                    "Failed to write cartridge safety report {}: {error}",
                    report_path.display()
                )
            })
        }
        Err(error) => {
            let _ = remove_path_if_exists(destination);
            let report = serde_json::json!({
                "ok": false,
                "cartridge": cartridge_path.to_string_lossy(),
                "error": error
            });
            if let Ok(json) = serde_json::to_string_pretty(&report) {
                let _ = fs::write(report_path, format!("{json}\n"));
            }
            Err(report
                .get("error")
                .and_then(|value| value.as_str())
                .unwrap_or("Standalone cartridge preparation failed.")
                .to_string())
        }
    }
}

fn safe_windows_package_file_stem(value: &str) -> String {
    let mut result = String::with_capacity(value.len());
    for character in value.trim().chars() {
        if character.is_control()
            || matches!(
                character,
                '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*'
            )
        {
            result.push('_');
        } else {
            result.push(character);
        }
    }
    let result = result
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .trim_end_matches(['.', ' '])
        .to_string();
    let mut result = if result.is_empty() {
        "AgentVN-Game".to_string()
    } else {
        result
    };
    if matches!(
        result.to_ascii_uppercase().as_str(),
        "CON"
            | "PRN"
            | "AUX"
            | "NUL"
            | "COM1"
            | "COM2"
            | "COM3"
            | "COM4"
            | "COM5"
            | "COM6"
            | "COM7"
            | "COM8"
            | "COM9"
            | "LPT1"
            | "LPT2"
            | "LPT3"
            | "LPT4"
            | "LPT5"
            | "LPT6"
            | "LPT7"
            | "LPT8"
            | "LPT9"
    ) {
        result.insert(0, '_');
    }
    result.chars().take(96).collect()
}

fn assert_windows_gui_subsystem(path: &Path) -> Result<(), String> {
    let bytes = fs::read(path).map_err(|error| {
        format!(
            "Failed to read Windows executable {}: {error}",
            path.display()
        )
    })?;
    if bytes.len() < 0x40 || &bytes[..2] != b"MZ" {
        return Err(format!(
            "Windows executable has an invalid DOS header: {}",
            path.display()
        ));
    }
    let pe_offset = u32::from_le_bytes(
        bytes[0x3c..0x40]
            .try_into()
            .map_err(|_| "Failed to read PE header offset.".to_string())?,
    ) as usize;
    if pe_offset
        .checked_add(96)
        .is_none_or(|end| end > bytes.len())
        || &bytes[pe_offset..pe_offset + 4] != b"PE\0\0"
    {
        return Err(format!(
            "Windows executable has an invalid PE header: {}",
            path.display()
        ));
    }
    let subsystem_offset = pe_offset + 24 + 68;
    let subsystem = u16::from_le_bytes(
        bytes[subsystem_offset..subsystem_offset + 2]
            .try_into()
            .map_err(|_| "Failed to read PE subsystem.".to_string())?,
    );
    if subsystem != 2 {
        return Err(format!(
            "Windows executable is not marked as a GUI application: {}",
            path.display()
        ));
    }
    Ok(())
}

fn copy_directory_for_artifact(source: &Path, destination: &Path) -> Result<(), String> {
    fs::create_dir_all(destination).map_err(|error| {
        format!(
            "Failed to create artifact directory {}: {error}",
            destination.display()
        )
    })?;
    for entry in fs::read_dir(source).map_err(|error| {
        format!(
            "Failed to read artifact source directory {}: {error}",
            source.display()
        )
    })? {
        let entry = entry.map_err(|error| format!("Failed to read artifact entry: {error}"))?;
        let source_path = entry.path();
        let target_path = destination.join(entry.file_name());
        let file_type = entry.file_type().map_err(|error| {
            format!(
                "Failed to inspect artifact source {}: {error}",
                source_path.display()
            )
        })?;
        if file_type.is_symlink() {
            return Err(format!(
                "Refusing to copy symbolic link into package artifact: {}",
                source_path.display()
            ));
        }
        if file_type.is_dir() {
            copy_directory_for_artifact(&source_path, &target_path)?;
        } else if file_type.is_file() {
            fs::copy(&source_path, &target_path).map_err(|error| {
                format!(
                    "Failed to copy artifact file {} -> {}: {error}",
                    source_path.display(),
                    target_path.display()
                )
            })?;
        }
    }
    Ok(())
}

fn collect_windows_standalone_artifacts(
    run_root: &Path,
    output_root: &Path,
    verify_report_path: &Path,
    optimization_report_path: &Path,
) -> Result<Vec<PackageBuildArtifact>, String> {
    let runtime_root = run_root.join("GameCli_framework");
    let release_dir = runtime_root
        .join("src-tauri")
        .join("target")
        .join("release");
    let runtime_exe = release_dir.join("agentvn-player.exe");
    let resource_source = release_dir.join("embedded-cartridge");
    if !runtime_exe.is_file() {
        return Err(format!(
            "Portable runtime executable was not found: {}",
            runtime_exe.display()
        ));
    }
    if !resource_source.is_dir() {
        return Err(format!(
            "Portable runtime resource directory was not found: {}",
            resource_source.display()
        ));
    }
    assert_windows_gui_subsystem(&runtime_exe)?;

    let title = fs::read_to_string(verify_report_path)
        .ok()
        .and_then(|raw| {
            serde_json::from_str::<serde_json::Value>(raw.trim_start_matches('\u{feff}')).ok()
        })
        .and_then(|value| {
            value
                .get("title")
                .and_then(|title| title.as_str())
                .map(str::to_string)
        })
        .filter(|title| !title.trim().is_empty())
        .unwrap_or_else(|| "AgentVN Game".to_string());
    let file_stem = safe_windows_package_file_stem(&title);

    let output_canonical = output_root.canonicalize().map_err(|error| {
        format!(
            "Failed to resolve standalone output directory {}: {error}",
            output_root.display()
        )
    })?;
    let portable_root = output_root.join("portable");
    if let Some(parent) = portable_root.parent() {
        let parent_canonical = parent.canonicalize().map_err(|error| {
            format!(
                "Failed to resolve portable output parent {}: {error}",
                parent.display()
            )
        })?;
        if parent_canonical != output_canonical {
            return Err(format!(
                "Portable output escaped the requested output directory: {}",
                portable_root.display()
            ));
        }
    }
    remove_path_if_exists(&portable_root)?;
    fs::create_dir_all(&portable_root).map_err(|error| {
        format!(
            "Failed to create portable output directory {}: {error}",
            portable_root.display()
        )
    })?;
    let portable_exe = portable_root.join(format!("{file_stem}.exe"));
    let portable_resources = portable_root.join("embedded-cartridge");
    fs::copy(&runtime_exe, &portable_exe).map_err(|error| {
        format!(
            "Failed to copy portable executable {} -> {}: {error}",
            runtime_exe.display(),
            portable_exe.display()
        )
    })?;
    copy_directory_for_artifact(&resource_source, &portable_resources)?;

    let nsis_dir = release_dir.join("bundle").join("nsis");
    let mut nsis_files = fs::read_dir(&nsis_dir)
        .map_err(|error| {
            format!(
                "Failed to read NSIS output directory {}: {error}",
                nsis_dir.display()
            )
        })?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.is_file()
                && path
                    .extension()
                    .and_then(|value| value.to_str())
                    .is_some_and(|value| value.eq_ignore_ascii_case("exe"))
        })
        .collect::<Vec<_>>();
    nsis_files.sort_by_key(|path| {
        fs::metadata(path)
            .and_then(|metadata| metadata.modified())
            .unwrap_or(UNIX_EPOCH)
    });
    let nsis_source = nsis_files
        .pop()
        .ok_or_else(|| format!("NSIS installer was not found under {}", nsis_dir.display()))?;
    let installer = output_root.join(format!("{file_stem}-setup.exe"));
    fs::copy(&nsis_source, &installer).map_err(|error| {
        format!(
            "Failed to copy NSIS installer {} -> {}: {error}",
            nsis_source.display(),
            installer.display()
        )
    })?;

    let mut artifacts = vec![
        PackageBuildArtifact {
            kind: "windows_portable_exe".to_string(),
            path: portable_exe.to_string_lossy().to_string(),
            bytes: fs::metadata(&portable_exe)
                .ok()
                .map(|metadata| metadata.len()),
        },
        PackageBuildArtifact {
            kind: "windows_nsis_installer".to_string(),
            path: installer.to_string_lossy().to_string(),
            bytes: fs::metadata(&installer).ok().map(|metadata| metadata.len()),
        },
    ];
    if optimization_report_path.is_file() {
        let report_target = output_root.join("release-optimization-report.json");
        fs::copy(optimization_report_path, &report_target).map_err(|error| {
            format!(
                "Failed to copy optimization report {} -> {}: {error}",
                optimization_report_path.display(),
                report_target.display()
            )
        })?;
        artifacts.push(PackageBuildArtifact {
            kind: "release_optimization_report".to_string(),
            path: report_target.to_string_lossy().to_string(),
            bytes: fs::metadata(&report_target)
                .ok()
                .map(|metadata| metadata.len()),
        });
    }
    Ok(artifacts)
}

struct StandalonePackageRunner<'a> {
    use_direct_node_runner: bool,
    script_path: &'a Path,
    cartridge_path: &'a Path,
    output_root: &'a Path,
    diagnostics_dir: &'a Path,
    optimization_profile: &'a str,
    release_identity: &'a serde_json::Value,
    icon_source: &'a str,
    icon_path: Option<&'a Path>,
    run_id: &'a str,
    prepared_windows_workspace: bool,
}

// Both native runner paths use this construction; test the actual Command
// rather than only the downstream Node -> PowerShell bridge.
fn standalone_package_runner_command(
    request: StandalonePackageRunner<'_>,
) -> Result<Command, String> {
    let command = if request.use_direct_node_runner {
        let mut command = background_command("node");
        command
            .arg(request.script_path)
            .arg("--CartridgePath")
            .arg(request.cartridge_path)
            .arg("--OutputDir")
            .arg(request.output_root)
            .arg("--DiagnosticsDir")
            .arg(request.diagnostics_dir)
            .arg("--RunId")
            .arg(request.run_id)
            .arg("--OptimizationProfile")
            .arg(request.optimization_profile)
            .arg("--ReleaseIdentity")
            .arg(serde_json::to_string(request.release_identity).map_err(|error| error.to_string())?)
            .arg("--IconSource")
            .arg(request.icon_source)
            .arg("--Json");
        if let Some(icon_path) = request.icon_path {
            command.arg("--IconPath").arg(icon_path);
        }
        // An already-elevated Editor is not the isolated UAC helper: the
        // Android runner must still probe its actual token/workspace symlinks.
        if request.prepared_windows_workspace {
            command
                .arg("--PreparedInPlace")
                .arg("--DisposableWorkspace")
                .arg("--RustCollectArtifacts");
        }
        command
    } else {
        let mut command = background_command(powershell_command());
        command
            .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"])
            .arg(shell_display_path(request.script_path))
            .arg("-CartridgePath")
            .arg(shell_display_path(request.cartridge_path))
            .arg("-OutputDir")
            .arg(shell_display_path(request.output_root))
            .arg("-DiagnosticsDir")
            .arg(shell_display_path(request.diagnostics_dir))
            .arg("-RunId")
            .arg(request.run_id)
            .arg("-OptimizationProfile")
            .arg(request.optimization_profile)
            .arg("-ReleaseIdentity")
            .arg(serde_json::to_string(request.release_identity).map_err(|error| error.to_string())?)
            .arg("-IconSource")
            .arg(request.icon_source)
            .arg("-Json");
        if let Some(icon_path) = request.icon_path {
            command.arg("-IconPath").arg(shell_display_path(icon_path));
        }
        command
    };
    Ok(command)
}

fn build_standalone_package_blocking_inner(
    app: tauri::AppHandle,
    target_platform: String,
    output_dir: String,
    run_id: Option<String>,
    optimization_profile: String,
    release_identity: serde_json::Value,
    icon_source: String,
    cache_dir: PathBuf,
    cartridge_path: PathBuf,
    standalone_icon_path: Option<PathBuf>,
) -> Result<StandalonePackageBuildResult, String> {
    if !release_identity.is_object() {
        return Err("RELEASE_METADATA_INVALID: release identity must be an object.".to_string());
    }
    let platform = match target_platform.as_str() {
        "windows" | "android" => target_platform,
        other => return Err(format!("Unsupported package target platform: {other}")),
    };
    let _android_environment_lock = if platform == "android" {
        Some(try_acquire_android_environment_operation_lock(
            &app,
            "android-package-build",
        )?)
    } else {
        None
    };
    if !matches!(
        optimization_profile.as_str(),
        "balanced" | "lossless" | "off"
    ) {
        return Err(format!(
            "Unsupported release optimization profile: {optimization_profile}"
        ));
    }
    let run_id = run_id
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| format!("package-{}", error_report_timestamp()));
    emit_package_build_log(
        &app,
        &run_id,
        "info",
        "runtime",
        format!("Starting {platform} standalone package build."),
    );
    if output_dir.trim().is_empty() {
        emit_package_build_log(
            &app,
            &run_id,
            "error",
            "runtime",
            "Output directory is required before building a standalone package.",
        );
        return Err(
            "Output directory is required before building a standalone package.".to_string(),
        );
    }

    fs::create_dir_all(&cache_dir).map_err(|error| {
        format!(
            "Failed to create package build cache dir {}: {error}",
            cache_dir.display()
        )
    })?;
    let diagnostics_dir = cache_dir.join("diagnostics");
    fs::create_dir_all(&diagnostics_dir).map_err(|error| {
        format!(
            "Failed to create package diagnostics dir {}: {error}",
            diagnostics_dir.display()
        )
    })?;
    let manifest_path = diagnostics_dir.join("package-build-manifest.json");
    let build_log_path = diagnostics_dir.join(format!("standalone-{platform}-build.log"));
    let verify_report_path = diagnostics_dir.join(format!("standalone-{platform}-verify.json"));
    let command_log_path = diagnostics_dir.join("standalone-package-command.log");
    let diagnostics_archive_path = cache_dir.join("agentvn-standalone-diagnostics.zip");
    let requested_output_root = PathBuf::from(output_dir);
    if let Err(error) = fs::create_dir_all(&requested_output_root) {
        let message = format!(
            "Failed to create output directory {}: {error}",
            requested_output_root.display()
        );
        let _ = fs::write(&build_log_path, format!("{message}\n"));
        emit_package_build_log(&app, &run_id, "error", "output", message.clone());
        return Ok(persist_standalone_package_failure(
            package_build_result(
                "FAIL",
                message,
                Vec::new(),
                Vec::new(),
                &verify_report_path,
                &build_log_path,
                &manifest_path,
            ),
            &diagnostics_dir,
            &diagnostics_archive_path,
        ));
    }
    let output_root = fs::canonicalize(&requested_output_root).unwrap_or(requested_output_root);
    emit_package_build_log(
        &app,
        &run_id,
        "info",
        "runtime",
        format!(
            "Temporary cartridge staged: {}",
            shell_display_path(&cartridge_path)
        ),
    );
    if let Some(icon_path) = &standalone_icon_path {
        emit_package_build_log(
            &app,
            &run_id,
            "info",
            "runtime",
            format!(
                "Temporary package icon staged: {}",
                shell_display_path(icon_path)
            ),
        );
    }

    let script_name = if platform == "windows" {
        "build-runtime-standalone-windows.cjs"
    } else {
        "build-runtime-standalone-android.cjs"
    };
    let source_root = standalone_build_root_candidates(&app)
        .into_iter()
        .find(|candidate| has_standalone_build_workspace(candidate, script_name));
    let Some(source_root) = source_root else {
        let checked = standalone_build_root_candidates(&app)
            .into_iter()
            .map(|path| path.display().to_string())
            .collect::<Vec<_>>()
            .join(", ");
        emit_package_build_log(
            &app,
            &run_id,
            "error",
            "runtime",
            format!("Standalone package build resources were not found. Checked: {checked}"),
        );
        return Ok(persist_standalone_package_failure(
            package_build_result(
                "BLOCKED",
                format!(
                    "Standalone package build resources were not found. Checked: {checked}"
                ),
                Vec::new(),
                vec![
                    "This AgentVN Editor installation is missing bundled standalone build resources. Reinstall with the latest installer or run from the full AgentVN workspace.".to_string(),
                ],
                &verify_report_path,
                &build_log_path,
                &manifest_path,
            ),
            &diagnostics_dir,
            &diagnostics_archive_path,
        ));
    };

    let direct_runner_available_at_source = source_root.join("scripts").join(script_name).exists();
    let run_root = if platform == "windows"
        && is_workspace_root(&source_root)
        && !direct_runner_available_at_source
    {
        source_root
    } else {
        let build_workspace = cache_dir.join("build-workspace");
        emit_package_build_log(
            &app,
            &run_id,
            "info",
            "runtime",
            format!(
                "Materializing bundled build workspace: {}",
                shell_display_path(&build_workspace)
            ),
        );
        if let Err(error) = materialize_standalone_build_workspace(&source_root, &build_workspace) {
            let failure_code = error.split(':').next()
                .filter(|code| code.starts_with("EDITOR_BUILD_VERSION_"))
                .unwrap_or("BUILD_WORKSPACE_PREPARATION_FAILED").to_string();
            emit_package_build_log(&app, &run_id, "error", "runtime", &error);
            let mut result = package_build_result(
                "FAIL", error, Vec::new(), Vec::new(), &verify_report_path, &build_log_path, &manifest_path,
            );
            result.failure_code = Some(failure_code);
            return Ok(persist_standalone_package_failure(
                result,
                &diagnostics_dir,
                &diagnostics_archive_path,
            ));
        }
        build_workspace
    };

    let script_path = run_root.join("scripts").join(script_name);
    let direct_node_script = run_root.join("scripts").join(script_name);
    let use_direct_node_runner = direct_node_script.exists()
        && direct_node_script
            .extension()
            .and_then(|value| value.to_str())
            .is_some_and(|value| value.eq_ignore_ascii_case("cjs"));
    if !script_path.exists() {
        emit_package_build_log(
            &app,
            &run_id,
            "error",
            "runtime",
            format!(
                "Standalone package build script was not found: {}",
                script_path.display()
            ),
        );
        return Ok(persist_standalone_package_failure(
            package_build_result(
                "BLOCKED",
                format!(
                    "Standalone package build script was not found: {}",
                    script_path.display()
                ),
                Vec::new(),
                vec![
                    "This AgentVN Editor installation is missing bundled standalone build resources. Reinstall with the latest installer or run from the full AgentVN workspace.".to_string(),
                ],
                &verify_report_path,
                &build_log_path,
                &manifest_path,
            ),
            &diagnostics_dir,
            &diagnostics_archive_path,
        ));
    }

    let android_environment_cache = if platform == "android" {
        environment_pass_cache_path(&app, "android")
            .ok()
            .and_then(|path| read_environment_pass_cache(&path, "android"))
    } else {
        None
    };
    let android_environment_cache_valid = android_environment_cache.is_some();
    if android_environment_cache_valid {
        emit_package_build_log(
            &app,
            &run_id,
            "success",
            "android-env",
            "Previous Android environment check is still cached as PASS; skipping the repeated full toolchain precheck.",
        );
    }
    #[cfg(target_os = "windows")]
    if platform == "android" {
        let probe_root = run_root.join("GameCli_framework").join("src-tauri");
        let probe_report_path = diagnostics_dir.join("android-symlink-capability.json");
        let cached_probe = android_environment_cache
            .as_ref()
            .and_then(|value| value.get("symlinkCapability"))
            .and_then(|value| {
                serde_json::from_value::<AndroidSymlinkCapability>(value.clone()).ok()
            })
            .filter(|probe| probe.success)
            .filter(|probe| probe.is_elevated == windows_process_is_elevated())
            .filter(|probe| {
                let cached_root = PathBuf::from(&probe.probe_root);
                cached_root.components().next() == probe_root.components().next()
            });
        let probe = cached_probe
            .clone()
            .unwrap_or_else(|| probe_android_symlink_capability(&probe_root));
        write_json_atomic(&probe_report_path, &probe)?;
        let android_symlink_probe_cache_valid = cached_probe.is_some();
        if android_symlink_probe_cache_valid {
            emit_package_build_log(
                &app,
                &run_id,
                "success",
                "android-permission",
                "Previous symbolic-link capability PASS was reused for the same build volume; the repeated probe was skipped.",
            );
        }
        if !probe.success {
            let failure_code =
                classify_android_symlink_failure(&probe).unwrap_or("SYMLINK_PRIVILEGE_REQUIRED");
            if failure_code != "SYMLINK_PRIVILEGE_REQUIRED" {
                let mut result = package_build_result(
                    "BLOCKED",
                    format!(
                        "Symbolic-link verification failed in {} during {}. Win32 error: {}. Details: {}",
                        probe_root.display(),
                        probe.failed_operation.as_deref().unwrap_or("symbolic-link verification"),
                        probe
                            .win32_error_code
                            .map(|value| value.to_string())
                            .unwrap_or_else(|| "unknown".to_string()),
                        probe.error.as_deref().unwrap_or("No operation details were recorded.")
                    ),
                    Vec::new(),
                    vec![format!(
                        "Symbolic-link capability report: {}",
                        probe_report_path.display()
                    )],
                    &verify_report_path,
                    &build_log_path,
                    &manifest_path,
                );
                result.failure_code = Some(failure_code.to_string());
                result.permission_details = serde_json::to_value(&probe).ok();
                return Ok(persist_standalone_package_failure(
                    result,
                    &diagnostics_dir,
                    &diagnostics_archive_path,
                ));
            }
        }
        if android_build_requires_default_elevation(&probe) {
            emit_package_build_log(
                &app,
                &run_id,
                "warning",
                "android-permission",
                format!(
                    "Android standalone builds require administrator permission by default. Requesting elevation before the build starts in {}. Developer Mode is optional.",
                    probe_root.display()
                ),
            );
            let request = ElevatedAndroidBuildRequest {
                schema_version: 2,
                run_id: run_id.clone(),
                cache_dir: fs::canonicalize(&cache_dir).unwrap_or_else(|_| cache_dir.clone()),
                run_root: fs::canonicalize(&run_root).unwrap_or_else(|_| run_root.clone()),
                output_dir: output_root.clone(),
                diagnostics_dir: fs::canonicalize(&diagnostics_dir)
                    .unwrap_or_else(|_| diagnostics_dir.clone()),
                cartridge_path: fs::canonicalize(&cartridge_path)
                    .unwrap_or_else(|_| cartridge_path.clone()),
                icon_path: standalone_icon_path
                    .as_ref()
                    .map(|path| fs::canonicalize(path).unwrap_or_else(|_| path.clone())),
                optimization_profile: optimization_profile.clone(),
                runner_path: fs::canonicalize(&direct_node_script)
                    .unwrap_or_else(|_| direct_node_script.clone()),
                skip_environment_check: android_environment_cache_valid,
                release_identity: release_identity.clone(),
                icon_source: icon_source.clone(),
            };
            let request_path = cache_dir.join("elevated-android-build-request.json");
            let status_path = diagnostics_dir.join("android-build-status.json");
            let done_path = diagnostics_dir.join("android-build.done");
            let _ = fs::remove_file(&status_path);
            let _ = fs::remove_file(&done_path);
            write_json_atomic(&request_path, &request)?;
            let elevated = match launch_elevated_android_helper(&request_path) {
                Ok(process) => process,
                Err(1223) => {
                    let mut result = package_build_result(
                        "BLOCKED",
                        "Administrator permission was cancelled. The Android build did not start. Developer Mode is not required; approve the one-time UAC prompt or adjust the account policy.".to_string(),
                        Vec::new(),
                        vec![format!("Symbolic-link capability report: {}", probe_report_path.display())],
                        &verify_report_path,
                        &build_log_path,
                        &manifest_path,
                    );
                    result.failure_code = Some("UAC_CANCELLED".to_string());
                    result.permission_details = serde_json::to_value(&probe).ok();
                    return Ok(persist_standalone_package_failure(
                        result,
                        &diagnostics_dir,
                        &diagnostics_archive_path,
                    ));
                }
                Err(code) => {
                    let mut result = package_build_result(
                        "BLOCKED",
                        format!("Failed to start the elevated Android build helper. Win32 error: {code}."),
                        Vec::new(),
                        vec![format!("Symbolic-link capability report: {}", probe_report_path.display())],
                        &verify_report_path,
                        &build_log_path,
                        &manifest_path,
                    );
                    result.failure_code = Some("ELEVATED_HELPER_LOST".to_string());
                    result.permission_details = serde_json::to_value(&probe).ok();
                    return Ok(persist_standalone_package_failure(
                        result,
                        &diagnostics_dir,
                        &diagnostics_archive_path,
                    ));
                }
            };
            emit_package_build_log(
                &app,
                &run_id,
                "info",
                "android-permission",
                "Administrator permission was granted. The isolated Android build helper is running.",
            );

            let mut build_log_offset = 0;
            let mut verify_log_offset = 0;
            let started = Instant::now();
            let mut last_status_modified = None;
            loop {
                emit_new_log_file_lines(
                    &app,
                    &run_id,
                    &build_log_path,
                    &mut build_log_offset,
                    "build-log",
                );
                emit_new_log_file_lines(
                    &app,
                    &run_id,
                    &verify_report_path,
                    &mut verify_log_offset,
                    "verify",
                );
                if done_path.is_file() {
                    break;
                }
                if elevated.has_exited() {
                    let mut result = package_build_result(
                        "FAIL",
                        "The elevated Android build helper exited before publishing its completion marker.".to_string(),
                        Vec::new(),
                        Vec::new(),
                        &verify_report_path,
                        &build_log_path,
                        &manifest_path,
                    );
                    result.failure_code = Some("ELEVATED_HELPER_LOST".to_string());
                    result.permission_details = serde_json::to_value(&probe).ok();
                    return Ok(persist_standalone_package_failure(
                        result,
                        &diagnostics_dir,
                        &diagnostics_archive_path,
                    ));
                }
                if let Ok(metadata) = fs::metadata(&status_path) {
                    if let Ok(modified) = metadata.modified() {
                        if last_status_modified != Some(modified) {
                            last_status_modified = Some(modified);
                            if let Ok(raw) = fs::read_to_string(&status_path) {
                                if let Ok(status) = serde_json::from_str::<serde_json::Value>(
                                    raw.trim_start_matches('\u{feff}'),
                                ) {
                                    if let Some(message) =
                                        status.get("message").and_then(|value| value.as_str())
                                    {
                                        emit_package_build_log(
                                            &app,
                                            &run_id,
                                            "info",
                                            "elevated-helper",
                                            message.to_string(),
                                        );
                                    }
                                }
                            }
                        }
                        if modified
                            .elapsed()
                            .is_ok_and(|elapsed| elapsed > Duration::from_secs(90))
                        {
                            elevated.terminate();
                            let mut result = package_build_result(
                                "FAIL",
                                "The elevated Android build helper stopped updating its status for 90 seconds.".to_string(),
                                Vec::new(),
                                Vec::new(),
                                &verify_report_path,
                                &build_log_path,
                                &manifest_path,
                            );
                            result.failure_code = Some("ELEVATED_HELPER_LOST".to_string());
                            result.permission_details = serde_json::to_value(&probe).ok();
                            return Ok(persist_standalone_package_failure(
                                result,
                                &diagnostics_dir,
                                &diagnostics_archive_path,
                            ));
                        }
                    }
                } else if started.elapsed() > Duration::from_secs(90) {
                    elevated.terminate();
                    let mut result = package_build_result(
                        "FAIL",
                        "The elevated Android build helper did not publish a status file within 90 seconds.".to_string(),
                        Vec::new(),
                        Vec::new(),
                        &verify_report_path,
                        &build_log_path,
                        &manifest_path,
                    );
                    result.failure_code = Some("ELEVATED_HELPER_LOST".to_string());
                    result.permission_details = serde_json::to_value(&probe).ok();
                    return Ok(persist_standalone_package_failure(
                        result,
                        &diagnostics_dir,
                        &diagnostics_archive_path,
                    ));
                }
                std::thread::sleep(Duration::from_millis(650));
            }

            emit_new_log_file_lines(
                &app,
                &run_id,
                &build_log_path,
                &mut build_log_offset,
                "build-log",
            );
            if let Err(error) = validate_manifest_run_id(&manifest_path, &run_id) {
                let mut result = package_build_result(
                    "FAIL",
                    error,
                    Vec::new(),
                    Vec::new(),
                    &verify_report_path,
                    &build_log_path,
                    &manifest_path,
                );
                result.failure_code = Some("RUN_ID_MISMATCH".to_string());
                return Ok(persist_standalone_package_failure(
                    result,
                    &diagnostics_dir,
                    &diagnostics_archive_path,
                ));
            }
            let Some(mut result) =
                read_script_manifest(&manifest_path, &verify_report_path, &build_log_path)
            else {
                let mut result = package_build_result(
                    "FAIL",
                    "The elevated Android build completed without a readable UTF-8 manifest."
                        .to_string(),
                    Vec::new(),
                    Vec::new(),
                    &verify_report_path,
                    &build_log_path,
                    &manifest_path,
                );
                result.failure_code = Some("ENCODING_INVALID".to_string());
                return Ok(persist_standalone_package_failure(
                    result,
                    &diagnostics_dir,
                    &diagnostics_archive_path,
                ));
            };
            result.diagnostics_dir = diagnostics_dir.to_string_lossy().to_string();
            if !result.ok {
                match create_standalone_diagnostics_archive(
                    &diagnostics_dir,
                    &diagnostics_archive_path,
                ) {
                    Ok(path) => {
                        result.diagnostics_archive_path = path.to_string_lossy().to_string()
                    }
                    Err(error) => result
                        .warnings
                        .push(format!("Failed to create diagnostics ZIP: {error}")),
                }
            } else {
                result.verify_report_path.clear();
                result.build_log_path.clear();
                result.manifest_path.clear();
                result.diagnostics_dir.clear();
            }
            return Ok(result);
        }
    }

    let prepared_cartridge_dir = if platform == "windows" {
        let prepared = run_root
            .join("GameCli_framework")
            .join("src-tauri")
            .join("resources")
            .join("embedded-cartridge");
        let safety_report = diagnostics_dir.join("standalone-cartridge-safety.json");
        if let Err(error) =
            prepare_standalone_cartridge_safely(&cartridge_path, &prepared, &safety_report)
        {
            emit_package_build_log(&app, &run_id, "error", "cartridge-safety", error.clone());
            return Ok(persist_standalone_package_failure(
                package_build_result(
                    "FAIL",
                    error,
                    Vec::new(),
                    Vec::new(),
                    &verify_report_path,
                    &build_log_path,
                    &manifest_path,
                ),
                &diagnostics_dir,
                &diagnostics_archive_path,
            ));
        }
        Some(prepared)
    } else {
        None
    };
    emit_package_build_log(
        &app,
        &run_id,
        "info",
        if use_direct_node_runner {
            "node"
        } else {
            "powershell"
        },
        format!(
            "Launching {} with output dir {}",
            if use_direct_node_runner {
                direct_node_script.display().to_string()
            } else {
                script_path.display().to_string()
            },
            shell_display_path(&output_root)
        ),
    );
    let mut command = standalone_package_runner_command(StandalonePackageRunner {
        use_direct_node_runner,
        script_path: &script_path,
        cartridge_path: &cartridge_path,
        output_root: &output_root,
        diagnostics_dir: &diagnostics_dir,
        optimization_profile: &optimization_profile,
        release_identity: &release_identity,
        icon_source: &icon_source,
        icon_path: standalone_icon_path.as_deref(),
        run_id: &run_id,
        prepared_windows_workspace: platform == "windows" && prepared_cartridge_dir.is_some(),
    })?;
    if platform == "android" {
        if let Some(offline_pack) = resolve_embedded_android_offline_pack() {
            command.env("AGENTVN_ANDROID_OFFLINE_PACK", offline_pack);
        }
    }
    let mut child = match command
        .current_dir(&run_root)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
    {
        Ok(child) => child,
        Err(error) => {
            let message = format!("Failed to start standalone package build script: {error}");
            let _ = fs::write(&command_log_path, format!("{message}\n"));
            emit_package_build_log(&app, &run_id, "error", "runtime", message.clone());
            return Ok(persist_standalone_package_failure(
                package_build_result(
                    "BLOCKED",
                    message,
                    Vec::new(),
                    vec![
                        "Verify that the bundled Node.js runtime or the configured Node.js installation is available, then retry.".to_string(),
                    ],
                    &verify_report_path,
                    &command_log_path,
                    &manifest_path,
                ),
                &diagnostics_dir,
                &diagnostics_archive_path,
            ));
        }
    };
    let mut build_log_offset = 0;
    let mut verify_log_offset = 0;
    loop {
        emit_new_log_file_lines(
            &app,
            &run_id,
            &build_log_path,
            &mut build_log_offset,
            "build-log",
        );
        emit_new_log_file_lines(
            &app,
            &run_id,
            &verify_report_path,
            &mut verify_log_offset,
            "verify",
        );
        match child.try_wait() {
            Ok(Some(_status)) => break,
            Ok(None) => std::thread::sleep(Duration::from_millis(650)),
            Err(error) => {
                emit_package_build_log(
                    &app,
                    &run_id,
                    "error",
                    "runtime",
                    format!("Failed while waiting for package build script: {error}"),
                );
                let message = format!("Failed while waiting for package build script: {error}");
                let _ = fs::write(&command_log_path, format!("{message}\n"));
                return Ok(persist_standalone_package_failure(
                    package_build_result(
                        "FAIL",
                        message,
                        Vec::new(),
                        Vec::new(),
                        &verify_report_path,
                        &command_log_path,
                        &manifest_path,
                    ),
                    &diagnostics_dir,
                    &diagnostics_archive_path,
                ));
            }
        }
    }
    let output = child
        .wait_with_output()
        .map_err(|error| format!("Failed to collect standalone package build output: {error}"));
    let output = match output {
        Ok(output) => output,
        Err(error) => {
            let _ = fs::write(&command_log_path, format!("{error}\n"));
            return Ok(persist_standalone_package_failure(
                package_build_result(
                    "FAIL",
                    error,
                    Vec::new(),
                    Vec::new(),
                    &verify_report_path,
                    &command_log_path,
                    &manifest_path,
                ),
                &diagnostics_dir,
                &diagnostics_archive_path,
            ));
        }
    };
    emit_new_log_file_lines(
        &app,
        &run_id,
        &build_log_path,
        &mut build_log_offset,
        "build-log",
    );
    emit_new_log_file_lines(
        &app,
        &run_id,
        &verify_report_path,
        &mut verify_log_offset,
        "verify",
    );
    write_command_output(&command_log_path, &output)?;
    for line in String::from_utf8_lossy(&output.stderr).lines() {
        if !line.trim().is_empty() {
            emit_package_build_log(&app, &run_id, "warning", "stderr", line.to_string());
        }
    }

    if let Some(mut result) =
        read_script_manifest(&manifest_path, &verify_report_path, &build_log_path)
    {
        if result.ok && platform == "windows" && use_direct_node_runner {
            let optimization_report_path = diagnostics_dir.join("release-optimization-report.json");
            match collect_windows_standalone_artifacts(
                &run_root,
                &output_root,
                &verify_report_path,
                &optimization_report_path,
            ) {
                Ok(artifacts) => result.artifacts = artifacts,
                Err(error) => {
                    result.ok = false;
                    result.status = "FAIL".to_string();
                    result.message = error;
                    return Ok(persist_standalone_package_failure(
                        result,
                        &diagnostics_dir,
                        &diagnostics_archive_path,
                    ));
                }
            }
        }
        result.diagnostics_dir = diagnostics_dir.to_string_lossy().to_string();
        if !result.ok {
            let archive_path = cache_dir.join("agentvn-standalone-diagnostics.zip");
            match create_standalone_diagnostics_archive(&diagnostics_dir, &archive_path) {
                Ok(path) => {
                    result.diagnostics_archive_path = path.to_string_lossy().to_string();
                }
                Err(error) => {
                    result
                        .warnings
                        .push(format!("Failed to create diagnostics ZIP: {error}"));
                }
            }
        }
        emit_package_build_log(
            &app,
            &run_id,
            if result.ok { "success" } else { "error" },
            "manifest",
            format!("Package build finished with status {}.", result.status),
        );
        if result.ok {
            result.verify_report_path.clear();
            result.build_log_path.clear();
            result.manifest_path.clear();
            result.diagnostics_dir.clear();
            result.diagnostics_archive_path.clear();
        }
        return Ok(result);
    }

    let status = if output.status.success() {
        "PASS"
    } else {
        "FAIL"
    };
    emit_package_build_log(
        &app,
        &run_id,
        if output.status.success() {
            "success"
        } else {
            "error"
        },
        "runtime",
        format!(
            "Package build script exited without a readable manifest: {}",
            output.status
        ),
    );
    let stderr_detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout_detail = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let command_detail = if !stderr_detail.is_empty() {
        format!(
            " stderr: {}",
            stderr_detail.chars().take(1200).collect::<String>()
        )
    } else if !stdout_detail.is_empty() {
        format!(
            " stdout: {}",
            stdout_detail.chars().take(1200).collect::<String>()
        )
    } else {
        String::new()
    };
    let mut result = package_build_result(
        status,
        format!(
            "Standalone package build script finished without a readable manifest. Exit status: {}.{} See {}",
            output.status,
            command_detail,
            command_log_path.display()
        ),
        Vec::new(),
        Vec::new(),
        &verify_report_path,
        &command_log_path,
        &manifest_path,
    );
    let archive_path = cache_dir.join("agentvn-standalone-diagnostics.zip");
    match create_standalone_diagnostics_archive(&diagnostics_dir, &archive_path) {
        Ok(path) => result.diagnostics_archive_path = path.to_string_lossy().to_string(),
        Err(error) => result
            .warnings
            .push(format!("Failed to create diagnostics ZIP: {error}")),
    }
    Ok(result)
}

fn cleanup_standalone_package_build_inputs(
    cache_dir: &Path,
    cartridge_path: &Path,
    standalone_icon_path: Option<&Path>,
) -> Result<(), String> {
    remove_path_if_exists(cartridge_path)?;
    if let Some(icon_path) = standalone_icon_path {
        remove_path_if_exists(icon_path)?;
    }
    remove_path_if_exists(&cache_dir.join("build-workspace"))?;
    if !cache_dir.join("diagnostics").exists() {
        remove_path_if_exists(cache_dir)?;
    }
    Ok(())
}

fn refresh_android_artifact_cleanup_evidence(
    artifact: &PackageBuildArtifact,
    cache_dir: &Path,
    cartridge_path: &Path,
    physical_inputs: (&Path, &Path),
    expected_run_id: Option<&str>,
    cleanup_error: Option<&str>,
) -> Result<(), String> {
    let apk = Path::new(&artifact.path);
    let metadata_path = PathBuf::from(format!("{}.acceptance.json", artifact.path));
    let original = fs::read(&metadata_path)
        .map_err(|error| format!("Cannot read APK metadata {}: {error}", metadata_path.display()))?;
    let text = std::str::from_utf8(&original)
        .map_err(|error| format!("APK metadata is not UTF-8: {error}"))?;
    let mut evidence: serde_json::Value = serde_json::from_str(text.trim_start_matches('\u{feff}'))
        .map_err(|error| format!("Invalid APK metadata: {error}"))?;
    let run_id = evidence["runId"].as_str().filter(|id| !id.trim().is_empty())
        .ok_or_else(|| "APK metadata has no runId".to_string())?;
    if expected_run_id.filter(|id| !id.trim().is_empty()).is_some_and(|id| id != run_id) {
        return Err("APK metadata belongs to another build run".to_string());
    }
    let has_parent = |value: &Path| value.components().any(|part| matches!(part, std::path::Component::ParentDir));
    let normalize = |value: &Path| PathBuf::from(shell_display_path(value));
    let normalized_cache = normalize(cache_dir);
    let physical_cache = normalize(physical_inputs.0);
    let physical_source = normalize(physical_inputs.1);
    let owned_path = |value: &Path| {
        let normalized = normalize(value);
        normalized.is_absolute() && !has_parent(value)
            && (normalized.starts_with(&normalized_cache) || normalized.starts_with(&physical_cache))
            && normalized != normalized_cache && normalized != physical_cache
    };
    let receipt_source = evidence["sourceCartridge"]["path"].as_str().map(Path::new);
    if !apk.is_absolute() || has_parent(apk)
        || evidence["apk"]["path"].as_str().map(Path::new).map(normalize) != Some(normalize(apk))
        || !receipt_source.is_some_and(|source| {
            normalize(source) == normalize(cartridge_path) || normalize(source) == physical_source
        })
        || !cartridge_path.is_absolute() || !cartridge_path.starts_with(cache_dir) || has_parent(cartridge_path)
    {
        return Err("APK metadata artifact/source ownership mismatch".to_string());
    }
    if evidence["apk"]["sha256"].as_str() != Some(sha256_file(apk)?.as_str()) {
        return Err("APK bytes changed before evidence finalization".to_string());
    }
    // Validate every input before changing any field. Never read/hash a path
    // supplied by a foreign receipt, and preserve all original hashes/times.
    for key in ["sourceCartridge", "prepackageLayout"] {
        let entry = &evidence[key];
        if key == "prepackageLayout" && entry["present"] == false { continue; }
        let file = entry["path"].as_str().map(Path::new)
            .ok_or_else(|| format!("APK metadata missing {key}.path"))?;
        let hash = entry["sha256"].as_str()
            .filter(|value| value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit()))
            .ok_or_else(|| format!("APK metadata missing {key}.sha256"))?;
        if !owned_path(file) {
            return Err(format!("APK metadata {key} is outside this build cache"));
        }
        let cleaned = match fs::metadata(file) {
            Ok(_) => {
                let resolved_file = normalize(&fs::canonicalize(file).map_err(|error| error.to_string())?);
                if !resolved_file.starts_with(&physical_cache) || resolved_file == physical_cache {
                    return Err(format!("APK metadata {key} resolves outside this build cache"));
                }
                !sha256_file(file)?.eq_ignore_ascii_case(hash)
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => true,
            Err(error) => return Err(format!("Cannot verify cleanup of {}: {error}", file.display())),
        };
        evidence[key]["cleaned"] = serde_json::Value::Bool(cleaned);
    }
    evidence["nativeCleanup"] = serde_json::json!({
        "source": "editor-native-final-cleanup",
        "checkedAtUnixMs": error_report_timestamp() as u64,
        "status": if cleanup_error.is_some() { "FAILED" } else { "PASS" },
        "cleanupError": cleanup_error,
    });
    if fs::read(&metadata_path).map_err(|error| error.to_string())? != original {
        return Err("APK metadata changed while finalizing; not overwriting it".to_string());
    }
    write_json_atomic(&metadata_path, &evidence)
}

fn resolve_cleanup_input_identity(path: &Path) -> Result<PathBuf, String> {
    if !path.is_absolute() || path.components().any(|part| matches!(part, std::path::Component::ParentDir)) {
        return Err("Native cleanup input must be an absolute path without parent traversal".into());
    }
    match fs::canonicalize(path) {
        Ok(resolved) => Ok(resolved),
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            // Repeated finalization is valid after successful cleanup. Resolve
            // the surviving native-owned ancestor, never a path from metadata.
            let parent = path.parent().ok_or_else(|| error.to_string())?;
            let leaf = path.file_name().ok_or_else(|| error.to_string())?;
            Ok(resolve_cleanup_input_identity(parent)?.join(leaf))
        }
        Err(error) => Err(error.to_string()),
    }
}

fn finalize_standalone_package_build_inputs(
    cache_dir: &Path,
    cartridge_path: &Path,
    standalone_icon_path: Option<&Path>,
    expected_run_id: Option<&str>,
    result: &Result<StandalonePackageBuildResult, String>,
) -> Result<(), String> {
    // The elevated builder sees physical AppData paths. Resolve native-owned
    // identities while the inputs exist; cleanup removes them before metadata
    // is refreshed, so canonicalizing afterwards loses that identity.
    let physical_inputs = (|| -> Result<(PathBuf, PathBuf), String> {
        let cache = resolve_cleanup_input_identity(cache_dir)?;
        let source = resolve_cleanup_input_identity(cartridge_path)?;
        if !source.starts_with(&cache) || source == cache {
            return Err("Native cartridge resolves outside this build cache".into());
        }
        Ok((cache, source))
    })();
    let cleanup = if matches!(result, Ok(value) if value.ok) {
        remove_path_if_exists(cache_dir)
    } else {
        cleanup_standalone_package_build_inputs(cache_dir, cartridge_path, standalone_icon_path)
    };
    let mut errors = Vec::new();
    if let Ok(build) = result {
        for artifact in build.artifacts.iter().filter(|item| item.kind == "android_apk_signed") {
            let (physical_cache, physical_source) = match &physical_inputs {
                Ok(inputs) => inputs,
                Err(error) => { errors.push(error.clone()); continue; }
            };
            if let Err(error) = refresh_android_artifact_cleanup_evidence(
                artifact, cache_dir, cartridge_path, (physical_cache, physical_source), expected_run_id,
                cleanup.as_ref().err().map(String::as_str),
            ) {
                errors.push(error);
            }
        }
    }
    if !errors.is_empty() {
        if let Err(error) = cleanup { errors.push(format!("Input cleanup also failed: {error}")); }
        return Err(format!("ANDROID_EVIDENCE_FINALIZATION_FAILED: {}", errors.join("; ")));
    }
    cleanup
}

fn record_standalone_package_cleanup_error(
    result: &mut Result<StandalonePackageBuildResult, String>,
    cache_dir: &Path,
    is_android: bool,
    error: &str,
) {
    if let Ok(value) = result {
        value.warnings.push(format!("Final build cleanup/evidence failed: {error}"));
        if is_android && value.ok {
            value.ok = false;
            value.status = "FAIL".to_string();
            value.failure_code = Some(if error.starts_with("ANDROID_EVIDENCE_FINALIZATION_FAILED:") {
                "ANDROID_EVIDENCE_FINALIZATION_FAILED"
            } else { "ANDROID_BUILD_INPUT_CLEANUP_FAILED" }.to_string());
            value.message = format!(
                "APK was generated but final cleanup/evidence could not be completed. \
                 The output APK is preserved; inspect diagnostics and retry. {error}"
            );
        }
        if is_android {
            let diagnostics = cache_dir.join("diagnostics");
            if value.build_log_path.is_empty() {
                value.build_log_path = diagnostics.join("native-final-cleanup.log").to_string_lossy().into();
            }
            if value.manifest_path.is_empty() {
                value.manifest_path = diagnostics.join("package-build-manifest.json").to_string_lossy().into();
            }
            if let Err(log_error) = append_error_log_line(
                &diagnostics.join("native-final-cleanup.log"), error,
            ) {
                value.warnings.push(format!("Failed to preserve final cleanup log: {log_error}"));
            }
            *value = persist_standalone_package_failure(
                value.clone(), &diagnostics, &cache_dir.join("agentvn-standalone-diagnostics.zip"),
            );
        }
    }
}

fn build_standalone_package_blocking(
    app: tauri::AppHandle,
    target_platform: String,
    output_dir: String,
    run_id: Option<String>,
    optimization_profile: String,
    release_identity: serde_json::Value,
    icon_source: String,
    cache_dir: PathBuf,
    cartridge_path: PathBuf,
    standalone_icon_path: Option<PathBuf>,
) -> Result<StandalonePackageBuildResult, String> {
    let is_android = target_platform.eq_ignore_ascii_case("android");
    let android_build_guard = if is_android {
        let lock = ACTIVE_ANDROID_BUILD.get_or_init(|| Mutex::new(false));
        let mut active = lock
            .lock()
            .map_err(|_| "Android package build lock is poisoned.".to_string())?;
        if *active {
            return Err("ANDROID_BUILD_BUSY: another Android package build is already running.".to_string());
        }
        *active = true;
        Some(lock)
    } else {
        None
    };
    let cleanup_run_id = run_id
        .clone()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| format!("package-{}", error_report_timestamp()));
    let expected_run_id = run_id.clone();
    let mut result = build_standalone_package_blocking_inner(
        app.clone(),
        target_platform,
        output_dir,
        run_id,
        optimization_profile,
        release_identity,
        icon_source,
        cache_dir.clone(),
        cartridge_path.clone(),
        standalone_icon_path.clone(),
    );
    let cleanup_result = finalize_standalone_package_build_inputs(
        &cache_dir,
        &cartridge_path,
        standalone_icon_path.as_deref(),
        expected_run_id.as_deref(),
        &result,
    );
    if let Err(error) = cleanup_result {
        record_standalone_package_cleanup_error(&mut result, &cache_dir, is_android, &error);
        emit_package_build_log(
            &app,
            &cleanup_run_id,
            "warning",
            "runtime",
            format!("Final standalone package cleanup/evidence failed: {error}"),
        );
    }
    if let Some(lock) = android_build_guard {
        if let Ok(mut active) = lock.lock() {
            *active = false;
        }
    }
    result
}

fn android_env_script_candidates(app: &tauri::AppHandle) -> Vec<PathBuf> {
    let script_name = "setup-android-build-env.ps1";
    let workspace = workspace_root();
    let exe_dir = exe_parent_dir();
    let mut candidates = vec![
        workspace.join("scripts").join(script_name),
        exe_dir.join(script_name),
        exe_dir.join("scripts").join(script_name),
        exe_dir
            .join("bundle-workspace")
            .join("scripts")
            .join(script_name),
    ];
    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.extend([
            resource_dir.join(script_name),
            resource_dir.join("scripts").join(script_name),
            resource_dir
                .join("bundle-workspace")
                .join("scripts")
                .join(script_name),
        ]);
    }
    let mut unique = Vec::new();
    for candidate in candidates {
        if !unique.iter().any(|item: &PathBuf| item == &candidate) {
            unique.push(candidate);
        }
    }
    unique
}

fn resolve_android_env_script(app: &tauri::AppHandle) -> Option<PathBuf> {
    for candidate in android_env_script_candidates(app) {
        if candidate.exists() {
            return Some(candidate);
        }
    }
    None
}

fn environment_pass_cache_path(_app: &tauri::AppHandle, platform: &str) -> Result<PathBuf, String> {
    #[cfg(target_os = "windows")]
    let cache_dir = std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .ok_or_else(|| "LOCALAPPDATA is unavailable for the environment cache.".to_string())?
        .join("AgentVN")
        .join("environment-cache");
    #[cfg(not(target_os = "windows"))]
    let cache_dir = _app
        .path()
        .app_cache_dir()
        .map_err(|error| format!("Failed to locate environment cache dir: {error}"))?
        .join("environment-pass");
    fs::create_dir_all(&cache_dir).map_err(|error| {
        format!(
            "Failed to create environment cache dir {}: {error}",
            cache_dir.display()
        )
    })?;
    Ok(cache_dir.join(format!("{platform}-pass.json")))
}

fn read_environment_pass_cache(path: &Path, platform: &str) -> Option<serde_json::Value> {
    let raw = fs::read_to_string(path).ok()?;
    if raw.contains('\u{fffd}') {
        return None;
    }
    let value: serde_json::Value = serde_json::from_str(raw.trim_start_matches('\u{feff}')).ok()?;
    if value.get("status").and_then(|item| item.as_str()) != Some("PASS")
        || value.get("ok").and_then(|item| item.as_bool()) != Some(true)
        || value
            .get("cacheSchemaVersion")
            .and_then(|item| item.as_u64())
            != Some(ENVIRONMENT_PASS_CACHE_SCHEMA_VERSION)
        || value.get("cachePlatform").and_then(|item| item.as_str()) != Some(platform)
        || value.get("cacheEditorVersion").and_then(|item| item.as_str()) != Some(env!("CARGO_PKG_VERSION"))
    {
        return None;
    }
    Some(value)
}

fn cached_environment_result(
    cache_path: &Path,
    platform: &str,
    report_path: &Path,
    log_path: &Path,
    command_log_path: &Path,
) -> Option<serde_json::Value> {
    let mut value = read_environment_pass_cache(cache_path, platform)?;
    let object = value.as_object_mut()?;
    object.insert("cacheHit".to_string(), serde_json::Value::Bool(true));
    object.insert(
        "installAttempted".to_string(),
        serde_json::Value::Bool(false),
    );
    object.insert(
        "message".to_string(),
        serde_json::Value::String(format!(
            "{} build environment is ready (reused previous successful check).",
            if platform == "android" {
                "Android"
            } else {
                "Windows standalone package"
            }
        )),
    );
    object.insert(
        "reportPath".to_string(),
        serde_json::Value::String(report_path.to_string_lossy().to_string()),
    );
    object.insert(
        "logPath".to_string(),
        serde_json::Value::String(log_path.to_string_lossy().to_string()),
    );
    object.insert(
        "commandLogPath".to_string(),
        serde_json::Value::String(command_log_path.to_string_lossy().to_string()),
    );
    object.insert(
        "passCachePath".to_string(),
        serde_json::Value::String(cache_path.to_string_lossy().to_string()),
    );
    Some(value)
}

fn persist_environment_pass_cache(
    path: &Path,
    platform: &str,
    value: &mut serde_json::Value,
) -> Result<(), String> {
    if value.get("status").and_then(|item| item.as_str()) != Some("PASS")
        || value.get("ok").and_then(|item| item.as_bool()) != Some(true)
    {
        return match fs::remove_file(path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(format!(
                "Failed to invalidate environment PASS cache {}: {error}",
                path.display()
            )),
        };
    }
    if let Some(object) = value.as_object_mut() {
        object.insert(
            "cacheSchemaVersion".to_string(),
            serde_json::Value::Number(ENVIRONMENT_PASS_CACHE_SCHEMA_VERSION.into()),
        );
        object.insert(
            "cachePlatform".to_string(),
            serde_json::Value::String(platform.to_string()),
        );
        object.insert("cacheHit".to_string(), serde_json::Value::Bool(false));
        object.insert(
            "cacheEditorVersion".to_string(),
            serde_json::Value::String(env!("CARGO_PKG_VERSION").to_string()),
        );
        object.insert(
            "passCachePath".to_string(),
            serde_json::Value::String(path.to_string_lossy().to_string()),
        );
    }
    write_json_atomic(path, value)
}

fn android_managed_environment_paths(
    app: &tauri::AppHandle,
) -> Result<AndroidManagedEnvironmentPaths, String> {
    let local_app_data = std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .ok_or_else(|| "LOCALAPPDATA is unavailable for the Android environment.".to_string())?;
    let agentvn_root = local_app_data.join("AgentVN");
    let environment_cache_root = agentvn_root.join("environment-cache");
    let import_cache_root = app
        .path()
        .app_cache_dir()
        .map_err(|error| format!("Failed to locate Android environment import cache: {error}"))?
        .join("android-env-import");
    Ok(AndroidManagedEnvironmentPaths {
        tool_root: agentvn_root.join("AndroidToolchain"),
        gradle_home: agentvn_root.join("GradleHome"),
        pass_cache_path: environment_cache_root.join("android-pass.json"),
        lock_path: environment_cache_root.join("android-operation.lock"),
        import_cache_root,
    })
}

fn try_acquire_android_environment_operation_lock(
    app: &tauri::AppHandle,
    operation: &str,
) -> Result<AndroidEnvironmentOperationLock, String> {
    let paths = android_managed_environment_paths(app)?;
    try_acquire_android_environment_operation_lock_at(&paths.lock_path, operation)
}

fn try_acquire_android_environment_operation_lock_at(
    lock_path: &Path,
    operation: &str,
) -> Result<AndroidEnvironmentOperationLock, String> {
    if let Some(parent) = lock_path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "ANDROID_ENV_CLEANUP_FAILED: cannot create Android environment lock directory {}: {error}",
                parent.display()
            )
        })?;
    }
    let mut lock = match OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(lock_path)
    {
        Ok(lock) => lock,
        Err(error)
            if error.kind() == io::ErrorKind::AlreadyExists
                && android_environment_operation_lock_is_stale(lock_path) =>
        {
            fs::remove_file(lock_path).map_err(|remove_error| {
                format!(
                    "ANDROID_ENV_CLEANUP_FAILED: stale Android environment lock {} could not be removed: {remove_error}",
                    lock_path.display()
                )
            })?;
            OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(lock_path)
                .map_err(|retry_error| {
                    if retry_error.kind() == io::ErrorKind::AlreadyExists {
                        "ANDROID_ENV_BUSY: Android environment is being updated or used by another package build. Wait for it to finish and retry.".to_string()
                    } else {
                        format!(
                            "ANDROID_ENV_CLEANUP_FAILED: cannot acquire Android environment lock {}: {retry_error}",
                            lock_path.display()
                        )
                    }
                })?
        }
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
            return Err("ANDROID_ENV_BUSY: Android environment is being updated or used by another package build. Wait for it to finish and retry.".to_string());
        }
        Err(error) => {
            return Err(format!(
                "ANDROID_ENV_CLEANUP_FAILED: cannot acquire Android environment lock {}: {error}",
                lock_path.display()
            ));
        }
    };
    writeln!(lock, "pid={}\noperation={operation}", std::process::id()).map_err(|error| {
        let _ = fs::remove_file(lock_path);
        format!(
            "ANDROID_ENV_CLEANUP_FAILED: cannot write Android environment lock {}: {error}",
            lock_path.display()
        )
    })?;
    Ok(AndroidEnvironmentOperationLock {
        path: lock_path.to_path_buf(),
    })
}

fn android_environment_operation_lock_is_stale(lock_path: &Path) -> bool {
    let pid = fs::read_to_string(lock_path).ok().and_then(|contents| {
        contents.lines().find_map(|line| {
            line.strip_prefix("pid=")
                .and_then(|value| value.trim().parse::<u32>().ok())
        })
    });
    if let Some(pid) = pid {
        return !process_is_running(pid);
    }
    fs::metadata(lock_path)
        .and_then(|metadata| metadata.modified())
        .ok()
        .and_then(|modified| modified.elapsed().ok())
        .map(|age| age >= Duration::from_secs(60))
        .unwrap_or(false)
}

#[cfg(target_os = "windows")]
fn process_is_running(pid: u32) -> bool {
    use windows_sys::Win32::{
        Foundation::{CloseHandle, STILL_ACTIVE},
        System::Threading::{GetExitCodeProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION},
    };
    let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
    if handle.is_null() {
        return false;
    }
    let mut exit_code = 0u32;
    let running = unsafe { GetExitCodeProcess(handle, &mut exit_code) != 0 }
        && exit_code == STILL_ACTIVE as u32;
    unsafe {
        CloseHandle(handle);
    }
    running
}

#[cfg(not(target_os = "windows"))]
fn process_is_running(pid: u32) -> bool {
    pid == std::process::id()
}

fn directory_size_bytes(path: &Path) -> Result<u64, String> {
    if !path.exists() {
        return Ok(0);
    }
    let mut total = 0u64;
    let mut pending = vec![path.to_path_buf()];
    while let Some(directory) = pending.pop() {
        for entry in fs::read_dir(&directory)
            .map_err(|error| format!("Failed to inspect {}: {error}", directory.display()))?
        {
            let entry = entry.map_err(|error| {
                format!(
                    "Failed to inspect an Android environment file in {}: {error}",
                    directory.display()
                )
            })?;
            let metadata = entry.metadata().map_err(|error| {
                format!(
                    "Failed to read Android environment metadata {}: {error}",
                    entry.path().display()
                )
            })?;
            if metadata.is_dir() {
                pending.push(entry.path());
            } else if metadata.is_file() {
                total = total.checked_add(metadata.len()).ok_or_else(|| {
                    "ANDROID_ENV_INSTALL_INCOMPLETE: Android environment size overflow.".to_string()
                })?;
            }
        }
    }
    Ok(total)
}

#[cfg(target_os = "windows")]
fn available_disk_bytes(path: &Path) -> Result<u64, String> {
    use windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;
    let wide = wide_null(path);
    let mut available = 0u64;
    let ok = unsafe {
        GetDiskFreeSpaceExW(
            wide.as_ptr(),
            &mut available,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
        )
    };
    if ok == 0 {
        return Err(format!(
            "Failed to inspect free disk space for {}: {}",
            path.display(),
            io::Error::last_os_error()
        ));
    }
    Ok(available)
}

#[cfg(not(target_os = "windows"))]
fn available_disk_bytes(_path: &Path) -> Result<u64, String> {
    Err("Disk-space preflight is only implemented for Windows Android environments.".to_string())
}

fn remove_android_import_staging_directories(
    paths: &AndroidManagedEnvironmentPaths,
) -> Result<u64, String> {
    if !paths.import_cache_root.exists() {
        return Ok(0);
    }
    let mut reclaimed = 0u64;
    for entry in fs::read_dir(&paths.import_cache_root).map_err(|error| {
        format!(
            "ANDROID_ENV_CLEANUP_FAILED: cannot inspect Android import cache {}: {error}",
            paths.import_cache_root.display()
        )
    })? {
        let entry = entry.map_err(|error| {
            format!(
                "ANDROID_ENV_CLEANUP_FAILED: cannot inspect Android import cache entry: {error}"
            )
        })?;
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with("staging-") {
            reclaimed = reclaimed.saturating_add(directory_size_bytes(&entry.path())?);
            remove_path_if_exists(&entry.path())
                .map_err(|error| format!("ANDROID_ENV_CLEANUP_FAILED: {error}"))?;
        }
    }
    Ok(reclaimed)
}

fn clear_managed_android_environment(
    app: &tauri::AppHandle,
    run_id: &str,
    install_source: &str,
) -> Result<u64, String> {
    let paths = android_managed_environment_paths(app)?;
    emit_android_environment_import_progress(
        Some(app),
        run_id,
        "cleaning",
        "正在清理旧的 AgentVN Android 构建依赖…",
        10,
        0,
        0,
        0,
        0,
        0,
        install_source,
    );
    let reclaimed = clear_managed_android_environment_paths(&paths)?;
    emit_android_environment_import_progress(
        Some(app),
        run_id,
        "cleaning",
        format!(
            "旧 Android 构建依赖已清理，已释放 {}。",
            format_byte_size(reclaimed)
        ),
        16,
        0,
        0,
        0,
        0,
        reclaimed,
        install_source,
    );
    emit_package_build_log(
        app,
        run_id,
        "info",
        "android-env",
        format!(
            "Removed the previous AgentVN-managed Android environment before {install_source}; reclaimed {}.",
            format_byte_size(reclaimed)
        ),
    );
    Ok(reclaimed)
}

fn clear_managed_android_environment_paths(
    paths: &AndroidManagedEnvironmentPaths,
) -> Result<u64, String> {
    stop_managed_android_tool_processes(paths)
        .map_err(|error| format!("ANDROID_ENV_CLEANUP_FAILED: {error}"))?;
    let mut reclaimed = 0u64;
    for path in [&paths.tool_root, &paths.gradle_home] {
        reclaimed = reclaimed.saturating_add(directory_size_bytes(path)?);
        remove_path_if_exists(path).map_err(|error| {
            format!(
                "ANDROID_ENV_CLEANUP_FAILED: failed to remove {}: {error}",
                path.display()
            )
        })?;
    }
    if paths.pass_cache_path.exists() {
        reclaimed = reclaimed.saturating_add(
            fs::metadata(&paths.pass_cache_path)
                .map(|metadata| metadata.len())
                .unwrap_or(0),
        );
        remove_path_if_exists(&paths.pass_cache_path).map_err(|error| {
            format!(
                "ANDROID_ENV_CLEANUP_FAILED: failed to remove Android environment PASS cache {}: {error}",
                paths.pass_cache_path.display()
            )
        })?;
    }
    reclaimed = reclaimed.saturating_add(remove_android_import_staging_directories(&paths)?);
    Ok(reclaimed)
}

fn format_byte_size(bytes: u64) -> String {
    if bytes >= 1024 * 1024 * 1024 {
        format!("{:.2} GiB", bytes as f64 / (1024 * 1024 * 1024) as f64)
    } else if bytes >= 1024 * 1024 {
        format!("{:.1} MiB", bytes as f64 / (1024 * 1024) as f64)
    } else {
        format!("{bytes} B")
    }
}

fn validate_android_environment_pack_path(value: &str, is_dir: bool) -> Result<PathBuf, String> {
    let normalized = if is_dir {
        value.trim_end_matches('/')
    } else {
        value
    };
    if normalized.is_empty()
        || normalized.contains('\0')
        || normalized.contains('\\')
        || normalized.starts_with('/')
        || normalized
            .split('/')
            .any(|part| part.is_empty() || part == "." || part == ".." || part.contains(':'))
    {
        return Err(format!(
            "ANDROID_ENV_PACK_PATH_UNSAFE: unsafe archive path {value}"
        ));
    }
    Ok(normalized.split('/').collect())
}

fn resolve_android_environment_package_target(
    relative: &Path,
    staging_root: &Path,
    deployment_paths: Option<&AndroidManagedEnvironmentPaths>,
) -> Result<Option<PathBuf>, String> {
    let Some(paths) = deployment_paths else {
        return Ok(Some(staging_root.join(relative)));
    };
    let normalized = relative.to_string_lossy().replace('\\', "/");
    if normalized == "payload" {
        return Ok(None);
    }
    for (prefix, root) in [
        ("payload/toolchain", &paths.tool_root),
        ("payload/gradle-home", &paths.gradle_home),
    ] {
        if normalized == prefix {
            return Ok(Some(root.clone()));
        }
        if let Some(suffix) = normalized.strip_prefix(&format!("{prefix}/")) {
            return Ok(Some(root.join(Path::new(suffix))));
        }
    }
    Err(format!(
        "ANDROID_ENV_DEPLOYMENT_INVALID: package entry is outside managed Android deployment roots: {normalized}"
    ))
}

fn inspect_android_environment_package(
    archive_path: &Path,
) -> Result<AndroidEnvironmentPackFormat, String> {
    let file = File::open(archive_path).map_err(|error| {
        format!(
            "ANDROID_ENV_PACK_INVALID: failed to open {}: {error}",
            archive_path.display()
        )
    })?;
    let mut archive = ZipArchive::new(file).map_err(|error| {
        format!(
            "ANDROID_ENV_PACK_INVALID: failed to read ZIP {}: {error}",
            archive_path.display()
        )
    })?;
    let mut entry = archive
        .by_name("format.json")
        .map_err(|_| "ANDROID_ENV_PACK_INVALID: format.json is missing.".to_string())?;
    if entry.size() > 256 * 1024 * 1024 {
        return Err(
            "ANDROID_ENV_PACK_INVALID: format.json exceeds the 256 MiB safety limit.".to_string(),
        );
    }
    let mut bytes = Vec::with_capacity(entry.size() as usize);
    entry
        .read_to_end(&mut bytes)
        .map_err(|error| format!("ANDROID_ENV_PACK_INVALID: cannot read format.json: {error}"))?;
    let text = std::str::from_utf8(&bytes)
        .map_err(|error| format!("ANDROID_ENV_PACK_INVALID: format.json is not UTF-8: {error}"))?
        .trim_start_matches('\u{feff}');
    if text.contains('\u{fffd}') {
        return Err(
            "ANDROID_ENV_PACK_INVALID: format.json contains replacement characters.".to_string(),
        );
    }
    let format: AndroidEnvironmentPackFormat = serde_json::from_str(text)
        .map_err(|error| format!("ANDROID_ENV_PACK_INVALID: invalid format.json: {error}"))?;
    if format.schema_version != 1
        || format.kind != "agentvn-android-environment"
        || format.platform != "windows-x86_64"
        || format.payload_root != "payload"
        || !format.complete
        || format.file_count != format.files.len()
    {
        return Err(
            "ANDROID_ENV_PACK_INCOMPATIBLE: format.json contains unsupported values.".to_string(),
        );
    }
    let mut total = 0u64;
    let mut declared = HashSet::new();
    for item in &format.files {
        let path = validate_android_environment_pack_path(&item.path, false)?;
        if !item.path.starts_with("payload/")
            || item.sha256.len() != 64
            || !item.sha256.bytes().all(|value| value.is_ascii_hexdigit())
            || !declared.insert(path.to_string_lossy().replace('\\', "/"))
        {
            return Err(format!(
                "ANDROID_ENV_PACK_INVALID: invalid or duplicate payload declaration {}",
                item.path
            ));
        }
        total = total
            .checked_add(item.bytes)
            .ok_or_else(|| "ANDROID_ENV_PACK_INVALID: payload byte count overflow.".to_string())?;
    }
    if total != format.total_bytes {
        return Err(format!(
            "ANDROID_ENV_PACK_INVALID: declared totalBytes {} does not match file total {}.",
            format.total_bytes, total
        ));
    }
    for required in &format.required_paths {
        let required = validate_android_environment_pack_path(required, false)?
            .to_string_lossy()
            .replace('\\', "/");
        if !declared.contains(&required) {
            return Err(format!(
                "ANDROID_ENV_PACK_INCOMPATIBLE: required path is not declared: {required}"
            ));
        }
    }
    Ok(format)
}

fn write_android_environment_deployment_marker(
    paths: &AndroidManagedEnvironmentPaths,
    archive_path: &Path,
    format: &AndroidEnvironmentPackFormat,
) -> Result<(), String> {
    let marker = serde_json::json!({
        "schemaVersion": 2,
        "installSource": "avnenv",
        "packageId": format.package_id,
        "packVersion": format.pack_version,
        "manifestSha256": sha256_file(archive_path)?,
        "installedAt": error_report_timestamp(),
        "sourceRoot": archive_path,
        "totalBytes": format.total_bytes,
        "fileCount": format.file_count
    });
    write_json_atomic(
        &paths.tool_root.join("offline-pack-deployment.json"),
        &marker,
    )
    .map_err(|error| format!("ANDROID_ENV_DEPLOYMENT_INVALID: {error}"))
}

fn extract_android_environment_package(
    app: Option<&tauri::AppHandle>,
    run_id: &str,
    archive_path: &Path,
    destination: &Path,
    deployment_paths: Option<&AndroidManagedEnvironmentPaths>,
) -> Result<AndroidEnvironmentPackFormat, String> {
    emit_android_environment_import_progress(
        app,
        run_id,
        "validating",
        "正在读取并验证构建依赖包格式…",
        3,
        0,
        0,
        0,
        0,
        0,
        "avnenv",
    );
    let file = File::open(archive_path).map_err(|error| {
        format!(
            "ANDROID_ENV_PACK_INVALID: failed to open {}: {error}",
            archive_path.display()
        )
    })?;
    let mut archive = ZipArchive::new(file).map_err(|error| {
        format!(
            "ANDROID_ENV_PACK_INVALID: failed to read ZIP {}: {error}",
            archive_path.display()
        )
    })?;
    let format_bytes = {
        let mut entry = archive
            .by_name("format.json")
            .map_err(|_| "ANDROID_ENV_PACK_INVALID: format.json is missing.".to_string())?;
        if entry.size() > 256 * 1024 * 1024 {
            return Err(
                "ANDROID_ENV_PACK_INVALID: format.json exceeds the 256 MiB safety limit."
                    .to_string(),
            );
        }
        let mut bytes = Vec::with_capacity(entry.size() as usize);
        entry.read_to_end(&mut bytes).map_err(|error| {
            format!("ANDROID_ENV_PACK_INVALID: cannot read format.json: {error}")
        })?;
        bytes
    };
    let format_text = std::str::from_utf8(&format_bytes)
        .map_err(|error| format!("ANDROID_ENV_PACK_INVALID: format.json is not UTF-8: {error}"))?
        .trim_start_matches('\u{feff}');
    if format_text.contains('\u{fffd}') {
        return Err(
            "ANDROID_ENV_PACK_INVALID: format.json contains replacement characters.".to_string(),
        );
    }
    let format: AndroidEnvironmentPackFormat = serde_json::from_str(format_text)
        .map_err(|error| format!("ANDROID_ENV_PACK_INVALID: invalid format.json: {error}"))?;
    if format.schema_version != 1
        || format.kind != "agentvn-android-environment"
        || format.platform != "windows-x86_64"
        || format.payload_root != "payload"
        || !format.complete
        || format.package_id.trim().is_empty()
        || format.pack_version.trim().is_empty()
        || format.api_level.trim().is_empty()
        || format.build_tools_version.trim().is_empty()
        || format.ndk_version.trim().is_empty()
        || format.gradle_version.trim().is_empty()
        || format.file_count != format.files.len()
    {
        return Err(
            "ANDROID_ENV_PACK_INCOMPATIBLE: format.json contains unsupported values.".to_string(),
        );
    }

    let mut declared = HashMap::new();
    let mut declared_total = 0u64;
    for item in &format.files {
        let relative = validate_android_environment_pack_path(&item.path, false)?;
        if !item.path.starts_with("payload/")
            || item.sha256.len() != 64
            || !item.sha256.bytes().all(|value| value.is_ascii_hexdigit())
        {
            return Err(format!(
                "ANDROID_ENV_PACK_INVALID: invalid payload declaration {}",
                item.path
            ));
        }
        if declared
            .insert(
                relative.to_string_lossy().replace('\\', "/"),
                (item.bytes, item.sha256.to_ascii_lowercase()),
            )
            .is_some()
        {
            return Err(format!(
                "ANDROID_ENV_PACK_INVALID: duplicate payload declaration {}",
                item.path
            ));
        }
        declared_total = declared_total
            .checked_add(item.bytes)
            .ok_or_else(|| "ANDROID_ENV_PACK_INVALID: payload byte count overflow.".to_string())?;
    }
    if declared_total != format.total_bytes {
        return Err(format!(
            "ANDROID_ENV_PACK_INVALID: declared totalBytes {} does not match file total {}.",
            format.total_bytes, declared_total
        ));
    }
    for required in &format.required_paths {
        let required_path = validate_android_environment_pack_path(required, false)?
            .to_string_lossy()
            .replace('\\', "/");
        if !declared.contains_key(&required_path) {
            return Err(format!(
                "ANDROID_ENV_PACK_INCOMPATIBLE: required path is not declared: {required}"
            ));
        }
    }
    emit_android_environment_import_progress(
        app,
        run_id,
        "extracting",
        "正在解压并校验构建依赖文件…",
        5,
        0,
        format.total_bytes,
        0,
        format.file_count,
        0,
        "avnenv",
    );

    if deployment_paths.is_none() {
        fs::create_dir_all(destination).map_err(|error| {
            format!(
                "ANDROID_ENV_PACK_IMPORT_FAILED: cannot create {}: {error}",
                destination.display()
            )
        })?;
    } else if let Some(paths) = deployment_paths {
        fs::create_dir_all(&paths.tool_root).map_err(|error| {
            format!(
                "ANDROID_ENV_PACK_IMPORT_FAILED: cannot create {}: {error}",
                paths.tool_root.display()
            )
        })?;
        fs::create_dir_all(&paths.gradle_home).map_err(|error| {
            format!(
                "ANDROID_ENV_PACK_IMPORT_FAILED: cannot create {}: {error}",
                paths.gradle_home.display()
            )
        })?;
    }
    let file = File::open(archive_path).map_err(|error| {
        format!(
            "ANDROID_ENV_PACK_INVALID: failed to reopen {}: {error}",
            archive_path.display()
        )
    })?;
    let mut archive = ZipArchive::new(file)
        .map_err(|error| format!("ANDROID_ENV_PACK_INVALID: failed to reopen ZIP: {error}"))?;
    let mut seen = HashSet::new();
    let mut extracted_total = 0u64;
    let mut last_progress_bytes = 0u64;
    let mut last_progress_files = 0usize;
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|error| format!("ANDROID_ENV_PACK_INVALID: bad ZIP entry {index}: {error}"))?;
        let name = entry.name().to_string();
        if name == "format.json" {
            continue;
        }
        if entry
            .unix_mode()
            .map(|mode| mode & 0o170000 == 0o120000)
            .unwrap_or(false)
        {
            return Err(format!(
                "ANDROID_ENV_PACK_PATH_UNSAFE: symbolic-link entry {name}"
            ));
        }
        let relative = validate_android_environment_pack_path(&name, entry.is_dir())?;
        let normalized = relative.to_string_lossy().replace('\\', "/");
        if entry.is_dir() {
            if !normalized.starts_with("payload") {
                return Err(format!(
                    "ANDROID_ENV_PACK_PATH_UNSAFE: directory outside payload {name}"
                ));
            }
            if let Some(target) = resolve_android_environment_package_target(
                &relative,
                destination,
                deployment_paths,
            )? {
                fs::create_dir_all(target).map_err(|error| {
                    format!("ANDROID_ENV_PACK_IMPORT_FAILED: cannot create {name}: {error}")
                })?;
            }
            continue;
        }
        let Some((expected_bytes, expected_hash)) = declared.get(&normalized) else {
            return Err(format!(
                "ANDROID_ENV_PACK_INVALID: undeclared archive entry {name}"
            ));
        };
        if !seen.insert(normalized.clone()) {
            return Err(format!(
                "ANDROID_ENV_PACK_INVALID: duplicate archive entry {name}"
            ));
        }
        if entry.size() != *expected_bytes {
            return Err(format!(
                "ANDROID_ENV_PACK_HASH_MISMATCH: size mismatch for {name}"
            ));
        }
        let target =
            resolve_android_environment_package_target(&relative, destination, deployment_paths)?
                .ok_or_else(|| {
                format!(
                    "ANDROID_ENV_DEPLOYMENT_INVALID: package file cannot be deployed at {}",
                    relative.display()
                )
            })?;
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|error| {
                format!(
                    "ANDROID_ENV_PACK_IMPORT_FAILED: cannot create {}: {error}",
                    parent.display()
                )
            })?;
        }
        let mut output = File::create(&target).map_err(|error| {
            format!(
                "ANDROID_ENV_PACK_IMPORT_FAILED: cannot create {}: {error}",
                target.display()
            )
        })?;
        let mut hasher = Sha256::new();
        let mut copied = 0u64;
        let mut buffer = vec![0u8; 1024 * 1024];
        loop {
            let count = entry.read(&mut buffer).map_err(|error| {
                format!("ANDROID_ENV_PACK_IMPORT_FAILED: cannot read {name}: {error}")
            })?;
            if count == 0 {
                break;
            }
            copied = copied.checked_add(count as u64).ok_or_else(|| {
                "ANDROID_ENV_PACK_INVALID: extracted byte count overflow.".to_string()
            })?;
            if copied > *expected_bytes {
                return Err(format!(
                    "ANDROID_ENV_PACK_HASH_MISMATCH: expanded size exceeded declaration for {name}"
                ));
            }
            hasher.update(&buffer[..count]);
            output.write_all(&buffer[..count]).map_err(|error| {
                format!(
                    "ANDROID_ENV_PACK_IMPORT_FAILED: cannot write {}: {error}",
                    target.display()
                )
            })?;
            let processed_bytes = extracted_total.saturating_add(copied);
            if processed_bytes.saturating_sub(last_progress_bytes) >= 32 * 1024 * 1024 {
                let percent = 5u8.saturating_add(
                    ((processed_bytes.saturating_mul(70) / format.total_bytes.max(1)).min(70))
                        as u8,
                );
                emit_android_environment_import_progress(
                    app,
                    run_id,
                    "extracting",
                    format!("正在安装并校验：{name}"),
                    percent,
                    processed_bytes,
                    format.total_bytes,
                    seen.len(),
                    format.file_count,
                    0,
                    "avnenv",
                );
                last_progress_bytes = processed_bytes;
            }
        }
        let actual_hash = hex::encode(hasher.finalize());
        if copied != *expected_bytes || actual_hash != *expected_hash {
            return Err(format!(
                "ANDROID_ENV_PACK_HASH_MISMATCH: integrity check failed for {name}"
            ));
        }
        extracted_total = extracted_total
            .checked_add(copied)
            .ok_or_else(|| "ANDROID_ENV_PACK_INVALID: extracted total overflow.".to_string())?;
        if seen.len().saturating_sub(last_progress_files) >= 256
            || extracted_total == format.total_bytes
        {
            let percent = 5u8.saturating_add(
                ((extracted_total.saturating_mul(70) / format.total_bytes.max(1)).min(70)) as u8,
            );
            emit_android_environment_import_progress(
                app,
                run_id,
                "extracting",
                format!("正在安装并校验：{name}"),
                percent,
                extracted_total,
                format.total_bytes,
                seen.len(),
                format.file_count,
                0,
                "avnenv",
            );
            last_progress_files = seen.len();
            last_progress_bytes = extracted_total;
        }
    }
    if seen.len() != declared.len() || extracted_total != format.total_bytes {
        return Err(format!(
            "ANDROID_ENV_PACK_INCOMPLETE: extracted {} of {} files and {} of {} bytes.",
            seen.len(),
            declared.len(),
            extracted_total,
            format.total_bytes
        ));
    }
    if deployment_paths.is_none() {
        fs::write(destination.join("format.json"), &format_bytes).map_err(|error| {
            format!("ANDROID_ENV_PACK_IMPORT_FAILED: cannot stage format.json: {error}")
        })?;
    }
    emit_android_environment_import_progress(
        app,
        run_id,
        "validated",
        "构建依赖包已完成完整性校验，正在准备部署…",
        75,
        extracted_total,
        format.total_bytes,
        seen.len(),
        format.file_count,
        0,
        "avnenv",
    );
    Ok(format)
}

fn run_android_env_tool_blocking(
    app: tauri::AppHandle,
    install: bool,
    operation: &str,
    run_id: Option<String>,
    force_recheck: bool,
    offline_pack_root: Option<PathBuf>,
    offline_only: bool,
    reset_managed_environment: bool,
) -> Result<serde_json::Value, String> {
    let run_id = run_id.unwrap_or_default();
    emit_package_environment_operation_progress(
        Some(&app),
        &run_id,
        "android",
        operation,
        "preparing",
        if install {
            "正在准备 Android 构建环境补齐操作…"
        } else {
            "正在准备 Android 构建环境检测…"
        },
        4,
    );
    let Some(script_path) = resolve_android_env_script(&app) else {
        let searched: Vec<String> = android_env_script_candidates(&app)
            .into_iter()
            .map(|path| path.to_string_lossy().to_string())
            .collect();
        return Ok(serde_json::json!({
            "ok": false,
            "status": "BLOCKED",
            "message": "Android environment helper was not found. Rebuild the editor or run scripts/setup-android-build-env.ps1 from the AgentVN workspace.",
            "checks": [],
            "missing": ["Android environment helper script"],
            "warnings": searched.iter().map(|path| format!("Searched: {path}")).collect::<Vec<_>>(),
            "manualFix": [
                "Run scripts/setup-android-build-env.ps1 -Install from the AgentVN workspace.",
                "Install Android Studio or Android SDK Command-line Tools, set JAVA_HOME, ANDROID_HOME, ANDROID_SDK_ROOT and NDK_HOME, then run rustup target add for the Android targets."
            ]
        }));
    };

    let report_dir = app
        .path()
        .app_cache_dir()
        .map_err(|error| format!("Failed to locate Android environment cache dir: {error}"))?
        .join("android-env");
    fs::create_dir_all(&report_dir).map_err(|error| {
        format!(
            "Failed to create Android environment cache dir {}: {error}",
            report_dir.display()
        )
    })?;
    let suffix = if install { "repair" } else { "check" };
    let report_path = report_dir.join(format!("android-env-{suffix}.json"));
    let command_log_path = report_dir.join(format!("android-env-{suffix}-command.log"));
    let live_log_path = report_path.with_extension("log");
    let pass_cache_path = environment_pass_cache_path(&app, "android")?;
    let _ = fs::remove_file(&live_log_path);

    if !install && !force_recheck {
        if let Some(value) = cached_environment_result(
            &pass_cache_path,
            "android",
            &report_path,
            &live_log_path,
            &command_log_path,
        ) {
            write_json_atomic(&report_path, &value)?;
            fs::write(
                &live_log_path,
                format!(
                    "[cache] Reused successful Android environment check: {}\n",
                    pass_cache_path.display()
                ),
            )
            .map_err(|error| format!("Failed to write Android cache log: {error}"))?;
            emit_package_build_log(
                &app,
                &run_id,
                "success",
                "android-env",
                "Android environment already passed; skipped the repeated full check.",
            );
            emit_package_environment_operation_progress(
                Some(&app),
                &run_id,
                "android",
                operation,
                "completed",
                "已复用此前通过的 Android 环境检测结果。",
                100,
            );
            return Ok(value);
        }
    }

    emit_package_environment_operation_progress(
        Some(&app),
        &run_id,
        "android",
        operation,
        "checking",
        if install {
            "正在检查 Android 构建环境与安装条件…"
        } else {
            "正在检查 Android 构建依赖…"
        },
        14,
    );
    emit_package_build_log(
        &app,
        &run_id,
        "info",
        "android-env",
        if install {
            "Android environment repair started. Stages will stream from setup-android-build-env.ps1."
        } else {
            "Android environment check started."
        },
    );

    let mut command = background_command(powershell_command());
    command
        .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"])
        .arg(&script_path)
        .arg("-ReportPath")
        .arg(&report_path)
        .arg("-PassCachePath")
        .arg(&pass_cache_path)
        .arg("-SymlinkProbeRoot")
        .arg(report_dir.join("build-workspace-probe"))
        .current_dir(workspace_root())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if install {
        command.arg("-Install");
    }
    if reset_managed_environment {
        command.arg("-ResetManagedEnvironment");
    }
    if let Some(root) = offline_pack_root {
        command.arg("-OfflinePackRoot").arg(root);
        if offline_only {
            command.arg("-ReplaceOfflinePack");
        }
    }
    if offline_only {
        command.arg("-OfflineOnly");
    }
    let mut child = command
        .spawn()
        .map_err(|error| format!("Failed to run Android environment helper: {error}"))?;
    let mut live_log_offset = 0;
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) => {
                emit_new_log_file_lines(
                    &app,
                    &run_id,
                    &live_log_path,
                    &mut live_log_offset,
                    "android-env",
                );
                std::thread::sleep(Duration::from_millis(500));
            }
            Err(error) => {
                return Err(format!(
                    "Failed to wait for Android environment helper: {error}"
                ))
            }
        }
    }
    emit_new_log_file_lines(
        &app,
        &run_id,
        &live_log_path,
        &mut live_log_offset,
        "android-env",
    );
    let output = child
        .wait_with_output()
        .map_err(|error| format!("Failed to collect Android environment helper output: {error}"))?;
    write_command_output(&command_log_path, &output)?;
    for line in String::from_utf8_lossy(&output.stdout).lines() {
        let trimmed = line.trim();
        if !trimmed.is_empty() && !trimmed.starts_with('{') {
            emit_package_build_log(&app, &run_id, "info", "android-env", trimmed.to_string());
        }
    }
    for line in String::from_utf8_lossy(&output.stderr).lines() {
        let trimmed = line.trim();
        if !trimmed.is_empty() {
            emit_package_build_log(&app, &run_id, "warning", "android-env", trimmed.to_string());
        }
    }

    let raw = if report_path.exists() {
        fs::read_to_string(&report_path).map_err(|error| {
            format!(
                "Failed to read Android environment report {}: {error}",
                report_path.display()
            )
        })?
    } else {
        String::from_utf8_lossy(&output.stdout).to_string()
    };
    let mut value: serde_json::Value = serde_json::from_str(raw.trim_start_matches('\u{feff}'))
        .map_err(|error| format!("Failed to parse Android environment report: {error}"))?;
    if let Some(object) = value.as_object_mut() {
        object.insert(
            "commandLogPath".to_string(),
            serde_json::Value::String(command_log_path.to_string_lossy().to_string()),
        );
        object.insert(
            "logPath".to_string(),
            serde_json::Value::String(live_log_path.to_string_lossy().to_string()),
        );
        object.insert(
            "exitCode".to_string(),
            serde_json::Value::Number(serde_json::Number::from(output.status.code().unwrap_or(-1))),
        );
    }
    persist_environment_pass_cache(&pass_cache_path, "android", &mut value)?;
    let status = value
        .get("status")
        .and_then(|item| item.as_str())
        .unwrap_or("BLOCKED");
    emit_package_environment_operation_progress(
        Some(&app),
        &run_id,
        "android",
        operation,
        if status == "PASS" {
            "completed"
        } else {
            "failed"
        },
        if status == "PASS" {
            "Android 构建环境操作已完成。"
        } else {
            "Android 构建环境未通过本次操作。"
        },
        100,
    );
    Ok(value)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum NativeWindowsRustRepairStep {
    InstallRustupPackage,
    InstallStableMsvcToolchain,
    ActivateStableMsvcToolchain,
}

fn native_windows_rust_repair_plan(
    missing_ids: &HashSet<String>,
    rustup_available: bool,
    winget_available: bool,
) -> Vec<NativeWindowsRustRepairStep> {
    if !missing_ids.contains("cargo") && !missing_ids.contains("rustup") {
        return Vec::new();
    }

    let mut plan = Vec::new();
    if !rustup_available && winget_available {
        plan.push(NativeWindowsRustRepairStep::InstallRustupPackage);
    }
    if rustup_available || winget_available {
        plan.push(NativeWindowsRustRepairStep::InstallStableMsvcToolchain);
        plan.push(NativeWindowsRustRepairStep::ActivateStableMsvcToolchain);
    }
    plan
}

fn run_windows_env_tool_blocking(
    app: tauri::AppHandle,
    install: bool,
    run_id: Option<String>,
    force_recheck: bool,
) -> Result<serde_json::Value, String> {
    let run_id = run_id.unwrap_or_default();
    emit_package_environment_operation_progress(
        Some(&app),
        &run_id,
        "windows",
        if install { "install" } else { "check" },
        "preparing",
        if install {
            "正在准备 Windows 构建环境补齐操作…"
        } else {
            "正在准备 Windows 构建环境检测…"
        },
        4,
    );
    let report_dir = app
        .path()
        .app_cache_dir()
        .map_err(|error| format!("Failed to locate Windows environment cache dir: {error}"))?
        .join("windows-env");
    fs::create_dir_all(&report_dir).map_err(|error| {
        format!(
            "Failed to create Windows environment cache dir {}: {error}",
            report_dir.display()
        )
    })?;
    let suffix = if install { "repair" } else { "check" };
    let report_path = report_dir.join(format!("windows-env-{suffix}.json"));
    let command_log_path = report_dir.join(format!("windows-env-{suffix}-command.log"));
    let live_log_path = report_path.with_extension("log");
    let pass_cache_path = environment_pass_cache_path(&app, "windows")?;
    let _ = fs::remove_file(&live_log_path);
    let _ = fs::remove_file(&command_log_path);

    if !install && !force_recheck {
        if let Some(value) = cached_environment_result(
            &pass_cache_path,
            "windows",
            &report_path,
            &live_log_path,
            &command_log_path,
        ) {
            write_json_atomic(&report_path, &value)?;
            fs::write(
                &live_log_path,
                format!(
                    "[cache] Reused successful Windows environment check: {}\n",
                    pass_cache_path.display()
                ),
            )
            .map_err(|error| format!("Failed to write Windows cache log: {error}"))?;
            emit_package_build_log(
                &app,
                &run_id,
                "success",
                "windows-env",
                "Windows environment already passed; skipped the repeated full check.",
            );
            emit_package_environment_operation_progress(
                Some(&app),
                &run_id,
                "windows",
                "check",
                "completed",
                "已复用此前通过的 Windows 环境检测结果。",
                100,
            );
            return Ok(value);
        }
    }

    let stage = |message: &str| {
        let _ = append_error_log_line(&live_log_path, message);
        emit_package_build_log(&app, &run_id, "info", "windows-env", message.to_string());
    };
    stage(if install {
        "Windows package environment repair started with the native Rust checker."
    } else {
        "Windows package environment check started with the native Rust checker."
    });
    emit_package_environment_operation_progress(
        Some(&app),
        &run_id,
        "windows",
        if install { "install" } else { "check" },
        "checking",
        "正在检查 Node.js、Rust、MSVC 与 Windows SDK…",
        18,
    );

    let mut actions: Vec<String> = Vec::new();
    let mut warnings: Vec<String> = Vec::new();
    let mut checks = build_native_windows_environment_checks();
    emit_package_environment_operation_progress(
        Some(&app),
        &run_id,
        "windows",
        if install { "install" } else { "check" },
        "checking",
        "已完成 Windows 构建依赖检查，正在汇总缺失项…",
        38,
    );
    let missing_ids = checks
        .iter()
        .filter_map(|check| {
            (check.get("status").and_then(|value| value.as_str()) != Some("PASS")).then(|| {
                check
                    .get("id")
                    .and_then(|value| value.as_str())
                    .unwrap_or_default()
                    .to_string()
            })
        })
        .collect::<HashSet<_>>();

    if install && !missing_ids.is_empty() {
        if missing_ids.contains("tauri_nsis_toolset") {
            emit_package_environment_operation_progress(
                Some(&app),
                &run_id,
                "windows",
                "install",
                "installing",
                "正在部署 Windows 离线打包器 NSIS…",
                46,
            );
            stage("Deploying the bundled Tauri NSIS 3.11 offline toolset...");
            actions.push("deploy bundled Tauri NSIS 3.11 toolset".to_string());
            if let Err(warning) = install_bundled_windows_nsis_toolset(&app) {
                warnings.push(warning);
            }
        }
        let winget = find_native_windows_tool("winget");
        let winget_path = winget.as_ref().map(|(path, _)| path);
        let rustup_available = find_native_windows_tool("rustup").is_some();
        let rust_repair_plan =
            native_windows_rust_repair_plan(&missing_ids, rustup_available, winget.is_some());
        let needs_winget = missing_ids.contains("node")
            || missing_ids.contains("npm")
            || missing_ids.contains("msvc_build_tools")
            || (!rustup_available
                && (missing_ids.contains("rustup") || missing_ids.contains("cargo")));

        if let Some(winget_path) = winget_path {
            if missing_ids.contains("node") || missing_ids.contains("npm") {
                emit_package_environment_operation_progress(
                    Some(&app),
                    &run_id,
                    "windows",
                    "install",
                    "installing",
                    "正在补齐 Node.js LTS…",
                    52,
                );
                stage("Installing Node.js LTS through winget (OpenJS.NodeJS.LTS)...");
                actions.push("winget install OpenJS.NodeJS.LTS".to_string());
                if let Err(warning) = install_native_windows_package(
                    &winget_path,
                    "OpenJS.NodeJS.LTS",
                    "Node.js LTS",
                    &[],
                    &command_log_path,
                ) {
                    warnings.push(warning);
                }
            }
            if missing_ids.contains("msvc_build_tools") {
                emit_package_environment_operation_progress(
                    Some(&app),
                    &run_id,
                    "windows",
                    "install",
                    "installing",
                    "正在补齐 Visual Studio C++ Build Tools…",
                    60,
                );
                stage("Installing Visual Studio 2022 Build Tools through winget...");
                actions.push("winget install Microsoft.VisualStudio.2022.BuildTools".to_string());
                if let Err(warning) = install_native_windows_package(
                    &winget_path,
                    "Microsoft.VisualStudio.2022.BuildTools",
                    "Visual Studio 2022 Build Tools",
                    &[
                        "--override",
                        "--quiet --wait --norestart --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended",
                    ],
                    &command_log_path,
                ) {
                    warnings.push(warning);
                }
            }
        } else if needs_winget {
            warnings.push(
                "winget/App Installer is unavailable; automatic repair cannot install missing tools."
                    .to_string(),
            );
        }

        let mut rustup_install_warning = None;
        for step in rust_repair_plan {
            match step {
                NativeWindowsRustRepairStep::InstallRustupPackage => {
                    let Some(winget_path) = winget_path else {
                        continue;
                    };
                    emit_package_environment_operation_progress(
                        Some(&app),
                        &run_id,
                        "windows",
                        "install",
                        "installing",
                        "正在安装 Rustup…",
                        68,
                    );
                    stage("Installing Rust rustup through winget (Rustlang.Rustup)...");
                    actions.push("winget install Rustlang.Rustup".to_string());
                    if let Err(warning) = install_native_windows_package(
                        winget_path,
                        "Rustlang.Rustup",
                        "Rust rustup",
                        &[],
                        &command_log_path,
                    ) {
                        rustup_install_warning = Some(warning);
                    }
                }
                NativeWindowsRustRepairStep::InstallStableMsvcToolchain => {
                    let Some((rustup, _)) = find_native_windows_tool("rustup") else {
                        if let Some(warning) = rustup_install_warning.take() {
                            warnings.push(warning);
                        }
                        warnings.push(
                            "Rustup is still unavailable after the automatic install attempt."
                                .to_string(),
                        );
                        continue;
                    };
                    emit_package_environment_operation_progress(
                        Some(&app),
                        &run_id,
                        "windows",
                        "install",
                        "installing",
                        "正在安装或更新 Rust stable-msvc 工具链…",
                        76,
                    );
                    stage("Installing or updating the Rust stable MSVC toolchain...");
                    actions
                        .push("rustup toolchain install stable-msvc --profile minimal".to_string());
                    match run_native_windows_env_command(
                        &rustup,
                        &[
                            "toolchain",
                            "install",
                            "stable-msvc",
                            "--profile",
                            "minimal",
                        ],
                        &command_log_path,
                    ) {
                        Ok((true, _)) => {
                            rustup_install_warning = None;
                        }
                        Ok((false, output)) => warnings.push(format!(
                            "Rust stable MSVC toolchain installation did not complete: {}",
                            first_non_empty_line(&output)
                        )),
                        Err(error) => warnings.push(format!(
                            "Rust stable MSVC toolchain installation failed: {error}"
                        )),
                    }
                }
                NativeWindowsRustRepairStep::ActivateStableMsvcToolchain => {
                    let Some((rustup, _)) = find_native_windows_tool("rustup") else {
                        continue;
                    };
                    emit_package_environment_operation_progress(
                        Some(&app),
                        &run_id,
                        "windows",
                        "install",
                        "verifying",
                        "正在激活 Rust stable-msvc 工具链…",
                        84,
                    );
                    stage("Activating the Rust stable MSVC toolchain...");
                    actions.push("rustup default stable-msvc".to_string());
                    match run_native_windows_env_command(
                        &rustup,
                        &["default", "stable-msvc"],
                        &command_log_path,
                    ) {
                        Ok((true, _)) => {}
                        Ok((false, output)) => warnings.push(format!(
                            "Rust stable MSVC toolchain activation did not complete: {}",
                            first_non_empty_line(&output)
                        )),
                        Err(error) => warnings.push(format!(
                            "Rust stable MSVC toolchain activation failed: {error}"
                        )),
                    }
                }
            }
        }
        if let Some(warning) = rustup_install_warning {
            warnings.push(warning);
        }

        stage("Rechecking the Windows package environment after the repair attempt...");
        emit_package_environment_operation_progress(
            Some(&app),
            &run_id,
            "windows",
            "install",
            "verifying",
            "正在复检 Windows 构建环境…",
            90,
        );
        checks = build_native_windows_environment_checks();
    }

    let missing = checks
        .iter()
        .filter_map(|check| {
            (check.get("status").and_then(|value| value.as_str()) != Some("PASS")).then(|| {
                check
                    .get("label")
                    .and_then(|value| value.as_str())
                    .unwrap_or("Unknown tool")
                    .to_string()
            })
        })
        .collect::<Vec<_>>();
    let status = if missing.is_empty() {
        "PASS"
    } else {
        "BLOCKED"
    };
    let mut manual_fix = Vec::new();
    if missing.iter().any(|item| item == "node" || item == "npm") {
        manual_fix.push("Install Node.js LTS, then restart AgentVN.".to_string());
    }
    if missing
        .iter()
        .any(|item| item == "cargo" || item == "rustup")
    {
        manual_fix.push(
            "Install Rust through rustup, then run `rustup toolchain install stable-msvc --profile minimal` and `rustup default stable-msvc` before restarting AgentVN."
                .to_string(),
        );
    }
    if missing
        .iter()
        .any(|item| item == "Visual Studio Build Tools / MSVC")
    {
        manual_fix.push(
            "Install Visual Studio 2022 Build Tools with Desktop development with C++, MSVC v143, and a Windows SDK."
                .to_string(),
        );
    }
    if missing
        .iter()
        .any(|item| item == "Tauri NSIS offline toolset")
    {
        manual_fix.push(
            "Reinstall AgentVN Editor with the bundled Windows NSIS offline toolset, then run one-click repair again."
                .to_string(),
        );
    }
    let message = if missing.is_empty() {
        "Windows standalone package environment is ready.".to_string()
    } else {
        format!(
            "Windows standalone package environment is missing required tools: {}",
            missing.join(", ")
        )
    };
    let mut result = serde_json::json!({
        "cacheSchemaVersion": ENVIRONMENT_PASS_CACHE_SCHEMA_VERSION,
        "cachePlatform": "windows",
        "cacheHit": false,
        "ok": status == "PASS",
        "status": status,
        "message": message,
        "installAttempted": install,
        "checks": checks,
        "missing": missing,
        "warnings": warnings,
        "actions": actions,
        "manualFix": manual_fix,
        "reportPath": report_path.to_string_lossy(),
        "logPath": live_log_path.to_string_lossy(),
        "commandLogPath": command_log_path.to_string_lossy(),
        "passCachePath": pass_cache_path.to_string_lossy(),
        "exitCode": if status == "PASS" { 0 } else { 2 },
    });
    persist_environment_pass_cache(&pass_cache_path, "windows", &mut result)?;
    let json = serde_json::to_string_pretty(&result)
        .map_err(|error| format!("Failed to serialize Windows environment report: {error}"))?;
    fs::write(&report_path, format!("{json}\n")).map_err(|error| {
        format!(
            "Failed to write Windows environment report {}: {error}",
            report_path.display()
        )
    })?;
    stage(&format!(
        "Windows standalone package environment check finished: {status}."
    ));
    emit_package_environment_operation_progress(
        Some(&app),
        &run_id,
        "windows",
        if install { "install" } else { "check" },
        if status == "PASS" {
            "completed"
        } else {
            "failed"
        },
        if status == "PASS" {
            "Windows 构建环境操作已完成。"
        } else {
            "Windows 构建环境未通过本次操作。"
        },
        100,
    );
    Ok(result)
}

fn native_windows_tool_candidates(tool: &str) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    match tool {
        "node" => {
            if let Ok(value) = std::env::var("NODE") {
                candidates.push(PathBuf::from(value));
            }
            candidates.push(PathBuf::from("node.exe"));
            if let Some(path_value) = std::env::var_os("PATH") {
                candidates.extend(
                    std::env::split_paths(&path_value).map(|directory| directory.join("node.exe")),
                );
            }
            if let Ok(program_files) = std::env::var("ProgramFiles") {
                let root = PathBuf::from(program_files);
                candidates.push(root.join("node.exe"));
                candidates.push(root.join("nodejs").join("node.exe"));
            }
        }
        "npm" => {
            if let Ok(value) = std::env::var("NPM") {
                candidates.push(PathBuf::from(value));
            }
            candidates.push(PathBuf::from("npm.cmd"));
            if let Ok(program_files) = std::env::var("ProgramFiles") {
                let root = PathBuf::from(program_files);
                candidates.push(root.join("npm.cmd"));
                candidates.push(root.join("nodejs").join("npm.cmd"));
            }
        }
        "cargo" | "rustup" => {
            if let Ok(value) = std::env::var(tool.to_ascii_uppercase()) {
                candidates.push(PathBuf::from(value));
                return candidates;
            }
            candidates.push(PathBuf::from(format!("{tool}.exe")));
            if let Ok(profile) = std::env::var("USERPROFILE") {
                candidates.push(
                    PathBuf::from(profile)
                        .join(".cargo")
                        .join("bin")
                        .join(format!("{tool}.exe")),
                );
            }
        }
        "winget" => {
            candidates.push(PathBuf::from("winget.exe"));
            if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
                candidates.push(
                    PathBuf::from(local_app_data)
                        .join("Microsoft")
                        .join("WindowsApps")
                        .join("winget.exe"),
                );
            }
        }
        "cl" => candidates.push(PathBuf::from("cl.exe")),
        _ => candidates.push(PathBuf::from(tool)),
    }
    candidates
}

fn find_native_windows_tool(tool: &str) -> Option<(PathBuf, String)> {
    for candidate in native_windows_tool_candidates(tool) {
        if candidate.components().count() > 1 && !candidate.is_file() {
            continue;
        }
        if let Ok(output) = background_command(&candidate)
            .arg("--version")
            .stdin(Stdio::null())
            .output()
        {
            if output.status.success() || tool == "cl" {
                let stdout = String::from_utf8_lossy(&output.stdout);
                let stderr = String::from_utf8_lossy(&output.stderr);
                let version = format!("{}\n{}", stdout.trim(), stderr.trim())
                    .trim()
                    .to_string();
                return Some((candidate, version));
            }
        }
    }
    None
}

fn native_windows_msvc_check() -> serde_json::Value {
    let mut vswhere_candidates = Vec::new();
    for variable in ["ProgramFiles(x86)", "ProgramFiles"] {
        if let Ok(root) = std::env::var(variable) {
            vswhere_candidates.push(
                PathBuf::from(root)
                    .join("Microsoft Visual Studio")
                    .join("Installer")
                    .join("vswhere.exe"),
            );
        }
    }
    for vswhere in vswhere_candidates {
        if !vswhere.is_file() {
            continue;
        }
        if let Ok(output) = background_command(&vswhere)
            .args([
                "-latest",
                "-products",
                "*",
                "-requires",
                "Microsoft.VisualStudio.Component.VC.Tools.x86.x64",
                "-property",
                "installationPath",
            ])
            .stdin(Stdio::null())
            .output()
        {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if output.status.success() && !path.is_empty() {
                return serde_json::json!({
                    "id": "msvc_build_tools",
                    "label": "Visual Studio Build Tools / MSVC",
                    "status": "PASS",
                    "path": path,
                    "message": "Visual Studio Build Tools with MSVC C++ tools detected.",
                    "fix": serde_json::Value::Null,
                });
            }
        }
    }
    if let Some((path, _)) = find_native_windows_tool("cl") {
        return serde_json::json!({
            "id": "msvc_build_tools",
            "label": "Visual Studio Build Tools / MSVC",
            "status": "PASS",
            "path": path.to_string_lossy(),
            "message": "MSVC compiler cl.exe detected on PATH.",
            "fix": serde_json::Value::Null,
        });
    }
    serde_json::json!({
        "id": "msvc_build_tools",
        "label": "Visual Studio Build Tools / MSVC",
        "status": "BLOCKED",
        "path": serde_json::Value::Null,
        "message": "Visual Studio Build Tools / MSVC C++ tools were not detected.",
        "fix": "Install Visual Studio 2022 Build Tools with Desktop development with C++ / MSVC and a Windows SDK.",
    })
}

fn tauri_nsis_cache_dir() -> Option<PathBuf> {
    std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .map(|root| root.join("tauri").join("NSIS"))
}

fn required_tauri_nsis_files(root: &Path) -> [PathBuf; 4] {
    [
        root.join("makensis.exe"),
        root.join("Bin").join("makensis.exe"),
        root.join("Include").join("MUI2.nsh"),
        root.join("Plugins")
            .join("x86-unicode")
            .join("additional")
            .join("nsis_tauri_utils.dll"),
    ]
}

fn is_complete_tauri_nsis_toolset(root: &Path) -> bool {
    required_tauri_nsis_files(root)
        .iter()
        .all(|path| path.is_file())
}

fn native_windows_nsis_check() -> serde_json::Value {
    let Some(cache_dir) = tauri_nsis_cache_dir() else {
        return serde_json::json!({
            "id": "tauri_nsis_toolset",
            "label": "Tauri NSIS offline toolset",
            "status": "BLOCKED",
            "path": serde_json::Value::Null,
            "message": "LOCALAPPDATA is unavailable, so the Tauri NSIS cache cannot be located.",
            "fix": "Restart Windows and run AgentVN one-click environment repair again.",
        });
    };
    if is_complete_tauri_nsis_toolset(&cache_dir) {
        return serde_json::json!({
            "id": "tauri_nsis_toolset",
            "label": "Tauri NSIS offline toolset",
            "status": "PASS",
            "path": cache_dir.to_string_lossy(),
            "message": "Tauri NSIS 3.11 and nsis_tauri_utils are ready for offline packaging.",
            "fix": serde_json::Value::Null,
        });
    }
    serde_json::json!({
        "id": "tauri_nsis_toolset",
        "label": "Tauri NSIS offline toolset",
        "status": "BLOCKED",
        "path": cache_dir.to_string_lossy(),
        "message": "The Tauri NSIS offline toolset is missing or incomplete.",
        "fix": "Run AgentVN one-click environment repair to deploy the bundled NSIS toolset.",
    })
}

fn bundled_windows_nsis_candidates(app: &tauri::AppHandle) -> Vec<PathBuf> {
    let mut candidates = vec![
        workspace_root().join("windows-offline-tools").join("NSIS"),
        exe_parent_dir().join("windows-offline-tools").join("NSIS"),
        exe_parent_dir()
            .join("bundle-workspace")
            .join("windows-offline-tools")
            .join("NSIS"),
    ];
    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.extend([
            resource_dir.join("windows-offline-tools").join("NSIS"),
            resource_dir
                .join("bundle-workspace")
                .join("windows-offline-tools")
                .join("NSIS"),
        ]);
    }
    let mut unique = Vec::new();
    for candidate in candidates {
        if !unique.iter().any(|item: &PathBuf| item == &candidate) {
            unique.push(candidate);
        }
    }
    unique
}

fn install_bundled_windows_nsis_toolset(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let source = bundled_windows_nsis_candidates(app)
        .into_iter()
        .find(|candidate| is_complete_tauri_nsis_toolset(candidate))
        .ok_or_else(|| {
            "TAURI_NSIS_OFFLINE_TOOLSET_MISSING: AgentVN Editor does not contain a complete bundled NSIS toolset."
                .to_string()
        })?;
    let target = tauri_nsis_cache_dir().ok_or_else(|| {
        "TAURI_NSIS_OFFLINE_TOOLSET_MISSING: LOCALAPPDATA is unavailable.".to_string()
    })?;
    copy_dir_for_package_build(&source, &target, true).map_err(|error| {
        format!(
            "TAURI_NSIS_OFFLINE_TOOLSET_INSTALL_FAILED: failed to copy {} to {}: {error}",
            source.display(),
            target.display()
        )
    })?;
    if !is_complete_tauri_nsis_toolset(&target) {
        return Err(format!(
            "TAURI_NSIS_OFFLINE_TOOLSET_INSTALL_FAILED: deployed toolset is incomplete at {}",
            target.display()
        ));
    }
    Ok(target)
}

fn build_native_windows_environment_checks() -> Vec<serde_json::Value> {
    let mut checks = Vec::new();
    for tool in ["node", "npm", "cargo", "rustup"] {
        if let Some((path, version)) = find_native_windows_tool(tool) {
            checks.push(serde_json::json!({
                "id": tool,
                "label": tool,
                "status": "PASS",
                "path": path.to_string_lossy(),
                "message": if version.is_empty() { format!("{tool} detected.") } else { format!("{tool} detected: {version}") },
                "fix": serde_json::Value::Null,
            }));
        } else {
            let fix = match tool {
                "node" => "Install Node.js LTS, then restart AgentVN.",
                "npm" => "Install Node.js LTS; npm is bundled with Node.js.",
                "cargo" => "Install Rust through rustup, then restart AgentVN.",
                _ => "Install rustup, then restart AgentVN.",
            };
            checks.push(serde_json::json!({
                "id": tool,
                "label": tool,
                "status": "BLOCKED",
                "path": serde_json::Value::Null,
                "message": format!("{tool} was not found."),
                "fix": fix,
            }));
        }
    }
    checks.push(native_windows_msvc_check());
    checks.push(native_windows_nsis_check());
    checks
}

fn first_non_empty_line(value: &str) -> String {
    value
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or("No command output was captured.")
        .to_string()
}

fn run_native_windows_env_command(
    executable: &Path,
    args: &[&str],
    command_log_path: &Path,
) -> Result<(bool, String), String> {
    let output = background_command(executable)
        .args(args)
        .current_dir(workspace_root())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|error| format!("Failed to run {}: {error}", executable.display()))?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    if let Some(parent) = command_log_path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "Failed to create Windows environment command log directory {}: {error}",
                parent.display()
            )
        })?;
    }
    let mut command_log = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(command_log_path)
        .map_err(|error| {
            format!(
                "Failed to open Windows environment command log {}: {error}",
                command_log_path.display()
            )
        })?;
    writeln!(
        command_log,
        "$ {} {}\n== stdout ==\n{}\n== stderr ==\n{}",
        executable.display(),
        args.join(" "),
        stdout,
        stderr
    )
    .map_err(|error| {
        format!(
            "Failed to write Windows environment command log {}: {error}",
            command_log_path.display()
        )
    })?;
    Ok((
        output.status.success(),
        format!("{}\n{}", stdout.trim(), stderr.trim()),
    ))
}

fn install_native_windows_package(
    winget: &Path,
    id: &str,
    label: &str,
    extra_args: &[&str],
    command_log_path: &Path,
) -> Result<(), String> {
    let mut args = vec![
        "install",
        "--id",
        id,
        "--exact",
        "--silent",
        "--accept-package-agreements",
        "--accept-source-agreements",
    ];
    args.extend_from_slice(extra_args);
    match run_native_windows_env_command(winget, &args, command_log_path) {
        Ok((true, _)) => Ok(()),
        Ok((false, output)) => Err(format!(
            "{label} automatic install did not complete: {}",
            first_non_empty_line(&output)
        )),
        Err(error) => Err(format!("{label} automatic install failed: {error}")),
    }
}

#[tauri::command]
async fn build_standalone_package_from_upload(
    app: tauri::AppHandle,
    state: tauri::State<'_, DevProcesses>,
    upload_id: String,
    target_platform: String,
    output_dir: String,
    run_id: Option<String>,
    optimization_profile: Option<String>,
    release_identity: serde_json::Value,
    icon_source: Option<String>,
) -> Result<StandalonePackageBuildResult, String> {
    validate_standalone_package_upload_id(&upload_id)?;
    let session = {
        let mut guard = state
            .standalone_package_upload
            .lock()
            .map_err(|_| "Standalone package upload lock is poisoned.".to_string())?;
        let active = guard
            .as_ref()
            .ok_or_else(|| "Standalone package upload was not initialized.".to_string())?;
        if active.upload_id != upload_id {
            return Err(
                "Standalone package upload id does not match the active upload.".to_string(),
            );
        }
        validate_standalone_package_upload_file(&active.cartridge)?;
        if let Some(icon) = &active.icon {
            validate_standalone_package_upload_file(icon)?;
        }
        guard
            .take()
            .expect("active upload disappeared while locked")
    };
    let uploads_dir = standalone_package_uploads_dir(&app)?;
    let package_root = uploads_dir
        .parent()
        .ok_or_else(|| "Standalone package upload root has no parent.".to_string())?
        .to_path_buf();
    fs::create_dir_all(&package_root).map_err(|error| {
        format!(
            "Failed to create standalone package cache root {}: {error}",
            package_root.display()
        )
    })?;
    let cache_dir = package_root.join(error_report_timestamp().to_string());
    let cartridge_name = session
        .cartridge
        .path
        .file_name()
        .ok_or_else(|| "Standalone package cartridge upload has no file name.".to_string())?
        .to_owned();
    let icon_name = session
        .icon
        .as_ref()
        .and_then(|icon| icon.path.file_name().map(|name| name.to_owned()));
    if let Err(error) = fs::rename(&session.root_dir, &cache_dir) {
        let _ = cleanup_standalone_package_upload_session(session);
        return Err(format!(
            "Failed to promote standalone package upload {} -> {}: {error}",
            upload_id,
            cache_dir.display()
        ));
    }
    let _ = fs::remove_dir(&uploads_dir);
    let cartridge_path = cache_dir.join(cartridge_name);
    let standalone_icon_path = icon_name.map(|name| cache_dir.join(name));
    let optimization_profile = optimization_profile
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "balanced".to_string());
    let icon_source = icon_source
        .filter(|value| matches!(value.as_str(), "project" | "default" | "fallback"))
        .unwrap_or_else(|| {
            if standalone_icon_path.is_some() {
                "project".to_string()
            } else {
                "default".to_string()
            }
        });
    tauri::async_runtime::spawn_blocking(move || {
        build_standalone_package_blocking(
            app,
            target_platform,
            output_dir,
            run_id,
            optimization_profile,
            release_identity,
            icon_source,
            cache_dir,
            cartridge_path,
            standalone_icon_path,
        )
    })
    .await
    .map_err(|error| format!("Standalone package build task failed: {error}"))?
}

#[tauri::command]
async fn build_standalone_package_from_files(
    app: tauri::AppHandle,
    file_name: String,
    text_files: Vec<NativeCartridgeTextFile>,
    assets: Vec<NativeCartridgeAsset>,
    icon_file_name: Option<String>,
    icon_bytes: Option<Vec<u8>>,
    target_platform: String,
    output_dir: String,
    run_id: Option<String>,
    optimization_profile: Option<String>,
    release_identity: serde_json::Value,
    icon_source: Option<String>,
) -> Result<StandalonePackageBuildResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if icon_file_name.is_some() != icon_bytes.is_some() {
            return Err("Standalone icon file name and bytes must be provided together.".into());
        }
        let uploads_dir = standalone_package_uploads_dir(&app)?;
        let package_root = uploads_dir.parent()
            .ok_or("Standalone package upload root has no parent.")?;
        let cache_dir = package_root.join(native_cartridge_cache_directory_name(error_report_timestamp()));
        fs::create_dir_all(&cache_dir)
            .map_err(|error| format!("Failed to prepare native cartridge directory: {error}"))?;
        let cartridge_path = cache_dir.join(safe_package_file_name(&file_name));
        let prepared = (|| -> Result<Option<PathBuf>, String> {
            native_cartridge::write_cartridge(&cartridge_path, &text_files, &assets)?;
            if let (Some(name), Some(bytes)) = (icon_file_name, icon_bytes) {
                let path = cache_dir.join(safe_package_icon_file_name(Some(name)));
                fs::write(&path, bytes)
                    .map_err(|error| format!("Failed to prepare standalone icon: {error}"))?;
                Ok(Some(path))
            } else {
                Ok(None)
            }
        })();
        let icon_path = match prepared {
            Ok(path) => path,
            Err(error) => {
                let _ = remove_path_if_exists(&cache_dir);
                return Err(error);
            }
        };
        let icon_source = icon_source
            .filter(|value| matches!(value.as_str(), "project" | "default" | "fallback"))
            .unwrap_or_else(|| if icon_path.is_some() { "project" } else { "default" }.into());
        build_standalone_package_blocking(
            app,
            target_platform,
            output_dir,
            run_id,
            optimization_profile.filter(|value| !value.trim().is_empty())
                .unwrap_or_else(|| "balanced".into()),
            release_identity,
            icon_source,
            cache_dir,
            cartridge_path,
            icon_path,
        )
    })
    .await
    .map_err(|error| format!("Native cartridge build task failed: {error}"))?
}

fn native_cartridge_cache_directory_name(timestamp: u128) -> String {
    // Keep the same path budget as the established upload route. NSIS and
    // image tooling may reject paths that Rust can successfully create.
    timestamp.to_string()
}

#[cfg(test)]
mod native_cartridge_cache_path_tests {
    #[test]
    fn keeps_existing_short_build_workspace_path_budget() {
        let base = r"C:\Users\1\AppData\Local\com.agentvn.editor\standalone-package";
        let tail = r"build-workspace\GameCli_framework\src-tauri\resources\embedded-cartridge\assets\background\98430f7e-c311-4444-93c4-502b35afaaf2-98430f7e-c311-4444-93c4-502b35afaaf2.png";
        let original = format!(r"{base}\1790581124665\{tail}");
        let candidate = format!(r"{base}\{}\{tail}", super::native_cartridge_cache_directory_name(1790581124665));
        assert!(candidate.len() <= original.len(),
            "native writer must not expand the established package workspace path budget: {} > {}", candidate.len(), original.len());
    }
}

#[tauri::command]
async fn check_android_build_environment(
    app: tauri::AppHandle,
    run_id: Option<String>,
    force_recheck: Option<bool>,
) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        run_android_env_tool_blocking(
            app,
            false,
            "check",
            run_id,
            force_recheck.unwrap_or(false),
            None,
            false,
            false,
        )
    })
    .await
    .map_err(|error| format!("Android environment check task failed: {error}"))?
}

#[tauri::command]
async fn install_android_build_environment(
    app: tauri::AppHandle,
    run_id: Option<String>,
) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let operation_run_id = run_id.clone().unwrap_or_default();
        let _operation_lock =
            try_acquire_android_environment_operation_lock(&app, "online-repair")?;
        emit_android_environment_import_progress(
            Some(&app),
            &operation_run_id,
            "checking",
            "正在准备通过国内镜像重新安装 Android 构建依赖…",
            2,
            0,
            0,
            0,
            0,
            0,
            "online",
        );
        let result = run_android_env_tool_blocking(
            app.clone(),
            true,
            "install",
            run_id,
            true,
            None,
            false,
            true,
        )?;
        if result.get("status").and_then(|value| value.as_str()) == Some("PASS") {
            let reclaimed = result
                .get("reclaimedBytes")
                .and_then(|value| value.as_u64())
                .unwrap_or(0);
            emit_android_environment_import_progress(
                Some(&app),
                &operation_run_id,
                "completed",
                "Android 构建依赖已重新安装并通过检查。",
                100,
                0,
                0,
                0,
                0,
                reclaimed,
                "online",
            );
        }
        Ok(result)
    })
    .await
    .map_err(|error| format!("Android environment repair task failed: {error}"))?
}

fn android_environment_blocked_only_by_host_prerequisites(result: &serde_json::Value) -> bool {
    let blocked_ids = result
        .get("checks")
        .and_then(|value| value.as_array())
        .into_iter()
        .flatten()
        .filter(|check| check.get("status").and_then(|value| value.as_str()) != Some("PASS"))
        .filter_map(|check| check.get("id").and_then(|value| value.as_str()))
        .collect::<Vec<_>>();
    !blocked_ids.is_empty()
        && blocked_ids
            .iter()
            .all(|id| matches!(*id, "windows_msvc_linker" | "windows_symlink_capability"))
}

#[tauri::command]
async fn import_android_environment_package(
    app: tauri::AppHandle,
    run_id: Option<String>,
) -> Result<Option<serde_json::Value>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let import_run_id = run_id.clone().unwrap_or_default();
        let selected = app
            .dialog()
            .file()
            .set_title("选择 AgentVN Android 构建依赖包")
            .add_filter("AgentVN Android 环境包", &["avnenv", "zip"])
            .blocking_pick_file();
        let Some(selected) = selected else {
            return Ok(None);
        };
        let archive_path = selected.into_path().map_err(|error| {
            format!("ANDROID_ENV_PACK_INVALID: cannot resolve selected file: {error}")
        })?;
        if !archive_path.is_file() {
            return Err("ANDROID_ENV_PACK_INVALID: selected path is not a file.".to_string());
        }
        let _operation_lock =
            try_acquire_android_environment_operation_lock(&app, "import-avnenv")?;
        let paths = android_managed_environment_paths(&app)?;
        emit_android_environment_import_progress(
            Some(&app),
            &import_run_id,
            "checking",
            "已选择构建依赖包，正在检查格式与磁盘空间…",
            2,
            0,
            0,
            0,
            0,
            0,
            "avnenv",
        );
        let preflight = inspect_android_environment_package(&archive_path)?;
        let reclaimable = directory_size_bytes(&paths.tool_root)?
            .saturating_add(directory_size_bytes(&paths.gradle_home)?);
        let disk_probe_root = paths
            .tool_root
            .parent()
            .ok_or_else(|| "ANDROID_ENV_DISK_FULL: Android tool root has no parent.".to_string())?;
        fs::create_dir_all(disk_probe_root).map_err(|error| {
            format!(
                "ANDROID_ENV_DISK_FULL: cannot prepare {} for disk-space check: {error}",
                disk_probe_root.display()
            )
        })?;
        let available = available_disk_bytes(disk_probe_root)?;
        let required = preflight.total_bytes.saturating_add(1024 * 1024 * 1024);
        if available.saturating_add(reclaimable) < required {
            return Err(format!(
                "ANDROID_ENV_DISK_FULL: importing this package requires approximately {}, but only {} would be available after removing the old AgentVN Android environment.",
                format_byte_size(required),
                format_byte_size(available.saturating_add(reclaimable))
            ));
        }
        let reclaimed = clear_managed_android_environment(&app, &import_run_id, "avnenv import")?;
        let import_result = (|| -> Result<serde_json::Value, String> {
            emit_android_environment_import_progress(
                Some(&app),
                &import_run_id,
                "installing",
                "正在直接安装并校验新的 Android 构建依赖…",
                18,
                0,
                preflight.total_bytes,
                0,
                preflight.file_count,
                reclaimed,
                "avnenv",
            );
            let format = extract_android_environment_package(
                Some(&app),
                &import_run_id,
                &archive_path,
                &paths.tool_root,
                Some(&paths),
            )
            .map_err(|error| format!("ANDROID_ENV_INSTALL_INCOMPLETE: {error}"))?;
            write_android_environment_deployment_marker(&paths, &archive_path, &format)?;
            emit_package_build_log(
                &app,
                &import_run_id,
                "success",
                "android-env-import",
                format!(
                    "Android environment package {} was deployed directly with path, size, and SHA-256 validation.",
                    format.pack_version
                ),
            );
            emit_android_environment_import_progress(
                Some(&app),
                &import_run_id,
                "verifying",
                "新构建依赖已安装，正在验证主机构建工具；如系统请求管理员权限，请选择“是”…",
                92,
                format.total_bytes,
                format.total_bytes,
                format.file_count,
                format.file_count,
                reclaimed,
                "avnenv",
            );
            let mut result = run_android_env_tool_blocking(
                app.clone(),
                true,
                "import",
                run_id,
                true,
                None,
                false,
                false,
            )?;
            let imported_status = if result.get("status").and_then(|value| value.as_str())
                == Some("PASS")
            {
                "PASS"
            } else {
                "BLOCKED"
            };
            let retain_imported_toolchain =
                android_environment_blocked_only_by_host_prerequisites(&result);
            let build_elevation_deferred = result
                .pointer("/symlinkElevation/status")
                .and_then(|value| value.as_str())
                == Some("DEFERRED_TO_BUILD");
            if let Some(object) = result.as_object_mut() {
                object.insert(
                    "installSource".to_string(),
                    serde_json::Value::String("avnenv".to_string()),
                );
                object.insert(
                    "reclaimedBytes".to_string(),
                    serde_json::Value::Number(reclaimed.into()),
                );
                object.insert(
                    "importedEnvironmentPackage".to_string(),
                    serde_json::json!({
                        "path": archive_path,
                        "packageId": format.package_id,
                        "packVersion": format.pack_version,
                        "totalBytes": format.total_bytes,
                        "fileCount": format.file_count,
                        "reclaimedBytes": reclaimed,
                        "installSource": "avnenv",
                        "buildElevationDeferred": build_elevation_deferred,
                        "toolchainRetained": imported_status == "PASS" || retain_imported_toolchain,
                        "status": imported_status
                    }),
                );
            }
            if imported_status == "PASS" {
                emit_android_environment_import_progress(
                    Some(&app),
                    &import_run_id,
                    "completed",
                    if build_elevation_deferred {
                        "构建依赖已成功导入并通过环境检查；Android 独立包构建默认需要管理员权限，开始构建时会请求 UAC 授权。"
                    } else {
                        "构建依赖已成功导入并通过环境检查。"
                    },
                    100,
                    format.total_bytes,
                    format.total_bytes,
                    format.file_count,
                    format.file_count,
                    reclaimed,
                    "avnenv",
                );
            } else if !retain_imported_toolchain {
                let _ = remove_path_if_exists(&paths.tool_root);
                let _ = remove_path_if_exists(&paths.gradle_home);
                let _ = remove_path_if_exists(&paths.pass_cache_path);
            }
            Ok(result)
        })();
        if import_result.is_err() {
            let _ = remove_path_if_exists(&paths.tool_root);
            let _ = remove_path_if_exists(&paths.gradle_home);
            let _ = remove_path_if_exists(&paths.pass_cache_path);
        }
        import_result.map(Some)
    })
    .await
    .map_err(|error| format!("Android environment package import task failed: {error}"))?
}

#[tauri::command]
async fn check_windows_build_environment(
    app: tauri::AppHandle,
    run_id: Option<String>,
    force_recheck: Option<bool>,
) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        run_windows_env_tool_blocking(app, false, run_id, force_recheck.unwrap_or(false))
    })
    .await
    .map_err(|error| format!("Windows environment check task failed: {error}"))?
}

#[tauri::command]
async fn install_windows_build_environment(
    app: tauri::AppHandle,
    run_id: Option<String>,
) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        run_windows_env_tool_blocking(app, true, run_id, true)
    })
    .await
    .map_err(|error| format!("Windows environment repair task failed: {error}"))?
}

fn project_backup_dir() -> PathBuf {
    if let Some(app_data_dir) = app_data_override_dir() {
        return app_data_dir.join("backup-timeline");
    }
    install_data_dir().join("backup-timeline")
}

fn safe_backup_title(title: &str) -> String {
    let mut safe = String::new();
    for ch in title.chars() {
        if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.') {
            safe.push(ch);
        } else if ch.is_whitespace() {
            safe.push('_');
        }
    }
    let trimmed = safe.trim_matches('_');
    if trimmed.is_empty() {
        "project".to_string()
    } else {
        trimmed.chars().take(48).collect()
    }
}

fn parse_backup_timestamp(file_name: &str) -> u64 {
    file_name
        .split("__")
        .nth(1)
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(0)
}

fn project_backup_content_hash(value: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(value.as_bytes());
    hex::encode(hasher.finalize())
}

fn fallback_backup_title(file_name: &str) -> String {
    file_name
        .strip_suffix(".vnproj")
        .and_then(|value| value.split("__").nth(2))
        .map(|value| value.replace('_', " "))
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "project backup".to_string())
}

fn backup_entry_from_path(path: &Path, requested_project_id: &str) -> Option<ProjectBackupEntry> {
    let file_name = path.file_name()?.to_string_lossy().to_string();
    if !file_name.ends_with(".vnproj") {
        return None;
    }
    if let Ok(mut file) = File::open(path) {
        let mut magic = [0_u8; 4];
        if file.read_exact(&mut magic).is_ok() && magic == [0x50, 0x4b, 0x03, 0x04] {
            return None;
        }
    }
    let timestamp_ms = parse_backup_timestamp(path.file_name()?.to_string_lossy().as_ref());
    let meta = fs::read_to_string(path.with_extension("vnproj.meta.json"))
        .ok()
        .and_then(|raw_meta| serde_json::from_str::<ProjectBackupMeta>(&raw_meta).ok());
    if let Some(meta) = meta.as_ref() {
        if meta.project_id.as_deref() == Some(requested_project_id) {
            let title = meta
                .title
                .clone()
                .unwrap_or_else(|| fallback_backup_title(&file_name));
            return Some(ProjectBackupEntry {
                file_name,
                project_id: requested_project_id.to_string(),
                title,
                created_at: meta.created_at.clone().unwrap_or_default(),
                updated_at: meta.updated_at.clone().unwrap_or_default(),
                timestamp_ms: meta.timestamp_ms.unwrap_or(timestamp_ms),
                node_count: meta.node_count,
                edge_count: meta.edge_count,
                trigger: meta.trigger.clone(),
                content_hash: meta.content_hash.clone(),
            });
        }
    }
    let safe_requested_prefix = format!("{}__", safe_backup_title(requested_project_id));
    let filename_matches_requested = file_name.starts_with(&safe_requested_prefix);
    let file_size = fs::metadata(path)
        .map(|metadata| metadata.len())
        .unwrap_or(u64::MAX);
    if file_size > PROJECT_BACKUP_SAFE_FALLBACK_MAX_BYTES {
        if !filename_matches_requested {
            return None;
        }
        return Some(ProjectBackupEntry {
            file_name,
            project_id: requested_project_id.to_string(),
            title: fallback_backup_title(path.file_name()?.to_string_lossy().as_ref()),
            created_at: String::new(),
            updated_at: String::new(),
            timestamp_ms,
            node_count: None,
            edge_count: None,
            trigger: meta
                .as_ref()
                .map(|value| value.trigger.clone())
                .unwrap_or_else(|| "project backup".to_string()),
            content_hash: None,
        });
    }
    let raw = fs::read_to_string(path).ok()?;
    let project: ProjectBackupFile = serde_json::from_str(&raw).ok()?;
    let trigger = fs::read_to_string(path.with_extension("vnproj.meta.json"))
        .ok()
        .and_then(|raw_meta| serde_json::from_str::<ProjectBackupMeta>(&raw_meta).ok())
        .map(|meta| meta.trigger)
        .unwrap_or_else(|| "工程备份".to_string());
    Some(ProjectBackupEntry {
        file_name,
        project_id: project.project_id,
        title: project.title,
        created_at: project.created_at,
        updated_at: project.updated_at,
        timestamp_ms,
        node_count: Some(project.nodes.len()),
        edge_count: Some(project.edges.len()),
        trigger,
        content_hash: Some(project_backup_content_hash(&raw)),
    })
}

fn list_project_backup_entries(project_id: &str) -> Result<Vec<ProjectBackupEntry>, String> {
    let dir = project_backup_dir();
    let entries = match fs::read_dir(&dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => {
            return Err(format!(
                "Failed to read backup-timeline folder {}: {error}",
                dir.display()
            ))
        }
    };

    let mut backups = Vec::new();
    for entry in entries.flatten() {
        if let Some(backup) = backup_entry_from_path(&entry.path(), project_id) {
            if backup.project_id == project_id {
                backups.push(backup);
            }
        }
    }
    backups.sort_by(|a, b| {
        b.timestamp_ms
            .cmp(&a.timestamp_ms)
            .then_with(|| b.file_name.cmp(&a.file_name))
    });
    Ok(backups)
}

fn cleanup_project_backups(project_id: &str) -> Result<(), String> {
    let backups = list_project_backup_entries(project_id)?;
    if backups.len() <= PROJECT_BACKUP_KEEP_COUNT {
        return Ok(());
    }
    let dir = project_backup_dir();
    for backup in backups.into_iter().skip(PROJECT_BACKUP_KEEP_COUNT) {
        let path = dir.join(backup.file_name);
        match fs::remove_file(&path) {
            Ok(()) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => eprintln!(
                "[AgentVN] Failed to remove old project backup {}: {error}",
                path.display()
            ),
        }
        let meta_path = path.with_extension("vnproj.meta.json");
        match fs::remove_file(&meta_path) {
            Ok(()) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => eprintln!(
                "[AgentVN] Failed to remove old project backup metadata {}: {error}",
                meta_path.display()
            ),
        }
    }
    Ok(())
}

#[tauri::command]
fn write_project_backup(
    project_json: String,
    trigger: String,
) -> Result<ProjectBackupEntry, String> {
    let project: ProjectBackupFile = serde_json::from_str(&project_json)
        .map_err(|error| format!("Failed to parse project backup JSON: {error}"))?;
    let timestamp = u64::try_from(error_report_timestamp()).unwrap_or(u64::MAX);
    let dir = project_backup_dir();
    fs::create_dir_all(&dir).map_err(|error| {
        format!(
            "Failed to create backup-timeline folder {}: {error}",
            dir.display()
        )
    })?;

    let encoded_value: serde_json::Value = serde_json::from_str(&project_json)
        .map_err(|error| format!("Failed to parse project backup JSON: {error}"))?;
    let encoded = serde_json::to_string_pretty(&encoded_value)
        .map_err(|error| format!("Failed to encode project backup JSON: {error}"))?;
    let content_hash = project_backup_content_hash(&encoded);
    let file_name = format!(
        "{}__{}__{}.vnproj",
        safe_backup_title(&project.project_id),
        timestamp,
        safe_backup_title(&project.title)
    );
    let path = dir.join(&file_name);
    write_json_atomic(&path, &encoded_value)?;
    let meta_path = path.with_extension("vnproj.meta.json");
    let meta = ProjectBackupMeta {
        backup_format: Some("json-timeline".to_string()),
        trigger: trigger.clone(),
        project_id: Some(project.project_id.clone()),
        title: Some(project.title.clone()),
        created_at: Some(project.created_at.clone()),
        updated_at: Some(project.updated_at.clone()),
        timestamp_ms: Some(timestamp),
        node_count: Some(project.nodes.len()),
        edge_count: Some(project.edges.len()),
        content_hash: Some(content_hash.clone()),
    };
    write_json_atomic(&meta_path, &meta)?;
    cleanup_project_backups(&project.project_id)?;
    Ok(ProjectBackupEntry {
        file_name,
        project_id: project.project_id,
        title: project.title,
        created_at: project.created_at,
        updated_at: project.updated_at,
        timestamp_ms: timestamp,
        node_count: Some(project.nodes.len()),
        edge_count: Some(project.edges.len()),
        trigger,
        content_hash: Some(content_hash),
    })
}

#[tauri::command]
fn list_project_backups(project_id: String) -> Result<Vec<ProjectBackupEntry>, String> {
    list_project_backup_entries(&project_id)
}

#[tauri::command]
fn read_project_backup(file_name: String) -> Result<String, String> {
    if file_name.contains('/')
        || file_name.contains('\\')
        || file_name.contains("..")
        || !file_name.ends_with(".vnproj")
    {
        return Err("Invalid project backup file name.".to_string());
    }
    let path = project_backup_dir().join(file_name);
    if let Ok(mut file) = File::open(&path) {
        let mut magic = [0_u8; 4];
        if file.read_exact(&mut magic).is_ok() && magic == [0x50, 0x4b, 0x03, 0x04] {
            return Err("TIMELINE_BACKUP_JSON_ONLY: 时间线只支持内部 JSON 备份。".to_string());
        }
    }
    fs::read_to_string(&path)
        .map_err(|error| format!("Failed to read project backup {}: {error}", path.display()))
}

fn open_text_file(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Err("AgentVN error report has already been cleaned up or removed.".to_string());
    }

    #[cfg(target_os = "windows")]
    let mut command = background_command("explorer.exe");

    #[cfg(target_os = "macos")]
    let mut command = background_command("open");

    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = background_command("xdg-open");

    command
        .arg(path)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| {
            format!("Failed to open AgentVN error report with the system default app: {error}")
        })?;
    Ok(())
}

fn validated_standalone_output_directory(output_dir: &str) -> Result<PathBuf, String> {
    let output_dir = output_dir.trim();
    if output_dir.is_empty() || output_dir.contains('\0') {
        return Err("Invalid standalone package output directory.".to_string());
    }
    let requested = fs::canonicalize(PathBuf::from(output_dir)).map_err(|error| {
        format!("Failed to resolve standalone package output directory {output_dir}: {error}")
    })?;
    if !requested.is_dir() {
        return Err(format!(
            "Standalone package output path is not a directory: {}",
            requested.display()
        ));
    }
    Ok(requested)
}

#[tauri::command]
fn open_standalone_package_output_directory(output_dir: String) -> Result<(), String> {
    let directory = validated_standalone_output_directory(&output_dir)?;
    open_text_file(&directory)
}

fn validated_standalone_diagnostics_dir(
    app: &tauri::AppHandle,
    diagnostics_dir: &str,
) -> Result<PathBuf, String> {
    if diagnostics_dir.trim().is_empty() || diagnostics_dir.contains('\0') {
        return Err("Invalid standalone diagnostics directory.".to_string());
    }
    let allowed_root = app
        .path()
        .app_cache_dir()
        .map_err(|error| format!("Failed to locate package cache dir: {error}"))?
        .join("standalone-package");
    let requested = fs::canonicalize(PathBuf::from(diagnostics_dir)).map_err(|error| {
        format!("Failed to resolve standalone diagnostics directory {diagnostics_dir}: {error}")
    })?;
    let allowed = fs::canonicalize(&allowed_root).map_err(|error| {
        format!(
            "Failed to resolve standalone package cache root {}: {error}",
            allowed_root.display()
        )
    })?;
    if !requested.starts_with(&allowed)
        || requested.file_name().and_then(|value| value.to_str()) != Some("diagnostics")
        || !requested.is_dir()
    {
        return Err(format!(
            "Refusing to access a path outside the standalone diagnostics cache: {}",
            requested.display()
        ));
    }
    Ok(requested)
}

#[tauri::command]
fn open_standalone_package_diagnostics(
    app: tauri::AppHandle,
    diagnostics_dir: String,
) -> Result<(), String> {
    let directory = validated_standalone_diagnostics_dir(&app, &diagnostics_dir)?;
    open_text_file(&directory)
}

#[tauri::command]
fn export_standalone_package_diagnostics(
    app: tauri::AppHandle,
    diagnostics_dir: String,
) -> Result<String, String> {
    let directory = validated_standalone_diagnostics_dir(&app, &diagnostics_dir)?;
    let run_dir = directory
        .parent()
        .ok_or_else(|| "Standalone diagnostics directory has no run directory.".to_string())?;
    let archive_path = run_dir.join("agentvn-standalone-diagnostics.zip");
    let archive = create_standalone_diagnostics_archive(&directory, &archive_path)?;
    Ok(archive.to_string_lossy().to_string())
}

fn error_report_timestamp() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

fn error_report_dir() -> PathBuf {
    exe_parent_dir().join("error_log")
}

fn cleanup_error_reports_once() -> Result<usize, String> {
    fs::create_dir_all(error_report_dir())
        .map(|_| 0)
        .map_err(|error| format!("Failed to create AgentVN error report dir: {error}"))
}

fn write_error_report_files(message: String) -> Result<PathBuf, String> {
    if let Err(error) = cleanup_error_reports_once() {
        eprintln!("[AgentVN] Error report cleanup before write skipped: {error}");
    }

    let timestamp = error_report_timestamp();
    let report_dir = error_report_dir();
    std::fs::create_dir_all(&report_dir)
        .map_err(|error| format!("Failed to create AgentVN error report dir: {error}"))?;

    let archive_path = report_dir.join(format!("AgentVN-Error-{timestamp}.txt"));
    let current_exe = std::env::current_exe()
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_else(|error| format!("unavailable: {error}"));
    let current_dir = std::env::current_dir()
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_else(|error| format!("unavailable: {error}"));
    let report = format!(
        "{}\n\
\n\
== Desktop Host Context ==\n\
OS: {} {}\n\
Current exe: {current_exe}\n\
Current dir: {current_dir}\n\
Report path: {}\n",
        message,
        std::env::consts::OS,
        std::env::consts::ARCH,
        archive_path.to_string_lossy()
    );
    std::fs::write(&archive_path, report)
        .map_err(|error| format!("Failed to write AgentVN error report: {error}"))?;
    if let Err(error) = cleanup_error_reports_once() {
        eprintln!("[AgentVN] Error report cleanup after write skipped: {error}");
    }
    Ok(archive_path)
}

#[tauri::command]
fn write_error_report(message: String) -> Result<String, String> {
    let report_path = write_error_report_files(message)?;
    Ok(report_path.to_string_lossy().to_string())
}

#[tauri::command]
fn append_frontend_error(source: String, message: String) -> Result<String, String> {
    let report_dir = error_report_dir();
    let path = report_dir.join("editor-frontend.log");
    if !should_write_error_log(&source, &message) {
        return Ok(path.to_string_lossy().to_string());
    }
    let timestamp = error_report_timestamp();
    append_error_log_line(&path, &format!("[{timestamp}] [{source}] {message}"))
        .map_err(|error| format!("Failed to append AgentVN frontend error log: {error}"))?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
fn open_error_report(_app: tauri::AppHandle, message: String) -> Result<String, String> {
    let report_path = write_error_report_files(message)?;
    open_text_file(&report_path)?;
    Ok(report_path.to_string_lossy().to_string())
}

fn maybe_run_elevated_android_build_from_args() -> Option<i32> {
    let arguments = std::env::args_os().collect::<Vec<_>>();
    let helper_index = arguments
        .iter()
        .position(|value| value == "--agentvn-elevated-android-build")?;
    let request_index = arguments
        .iter()
        .skip(helper_index + 1)
        .position(|value| value == "--request")
        .map(|index| helper_index + 1 + index)?;
    let request_path = arguments.get(request_index + 1).map(PathBuf::from);
    Some(match request_path {
        Some(path) => match run_elevated_android_build_request(&path) {
            Ok(code) => code,
            Err(error) => {
                eprintln!("[AgentVN elevated Android helper] {error}");
                1
            }
        },
        None => {
            eprintln!("[AgentVN elevated Android helper] --request requires a path.");
            1
        }
    })
}

fn main() {
    if let Some(exit_code) = maybe_run_elevated_android_build_from_args() {
        std::process::exit(exit_code);
    }
    install_desktop_panic_hook();
    append_desktop_host_log("AgentVN Editor desktop host starting.");
    configure_dev_webview_data_directory();
    if let Err(error) = cleanup_error_reports_once() {
        eprintln!("[AgentVN] Initial error report cleanup skipped: {error}");
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(DevProcesses {
            backend: Mutex::new(None),
            frontend: Mutex::new(None),
            gamecli_preview: Mutex::new(None),
            gamecli_preview_cartridge: Mutex::new(None),
            gamecli_preview_disk_upload: Mutex::new(None),
            gamecli_preview_directory: Mutex::new(None),
            standalone_package_upload: Mutex::new(None),
        })
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.hide();
            }
            let handle = app.handle().clone();
            let shared_data_dir = editor_app_data_dir(&handle);
            if let Err(error) = fs::create_dir_all(&shared_data_dir) {
                eprintln!(
                    "[AgentVN] WARNING: Failed to create shared user data dir {}: {error}",
                    shared_data_dir.display()
                );
            } else {
                std::env::set_var(
                    "AGENTVN_EDITOR_DATA_DIR",
                    shared_data_dir.to_string_lossy().to_string(),
                );
            }

            let workspace_root = find_workspace_root();
            let process_dir = if cfg!(debug_assertions) {
                workspace_root.clone().unwrap_or_else(exe_parent_dir)
            } else {
                exe_parent_dir()
            };
            if let Err(error) = std::env::set_current_dir(&process_dir) {
                eprintln!(
                    "[AgentVN] WARNING: Failed to set process working directory to {}: {error}",
                    process_dir.display()
                );
            } else {
                eprintln!(
                    "[AgentVN] Process working directory: {}",
                    process_dir.display()
                );
            }

            let (backend_child, backend_port) =
                start_backend_for_runtime(&handle, workspace_root.as_deref());
            ACTIVE_BACKEND_PORT.store(backend_port, Ordering::Relaxed);
            let frontend_child = if cfg!(debug_assertions) {
                workspace_root.as_deref().and_then(start_frontend)
            } else {
                eprintln!("[AgentVN] Using bundled editor frontend.");
                None
            };
            let backend_ready = wait_for_backend_health(backend_port, 60);
            let frontend_ready = if cfg!(debug_assertions) && workspace_root.is_some() {
                wait_for_frontend_http(6767, 60)
            } else {
                true
            };
            if !backend_ready {
                eprintln!("[AgentVN] WARNING: Backend did not start in time.");
            }
            if !frontend_ready {
                eprintln!("[AgentVN] WARNING: Frontend did not start in time.");
            }
            let state = app.state::<DevProcesses>();
            *state.backend.lock().unwrap() = backend_child;
            *state.frontend.lock().unwrap() = frontend_child;
            if let Some(window) = app.get_webview_window("main") {
                if frontend_ready {
                    let _ = window.show();
                    let _ = window.set_focus();
                } else {
                    eprintln!("[AgentVN] Startup barrier failed; keeping main window hidden.");
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            novel_card_position::read_novel_task_card_position,
            novel_card_position::write_novel_task_card_position,
            open_gamecli_preview,
            begin_gamecli_preview_disk_upload,
            append_gamecli_preview_disk_chunk,
            open_gamecli_preview_disk_upload,
            begin_gamecli_preview_directory,
            write_gamecli_preview_text_file,
            link_or_copy_gamecli_preview_asset,
            begin_gamecli_preview_asset_upload,
            append_gamecli_preview_asset_chunk,
            finalize_gamecli_preview_directory,
            begin_gamecli_preview_upload,
            append_gamecli_preview_chunk,
            open_gamecli_preview_upload,
            close_gamecli_preview,
            get_gamecli_preview_running,
            read_project_asset_file_bytes,
            project_asset_file_is_readable,
            select_renpy_gui_import_directory,
            get_renpy_gui_import_archive_size,
            read_renpy_gui_import_archive_chunk,
            cleanup_renpy_gui_import_archive,
            list_renpy_gui_packs,
            read_renpy_gui_pack,
            save_renpy_gui_pack,
            begin_project_bundle_asset_upload,
            append_project_bundle_asset_chunk,
            cleanup_project_bundle_asset_upload,
            write_project_bundle,
            select_project_export_dir,
            get_native_capabilities,
            select_project_import_file,
            select_package_output_dir,
            begin_standalone_package_upload,
            append_standalone_package_upload_chunk,
            build_standalone_package_from_upload,
            build_standalone_package_from_files,
            abort_standalone_package_upload,
            open_standalone_package_output_directory,
            open_standalone_package_diagnostics,
            export_standalone_package_diagnostics,
            check_android_build_environment,
            install_android_build_environment,
            import_android_environment_package,
            check_windows_build_environment,
            install_windows_build_environment,
            write_error_report,
            append_frontend_error,
            open_error_report,
            write_project_backup,
            list_project_backups,
            read_project_backup
        ])
        .build(tauri::generate_context!())
        .expect("error while building AgentVN Dev Container")
        .run(|app, event| {
            // CloseRequested may still be prevented by a save/confirmation
            // handler. Only a committed main-window destruction or actual app
            // exit may tear down services. Auxiliary windows do not own them.
            if matches!(&event, tauri::RunEvent::WindowEvent {
                label, event: tauri::WindowEvent::Destroyed, ..
            } if label == "main") || matches!(event, tauri::RunEvent::Exit) {
                cleanup_host_processes(app);
            }
        });
}

#[cfg(test)]
mod database_migration_message_tests {
    use super::*;

    #[test]
    fn migration_confirmation_distinguishes_all_sources_from_actual_target() {
        let target = PathBuf::from(r"F:\隔离 QA\用户数据\backend\vn_engine.db");
        let sources = vec![
            PathBuf::from(r"C:\旧版 编辑器\data\backend\vn_engine.db"),
            PathBuf::from(r"D:\历史工程\data\vn_engine.db"),
        ];
        let message = database_migration_message(&target, &sources);
        let (source_section, target_section) = message
            .split_once("目标共享数据库：\n")
            .expect("confirmation must label the actual destination");
        assert!(source_section.contains("来源数据库：\n"));
        for source in &sources {
            assert!(source_section.contains(&source.display().to_string()));
            assert!(!target_section.contains(&source.display().to_string()));
        }
        assert!(!source_section.contains(&target.display().to_string()));
        assert!(target_section.starts_with(&target.display().to_string()));
        assert!(target_section.contains("共享数据库中的同名项目会保留"));
        assert!(target_section.contains("是否现在迁移？"));
    }
}

#[cfg(test)]
mod project_export_directory_tests {
    use super::*;

    #[test]
    fn project_bundle_output_keeps_existing_export_and_picks_a_new_name() {
        let dir = std::env::temp_dir().join(format!(
            "agentvn-project-export-{}-{}",
            std::process::id(),
            error_report_timestamp()
        ));
        fs::create_dir(&dir).expect("create isolated directory");
        let first = dir.join("隐忍的成长.vnproj");
        fs::write(&first, b"old project").expect("create original project");
        let output = next_project_bundle_path(&dir, "隐忍的成长.vnproj").expect("next path");
        assert_eq!(output, dir.join("隐忍的成长-1.vnproj"));
        assert_eq!(fs::read(&first).expect("read original"), b"old project");
        fs::remove_dir_all(&dir).expect("cleanup isolated directory");
    }
}

#[cfg(test)]
mod project_backup_format_tests {
    use super::*;

    #[test]
    fn android_environment_archive_prefers_the_application_directory_package() {
        let root = std::env::temp_dir().join(format!(
            "agentvn-project-avnenv-test-{}-{}",
            std::process::id(),
            error_report_timestamp()
        ));
        fs::create_dir_all(&root).expect("create project avnenv test directory");
        let preferred = root.join("AgentVN-Android-Environment.avnenv");
        let other = root.join("older-package.avnenv");
        fs::write(&preferred, b"preferred package").expect("write preferred project package");
        fs::write(&other, b"other package").expect("write other project package");

        assert_eq!(find_android_environment_archive_in(&root), Some(preferred));

        fs::remove_dir_all(root).expect("remove project avnenv test directory");
    }

    #[test]
    fn backup_metadata_uses_camel_case_format_marker_and_reads_legacy_alias() {
        let meta = ProjectBackupMeta {
            backup_format: Some("json-timeline".to_string()),
            trigger: "manual".to_string(),
            project_id: Some("project".to_string()),
            title: Some("隐忍的成长".to_string()),
            created_at: None,
            updated_at: None,
            timestamp_ms: None,
            node_count: None,
            edge_count: None,
            content_hash: None,
        };
        let encoded = serde_json::to_string(&meta).expect("encode backup metadata");
        assert!(encoded.contains(r#""backupFormat":"json-timeline""#));
        let legacy: ProjectBackupMeta =
            serde_json::from_str(r#"{"backup_format":"json-timeline","trigger":"legacy"}"#)
                .expect("decode legacy backup metadata");
        assert_eq!(legacy.backup_format.as_deref(), Some("json-timeline"));
    }

    #[test]
    fn portable_zip_is_not_listed_as_timeline_backup() {
        let root = std::env::temp_dir().join(format!(
            "agentvn-timeline-format-test-{}-{}",
            std::process::id(),
            error_report_timestamp()
        ));
        fs::create_dir_all(&root).expect("create timeline test directory");
        let path = root.join("project__1__portable.vnproj");
        fs::write(&path, [0x50, 0x4b, 0x03, 0x04]).expect("write ZIP magic");
        assert!(backup_entry_from_path(&path, "project").is_none());
        fs::remove_dir_all(&root).expect("clean timeline test directory");
    }
}

#[cfg(test)]
mod backend_compatibility_tests {
    use super::*;
    use std::net::TcpListener;
    use std::thread;

    fn spawn_fake_backend(health: &'static str) -> (u16, thread::JoinHandle<()>) {
        let listener = TcpListener::bind(("127.0.0.1", 0)).expect("bind fake backend");
        let port = listener.local_addr().expect("fake backend addr").port();
        let handle = thread::spawn(move || {
            for _ in 0..2 {
                let (mut stream, _) = listener.accept().expect("accept backend probe");
                let mut request = [0u8; 2048];
                let bytes = stream.read(&mut request).expect("read backend probe");
                let request = String::from_utf8_lossy(&request[..bytes]);
                assert!(request.starts_with("GET /api/health "));
                let body = health;
                let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    body.len(),
                    body
                );
                stream
                    .write_all(response.as_bytes())
                    .expect("write backend probe response");
            }
        });
        (port, handle)
    }

    #[test]
    fn rejects_healthy_backend_without_project_container_protocol() {
        let (port, server) = spawn_fake_backend(r#"{"status":"ok","service":"agentvn-backend"}"#);
        assert!(backend_health_ok(port));
        assert!(!backend_supports_project_container_protocol(port));
        server.join().expect("join old backend fixture");
    }

    #[test]
    fn accepts_backend_with_zip_project_container_protocol() {
        let (port, server) = spawn_fake_backend(
            r#"{"status":"ok","service":"agentvn-backend","project_container_protocol":2}"#,
        );
        assert!(backend_is_compatible(port));
        server.join().expect("join compatible backend fixture");
    }
}

#[cfg(test)]
mod error_log_tests {
    use super::*;

    #[test]
    fn sanitizes_credentials_and_url_query_values() {
        let value = sanitize_error_log_text(
            "Bearer private-token sk-secret123 https://example.test/import?chapter=正文&token=hidden",
        );
        assert!(!value.contains("private-token"));
        assert!(!value.contains("secret123"));
        assert!(!value.contains("正文"));
        assert!(!value.contains("hidden"));
        assert!(value.contains("chapter=***"));
    }

    #[test]
    fn truncates_at_a_valid_utf8_boundary() {
        let value = truncate_error_log_text("界".repeat(30_000));
        assert!(value.len() <= MAX_ERROR_LOG_LINE_BYTES);
        assert!(value.ends_with("[后续内容已省略]"));
    }

    #[test]
    fn suppresses_identical_entries_for_one_second() {
        assert!(should_write_error_log("editor.test.dedup", "same failure"));
        assert!(!should_write_error_log("editor.test.dedup", "same failure"));
    }

    #[test]
    fn creates_numbered_rotation_paths() {
        assert_eq!(
            rotated_error_log_path(Path::new("error_log/editor-frontend.log"), 10),
            PathBuf::from("error_log/editor-frontend.log.10"),
        );
    }
}

#[cfg(test)]
mod standalone_output_directory_tests {
    use super::*;

    fn test_root(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "agentvn-output-directory-test-{}-{}-{}",
            std::process::id(),
            error_report_timestamp(),
            name
        ))
    }

    #[test]
    fn accepts_an_existing_directory() {
        let root = test_root("directory");
        fs::create_dir_all(&root).expect("create output directory");
        let validated =
            validated_standalone_output_directory(root.to_str().expect("output directory path"))
                .expect("validate output directory");
        assert!(validated.is_dir());
        fs::remove_dir_all(&root).expect("clean output directory");
    }

    #[test]
    fn rejects_missing_paths_and_regular_files() {
        let root = test_root("invalid");
        let missing = root.join("missing");
        assert!(
            validated_standalone_output_directory(missing.to_str().expect("missing path")).is_err()
        );

        fs::create_dir_all(&root).expect("create invalid root");
        let file = root.join("artifact.txt");
        fs::write(&file, "not a directory").expect("write output file");
        assert!(
            validated_standalone_output_directory(file.to_str().expect("output file path"))
                .is_err()
        );
        fs::remove_dir_all(&root).expect("clean invalid root");
    }
}

#[cfg(test)]
mod standalone_evidence_cleanup_tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    struct Fixture {
        root: PathBuf,
        cache: PathBuf,
        source: PathBuf,
        layout: PathBuf,
        apk: PathBuf,
        metadata: PathBuf,
        initial: serde_json::Value,
        result: Result<StandalonePackageBuildResult, String>,
    }

    impl Fixture {
        fn new(succeeded: bool) -> Self {
            static NEXT: AtomicUsize = AtomicUsize::new(0);
            let root = std::env::temp_dir().join(format!(
                "agentvn-host-cleanup-中文 空格-{}-{}-{}",
                std::process::id(), error_report_timestamp(), NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir(&root).unwrap();
            let cache = root.join("cache");
            let source = cache.join("source.vncart");
            let layout = cache.join("build-workspace/GameCli_framework/src-tauri/resources/embedded-cartridge/ui/layout.json");
            let apk = root.join("output/游戏.apk");
            let metadata = root.join("output/游戏.apk.acceptance.json");
            fs::create_dir_all(layout.parent().unwrap()).unwrap();
            fs::create_dir_all(apk.parent().unwrap()).unwrap();
            fs::create_dir_all(cache.join("diagnostics")).unwrap();
            fs::write(&source, b"source cartridge bytes").unwrap();
            fs::write(&layout, b"{\"layout_type\":\"renpy\"}").unwrap();
            fs::write(&apk, b"already signed APK bytes").unwrap();
            let initial = serde_json::json!({
                "schemaVersion": 1, "runId": "host-cleanup-test",
                "recordedAt": "2026-10-17T00:00:00+08:00",
                "apk": {"path": apk, "sha256": sha256_file(&apk).unwrap(), "cleaned": false},
                "sourceCartridge": {"path": source, "sha256": sha256_file(&source).unwrap(), "cleaned": false},
                "prepackageLayout": {"path": layout, "sha256": sha256_file(&layout).unwrap(), "cleaned": false, "present": true},
                "embeddedLayout": {"sha256": sha256_file(&layout).unwrap()},
                "unknownOptionalField": {"preserved": true}
            });
            write_json_atomic(&metadata, &initial).unwrap();
            let result = Ok(package_build_result(
                if succeeded { "PASS" } else { "FAIL" }, "fixture".into(),
                vec![PackageBuildArtifact { kind: "android_apk_signed".into(),
                    path: apk.to_string_lossy().into(), bytes: Some(fs::metadata(&apk).unwrap().len()) }],
                vec![], &cache.join("diagnostics/verify.json"),
                &cache.join("diagnostics/build.log"), &cache.join("diagnostics/manifest.json")
            ));
            Self { root, cache, source, layout, apk, metadata, initial, result }
        }

        fn finish(&self) -> Result<(), String> {
            finalize_standalone_package_build_inputs(
                &self.cache, &self.source, None, Some("host-cleanup-test"), &self.result
            )
        }

        fn read(&self) -> serde_json::Value {
            serde_json::from_slice(&fs::read(&self.metadata).unwrap()).unwrap()
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            if let Ok(metadata) = fs::metadata(&self.metadata) {
                if metadata.permissions().readonly() {
                    let mut permissions = metadata.permissions();
                    permissions.set_readonly(false);
                    fs::set_permissions(&self.metadata, permissions).unwrap();
                }
            }
            let resolved = fs::canonicalize(&self.root).unwrap();
            let temp = fs::canonicalize(std::env::temp_dir()).unwrap();
            assert!(resolved.starts_with(&temp) && resolved != temp);
            assert!(self.root.file_name().unwrap().to_string_lossy().starts_with("agentvn-host-cleanup-"));
            fs::remove_dir_all(&resolved).unwrap();
        }
    }

    #[test]
    fn successful_host_cleanup_updates_metadata_after_removing_source_and_workspace() {
        let fixture = Fixture::new(true);
        fixture.finish().unwrap();
        assert!(!fixture.cache.exists());
        let saved = fixture.read();
        assert_eq!(saved["sourceCartridge"]["cleaned"], true);
        assert_eq!(saved["prepackageLayout"]["cleaned"], true);
        for key in ["apk", "sourceCartridge", "prepackageLayout"] {
            assert_eq!(saved[key]["sha256"], fixture.initial[key]["sha256"]);
        }
        assert_eq!(saved["unknownOptionalField"], fixture.initial["unknownOptionalField"]);
        assert_eq!(saved["recordedAt"], fixture.initial["recordedAt"]);
        assert_eq!(saved["nativeCleanup"]["status"], "PASS");
        assert_eq!(saved["nativeCleanup"]["cleanupError"], serde_json::Value::Null);
        assert_eq!(sha256_file(&fixture.apk).unwrap(), fixture.initial["apk"]["sha256"]);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn redirected_cache_alias_accepts_physical_receipt_after_inputs_are_removed() {
        let fixture = Fixture::new(true);
        let alias = fixture.root.join("logical-appdata");
        std::os::windows::fs::symlink_dir(&fixture.root, &alias).unwrap();
        let mut receipt = fixture.initial.clone();
        for (key, file) in [("sourceCartridge", &fixture.source), ("prepackageLayout", &fixture.layout)] {
            receipt[key]["path"] = shell_display_path(&fs::canonicalize(file).unwrap()).into();
        }
        write_json_atomic(&fixture.metadata, &receipt).unwrap();
        finalize_standalone_package_build_inputs(
            &alias.join("cache"), &alias.join("cache/source.vncart"), None, Some("host-cleanup-test"), &fixture.result
        ).unwrap();
        assert!(!fixture.cache.exists());
        let saved = fixture.read();
        assert_eq!(saved["nativeCleanup"]["status"], "PASS");
        assert_eq!(saved["sourceCartridge"]["cleaned"], true);
        assert_eq!(saved["prepackageLayout"]["cleaned"], true);
        for key in ["apk", "sourceCartridge", "prepackageLayout"] {
            assert_eq!(saved[key]["sha256"], receipt[key]["sha256"]);
        }
        fs::remove_dir(&alias).unwrap();
    }

    #[test]
    fn failed_build_cleanup_keeps_diagnostics_but_updates_deleted_inputs() {
        let fixture = Fixture::new(false);
        fixture.finish().unwrap();
        assert!(fixture.cache.join("diagnostics").is_dir());
        assert!(!fixture.source.exists() && !fixture.layout.exists());
        assert_eq!(fixture.read()["sourceCartridge"]["cleaned"], true);
        assert_eq!(fixture.read()["prepackageLayout"]["cleaned"], true);
    }

    #[test]
    fn foreign_run_source_or_layout_receipts_are_not_overwritten() {
        for mismatch in ["runId", "source", "layout", "apk"] {
            let fixture = Fixture::new(true);
            let mut foreign = fixture.initial.clone();
            match mismatch {
                "runId" => foreign["runId"] = "other-build".into(),
                "source" => foreign["sourceCartridge"]["path"] = fixture.root.join("foreign.vncart").to_string_lossy().to_string().into(),
                "layout" => foreign["prepackageLayout"]["path"] = fixture.cache.join("../foreign.json").to_string_lossy().to_string().into(),
                "apk" => foreign["apk"]["path"] = fixture.root.join("foreign.apk").to_string_lossy().to_string().into(),
                _ => unreachable!(),
            }
            write_json_atomic(&fixture.metadata, &foreign).unwrap();
            let before = fs::read(&fixture.metadata).unwrap();
            assert!(fixture.finish().unwrap_err().contains("ANDROID_EVIDENCE_FINALIZATION_FAILED"));
            assert_eq!(fs::read(&fixture.metadata).unwrap(), before, "{mismatch}");
            assert!(fixture.apk.is_file());
        }
    }

    #[test]
    fn changed_apk_bytes_are_preserved_and_receipt_is_not_rewritten() {
        let fixture = Fixture::new(true);
        fs::write(&fixture.apk, b"externally replaced APK").unwrap();
        let before = fs::read(&fixture.metadata).unwrap();
        assert!(fixture.finish().unwrap_err().contains("APK bytes changed"));
        assert_eq!(fs::read(&fixture.metadata).unwrap(), before);
        assert_eq!(fs::read(&fixture.apk).unwrap(), b"externally replaced APK");
    }

    #[test]
    fn invalid_metadata_and_incomplete_hashes_are_not_repaired_with_fabricated_values() {
        for invalid_json in [true, false] {
            let fixture = Fixture::new(true);
            if invalid_json { fs::write(&fixture.metadata, b"{").unwrap(); }
            else {
                let mut incomplete = fixture.initial.clone();
                incomplete["sourceCartridge"]["sha256"] = serde_json::Value::Null;
                write_json_atomic(&fixture.metadata, &incomplete).unwrap();
            }
            let before = fs::read(&fixture.metadata).unwrap();
            assert!(fixture.finish().is_err());
            assert_eq!(fs::read(&fixture.metadata).unwrap(), before);
        }
    }

    #[test]
    fn runtime_default_layout_and_repeated_finalization_preserve_compatibility() {
        let fixture = Fixture::new(true);
        let mut default = fixture.initial.clone();
        default["prepackageLayout"] = serde_json::json!({
            "present": false, "sha256": null, "cleaned": false, "reason": "RUNTIME_DEFAULT_LAYOUT"
        });
        write_json_atomic(&fixture.metadata, &default).unwrap();
        fixture.finish().unwrap();
        fixture.finish().unwrap();
        let saved = fixture.read();
        assert_eq!(saved["prepackageLayout"], default["prepackageLayout"]);
        assert_eq!(saved["sourceCartridge"]["cleaned"], true);
        assert_eq!(saved["nativeCleanup"]["status"], "PASS");
    }

    #[test]
    fn non_android_builds_do_not_require_or_write_android_evidence() {
        let mut fixture = Fixture::new(true);
        fixture.result.as_mut().unwrap().artifacts[0].kind = "windows_portable_exe".into();
        fs::remove_file(&fixture.metadata).unwrap();
        fixture.finish().unwrap();
        assert!(!fixture.metadata.exists());
        assert!(fixture.apk.exists());
    }

    #[test]
    fn finalization_errors_become_structured_android_failures_without_hiding_original_failure() {
        for code in ["ANDROID_EVIDENCE_FINALIZATION_FAILED: receipt", "cannot remove cache"] {
            let mut fixture = Fixture::new(true);
            record_standalone_package_cleanup_error(&mut fixture.result, &fixture.cache, true, code);
            let result = fixture.result.as_ref().unwrap();
            assert!(!result.ok);
            assert_eq!(result.status, "FAIL");
            assert_eq!(result.failure_code.as_deref(), Some(if code.starts_with("ANDROID_EVIDENCE") {
                "ANDROID_EVIDENCE_FINALIZATION_FAILED"
            } else { "ANDROID_BUILD_INPUT_CLEANUP_FAILED" }));
            assert!(result.message.contains("APK is preserved"));
        }
        let mut failed = Fixture::new(false);
        failed.result.as_mut().unwrap().failure_code = Some("ORIGINAL_BUILD_FAILURE".into());
        record_standalone_package_cleanup_error(&mut failed.result, &failed.cache, true, "later cleanup error");
        assert_eq!(failed.result.as_ref().unwrap().failure_code.as_deref(), Some("ORIGINAL_BUILD_FAILURE"));
        assert_eq!(failed.result.as_ref().unwrap().message, "fixture");
        let mut windows = Fixture::new(true);
        record_standalone_package_cleanup_error(&mut windows.result, &windows.cache, false, "cleanup warning");
        assert!(windows.result.as_ref().unwrap().ok);
    }

    #[test]
    fn post_cleanup_evidence_failure_keeps_a_real_diagnostic_log_manifest_and_archive() {
        let mut fixture = Fixture::new(true);
        fs::write(&fixture.metadata, b"invalid metadata").unwrap();
        // Successful script results have cleared their transient diagnostic
        // paths already. Recreate failure evidence, not deleted source inputs.
        fixture.result.as_mut().unwrap().build_log_path.clear();
        fixture.result.as_mut().unwrap().manifest_path.clear();
        let error = fixture.finish().unwrap_err();
        assert!(!fixture.cache.exists());
        record_standalone_package_cleanup_error(&mut fixture.result, &fixture.cache, true, &error);
        let result = fixture.result.as_ref().unwrap();
        assert!(!result.ok);
        assert!(fs::read_to_string(&result.build_log_path).unwrap().contains("ANDROID_EVIDENCE_FINALIZATION_FAILED"));
        let saved: serde_json::Value = serde_json::from_slice(&fs::read(&result.manifest_path).unwrap()).unwrap();
        assert_eq!(saved["failureCode"], "ANDROID_EVIDENCE_FINALIZATION_FAILED");
        let mut archive = ZipArchive::new(File::open(&result.diagnostics_archive_path).unwrap()).unwrap();
        assert!(archive.by_name("native-final-cleanup.log").is_ok());
        assert!(archive.by_name("package-build-manifest.json").is_ok());
        assert!(!fixture.source.exists() && !fixture.layout.exists());
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn actual_cleanup_denial_is_recorded_and_retry_clears_the_error() {
        use std::os::windows::fs::OpenOptionsExt;
        let fixture = Fixture::new(true);
        let blocker = fixture.cache.join("locked-owned-test-file");
        fs::write(&blocker, b"locked test input").unwrap();
        let handle = OpenOptions::new().read(true).share_mode(0).open(&blocker).unwrap();
        assert!(fixture.finish().is_err());
        let saved = fixture.read();
        assert_eq!(saved["nativeCleanup"]["status"], "FAILED");
        assert!(saved["nativeCleanup"]["cleanupError"].is_string());
        assert_eq!(saved["sourceCartridge"]["cleaned"], !fixture.source.exists());
        drop(handle);
        fixture.finish().unwrap();
        assert_eq!(fixture.read()["nativeCleanup"]["status"], "PASS");
        assert_eq!(fixture.read()["nativeCleanup"]["cleanupError"], serde_json::Value::Null);
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn atomic_metadata_write_failure_preserves_original_receipt() {
        let fixture = Fixture::new(true);
        let before = fs::read(&fixture.metadata).unwrap();
        let mut permissions = fs::metadata(&fixture.metadata).unwrap().permissions();
        permissions.set_readonly(true);
        fs::set_permissions(&fixture.metadata, permissions).unwrap();
        assert!(fixture.finish().unwrap_err().contains("ANDROID_EVIDENCE_FINALIZATION_FAILED"));
        assert_eq!(fs::read(&fixture.metadata).unwrap(), before);
        assert!(fixture.apk.is_file());
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn surviving_layout_symlink_cannot_read_or_publish_foreign_evidence() {
        let fixture = Fixture::new(true);
        let foreign = fixture.root.join("outside-cache.json");
        fs::write(&foreign, b"unrelated user bytes").unwrap();
        fs::remove_file(&fixture.layout).unwrap();
        symlink_file(&foreign, &fixture.layout).expect("real file symlink probe");
        let before = fs::read(&fixture.metadata).unwrap();
        let error = refresh_android_artifact_cleanup_evidence(
            &fixture.result.as_ref().unwrap().artifacts[0], &fixture.cache, &fixture.source,
            (&fs::canonicalize(&fixture.cache).unwrap(), &fs::canonicalize(&fixture.source).unwrap()),
            Some("host-cleanup-test"), Some("cleanup failed before reaching this link"),
        ).unwrap_err();
        assert!(error.contains("resolves outside this build cache"));
        assert_eq!(fs::read(&fixture.metadata).unwrap(), before);
        assert_eq!(fs::read(&foreign).unwrap(), b"unrelated user bytes");
    }
}

#[cfg(test)]
mod standalone_package_upload_tests {
    use super::*;

    #[test]
    fn native_runner_arguments_preserve_build_identity_and_existing_options() {
        let release_identity = serde_json::json!({
            "schemaVersion": 1, "gameId": "qa_runid", "title": "中文 QA",
            "versionName": "0.1.0", "versionCode": 1000,
            "androidApplicationId": "com.agentvn.qa.runid"
        });
        let cartridge = Path::new(r"C:\中文 工程\fixture.vncart");
        let output = Path::new(r"F:\AgentVN\QA\输出 目录");
        let diagnostics = Path::new(r"F:\AgentVN\QA\诊断 目录");
        let icon = Path::new(r"C:\中文 工程\图标.png");
        for use_node in [false, true] {
            let script = if use_node { Path::new("build.cjs") } else { Path::new("build.ps1") };
            let prefix = if use_node { "--" } else { "-" };
            for platform in ["android", "windows"] {
                for prepared in [false, true] {
                    for with_icon in [false, true] {
                        let command = standalone_package_runner_command(StandalonePackageRunner {
                            use_direct_node_runner: use_node, script_path: script,
                            cartridge_path: cartridge, output_root: output, diagnostics_dir: diagnostics,
                            optimization_profile: "off", release_identity: &release_identity,
                            icon_source: if with_icon { "custom" } else { "default" },
                            icon_path: with_icon.then_some(icon), run_id: "android-package-09-20261021",
                            prepared_windows_workspace: platform == "windows" && prepared,
                        }).unwrap();
                        let args: Vec<String> = command.get_args().map(|v| v.to_string_lossy().into_owned()).collect();
                        let value = |name: &str| -> &str {
                            let flag = format!("{prefix}{name}");
                            let positions: Vec<_> = args.iter().enumerate().filter(|(_, v)| **v == flag).collect();
                            assert_eq!(positions.len(), 1, "{platform}, node={use_node}, {flag}: {args:?}");
                            &args[positions[0].0 + 1]
                        };
                        assert_eq!(value("RunId"), "android-package-09-20261021");
                        assert_eq!(value("CartridgePath"), shell_display_path(cartridge));
                        assert_eq!(value("OutputDir"), shell_display_path(output));
                        assert_eq!(value("DiagnosticsDir"), shell_display_path(diagnostics));
                        assert_eq!(value("OptimizationProfile"), "off");
                        assert_eq!(serde_json::from_str::<serde_json::Value>(value("ReleaseIdentity")).unwrap(), release_identity);
                        if with_icon {
                            assert_eq!(value("IconPath"), shell_display_path(icon));
                        } else {
                            assert!(!args.contains(&format!("{prefix}IconPath")));
                        }
                        for flag in ["--PreparedInPlace", "--DisposableWorkspace", "--RustCollectArtifacts"] {
                            assert_eq!(args.iter().any(|v| v == flag), use_node && platform == "windows" && prepared);
                        }
                        assert!(!args.iter().any(|v| v.contains("SkipEnvironmentCheck")),
                            "An elevated Editor must not bypass actual environment/symlink checks");
                    }
                }
            }
        }
    }

    #[test]
    fn native_runner_child_receives_original_run_id_in_both_launch_modes() {
        // Execute real local interpreters, with harmless receivers instead of
        // a model, Android build, elevation, or mutations to any user project.
        let root = std::env::temp_dir().join(format!("agentvn-runid-{}-{}", std::process::id(), error_report_timestamp()));
        fs::create_dir_all(&root).unwrap();
        let node_script = root.join("runner echo.cjs");
        let ps_script = root.join("runner echo.ps1");
        fs::write(&node_script, r#"const a=process.argv.slice(2);const i=a.indexOf("--RunId");process.stdout.write(JSON.stringify({runId:i<0?null:a[i+1]}));"#).unwrap();
        fs::write(&ps_script, r#"param([string]$CartridgePath,[string]$OutputDir,[string]$DiagnosticsDir,[string]$OptimizationProfile,[string]$ReleaseIdentity,[string]$IconSource,[string]$RunId,[switch]$Json)
@{runId=$RunId}|ConvertTo-Json -Compress
"#).unwrap();
        let release_identity = serde_json::json!({"schemaVersion": 1});
        let result = (|| -> Result<(), String> {
            for use_node in [true, false] {
                let mut command = standalone_package_runner_command(StandalonePackageRunner {
                    use_direct_node_runner: use_node,
                    script_path: if use_node { &node_script } else { &ps_script },
                    cartridge_path: &root.join("fixture.vncart"), output_root: &root,
                    diagnostics_dir: &root, optimization_profile: "off",
                    release_identity: &release_identity, icon_source: "default", icon_path: None,
                    run_id: "android-package-09-20261021", prepared_windows_workspace: false,
                })?;
                let output = command.output().map_err(|e| format!("node={use_node}: {e}"))?;
                if !output.status.success() {
                    return Err(format!("node={use_node}: {}", String::from_utf8_lossy(&output.stderr)));
                }
                let text = String::from_utf8_lossy(&output.stdout);
                let received: serde_json::Value = serde_json::from_str(text.trim().trim_start_matches('\u{feff}'))
                    .map_err(|e| format!("node={use_node}: {e}, output={text}"))?;
                if received["runId"] != "android-package-09-20261021" {
                    return Err(format!("node={use_node}: original build run ID was lost: {received}"));
                }
            }
            Ok(())
        })();
        fs::remove_dir_all(&root).unwrap();
        result.unwrap();
    }

    #[test]
    fn early_version_failure_preserves_log_and_diagnostics_archive() {
        let root = std::env::temp_dir().join(format!("agentvn-failure-log-{}-{}", std::process::id(), error_report_timestamp()));
        let diagnostics = root.join("diagnostics");
        fs::create_dir_all(&diagnostics).unwrap();
        let log = diagnostics.join("build.log");
        let manifest = diagnostics.join("package-build-manifest.json");
        let archive = root.join("diagnostics.zip");
        let mut result = package_build_result("FAIL",
            "EDITOR_BUILD_VERSION_MISSING: installed/build-versions.json; reinstall".to_string(),
            Vec::new(), Vec::new(), &diagnostics.join("verify.json"), &log, &manifest);
        result.failure_code = Some("EDITOR_BUILD_VERSION_MISSING".to_string());
        let result = persist_standalone_package_failure(result, &diagnostics, &archive);
        assert!(result.warnings.is_empty(), "{:?}", result.warnings);
        assert!(fs::read_to_string(&log).expect("early failures need a persistent text log").contains("EDITOR_BUILD_VERSION_MISSING"));
        let mut zip = ZipArchive::new(File::open(&archive).unwrap()).unwrap();
        assert!(zip.by_name("build.log").is_ok());
        let saved: serde_json::Value = serde_json::from_slice(&fs::read(&manifest).unwrap()).unwrap();
        assert_eq!(saved["failureCode"], "EDITOR_BUILD_VERSION_MISSING");
        drop(zip);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn materialization_rejects_invalid_installed_version_for_both_platforms() {
        let root = std::env::temp_dir().join(format!("agentvn-version-中文 空格-{}-{}", std::process::id(), error_report_timestamp()));
        for platform in ["windows", "android"] {
            for (name, contents, code) in [
                ("missing", None, "EDITOR_BUILD_VERSION_MISSING"),
                ("invalid", Some("{"), "EDITOR_BUILD_VERSION_INVALID"),
                ("empty", Some(r#"{"editorVersion":" "}"#), "EDITOR_BUILD_VERSION_INVALID"),
                ("mismatch", Some(r#"{"editorVersion":"0.0.0"}"#), "EDITOR_BUILD_VERSION_MISMATCH"),
            ] {
                let source = root.join(platform).join(name);
                fs::create_dir_all(&source).unwrap();
                if let Some(contents) = contents {
                    fs::write(source.join("build-versions.json"), contents).unwrap();
                }
                let destination = source.join("isolated");
                let error = materialize_standalone_build_workspace(&source, &destination).unwrap_err();
                assert!(error.contains(code), "{platform}/{name}: {error}");
                assert!(error.contains(&source.display().to_string()), "{error}");
                assert!(!destination.exists(), "reject provenance before copying");
            }
        }
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    #[ignore = "materializes a real isolated build workspace for manual build acceptance"]
    fn materialize_real_workspace_for_acceptance() {
        let source = PathBuf::from(std::env::var("AGENTVN_ACCEPTANCE_SOURCE").expect("explicit source"));
        let destination = PathBuf::from(std::env::var("AGENTVN_ACCEPTANCE_DESTINATION").expect("explicit destination"));
        assert!(!destination.exists(), "acceptance must use a fresh destination");
        materialize_standalone_build_workspace(&source, &destination).expect("materialize real build workspace");
        assert!(destination.join("build-versions.json").is_file());
        assert!(!destination.join("editor").exists(), "exercise installed build metadata path");
    }

    #[test]
    fn materialization_rejects_missing_version_before_copying() {
        let root = std::env::temp_dir().join(format!("agentvn-missing-version-{}-{}", std::process::id(), error_report_timestamp()));
        fs::create_dir_all(&root).unwrap();
        let destination = root.join("destination");
        assert!(materialize_standalone_build_workspace(&root, &destination).unwrap_err().contains("editor build version"));
        assert!(!destination.exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn materialized_workspace_preserves_editor_version_for_android_evidence() {
        let root = std::env::temp_dir().join(format!(
            "agentvn-version-copy-test-{}-{}", std::process::id(), error_report_timestamp()
        ));
        for installed in [false, true] {
            let source = root.join(if installed { "installed" } else { "development" });
            for directory in ["scripts", "GameCli_framework", "shared", "windows-offline-tools"] {
                fs::create_dir_all(source.join(directory)).unwrap();
            }
            if installed {
                fs::write(source.join("build-versions.json"), serde_json::to_vec(&serde_json::json!({"editorVersion": env!("CARGO_PKG_VERSION")})).unwrap()).unwrap();
            } else {
                fs::create_dir_all(source.join("editor/src-tauri")).unwrap();
                fs::write(source.join("editor/src-tauri/tauri.conf.json"), serde_json::to_vec(&serde_json::json!({"version": env!("CARGO_PKG_VERSION")})).unwrap()).unwrap();
            }
            let destination = source.join("materialized");
            materialize_standalone_build_workspace(&source, &destination).unwrap();
            let value: serde_json::Value = serde_json::from_slice(
                &fs::read(destination.join("build-versions.json")).expect("version metadata must reach the actual build workspace")
            ).unwrap();
            assert_eq!(value["editorVersion"], env!("CARGO_PKG_VERSION"));
        }
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn installed_workspace_copy_preserves_dependency_dist_directories() {
        let root = std::env::temp_dir().join(format!(
            "agentvn-standalone-dependency-copy-test-{}-{}",
            std::process::id(),
            error_report_timestamp()
        ));
        let source = root.join("bundled").join("GameCli_framework");
        let dependency_dist = source
            .join("node_modules")
            .join("lucide-react")
            .join("dist");
        let destination = root.join("materialized").join("GameCli_framework");
        fs::create_dir_all(&dependency_dist).expect("create dependency dist fixture");
        fs::write(
            dependency_dist.join("lucide-react.js"),
            b"module.exports = {};",
        )
        .expect("write dependency dist fixture");

        copy_dir_for_package_build(&source, &destination, true)
            .expect("copy installed bundled workspace");

        assert!(
            destination
                .join("node_modules")
                .join("lucide-react")
                .join("dist")
                .join("lucide-react.js")
                .is_file(),
            "installed workspace materialization must preserve dependency dist directories"
        );
        fs::remove_dir_all(root).expect("remove dependency copy fixture");
    }

    #[test]
    fn development_workspace_copy_preserves_dependency_dist_directories() {
        let root = std::env::temp_dir().join(format!(
            "agentvn-development-dependency-copy-test-{}-{}",
            std::process::id(),
            error_report_timestamp()
        ));
        let source_root = root.join("workspace");
        let source = source_root.join("GameCli_framework");
        let dependency_dist = source.join("node_modules").join("sharp").join("dist");
        fs::create_dir_all(source_root.join("backend"))
            .expect("create development backend fixture");
        fs::create_dir_all(source_root.join("editor")).expect("create development editor fixture");
        fs::create_dir_all(source_root.join("scripts"))
            .expect("create development scripts fixture");
        fs::create_dir_all(source_root.join("shared").join("cartridge"))
            .expect("create development shared fixture");
        let nsis_fixture = source_root
            .join("windows-offline-tools")
            .join("NSIS")
            .join("Bin");
        fs::create_dir_all(&nsis_fixture).expect("create Windows offline tool fixture");
        fs::write(nsis_fixture.join("makensis.exe"), b"fixture")
            .expect("write Windows offline tool fixture");
        fs::write(
            source_root.join("backend").join("pyproject.toml"),
            b"[project]\nname = \"fixture\"\n",
        )
        .expect("write development backend marker");
        fs::write(source_root.join("editor").join("package.json"), b"{}\n")
            .expect("write development editor marker");
        fs::write(source_root.join("build-versions.json"), serde_json::to_vec(&serde_json::json!({"editorVersion": env!("CARGO_PKG_VERSION")})).unwrap())
            .expect("write development version metadata");
        fs::create_dir_all(&dependency_dist).expect("create development dependency fixture");
        fs::write(dependency_dist.join("index.cjs"), b"module.exports = {};")
            .expect("write development dependency fixture");

        let destination_root = root.join("materialized");
        materialize_standalone_build_workspace(&source_root, &destination_root)
            .expect("copy development bundled workspace");

        assert!(
            destination_root
                .join("GameCli_framework")
                .join("node_modules")
                .join("sharp")
                .join("dist")
                .join("index.cjs")
                .is_file(),
            "development workspace materialization must preserve dependency dist directories"
        );
        assert!(
            destination_root
                .join("windows-offline-tools")
                .join("NSIS")
                .join("Bin")
                .join("makensis.exe")
                .is_file(),
            "standalone workspace materialization must preserve Windows offline build tools"
        );
        fs::remove_dir_all(root).expect("remove development dependency fixture");
    }

    #[test]
    fn tauri_nsis_toolset_requires_the_bundler_and_plugin_files() {
        let root = std::env::temp_dir().join(format!(
            "agentvn-nsis-toolset-test-{}-{}",
            std::process::id(),
            error_report_timestamp()
        ));
        for file in required_tauri_nsis_files(&root) {
            fs::create_dir_all(file.parent().expect("NSIS fixture parent"))
                .expect("create NSIS fixture directory");
            fs::write(file, b"fixture").expect("write NSIS fixture file");
        }
        assert!(is_complete_tauri_nsis_toolset(&root));
        fs::remove_file(
            root.join("Plugins")
                .join("x86-unicode")
                .join("additional")
                .join("nsis_tauri_utils.dll"),
        )
        .expect("remove NSIS plugin fixture");
        assert!(!is_complete_tauri_nsis_toolset(&root));
        fs::remove_dir_all(root).expect("remove NSIS fixture");
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn elevated_android_environment_paths_strip_extended_prefixes_without_splitting() {
        let runner =
            PathBuf::from(r"\\?\C:\缓存 工作区\scripts\build-runtime-standalone-android.cjs");
        let request = PathBuf::from(r"\\?\C:\缓存 工作区\elevated-android-build-request.json");
        assert_eq!(
            shell_display_path(&runner),
            r"C:\缓存 工作区\scripts\build-runtime-standalone-android.cjs"
        );
        assert_eq!(
            shell_display_path(&request),
            r"C:\缓存 工作区\elevated-android-build-request.json"
        );
        assert_eq!(
            shell_display_path(Path::new(r"\\?\UNC\server\共享\构建请求.json")),
            r"\\server\共享\构建请求.json"
        );
    }

    fn test_upload_file(name: &str, expected_size: u64) -> (PathBuf, StandalonePackageUploadFile) {
        let root = std::env::temp_dir().join(format!(
            "agentvn-standalone-upload-test-{}-{}-{}",
            std::process::id(),
            error_report_timestamp(),
            name
        ));
        fs::create_dir_all(&root).expect("create upload test directory");
        let path = root.join("incoming.bin");
        fs::File::create(&path).expect("create upload test file");
        (
            root,
            StandalonePackageUploadFile {
                path,
                expected_size,
                written_bytes: 0,
            },
        )
    }

    #[test]
    fn standalone_upload_enforces_offsets_sizes_and_disk_length() {
        let (root, mut upload) = test_upload_file("append", 5);
        assert_eq!(
            append_standalone_package_upload_file(&mut upload, 0, &[1, 2, 3]).unwrap(),
            3
        );
        assert!(append_standalone_package_upload_file(&mut upload, 2, &[4]).is_err());
        assert!(append_standalone_package_upload_file(&mut upload, 3, &[4, 5, 6]).is_err());
        assert_eq!(
            append_standalone_package_upload_file(&mut upload, 3, &[4, 5]).unwrap(),
            5
        );
        validate_standalone_package_upload_file(&upload).unwrap();
        assert_eq!(fs::read(&upload.path).unwrap(), vec![1, 2, 3, 4, 5]);
        fs::remove_dir_all(root).expect("remove upload test directory");
    }

    #[test]
    fn standalone_upload_rejects_incomplete_files() {
        let (root, mut upload) = test_upload_file("incomplete", 4);
        append_standalone_package_upload_file(&mut upload, 0, &[1, 2]).unwrap();
        assert!(validate_standalone_package_upload_file(&upload).is_err());
        fs::remove_dir_all(root).expect("remove upload test directory");
    }

    #[test]
    fn android_import_retains_toolchain_when_only_host_prerequisites_are_missing() {
        let host_only = serde_json::json!({
            "status": "BLOCKED",
            "checks": [
                { "id": "java", "status": "PASS" },
                { "id": "windows_msvc_linker", "status": "BLOCKED" }
            ]
        });
        assert!(android_environment_blocked_only_by_host_prerequisites(
            &host_only
        ));

        let managed_tool_missing = serde_json::json!({
            "status": "BLOCKED",
            "checks": [
                { "id": "java", "status": "BLOCKED" },
                { "id": "windows_msvc_linker", "status": "BLOCKED" }
            ]
        });
        assert!(!android_environment_blocked_only_by_host_prerequisites(
            &managed_tool_missing
        ));
    }

    #[test]
    fn standalone_upload_rejects_invalid_ids_types_and_disk_tampering() {
        for invalid in ["", "../escape", "with/slash", "with space", "中文"] {
            assert!(validate_standalone_package_upload_id(invalid).is_err());
        }
        validate_standalone_package_upload_id("standalone-upload-123").unwrap();

        let (root, mut cartridge) = test_upload_file("tamper", 4);
        append_standalone_package_upload_file(&mut cartridge, 0, &[1, 2]).unwrap();
        let mut tamper = fs::OpenOptions::new()
            .append(true)
            .open(&cartridge.path)
            .expect("open upload for tampering");
        tamper.write_all(&[9]).expect("tamper upload length");
        tamper.flush().expect("flush tampered upload");
        assert!(append_standalone_package_upload_file(&mut cartridge, 2, &[3]).is_err());
        assert!(validate_standalone_package_upload_file(&cartridge).is_err());

        let mut session = StandalonePackageUploadSession {
            upload_id: "standalone-upload-test".to_string(),
            root_dir: root.clone(),
            cartridge,
            icon: None,
        };
        assert!(standalone_package_upload_file_mut(&mut session, "icon").is_err());
        assert!(standalone_package_upload_file_mut(&mut session, "other").is_err());
        cleanup_standalone_package_upload_session(session).unwrap();
        assert!(
            !root.exists(),
            "abort cleanup must remove the upload directory"
        );
    }

    #[test]
    fn failed_build_cleanup_keeps_only_diagnostics() {
        let root = std::env::temp_dir().join(format!(
            "agentvn-standalone-cleanup-test-{}-{}",
            std::process::id(),
            error_report_timestamp()
        ));
        let cartridge = root.join("game.vncart");
        let icon = root.join("icon.png");
        let workspace = root.join("build-workspace");
        let diagnostics = root.join("diagnostics");
        fs::create_dir_all(&workspace).expect("create build workspace");
        fs::create_dir_all(&diagnostics).expect("create diagnostics");
        fs::write(&cartridge, [1, 2, 3]).expect("write cartridge");
        fs::write(&icon, [4, 5]).expect("write icon");
        fs::write(workspace.join("large.tmp"), [6, 7]).expect("write workspace temp");
        fs::write(diagnostics.join("package-build-manifest.json"), "{}")
            .expect("write diagnostics manifest");

        cleanup_standalone_package_build_inputs(&root, &cartridge, Some(&icon)).unwrap();
        assert!(!cartridge.exists());
        assert!(!icon.exists());
        assert!(!workspace.exists());
        assert!(diagnostics.join("package-build-manifest.json").exists());
        fs::remove_dir_all(root).expect("remove cleanup test directory");
    }

    #[test]
    fn package_manifest_reader_accepts_utf8_bom_and_unicode_paths() {
        let root = std::env::temp_dir().join(format!(
            "agentvn-standalone-manifest-test-{}-{}",
            std::process::id(),
            error_report_timestamp()
        ));
        fs::create_dir_all(&root).expect("create manifest test directory");
        let manifest = root.join("package-build-manifest.json");
        let verify = root.join("standalone-windows-verify.json");
        let build = root.join("standalone-windows-build.log");
        let json = serde_json::json!({
            "status": "FAIL",
            "message": "中文路径失败",
            "artifacts": [],
            "warnings": ["请检查目录"],
            "failureCode": "ENCODING_INVALID",
            "permissionDetails": {
                "schemaVersion": 1,
                "probeRoot": "C:\\中文构建目录",
                "success": false,
                "win32ErrorCode": 1314
            },
            "verifyReportPath": verify.to_string_lossy(),
            "buildLogPath": build.to_string_lossy()
        });
        let mut bytes = vec![0xEF, 0xBB, 0xBF];
        bytes.extend_from_slice(
            serde_json::to_string_pretty(&json)
                .expect("serialize manifest")
                .as_bytes(),
        );
        fs::write(&manifest, bytes).expect("write BOM manifest");

        let result = read_script_manifest(&manifest, &verify, &build)
            .expect("manifest with BOM must remain readable");
        assert_eq!(result.status, "FAIL");
        assert_eq!(result.message, "中文路径失败");
        assert_eq!(result.warnings, vec!["请检查目录"]);
        assert_eq!(result.failure_code.as_deref(), Some("ENCODING_INVALID"));
        assert_eq!(
            result
                .permission_details
                .as_ref()
                .and_then(|value| value.get("win32ErrorCode"))
                .and_then(|value| value.as_i64()),
            Some(1314)
        );
        fs::remove_dir_all(root).expect("remove manifest test directory");
    }

    #[test]
    fn atomic_json_writer_preserves_unicode_as_utf8_without_bom() {
        let root = std::env::temp_dir().join(format!(
            "agentvn-utf8-json-test-{}-{}",
            std::process::id(),
            error_report_timestamp()
        ));
        fs::create_dir_all(&root).expect("create UTF-8 JSON fixture");
        let path = root.join("中文状态.json");
        write_json_atomic(
            &path,
            &serde_json::json!({
                "title": "隐忍的成长",
                "message": "构建失败：需要符号链接权限"
            }),
        )
        .expect("write UTF-8 JSON atomically");
        let bytes = fs::read(&path).expect("read UTF-8 JSON bytes");
        assert!(!bytes.starts_with(&[0xff, 0xfe]));
        assert!(!bytes.starts_with(&[0xef, 0xbb, 0xbf]));
        let text = String::from_utf8(bytes).expect("strict UTF-8");
        assert!(text.contains("隐忍的成长"));
        fs::remove_dir_all(root).expect("remove UTF-8 JSON fixture");
    }

    #[test]
    fn environment_pass_cache_rejects_other_editor_versions() {
        let root = std::env::temp_dir().join(format!("agentvn-version-cache-{}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        for platform in ["windows", "android"] {
            let path = root.join(format!("{platform}.json"));
            let mut result = serde_json::json!({"status":"PASS", "ok":true});
            persist_environment_pass_cache(&path, platform, &mut result).unwrap();
            assert!(read_environment_pass_cache(&path, platform).is_some());
            result.as_object_mut().unwrap().remove("cacheEditorVersion");
            write_json_atomic(&path, &result).unwrap();
            assert!(read_environment_pass_cache(&path, platform).is_none(), "{platform}: unversioned cache must be checked again");
            result["cacheEditorVersion"] = serde_json::json!("different-editor-version");
            write_json_atomic(&path, &result).unwrap();
            assert!(read_environment_pass_cache(&path, platform).is_none(), "{platform}: old version must be checked again");
        }
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn environment_pass_cache_accepts_only_matching_successful_schema() {
        let root = std::env::temp_dir().join(format!(
            "agentvn-environment-cache-test-{}-{}",
            std::process::id(),
            error_report_timestamp()
        ));
        fs::create_dir_all(&root).expect("create environment cache fixture");
        let path = root.join("android-pass.json");
        write_json_atomic(
            &path,
            &serde_json::json!({
                "cacheSchemaVersion": ENVIRONMENT_PASS_CACHE_SCHEMA_VERSION,
                "cachePlatform": "android",
                "ok": true,
                "status": "PASS",
                "message": "中文环境已通过",
                "cacheEditorVersion": env!("CARGO_PKG_VERSION")
            }),
        )
        .expect("write Android environment PASS cache");
        assert!(read_environment_pass_cache(&path, "android").is_some());
        assert!(read_environment_pass_cache(&path, "windows").is_none());

        write_json_atomic(
            &path,
            &serde_json::json!({
                "cacheSchemaVersion": ENVIRONMENT_PASS_CACHE_SCHEMA_VERSION,
                "cachePlatform": "android",
                "ok": false,
                "status": "BLOCKED"
            }),
        )
        .expect("write blocked cache");
        assert!(read_environment_pass_cache(&path, "android").is_none());
        fs::remove_dir_all(root).expect("remove environment cache fixture");
    }

    #[test]
    fn environment_pass_cache_is_removed_when_current_check_is_blocked() {
        let root = std::env::temp_dir().join(format!(
            "agentvn-environment-cache-invalidation-test-{}-{}",
            std::process::id(),
            error_report_timestamp()
        ));
        fs::create_dir_all(&root).expect("create environment cache invalidation fixture");
        let path = root.join("windows-pass.json");
        write_json_atomic(
            &path,
            &serde_json::json!({
                "cacheSchemaVersion": ENVIRONMENT_PASS_CACHE_SCHEMA_VERSION,
                "cachePlatform": "windows",
                "ok": true,
                "status": "PASS"
            }),
        )
        .expect("write stale Windows environment PASS cache");
        let mut blocked = serde_json::json!({
            "ok": false,
            "status": "BLOCKED"
        });
        persist_environment_pass_cache(&path, "windows", &mut blocked)
            .expect("invalidate stale Windows environment cache");
        assert!(
            !path.exists(),
            "a failed forced check must remove the previous PASS cache"
        );
        fs::remove_dir_all(root).expect("remove environment cache invalidation fixture");
    }

    #[test]
    fn windows_environment_repair_configures_existing_rustup_when_cargo_is_inactive() {
        let missing = HashSet::from(["cargo".to_string()]);
        assert_eq!(
            native_windows_rust_repair_plan(&missing, true, true),
            vec![
                NativeWindowsRustRepairStep::InstallStableMsvcToolchain,
                NativeWindowsRustRepairStep::ActivateStableMsvcToolchain,
            ]
        );
    }

    #[test]
    fn windows_environment_repair_installs_rustup_before_configuring_when_missing() {
        let missing = HashSet::from(["cargo".to_string(), "rustup".to_string()]);
        assert_eq!(
            native_windows_rust_repair_plan(&missing, false, true),
            vec![
                NativeWindowsRustRepairStep::InstallRustupPackage,
                NativeWindowsRustRepairStep::InstallStableMsvcToolchain,
                NativeWindowsRustRepairStep::ActivateStableMsvcToolchain,
            ]
        );
    }

    #[test]
    fn windows_environment_repair_does_not_claim_configuration_without_rustup_or_winget() {
        let missing = HashSet::from(["cargo".to_string(), "rustup".to_string()]);
        assert!(
            native_windows_rust_repair_plan(&missing, false, false).is_empty(),
            "without rustup or winget the repair must remain explicitly blocked"
        );
    }

    #[test]
    fn symlink_failure_classification_does_not_assume_developer_mode_is_required() {
        let capability = |success, code, elevated| AndroidSymlinkCapability {
            schema_version: 1,
            probe_root: "C:\\构建目录".to_string(),
            resolved_probe_root: None,
            success,
            win32_error_code: code,
            error: None,
            failed_operation: None,
            windows_build: "test".to_string(),
            checked_at: 0,
            is_elevated: elevated,
            developer_mode_enabled: false,
            symbolic_link_privilege_present: false,
            symbolic_link_privilege_enabled: false,
            symbolic_link_privilege_query_error: None,
        };
        assert_eq!(
            classify_android_symlink_failure(&capability(true, None, false)),
            None
        );
        assert_eq!(
            classify_android_symlink_failure(&capability(false, Some(1314), false)),
            Some("SYMLINK_PRIVILEGE_REQUIRED")
        );
        assert_eq!(
            classify_android_symlink_failure(&capability(false, Some(1314), true)),
            Some("ELEVATED_SYMLINK_DENIED")
        );
        assert_eq!(
            classify_android_symlink_failure(&capability(false, Some(50), false)),
            Some("SYMLINK_UNSUPPORTED")
        );
        let read_failure = AndroidSymlinkCapability {
            failed_operation: Some("read-symbolic-link".into()),
            ..capability(false, Some(3), false)
        };
        assert_eq!(classify_android_symlink_failure(&read_failure), Some("SYMLINK_PROBE_IO_FAILED"));
        let mut legacy = serde_json::to_value(capability(true, None, false)).unwrap();
        legacy.as_object_mut().unwrap().remove("failedOperation");
        legacy.as_object_mut().unwrap().remove("resolvedProbeRoot");
        let restored: AndroidSymlinkCapability = serde_json::from_value(legacy).unwrap();
        assert!(restored.success);
        assert!(restored.failed_operation.is_none() && restored.resolved_probe_root.is_none());
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn android_symlink_probe_reports_source_directory_io_failure() {
        let root = std::env::temp_dir().join(format!(
            "agentvn-symlink-blocked-{}-{}", std::process::id(), error_report_timestamp()
        ));
        fs::write(&root, "owned fixture blocks directory creation").unwrap();
        let result = probe_android_symlink_capability(&root);
        assert_eq!(fs::read_to_string(&root).unwrap(), "owned fixture blocks directory creation");
        fs::remove_file(&root).unwrap();
        assert!(!result.success);
        assert_eq!(result.failed_operation.as_deref(), Some("create-probe-directory"));
        assert_eq!(classify_android_symlink_failure(&result), Some("SYMLINK_PROBE_IO_FAILED"));
    }

    #[cfg(target_os = "windows")]
    #[test]
    #[ignore = "Real Windows AppData filesystem regression; run explicitly under the QA session"]
    fn android_symlink_probe_reads_back_in_redirected_appdata() {
        let root = PathBuf::from(std::env::var_os("LOCALAPPDATA").expect("LOCALAPPDATA"))
            .join("com.agentvn.editor").join("standalone-package")
            .join(format!("symlink-regression-{}-{}", std::process::id(), error_report_timestamp()));
        assert!(!root.exists(), "fresh owned fixture required");
        let capability = probe_android_symlink_capability(&root);
        fs::remove_dir(&root).expect("remove empty owned fixture after probe cleanup");
        println!("{capability:#?}");
        assert!(capability.success, "Actual symlink readback failed: {capability:#?}");
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn android_standalone_build_requires_elevation_by_default_for_non_admin_processes() {
        let capability = AndroidSymlinkCapability {
            schema_version: 2,
            probe_root: "C:\\构建目录".to_string(),
            resolved_probe_root: None,
            success: true,
            win32_error_code: None,
            error: None,
            failed_operation: None,
            windows_build: "test".to_string(),
            checked_at: 0,
            is_elevated: false,
            developer_mode_enabled: true,
            symbolic_link_privilege_present: false,
            symbolic_link_privilege_enabled: false,
            symbolic_link_privilege_query_error: None,
        };
        assert!(
            android_build_requires_default_elevation(&capability),
            "a successful non-elevated symlink probe must still use the elevated Android build helper"
        );

        let elevated = AndroidSymlinkCapability {
            is_elevated: true,
            ..capability
        };
        assert!(
            !android_build_requires_default_elevation(&elevated),
            "an already elevated Android build must not request a second UAC prompt"
        );
    }

    #[test]
    fn diagnostics_archive_keeps_relative_files_and_unicode_names() {
        let root = std::env::temp_dir().join(format!(
            "agentvn-standalone-diagnostics-test-{}-{}",
            std::process::id(),
            error_report_timestamp()
        ));
        let diagnostics = root.join("diagnostics");
        let nested = diagnostics.join("子目录");
        fs::create_dir_all(&nested).expect("create diagnostics fixture");
        fs::write(diagnostics.join("build.log"), "构建失败").expect("write build log");
        fs::write(nested.join("verify.json"), r#"{"ok":false}"#).expect("write verify report");
        let archive_path = root.join("agentvn-standalone-diagnostics.zip");
        create_standalone_diagnostics_archive(&diagnostics, &archive_path)
            .expect("create diagnostics archive");

        let file = File::open(&archive_path).expect("open diagnostics archive");
        let mut archive = ZipArchive::new(file).expect("read diagnostics archive");
        assert!(archive.by_name("build.log").is_ok());
        assert!(archive.by_name("子目录/verify.json").is_ok());
        fs::remove_dir_all(root).expect("remove diagnostics test directory");
    }

    #[test]
    fn rust_cartridge_preparation_accepts_unicode_and_required_json() {
        let root = std::env::temp_dir().join(format!(
            "agentvn-cartridge-prepare-test-{}-{}",
            std::process::id(),
            error_report_timestamp()
        ));
        fs::create_dir_all(&root).expect("create cartridge preparation fixture");
        let cartridge = root.join("中文游戏.vncart");
        let file = File::create(&cartridge).expect("create cartridge");
        let mut writer = zip::ZipWriter::new(file);
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
        for (name, contents) in [
            (
                "manifest.json",
                r#"{"title":"隐忍的成长","game_id":"unicode"}"#,
            ),
            ("script.json", r#"{"scenes":[]}"#),
            ("checksum.json", r#"{"algorithm":"sha256","files":[]}"#),
            ("assets/中文.txt", "内容"),
        ] {
            writer
                .start_file(name, options)
                .expect("start cartridge file");
            writer
                .write_all(contents.as_bytes())
                .expect("write cartridge file");
        }
        writer.finish().expect("finish cartridge");
        let prepared = root.join("prepared");
        let report = root.join("safety.json");
        prepare_standalone_cartridge_safely(&cartridge, &prepared, &report)
            .expect("prepare safe unicode cartridge");
        assert_eq!(
            fs::read_to_string(prepared.join("assets/中文.txt")).unwrap(),
            "内容"
        );
        let report_value: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(report).unwrap()).unwrap();
        assert_eq!(
            report_value.get("ok").and_then(|value| value.as_bool()),
            Some(true)
        );
        fs::remove_dir_all(root).expect("remove cartridge preparation fixture");
    }

    #[test]
    fn rust_cartridge_preparation_rejects_traversal_entries() {
        let root = std::env::temp_dir().join(format!(
            "agentvn-cartridge-traversal-test-{}-{}",
            std::process::id(),
            error_report_timestamp()
        ));
        fs::create_dir_all(&root).expect("create traversal fixture");
        let cartridge = root.join("unsafe.vncart");
        let file = File::create(&cartridge).expect("create unsafe cartridge");
        let mut writer = zip::ZipWriter::new(file);
        writer
            .start_file("../escape.txt", SimpleFileOptions::default())
            .expect("start unsafe entry");
        writer.write_all(b"escape").expect("write unsafe entry");
        writer.finish().expect("finish unsafe cartridge");
        let prepared = root.join("prepared");
        let report = root.join("safety.json");
        let error = prepare_standalone_cartridge_safely(&cartridge, &prepared, &report)
            .expect_err("traversal cartridge must fail");
        assert!(error.contains("unsafe path"));
        assert!(!root.join("escape.txt").exists());
        assert!(!prepared.exists());
        fs::remove_dir_all(root).expect("remove traversal fixture");
    }

    #[test]
    fn rust_artifact_collection_supports_unicode_workspace_and_output_paths() {
        let root = std::env::temp_dir().join(format!(
            "agentvn-artifact-collection-test-{}-{}",
            std::process::id(),
            error_report_timestamp()
        ));
        let run_root = root.join("构建工作区");
        let release = run_root
            .join("GameCli_framework")
            .join("src-tauri")
            .join("target")
            .join("release");
        let resource_source = release.join("embedded-cartridge");
        let nsis = release.join("bundle").join("nsis");
        fs::create_dir_all(&resource_source).expect("create resource source");
        fs::create_dir_all(&nsis).expect("create nsis directory");

        let exe = release.join("agentvn-player.exe");
        let mut pe = vec![0u8; 256];
        pe[0..2].copy_from_slice(b"MZ");
        pe[0x3c..0x40].copy_from_slice(&(0x80u32).to_le_bytes());
        pe[0x80..0x84].copy_from_slice(b"PE\0\0");
        pe[0x80 + 24 + 68..0x80 + 24 + 70].copy_from_slice(&(2u16).to_le_bytes());
        fs::write(&exe, pe).expect("write fake PE");
        fs::write(resource_source.join("中文资源.txt"), "资源").expect("write unicode resource");
        fs::write(nsis.join("AgentVN-setup.exe"), b"installer").expect("write fake installer");

        let verify = root.join("诊断").join("verify.json");
        fs::create_dir_all(verify.parent().unwrap()).expect("create verify directory");
        fs::write(&verify, r#"{"title":"中文游戏"}"#).expect("write verify report");
        let optimization = verify.parent().unwrap().join("optimization.json");
        fs::write(&optimization, r#"{"mode":"off"}"#).expect("write optimization report");
        let output = root.join("输出目录");
        fs::create_dir_all(&output).expect("create unicode output");

        let artifacts =
            collect_windows_standalone_artifacts(&run_root, &output, &verify, &optimization)
                .expect("collect unicode artifacts");
        assert_eq!(artifacts.len(), 3);
        assert!(output.join("portable").join("中文游戏.exe").is_file());
        assert!(output
            .join("portable")
            .join("embedded-cartridge")
            .join("中文资源.txt")
            .is_file());
        assert!(output.join("中文游戏-setup.exe").is_file());
        assert!(output.join("release-optimization-report.json").is_file());
        fs::remove_dir_all(root).expect("remove artifact collection fixture");
    }

    #[test]
    fn android_environment_pack_extracts_unicode_payload_with_hash_validation() {
        let root = std::env::temp_dir().join(format!(
            "agentvn-android-env-pack-test-{}-{}",
            std::process::id(),
            error_report_timestamp()
        ));
        fs::create_dir_all(&root).expect("create Android environment pack fixture");
        let archive_path = root.join("安卓构建依赖.avnenv");
        let payload_path = "payload/toolchain/中文工具.txt";
        let payload = "构建依赖".as_bytes();
        let payload_hash = hex::encode(Sha256::digest(payload));
        let format = serde_json::json!({
            "schemaVersion": 1,
            "kind": "agentvn-android-environment",
            "packageId": "agentvn.android.windows-x86_64.api36",
            "packVersion": "test",
            "complete": true,
            "platform": "windows-x86_64",
            "apiLevel": "36",
            "buildToolsVersion": "36.0.0",
            "ndkVersion": "27.2.12479018",
            "gradleVersion": "8.14.3",
            "payloadRoot": "payload",
            "totalBytes": payload.len(),
            "fileCount": 1,
            "requiredPaths": [payload_path],
            "missing": [],
            "files": [{
                "path": payload_path,
                "bytes": payload.len(),
                "sha256": payload_hash
            }]
        });
        let file = File::create(&archive_path).expect("create environment archive");
        let mut writer = ZipWriter::new(file);
        writer
            .start_file("format.json", SimpleFileOptions::default())
            .expect("start environment format");
        writer
            .write_all(serde_json::to_string(&format).unwrap().as_bytes())
            .expect("write environment format");
        writer
            .start_file(payload_path, SimpleFileOptions::default())
            .expect("start environment payload");
        writer
            .write_all(payload)
            .expect("write environment payload");
        writer.finish().expect("finish environment archive");

        let extracted = root.join("extracted");
        let parsed = extract_android_environment_package(None, "", &archive_path, &extracted, None)
            .expect("extract valid environment package");
        assert_eq!(parsed.pack_version, "test");
        assert_eq!(
            fs::read(extracted.join("payload/toolchain/中文工具.txt")).unwrap(),
            payload
        );
        fs::remove_dir_all(root).expect("remove Android environment pack fixture");
    }

    #[test]
    fn android_environment_replacement_removes_old_managed_files_and_deploys_directly() {
        let root = std::env::temp_dir().join(format!(
            "agentvn-android-env-replacement-test-{}-{}",
            std::process::id(),
            error_report_timestamp()
        ));
        let paths = AndroidManagedEnvironmentPaths {
            tool_root: root.join("AgentVN").join("AndroidToolchain"),
            gradle_home: root.join("AgentVN").join("GradleHome"),
            pass_cache_path: root
                .join("AgentVN")
                .join("environment-cache")
                .join("android-pass.json"),
            import_cache_root: root.join("editor-cache").join("android-env-import"),
            lock_path: root
                .join("AgentVN")
                .join("environment-cache")
                .join("android-operation.lock"),
        };
        fs::create_dir_all(paths.tool_root.join("Sdk").join("Sdk"))
            .expect("create duplicate old SDK fixture");
        fs::create_dir_all(&paths.gradle_home).expect("create old Gradle fixture");
        fs::create_dir_all(paths.import_cache_root.join("staging-old"))
            .expect("create old import staging fixture");
        fs::create_dir_all(paths.pass_cache_path.parent().unwrap())
            .expect("create old PASS cache parent");
        fs::write(
            paths.tool_root.join("Sdk").join("Sdk").join("old.txt"),
            b"old-sdk",
        )
        .expect("write old SDK fixture");
        fs::write(paths.gradle_home.join("old.bin"), b"old-gradle")
            .expect("write old Gradle fixture");
        fs::write(&paths.pass_cache_path, b"old-pass").expect("write old PASS cache");
        fs::write(
            paths.import_cache_root.join("staging-old").join("old.tmp"),
            b"old-stage",
        )
        .expect("write old import staging fixture");
        let unrelated = root.join("user-global-cargo-sentinel.txt");
        fs::write(&unrelated, b"keep").expect("write unrelated fixture");

        let reclaimed = clear_managed_android_environment_paths(&paths)
            .expect("clear only the managed Android environment");
        assert!(reclaimed > 0);
        assert!(!paths.tool_root.exists());
        assert!(!paths.gradle_home.exists());
        assert!(!paths.pass_cache_path.exists());
        assert!(!paths.import_cache_root.join("staging-old").exists());
        assert!(unrelated.is_file());

        let archive_path = root.join("新环境.avnenv");
        let payloads = [
            (
                "payload/toolchain/Sdk/platform-tools/adb.exe",
                b"new-adb".as_slice(),
            ),
            (
                "payload/gradle-home/caches/modules/module.bin",
                b"new-gradle".as_slice(),
            ),
        ];
        let total_bytes = payloads
            .iter()
            .map(|(_, bytes)| bytes.len() as u64)
            .sum::<u64>();
        let files = payloads
            .iter()
            .map(|(path, bytes)| {
                serde_json::json!({
                    "path": path,
                    "bytes": bytes.len(),
                    "sha256": hex::encode(Sha256::digest(bytes))
                })
            })
            .collect::<Vec<_>>();
        let format = serde_json::json!({
            "schemaVersion": 1,
            "kind": "agentvn-android-environment",
            "packageId": "agentvn.android.windows-x86_64.api36",
            "packVersion": "replacement-test",
            "complete": true,
            "platform": "windows-x86_64",
            "apiLevel": "36",
            "buildToolsVersion": "36.0.0",
            "ndkVersion": "27.2.12479018",
            "gradleVersion": "8.14.3",
            "payloadRoot": "payload",
            "totalBytes": total_bytes,
            "fileCount": files.len(),
            "requiredPaths": payloads.iter().map(|(path, _)| *path).collect::<Vec<_>>(),
            "missing": [],
            "files": files
        });
        let file = File::create(&archive_path).expect("create replacement archive");
        let mut writer = ZipWriter::new(file);
        writer
            .start_file("format.json", SimpleFileOptions::default())
            .expect("start replacement format");
        writer
            .write_all(serde_json::to_string(&format).unwrap().as_bytes())
            .expect("write replacement format");
        for (path, bytes) in payloads {
            writer
                .start_file(path, SimpleFileOptions::default())
                .expect("start replacement payload");
            writer.write_all(bytes).expect("write replacement payload");
        }
        writer.finish().expect("finish replacement archive");

        extract_android_environment_package(
            None,
            "",
            &archive_path,
            &paths.tool_root,
            Some(&paths),
        )
        .expect("deploy replacement directly to managed roots");
        assert_eq!(
            fs::read(
                paths
                    .tool_root
                    .join("Sdk")
                    .join("platform-tools")
                    .join("adb.exe")
            )
            .unwrap(),
            b"new-adb"
        );
        assert_eq!(
            fs::read(
                paths
                    .gradle_home
                    .join("caches")
                    .join("modules")
                    .join("module.bin")
            )
            .unwrap(),
            b"new-gradle"
        );
        assert!(!paths.tool_root.join("payload").exists());
        assert!(!paths.tool_root.join("Sdk").join("Sdk").exists());
        assert!(unrelated.is_file());
        fs::remove_dir_all(root).expect("remove replacement test fixture");
    }

    #[test]
    fn android_environment_operation_lock_blocks_parallel_updates_and_builds() {
        let root = std::env::temp_dir().join(format!(
            "agentvn-android-env-lock-test-{}-{}",
            std::process::id(),
            error_report_timestamp()
        ));
        let lock_path = root.join("android-operation.lock");
        let first = try_acquire_android_environment_operation_lock_at(&lock_path, "import")
            .expect("acquire first Android environment operation lock");
        let error = try_acquire_android_environment_operation_lock_at(&lock_path, "build")
            .err()
            .expect("parallel Android environment operation must be blocked");
        assert!(error.contains("ANDROID_ENV_BUSY"));
        drop(first);
        let second = try_acquire_android_environment_operation_lock_at(&lock_path, "build")
            .expect("lock is released when the previous operation finishes");
        drop(second);
        assert!(!lock_path.exists());
        fs::remove_dir_all(root).expect("remove lock test fixture");
    }

    #[test]
    fn android_environment_operation_lock_recovers_after_owner_process_is_gone() {
        let root = std::env::temp_dir().join(format!(
            "agentvn-android-env-stale-lock-test-{}-{}",
            std::process::id(),
            error_report_timestamp()
        ));
        fs::create_dir_all(&root).expect("create stale lock fixture");
        let lock_path = root.join("android-operation.lock");
        fs::write(&lock_path, "pid=4294967294\noperation=abandoned")
            .expect("write stale lock fixture");
        let lock = try_acquire_android_environment_operation_lock_at(&lock_path, "replacement")
            .expect("replace stale Android environment operation lock");
        let contents = fs::read_to_string(&lock_path).expect("read replacement lock");
        assert!(contents.contains(&format!("pid={}", std::process::id())));
        drop(lock);
        assert!(!lock_path.exists());
        fs::remove_dir_all(root).expect("remove stale lock fixture");
    }

    #[test]
    fn android_environment_pack_rejects_traversal_path() {
        assert!(
            validate_android_environment_pack_path("payload/../escape.exe", false)
                .unwrap_err()
                .contains("ANDROID_ENV_PACK_PATH_UNSAFE")
        );
        assert!(validate_android_environment_pack_path("C:/escape.exe", false).is_err());
        assert!(validate_android_environment_pack_path("payload\\escape.exe", false).is_err());
    }
}
