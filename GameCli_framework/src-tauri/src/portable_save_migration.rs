use super::save_location::SaveLocation;
use serde::Serialize;
use std::{fs, path::Path};
use super::save_location::reject_link;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationStatus {
    pub portable: bool,
    pub source_directory: Option<String>,
    pub target_directory: String,
    pub available_files: Vec<String>,
    pub conflict_files: Vec<String>,
    pub skipped_files: Vec<String>,
    pub copied_files: Vec<String>,
}

fn valid_save(bytes: &[u8], game_id: &str, file_name: &str) -> bool {
    let Ok(value) = serde_json::from_slice::<serde_json::Value>(bytes) else { return false };
    if value.get("game_id").and_then(|v| v.as_str()) != Some(game_id)
        || value.get("scene_id").and_then(|v| v.as_str()).is_none()
        || value.get("command_index").and_then(|v| v.as_u64()).is_none() { return false; }
    let Some(slot) = value.get("slot").and_then(|v| v.as_u64()).filter(|v| (1..=255).contains(v)) else {
        return false;
    };
    let kind = value.get("save_kind").and_then(|v| v.as_str()).unwrap_or("manual");
    super::save_file_name(kind, slot as u8).as_deref() == Ok(file_name)
}

fn read_save_bytes(path: &Path) -> Result<Vec<u8>, String> {
    use std::io::Read;
    reject_link(path)?;
    let mut bytes = Vec::new();
    fs::File::open(path).and_then(|f| f.take(32 * 1024 * 1024 + 1).read_to_end(&mut bytes))
        .map_err(|e| format!("无法读取旧存档 {}：{e}", path.display()))?;
    if bytes.len() > 32 * 1024 * 1024 { return Err(format!("旧存档超过32MiB：{}", path.display())); }
    Ok(bytes)
}

pub fn inspect(location: &SaveLocation, game_id: &str) -> Result<MigrationStatus, String> {
    let mut status = MigrationStatus {
        portable: location.legacy.is_some(),
        source_directory: location.legacy.as_ref().map(|p| p.display().to_string()),
        target_directory: location.target.display().to_string(),
        available_files: vec![], conflict_files: vec![], skipped_files: vec![], copied_files: vec![],
    };
    let Some(legacy) = &location.legacy else { return Ok(status); };
    // Check only appended components; never follow a user-created saves junction.
    for path in [legacy.parent().unwrap_or(legacy), legacy.as_path()] { reject_link(path)?; }
    let entries = match fs::read_dir(legacy) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(status),
        Err(e) => return Err(format!("无法扫描旧存档目录 {}：{e}", legacy.display())),
    };
    for entry in entries {
        let entry = entry.map_err(|e| format!("无法扫描旧存档：{e}"))?;
        let name = entry.file_name().to_string_lossy().to_string();
        if !name.ends_with(".json") { continue; }
        let bytes = read_save_bytes(&entry.path())?;
        if !valid_save(&bytes, game_id, &name) {
            status.skipped_files.push(name);
            continue;
        }
        let target = location.target.join(&name);
        reject_link(&target)?;
        match fs::read(&target) {
            Ok(current) if current == bytes => {}
            Ok(_) => status.conflict_files.push(name),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => status.available_files.push(name),
            Err(e) => return Err(format!("无法检查目标存档 {}：{e}", target.display())),
        }
    }
    status.available_files.sort(); status.conflict_files.sort(); status.skipped_files.sort();
    Ok(status)
}

