//! Save roots are separate from the shared cartridge library and gallery roots.
use std::path::{Path, PathBuf};

#[derive(Debug, PartialEq)]
pub struct SaveLocation {
    pub target: PathBuf,
    pub legacy: Option<PathBuf>,
}

pub fn resolve(
    app_data: &Path,
    exe: &Path,
    windows_fixed_game: Option<&str>,
    install_id: &str,
) -> Result<SaveLocation, String> {
    validate_segment(install_id)?;
    let old = app_data.join("saves").join(install_id);
    if let Some(game_id) = windows_fixed_game {
        validate_segment(game_id)?;
        let parent = exe.parent().filter(|path| !path.as_os_str().is_empty())
            .ok_or("无法确定游戏EXE所在目录；不会回退到其他存档位置。")?;
        let target = parent.join("saves").join(game_id).join(install_id);
        for entry in [parent.join("saves"), parent.join("saves").join(game_id), target.clone()] {
            reject_link(&entry)?;
        }
        Ok(SaveLocation {
            target,
            legacy: Some(old),
        })
    } else {
        Ok(SaveLocation { target: old, legacy: None })
    }
}

pub fn reject_link(path: &Path) -> Result<(), String> {
    let metadata = match std::fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(format!("无法检查存档路径 {}：{e}", path.display())),
    };
    #[cfg(windows)]
    let is_link = {
        use std::os::windows::fs::MetadataExt;
        metadata.file_attributes() & 0x400 != 0
    };
    #[cfg(not(windows))]
    let is_link = metadata.file_type().is_symlink();
    if is_link {
        return Err(format!("存档路径 {} 是链接或重解析点，不能安全保存或迁移；不会回退到其他位置。", path.display()));
    }
    Ok(())
}

fn validate_segment(value: &str) -> Result<(), String> {
    let stem = value.split('.').next().unwrap_or("").to_ascii_uppercase();
    if value.is_empty() || value.len() > 240 || value == "." || value == ".."
        || value.ends_with(['.', ' '])
        || value.chars().any(|c| c.is_control() || "/\\:*?\"<>|".contains(c))
        || matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || (stem.len() == 4 && (stem.starts_with("COM") || stem.starts_with("LPT"))
            && stem.ends_with(['1','2','3','4','5','6','7','8','9']))
    {
        return Err("存档身份包含不安全的路径字符。".to_string());
    }
    Ok(())
}

/// A migration never invokes the normal overwrite-capable save writer.
pub fn copy_new_save(
    source: &Path,
    destination: &Path,
    validate: impl FnOnce(&[u8]) -> Result<(), String>,
) -> Result<bool, String> {
    copy_new_save_mapped(source, destination, |bytes| {
        validate(bytes)?;
        Ok(bytes.to_vec())
    })
}

/// Only the new copy may be adapted. Read and validate before creating a target.
pub fn copy_new_save_mapped(
    source: &Path,
    destination: &Path,
    prepare: impl FnOnce(&[u8]) -> Result<Vec<u8>, String>,
) -> Result<bool, String> {
    use std::io::{Read, Write};
    reject_link(source)?;
    reject_link(destination)?;
    let mut bytes = Vec::new();
    std::fs::File::open(source)
        .and_then(|file| file.take(32 * 1024 * 1024 + 1).read_to_end(&mut bytes))
        .map_err(|e| format!("无法读取旧存档 {}：{e}", source.display()))?;
    if bytes.len() > 32 * 1024 * 1024 {
        return Err(format!("旧存档 {} 超过32MiB安全上限，未迁移。", source.display()));
    }
    let bytes = prepare(&bytes)?;
    let mut file = match std::fs::OpenOptions::new().write(true).create_new(true).open(destination) {
        Ok(file) => file,
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => return Ok(false),
        Err(e) => return Err(format!("无法创建迁移存档 {}：{e}；不会回退到其他位置。", destination.display())),
    };
    let result = file.write_all(&bytes).and_then(|_| file.sync_all());
    drop(file);
    if let Err(error) = result {
        let cleanup = std::fs::remove_file(destination).err();
        return Err(format!("迁移写入失败 {}：{error}；不完整文件清理：{cleanup:?}", destination.display()));
    }
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn windows_fixed_game_saves_beside_exe_not_working_directory_or_appdata() {
        let location = resolve(
            Path::new("隔离数据"), Path::new("安装目录/游戏.exe"), Some("game-a"), "preview_gamecli",
        ).unwrap();
        assert_eq!(location.target, Path::new("安装目录/saves/game-a/preview_gamecli"));
        assert_eq!(location.legacy, Some(PathBuf::from("隔离数据/saves/preview_gamecli")));
    }

    #[test]
    fn non_fixed_storage_unchanged_and_unsafe_ids_rejected() {
        let old = resolve(Path::new("appdata"), Path::new("ignored"), None, "install_123").unwrap();
        assert_eq!(old.target, Path::new("appdata/saves/install_123"));
        assert!(old.legacy.is_none());
        for bad in ["../other", "..", "a\\b", "C:", "CON", "nul.json", "game."] {
            assert!(resolve(Path::new("data"), Path::new("bin/game.exe"), Some(bad), "preview_gamecli").is_err(), "{bad}");
            assert!(resolve(Path::new("data"), Path::new("bin/game.exe"), None, bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn existing_link_cannot_redirect_portable_saves() {
        let root = std::env::temp_dir().join(format!("agentvn-save-link-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let outside = root.join("outside");
        std::fs::create_dir_all(&outside).unwrap();
        // Junctions do not require Windows symlink privileges.
        #[cfg(windows)]
        {
            assert!(std::process::Command::new("cmd").args(["/c", "mklink", "/J"])
                .arg(root.join("saves")).arg(&outside).output().unwrap().status.success());
        }
        #[cfg(unix)]
        std::os::unix::fs::symlink(&outside, root.join("saves")).unwrap();
        let result = resolve(&root.join("appdata"), &root.join("game.exe"), Some("game-a"), "preview_gamecli");
        #[cfg(windows)]
        std::fs::remove_dir(root.join("saves")).unwrap();
        #[cfg(unix)]
        std::fs::remove_file(root.join("saves")).unwrap();
        std::fs::remove_dir_all(&root).unwrap();
        assert!(result.is_err(), "a save directory junction/symlink must not silently redirect writes");
    }

    #[test]
    fn migration_copies_original_bytes_without_overwriting_conflicts_or_source() {
        let root = std::env::temp_dir().join(format!("agentvn-save-copy-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let source = root.join("source.json");
        let destination = root.join("slot-01.json");
        let old = b"{\"text\":\"original bytes\"}\r\n";
        std::fs::write(&source, old).unwrap();
        assert!(copy_new_save(&source, &destination, |_| Ok(())).unwrap());
        assert_eq!(std::fs::read(&destination).unwrap(), old);
        std::fs::write(&destination, b"newer progress").unwrap();
        let copied = copy_new_save(&source, &destination, |_| Ok(())).unwrap();
        let target_bytes = std::fs::read(&destination).unwrap();
        let source_bytes = std::fs::read(&source).unwrap();
        std::fs::remove_dir_all(&root).unwrap();
        assert!(!copied, "a conflicting slot is skipped, never overwritten");
        assert_eq!(target_bytes, b"newer progress");
        assert_eq!(source_bytes, old);
    }
}
