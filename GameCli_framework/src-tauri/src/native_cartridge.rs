//! Native archives are verified and streamed to a private lifetime-bound
//! directory. Keeping every asset in a WebView Blob exhausts its separate
//! storage budget even when there is plenty of system RAM and disk space.
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};
use zip::ZipArchive;

const MAX_FILE: u64 = 512 * 1024 * 1024;
const MAX_PACKAGE: u64 = 2048 * 1024 * 1024;
const MAX_ENTRIES: usize = 20_000;

pub struct VerifiedCartridge {
    pub directory: ResourceDirectory,
}

pub struct ResourceDirectory { path: PathBuf }
impl ResourceDirectory {
    pub fn path(&self) -> &Path { &self.path }
    fn new_in(parent: &Path) -> Result<Self, String> {
        static SEQUENCE: AtomicU64 = AtomicU64::new(0);
        let instant = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|e| e.to_string())?.as_nanos();
        for _ in 0..32 {
            let path = parent.join(format!("agentvn-cartridge-{}-{instant}-{}", std::process::id(), SEQUENCE.fetch_add(1, Ordering::Relaxed)));
            match fs::create_dir(&path) {
                Ok(()) => return Ok(Self { path }),
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(e) => return Err(format!("Cannot prepare cartridge resources: {e}")),
            }
        }
        Err("Cannot allocate private cartridge directory.".into())
    }
}
impl Drop for ResourceDirectory {
    fn drop(&mut self) {
        // Only this exact directory was created by us; archive links and path
        // traversal are rejected before any write.
        if let Err(error) = fs::remove_dir_all(&self.path) {
            eprintln!("[AgentVN Player] Cannot retire cartridge resources {}: {error}", self.path.display());
        }
    }
}

fn safe_path(name: &str) -> Result<(), String> {
    if name.is_empty() || name.contains(['\\', ':', '\0']) || name.starts_with('~')
        || name.split('/').any(|part| part.is_empty() || part == "." || part == "..")
        || Path::new(name).components().any(|part| !matches!(part, Component::Normal(_)))
    {
        return Err(format!("Unsafe cartridge path: {name}"));
    }
    let extension = Path::new(name).extension().and_then(|s| s.to_str()).unwrap_or("").to_ascii_lowercase();
    if ["exe", "dll", "bat", "cmd", "sh", "ps1", "msi", "app", "apk", "jar", "vbs", "js", "scr", "com"].contains(&extension.as_str()) {
        return Err(format!("Executable cartridge entry: {name}"));
    }
    Ok(())
}

fn extract(source: &Path, parent: &Path) -> Result<VerifiedCartridge, String> {
    let file = File::open(source).map_err(|e| format!("Cannot open cartridge: {e}"))?;
    if file.metadata().map_err(|e| e.to_string())?.len() > MAX_PACKAGE {
        return Err("Cartridge exceeds 2048MB.".into());
    }
    let mut zip = ZipArchive::new(file).map_err(|e| format!("Invalid cartridge ZIP: {e}"))?;
    if zip.len() > MAX_ENTRIES { return Err("Cartridge has too many ZIP entries.".into()); }
    let mut names = HashSet::new();
    let mut total = 0u64;
    // Validate the entire directory before writing any entry. A private random
    // directory and create_new prevent following archive-created links/files.
    for index in 0..zip.len() {
        let entry = zip.by_index(index).map_err(|e| e.to_string())?;
        let name = entry.name().trim_end_matches('/');
        safe_path(name)?;
        if !names.insert(name.to_lowercase()) { return Err(format!("Duplicate cartridge path: {name}")); }
        if entry.unix_mode().is_some_and(|mode| mode & 0o170000 == 0o120000) {
            return Err(format!("Cartridge links are not permitted: {name}"));
        }
        total = total.checked_add(entry.size()).ok_or("Cartridge size overflow")?;
        if entry.size() > MAX_FILE || total > MAX_PACKAGE { return Err("Cartridge expanded size exceeds limits.".into()); }
    }
    let directory = ResourceDirectory::new_in(parent)?;
    let mut actual = HashMap::new();
    let mut buffer = [0u8; 64 * 1024];
    for index in 0..zip.len() {
        let mut entry = zip.by_index(index).map_err(|e| e.to_string())?;
        if entry.is_dir() { continue; }
        let name = entry.name().to_string();
        let target = directory.path().join(&name);
        fs::create_dir_all(target.parent().ok_or("Missing cartridge parent")?).map_err(|e| e.to_string())?;
        let mut output = File::create_new(&target).map_err(|e| e.to_string())?;
        let mut hash = Sha256::new();
        let mut length = 0u64;
        loop {
            let count = entry.read(&mut buffer).map_err(|e| format!("Cannot read cartridge entry {name}: {e}"))?;
            if count == 0 { break; }
            length += count as u64;
            if length > entry.size() || length > MAX_FILE { return Err(format!("Cartridge entry exceeds declared size: {name}")); }
            hash.update(&buffer[..count]);
            output.write_all(&buffer[..count]).map_err(|e| format!("Cannot write cartridge resource {name}: {e}"))?;
        }
        if length != entry.size() { return Err(format!("Cartridge entry is truncated: {name}")); }
        actual.insert(name, (length, format!("{:x}", hash.finalize())));
    }
    for required in ["manifest.json", "script.json", "checksum.json"] {
        if !actual.contains_key(required) { return Err(format!("Cartridge is missing {required}")); }
    }
    let checksum: Value = serde_json::from_reader(File::open(directory.path().join("checksum.json")).map_err(|e| e.to_string())?)
        .map_err(|e| format!("Invalid cartridge checksum: {e}"))?;
    if checksum["algorithm"].as_str() != Some("sha256") { return Err("Unsupported cartridge checksum algorithm.".into()); }
    let entries = checksum["files"].as_array().ok_or("Cartridge checksum files must be an array")?;
    let mut seen = HashSet::new();
    for entry in entries {
        let name = entry["path"].as_str().ok_or("Cartridge checksum path is missing")?;
        safe_path(name)?;
        if !seen.insert(name) { return Err(format!("Duplicate checksum entry: {name}")); }
        let (length, digest) = actual.get(name).ok_or_else(|| format!("Checksum references missing cartridge file: {name}"))?;
        if entry["size_bytes"].as_u64() != Some(*length) || entry["hash_sha256"].as_str() != Some(digest) {
            return Err(format!("Cartridge checksum mismatch: {name}"));
        }
    }
    Ok(VerifiedCartridge { directory })
}

