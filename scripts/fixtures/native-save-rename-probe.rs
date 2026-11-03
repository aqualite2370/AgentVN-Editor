use std::{fs, io::Write, path::PathBuf};
fn main() {
    let args: Vec<_> = std::env::args().skip(1).collect();
    assert!(!args.is_empty());
    let mut failed = false;
    for (index, directory) in args.iter().enumerate() {
        let root = PathBuf::from(directory);
        fs::create_dir_all(&root).unwrap();
        let destination = root.join(format!("rust-{index}.json"));
        let temporary = destination.with_extension(format!("json.{}.0.tmp", std::process::id()));
        let mut file = fs::OpenOptions::new().write(true).create_new(true).open(&temporary).unwrap();
        file.write_all(br#"{"probe":"isolated-atomic-save"}"#).unwrap();
        file.sync_all().unwrap();
        drop(file);
        match fs::rename(&temporary, &destination) {
            Ok(()) => println!("PASS {index}"),
            Err(error) => {
                println!("FAILED {index} raw_os_error={:?} error={error}", error.raw_os_error());
                failed = true;
            }
        }
    }
    if failed { std::process::exit(1); }
}
