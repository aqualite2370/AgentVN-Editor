use std::{fmt::Display, fs::File, path::Path};

pub(crate) fn directory_write_error(directory: &Path, stage: &str, error: impl Display) -> String {
    format!(
        "PROJECT_EXPORT_DIRECTORY_WRITE_FAILED: 无法将工程包写入保存目录「{}」（{}）：{}。请检查目录写入权限与可用空间，恢复后重试，或在选项的项目设置中重新选择保存目录；不会改存到其他目录。",
        directory.display(), stage, error
    )
}

pub(crate) fn create_temporary(directory: &Path, path: &Path) -> Result<File, String> {
    File::create(path)
        .map_err(|error| directory_write_error(directory, "创建工程包临时文件", error))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs, io::Write, time::{SystemTime, UNIX_EPOCH}};

    fn owned_directory() -> std::path::PathBuf {
        let path = std::env::temp_dir().join(format!("agentvn-output-{}-{}",
            std::process::id(), SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));
        fs::create_dir(&path).unwrap();
        path
    }

    #[test]
    fn real_create_failure_identifies_directory_stage_original_error_and_recovery() {
        let directory = owned_directory();
        // An existing directory cannot be opened as a File; no injected IO result.
        let original = File::create(&directory).unwrap_err().to_string();
        let message = create_temporary(&directory, &directory).unwrap_err();
        assert!(message.starts_with("PROJECT_EXPORT_DIRECTORY_WRITE_FAILED:"));
        assert!(message.contains(&directory.display().to_string()));
        assert!(message.contains("创建工程包临时文件") && message.contains(&original));
        assert!(message.contains("权限") && message.contains("空间") && message.contains("重新选择"));
        assert!(!message.contains("素材库"));
        assert_eq!(fs::read_dir(&directory).unwrap().count(), 0);
        fs::remove_dir(&directory).unwrap();
    }

    #[test]
    fn missing_parent_failure_preserves_io_reason_and_creates_nothing_else() {
        let directory = owned_directory();
        let missing = directory.join("missing");
        let temporary = missing.join("test.vnproj.tmp");
        let original = File::create(&temporary).unwrap_err().to_string();
        let message = create_temporary(&missing, &temporary).unwrap_err();
        assert!(message.contains(&missing.display().to_string()) && message.contains(&original));
        assert_eq!(fs::read_dir(&directory).unwrap().count(), 0);
        fs::remove_dir(&directory).unwrap();
    }

    #[test]
    fn normal_write_retains_bytes_and_does_not_change_existing_package() {
        let directory = owned_directory();
        let old = directory.join("old.vnproj");
        let temporary = directory.join("new.vnproj.tmp");
        fs::write(&old, b"old package").unwrap();
        let mut file = create_temporary(&directory, &temporary).unwrap();
        file.write_all(b"new package").unwrap();
        file.sync_all().unwrap();
        drop(file);
        assert_eq!(fs::read(&temporary).unwrap(), b"new package");
        assert_eq!(fs::read(&old).unwrap(), b"old package");
        fs::remove_file(&temporary).unwrap();
        fs::remove_file(&old).unwrap();
        fs::remove_dir(&directory).unwrap();
    }
}
