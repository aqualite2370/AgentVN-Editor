use std::{
    collections::HashSet,
    fs::{self, File},
    io::{Read, Write},
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::Deserialize;
use sha2::{Digest, Sha256};
use zip::{write::SimpleFileOptions, CompressionMethod, ZipWriter};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeCartridgeTextFile {
    pub path: String,
    pub contents: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeCartridgeAsset {
    pub path: String,
    pub source_file_path: String,
}

pub fn write_cartridge(
    destination: &Path,
    text_files: &[NativeCartridgeTextFile],
    assets: &[NativeCartridgeAsset],
) -> Result<u64, String> {
    let result = write_cartridge_inner(destination, text_files, assets);
    if result.is_err() {
        let _ = fs::remove_file(destination);
    }
    result
}

fn valid_path(path: &str, asset: bool) -> bool {
    !path.is_empty()
        && path.len() <= 512
        && !path.contains(['\\', '\0'])
        && !path.starts_with('/')
        && !path
            .split('/')
            .any(|part| part.is_empty() || part == "." || part == "..")
        && if asset {
            path.starts_with("assets/") || path.starts_with("ui/assets/")
        } else {
            matches!(
                path,
                "manifest.json" | "script.json" | "gallery.json" | "ui/layout.json"
            )
        }
}

fn write_cartridge_inner(
    destination: &Path,
    text_files: &[NativeCartridgeTextFile],
    assets: &[NativeCartridgeAsset],
) -> Result<u64, String> {
    let mut seen = HashSet::new();
    for text in text_files {
        if !valid_path(&text.path, false) || !seen.insert(text.path.as_str()) {
            return Err(format!("CARTRIDGE_PATH_INVALID: {}", text.path));
        }
    }
    if !seen.contains("manifest.json") || !seen.contains("script.json") {
        return Err("CARTRIDGE_INVALID: manifest.json and script.json are required".into());
    }
    let manifest_text = text_files
        .iter()
        .find(|text| text.path == "manifest.json")
        .unwrap();
    let manifest: serde_json::Value = serde_json::from_str(&manifest_text.contents)
        .map_err(|error| format!("CARTRIDGE_INVALID: manifest.json: {error}"))?;
    let expected: HashSet<&str> = manifest["assets"]
        .as_array()
        .ok_or("CARTRIDGE_INVALID: manifest.assets is not an array")?
        .iter()
        .map(|asset| {
            asset["path"]
                .as_str()
                .ok_or("CARTRIDGE_INVALID: asset path is missing")
        })
        .collect::<Result<_, _>>()?;
    if expected.len() != assets.len() {
        return Err("CARTRIDGE_ASSET_MISMATCH: manifest and sources differ".into());
    }
    for asset in assets {
        if !valid_path(&asset.path, true)
            || !expected.contains(asset.path.as_str())
            || !seen.insert(asset.path.as_str())
        {
            return Err(format!("CARTRIDGE_PATH_INVALID: {}", asset.path));
        }
        if asset.source_file_path.trim().is_empty() || asset.source_file_path.contains('\0') {
            return Err(format!("CARTRIDGE_ASSET_MISSING: {}", asset.path));
        }
    }
    let file = File::create(destination).map_err(|error| {
        format!(
            "Failed to create cartridge {}: {error}",
            destination.display()
        )
    })?;
    let mut zip = ZipWriter::new(file);
    let text_options = SimpleFileOptions::default()
        .compression_method(CompressionMethod::Deflated)
        .large_file(true);
    // Imported .vnproj assets are already compressed images, audio and video.
    // Streaming them directly keeps both ZIP assembly and hashing off the WebView heap.
    let asset_options = SimpleFileOptions::default()
        .compression_method(CompressionMethod::Stored)
        .large_file(true);
    let mut checksums = Vec::with_capacity(text_files.len() + assets.len());
    for text in text_files {
        let bytes = text.contents.as_bytes();
        zip.start_file(&text.path, text_options)
            .map_err(|error| format!("Failed to start cartridge entry {}: {error}", text.path))?;
        zip.write_all(bytes)
            .map_err(|error| format!("Failed to write cartridge entry {}: {error}", text.path))?;
        checksums.push(serde_json::json!({
            "path": text.path,
            "size_bytes": bytes.len(),
            "hash_sha256": hex::encode(Sha256::digest(bytes)),
        }));
    }
    let mut buffer = [0u8; 1024 * 1024];
    for asset in assets {
        let mut source = File::open(&asset.source_file_path).map_err(|error| {
            format!(
                "CARTRIDGE_ASSET_MISSING: {} ({}): {error}",
                asset.path, asset.source_file_path
            )
        })?;
        zip.start_file(&asset.path, asset_options)
            .map_err(|error| format!("Failed to start cartridge entry {}: {error}", asset.path))?;
        let mut hash = Sha256::new();
        let mut size = 0u64;
        loop {
            let count = source.read(&mut buffer).map_err(|error| {
                format!("Failed to read cartridge source {}: {error}", asset.path)
            })?;
            if count == 0 {
                break;
            }
            zip.write_all(&buffer[..count]).map_err(|error| {
                format!("Failed to write cartridge asset {}: {error}", asset.path)
            })?;
            hash.update(&buffer[..count]);
            size += count as u64;
        }
        checksums.push(serde_json::json!({
            "path": asset.path,
            "size_bytes": size,
            "hash_sha256": hex::encode(hash.finalize()),
        }));
    }
    checksums.sort_by(|left, right| left["path"].as_str().cmp(&right["path"].as_str()));
    let generated_at = manifest["created_at"].as_str().map(str::to_owned).unwrap_or_else(|| SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock precedes Unix epoch")
        .as_millis()
        .to_string());
    let checksum = serde_json::json!({
        "checksum_version": "1.0.0",
        "algorithm": "sha256",
        "generated_at": generated_at,
        "files": checksums,
    });
    zip.start_file("checksum.json", text_options)
        .map_err(|error| format!("Failed to start checksum.json: {error}"))?;
    zip.write_all(
        serde_json::to_string_pretty(&checksum)
            .map_err(|error| format!("Failed to encode checksum.json: {error}"))?
            .as_bytes(),
    )
    .map_err(|error| format!("Failed to write checksum.json: {error}"))?;
    zip.finish()
        .map_err(|error| format!("Failed to finish cartridge: {error}"))?;
    fs::metadata(destination)
        .map(|metadata| metadata.len())
        .map_err(|error| {
            format!(
                "Failed to stat cartridge {}: {error}",
                destination.display()
            )
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use sha2::Digest;
    use std::{fs, io::Read};
    use zip::ZipArchive;

    #[test]
    fn writes_file_backed_cartridge_and_checksum_without_loading_project_into_webview() {
        let root = std::env::temp_dir().join(format!(
            "agentvn-native-cartridge-test-{}-{}",
            std::process::id(),
            crate::error_report_timestamp()
        ));
        fs::create_dir_all(&root).unwrap();
        let source = root.join("素材 with spaces.bin");
        fs::write(&source, vec![0x5a; 20 * 1024 * 1024]).unwrap();
        let destination = root.join("result.vncart");
        let result = write_cartridge(
            &destination,
            &[
                NativeCartridgeTextFile {
                    path: "manifest.json".into(),
                    contents: r#"{"assets":[{"path":"assets/background/测试.bin"}]}"#.into(),
                },
                NativeCartridgeTextFile {
                    path: "script.json".into(),
                    contents: "{}".into(),
                },
            ],
            &[NativeCartridgeAsset {
                path: "assets/background/测试.bin".into(),
                source_file_path: source.to_string_lossy().into_owned(),
            }],
        );
        let test_result = (|| {
            let size = result.unwrap();
            assert!(size >= 20 * 1024 * 1024);
            let mut zip = ZipArchive::new(fs::File::open(&destination).unwrap()).unwrap();
            let mut bytes = Vec::new();
            zip.by_name("checksum.json")
                .unwrap()
                .read_to_end(&mut bytes)
                .unwrap();
            let checksum: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
            let entry = checksum["files"]
                .as_array()
                .unwrap()
                .iter()
                .find(|item| item["path"] == "assets/background/测试.bin")
                .unwrap();
            assert_eq!(entry["size_bytes"], 20 * 1024 * 1024);
            assert_eq!(
                entry["hash_sha256"],
                hex::encode(sha2::Sha256::digest(vec![0x5a; 20 * 1024 * 1024]))
            );
        })();
        fs::remove_dir_all(root).unwrap();
        test_result
    }

    #[test]
    fn rejects_missing_or_unsafe_asset_without_leaving_a_partial_cartridge() {
        let root = std::env::temp_dir().join(format!(
            "agentvn-native-cartridge-invalid-{}-{}",
            std::process::id(),
            crate::error_report_timestamp()
        ));
        fs::create_dir_all(&root).unwrap();
        let destination = root.join("result.vncart");
        let text_files = [
            NativeCartridgeTextFile {
                path: "manifest.json".into(),
                contents: r#"{"assets":[{"path":"assets/expected.png"}]}"#.into(),
            },
            NativeCartridgeTextFile {
                path: "script.json".into(),
                contents: "{}".into(),
            },
        ];
        let missing = NativeCartridgeAsset {
            path: "assets/expected.png".into(),
            source_file_path: root.join("not-found.png").to_string_lossy().into_owned(),
        };
        assert!(write_cartridge(&destination, &text_files, &[missing]).is_err());
        assert!(!destination.exists());
        let unsafe_asset = NativeCartridgeAsset {
            path: "assets/../expected.png".into(),
            source_file_path: root.join("not-found.png").to_string_lossy().into_owned(),
        };
        assert!(write_cartridge(&destination, &text_files, &[unsafe_asset]).is_err());
        assert!(!destination.exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    #[ignore = "run explicitly with AGENTVN_NATIVE_CARTRIDGE_FIXTURE_DIR pointing to an isolated imported project"]
    fn streams_full_imported_project_asset_set() {
        fn collect(dir: &Path, files: &mut Vec<std::path::PathBuf>) {
            for entry in fs::read_dir(dir).unwrap() {
                let path = entry.unwrap().path();
                if path.is_dir() {
                    collect(&path, files);
                } else {
                    files.push(path);
                }
            }
        }
        let fixture = std::env::var("AGENTVN_NATIVE_CARTRIDGE_FIXTURE_DIR")
            .expect("explicit imported project asset directory required");
        let mut files = Vec::new();
        collect(Path::new(&fixture), &mut files);
        assert!(
            files.len() >= 100,
            "fixture is not the full imported project"
        );
        let root = std::env::temp_dir().join(format!(
            "agentvn-native-cartridge-large-{}-{}",
            std::process::id(),
            crate::error_report_timestamp()
        ));
        fs::create_dir_all(&root).unwrap();
        let destination = root.join("large.vncart");
        let assets: Vec<_> = files
            .iter()
            .enumerate()
            .map(|(index, path)| NativeCartridgeAsset {
                path: format!("assets/{index:03}.bin"),
                source_file_path: path.to_string_lossy().into_owned(),
            })
            .collect();
        let manifest = serde_json::json!({
            "assets": assets.iter().map(|asset| serde_json::json!({ "path": asset.path })).collect::<Vec<_>>()
        });
        let written = write_cartridge(
            &destination,
            &[
                NativeCartridgeTextFile {
                    path: "manifest.json".into(),
                    contents: manifest.to_string(),
                },
                NativeCartridgeTextFile {
                    path: "script.json".into(),
                    contents: "{}".into(),
                },
            ],
            &assets,
        )
        .unwrap();
        assert!(
            written > 450 * 1024 * 1024,
            "expected the complete large project"
        );
        let zip = ZipArchive::new(File::open(&destination).unwrap()).unwrap();
        assert_eq!(zip.len(), assets.len() + 3);
        fs::remove_dir_all(root).unwrap();
    }
}
