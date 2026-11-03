use super::save_location::SaveLocation;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
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
    pub unverified_files: Vec<UnverifiedSave>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnverifiedSave {
    pub file_name: String,
    pub source_sha256: String,
    pub slot: u8,
    pub save_kind: String,
    pub created_at: Option<String>,
    pub scene_id: String,
    pub summary: Option<String>,
    pub conflict: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LegacyClaim {
    pub file_name: String,
    pub source_sha256: String,
}

fn source_hash(bytes: &[u8]) -> String { format!("{:x}", Sha256::digest(bytes)) }

fn canonical_save_name(name: &str) -> bool {
    ["manual", "auto", "quick"].iter().any(|kind|
        (1..=255u8).any(|slot| super::save_file_name(kind, slot).as_deref() == Ok(name)))
}

fn historical_save(bytes: &[u8], file_name: &str) -> Option<serde_json::Value> {
    if !valid_save(bytes, "preview_gamecli", file_name) { return None; }
    let value: serde_json::Value = serde_json::from_slice(bytes).ok()?;
    // This known historical alias is not evidence of ownership. No other
    // game's explicit identity is eligible for this manual compatibility path.
    (value.get("install_id")?.as_str()? == "preview_gamecli").then_some(value)
}

fn mapped_copy(bytes: &[u8], game_id: &str, file_name: &str) -> Result<Vec<u8>, String> {
    let mut value = historical_save(bytes, file_name)
        .ok_or_else(|| format!("旧存档 {file_name} 不是受支持的通用身份旧档，请重新扫描。"))?;
    value["game_id"] = serde_json::Value::String(game_id.to_string());
    serde_json::to_vec_pretty(&value).map_err(|e| format!("无法转换旧存档副本：{e}"))
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
        unverified_files: vec![],
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
        let verified = valid_save(&bytes, game_id, &name);
        let historical = if verified { None } else { historical_save(&bytes, &name) };
        if !verified && historical.is_none() { status.skipped_files.push(name); continue; }
        let expected = if verified { bytes.clone() } else { mapped_copy(&bytes, game_id, &name)? };
        let target = location.target.join(&name);
        reject_link(&target)?;
        let conflict = match fs::read(&target) {
            Ok(current) if current == expected => continue,
            Ok(_) => true,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => false,
            Err(e) => return Err(format!("无法检查目标存档 {}：{e}", target.display())),
        };
        if conflict { status.conflict_files.push(name.clone()); }
        if let Some(value) = historical {
            status.unverified_files.push(UnverifiedSave {
                file_name: name, source_sha256: source_hash(&bytes),
                slot: value["slot"].as_u64().unwrap() as u8,
                save_kind: value["save_kind"].as_str().unwrap_or("manual").to_string(),
                created_at: value["created_at"].as_str().map(|v| v.chars().take(64).collect()),
                scene_id: value["scene_id"].as_str().unwrap().chars().take(240).collect(),
                summary: value["dialog"]["text"].as_str().map(|v| v.chars().take(160).collect()),
                conflict,
            });
        } else if !conflict {
            status.available_files.push(name);
        }
    }
    status.available_files.sort(); status.conflict_files.sort(); status.skipped_files.sort();
    status.unverified_files.sort_by(|a, b| a.file_name.cmp(&b.file_name));
    Ok(status)
}

pub fn migrate(location: &SaveLocation, game_id: &str, confirmed: bool) -> Result<MigrationStatus, String> {
    migrate_with_claims(location, game_id, confirmed, &[])
}

