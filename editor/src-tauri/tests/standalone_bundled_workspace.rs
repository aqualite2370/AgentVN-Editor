use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    process::Command,
    time::{SystemTime, UNIX_EPOCH},
};

fn workspace_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .expect("resolve AgentVN workspace root")
}

fn test_directory() -> PathBuf {
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock is before Unix epoch")
        .as_nanos();
    std::env::temp_dir().join(format!(
        "agentvn-bundled-workspace-unpack-{}-{suffix}",
        std::process::id()
    ))
}

struct FixtureDirectory(PathBuf);

impl FixtureDirectory {
    fn create() -> Self {
        let path = test_directory();
        fs::create_dir_all(&path).expect("create bundled workspace fixture");
        Self(path)
    }
}

impl Drop for FixtureDirectory {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn write_minimal_cartridge(path: &Path) {
    let file = fs::File::create(path).expect("create minimal cartridge");
    let mut archive = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    for (name, contents) in [
        ("manifest.json", r#"{"game_id":"standalone-unpack-test"}"#),
        ("script.json", r#"{"scenes":[]}"#),
        ("checksum.json", r#"{"files":[]}"#),
    ] {
        archive.start_file(name, options).expect("start ZIP entry");
        archive
            .write_all(contents.as_bytes())
            .expect("write ZIP entry");
    }
    archive.finish().expect("finish minimal cartridge");
}

fn link_directory(source: &Path, destination: &Path) {
    #[cfg(windows)]
    std::os::windows::fs::symlink_dir(source, destination)
        .expect("link GameCli node_modules into bundled workspace");

    #[cfg(unix)]
    std::os::unix::fs::symlink(source, destination)
        .expect("link GameCli node_modules into bundled workspace");
}

#[test]
fn installed_editor_workspace_can_unpack_without_editor_node_modules() {
    let root = workspace_root();
    let source_script = root.join("scripts/unpack-vncart.cjs");
    let source_runtime_modules = root.join("GameCli_framework/node_modules");
    assert!(
        source_script.exists(),
        "unpack-vncart.cjs fixture is missing"
    );
    assert!(
        source_runtime_modules.exists(),
        "GameCli dependencies must be installed before running this test"
    );

    let fixture = FixtureDirectory::create();
    let bundled_root = fixture.0.join("bundle-workspace");
    let bundled_scripts = bundled_root.join("scripts");
    let bundled_runtime = bundled_root.join("GameCli_framework");
    let bundled_runtime_modules = bundled_runtime.join("node_modules");
    let cartridge = fixture.0.join("minimal.vncart");
    let unpacked = fixture.0.join("unpacked");

    fs::create_dir_all(&bundled_scripts).expect("create bundled scripts directory");
    fs::create_dir_all(&bundled_runtime).expect("create bundled runtime directory");
    fs::copy(&source_script, bundled_scripts.join("unpack-vncart.cjs"))
        .expect("copy unpack-vncart.cjs into bundled workspace");
    link_directory(&source_runtime_modules, &bundled_runtime_modules);
    assert!(
        !bundled_root.join("editor").exists(),
        "installed-editor fixture must not contain the source editor workspace"
    );
    write_minimal_cartridge(&cartridge);

    let output = Command::new("node")
        .arg(bundled_scripts.join("unpack-vncart.cjs"))
        .arg(&cartridge)
        .arg(&unpacked)
        .current_dir(&bundled_root)
        .output()
        .expect("start Node unpack process");

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(
        output.status.success(),
        "bundled standalone workspace must unpack without editor/node_modules\nstdout:\n{stdout}\nstderr:\n{stderr}"
    );
    for required in ["manifest.json", "script.json", "checksum.json"] {
        assert!(
            unpacked.join(required).exists(),
            "missing unpacked file: {required}"
        );
    }
}
