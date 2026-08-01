use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::io::{Read, Seek, SeekFrom, Write as _};
use std::path::{Component, Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use tauri::{http, AppHandle, Manager};
#[cfg(target_os = "android")]
use tauri_plugin_fs::{FsExt, OpenOptions};

const MAX_ERROR_LOG_BYTES: u64 = 10 * 1024 * 1024;
const ERROR_LOG_BACKUP_COUNT: usize = 10;
const MAX_ERROR_LOG_LINE_BYTES: usize = 64 * 1024;
static ERROR_LOG_WRITE_LOCK: Mutex<()> = Mutex::new(());
static ERROR_LOG_RECENT: OnceLock<Mutex<HashMap<String, Instant>>> = OnceLock::new();
static PLAYER_ERROR_LOG_DIR: OnceLock<PathBuf> = OnceLock::new();

fn default_player_error_log_dir() -> PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(|parent| parent.join("error_log")))
        .unwrap_or_else(|| PathBuf::from("error_log"))
}

fn player_error_log_dir() -> PathBuf {
    PLAYER_ERROR_LOG_DIR
        .get()
        .cloned()
        .unwrap_or_else(default_player_error_log_dir)
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
    recent.retain(|_, timestamp| now.duration_since(*timestamp) <= std::time::Duration::from_secs(30));
    let fingerprint = format!("{source}\n{}", sanitize_error_log_text(message));
    let duplicate = recent
        .get(&fingerprint)
        .is_some_and(|timestamp| now.duration_since(*timestamp) <= std::time::Duration::from_secs(1));
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

fn rotate_error_log_if_needed(path: &Path, additional_bytes: u64) -> std::io::Result<()> {
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

fn append_error_log_line(path: &Path, line: &str) -> std::io::Result<()> {
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

fn append_player_log(message: &str) {
    let root = player_error_log_dir();
    if !should_write_error_log("player.desktop", message) {
        return;
    }
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    let _ = append_error_log_line(
        &root.join("player-desktop.log"),
        &format!("[{timestamp}] {message}"),
    );
}

macro_rules! eprintln {
    ($($arg:tt)*) => {{
        let message = format!($($arg)*);
        append_player_log(&message);
        #[cfg(debug_assertions)]
        std::eprintln!("{message}");
    }};
}

fn install_player_panic_hook() {
    std::panic::set_hook(Box::new(|panic_info| {
        append_player_log(&format!("PANIC: {panic_info}"));
    }));
}

#[tauri::command]
fn append_frontend_error(source: String, message: String) -> Result<String, String> {
    let root = player_error_log_dir();
    let path = root.join("player-frontend.log");
    if !should_write_error_log(&source, &message) {
        return Ok(path.to_string_lossy().to_string());
    }
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    append_error_log_line(&path, &format!("[{timestamp}] [{source}] {message}"))
        .map_err(|error| format!("Cannot append player frontend error log: {error}"))?;
    Ok(path.to_string_lossy().to_string())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LibraryRecord {
    install_id: String,
    game_id: String,
    title: String,
    author: String,
    version: String,
    language: String,
    description: String,
    cover_asset_id: Option<String>,
    source_file_name: Option<String>,
    installed_at: String,
    updated_at: String,
    cartridge_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LaunchConfig {
    mode: String,
    cartridge_path: Option<String>,
    preview_root: Option<String>,
}

struct PreviewRootState(Mutex<Option<PathBuf>>);

#[derive(Clone)]
enum EmbeddedResourceSource {
    Directory(PathBuf),
    Packaged(PathBuf),
}

#[derive(Clone)]
struct EmbeddedResourceFile {
    size_bytes: u64,
    mime_type: String,
    etag: String,
}

#[derive(Clone)]
struct EmbeddedResourceContext {
    source: EmbeddedResourceSource,
    content_id: String,
    files: HashMap<String, EmbeddedResourceFile>,
}

struct EmbeddedResourceState(Mutex<Option<EmbeddedResourceContext>>);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UnpackedPreviewGame {
    manifest: Value,
    script: Value,
    gallery: Value,
    checksum: Value,
    ui_skin: Option<Value>,
    asset_urls: std::collections::HashMap<String, String>,
    ui_asset_urls: std::collections::HashMap<String, String>,
    source_file_name: Option<String>,
    startup_index: Option<Value>,
    content_id: Option<String>,
}

fn parse_launch_config() -> LaunchConfig {
    let mut mode = "library".to_string();
    let mut cartridge_path = None;
    let mut preview_root = None;
    let mut args = std::env::args().skip(1);

    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--mode" => {
                if let Some(value) = args.next() {
                    mode = value;
                }
            }
            "--cartridge" => {
                cartridge_path = args.next();
            }
            "--preview-root" => {
                preview_root = args.next();
            }
            _ => {}
        }
    }

    if mode != "preview" && mode != "fixed" {
        mode = "library".to_string();
    }

    LaunchConfig {
        mode,
        cartridge_path,
        preview_root,
    }
}

fn set_process_working_dir_to_exe_parent() {
    match std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(PathBuf::from))
    {
        Some(exe_dir) => {
            if let Err(error) = std::env::set_current_dir(&exe_dir) {
                eprintln!(
                    "[AgentVN Player] WARNING: Failed to set process working directory to {}: {error}",
                    exe_dir.display()
                );
            } else {
                eprintln!(
                    "[AgentVN Player] Process working directory: {}",
                    exe_dir.display()
                );
            }
        }
        None => eprintln!("[AgentVN Player] WARNING: Could not resolve executable directory."),
    }
}

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|error| format!("Cannot resolve app data directory: {error}"))
}

fn library_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(data_dir(app)?.join("library.json"))
}

fn read_library(app: &AppHandle) -> Result<Vec<LibraryRecord>, String> {
    let path = library_path(app)?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let text =
        fs::read_to_string(&path).map_err(|error| format!("Cannot read library index: {error}"))?;
    serde_json::from_str(&text).map_err(|error| format!("Cannot parse library index: {error}"))
}

fn write_library(app: &AppHandle, records: &[LibraryRecord]) -> Result<(), String> {
    let root = data_dir(app)?;
    fs::create_dir_all(&root)
        .map_err(|error| format!("Cannot create app data directory: {error}"))?;
    let text = serde_json::to_string_pretty(records)
        .map_err(|error| format!("Cannot serialize library index: {error}"))?;
    fs::write(library_path(app)?, text)
        .map_err(|error| format!("Cannot write library index: {error}"))
}

