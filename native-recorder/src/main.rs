mod timeline;
#[cfg(windows)]
mod windows;

fn main() {
    #[cfg(windows)]
    if let Err(error) = windows::run() {
        println!(
            "{}",
            serde_json::json!({"event":"error","message":error.to_string()})
        );
        std::process::exit(1);
    }
    #[cfg(not(windows))]
    {
        eprintln!("Native capture requires Windows 10 1903 or later.");
        std::process::exit(1);
    }
}