pub fn migrate(location: &SaveLocation, game_id: &str, confirmed: bool) -> Result<MigrationStatus, String> {
    if !confirmed { return Err("必须由玩家确认后才能复制旧存档。".to_string()); }
    let before = inspect(location, game_id)?;
    let Some(legacy) = &location.legacy else {
        return Err("只有Windows独立游戏支持安装目录存档迁移。".to_string());
    };
    if before.available_files.is_empty() { return Ok(before); }
    fs::create_dir_all(&location.target).map_err(|e|
        format!("无法创建存档目录 {}：{e}。请将游戏移至可写目录；不会回退到其他位置。", location.target.display()))?;
    let mut copied = vec![];
    for name in &before.available_files {
        let source = legacy.join(name);
        let target = location.target.join(name);
        if super::save_location::copy_new_save(&source, &target, |bytes| {
            if valid_save(bytes, game_id, name) { Ok(()) }
            else { Err(format!("旧存档 {name} 已变更或不属于当前游戏，未迁移；可重试扫描。")) }
        })? {
            copied.push(name.clone());
        }
    }
    let mut after = inspect(location, game_id)?;
    after.copied_files = copied;
    Ok(after)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn portable_migration_scan_only_offers_matching_game_and_never_writes() {
        let root = std::env::temp_dir().join(format!("agentvn-migration-scan-{}", std::process::id()));
        let legacy = root.join("旧 AppData/saves/preview_gamecli");
        let target = root.join("中文 安装/saves/game-a/preview_gamecli");
        fs::create_dir_all(&legacy).unwrap();
        for (file, game) in [("slot-01.json", "game-a"), ("auto-01.json", "other-game")] {
            let kind = if file.starts_with("auto") { "auto" } else { "manual" };
            fs::write(legacy.join(file), serde_json::to_vec(&serde_json::json!({
                "game_id": game, "save_kind": kind, "slot": 1, "scene_id": "main", "command_index": 0
            })).unwrap()).unwrap();
        }
        let result = inspect(&SaveLocation { target: target.clone(), legacy: Some(legacy.clone()) }, "game-a").unwrap();
        let source_count = fs::read_dir(&legacy).unwrap().count();
        let created_target = target.exists();
        fs::remove_dir_all(&root).unwrap();
        assert_eq!(result.available_files, ["slot-01.json"]);
        assert_eq!(result.skipped_files, ["auto-01.json"]);
        assert_eq!(source_count, 2);
        assert!(!created_target, "scan/cancel must not create the portable save directory");
    }

    #[test]
    fn portable_migration_confirm_copies_all_kinds_preserves_conflicts_and_is_retryable() {
        let root = std::env::temp_dir().join(format!("agentvn-migration-confirm-{}", std::process::id()));
        let legacy = root.join("旧 AppData/saves/preview_gamecli");
        let target = root.join("游戏/saves/game-a/preview_gamecli");
        fs::create_dir_all(&legacy).unwrap();
        let mut originals = vec![];
        for (file, kind, slot) in [("slot-01.json", "manual", 1), ("auto-01.json", "auto", 1),
            ("quick-01.json", "quick", 1), ("slot-02.json", "manual", 2)] {
            let bytes = serde_json::to_vec_pretty(&serde_json::json!({
                "game_id": "game-a", "save_kind": kind, "slot": slot, "scene_id": "main", "command_index": 0
            })).unwrap();
            fs::write(legacy.join(file), &bytes).unwrap();
            originals.push((file, bytes));
        }
        let location = SaveLocation { target: target.clone(), legacy: Some(legacy.clone()) };
        assert!(migrate(&location, "game-a", false).is_err());
        assert!(!target.exists());
        fs::create_dir_all(&target).unwrap();
        fs::write(target.join("slot-02.json"), b"new progress do not overwrite").unwrap();
        let result = migrate(&location, "game-a", true).unwrap();
        let copied = originals.iter().filter(|(name, _)| *name != "slot-02.json")
            .all(|(name, bytes)| fs::read(target.join(name)).ok().as_ref() == Some(bytes));
        let source_unchanged = originals.iter().all(|(name, bytes)| fs::read(legacy.join(name)).unwrap() == *bytes);
        let conflict = fs::read(target.join("slot-02.json")).unwrap();
        let retry = migrate(&location, "game-a", true).unwrap();
        fs::remove_dir_all(&root).unwrap();
        assert_eq!(result.copied_files.len(), 3);
        assert_eq!(result.conflict_files, ["slot-02.json"]);
        assert!(copied && source_unchanged);
        assert_eq!(conflict, b"new progress do not overwrite");
        assert!(retry.copied_files.is_empty());
        assert_eq!(retry.conflict_files, ["slot-02.json"]);
    }

    #[test]
    fn portable_migration_unwritable_target_never_falls_back_or_removes_source() {
        let root = std::env::temp_dir().join(format!("agentvn-migration-blocked-{}", std::process::id()));
        let legacy = root.join("appdata/saves/preview_gamecli");
        let target = root.join("installed/saves/game-a/preview_gamecli");
        fs::create_dir_all(&legacy).unwrap();
        fs::create_dir_all(root.join("installed")).unwrap();
        fs::write(root.join("installed/saves"), b"blocking-file").unwrap();
        let bytes = br#"{"game_id":"game-a","slot":1,"scene_id":"main","command_index":0}"#;
        fs::write(legacy.join("slot-01.json"), bytes).unwrap();
        let location = SaveLocation { target: target.clone(), legacy: Some(legacy.clone()) };
        let result = migrate(&location, "game-a", true);
        let old = fs::read(legacy.join("slot-01.json")).unwrap();
        let files = fs::read_dir(&legacy).unwrap().count();
        fs::remove_dir_all(&root).unwrap();
        assert!(result.is_err());
        assert_eq!(old, bytes);
        assert_eq!(files, 1);
    }
}