#[tauri::command]
fn list_installed_cartridges(app: AppHandle) -> Result<Vec<LibraryRecord>, String> {
    read_library(&app)
}

#[tauri::command]
fn import_cartridge_from_path(
    app: AppHandle,
    source_path: String,
    mut record: LibraryRecord,
) -> Result<LibraryRecord, String> {
    let source = PathBuf::from(&source_path);
    if !source.exists() {
        return Err("Selected cartridge file does not exist.".into());
    }

    let install_dir = data_dir(&app)?.join("cartridges").join(&record.install_id);
    fs::create_dir_all(&install_dir)
        .map_err(|error| format!("Cannot create cartridge directory: {error}"))?;
    let target = install_dir.join("game.vncart");
    fs::copy(&source, &target)
        .map_err(|error| format!("Cannot copy cartridge into library: {error}"))?;
    record.cartridge_path = target.to_string_lossy().to_string();

    let mut records = read_library(&app)?;
    records.retain(|item| item.install_id != record.install_id);
    records.insert(0, record.clone());
    write_library(&app, &records)?;
    Ok(record)
}

#[tauri::command]
fn load_installed_cartridge(app: AppHandle, install_id: String) -> Result<Vec<u8>, String> {
    let records = read_library(&app)?;
    let record = records
        .iter()
        .find(|item| item.install_id == install_id)
        .ok_or_else(|| "Cartridge is not installed.".to_string())?;
    fs::read(&record.cartridge_path)
        .map_err(|error| format!("Cannot read installed cartridge: {error}"))
}

#[tauri::command]
fn get_launch_config() -> Result<LaunchConfig, String> {
    let config = parse_launch_config();
    eprintln!(
        "[AgentVN Player] Launch mode={}, cartridge={}, preview_root={}",
        config.mode,
        config.cartridge_path.as_deref().unwrap_or("<none>"),
        config.preview_root.as_deref().unwrap_or("<none>")
    );
    Ok(config)
}

#[tauri::command]
fn read_cartridge_from_path(source_path: String) -> Result<Vec<u8>, String> {
    let source = PathBuf::from(&source_path);
    if !source.exists() {
        return Err("Cartridge file does not exist.".into());
    }
    eprintln!("[AgentVN Player] Reading cartridge: {}", source.display());
    fs::read(&source).map_err(|error| format!("Cannot read cartridge file: {error}"))
}

fn is_dangerous_preview_extension(path: &str) -> bool {
    let lower = path.to_ascii_lowercase();
    matches!(
        Path::new(&lower)
            .extension()
            .and_then(|value| value.to_str()),
        Some("exe" | "dll" | "bat" | "cmd" | "ps1" | "vbs" | "js" | "msi" | "scr" | "com")
    )
}

fn validate_preview_relative_path(path: &str) -> Result<(), String> {
    if path.trim().is_empty()
        || path.contains('\0')
        || path.contains('\\')
        || path.starts_with('/')
        || path.starts_with('~')
        || path.contains(':')
        || is_dangerous_preview_extension(path)
    {
        return Err(format!("Unsafe preview resource path: {path}"));
    }
    let candidate = Path::new(path);
    if candidate.is_absolute() {
        return Err(format!("Unsafe absolute preview resource path: {path}"));
    }
    for component in candidate.components() {
        match component {
            Component::Normal(_) => {}
            _ => return Err(format!("Unsafe preview resource path component: {path}")),
        }
    }
    Ok(())
}

fn normalize_preview_metadata_path(path: &str) -> Result<Option<&str>, String> {
    let normalized = path.trim_end_matches('/');
    validate_preview_relative_path(normalized)?;
    if path.ends_with('/') {
        return Ok(None);
    }
    Ok(Some(normalized))
}

fn canonical_preview_root(preview_root: &str) -> Result<PathBuf, String> {
    let root = PathBuf::from(preview_root);
    let canonical = root
        .canonicalize()
        .map_err(|error| format!("Cannot open preview directory {}: {error}", root.display()))?;
    if !canonical.is_dir() {
        return Err("Preview root is not a directory.".to_string());
    }
    Ok(canonical)
}

#[cfg(not(target_os = "android"))]
fn embedded_cartridge_resource_root(app: &AppHandle) -> Result<PathBuf, String> {
    let root = app
        .path()
        .resource_dir()
        .map_err(|error| format!("Cannot resolve packaged resource directory: {error}"))?
        .join("embedded-cartridge");
    canonical_preview_root(&root.to_string_lossy())
}

#[cfg(target_os = "android")]
fn embedded_cartridge_resource_root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .resource_dir()
        .map_err(|error| format!("Cannot resolve packaged resource directory: {error}"))?
        .join("embedded-cartridge"))
}

#[cfg(not(target_os = "android"))]
fn read_embedded_text(
    _app: &AppHandle,
    root: &Path,
    relative_path: &str,
    required: bool,
) -> Result<Option<String>, String> {
    validate_preview_relative_path(relative_path)?;
    let path = root.join(relative_path);
    if !path.exists() {
        if required {
            return Err(format!("Packaged game is missing {relative_path}."));
        }
        return Ok(None);
    }
    fs::read_to_string(&path)
        .map(Some)
        .map_err(|error| format!("Cannot read packaged {relative_path}: {error}"))
}

#[cfg(target_os = "android")]
fn read_embedded_text(
    app: &AppHandle,
    root: &Path,
    relative_path: &str,
    required: bool,
) -> Result<Option<String>, String> {
    validate_preview_relative_path(relative_path)?;
    match app.fs().read_to_string(root.join(relative_path)) {
        Ok(value) => Ok(Some(value)),
        Err(error) if !required => Ok(None),
        Err(error) => Err(format!("Cannot read packaged {relative_path}: {error}")),
    }
}

fn parse_embedded_json(text: &str, relative_path: &str) -> Result<Value, String> {
    serde_json::from_str(text)
        .map_err(|error| format!("Cannot parse packaged {relative_path}: {error}"))
}

fn stable_legacy_content_id(checksum_text: &str) -> String {
    // New release packages carry a SHA-256 contentId in startup-index.json.
    // This deterministic FNV-1a fallback only keeps legacy package URLs stable.
    let mut hash = 0xcbf29ce484222325u64;
    for byte in checksum_text.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("legacy-{hash:016x}")
}

