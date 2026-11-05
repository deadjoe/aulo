//! One long-lived engine process: spawn, wait until ready, send commands, read events.
use crate::songs::{parse_event, EngineEvent};
use crate::Held;
use std::{
    io::{BufRead, BufReader, Read, Write},
    process::{Child, ChildStdin, Command},
    sync::{
        mpsc::{self, Receiver, RecvTimeoutError},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};

const MAX_EVENT_BYTES: u64 = 65536;

/// What the reader thread hands over: an event, or the end of the engine's output.
pub enum Output {
    Event(EngineEvent),
    Closed,
}

pub struct EngineProcess {
    pub child: Arc<Mutex<Child>>,
    pub input: Arc<Mutex<Option<ChildStdin>>>,
    events: Receiver<Output>,
    // Kept alive for as long as the process may read the script.
    _script: Option<tempfile::NamedTempFile>,
}

impl EngineProcess {
    /// Start `serve` mode and wait for the engine's `ready` event.
    pub fn start(
        mut command: Command,
        script: Option<tempfile::NamedTempFile>,
        protocol: u32,
        timeout: Duration,
    ) -> Result<Self, String> {
        group(&mut command);
        let mut child = command
            .spawn()
            .map_err(|_| "The music engine could not start.".to_string())?;
        contain(&child);
        let stdout = child.stdout.take().ok_or("Missing engine output")?;
        let stdin = child.stdin.take().ok_or("Missing engine input")?;
        let (sender, events) = mpsc::channel();
        std::thread::spawn(move || {
            let mut reader = BufReader::new(stdout);
            loop {
                let mut buffer = Vec::new();
                let read = (&mut reader)
                    .take(MAX_EVENT_BYTES + 1)
                    .read_until(b'\n', &mut buffer);
                match read {
                    Ok(0) | Err(_) => break,
                    Ok(_) if buffer.len() as u64 > MAX_EVENT_BYTES => break,
                    Ok(_) => {
                        if let Some(event) = parse_event(&buffer) {
                            if sender.send(Output::Event(event)).is_err() {
                                return;
                            }
                        }
                    }
                }
            }
            let _ = sender.send(Output::Closed);
        });
        let process = Self {
            child: Arc::new(Mutex::new(child)),
            input: Arc::new(Mutex::new(Some(stdin))),
            events,
            _script: script,
        };
        process.send(&serde_json::json!({"protocolVersion": protocol, "operation": "serve"}))?;
        let deadline = Instant::now() + timeout;
        loop {
            let left = deadline.saturating_duration_since(Instant::now());
            match process.events.recv_timeout(left) {
                Ok(Output::Event(event)) if event.event == "ready" => return Ok(process),
                Ok(Output::Event(_)) => continue,
                Ok(Output::Closed) | Err(_) => {
                    process.kill();
                    return Err("The music engine could not start.".into());
                }
            }
        }
    }

    pub fn send(&self, value: &serde_json::Value) -> Result<(), String> {
        send_line(&self.input, value)
    }

    pub fn next(&self, timeout: Duration) -> Result<Output, RecvTimeoutError> {
        self.events.recv_timeout(timeout)
    }

    pub fn alive(&self) -> bool {
        self.child
            .lock()
            .unwrap()
            .try_wait()
            .is_ok_and(|status| status.is_none())
    }

    /// Ask for a clean exit, then stop the process if it does not leave in time.
    pub fn shutdown(self, grace: Duration) {
        let _ = self.send(&serde_json::json!({"operation": "shutdown"}));
        self.input.held().take();
        let deadline = Instant::now() + grace;
        while Instant::now() < deadline {
            if !self.alive() {
                let mut child = self.child.held();
                let _ = child.wait();
                release(&child);
                return;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        self.kill();
    }

    pub fn kill(&self) {
        kill_tree(&mut self.child.held());
    }
}

// GROOVE's GGUF engine runs yue2.cpp as processes of its own (yue-synth, yue-plan,
// neural-codec). Stopping only the Python process would leave them running on the
// graphics card, so the engine and everything it starts are kept and stopped together.

/// Before spawning: on macOS, the engine leads a process group its children join.
pub fn group(command: &mut Command) {
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    #[cfg(not(unix))]
    let _ = command;
}

/// After spawning: on Windows, a job that the system ends with everything in it when
/// Aulo closes its handle, which also happens when Aulo crashes or is force-quit.
/// (On macOS the engine notices Aulo is gone and stops by itself; see bridge.py.)
pub fn contain(child: &Child) {
    #[cfg(windows)]
    jobs::assign(child);
    #[cfg(not(windows))]
    let _ = child;
}

/// Stop the engine and every process it started, and reap it.
pub fn kill_tree(child: &mut Child) {
    #[cfg(unix)]
    {
        // The group outlives its leader while any member is left, and its id is not
        // handed to a new process meanwhile, so this reaches only the engine's own.
        if let Ok(group) = i32::try_from(child.id()) {
            // SAFETY: a plain signal to a process group; no memory is shared.
            unsafe { libc::killpg(group, libc::SIGKILL) };
        }
    }
    #[cfg(windows)]
    jobs::end(child.id());
    let _ = child.kill();
    let _ = child.wait();
}

/// The engine left by itself: end anything it left behind.
pub fn release(child: &Child) {
    #[cfg(windows)]
    jobs::end(child.id());
    #[cfg(not(windows))]
    let _ = child;
}

#[cfg(windows)]
mod jobs {
    use std::{os::windows::io::AsRawHandle, process::Child, sync::Mutex};
    use windows::{
        core::PCWSTR,
        Win32::{
            Foundation::{CloseHandle, HANDLE},
            System::JobObjects::{
                AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
                SetInformationJobObject, TerminateJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
                JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
            },
        },
    };

    /// A job set to end its processes once its last handle closes.
    struct Job(HANDLE);
    // SAFETY: a job handle may be used and closed from any thread.
    unsafe impl Send for Job {}
    impl Drop for Job {
        fn drop(&mut self) {
            // SAFETY: the handle is owned here and closed exactly once.
            unsafe {
                let _ = TerminateJobObject(self.0, 1);
                let _ = CloseHandle(self.0);
            }
        }
    }

    /// Jobs by engine process id. Never dropped while Aulo runs; when Aulo ends, the
    /// system closes the handles and the jobs end their processes.
    static JOBS: Mutex<Vec<(u32, Job)>> = Mutex::new(Vec::new());

    fn create() -> Option<Job> {
        // SAFETY: plain system calls; `info` outlives the call that reads it.
        unsafe {
            let job = Job(CreateJobObjectW(None, PCWSTR::null()).ok()?);
            let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            SetInformationJobObject(
                job.0,
                JobObjectExtendedLimitInformation,
                &info as *const _ as *const core::ffi::c_void,
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            )
            .ok()?;
            Some(job)
        }
    }

    pub fn assign(child: &Child) {
        let Some(job) = create() else { return };
        let process = HANDLE(child.as_raw_handle());
        // SAFETY: both handles are open for the length of the call.
        if unsafe { AssignProcessToJobObject(job.0, process) }.is_ok() {
            let mut jobs = JOBS
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            jobs.retain(|(id, _)| *id != child.id());
            jobs.push((child.id(), job));
        }
    }

    /// End the job of this engine process, and everything still in it.
    pub fn end(id: u32) {
        let job = {
            let mut jobs = JOBS
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            jobs.iter()
                .position(|(owner, _)| *owner == id)
                .map(|index| jobs.swap_remove(index))
        };
        drop(job);
    }
}

pub fn send_line(
    input: &Arc<Mutex<Option<ChildStdin>>>,
    value: &serde_json::Value,
) -> Result<(), String> {
    let mut line = serde_json::to_vec(value).map_err(|e| e.to_string())?;
    line.push(b'\n');
    let mut input = input.held();
    let stdin = input.as_mut().ok_or("The music engine is not running.")?;
    stdin
        .write_all(&line)
        .and_then(|_| stdin.flush())
        .map_err(|_| "Lost contact with the music engine.".to_string())
}

/// Keeps a Mac awake while a song is being made; stopped when dropped.
pub struct KeepAwake(Option<Child>);

impl KeepAwake {
    pub fn start() -> Self {
        #[cfg(target_os = "macos")]
        {
            let child = Command::new("/usr/bin/caffeinate")
                .args(["-i", "-w", &std::process::id().to_string()])
                .stdin(std::process::Stdio::null())
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .spawn()
                .ok();
            Self(child)
        }
        #[cfg(target_os = "windows")]
        {
            use windows::Win32::System::Power::{
                SetThreadExecutionState, ES_CONTINUOUS, ES_SYSTEM_REQUIRED,
            };
            // Held by this thread until it says otherwise (in `drop`, on the same thread).
            // SAFETY: a plain flag call with no pointers.
            let _ = unsafe { SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED) };
        }
        #[cfg(not(target_os = "macos"))]
        Self(None)
    }
}

impl Drop for KeepAwake {
    fn drop(&mut self) {
        #[cfg(target_os = "windows")]
        {
            use windows::Win32::System::Power::{SetThreadExecutionState, ES_CONTINUOUS};
            // SAFETY: as in `start`.
            let _ = unsafe { SetThreadExecutionState(ES_CONTINUOUS) };
        }
        if let Some(child) = self.0.as_mut() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Stdio;

    /// Starts a process that starts a second, long-lived one; both hold the output open,
    /// so the output ends only once both are gone.
    fn engine_with_a_child() -> Command {
        #[cfg(unix)]
        let mut command = {
            let mut command = Command::new("/bin/sh");
            command.args(["-c", "sleep 60 & sleep 60"]);
            command
        };
        #[cfg(windows)]
        let mut command = {
            let mut command = Command::new("cmd");
            command.args([
                "/C",
                "start /B ping -n 60 127.0.0.1 >NUL & ping -n 60 127.0.0.1 >NUL",
            ]);
            command
        };
        command.stdin(Stdio::null()).stdout(Stdio::piped());
        command
    }

    #[test]
    fn stopping_the_engine_stops_what_it_started() {
        let mut command = engine_with_a_child();
        group(&mut command);
        let mut child = command.spawn().unwrap();
        contain(&child);
        let mut output = child.stdout.take().unwrap();
        // Let the second process start before the engine is stopped.
        std::thread::sleep(Duration::from_millis(500));
        let (done, ended) = mpsc::channel();
        std::thread::spawn(move || {
            let _ = std::io::copy(&mut output, &mut std::io::sink());
            let _ = done.send(());
        });
        kill_tree(&mut child);
        assert!(
            ended.recv_timeout(Duration::from_secs(10)).is_ok(),
            "a process the engine started is still running"
        );
    }
}
