// Synthetic, bounded filesystem diagnosis. No Editor or Player is launched.
use std::{env, fs, io, os::windows::fs::symlink_file, path::Path};

fn probe(root: &Path) -> io::Result<()> {
    let directory = root.join(format!(".agentvn-symlink-probe-{}-1793870856927", std::process::id()));
    let source = directory.join("source.txt");
    let link = directory.join("link.txt");
    println!("ROOT {root:?}");
    let mut step = "create-directory";
    let result = (|| {
        fs::create_dir_all(&directory)?;
        step = "write-source";
        fs::write(&source, "agentvn-symlink-probe")?;
        step = "create-link";
        symlink_file(&source, &link)?;
        println!("LINK_TARGET {:?}", fs::read_link(&link));
        step = "read-link";
        let actual = fs::read_to_string(&link)?;
        assert_eq!(actual, "agentvn-symlink-probe");
        Ok::<_, io::Error>(())
    })();
    println!("RESULT {step} {result:?}");
    if result.is_err() && fs::symlink_metadata(&link).is_ok() {
        println!("SOURCE_READ {:?}", fs::read_to_string(&source));
        println!("SOURCE_CANONICAL {:?}", fs::canonicalize(&source));
        println!("VERBATIM_LINK_READ {:?}", fs::read_to_string(format!(r"\\?\{}", link.display())));
        let detail = std::process::Command::new("fsutil.exe")
            .args(["reparsepoint", "query"]).arg(&link).output().unwrap();
        println!("REPARSE {}", String::from_utf8_lossy(&detail.stdout));
    }
    if fs::symlink_metadata(&link).is_ok() { fs::remove_file(&link)?; }
    if source.exists() { fs::remove_file(&source)?; }
    if directory.exists() { fs::remove_dir(&directory)?; }
    println!("CLEANED {}", !directory.exists());
    result
}

fn main() {
    for root in env::args_os().skip(1) {
        let _ = probe(Path::new(&root));
    }
}