fn resource_file_metadata(
    startup_index: Option<&Value>,
    checksum: &Value,
    manifest: &Value,
    ui_skin: Option<&Value>,
) -> Result<HashMap<String, EmbeddedResourceFile>, String> {
    let mut files = HashMap::new();
    if let Some(index_files) = startup_index
        .and_then(|value| value.get("files"))
        .and_then(Value::as_object)
    {
        for (path, metadata) in index_files {
            let Some(normalized) = normalize_preview_metadata_path(path)? else {
                continue;
            };
            let size_bytes = metadata
                .get("sizeBytes")
                .or_else(|| metadata.get("size_bytes"))
                .and_then(Value::as_u64)
                .unwrap_or(0);
            let mime_type = metadata
                .get("mimeType")
                .or_else(|| metadata.get("mime_type"))
                .and_then(Value::as_str)
                .unwrap_or_else(|| mime_for_path(Path::new(normalized)))
                .to_string();
            let etag = metadata
                .get("sha256")
                .or_else(|| metadata.get("hash_sha256"))
                .and_then(Value::as_str)
                .filter(|value| !value.trim().is_empty())
                .map(str::to_string)
                .unwrap_or_else(|| format!("{}-{size_bytes}", normalized.replace('/', "_")));
            files.insert(
                normalized.to_string(),
                EmbeddedResourceFile {
                    size_bytes,
                    mime_type,
                    etag,
                },
            );
        }
    }

    if files.is_empty() {
        for entry in checksum_entries(checksum)? {
            let path = entry
                .get("path")
                .and_then(Value::as_str)
                .ok_or_else(|| "Packaged checksum entry is missing path.".to_string())?;
            let Some(normalized) = normalize_preview_metadata_path(path)? else {
                continue;
            };
            let size_bytes = entry
                .get("size_bytes")
                .or_else(|| entry.get("sizeBytes"))
                .and_then(Value::as_u64)
                .unwrap_or(0);
            let etag = entry
                .get("hash_sha256")
                .or_else(|| entry.get("sha256"))
                .and_then(Value::as_str)
                .filter(|value| !value.trim().is_empty())
                .map(str::to_string)
                .unwrap_or_else(|| format!("{}-{size_bytes}", normalized.replace('/', "_")));
            files.insert(
                normalized.to_string(),
                EmbeddedResourceFile {
                    size_bytes,
                    mime_type: mime_for_path(Path::new(normalized)).to_string(),
                    etag,
                },
            );
        }
    }

    for asset in manifest
        .get("assets")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .chain(
            ui_skin
                .and_then(|value| value.get("assets"))
                .and_then(Value::as_array)
                .into_iter()
                .flatten(),
        )
    {
        let Some(path) = asset.get("path").and_then(Value::as_str) else {
            continue;
        };
        let Some(normalized) = normalize_preview_metadata_path(path)? else {
            continue;
        };
        let size_bytes = asset
            .get("size_bytes")
            .or_else(|| asset.get("sizeBytes"))
            .and_then(Value::as_u64)
            .unwrap_or(0);
        let mime_type = asset
            .get("mime_type")
            .or_else(|| asset.get("mimeType"))
            .and_then(Value::as_str)
            .unwrap_or_else(|| mime_for_path(Path::new(normalized)))
            .to_string();
        files
            .entry(normalized.to_string())
            .and_modify(|entry| {
                if entry.size_bytes == 0 {
                    entry.size_bytes = size_bytes;
                }
                if entry.mime_type == "application/octet-stream" {
                    entry.mime_type = mime_type.clone();
                }
            })
            .or_insert_with(|| EmbeddedResourceFile {
                size_bytes,
                mime_type,
                etag: format!("{}-{size_bytes}", normalized.replace('/', "_")),
            });
    }
    Ok(files)
}

fn preview_file_path(root: &Path, relative_path: &str) -> Result<PathBuf, String> {
    validate_preview_relative_path(relative_path)?;
    let joined = root.join(relative_path);
    let canonical = joined
        .canonicalize()
        .map_err(|error| format!("Preview file not found {}: {error}", joined.display()))?;
    if !canonical.starts_with(root) || !canonical.is_file() {
        return Err(format!(
            "Preview file escaped preview root: {relative_path}"
        ));
    }
    Ok(canonical)
}

fn read_preview_json(
    root: &Path,
    relative_path: &str,
    required: bool,
) -> Result<Option<Value>, String> {
    let path = root.join(relative_path);
    if !path.exists() {
        if required {
            return Err(format!("Preview cartridge is missing {relative_path}."));
        }
        return Ok(None);
    }
    let canonical = preview_file_path(root, relative_path)?;
    let text = fs::read_to_string(&canonical)
        .map_err(|error| format!("Cannot read preview JSON {relative_path}: {error}"))?;
    serde_json::from_str::<Value>(&text)
        .map(Some)
        .map_err(|error| format!("Cannot parse preview JSON {relative_path}: {error}"))
}

fn preview_asset_file_url(root: &Path, relative_path: &str) -> Result<String, String> {
    let file_path = preview_file_path(root, relative_path)?;
    Ok(file_path.to_string_lossy().to_string())
}

fn percent_decode(value: &str) -> Result<String, String> {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            if index + 2 >= bytes.len() {
                return Err("Invalid percent encoding in preview URL.".to_string());
            }
            let hex = std::str::from_utf8(&bytes[index + 1..index + 3])
                .map_err(|_| "Invalid preview URL encoding.".to_string())?;
            let byte = u8::from_str_radix(hex, 16)
                .map_err(|_| "Invalid preview URL encoding.".to_string())?;
            out.push(byte);
            index += 3;
        } else {
            out.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(out).map_err(|_| "Preview URL path is not UTF-8.".to_string())
}

fn percent_encode_path(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    for byte in value.as_bytes() {
        if byte.is_ascii_alphanumeric() || matches!(*byte, b'-' | b'_' | b'.' | b'~' | b'/') {
            output.push(char::from(*byte));
        } else {
            output.push_str(&format!("%{byte:02X}"));
        }
    }
    output
}

fn embedded_resource_url(content_id: &str, relative_path: &str) -> Result<String, String> {
    validate_preview_relative_path(relative_path)?;
    let encoded = percent_encode_path(relative_path);
    #[cfg(any(target_os = "windows", target_os = "android"))]
    {
        Ok(format!(
            "http://agentvn-resource.localhost/{content_id}/{encoded}"
        ))
    }
    #[cfg(not(any(target_os = "windows", target_os = "android")))]
    {
        Ok(format!(
            "agentvn-resource://localhost/{content_id}/{encoded}"
        ))
    }
}

