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
        let mut child = command
            .spawn()
            .map_err(|_| "The music engine could not start.".to_string())?;
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
                let _ = self.child.held().wait();
                return;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        self.kill();
    }

    pub fn kill(&self) {
        let mut child = self.child.held();
        let _ = child.kill();
        let _ = child.wait();
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
