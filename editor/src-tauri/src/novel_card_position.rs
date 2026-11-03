//! Local Editor preference only. Never part of a project/cartridge or player saves.
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs, io,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
};

const MAX_RECORD_BYTES: u64 = 4096;
static POSITION_IO: OnceLock<Mutex<()>> = OnceLock::new();

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub(crate) struct Position {
    x: f64,
    y: f64,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PositionRecord {
    schema_version: u32,
    project_id: String,
    // None is a durable reset tombstone, not "record absent".
    #[serde(deserialize_with = "required_position")]
    position: Option<Position>,
}
fn required_position<'de, D: serde::Deserializer<'de>>(deserializer: D) -> Result<Option<Position>, D::Error> {
    Option::<Position>::deserialize(deserializer)
}
fn validate_id(id: &str) -> Result<(), String> {
    if id.trim().is_empty() || id.len() > 1024 {
        return Err("CARD_POSITION_PROJECT_INVALID: Invalid project identifier.".into());
    }
    Ok(())
}
fn validate_position(position: &Option<Position>) -> Result<(), String> {
    if position.as_ref().is_some_and(|p| {
        !p.x.is_finite() || !p.y.is_finite() || !(0.0..=1.0).contains(&p.x) || !(0.0..=1.0).contains(&p.y)
    }) {
        return Err("CARD_POSITION_RECORD_INVALID: Coordinates must be finite and normalized.".into());
    }
    Ok(())
}
fn validate_record(value: &PositionRecord, id: &str) -> Result<(), String> {
    if value.schema_version != 1 || value.project_id != id {
        return Err("CARD_POSITION_RECORD_INVALID: Schema version or project ownership mismatch.".into());
    }
    validate_position(&value.position)
}
fn linked(metadata: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        metadata.file_type().is_symlink() || metadata.file_attributes() & 0x400 != 0
    }
    #[cfg(not(windows))]
    {
        metadata.file_type().is_symlink()
    }
}
fn safe_metadata(path: &Path, directory: bool) -> Result<Option<fs::Metadata>, String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) => {
            if linked(&metadata) || if directory { !metadata.is_dir() } else { !metadata.is_file() } {
                return Err(format!("CARD_POSITION_PATH_UNSAFE: Unexpected file type: {}", path.display()));
            }
            Ok(Some(metadata))
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("CARD_POSITION_IO: Cannot inspect {}: {error}", path.display())),
    }
}
fn location(root: &Path, id: &str, create: bool) -> Result<PathBuf, String> {
    validate_id(id)?;
    let preferences = root.join("ui-preferences");
    let positions = preferences.join("novel-card-positions");
    for directory in [&preferences, &positions] {
        if safe_metadata(directory, true)?.is_none() && create {
            fs::create_dir_all(directory)
                .map_err(|e| format!("CARD_POSITION_IO: Cannot create {}: {e}", directory.display()))?;
            safe_metadata(directory, true)?;
        }
    }
    // No caller-supplied path segment. Unicode, slashes and device names in an
    // otherwise valid project identity can never escape this preference folder.
    Ok(positions.join(format!("{:x}.json", Sha256::digest(id.as_bytes()))))
}
fn read_at(root: &Path, id: &str) -> Result<Option<PositionRecord>, String> {
    let file = location(root, id, false)?;
    let Some(metadata) = safe_metadata(&file, false)? else { return Ok(None); };
    if metadata.len() > MAX_RECORD_BYTES {
        return Err("CARD_POSITION_RECORD_INVALID: Position record exceeds size limit.".into());
    }
    let bytes = fs::read(&file)
        .map_err(|e| format!("CARD_POSITION_IO: Cannot read {}: {e}", file.display()))?;
    if bytes.len() as u64 > MAX_RECORD_BYTES {
        return Err("CARD_POSITION_RECORD_INVALID: Position record exceeds size limit.".into());
    }
    let value: PositionRecord = serde_json::from_slice(&bytes)
        .map_err(|e| format!("CARD_POSITION_RECORD_INVALID: Invalid UTF-8 JSON: {e}"))?;
    validate_record(&value, id)?;
    Ok(Some(value))
}
fn write_at(root: &Path, id: &str, position: Option<Position>) -> Result<PositionRecord, String> {
    validate_id(id)?;
    validate_position(&position)?;
    let file = location(root, id, true)?;
    safe_metadata(&file, false)?;
    let record = PositionRecord { schema_version: 1, project_id: id.into(), position };
    // Existing helper syncs the file, then publishes via Windows write-through
    // replacement (rename elsewhere). A successful IPC reply is the commit.
    crate::write_json_atomic(&file, &record)
        .map_err(|e| format!("CARD_POSITION_IO: {e}"))?;
    Ok(record)
}