fn mime_for_path(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "svg" => "image/svg+xml",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "ogg" => "audio/ogg",
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        "ttf" => "font/ttf",
        "otf" => "font/otf",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "json" => "application/json",
        _ => "application/octet-stream",
    }
}

fn build_embedded_asset_urls(
    content_id: &str,
    manifest: &Value,
) -> Result<HashMap<String, String>, String> {
    let mut urls = HashMap::new();
    let assets = manifest
        .get("assets")
        .and_then(Value::as_array)
        .ok_or_else(|| "Packaged manifest.json is missing assets[].".to_string())?;
    for asset in assets {
        let asset_id = asset
            .get("asset_id")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let path = asset
            .get("path")
            .and_then(Value::as_str)
            .ok_or_else(|| "Packaged manifest asset is missing path.".to_string())?;
        let Some(normalized) = normalize_preview_metadata_path(path)? else {
            continue;
        };
        let url = embedded_resource_url(content_id, normalized)?;
        if !asset_id.is_empty() {
            urls.insert(asset_id.to_string(), url.clone());
        }
        urls.insert(normalized.to_string(), url);
    }
    Ok(urls)
}

fn build_embedded_ui_asset_urls(
    content_id: &str,
    ui_skin: Option<&Value>,
) -> Result<HashMap<String, String>, String> {
    let mut urls = HashMap::new();
    let Some(assets) = ui_skin
        .and_then(|value| value.get("assets"))
        .and_then(Value::as_array)
    else {
        return Ok(urls);
    };
    for asset in assets {
        let asset_id = asset
            .get("asset_id")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let path = asset
            .get("path")
            .and_then(Value::as_str)
            .ok_or_else(|| "Packaged UI asset is missing path.".to_string())?;
        let Some(normalized) = normalize_preview_metadata_path(path)? else {
            continue;
        };
        if !asset_id.is_empty() {
            urls.insert(
                asset_id.to_string(),
                embedded_resource_url(content_id, normalized)?,
            );
        }
    }
    Ok(urls)
}

fn checksum_entries(checksum: &Value) -> Result<&Vec<Value>, String> {
    checksum
        .get("files")
        .and_then(Value::as_array)
        .ok_or_else(|| "Preview checksum.json is missing files[].".to_string())
}

fn validate_preview_checksum_files(root: &Path, checksum: &Value) -> Result<(), String> {
    for entry in checksum_entries(checksum)? {
        let path = entry
            .get("path")
            .and_then(Value::as_str)
            .ok_or_else(|| "Preview checksum entry is missing path.".to_string())?;
        let expected_size = entry.get("size_bytes").and_then(Value::as_u64);
        let Some(file_path_value) = normalize_preview_metadata_path(path)? else {
            continue;
        };
        let file_path = preview_file_path(root, file_path_value)?;
        if let Some(expected_size) = expected_size {
            let actual_size = fs::metadata(&file_path)
                .map_err(|error| format!("Cannot stat preview file {path}: {error}"))?
                .len();
            if actual_size != expected_size {
                return Err(format!("Preview file size mismatch: {path} expected {expected_size}, got {actual_size}."));
            }
        }
    }
    Ok(())
}

fn build_asset_urls(
    root: &Path,
    manifest: &Value,
) -> Result<std::collections::HashMap<String, String>, String> {
    let mut urls = std::collections::HashMap::new();
    let assets = manifest
        .get("assets")
        .and_then(Value::as_array)
        .ok_or_else(|| "Preview manifest.json is missing assets[].".to_string())?;
    for asset in assets {
        let asset_id = asset
            .get("asset_id")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let path = asset
            .get("path")
            .and_then(Value::as_str)
            .ok_or_else(|| "Preview manifest asset is missing path.".to_string())?;
        let Some(asset_path) = normalize_preview_metadata_path(path)? else {
            continue;
        };
        let url = match preview_asset_file_url(root, asset_path) {
            Ok(url) => url,
            Err(error) if error.starts_with("Preview file not found ") => {
                eprintln!(
                    "[AgentVN Player] Preview asset missing, skipped from URL map: {asset_path}"
                );
                continue;
            }
            Err(error) => return Err(error),
        };
        if !asset_id.is_empty() {
            urls.insert(asset_id.to_string(), url.clone());
        }
        urls.insert(asset_path.to_string(), url);
    }
    Ok(urls)
}

fn build_ui_asset_urls(
    root: &Path,
    ui_skin: Option<&Value>,
) -> Result<std::collections::HashMap<String, String>, String> {
    let mut urls = std::collections::HashMap::new();
    let Some(ui_skin) = ui_skin else {
        return Ok(urls);
    };
    let Some(assets) = ui_skin.get("assets").and_then(Value::as_array) else {
        return Ok(urls);
    };
    for asset in assets {
        let asset_id = asset
            .get("asset_id")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let path = asset
            .get("path")
            .and_then(Value::as_str)
            .ok_or_else(|| "Preview UI asset is missing path.".to_string())?;
        let Some(asset_path) = normalize_preview_metadata_path(path)? else {
            continue;
        };
        if !asset_id.is_empty() {
            let url = match preview_asset_file_url(root, asset_path) {
                Ok(url) => url,
                Err(error) if error.starts_with("Preview file not found ") => {
                    eprintln!("[AgentVN Player] Preview UI asset missing, skipped from URL map: {asset_path}");
                    continue;
                }
                Err(error) => return Err(error),
            };
            urls.insert(asset_id.to_string(), url);
        }
    }
    Ok(urls)
}

