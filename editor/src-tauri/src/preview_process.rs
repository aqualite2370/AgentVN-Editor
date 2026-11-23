use crate::owned_process::OwnedProcess;

/// try_wait reaps an exited child without blocking the desktop event loop.
/// Dropping an exited owner also closes its job; orphaned WebViews cannot
/// outlive a finished preview or require a process-name/path scan.
pub fn is_running(child: &mut Option<OwnedProcess>) -> Result<bool, String> {
    let Some(process) = child.as_mut() else { return Ok(false) };
    match process.try_wait() {
        Ok(None) => Ok(true),
        Ok(Some(_)) => { *child = None; Ok(false) }
        Err(error) => Err(format!("Could not query GameCLI preview process: {error}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::{Command, Stdio};
    use std::time::{Duration, Instant};

    #[test]
    fn tracks_real_child_exit_and_repeated_queries() {
        assert!(!is_running(&mut None).unwrap());
        let mut command = Command::new("powershell.exe");
        command.args(["-NoProfile", "-Command", "[Threading.Thread]::Sleep(60000)"])
            .stdin(Stdio::null()).stdout(Stdio::null());
        let mut child = Some(OwnedProcess::spawn(&mut command).unwrap());
        assert!(is_running(&mut child).unwrap());
        child.as_mut().unwrap().stop().unwrap();
        assert!(!is_running(&mut child).unwrap());
        assert!(child.is_none());
        assert!(!is_running(&mut child).unwrap());
    }

    #[test]
    fn naturally_exited_preview_releases_its_owner() {
        let mut command = Command::new("powershell.exe");
        command.args(["-NoProfile", "-Command", "exit 0"])
            .stdin(Stdio::null()).stdout(Stdio::null());
        let mut child = Some(OwnedProcess::spawn(&mut command).unwrap());
        let deadline = Instant::now() + Duration::from_secs(10);
        while is_running(&mut child).unwrap() {
            assert!(Instant::now() < deadline);
            std::thread::sleep(Duration::from_millis(10));
        }
        assert!(child.is_none());
        assert!(!is_running(&mut child).unwrap());
    }

    #[test]
    fn closing_preview_does_not_close_an_independent_owner() {
        let mut first = Command::new("powershell.exe");
        first.args(["-NoProfile", "-Command", "[Threading.Thread]::Sleep(60000)"])
            .stdin(Stdio::null()).stdout(Stdio::null());
        let mut second = Command::new("powershell.exe");
        second.args(["-NoProfile", "-Command", "[Threading.Thread]::Sleep(60000)"])
            .stdin(Stdio::null()).stdout(Stdio::null());
        let mut preview = Some(OwnedProcess::spawn(&mut first).unwrap());
        let mut unrelated = Some(OwnedProcess::spawn(&mut second).unwrap());
        assert!(is_running(&mut preview).unwrap());
        assert!(is_running(&mut unrelated).unwrap());
        preview.as_mut().unwrap().stop().unwrap();
        assert!(!is_running(&mut preview).unwrap());
        assert!(is_running(&mut unrelated).unwrap());
        unrelated.as_mut().unwrap().stop().unwrap();
    }
}