pub fn migrate_with_claims(
    location: &SaveLocation, game_id: &str, confirmed: bool, claims: &[LegacyClaim],
) -> Result<MigrationStatus, String> {
    if !confirmed { return Err("必须由玩家确认后才能复制旧存档。".to_string()); }
    let before = inspect(location, game_id)?;
    let Some(legacy) = &location.legacy else {
        return Err("只有Windows独立游戏支持安装目录存档迁移。".to_string());
    };
    // Validate the complete selection before copying anything. The exact bytes
    // the player reviewed must still exist when a claim is submitted.
    let mut selected = std::collections::BTreeSet::new();
    for claim in claims {
        if !selected.insert(claim.file_name.clone())
            || !canonical_save_name(&claim.file_name)
            || claim.source_sha256.len() != 64 {
            return Err("旧存档选择无效，请重新扫描并确认归属。".to_string());
        }
        let bytes = read_save_bytes(&legacy.join(&claim.file_name))?;
        if historical_save(&bytes, &claim.file_name).is_none()
            || source_hash(&bytes) != claim.source_sha256 {
            return Err(format!("旧存档 {} 已变更，请重新扫描并确认归属。", claim.file_name));
        }
    }
    if before.available_files.is_empty() && claims.is_empty() { return Ok(before); }
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
    for claim in claims {
        let source = legacy.join(&claim.file_name);
        let target = location.target.join(&claim.file_name);
        if super::save_location::copy_new_save_mapped(&source, &target, |bytes| {
            if source_hash(bytes) != claim.source_sha256 {
                return Err(format!("旧存档 {} 已变更，请重新扫描并确认归属。", claim.file_name));
            }
            mapped_copy(bytes, game_id, &claim.file_name)
        })? { copied.push(claim.file_name.clone()); }
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
    fn historical_generic_identity_requires_manual_ownership_review() {
        let root = std::env::temp_dir().join(format!("agentvn-legacy-review-{}", std::process::id()));
        let legacy = root.join("旧存档/preview_gamecli");
        let target = root.join("游戏/saves/game-a/preview_gamecli");
        fs::create_dir_all(&legacy).unwrap();
        let bytes = br#"{"game_id":"preview_gamecli","install_id":"preview_gamecli","slot":1,"scene_id":"main","command_index":0,"created_at":"2026-09-25T12:00:00Z","dialog":{"text":"Original historical progress"}}"#;
        fs::write(legacy.join("slot-01.json"), bytes).unwrap();
        let result = inspect(&SaveLocation { target: target.clone(), legacy: Some(legacy.clone()) }, "game-a").unwrap();
        let serialized = serde_json::to_value(&result).unwrap();
        let original = fs::read(legacy.join("slot-01.json")).unwrap();
        let created_target = target.exists();
        fs::remove_dir_all(&root).unwrap();
        assert!(result.available_files.is_empty(), "generic identity is never automatically trusted");
        assert_eq!(serialized["unverifiedFiles"][0]["fileName"], "slot-01.json",
            "offer an explicit manual ownership review rather than silently skipping a real historical save");
        assert_eq!(original, bytes);
        assert!(!created_target);
    }

    #[test]
    fn manual_claims_map_only_new_copies_and_preserve_conflicts_and_unselected_files() {
        let root = std::env::temp_dir().join(format!("agentvn-legacy-claims-{}", std::process::id()));
        let legacy = root.join("旧存档/preview_gamecli");
        let target = root.join("游戏/saves/game-a/preview_gamecli");
        fs::create_dir_all(&legacy).unwrap();
        let mut originals = vec![];
        for (file, kind, slot) in [("slot-01.json", "manual", 1), ("auto-01.json", "auto", 1),
            ("quick-01.json", "quick", 1), ("slot-02.json", "manual", 2), ("slot-03.json", "manual", 3)] {
            let bytes = serde_json::to_vec(&serde_json::json!({
                "game_id": "preview_gamecli", "install_id": "preview_gamecli",
                "save_kind": kind, "slot": slot, "scene_id": "main", "command_index": 2,
                "dialog": {"text": "原始中文对白"}, "variables": {"chapter": 3}
            })).unwrap();
            fs::write(legacy.join(file), &bytes).unwrap();
            originals.push((file, bytes));
        }
        let location = SaveLocation { target: target.clone(), legacy: Some(legacy.clone()) };
        assert!(migrate(&location, "game-a", true).unwrap().copied_files.is_empty());
        assert!(!target.exists(), "normal confirmation must not claim ambiguous saves");
        fs::create_dir_all(&target).unwrap();
        fs::write(target.join("slot-02.json"), b"new progress").unwrap();
        let before = inspect(&location, "game-a").unwrap();
        assert_eq!(before.unverified_files.len(), 5);
        assert!(before.unverified_files.iter().find(|v| v.file_name == "slot-02.json").unwrap().conflict);
        let claims: Vec<_> = before.unverified_files.iter().filter(|v| v.file_name != "slot-03.json")
            .map(|v| LegacyClaim { file_name: v.file_name.clone(), source_sha256: v.source_sha256.clone() }).collect();
        assert!(migrate_with_claims(&location, "game-a", false, &claims).is_err());
        let result = migrate_with_claims(&location, "game-a", true, &claims).unwrap();
        assert_eq!(result.copied_files.len(), 3);
        for (file, bytes) in &originals {
            assert_eq!(fs::read(legacy.join(file)).unwrap(), *bytes);
            if *file == "slot-02.json" || *file == "slot-03.json" { continue; }
            let mut expected: serde_json::Value = serde_json::from_slice(bytes).unwrap();
            expected["game_id"] = "game-a".into();
            assert_eq!(serde_json::from_slice::<serde_json::Value>(&fs::read(target.join(file)).unwrap()).unwrap(), expected);
        }
        assert_eq!(fs::read(target.join("slot-02.json")).unwrap(), b"new progress");
        assert!(!target.join("slot-03.json").exists());
        let retry = migrate_with_claims(&location, "game-a", true, &claims).unwrap();
        assert!(retry.copied_files.is_empty());
        assert_eq!(retry.conflict_files, ["slot-02.json"]);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn wrong_identity_changed_bytes_duplicates_and_path_traversal_are_rejected_before_writes() {
        let root = std::env::temp_dir().join(format!("agentvn-legacy-deny-{}", std::process::id()));
        let legacy = root.join("旧存档/preview_gamecli");
        let target = root.join("游戏/saves/game-a/preview_gamecli");
        fs::create_dir_all(&legacy).unwrap();
        for (name, game, install) in [("slot-01.json", "preview_gamecli", "preview_gamecli"),
            ("slot-02.json", "other-game", "preview_gamecli"),
            ("slot-03.json", "preview_gamecli", "another-install")] {
            fs::write(legacy.join(name), serde_json::to_vec(&serde_json::json!({
                "game_id": game, "install_id": install, "slot": name[6..7].parse::<u8>().unwrap(),
                "scene_id": "main", "command_index": 0
            })).unwrap()).unwrap();
        }
        let location = SaveLocation { target: target.clone(), legacy: Some(legacy.clone()) };
        let before = inspect(&location, "game-a").unwrap();
        assert_eq!(before.unverified_files.len(), 1);
        assert_eq!(before.skipped_files, ["slot-02.json", "slot-03.json"]);
        let candidate = &before.unverified_files[0];
        let claim = LegacyClaim { file_name: candidate.file_name.clone(), source_sha256: candidate.source_sha256.clone() };
        for bad in [
            LegacyClaim { file_name: "../slot-01.json".into(), source_sha256: claim.source_sha256.clone() },
            LegacyClaim { file_name: "C:slot-01.json".into(), source_sha256: claim.source_sha256.clone() },
            LegacyClaim { file_name: "slot-01.json:stream".into(), source_sha256: claim.source_sha256.clone() },
            LegacyClaim { file_name: "slot-01.json".into(), source_sha256: "0".repeat(64) },
            LegacyClaim { file_name: "slot-02.json".into(), source_sha256: source_hash(&fs::read(legacy.join("slot-02.json")).unwrap()) },
        ] { assert!(migrate_with_claims(&location, "game-a", true, &[bad]).is_err()); }
        assert!(migrate_with_claims(&location, "game-a", true, &[claim.clone(), claim.clone()]).is_err());
        let mut changed = fs::read(legacy.join("slot-01.json")).unwrap();
        changed.push(b' ');
        fs::write(legacy.join("slot-01.json"), changed).unwrap();
        assert!(migrate_with_claims(&location, "game-a", true, &[claim]).is_err());
        assert!(!target.exists());
        fs::remove_dir_all(root).unwrap();
    }

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