#[tauri::command]
fn load_unpacked_preview(
    state: tauri::State<'_, PreviewRootState>,
    preview_root: String,
) -> Result<UnpackedPreviewGame, String> {
    let root = canonical_preview_root(&preview_root)?;
    let manifest = read_preview_json(&root, "manifest.json", true)?.unwrap();
    let script = read_preview_json(&root, "script.json", true)?.unwrap();
    let gallery = read_preview_json(&root, "gallery.json", false)?
        .unwrap_or_else(|| serde_json::json!({"gallery_version":"1.0.0","items":[]}));
    let checksum = read_preview_json(&root, "checksum.json", true)?.unwrap();
    let ui_path = manifest
        .get("ui_skin")
        .and_then(|value| value.get("path"))
        .and_then(Value::as_str)
        .unwrap_or("ui/layout.json");
    let ui_skin = read_preview_json(&root, ui_path, false)?;
    validate_preview_checksum_files(&root, &checksum)?;
    let asset_urls = build_asset_urls(&root, &manifest)?;
    let ui_asset_urls = build_ui_asset_urls(&root, ui_skin.as_ref())?;
    *state
        .0
        .lock()
        .map_err(|_| "Preview root lock is poisoned.".to_string())? = Some(root.clone());
    eprintln!(
        "[AgentVN Player] Loaded unpacked preview from {}",
        root.display()
    );
    Ok(UnpackedPreviewGame {
        manifest,
        script,
        gallery,
        checksum,
        ui_skin,
        asset_urls,
        ui_asset_urls,
        source_file_name: Some("disk-preview".to_string()),
        startup_index: None,
        content_id: None,
    })
}

#[tauri::command]
fn load_embedded_game(
    app: AppHandle,
    resource_state: tauri::State<'_, EmbeddedResourceState>,
) -> Result<UnpackedPreviewGame, String> {
    let started_at = Instant::now();
    let root = embedded_cartridge_resource_root(&app)?;
    let manifest_text = read_embedded_text(&app, &root, "manifest.json", true)?
        .ok_or_else(|| "Packaged game is missing manifest.json.".to_string())?;
    let script_text = read_embedded_text(&app, &root, "script.json", true)?
        .ok_or_else(|| "Packaged game is missing script.json.".to_string())?;
    let checksum_text = read_embedded_text(&app, &root, "checksum.json", true)?
        .ok_or_else(|| "Packaged game is missing checksum.json.".to_string())?;
    let manifest = parse_embedded_json(&manifest_text, "manifest.json")?;
    let script = parse_embedded_json(&script_text, "script.json")?;
    let checksum = parse_embedded_json(&checksum_text, "checksum.json")?;
    let gallery = read_embedded_text(&app, &root, "gallery.json", false)?
        .map(|text| parse_embedded_json(&text, "gallery.json"))
        .transpose()?
        .unwrap_or_else(|| serde_json::json!({"gallery_version":"1.0.0","items":[]}));
    let ui_path = manifest
        .get("ui_skin")
        .and_then(|value| value.get("path"))
        .and_then(Value::as_str)
        .unwrap_or("ui/layout.json");
    let ui_skin = read_embedded_text(&app, &root, ui_path, false)?
        .map(|text| parse_embedded_json(&text, ui_path))
        .transpose()?;
    let startup_index = read_embedded_text(&app, &root, "startup-index.json", false)?
        .map(|text| parse_embedded_json(&text, "startup-index.json"))
        .transpose()?;
    let content_id = startup_index
        .as_ref()
        .and_then(|value| value.get("contentId"))
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| stable_legacy_content_id(&checksum_text));
    let files = resource_file_metadata(
        startup_index.as_ref(),
        &checksum,
        &manifest,
        ui_skin.as_ref(),
    )?;
    let indexed_bytes = files.values().map(|entry| entry.size_bytes).sum::<u64>();
    let asset_urls = build_embedded_asset_urls(&content_id, &manifest)?;
    let ui_asset_urls = build_embedded_ui_asset_urls(&content_id, ui_skin.as_ref())?;
    let source = if cfg!(target_os = "android") {
        EmbeddedResourceSource::Packaged(root.clone())
    } else {
        EmbeddedResourceSource::Directory(root.clone())
    };
    *resource_state
        .0
        .lock()
        .map_err(|_| "Embedded resource state lock is poisoned.".to_string())? =
        Some(EmbeddedResourceContext {
            source,
            content_id: content_id.clone(),
            files,
        });
    eprintln!(
        "[AgentVN Player] Embedded bootstrap ready in {} ms; indexed {} files / {} bytes from {}",
        started_at.elapsed().as_millis(),
        resource_state
            .0
            .lock()
            .ok()
            .and_then(|state| state.as_ref().map(|context| context.files.len()))
            .unwrap_or(0),
        indexed_bytes,
        root.display(),
    );
    Ok(UnpackedPreviewGame {
        manifest,
        script,
        gallery,
        checksum,
        ui_skin,
        asset_urls,
        ui_asset_urls,
        source_file_name: Some("embedded-resource".to_string()),
        startup_index,
        content_id: Some(content_id),
    })
}

fn handle_preview_protocol(
    state: tauri::State<'_, PreviewRootState>,
    request: http::Request<Vec<u8>>,
) -> http::Response<Vec<u8>> {
    let result = (|| -> Result<http::Response<Vec<u8>>, String> {
        let root = state
            .0
            .lock()
            .map_err(|_| "Preview root lock is poisoned.".to_string())?
            .clone()
            .ok_or_else(|| "Preview root is not ready.".to_string())?;
        let uri = request.uri();
        let uri_path = uri.path();
        let host = uri
            .authority()
            .map(|authority| authority.host())
            .unwrap_or_default();
        let path_without_slash = uri_path.trim_start_matches('/');
        let raw_path = if host.is_empty()
            || host.eq_ignore_ascii_case("localhost")
            || host.eq_ignore_ascii_case("asset")
        {
            path_without_slash.to_string()
        } else if path_without_slash.is_empty() {
            host.to_string()
        } else {
            format!("{host}/{path_without_slash}")
        };
        let relative_path = percent_decode(&raw_path)?;
        let file_path = preview_file_path(&root, &relative_path)?;
        let data = fs::read(&file_path).map_err(|error| {
            format!("Cannot read preview asset {}: {error}", file_path.display())
        })?;
        http::Response::builder()
            .header("content-type", mime_for_path(&file_path))
            .header("cache-control", "no-store")
            .body(data)
            .map_err(|error| format!("Cannot build preview protocol response: {error}"))
    })();
    match result {
        Ok(response) => response,
        Err(error) => {
            eprintln!(
                "[AgentVN Player] Preview protocol failed: uri={} error={}",
                request.uri(),
                error
            );
            http::Response::builder()
                .status(404)
                .header("content-type", "text/plain; charset=utf-8")
                .body(error.into_bytes())
                .unwrap()
        }
    }
}

const RESOURCE_RANGE_MAX_BYTES: u64 = 1024 * 1024;
const RESOURCE_MAX_RANGES: usize = 8;