#[tauri::command]
pub(crate) async fn read_novel_task_card_position(
    app: tauri::AppHandle, project_id: String,
) -> Result<Option<PositionRecord>, String> {
    let root = crate::editor_app_data_dir(&app);
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = POSITION_IO.get_or_init(|| Mutex::new(())).lock()
            .map_err(|_| "CARD_POSITION_IO: Position storage lock poisoned.".to_string())?;
        read_at(&root, &project_id)
    }).await.map_err(|e| format!("CARD_POSITION_IO: Read worker failed: {e}"))?
}
#[tauri::command]
pub(crate) async fn write_novel_task_card_position(
    app: tauri::AppHandle, project_id: String, position: Option<Position>,
) -> Result<PositionRecord, String> {
    let root = crate::editor_app_data_dir(&app);
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = POSITION_IO.get_or_init(|| Mutex::new(())).lock()
            .map_err(|_| "CARD_POSITION_IO: Position storage lock poisoned.".to_string())?;
        write_at(&root, &project_id, position)
    }).await.map_err(|e| format!("CARD_POSITION_IO: Write worker failed: {e}"))?
}

#[cfg(test)]
mod novel_card_position_tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    static NEXT: AtomicUsize = AtomicUsize::new(0);
    struct Sandbox(PathBuf);
    impl Sandbox {
        fn new() -> Self {
            let root = std::env::temp_dir().join(format!("agentvn-card-position-{}-{}-{}",
                std::process::id(), crate::error_report_timestamp(), NEXT.fetch_add(1, Ordering::Relaxed)));
            fs::create_dir(&root).unwrap();
            Self(root)
        }
    }
    impl Drop for Sandbox {
        fn drop(&mut self) {
            assert_eq!(self.0.parent(), Some(std::env::temp_dir().as_path()));
            assert!(self.0.file_name().unwrap().to_string_lossy().starts_with("agentvn-card-position-"));
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    fn p(x: f64, y: f64) -> Option<Position> { Some(Position { x, y }) }
    #[test]
    fn missing_read_does_not_create_any_preferences() {
        let s = Sandbox::new();
        assert_eq!(read_at(&s.0, "A").unwrap(), None);
        assert!(!s.0.join("ui-preferences").exists());
    }
    #[test]
    fn actual_utf8_bytes_unicode_id_roundtrip_and_project_isolation() {
        let s = Sandbox::new();
        let a = write_at(&s.0, "中文工程 A", p(0.2, 0.7)).unwrap();
        assert_eq!(read_at(&s.0, "中文工程 A").unwrap(), Some(a.clone()));
        assert_eq!(read_at(&s.0, "B").unwrap(), None);
        let bytes = fs::read(location(&s.0, "中文工程 A", false).unwrap()).unwrap();
        assert!(std::str::from_utf8(&bytes).unwrap().contains("中文工程 A"));
        assert_eq!(serde_json::from_slice::<PositionRecord>(&bytes).unwrap(), a);
    }
    #[test]
    fn reset_is_an_explicit_durable_tombstone_and_next_drag_replaces_it() {
        let s = Sandbox::new();
        write_at(&s.0, "A", p(0.8, 0.9)).unwrap();
        let reset = write_at(&s.0, "A", None).unwrap();
        assert_eq!(read_at(&s.0, "A").unwrap(), Some(reset));
        assert!(fs::read_to_string(location(&s.0, "A", false).unwrap()).unwrap().contains("\"position\": null"));
        write_at(&s.0, "A", p(0.1, 0.4)).unwrap();
        assert_eq!(read_at(&s.0, "A").unwrap().unwrap().position, p(0.1, 0.4));
    }
    #[test]
    fn invalid_positions_leave_old_file_bytes_unchanged() {
        let s = Sandbox::new();
        write_at(&s.0, "A", p(0.3, 0.4)).unwrap();
        let file = location(&s.0, "A", false).unwrap();
        let before = fs::read(&file).unwrap();
        for position in [p(f64::NAN, 0.1), p(0.1, f64::INFINITY), p(-0.1, 0.5), p(0.5, 1.01)] {
            assert!(write_at(&s.0, "A", position).unwrap_err().starts_with("CARD_POSITION_RECORD_INVALID"));
            assert_eq!(fs::read(&file).unwrap(), before);
        }
    }
    #[test]
    fn corrupted_wrong_owner_version_and_oversize_records_are_errors_not_absent() {
        let s = Sandbox::new();
        let file = location(&s.0, "A", true).unwrap();
        for text in [
            "{broken".to_string(),
            r#"{"schemaVersion":1,"projectId":"B","position":null}"#.into(),
            r#"{"schemaVersion":2,"projectId":"A","position":null}"#.into(),
            r#"{"schemaVersion":1,"projectId":"A","position":{"x":2,"y":0.2}}"#.into(),
            r#"{"schemaVersion":1,"projectId":"A","position":null,"extra":true}"#.into(),
            r#"{"schemaVersion":1,"projectId":"A"}"#.into(),
            " ".repeat(MAX_RECORD_BYTES as usize + 1),
        ] {
            fs::write(&file, text).unwrap();
            assert!(read_at(&s.0, "A").unwrap_err().starts_with("CARD_POSITION_RECORD_INVALID"));
        }
    }
    #[test]
    fn unsafe_project_text_is_hashed_not_joined_and_empty_ids_rejected() {
        let s = Sandbox::new();
        for id in ["../outside", "C:\\Windows\\file", "CON", "工程/甲\\乙"] {
            let file = location(&s.0, id, true).unwrap();
            assert_eq!(file.parent().unwrap(), s.0.join("ui-preferences/novel-card-positions"));
            assert_eq!(file.file_name().unwrap().to_string_lossy().len(), 69);
            write_at(&s.0, id, p(0.1, 0.2)).unwrap();
            assert!(read_at(&s.0, id).unwrap().is_some());
        }
        for id in ["", " ", &"x".repeat(1025)] { assert!(write_at(&s.0, id, None).is_err()); }
    }
    #[test]
    fn blocked_preference_directory_is_error_and_retry_succeeds() {
        let s = Sandbox::new();
        let blocked = s.0.join("ui-preferences");
        fs::write(&blocked, b"owned blocker").unwrap();
        assert!(write_at(&s.0, "A", p(0.1, 0.2)).unwrap_err().starts_with("CARD_POSITION_PATH_UNSAFE"));
        assert_eq!(fs::read(&blocked).unwrap(), b"owned blocker");
        fs::rename(&blocked, s.0.join("preserved-blocker")).unwrap();
        write_at(&s.0, "A", p(0.1, 0.2)).unwrap();
        assert_eq!(read_at(&s.0, "A").unwrap().unwrap().position, p(0.1, 0.2));
    }
    #[test]
    fn record_directory_is_rejected_without_overwriting_or_temp_leak() {
        let s = Sandbox::new();
        let file = location(&s.0, "A", true).unwrap();
        fs::create_dir(&file).unwrap();
        assert!(write_at(&s.0, "A", None).is_err());
        assert!(read_at(&s.0, "A").is_err());
        assert_eq!(fs::read_dir(file.parent().unwrap()).unwrap().count(), 1);
    }
}
