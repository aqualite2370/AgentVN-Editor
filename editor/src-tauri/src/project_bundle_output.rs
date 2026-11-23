use std::{
    fmt::Display,
    fs::{File, OpenOptions},
    io,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

pub(crate) fn directory_write_error(directory: &Path, stage: &str, error: impl Display) -> String {
    format!(
        "PROJECT_EXPORT_DIRECTORY_WRITE_FAILED: 无法将工程包写入保存目录「{}」（{}）：{}。请检查目录写入权限与可用空间，恢复后重试，或在选项的项目设置中重新选择保存目录；不会改存到其他目录。",
        directory.display(), stage, error
    )
}

pub(crate) fn create_temporary(directory: &Path, path: &Path) -> Result<File, String> {
    OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|error| directory_write_error(directory, "创建工程包临时文件", error))
}

pub(crate) fn bundle_temporary_path(directory: &Path) -> PathBuf {
    static SEQUENCE: AtomicU64 = AtomicU64::new(0);
    let instant = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let sequence = SEQUENCE.fetch_add(1, Ordering::Relaxed);
    directory.join(format!(
        ".agentvn-project-{}-{instant}-{sequence}.vnproj.tmp",
        std::process::id()
    ))
}

pub(crate) fn commit_temporary(
    directory: &Path,
    requested_name: &str,
    move_no_replace: impl Fn(&Path) -> io::Result<()>,
) -> Result<PathBuf, String> {
    let stem = requested_name
        .strip_suffix(".vnproj")
        .unwrap_or(requested_name);
    for sequence in 0..10_000 {
        let name = if sequence == 0 {
            requested_name.to_string()
        } else {
            format!("{stem}-{sequence}.vnproj")
        };
        let path = directory.join(name);
        match move_no_replace(&path) {
            Ok(()) => return Ok(path),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => {
                return Err(directory_write_error(
                    directory,
                    &format!("原子提交工程包 {}", path.display()),
                    error,
                ))
            }
        }
    }
    Err("PROJECT_EXPORT_NAME_COLLISION: 保存目录中同名工程包过多，请重新选择目录。".to_string())
}

#[cfg(windows)]
pub(crate) fn publish_no_replace(source: &Path, destination: &Path) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    #[link(name = "kernel32")]
    extern "system" {
        fn MoveFileExW(existing: *const u16, new: *const u16, flags: u32) -> i32;
    }

    let source: Vec<u16> = source.as_os_str().encode_wide().chain([0]).collect();
    let destination: Vec<u16> = destination.as_os_str().encode_wide().chain([0]).collect();
    const MOVEFILE_WRITE_THROUGH: u32 = 0x0000_0008; // deliberately omit REPLACE_EXISTING
    if unsafe {
        MoveFileExW(
            source.as_ptr(),
            destination.as_ptr(),
            MOVEFILE_WRITE_THROUGH,
        )
    } == 0
    {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

#[cfg(not(windows))]
pub(crate) fn publish_no_replace(source: &Path, destination: &Path) -> io::Result<()> {
    std::fs::hard_link(source, destination)?;
    // The final file is already committed; a cleanup error cannot turn it into
    // a failed export or cause another copy to be published.
    let _ = std::fs::remove_file(source);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        fs,
        io::Write,
        time::{SystemTime, UNIX_EPOCH},
    };

    fn owned_directory() -> std::path::PathBuf {
        let path = std::env::temp_dir().join(format!(
            "agentvn-output-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir(&path).unwrap();
        path
    }

    #[test]
    fn real_create_failure_identifies_directory_stage_original_error_and_recovery() {
        let directory = owned_directory();
        // An existing directory cannot be opened as a File; no injected IO result.
        let original = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&directory)
            .unwrap_err()
            .to_string();
        let message = create_temporary(&directory, &directory).unwrap_err();
        assert!(message.starts_with("PROJECT_EXPORT_DIRECTORY_WRITE_FAILED:"));
        assert!(message.contains(&directory.display().to_string()));
        assert!(message.contains("创建工程包临时文件") && message.contains(&original));
        assert!(
            message.contains("权限") && message.contains("空间") && message.contains("重新选择")
        );
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

    #[test]
    fn concurrent_writers_publish_distinct_complete_files() {
        let directory = owned_directory();
        fs::write(directory.join("same.vnproj"), b"existing").unwrap();
        let results = std::thread::scope(|scope| {
            let barrier = std::sync::Barrier::new(2);
            // Scoped thread results cannot borrow stack locals of the scope
            // closure, so share the barrier by Arc.
            let barrier = std::sync::Arc::new(barrier);
            let jobs: Vec<_> = [b"first".as_slice(), b"second".as_slice()]
                .into_iter()
                .map(|bytes| {
                    let root = &directory;
                    let barrier = barrier.clone();
                    scope.spawn(move || {
                        let temporary = bundle_temporary_path(root);
                        let mut file = create_temporary(root, &temporary).unwrap();
                        file.write_all(bytes).unwrap();
                        file.sync_all().unwrap();
                        drop(file);
                        barrier.wait();
                        let output = commit_temporary(root, "same.vnproj", |path| {
                            publish_no_replace(&temporary, path)
                        })
                        .unwrap();
                        assert!(!temporary.exists());
                        assert_eq!(fs::read(&output).unwrap(), bytes);
                        output
                    })
                })
                .collect();
            jobs.into_iter()
                .map(|job| job.join().unwrap())
                .collect::<Vec<_>>()
        });
        assert_ne!(results[0], results[1]);
        let existing = directory.join("same.vnproj");
        assert_eq!(fs::read(&existing).unwrap(), b"existing");
        for path in results.into_iter().chain([existing]) {
            fs::remove_file(path).unwrap();
        }
        fs::remove_dir(directory).unwrap();
    }
}