fn parse_resource_ranges(value: &str, total: u64) -> Result<Vec<(u64, u64)>, String> {
    let raw = value
        .strip_prefix("bytes=")
        .ok_or_else(|| "Only byte ranges are supported.".to_string())?;
    let mut ranges = Vec::new();
    for part in raw.split(',') {
        if ranges.len() >= RESOURCE_MAX_RANGES {
            return Err("Too many byte ranges requested.".to_string());
        }
        let (start_text, end_text) = part
            .trim()
            .split_once('-')
            .ok_or_else(|| "Invalid byte range.".to_string())?;
        let (start, mut end) = if start_text.is_empty() {
            let suffix = end_text
                .parse::<u64>()
                .map_err(|_| "Invalid suffix byte range.".to_string())?;
            if suffix == 0 || total == 0 {
                return Err("Unsatisfiable suffix byte range.".to_string());
            }
            let length = suffix.min(total).min(RESOURCE_RANGE_MAX_BYTES);
            (total - length, total - 1)
        } else {
            let start = start_text
                .parse::<u64>()
                .map_err(|_| "Invalid byte range start.".to_string())?;
            if start >= total {
                return Err("Byte range starts beyond the resource.".to_string());
            }
            let requested_end = if end_text.is_empty() {
                total - 1
            } else {
                end_text
                    .parse::<u64>()
                    .map_err(|_| "Invalid byte range end.".to_string())?
                    .min(total - 1)
            };
            if requested_end < start {
                return Err("Byte range end precedes start.".to_string());
            }
            (start, requested_end)
        };
        end = start + (end - start).min(RESOURCE_RANGE_MAX_BYTES - 1);
        ranges.push((start, end));
    }
    if ranges.is_empty() {
        return Err("Byte range list is empty.".to_string());
    }
    Ok(ranges)
}

fn open_embedded_resource(
    _app: &AppHandle,
    source: &EmbeddedResourceSource,
    relative_path: &str,
) -> Result<fs::File, String> {
    match source {
        EmbeddedResourceSource::Directory(root) => {
            let file_path = preview_file_path(root, relative_path)?;
            fs::File::open(&file_path).map_err(|error| {
                format!(
                    "Cannot open packaged resource {}: {error}",
                    file_path.display()
                )
            })
        }
        EmbeddedResourceSource::Packaged(root) => {
            #[cfg(target_os = "android")]
            {
                let mut options = OpenOptions::new();
                options.read(true);
                _app.fs()
                    .open(root.join(relative_path), options)
                    .map_err(|error| {
                        format!("Cannot open Android packaged resource {relative_path}: {error}")
                    })
            }
            #[cfg(not(target_os = "android"))]
            {
                fs::File::open(root.join(relative_path)).map_err(|error| {
                    format!("Cannot open packaged resource {relative_path}: {error}")
                })
            }
        }
    }
}

fn read_resource_slice(
    file: &mut fs::File,
    base_offset: u64,
    start: u64,
    length: u64,
) -> Result<Vec<u8>, String> {
    file.seek(SeekFrom::Start(base_offset.saturating_add(start)))
        .map_err(|error| format!("Cannot seek packaged resource: {error}"))?;
    let mut body = Vec::with_capacity(length.min(usize::MAX as u64) as usize);
    file.take(length)
        .read_to_end(&mut body)
        .map_err(|error| format!("Cannot read packaged resource range: {error}"))?;
    if body.len() as u64 != length {
        return Err(format!(
            "Packaged resource range was truncated: expected {length}, got {}.",
            body.len()
        ));
    }
    Ok(body)
}

fn resource_error_response(status: u16, message: String) -> http::Response<Vec<u8>> {
    http::Response::builder()
        .status(status)
        .header("content-type", "text/plain; charset=utf-8")
        .header("access-control-allow-origin", "*")
        .body(message.into_bytes())
        .unwrap()
}

