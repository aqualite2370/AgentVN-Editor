use std::{
    fs::{self, File},
    io::{Read, Write},
    path::{Component, Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

use zip::{write::SimpleFileOptions, CompressionMethod, ZipWriter};

const MAX_ENTRIES: usize = 4096;
const MAX_TOTAL_BYTES: u64 = 128 * 1024 * 1024;
const MAX_FILE_BYTES: u64 = 24 * 1024 * 1024;
const MAX_GUI_BYTES: u64 = 2 * 1024 * 1024;
const MAX_ARCHIVE_BYTES: u64 = 160 * 1024 * 1024;
const MAX_READ_CHUNK_BYTES: usize = 4 * 1024 * 1024;
const GUI_IMPORT_PREFIX: &str = "gui-import-";
static NEXT_ARCHIVE_ID: AtomicU64 = AtomicU64::new(0);

#[derive(Debug)]
struct SourceFile {
    absolute: PathBuf,
    relative: String,
    size: u64,
}

fn is_link_or_reparse(metadata: &fs::Metadata) -> bool {
    if metadata.file_type().is_symlink() {
        return true;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
        return metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0;
    }
    #[cfg(not(windows))]
    false
}

fn collect_files(root: &Path, current: &Path, files: &mut Vec<SourceFile>, total: &mut u64) -> Result<(), String> {
    let entries = fs::read_dir(current)
        .map_err(|error| format!("无法读取 GUI 目录 {}：{error}", current.display()))?;
    for entry in entries {
        let entry = entry.map_err(|error| format!("无法读取 GUI 目录条目：{error}"))?;
        let path = entry.path();
        let metadata = fs::symlink_metadata(&path)
            .map_err(|error| format!("无法读取 GUI 文件信息 {}：{error}", path.display()))?;
        if is_link_or_reparse(&metadata) {
            return Err(format!("GUI_IMPORT_SYMLINK: 拒绝符号链接或重解析点 {}", path.display()));
        }
        let resolved = path.canonicalize()
            .map_err(|error| format!("无法规范化 GUI 路径 {}：{error}", path.display()))?;
        if !resolved.starts_with(root) {
            return Err(format!("GUI_IMPORT_PATH_ESCAPE: {}", path.display()));
        }
        if metadata.is_dir() {
            collect_files(root, &resolved, files, total)?;
            continue;
        }
        if !metadata.is_file() {
            return Err(format!("GUI_IMPORT_UNSUPPORTED_ENTRY: {}", path.display()));
        }
        let relative = resolved.strip_prefix(root)
            .map_err(|_| format!("GUI_IMPORT_PATH_ESCAPE: {}", path.display()))?;
        if relative.components().any(|component| {
            matches!(component, Component::ParentDir | Component::RootDir | Component::Prefix(_))
        }) {
            return Err(format!("GUI_IMPORT_PATH_ESCAPE: {}", path.display()));
        }
        let relative = relative.to_str()
            .ok_or_else(|| format!("GUI_IMPORT_INVALID_FILENAME: {}", path.display()))?
            .replace('\\', "/");
        if relative.is_empty() || relative.contains('\0') {
            return Err("GUI_IMPORT_INVALID_FILENAME: empty or NUL path".to_string());
        }
        if files.len() >= MAX_ENTRIES {
            return Err(format!("GUI_IMPORT_LIMIT: 文件数超过 {MAX_ENTRIES}。"));
        }
        if metadata.len() > MAX_FILE_BYTES {
            return Err(format!("GUI_IMPORT_LIMIT: 单文件超过 24 MiB：{relative}"));
        }
        if relative.rsplit('/').next().is_some_and(|name| name.eq_ignore_ascii_case("gui.rpy"))
            && metadata.len() > MAX_GUI_BYTES
        {
            return Err(format!("GUI_IMPORT_LIMIT: gui.rpy 超过 2 MiB：{relative}"));
        }
        *total = total.saturating_add(metadata.len());
        if *total > MAX_TOTAL_BYTES {
            return Err("GUI_IMPORT_LIMIT: 目录总文件体积超过 128 MiB。".to_string());
        }
        files.push(SourceFile { absolute: resolved, relative, size: metadata.len() });
    }
    Ok(())
}

fn cache_directory(cache_root: &Path) -> Result<PathBuf, String> {
    let directory = cache_root.join("renpy-gui-import");
    fs::create_dir_all(&directory)
        .map_err(|error| format!("无法创建 GUI 导入暂存目录：{error}"))?;
    directory.canonicalize()
        .map_err(|error| format!("无法规范化 GUI 导入暂存目录：{error}"))
}

pub fn stage_directory_as_zip(source_directory: &Path, cache_root: &Path) -> Result<PathBuf, String> {
    let source_metadata = fs::symlink_metadata(source_directory)
        .map_err(|error| format!("无法读取所选 GUI 目录：{error}"))?;
    if is_link_or_reparse(&source_metadata) || !source_metadata.is_dir() {
        return Err("GUI_IMPORT_ROOT_INVALID: 所选路径不是普通目录，或它是符号链接。".to_string());
    }
    let root = source_directory.canonicalize()
        .map_err(|error| format!("无法解析所选 GUI 目录：{error}"))?;
    let mut files = Vec::new();
    let mut total = 0;
    collect_files(&root, &root, &mut files, &mut total)?;

    let staging_directory = cache_directory(cache_root)?;
    let nonce = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos();
    let sequence = NEXT_ARCHIVE_ID.fetch_add(1, Ordering::Relaxed);
    let output_path = staging_directory.join(format!(
        "{GUI_IMPORT_PREFIX}{}-{nonce}-{sequence}.zip",
        std::process::id()
    ));
    let output_file = OpenOptionsCreateNew::create(&output_path)?;
    let mut zip = ZipWriter::new(output_file);
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
    let result = (|| -> Result<(), String> {
        for source in files {
            let current_size = fs::metadata(&source.absolute)
                .map_err(|error| format!("无法复核 GUI 文件 {}：{error}", source.relative))?;
            if current_size.len() != source.size || current_size.len() > MAX_FILE_BYTES {
                return Err(format!("GUI_IMPORT_CHANGED_DURING_SCAN: {}", source.relative));
            }
            zip.start_file(&source.relative, options)
                .map_err(|error| format!("无法打包 GUI 文件 {}：{error}", source.relative))?;
            let mut file = open_regular_file_without_following_links(&source.absolute)
                .map_err(|error| format!("无法打开 GUI 文件 {}：{error}", source.relative))?;
            let opened_metadata = file.metadata()
                .map_err(|error| format!("无法复核打开的 GUI 文件 {}：{error}", source.relative))?;
            if is_link_or_reparse(&opened_metadata) || !opened_metadata.is_file() {
                return Err(format!("GUI_IMPORT_SYMLINK: 拒绝链接或非普通文件 {}", source.relative));
            }
            let mut copied = 0_u64;
            let mut buffer = [0_u8; 64 * 1024];
            loop {
                let read = file.read(&mut buffer)
                    .map_err(|error| format!("读取 GUI 文件失败 {}：{error}", source.relative))?;
                if read == 0 { break; }
                copied += read as u64;
                if copied > source.size || copied > MAX_FILE_BYTES {
                    return Err(format!("GUI_IMPORT_CHANGED_DURING_SCAN: {}", source.relative));
                }
                zip.write_all(&buffer[..read])
                    .map_err(|error| format!("写入 GUI 暂存包失败：{error}"))?;
            }
            if copied != source.size {
                return Err(format!("GUI_IMPORT_CHANGED_DURING_SCAN: {}", source.relative));
            }
        }
        let file = zip.finish().map_err(|error| format!("完成 GUI 暂存包失败：{error}"))?;
        file.sync_all().map_err(|error| format!("同步 GUI 暂存包失败：{error}"))?;
        if file.metadata().map_err(|error| error.to_string())?.len() > MAX_ARCHIVE_BYTES {
            return Err("GUI_IMPORT_LIMIT: 暂存 ZIP 超过 160 MiB。".to_string());
        }
        Ok(())
    })();
    if let Err(error) = result {
        let _ = fs::remove_file(&output_path);
        return Err(error);
    }
    Ok(output_path)
}

fn open_regular_file_without_following_links(path: &Path) -> std::io::Result<File> {
    let mut options = fs::OpenOptions::new();
    options.read(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
        options.custom_flags(FILE_FLAG_OPEN_REPARSE_POINT);
    }
    #[cfg(target_os = "linux")]
    {
        use std::os::unix::fs::OpenOptionsExt;
        const O_NOFOLLOW: i32 = 0x2_0000;
        options.custom_flags(O_NOFOLLOW);
    }
    #[cfg(target_os = "macos")]
    {
        use std::os::unix::fs::OpenOptionsExt;
        const O_NOFOLLOW: i32 = 0x100;
        options.custom_flags(O_NOFOLLOW);
    }
    options.open(path)
}

struct OpenOptionsCreateNew;
impl OpenOptionsCreateNew {
    fn create(path: &Path) -> Result<File, String> {
        fs::OpenOptions::new().write(true).read(true).create_new(true).open(path)
            .map_err(|error| format!("无法创建 GUI 暂存包：{error}"))
    }
}

fn validated_staged_path(cache_root: &Path, requested: &Path) -> Result<PathBuf, String> {
    let staging = cache_directory(cache_root)?;
    let name = requested.file_name().and_then(|value| value.to_str())
        .ok_or_else(|| "GUI_IMPORT_STAGING_PATH_INVALID".to_string())?;
    if !name.starts_with(GUI_IMPORT_PREFIX) || !name.ends_with(".zip") {
        return Err("GUI_IMPORT_STAGING_PATH_INVALID".to_string());
    }
    let candidate = staging.join(name);
    let canonical = candidate.canonicalize()
        .map_err(|error| format!("GUI_IMPORT_STAGING_FILE_MISSING: {error}"))?;
    if canonical.parent() != Some(staging.as_path()) || canonical != requested.canonicalize()
        .map_err(|error| format!("GUI_IMPORT_STAGING_PATH_INVALID: {error}"))?
    {
        return Err("GUI_IMPORT_STAGING_PATH_INVALID".to_string());
    }
    let metadata = fs::symlink_metadata(&canonical).map_err(|error| error.to_string())?;
    if is_link_or_reparse(&metadata) || !metadata.is_file() || metadata.len() > MAX_ARCHIVE_BYTES {
        return Err("GUI_IMPORT_STAGING_FILE_INVALID".to_string());
    }
    Ok(canonical)
}

pub fn staged_archive_size(cache_root: &Path, requested: &Path) -> Result<u64, String> {
    let path = validated_staged_path(cache_root, requested)?;
    fs::metadata(path).map(|metadata| metadata.len())
        .map_err(|error| format!("读取 GUI 暂存包大小失败：{error}"))
}

pub fn read_staged_archive_chunk(
    cache_root: &Path,
    requested: &Path,
    offset: u64,
    length: usize,
) -> Result<Vec<u8>, String> {
    use std::io::{Seek, SeekFrom};
    if length == 0 || length > MAX_READ_CHUNK_BYTES {
        return Err("GUI_IMPORT_CHUNK_INVALID: 分块大小必须在 1–4 MiB 之间。".to_string());
    }
    let path = validated_staged_path(cache_root, requested)?;
    let mut file = File::open(path).map_err(|error| format!("打开 GUI 暂存包失败：{error}"))?;
    let size = file.metadata().map_err(|error| error.to_string())?.len();
    let end = offset.checked_add(length as u64)
        .ok_or_else(|| "GUI_IMPORT_CHUNK_INVALID: offset overflow".to_string())?;
    if offset > size || end > size {
        return Err("GUI_IMPORT_CHUNK_INVALID: 读取范围超出暂存包。".to_string());
    }
    file.seek(SeekFrom::Start(offset)).map_err(|error| format!("定位 GUI 暂存包失败：{error}"))?;
    let mut bytes = vec![0; length];
    file.read_exact(&mut bytes).map_err(|error| format!("读取 GUI 暂存包分块失败：{error}"))?;
    Ok(bytes)
}

pub fn remove_staged_archive(cache_root: &Path, requested: &Path) -> Result<(), String> {
    let path = validated_staged_path(cache_root, requested)?;
    fs::remove_file(path).map_err(|error| format!("清理 GUI 暂存包失败：{error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn unique_temp(label: &str) -> PathBuf {
        let nonce = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        std::env::temp_dir().join(format!("agentvn-{label}-{}-{nonce}", std::process::id()))
    }

    #[test]
    fn selected_directory_is_staged_with_unicode_relative_paths_and_cleaned() {
        let root = unique_temp("renpy-gui-source");
        let cache = unique_temp("renpy-gui-cache");
        fs::create_dir_all(root.join("gui/按钮")).unwrap();
        fs::write(root.join("gui.rpy"), "define gui.interface_text_size = 24").unwrap();
        fs::write(root.join("gui/按钮/普通.png"), b"image bytes").unwrap();
        let staged = stage_directory_as_zip(&root, &cache).unwrap();
        let size = staged_archive_size(&cache, &staged).unwrap();
        let archive = read_staged_archive_chunk(&cache, &staged, 0, size as usize).unwrap();
        let mut zip = zip::ZipArchive::new(std::io::Cursor::new(archive)).unwrap();
        assert_eq!(zip.by_name("gui.rpy").unwrap().size(), b"define gui.interface_text_size = 24".len() as u64);
        assert_eq!(zip.by_name("gui/按钮/普通.png").unwrap().size(), 11);
        remove_staged_archive(&cache, &staged).unwrap();
        assert!(!staged.exists());
        let _ = fs::remove_dir_all(root);
        let _ = fs::remove_dir_all(cache);
    }

    #[test]
    fn directory_import_rejects_oversized_files_before_staging() {
        let root = unique_temp("renpy-gui-large");
        let cache = unique_temp("renpy-gui-large-cache");
        fs::create_dir_all(&root).unwrap();
        let large = File::create(root.join("large.bin")).unwrap();
        large.set_len(MAX_FILE_BYTES + 1).unwrap();
        let error = stage_directory_as_zip(&root, &cache).unwrap_err();
        assert!(error.contains("GUI_IMPORT_LIMIT"));
        assert!(!cache.join("renpy-gui-import").exists());
        let _ = fs::remove_dir_all(root);
        let _ = fs::remove_dir_all(cache);
    }

    #[test]
    fn staged_archive_reads_are_bounded_and_reject_out_of_range_offsets() {
        let root = unique_temp("renpy-gui-chunks");
        let cache = unique_temp("renpy-gui-chunks-cache");
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("gui.rpy"), b"1234567890").unwrap();
        let staged = stage_directory_as_zip(&root, &cache).unwrap();
        let size = staged_archive_size(&cache, &staged).unwrap();
        let first = read_staged_archive_chunk(&cache, &staged, 0, 8).unwrap();
        let second = read_staged_archive_chunk(&cache, &staged, 8, (size - 8) as usize).unwrap();
        assert_eq!(first.len() + second.len(), size as usize);
        assert!(read_staged_archive_chunk(&cache, &staged, 0, MAX_READ_CHUNK_BYTES + 1)
            .unwrap_err().contains("GUI_IMPORT_CHUNK_INVALID"));
        assert!(read_staged_archive_chunk(&cache, &staged, size, 1)
            .unwrap_err().contains("GUI_IMPORT_CHUNK_INVALID"));
        remove_staged_archive(&cache, &staged).unwrap();
        let _ = fs::remove_dir_all(root);
        let _ = fs::remove_dir_all(cache);
    }

    #[test]
    fn staged_archive_reader_rejects_paths_outside_private_cache() {
        let root = unique_temp("renpy-gui-cache-boundary");
        let outside = unique_temp("renpy-gui-outside.zip");
        fs::create_dir_all(&root).unwrap();
        fs::write(&outside, b"not ours").unwrap();
        assert!(staged_archive_size(&root, &outside).unwrap_err().contains("GUI_IMPORT_STAGING"));
        let _ = fs::remove_file(outside);
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn directory_import_rejects_symlink_entries_without_following_them() {
        use std::os::unix::fs::symlink;
        let root = unique_temp("renpy-gui-symlink");
        let outside = unique_temp("renpy-gui-symlink-target");
        let cache = unique_temp("renpy-gui-symlink-cache");
        fs::create_dir_all(&root).unwrap();
        fs::write(&outside, b"outside").unwrap();
        symlink(&outside, root.join("escape.png")).unwrap();
        let error = stage_directory_as_zip(&root, &cache).unwrap_err();
        assert!(error.contains("GUI_IMPORT_SYMLINK"));
        assert!(!cache.join("renpy-gui-import").exists());
        let _ = fs::remove_file(root.join("escape.png"));
        let _ = fs::remove_file(outside);
        let _ = fs::remove_dir_all(root);
        let _ = fs::remove_dir_all(cache);
    }

    #[cfg(windows)]
    #[test]
    fn directory_import_rejects_junction_entries_without_following_them() {
        use std::process::Command;

        let root = unique_temp("renpy-gui-junction");
        let outside = unique_temp("renpy-gui-junction-target");
        let cache = unique_temp("renpy-gui-junction-cache");
        fs::create_dir_all(&root).unwrap();
        fs::create_dir_all(&outside).unwrap();
        fs::write(outside.join("outside.png"), b"outside").unwrap();
        let junction = root.join("linked-assets");
        let output = Command::new("cmd.exe")
            .args(["/D", "/C", "mklink", "/J"])
            .arg(&junction)
            .arg(&outside)
            .output()
            .unwrap();
        if !output.status.success() {
            let _ = fs::remove_dir_all(&root);
            let _ = fs::remove_dir_all(&outside);
            let _ = fs::remove_dir_all(&cache);
            panic!(
                "could not create a temporary Windows junction for the safety test: {}",
                String::from_utf8_lossy(&output.stderr)
            );
        }

        let error = stage_directory_as_zip(&root, &cache).unwrap_err();
        assert!(error.contains("GUI_IMPORT_SYMLINK"));
        assert!(!cache.join("renpy-gui-import").exists());
        fs::remove_dir(&junction).unwrap();
        let _ = fs::remove_dir_all(root);
        let _ = fs::remove_dir_all(outside);
        let _ = fs::remove_dir_all(cache);
    }
}
