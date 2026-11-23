//! Immutable GUI library revisions in the Editor user-data directory, never a project.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{fs::{self, File, OpenOptions}, io::Write, path::{Path, PathBuf}};

const MAX_RECORD_BYTES: u64 = 190 * 1024 * 1024;
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Summary {
    id: String, name: String, source_name: String, created_at: String, revision: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    parent_id: Option<String>,
    asset_count: u64, issue_count: u64,
}
fn valid_id(id: &str) -> bool {
    id.starts_with("gui-pack-") && (17..=89).contains(&id.len())
        && id.bytes().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-')
}
fn linked(metadata: &fs::Metadata) -> bool {
    #[cfg(windows)] {
        use std::os::windows::fs::MetadataExt;
        metadata.file_type().is_symlink() || metadata.file_attributes() & 0x400 != 0
    }
    #[cfg(not(windows))] { metadata.file_type().is_symlink() }
}
fn check(path: &Path, directory: bool) -> Result<bool, String> {
    match fs::symlink_metadata(path) {
        Ok(m) if !linked(&m) && if directory { m.is_dir() } else { m.is_file() } => Ok(true),
        Ok(_) => Err(format!("GUI_LIBRARY_PATH_UNSAFE: {}", path.display())),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(e) => Err(format!("GUI_LIBRARY_IO: {e}")),
    }
}
fn root_at(user: &Path, create: bool) -> Result<PathBuf, String> {
    let root = user.join("gui-pack-library");
    if !check(&root, true)? && create {
        fs::create_dir_all(&root).map_err(|e| format!("GUI_LIBRARY_IO: {e}"))?;
        check(&root, true)?;
    }
    Ok(root)
}
fn summary(payload: &str) -> Result<Summary, String> {
    if payload.len() as u64 > MAX_RECORD_BYTES { return Err("GUI_LIBRARY_LIMIT".into()); }
    let value: Value = serde_json::from_str(payload).map_err(|e| format!("GUI_LIBRARY_INVALID: {e}"))?;
    let allowed = ["schemaVersion", "id", "name", "sourceName", "createdAt", "revision", "parentId",
        "assetCount", "issueCount", "scan", "parameterSelection", "assetBindings"];
    let object = value.as_object().ok_or("GUI_LIBRARY_INVALID")?;
    if object.keys().any(|key| !allowed.contains(&key.as_str()))
        || value["schemaVersion"].as_u64() != Some(1)
        || !value["scan"].is_object() || !value["parameterSelection"].is_object()
        || !value["assetBindings"].is_object() {
        return Err("GUI_LIBRARY_INVALID: Unsupported record fields.".into());
    }
    let mut header = serde_json::Map::new();
    for key in ["id", "name", "sourceName", "createdAt", "revision", "parentId", "assetCount", "issueCount"] {
        if let Some(value) = value.get(key) { header.insert(key.into(), value.clone()); }
    }
    let result: Summary = serde_json::from_value(Value::Object(header))
        .map_err(|e| format!("GUI_LIBRARY_INVALID: {e}"))?;
    if !valid_id(&result.id) || result.name.trim().is_empty() || result.name.chars().count() > 160
        || result.source_name.chars().count() > 240 || result.source_name.contains(['/', '\\', '\0'])
        || result.revision == 0 || result.parent_id.as_deref().is_some_and(|id| !valid_id(id))
        || result.asset_count > 4096
        || value["scan"]["assets"].as_array().map(|a| a.len() as u64) != Some(result.asset_count)
        || value["scan"]["issues"].as_array().map(|a| a.len() as u64) != Some(result.issue_count) {
        return Err("GUI_LIBRARY_INVALID: Invalid revision or manifest.".into());
    }
    Ok(result)
}
fn read_limited(path: &Path) -> Result<String, String> {
    if !check(path, false)? { return Err("GUI_LIBRARY_MISSING".into()); }
    let m = fs::metadata(path).map_err(|e| format!("GUI_LIBRARY_IO: {e}"))?;
    if m.len() > MAX_RECORD_BYTES { return Err("GUI_LIBRARY_LIMIT".into()); }
    let bytes = fs::read(path).map_err(|e| format!("GUI_LIBRARY_IO: {e}"))?;
    if bytes.len() as u64 > MAX_RECORD_BYTES { return Err("GUI_LIBRARY_LIMIT".into()); }
    String::from_utf8(bytes).map_err(|_| "GUI_LIBRARY_INVALID: Not UTF-8.".into())
}
pub(crate) fn list_at(user: &Path) -> Result<Vec<Summary>, String> {
    let root = root_at(user, false)?;
    if !check(&root, true)? { return Ok(vec![]); }
    let mut result = vec![];
    for entry in fs::read_dir(root).map_err(|e| format!("GUI_LIBRARY_IO: {e}"))? {
        let entry = entry.map_err(|e| format!("GUI_LIBRARY_IO: {e}"))?;
        let id = entry.file_name().to_string_lossy().to_string();
        if !valid_id(&id) { continue; } // Uncommitted staging directories aren't published.
        check(&entry.path(), true)?;
        let info: Summary = serde_json::from_str(&read_limited(&entry.path().join("summary.json"))?)
            .map_err(|e| format!("GUI_LIBRARY_INVALID: {e}"))?;
        if info.id != id { return Err("GUI_LIBRARY_INVALID: Identity mismatch.".into()); }
        result.push(info);
    }
    result.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(result)
}
pub(crate) fn read_at(user: &Path, id: &str) -> Result<String, String> {
    if !valid_id(id) { return Err("GUI_LIBRARY_INVALID_ID".into()); }
    let folder = root_at(user, false)?.join(id);
    if !check(&folder, true)? { return Err("GUI_LIBRARY_MISSING".into()); }
    let payload = read_limited(&folder.join("record.json"))?;
    if summary(&payload)?.id != id { return Err("GUI_LIBRARY_INVALID: Identity mismatch.".into()); }
    Ok(payload)
}
pub(crate) fn save_at(user: &Path, payload: &str) -> Result<Summary, String> {
    let info = summary(payload)?;
    let root = root_at(user, true)?;
    let target = root.join(&info.id);
    if check(&target, true)? { return Err("GUI_LIBRARY_REVISION_EXISTS: Existing revisions are immutable.".into()); }
    if let Some(parent) = &info.parent_id {
        let previous = summary(&read_at(user, parent)?)?;
        if info.revision != previous.revision + 1 {
            return Err("GUI_LIBRARY_INVALID_REVISION".into());
        }
    } else if info.revision != 1 { return Err("GUI_LIBRARY_INVALID_REVISION".into()); }
    let stage = root.join(format!(".{}.pending", info.id));
    fs::create_dir(&stage).map_err(|e| format!("GUI_LIBRARY_IO: {e}"))?;
    let commit = (|| {
        for (name, content) in [("record.json", payload.to_string()),
            ("summary.json", serde_json::to_string(&info).map_err(|e| e.to_string())?)] {
            let mut file: File = OpenOptions::new().write(true).create_new(true).open(stage.join(name))
                .map_err(|e| format!("GUI_LIBRARY_IO: {e}"))?;
            file.write_all(content.as_bytes()).and_then(|_| file.sync_all())
                .map_err(|e| format!("GUI_LIBRARY_IO: {e}"))?;
        }
        // Directory rename publishes both complete files; an existing nonempty target cannot be overwritten.
        fs::rename(&stage, &target).map_err(|e| format!("GUI_LIBRARY_IO: {e}"))
    })();
    if let Err(error) = commit {
        // stage was created exclusively above, directly inside the checked library root.
        if let Err(cleanup) = fs::remove_dir_all(&stage) {
            return Err(format!("{error}; GUI_LIBRARY_CLEANUP: {cleanup}"));
        }
        return Err(error);
    }
    Ok(info)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    static NEXT: AtomicUsize = AtomicUsize::new(0);
    fn sandbox() -> PathBuf {
        let root = PathBuf::from(std::env::var("AGENTVN_NATIVE_TEST_OUTPUT")
            .expect("Native tests require an explicit isolated F:/AgentVN/QA output."));
        assert!(root.is_absolute());
        let path = root.join(format!("case-{}-{}", std::process::id(), NEXT.fetch_add(1, Ordering::Relaxed)));
        fs::create_dir_all(&path).unwrap();
        path
    }
    fn payload(id: &str, parent: Option<&str>, revision: u64) -> String {
        serde_json::json!({
            "schemaVersion":1,"id":id,"name":"中文 界面库","sourceName":"中文 资源.zip",
            "createdAt":"2026-10-21T00:00:00.000Z","revision":revision,"parentId":parent,
            "assetCount":0,"issueCount":0,"scan":{"parameters":{"values":{},"issues":[]},"assets":[],"issues":[],"complete":true},
            "parameterSelection":{},"assetBindings":{}
        }).to_string()
    }
    const A: &str = "gui-pack-native-test-a";
    const B: &str = "gui-pack-native-test-b";
    #[test]
    fn missing_read_has_no_filesystem_side_effect() {
        let root = sandbox();
        assert!(list_at(&root).unwrap().is_empty());
        assert!(read_at(&root, A).is_err());
        assert_eq!(fs::read_dir(&root).unwrap().count(), 0);
    }
    #[test]
    fn utf8_record_is_durable_and_listed_only_after_atomic_commit() {
        let root = sandbox();
        let input = payload(A, None, 1);
        save_at(&root, &input).unwrap();
        assert_eq!(read_at(&root, A).unwrap(), input);
        let list = list_at(&root).unwrap();
        assert_eq!(list.len(), 1); assert_eq!(list[0].name, "中文 界面库");
        assert_eq!(fs::read_dir(root.join("gui-pack-library")).unwrap().count(), 1);
        assert_eq!(fs::read_to_string(root.join("gui-pack-library").join(A).join("record.json")).unwrap(), input);
    }
    #[test]
    fn new_revision_preserves_old_bytes_and_rejects_overwrite() {
        let root = sandbox();
        let first = payload(A, None, 1);
        save_at(&root, &first).unwrap();
        let second = payload(B, Some(A), 2);
        save_at(&root, &second).unwrap();
        assert_eq!(list_at(&root).unwrap().len(), 2);
        assert!(save_at(&root, &payload(A, None, 1)).unwrap_err().contains("REVISION_EXISTS"));
        assert_eq!(read_at(&root, A).unwrap(), first);
        assert_eq!(read_at(&root, B).unwrap(), second);
        assert!(save_at(&root, &payload("gui-pack-invalid-next", Some(A), 5)).is_err());
        assert_eq!(list_at(&root).unwrap().len(), 2);
    }
    #[test]
    fn invalid_identity_missing_parent_and_unknown_fields_cannot_publish() {
        let root = sandbox();
        for id in ["../escape", "C:/arbitrary", "..", "gui-pack-../../escape"] {
            assert!(read_at(&root, id).is_err());
            assert!(save_at(&root, &payload(id, None, 1)).is_err());
        }
        assert!(save_at(&root, &payload(B, Some(A), 2)).is_err());
        let mut bad: Value = serde_json::from_str(&payload(A, None, 1)).unwrap();
        bad["projectId"] = Value::String("never-store-project-identity".into());
        assert!(save_at(&root, &bad.to_string()).is_err());
        assert!(list_at(&root).unwrap().is_empty());
    }
    #[test]
    fn incomplete_staging_never_appears_in_library() {
        let root = sandbox(); let library = root_at(&root, true).unwrap();
        fs::create_dir(library.join(format!(".{A}.pending"))).unwrap();
        assert!(list_at(&root).unwrap().is_empty());
    }
    #[test]
    fn unusable_library_path_reports_error_and_does_not_fallback() {
        let root = sandbox();
        let path = root.join("gui-pack-library");
        fs::write(&path, b"protected-original").unwrap();
        assert!(save_at(&root, &payload(A, None, 1)).unwrap_err().contains("PATH_UNSAFE"));
        assert_eq!(fs::read(&path).unwrap(), b"protected-original");
        assert_eq!(fs::read_dir(&root).unwrap().count(), 1);
    }
    #[test]
    fn corrupted_or_wrong_identity_record_cannot_be_read_as_valid_revision() {
        let root = sandbox();
        save_at(&root, &payload(A, None, 1)).unwrap();
        let record = root.join("gui-pack-library").join(A).join("record.json");
        fs::write(&record, b"invalid-json").unwrap();
        assert!(read_at(&root, A).is_err());
        fs::write(&record, payload(B, None, 1)).unwrap();
        assert!(read_at(&root, A).unwrap_err().contains("Identity mismatch"));
    }
}