fn handle_resource_protocol(
    app: &AppHandle,
    context: EmbeddedResourceContext,
    request: http::Request<Vec<u8>>,
) -> http::Response<Vec<u8>> {
    let result = (|| -> Result<http::Response<Vec<u8>>, String> {
        let path = request.uri().path().trim_start_matches('/');
        let (request_content_id, encoded_path) = path
            .split_once('/')
            .ok_or_else(|| "Resource URL is missing its content id or path.".to_string())?;
        if request_content_id != context.content_id {
            return Err("Resource URL content id is stale.".to_string());
        }
        let relative_path = percent_decode(encoded_path)?;
        validate_preview_relative_path(&relative_path)?;
        let metadata = context
            .files
            .get(&relative_path)
            .cloned()
            .ok_or_else(|| format!("Resource is not present in the signed package index: {relative_path}"))?;
        let quoted_etag = format!("\"{}\"", metadata.etag);
        if request
            .headers()
            .get(http::header::IF_NONE_MATCH)
            .and_then(|value| value.to_str().ok())
            .is_some_and(|value| value.split(',').any(|entry| entry.trim() == quoted_etag))
        {
            return http::Response::builder()
                .status(http::StatusCode::NOT_MODIFIED)
                .header(http::header::ETAG, quoted_etag)
                .header(http::header::CACHE_CONTROL, "public, max-age=31536000, immutable")
                .header("access-control-allow-origin", "*")
                .body(Vec::new())
                .map_err(|error| format!("Cannot build resource cache response: {error}"));
        }

        let mut file = open_embedded_resource(app, &context.source, &relative_path)?;
        let base_offset = file.stream_position().unwrap_or(0);
        let total = if metadata.size_bytes > 0 {
            metadata.size_bytes
        } else {
            file.metadata()
                .map_err(|error| format!("Cannot stat packaged resource {relative_path}: {error}"))?
                .len()
                .saturating_sub(base_offset)
        };
        let builder = http::Response::builder()
            .header(http::header::CONTENT_TYPE, metadata.mime_type.as_str())
            .header(http::header::ETAG, quoted_etag)
            .header(http::header::CACHE_CONTROL, "public, max-age=31536000, immutable")
            .header(http::header::ACCEPT_RANGES, "bytes")
            .header("access-control-allow-origin", "*")
            .header(
                http::header::ACCESS_CONTROL_EXPOSE_HEADERS,
                "content-range, content-length, etag",
            );

        if request.method() == http::Method::HEAD {
            return builder
                .header(http::header::CONTENT_LENGTH, total)
                .body(Vec::new())
                .map_err(|error| format!("Cannot build resource HEAD response: {error}"));
        }

        let range_header = request
            .headers()
            .get(http::header::RANGE)
            .and_then(|value| value.to_str().ok());
        if let Some(range_header) = range_header {
            let ranges = parse_resource_ranges(range_header, total).map_err(|error| {
                format!("RANGE_NOT_SATISFIABLE:{total}:{error}")
            })?;
            if ranges.len() == 1 {
                let (start, end) = ranges[0];
                let length = end + 1 - start;
                let body = read_resource_slice(&mut file, base_offset, start, length)?;
                return builder
                    .status(http::StatusCode::PARTIAL_CONTENT)
                    .header(http::header::CONTENT_RANGE, format!("bytes {start}-{end}/{total}"))
                    .header(http::header::CONTENT_LENGTH, length)
                    .body(body)
                    .map_err(|error| format!("Cannot build resource range response: {error}"));
            }

            let boundary = format!(
                "agentvn-{}-{}",
                context.content_id,
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .map(|duration| duration.as_nanos())
                    .unwrap_or(0)
            );
            let mut body = Vec::new();
            for (start, end) in ranges {
                let length = end + 1 - start;
                write!(
                    body,
                    "--{boundary}\r\nContent-Type: {}\r\nContent-Range: bytes {start}-{end}/{total}\r\n\r\n",
                    metadata.mime_type
                )
                .map_err(|error| format!("Cannot write multipart range header: {error}"))?;
                body.extend_from_slice(&read_resource_slice(
                    &mut file,
                    base_offset,
                    start,
                    length,
                )?);
                body.extend_from_slice(b"\r\n");
            }
            write!(body, "--{boundary}--\r\n")
                .map_err(|error| format!("Cannot finish multipart range response: {error}"))?;
            return builder
                .status(http::StatusCode::PARTIAL_CONTENT)
                .header(
                    http::header::CONTENT_TYPE,
                    format!("multipart/byteranges; boundary={boundary}"),
                )
                .header(http::header::CONTENT_LENGTH, body.len())
                .body(body)
                .map_err(|error| format!("Cannot build multipart range response: {error}"));
        }

        let body = read_resource_slice(&mut file, base_offset, 0, total)?;
        builder
            .header(http::header::CONTENT_LENGTH, total)
            .body(body)
            .map_err(|error| format!("Cannot build resource response: {error}"))
    })();

    match result {
        Ok(response) => response,
        Err(error) if error.starts_with("RANGE_NOT_SATISFIABLE:") => {
            let mut parts = error.splitn(3, ':');
            let _ = parts.next();
            let total = parts.next().unwrap_or("0");
            let message = parts.next().unwrap_or("Unsatisfiable byte range.");
            http::Response::builder()
                .status(http::StatusCode::RANGE_NOT_SATISFIABLE)
                .header(http::header::CONTENT_RANGE, format!("bytes */{total}"))
                .header(http::header::ACCEPT_RANGES, "bytes")
                .header("access-control-allow-origin", "*")
                .body(message.as_bytes().to_vec())
                .unwrap()
        }
        Err(error) => {
            eprintln!(
                "[AgentVN Player] Resource protocol failed: uri={} error={}",
                request.uri(),
                error
            );
            resource_error_response(404, error)
        }
    }
}

#[tauri::command]
fn remove_installed_cartridge(
    app: AppHandle,
    install_id: String,
    delete_saves: bool,
) -> Result<Vec<LibraryRecord>, String> {
    let mut records = read_library(&app)?;
    records.retain(|item| item.install_id != install_id);
    let cartridge_dir = data_dir(&app)?.join("cartridges").join(&install_id);
    if cartridge_dir.exists() {
        fs::remove_dir_all(&cartridge_dir)
            .map_err(|error| format!("Cannot remove cartridge files: {error}"))?;
    }
    if delete_saves {
        let saves_dir = data_dir(&app)?.join("saves").join(&install_id);
        if saves_dir.exists() {
            fs::remove_dir_all(&saves_dir)
                .map_err(|error| format!("Cannot remove save files: {error}"))?;
        }
    }
    write_library(&app, &records)?;
    Ok(records)
}

#[tauri::command]
fn list_saves(app: AppHandle, install_id: String) -> Result<Vec<Value>, String> {
    let dir = data_dir(&app)?.join("saves").join(install_id);
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let mut saves = Vec::new();
    for entry in
        fs::read_dir(&dir).map_err(|error| format!("Cannot read save directory: {error}"))?
    {
        let path = entry
            .map_err(|error| format!("Cannot read save entry: {error}"))?
            .path();
        if path.extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }
        let text =
            fs::read_to_string(&path).map_err(|error| format!("Cannot read save file: {error}"))?;
        if let Ok(value) = serde_json::from_str::<Value>(&text) {
            saves.push(value);
        }
    }
    saves.sort_by_key(|save| {
        let kind_rank = if save.get("save_kind").and_then(Value::as_str) == Some("auto") {
            1
        } else {
            0
        };
        let slot = save.get("slot").and_then(Value::as_i64).unwrap_or(0);
        (kind_rank, slot)
    });
    Ok(saves)
}

fn prepare_webview_debug_arguments() {
    if std::env::var_os("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS").is_some() {
        return;
    }
    let args = std::env::var("AGENTVN_GAMECLI_PREVIEW_WEBVIEW2_ARGS")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| {
            std::env::var("AGENTVN_GAMECLI_PREVIEW_CDP_PORT")
                .ok()
                .filter(|value| !value.trim().is_empty())
                .map(|port| format!("--remote-debugging-port={port}"))
        });
    if let Some(args) = args {
        std::env::set_var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", args);
    }
}

fn save_file_name(kind: &str, slot: u8) -> Result<String, String> {
    match kind {
        "manual" => Ok(format!("slot-{slot:02}.json")),
        "auto" => Ok(format!("auto-{slot:02}.json")),
        _ => Err(format!("Unsupported save kind: {kind}")),
    }
}

#[tauri::command]
fn write_save(
    app: AppHandle,
    install_id: String,
    kind: String,
    slot: u8,
    save: Value,
) -> Result<(), String> {
    let dir = data_dir(&app)?.join("saves").join(install_id);
    fs::create_dir_all(&dir).map_err(|error| format!("Cannot create save directory: {error}"))?;
    let path = dir.join(save_file_name(&kind, slot)?);
    let temporary_path = path.with_extension("json.tmp");
    let text = serde_json::to_string_pretty(&save)
        .map_err(|error| format!("Cannot serialize save data: {error}"))?;
    fs::write(&temporary_path, text)
        .map_err(|error| format!("Cannot write temporary save file: {error}"))?;
    if path.exists() {
        fs::remove_file(&path).map_err(|error| format!("Cannot replace save file: {error}"))?;
    }
    fs::rename(temporary_path, path).map_err(|error| format!("Cannot finalize save file: {error}"))
}