pub fn open(source: &Path) -> Result<VerifiedCartridge, String> {
    extract(source, &std::env::temp_dir())
}

#[cfg(test)]
mod tests {
    use super::*;
    use zip::write::SimpleFileOptions;
    use zip::{CompressionMethod, ZipWriter};
    fn fixture(root: &Path, extra: &[(&str, &[u8])], bad_hash: bool) -> std::path::PathBuf {
        let path = root.join("中文 卡带.vncart");
        let mut zip = ZipWriter::new(File::create(&path).unwrap());
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
        let mut entries = Vec::new();
        for (name, bytes) in [("manifest.json", b"{}".as_slice()), ("script.json", b"{}".as_slice())].into_iter().chain(extra.iter().copied()) {
            zip.start_file(name, options).unwrap(); zip.write_all(bytes).unwrap();
            entries.push(serde_json::json!({"path":name,"size_bytes":bytes.len(),"hash_sha256":if bad_hash {"bad".to_string()} else {format!("{:x}", Sha256::digest(bytes))}}));
        }
        zip.start_file("checksum.json", options).unwrap();
        zip.write_all(serde_json::to_string(&serde_json::json!({"algorithm":"sha256","files":entries})).unwrap().as_bytes()).unwrap();
        zip.finish().unwrap(); path
    }
    #[test]
    fn native_cartridge_streams_bytes_and_retires_directory() {
        let root = ResourceDirectory::new_in(&std::env::temp_dir()).unwrap();
        let bytes: Vec<u8> = (0..131_073).map(|i| (i % 251) as u8).collect();
        let source = fixture(root.path(), &[("assets/中文 图片.png", &bytes)], false);
        let loaded = extract(&source, root.path()).unwrap(); let temp = loaded.directory.path().to_path_buf();
        assert_eq!(fs::read(temp.join("assets/中文 图片.png")).unwrap(), bytes);
        drop(loaded); assert!(!temp.exists()); assert!(source.exists());
    }
    #[test]
    fn native_cartridge_rejects_damage_without_leaving_partial_resources() {
        let root = ResourceDirectory::new_in(&std::env::temp_dir()).unwrap(); let source = fixture(root.path(), &[], true);
        assert!(matches!(extract(&source, root.path()), Err(e) if e.contains("checksum mismatch")));
        assert_eq!(fs::read_dir(root.path()).unwrap().count(), 1);
    }
    #[test]
    fn native_cartridge_rejects_traversal_executables_and_case_collisions() {
        for name in ["../escape.png", "assets/../../escape.png", "/root.png", "C:/root.png", "a\\b.png", "a/./b.png", "script.js"] {
            assert!(safe_path(name).is_err(), "{name}");
        }
        let root = ResourceDirectory::new_in(&std::env::temp_dir()).unwrap();
        let source = fixture(root.path(), &[("assets/A.png", b"A"), ("assets/a.png", b"a")], false);
        assert!(matches!(extract(&source, root.path()), Err(e) if e.contains("Duplicate")));
        assert_eq!(fs::read_dir(root.path()).unwrap().count(), 1);
    }
    #[test]
    #[ignore = "requires the retained user-approved large cartridge; never generate a substitute"]
    fn native_cartridge_actual_retained_large_archive() {
        let source = std::env::var_os("AGENTVN_TEST_RETAINED_CARTRIDGE").expect("retained cartridge path required");
        let loaded = open(Path::new(&source)).unwrap();
        let bytes = fs::read(loaded.directory.path().join("assets/background/雨夜狼cg-雨夜狼cg.png")).unwrap();
        assert_eq!(bytes.len(), 4_483_547);
        assert_eq!(format!("{:x}", Sha256::digest(&bytes)), "c312fec28ebcfed040c5332c0facc1ec509c9cc7b3507d1f4367782ac73595d1");
        let temp = loaded.directory.path().to_owned(); drop(loaded); assert!(!temp.exists());
    }
}
