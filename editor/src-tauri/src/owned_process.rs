//! Lifetime ownership for the backend/frontend that this host actually starts.
//! Reused services have no OwnedProcess and are never added to a job.
use std::{
    io,
    process::{Child, Command},
};

pub struct OwnedProcess {
    child: Child,
    #[cfg(windows)]
    job: Option<std::os::windows::io::OwnedHandle>,
}

impl OwnedProcess {
    pub fn spawn(command: &mut Command) -> io::Result<Self> {
        #[cfg(windows)]
        {
            use std::{
                mem::size_of,
                os::windows::{
                    io::{AsRawHandle, FromRawHandle, OwnedHandle},
                    process::CommandExt,
                },
            };
            use windows_sys::Win32::System::{
                JobObjects::*,
                Threading::{CREATE_NO_WINDOW, CREATE_SUSPENDED},
            };
            // Establish ownership before any user code runs. Otherwise a fast
            // launcher could spawn an unowned grandchild before job assignment.
            let handle = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
            if handle.is_null() {
                return Err(io::Error::last_os_error());
            }
            let job = unsafe { OwnedHandle::from_raw_handle(handle) };
            let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            if unsafe {
                SetInformationJobObject(
                    handle,
                    JobObjectExtendedLimitInformation,
                    &limits as *const _ as _,
                    size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                )
            } == 0
            {
                return Err(io::Error::last_os_error());
            }
            command.creation_flags(CREATE_NO_WINDOW | CREATE_SUSPENDED);
            let mut child = command.spawn()?;
            let assigned = unsafe { AssignProcessToJobObject(handle, child.as_raw_handle()) } != 0;
            let ready = if assigned {
                resume_primary_thread(child.id())
            } else {
                Err(io::Error::last_os_error())
            };
            if let Err(error) = ready {
                // A suspended child must not leak when ownership/setup fails.
                let _ = child.kill();
                let _ = child.wait();
                return Err(error);
            }
            // Keep the unnamed, non-inheritable job handle alive in the host.
            Ok(Self {
                child,
                job: Some(job),
            })
        }
        #[cfg(not(windows))]
        {
            command.spawn().map(|child| Self { child })
        }
    }

    pub fn id(&self) -> u32 {
        self.child.id()
    }

    pub fn try_wait(&mut self) -> io::Result<Option<std::process::ExitStatus>> {
        self.child.try_wait()
    }

    pub fn stop(&mut self) -> io::Result<()> {
        #[cfg(windows)]
        {
            // Closing our only job handle kills all descendants, even if the
            // original launcher has already exited. No PID/name enumeration.
            drop(self.job.take());
        }
        #[cfg(not(windows))]
        if self.child.try_wait()?.is_none() {
            self.child.kill()?;
        }
        self.child.wait().map(|_| ())
    }
}

impl Drop for OwnedProcess {
    fn drop(&mut self) {
        if let Err(error) = self.stop() {
            eprintln!(
                "[AgentVN] Owned process {} cleanup failed: {error}",
                self.id()
            );
        }
    }
}

#[cfg(windows)]
fn resume_primary_thread(process_id: u32) -> io::Result<()> {
    use std::{
        mem::size_of,
        os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle},
    };
    use windows_sys::Win32::{
        Foundation::INVALID_HANDLE_VALUE,
        System::{
            Diagnostics::ToolHelp::*,
            Threading::{OpenThread, ResumeThread, THREAD_SUSPEND_RESUME},
        },
    };
    let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0) };
    if snapshot == INVALID_HANDLE_VALUE {
        return Err(io::Error::last_os_error());
    }
    let snapshot = unsafe { OwnedHandle::from_raw_handle(snapshot) };
    let mut entry = THREADENTRY32 {
        dwSize: size_of::<THREADENTRY32>() as u32,
        ..Default::default()
    };
    let mut found = unsafe { Thread32First(snapshot.as_raw_handle(), &mut entry) };
    while found != 0 {
        if entry.th32OwnerProcessID == process_id {
            let thread = unsafe { OpenThread(THREAD_SUSPEND_RESUME, 0, entry.th32ThreadID) };
            if thread.is_null() {
                return Err(io::Error::last_os_error());
            }
            let thread = unsafe { OwnedHandle::from_raw_handle(thread) };
            if unsafe { ResumeThread(thread.as_raw_handle()) } == u32::MAX {
                return Err(io::Error::last_os_error());
            }
            return Ok(());
        }
        found = unsafe { Thread32Next(snapshot.as_raw_handle(), &mut entry) };
    }
    Err(io::Error::new(
        io::ErrorKind::NotFound,
        "Suspended process primary thread not found",
    ))
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
    use std::{
        io::{BufRead, BufReader, Write},
        process::Stdio,
        time::{Duration, Instant},
    };
    use windows_sys::Win32::Foundation::WAIT_OBJECT_0;
    use windows_sys::Win32::System::Threading::{
        OpenProcess, WaitForSingleObject, PROCESS_SYNCHRONIZE,
    };

    fn tree() -> (OwnedProcess, OwnedHandle) {
        let mut cmd = Command::new("powershell.exe");
        cmd.args(["-NoProfile", "-Command",
            "$p=Start-Process powershell.exe -ArgumentList '-NoProfile -Command Start-Sleep -Seconds 60' -WindowStyle Hidden -PassThru; [Console]::WriteLine($p.Id); [Console]::Out.Flush(); [Console]::ReadLine() | Out-Null"])
            .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null());
        let mut owned = OwnedProcess::spawn(&mut cmd).unwrap();
        let mut line = String::new();
        BufReader::new(owned.child.stdout.take().unwrap())
            .read_line(&mut line)
            .unwrap();
        let pid = line.trim().parse::<u32>().unwrap();
        let raw = unsafe { OpenProcess(PROCESS_SYNCHRONIZE, 0, pid) };
        assert!(!raw.is_null(), "Grandchild must exist before cleanup");
        (owned, unsafe { OwnedHandle::from_raw_handle(raw) })
    }

    fn exited(handle: &OwnedHandle) {
        assert_eq!(
            unsafe { WaitForSingleObject(handle.as_raw_handle(), 5000) },
            WAIT_OBJECT_0,
            "Actual descendant process survived"
        );
    }

    #[test]
    fn stop_kills_real_descendant_and_is_idempotent() {
        let (mut process, descendant) = tree();
        process.stop().unwrap();
        process.stop().unwrap();
        exited(&descendant);
    }

    #[test]
    fn drop_kills_descendant_after_launcher_already_exited() {
        let (mut process, descendant) = tree();
        process
            .child
            .stdin
            .as_mut()
            .unwrap()
            .write_all(b"\n")
            .unwrap();
        let deadline = Instant::now() + Duration::from_secs(10);
        while process.child.try_wait().unwrap().is_none() {
            assert!(Instant::now() < deadline);
            std::thread::sleep(Duration::from_millis(10));
        }
        drop(process);
        exited(&descendant);
    }

    #[test]
    fn independent_jobs_do_not_kill_each_other() {
        let (first, first_child) = tree();
        let (second, second_child) = tree();
        drop(first);
        exited(&first_child);
        assert_ne!(
            unsafe { WaitForSingleObject(second_child.as_raw_handle(), 0) },
            WAIT_OBJECT_0
        );
        drop(second);
        exited(&second_child);
    }

    #[test]
    fn missing_executable_fails_without_a_child() {
        assert!(OwnedProcess::spawn(&mut Command::new(
            "agentvn-nonexistent-owned-process-24ab.exe"
        ))
        .is_err());
    }
}
