#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

use std::{
    collections::HashMap,
    fs,
    fs::File,
    io::{self, Read, Seek, SeekFrom, Write},
    net::{SocketAddr, TcpStream},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{Mutex, OnceLock},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{Emitter, Manager};
use tauri_plugin_dialog::DialogExt;
use zip::ZipArchive;

struct DevProcesses {
    backend: Mutex<Option<Child>>,
    frontend: Mutex<Option<Child>>,
    gamecli_preview: Mutex<Option<Child>>,
    gamecli_preview_cartridge: Mutex<Option<PathBuf>>,
    gamecli_preview_disk_upload: Mutex<Option<GameCliPreviewDiskUploadMeta>>,
    gamecli_preview_directory: Mutex<Option<GameCliPreviewDirectorySession>>,
    standalone_package_upload: Mutex<Option<StandalonePackageUploadSession>>,
}

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

const PROJECT_BACKUP_KEEP_COUNT: usize = 10;
const PROJECT_BACKUP_SAFE_FALLBACK_MAX_BYTES: u64 = 4 * 1024 * 1024;
const MAX_ERROR_LOG_BYTES: u64 = 10 * 1024 * 1024;
const ERROR_LOG_BACKUP_COUNT: usize = 10;
const MAX_ERROR_LOG_LINE_BYTES: usize = 64 * 1024;
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

fn redact_ascii_token_after_marker(mut value: String, marker: &str, preserve_marker: bool) -> String {
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
            && matches!(bytes[token_start], b' ' | b'\t' | b':' | b'=' | b'"' | b'\'')
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
    for marker in ["bearer ", "api_key", "api-key", "authorization", "token", "secret", "password"] {
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
            if matches!(character, '&' | '#' | '"' | '\'' | ',' | '}' | ']' | ' ' | '\t' | '\r' | '\n') {
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
    let mut recent = recent.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
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
    let mut file = fs::OpenOptions::new().create(true).append(true).open(path)?;
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
struct ProjectBackupMeta {
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
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let mut stream = match TcpStream::connect_timeout(&addr, Duration::from_millis(500)) {
        Ok(stream) => stream,
        Err(_) => return false,
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(800)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(800)));
    let request =
        format!("GET /api/health HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n");
    if std::io::Write::write_all(&mut stream, request.as_bytes()).is_err() {
        return false;
    }
    let mut response = String::new();
    if std::io::Read::read_to_string(&mut stream, &mut response).is_err() {
        return false;
    }
    response.starts_with("HTTP/1.1 200") || response.starts_with("HTTP/1.0 200")
}

fn wait_for_backend_health(port: u16, timeout_secs: u64) -> bool {
    let start = Instant::now();
    while start.elapsed().as_secs() < timeout_secs {
        if backend_health_ok(port) {
            return true;
        }
        std::thread::sleep(Duration::from_millis(500));
    }
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

fn editor_app_data_dir(_app: &tauri::AppHandle) -> PathBuf {
    app_data_override_dir().unwrap_or_else(install_data_dir)
}

fn migrate_legacy_backend_database(legacy_data_dir: &Path, target_data_dir: &Path) {
    let legacy_db = legacy_data_dir.join("vn_engine.db");
    if !legacy_db.exists() {
        return;
    }

    let _ = fs::create_dir_all(target_data_dir);
    let target_db = target_data_dir.join("vn_engine.db");
    let legacy_size = fs::metadata(&legacy_db)
        .map(|metadata| metadata.len())
        .unwrap_or(0);
    let target_size = fs::metadata(&target_db)
        .map(|metadata| metadata.len())
        .unwrap_or(0);

    if target_db.exists() && target_size > 128 * 1024 && target_size >= legacy_size {
        eprintln!(
            "[AgentVN] Target database already exists and looks populated; skipping legacy DB migration. target={}, legacy={}",
            target_db.display(),
            legacy_db.display()
        );
        return;
    }

    if target_db.exists() {
        let backup_name = format!(
            "vn_engine.before-legacy-migration-{}.db",
            error_report_timestamp()
        );
        let backup_path = target_data_dir.join(backup_name);
        if let Err(error) = fs::copy(&target_db, &backup_path) {
            eprintln!(
                "[AgentVN] WARNING: Failed to back up existing target database {}: {error}",
                target_db.display()
            );
            return;
        }
    }

    match fs::copy(&legacy_db, &target_db) {
        Ok(bytes) => {
            eprintln!(
                "[AgentVN] Migrated legacy backend database: {} -> {} ({} bytes)",
                legacy_db.display(),
                target_db.display(),
                bytes
            );
        }
        Err(error) => {
            eprintln!(
                "[AgentVN] WARNING: Failed to migrate legacy backend database {} -> {}: {error}",
                legacy_db.display(),
                target_db.display()
            );
        }
    }
}

fn start_workspace_backend(app: &tauri::AppHandle, root: &Path) -> Option<Child> {
    let backend_dir = root.join("backend");

    if !backend_dir.join("pyproject.toml").exists() {
        eprintln!(
            "[AgentVN] Backend dir not found at {}",
            backend_dir.display()
        );
        return None;
    }

    if backend_health_ok(8278) {
        eprintln!("[AgentVN] Backend health check passed on 8278; reusing.");
        return None;
    }

    if port_is_open(8278) {
        eprintln!("[AgentVN] Backend port 8278 is open but /api/health did not pass; attempting startup may fail with a bind error.");
    }

    let legacy_data_dir = backend_dir.join("data");
    let data_dir = editor_app_data_dir(app).join("backend");
    let _ = std::fs::create_dir_all(&data_dir);
    migrate_legacy_backend_database(&legacy_editor_app_data_dir(app).join("backend"), &data_dir);
    migrate_legacy_backend_database(&legacy_data_dir, &data_dir);
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

    let uvicorn_args: [&str; 8] = [
        "-m",
        "uvicorn",
        "app.main:app",
        "--host",
        "127.0.0.1",
        "--port",
        "8278",
        "--reload",
    ];

    // Try uv first, fall back to python
    let mut uv_command = background_command("uv");
    let child = uv_command
        .args(["run"])
        .args(uvicorn_args)
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
        .stderr(Stdio::null())
        .spawn();

    match child {
        Ok(child) => {
            eprintln!("[AgentVN] Backend started (uv, pid {}).", child.id());
            return Some(child);
        }
        Err(_) => {
            eprintln!("[AgentVN] uv not found, trying python -m uvicorn...");
            let mut python_command = background_command("python");
            match python_command
                .args(uvicorn_args)
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
                .stderr(Stdio::null())
                .spawn()
            {
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

fn start_packaged_backend(app: &tauri::AppHandle, workspace_root: Option<&Path>) -> Option<Child> {
    if backend_health_ok(8278) {
        eprintln!("[AgentVN] Backend health check passed on 8278; reusing.");
        return None;
    }

    if port_is_open(8278) {
        eprintln!("[AgentVN] Backend port 8278 is open but /api/health did not pass; attempting packaged startup may fail with a bind error.");
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
    migrate_legacy_backend_database(&legacy_editor_app_data_dir(app).join("backend"), &data_dir);
    if let Some(root) = workspace_root {
        migrate_legacy_backend_database(&root.join("backend").join("data"), &data_dir);
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
    let child = backend_command
        .current_dir(backend_exe.parent().unwrap_or_else(|| Path::new(".")))
        .env(
            "DATABASE_PATH",
            db_path.to_str().unwrap_or("./vn_engine.db"),
        )
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
        .env("AGENTVN_BACKEND_HOST", "127.0.0.1")
        .env("AGENTVN_BACKEND_PORT", "8278")
        .env(
            "AGENTVN_WORKSPACE_ROOT",
            app_data_dir.to_string_lossy().to_string(),
        )
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn();

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
) -> Option<Child> {
    if cfg!(debug_assertions) {
        if let Some(root) = workspace_root {
            return start_workspace_backend(app, root);
        }
    }

    let packaged = start_packaged_backend(app, workspace_root);
    if packaged.is_some() || !cfg!(debug_assertions) {
        return packaged;
    }

    workspace_root.and_then(|root| start_workspace_backend(app, root))
}

fn start_frontend(root: &Path) -> Option<Child> {
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
        match npm_command
            .args(["run", "dev"])
            .current_dir(&editor_dir)
            .env("AGENTVN_WORKSPACE_ROOT", root.to_string_lossy().to_string())
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
        {
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

fn kill_child(guard: &mut Option<Child>) {
    if let Some(ref mut child) = guard {
        let _ = child.kill();
        let _ = child.wait();
    }
    guard.take();
}

#[cfg(target_os = "windows")]
fn kill_gamecli_preview_by_cartridge(cartridge_path: &Path) {
    let script = r#"
$needle = $args[0]
Get-CimInstance Win32_Process |
  Where-Object {
    $_.ExecutablePath -and
    $_.ExecutablePath -like '*agentvn-player.exe' -and
    $_.CommandLine -like "*$needle*"
  } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
"#;
    let _ = background_command("powershell.exe")
        .args(["-NoProfile", "-Command", script])
        .arg(cartridge_path.to_string_lossy().to_string())
        .status();
}

fn close_gamecli_preview_process(state: &DevProcesses) {
    kill_child(&mut state.gamecli_preview.lock().unwrap());
    let cartridge = state.gamecli_preview_cartridge.lock().unwrap().take();
    #[cfg(target_os = "windows")]
    if let Some(path) = cartridge {
        kill_gamecli_preview_by_cartridge(&path);
    }
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
    let mut candidates = vec![workspace_root(), exe_parent_dir()];
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

fn should_skip_bundled_workspace_dir(name: &str) -> bool {
    matches!(
        name,
        "node_modules" | "dist" | "target" | ".git" | ".gradle" | "build"
    )
}

fn copy_dir_for_package_build(source: &Path, destination: &Path) -> io::Result<()> {
    fs::create_dir_all(destination)?;
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let source_path = entry.path();
        let target_path = destination.join(entry.file_name());
        let file_type = entry.file_type()?;
        if file_type.is_dir() {
            let directory_name = entry.file_name().to_string_lossy().to_string();
            if should_skip_bundled_workspace_dir(&directory_name) {
                continue;
            }
            copy_dir_for_package_build(&source_path, &target_path)?;
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
    fs::create_dir_all(destination_root).map_err(|error| {
        format!(
            "Failed to create standalone build workspace {}: {error}",
            destination_root.display()
        )
    })?;

    for directory in ["scripts", "GameCli_framework", "shared"] {
        let source = source_root.join(directory);
        let destination = destination_root.join(directory);
        if !source.exists() {
            return Err(format!(
                "Bundled standalone build workspace is missing {}",
                source.display()
            ));
        }
        copy_dir_for_package_build(&source, &destination).map_err(|error| {
            format!(
                "Failed to copy bundled standalone build workspace from {} to {}: {error}",
                source.display(),
                destination.display()
            )
        })?;
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
    close_gamecli_preview_process(state);
    cleanup_gamecli_preview_cartridges(app, Some(&cartridge_path))?;

    let exe = resolve_gamecli_exe(app)?;
    eprintln!(
        "[AgentVN] Starting GameCLI preview: exe={}, cartridge={}",
        exe.display(),
        cartridge_path.display()
    );

    let mut player_command = background_command(&exe);
    let child = player_command
        .args(["--mode", "preview", "--cartridge"])
        .arg(&cartridge_path)
        .current_dir(exe.parent().unwrap_or_else(|| Path::new(".")))
        .env_remove("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS")
        .env_remove("WEBVIEW2_USER_DATA_FOLDER")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
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
    close_gamecli_preview_process(state);
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
    let child = player_command
        .spawn()
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
    close_gamecli_preview_process(state.inner());
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
    close_gamecli_preview_process(state.inner());
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
    close_gamecli_preview_process(state.inner());
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
fn close_gamecli_preview(state: tauri::State<'_, DevProcesses>) -> Result<(), String> {
    eprintln!("[AgentVN] Closing GameCLI preview process.");
    close_gamecli_preview_process(state.inner());
    Ok(())
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
    }
}

fn read_script_manifest(
    manifest_path: &Path,
    fallback_verify_report_path: &Path,
    fallback_build_log_path: &Path,
) -> Option<StandalonePackageBuildResult> {
    let raw = fs::read_to_string(manifest_path).ok()?;
    let value: serde_json::Value = serde_json::from_str(&raw).ok()?;
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

    Some(package_build_result(
        status,
        message,
        artifacts,
        warnings,
        &verify_report_path,
        &build_log_path,
        manifest_path,
    ))
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
    let text = String::from_utf8_lossy(&buffer);
    for line in text.lines() {
        let trimmed = line.trim_end();
        if trimmed.trim().is_empty() {
            continue;
        }
        emit_package_build_log(app, run_id, "info", source, trimmed.to_string());
    }
}

fn write_command_output(path: &Path, output: &std::process::Output) -> Result<(), String> {
    let mut text = String::new();
    text.push_str("== stdout ==\n");
    text.push_str(&String::from_utf8_lossy(&output.stdout));
    text.push_str("\n== stderr ==\n");
    text.push_str(&String::from_utf8_lossy(&output.stderr));
    fs::write(path, text)
        .map_err(|error| format!("Failed to write command log {}: {error}", path.display()))
}

fn build_standalone_package_blocking_inner(
    app: tauri::AppHandle,
    target_platform: String,
    output_dir: String,
    run_id: Option<String>,
    optimization_profile: String,
    cache_dir: PathBuf,
    cartridge_path: PathBuf,
    standalone_icon_path: Option<PathBuf>,
) -> Result<StandalonePackageBuildResult, String> {
    let platform = match target_platform.as_str() {
        "windows" | "android" => target_platform,
        other => return Err(format!("Unsupported package target platform: {other}")),
    };
    if !matches!(optimization_profile.as_str(), "balanced" | "lossless" | "off") {
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

    let requested_output_root = PathBuf::from(output_dir);
    fs::create_dir_all(&requested_output_root).map_err(|error| {
        format!(
            "Failed to create output directory {}: {error}",
            requested_output_root.display()
        )
    })?;
    let output_root = fs::canonicalize(&requested_output_root).unwrap_or(requested_output_root);
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
        "build-runtime-standalone-windows.ps1"
    } else {
        "build-runtime-standalone-android.ps1"
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
        return Ok(package_build_result(
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
        ));
    };

    let run_root = if is_workspace_root(&source_root) {
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
        materialize_standalone_build_workspace(&source_root, &build_workspace)?;
        build_workspace
    };

    let script_path = run_root.join("scripts").join(script_name);
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
        return Ok(package_build_result(
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
        ));
    }
    emit_package_build_log(
        &app,
        &run_id,
        "info",
        "powershell",
        format!(
            "Launching {} with output dir {}",
            script_name,
            shell_display_path(&output_root)
        ),
    );
    let mut command = background_command(powershell_command());
    command
        .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"])
        .arg(shell_display_path(&script_path))
        .arg("-CartridgePath")
        .arg(shell_display_path(&cartridge_path))
        .arg("-OutputDir")
        .arg(shell_display_path(&output_root))
        .arg("-DiagnosticsDir")
        .arg(shell_display_path(&diagnostics_dir))
        .arg("-OptimizationProfile")
        .arg(&optimization_profile)
        .arg("-Json");
    if let Some(icon_path) = &standalone_icon_path {
        command.arg("-IconPath").arg(shell_display_path(icon_path));
    }
    let mut child = command
        .current_dir(&run_root)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Failed to start standalone package build script: {error}"))?;
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
                return Err(format!(
                    "Failed while waiting for package build script: {error}"
                ));
            }
        }
    }
    let output = child
        .wait_with_output()
        .map_err(|error| format!("Failed to collect standalone package build output: {error}"))?;
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
    Ok(package_build_result(
        status,
        format!(
            "Standalone package build script finished without a readable manifest. Exit status: {}. See {}",
            output.status,
            command_log_path.display()
        ),
        Vec::new(),
        Vec::new(),
        &verify_report_path,
        &command_log_path,
        &manifest_path,
    ))
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

fn build_standalone_package_blocking(
    app: tauri::AppHandle,
    target_platform: String,
    output_dir: String,
    run_id: Option<String>,
    optimization_profile: String,
    cache_dir: PathBuf,
    cartridge_path: PathBuf,
    standalone_icon_path: Option<PathBuf>,
) -> Result<StandalonePackageBuildResult, String> {
    let cleanup_run_id = run_id
        .clone()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| format!("package-{}", error_report_timestamp()));
    let result = build_standalone_package_blocking_inner(
        app.clone(),
        target_platform,
        output_dir,
        run_id,
        optimization_profile,
        cache_dir.clone(),
        cartridge_path.clone(),
        standalone_icon_path.clone(),
    );
    let cleanup_result = if matches!(&result, Ok(value) if value.ok) {
        remove_path_if_exists(&cache_dir)
    } else {
        cleanup_standalone_package_build_inputs(
            &cache_dir,
            &cartridge_path,
            standalone_icon_path.as_deref(),
        )
    };
    if let Err(error) = cleanup_result {
        emit_package_build_log(
            &app,
            &cleanup_run_id,
            "warning",
            "runtime",
            format!("Temporary standalone package files could not be removed: {error}"),
        );
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

fn windows_env_script_candidates(app: &tauri::AppHandle) -> Vec<PathBuf> {
    let script_name = "setup-windows-build-env.ps1";
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

fn resolve_windows_env_script(app: &tauri::AppHandle) -> Option<PathBuf> {
    for candidate in windows_env_script_candidates(app) {
        if candidate.exists() {
            return Some(candidate);
        }
    }
    None
}

fn run_android_env_tool_blocking(
    app: tauri::AppHandle,
    install: bool,
    run_id: Option<String>,
) -> Result<serde_json::Value, String> {
    let run_id = run_id.unwrap_or_default();
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
    let _ = fs::remove_file(&live_log_path);

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
        .arg("-Json")
        .arg("-ReportPath")
        .arg(&report_path)
        .current_dir(workspace_root())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if install {
        command.arg("-Install");
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
    Ok(value)
}

fn run_windows_env_tool_blocking(
    app: tauri::AppHandle,
    install: bool,
    run_id: Option<String>,
) -> Result<serde_json::Value, String> {
    let run_id = run_id.unwrap_or_default();
    let Some(script_path) = resolve_windows_env_script(&app) else {
        let searched: Vec<String> = windows_env_script_candidates(&app)
            .into_iter()
            .map(|path| path.to_string_lossy().to_string())
            .collect();
        return Ok(serde_json::json!({
            "ok": false,
            "status": "BLOCKED",
            "message": "Windows package environment helper was not found. Rebuild the editor or run scripts/setup-windows-build-env.ps1 from the AgentVN workspace.",
            "checks": [],
            "missing": ["Windows package environment helper script"],
            "warnings": searched.iter().map(|path| format!("Searched: {path}")).collect::<Vec<_>>(),
            "manualFix": [
                "Run scripts/setup-windows-build-env.ps1 -Install from the AgentVN workspace.",
                "Install Node.js LTS, Rust rustup/cargo, and Visual Studio 2022 Build Tools with Desktop development with C++."
            ]
        }));
    };

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
    let _ = fs::remove_file(&live_log_path);

    emit_package_build_log(
        &app,
        &run_id,
        "info",
        "windows-env",
        if install {
            "Windows package environment repair started. Stages will stream from setup-windows-build-env.ps1."
        } else {
            "Windows package environment check started."
        },
    );

    let mut command = background_command(powershell_command());
    command
        .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"])
        .arg(&script_path)
        .arg("-Json")
        .arg("-ReportPath")
        .arg(&report_path)
        .current_dir(workspace_root())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if install {
        command.arg("-Install");
    }
    let mut child = command
        .spawn()
        .map_err(|error| format!("Failed to run Windows environment helper: {error}"))?;
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
                    "windows-env",
                );
                std::thread::sleep(Duration::from_millis(500));
            }
            Err(error) => {
                return Err(format!(
                    "Failed to wait for Windows environment helper: {error}"
                ))
            }
        }
    }
    emit_new_log_file_lines(
        &app,
        &run_id,
        &live_log_path,
        &mut live_log_offset,
        "windows-env",
    );
    let output = child
        .wait_with_output()
        .map_err(|error| format!("Failed to collect Windows environment helper output: {error}"))?;
    write_command_output(&command_log_path, &output)?;
    for line in String::from_utf8_lossy(&output.stdout).lines() {
        let trimmed = line.trim();
        if !trimmed.is_empty() && !trimmed.starts_with('{') {
            emit_package_build_log(&app, &run_id, "info", "windows-env", trimmed.to_string());
        }
    }
    for line in String::from_utf8_lossy(&output.stderr).lines() {
        let trimmed = line.trim();
        if !trimmed.is_empty() {
            emit_package_build_log(&app, &run_id, "warning", "windows-env", trimmed.to_string());
        }
    }

    let raw = if report_path.exists() {
        fs::read_to_string(&report_path).map_err(|error| {
            format!(
                "Failed to read Windows environment report {}: {error}",
                report_path.display()
            )
        })?
    } else {
        String::from_utf8_lossy(&output.stdout).to_string()
    };
    let mut value: serde_json::Value = serde_json::from_str(raw.trim_start_matches('\u{feff}'))
        .map_err(|error| format!("Failed to parse Windows environment report: {error}"))?;
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
    Ok(value)
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
    tauri::async_runtime::spawn_blocking(move || {
        build_standalone_package_blocking(
            app,
            target_platform,
            output_dir,
            run_id,
            optimization_profile,
            cache_dir,
            cartridge_path,
            standalone_icon_path,
        )
    })
    .await
    .map_err(|error| format!("Standalone package build task failed: {error}"))?
}

#[tauri::command]
async fn check_android_build_environment(
    app: tauri::AppHandle,
    run_id: Option<String>,
) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || run_android_env_tool_blocking(app, false, run_id))
        .await
        .map_err(|error| format!("Android environment check task failed: {error}"))?
}

#[tauri::command]
async fn install_android_build_environment(
    app: tauri::AppHandle,
    run_id: Option<String>,
) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || run_android_env_tool_blocking(app, true, run_id))
        .await
        .map_err(|error| format!("Android environment repair task failed: {error}"))?
}

#[tauri::command]
async fn check_windows_build_environment(
    app: tauri::AppHandle,
    run_id: Option<String>,
) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || run_windows_env_tool_blocking(app, false, run_id))
        .await
        .map_err(|error| format!("Windows environment check task failed: {error}"))?
}

#[tauri::command]
async fn install_windows_build_environment(
    app: tauri::AppHandle,
    run_id: Option<String>,
) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || run_windows_env_tool_blocking(app, true, run_id))
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
    fs::write(&path, encoded)
        .map_err(|error| format!("Failed to write project backup {}: {error}", path.display()))?;
    let meta_path = path.with_extension("vnproj.meta.json");
    let meta = serde_json::to_string_pretty(&ProjectBackupMeta {
        trigger: trigger.clone(),
        project_id: Some(project.project_id.clone()),
        title: Some(project.title.clone()),
        created_at: Some(project.created_at.clone()),
        updated_at: Some(project.updated_at.clone()),
        timestamp_ms: Some(timestamp),
        node_count: Some(project.nodes.len()),
        edge_count: Some(project.edges.len()),
        content_hash: Some(content_hash.clone()),
    })
    .map_err(|error| format!("Failed to encode project backup metadata: {error}"))?;
    fs::write(&meta_path, meta).map_err(|error| {
        format!(
            "Failed to write project backup metadata {}: {error}",
            meta_path.display()
        )
    })?;
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
    fs::read_to_string(&path)
        .map_err(|error| format!("Failed to read project backup {}: {error}", path.display()))
}

fn open_text_file(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Err("AgentVN error report has already been cleaned up or removed.".to_string());
    }

    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = background_command("cmd");
        command.args(["/C", "start", ""]);
        command
    };

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
fn main() {
    install_desktop_panic_hook();
    append_desktop_host_log("AgentVN Editor desktop host starting.");
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
            let install_data_dir = install_data_dir();
            if let Err(error) = fs::create_dir_all(&install_data_dir) {
                eprintln!(
                    "[AgentVN] WARNING: Failed to create install-relative data dir {}: {error}",
                    install_data_dir.display()
                );
            } else {
                std::env::set_var(
                    "AGENTVN_EDITOR_DATA_DIR",
                    install_data_dir.to_string_lossy().to_string(),
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

            let backend_child = start_backend_for_runtime(&handle, workspace_root.as_deref());
            let frontend_child = if cfg!(debug_assertions) {
                workspace_root.as_deref().and_then(start_frontend)
            } else {
                eprintln!("[AgentVN] Using bundled editor frontend.");
                None
            };
            let backend_ready = wait_for_backend_health(8278, 60);
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
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                let state = window.app_handle().state::<DevProcesses>();
                kill_child(&mut state.backend.lock().unwrap());
                kill_child(&mut state.frontend.lock().unwrap());
                close_gamecli_preview_process(state.inner());
                if let Err(error) =
                    cleanup_active_standalone_package_upload(window.app_handle(), state.inner())
                {
                    eprintln!(
                        "[AgentVN] Standalone package upload cleanup on close failed: {error}"
                    );
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
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
            read_project_asset_file_bytes,
            select_package_output_dir,
            begin_standalone_package_upload,
            append_standalone_package_upload_chunk,
            build_standalone_package_from_upload,
            abort_standalone_package_upload,
            check_android_build_environment,
            install_android_build_environment,
            check_windows_build_environment,
            install_windows_build_environment,
            write_error_report,
            append_frontend_error,
            open_error_report,
            write_project_backup,
            list_project_backups,
            read_project_backup
        ])
        .run(tauri::generate_context!())
        .expect("error while running AgentVN Dev Container");
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
mod standalone_package_upload_tests {
    use super::*;

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
}