#[tauri::command]
fn read_save(
    app: AppHandle,
    install_id: String,
    kind: String,
    slot: u8,
) -> Result<Option<Value>, String> {
    let path = data_dir(&app)?
        .join("saves")
        .join(install_id)
        .join(save_file_name(&kind, slot)?);
    if !path.exists() {
        return Ok(None);
    }
    let text =
        fs::read_to_string(path).map_err(|error| format!("Cannot read save file: {error}"))?;
    serde_json::from_str(&text)
        .map(Some)
        .map_err(|error| format!("Cannot parse save file: {error}"))
}

#[tauri::command]
fn delete_save(app: AppHandle, install_id: String, kind: String, slot: u8) -> Result<(), String> {
    let path = data_dir(&app)?
        .join("saves")
        .join(install_id)
        .join(save_file_name(&kind, slot)?);
    if path.exists() {
        fs::remove_file(path).map_err(|error| format!("Cannot delete save file: {error}"))?;
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    install_player_panic_hook();
    append_player_log("AgentVN Player starting.");
    prepare_webview_debug_arguments();
    set_process_working_dir_to_exe_parent();

    tauri::Builder::default()
        .setup(|_app| {
            #[cfg(target_os = "android")]
            if let Ok(app_data_dir) = _app.path().app_data_dir() {
                let error_dir = app_data_dir.join("error_log");
                let _ = PLAYER_ERROR_LOG_DIR.set(error_dir);
                append_player_log("Android error log directory initialized.");
            }
            Ok(())
        })
        .manage(PreviewRootState(Mutex::new(None)))
        .manage(EmbeddedResourceState(Mutex::new(None)))
        .register_uri_scheme_protocol("agentvn-preview", |ctx, request| {
            handle_preview_protocol(ctx.app_handle().state::<PreviewRootState>(), request)
        })
        .register_asynchronous_uri_scheme_protocol(
            "agentvn-resource",
            |ctx, request, responder| {
                let app = ctx.app_handle().clone();
                let context = app
                    .state::<EmbeddedResourceState>()
                    .0
                    .lock()
                    .ok()
                    .and_then(|state| state.clone());
                std::thread::spawn(move || {
                    let response = match context {
                        Some(context) => handle_resource_protocol(&app, context, request),
                        None => resource_error_response(
                            503,
                            "Embedded resource source is not ready.".to_string(),
                        ),
                    };
                    responder.respond(response);
                });
            },
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            append_frontend_error,
            import_cartridge_from_path,
            get_launch_config,
            list_installed_cartridges,
            load_installed_cartridge,
            read_cartridge_from_path,
            load_unpacked_preview,
            load_embedded_game,
            remove_installed_cartridge,
            list_saves,
            write_save,
            read_save,
            delete_save
        ])
        .run(tauri::generate_context!())
        .expect("error while running AgentVN Player");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn error_logs_sanitize_credentials_and_url_query_values() {
        let value = sanitize_error_log_text(
            "Bearer private-token sk-secret123 https://example.test/play?chapter=正文&token=hidden",
        );
        assert!(!value.contains("private-token"));
        assert!(!value.contains("secret123"));
        assert!(!value.contains("正文"));
        assert!(!value.contains("hidden"));
        assert!(value.contains("chapter=***"));
    }

    #[test]
    fn error_logs_truncate_at_a_valid_utf8_boundary() {
        let value = truncate_error_log_text("界".repeat(30_000));
        assert!(value.len() <= MAX_ERROR_LOG_LINE_BYTES);
        assert!(value.ends_with("[后续内容已省略]"));
    }

    #[test]
    fn error_logs_suppress_identical_entries_for_one_second() {
        assert!(should_write_error_log("player.test.dedup", "same failure"));
        assert!(!should_write_error_log("player.test.dedup", "same failure"));
    }

    #[test]
    fn error_logs_create_numbered_rotation_paths() {
        assert_eq!(
            rotated_error_log_path(Path::new("error_log/player-frontend.log"), 10),
            PathBuf::from("error_log/player-frontend.log.10"),
        );
    }

    #[test]
    fn packaged_resource_paths_reject_escape_attempts() {
        for path in [
            "",
            "../asset.png",
            "assets\\asset.png",
            "/assets/asset.png",
            "C:/asset.png",
            "assets/run.exe",
            "assets/\0bad.png",
        ] {
            assert!(validate_preview_relative_path(path).is_err(), "{path:?}");
        }
        assert!(validate_preview_relative_path("assets/background/title.webp").is_ok());
        assert!(validate_preview_relative_path("assets/背景/夜之森.png").is_ok());
    }

    #[test]
    fn resource_range_parser_caps_each_response_chunk() {
        assert_eq!(
            parse_resource_ranges("bytes=0-", 10 * 1024 * 1024).unwrap(),
            vec![(0, RESOURCE_RANGE_MAX_BYTES - 1)]
        );
        assert_eq!(
            parse_resource_ranges("bytes=100-199", 1000).unwrap(),
            vec![(100, 199)]
        );
        assert_eq!(
            parse_resource_ranges("bytes=-100", 1000).unwrap(),
            vec![(900, 999)]
        );
    }

    #[test]
    fn resource_range_parser_supports_multiple_ranges() {
        assert_eq!(
            parse_resource_ranges("bytes=0-9,100-109", 1000).unwrap(),
            vec![(0, 9), (100, 109)]
        );
        assert!(parse_resource_ranges("items=0-9", 1000).is_err());
        assert!(parse_resource_ranges("bytes=1000-1001", 1000).is_err());
        assert!(parse_resource_ranges("bytes=20-10", 1000).is_err());
    }

    #[test]
    fn resource_urls_are_content_versioned_and_encoded() {
        let url = embedded_resource_url("content-1", "assets/背景/夜之森.png").unwrap();
        assert!(url.contains("content-1"));
        assert!(url.contains("%E8%83%8C%E6%99%AF"));
        assert!(!url.contains(' '));
    }
}
