//! Private engine discovery and a bounded, offline compatibility handshake.
use crate::Held;
use serde::{Deserialize, Serialize};
use std::{
    io::{Read, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::Mutex,
    time::{Duration, Instant},
};
use tauri::Manager;

pub const PROTOCOL_VERSION: u32 = 3;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineStatus {
    pub state: &'static str,
    pub message: &'static str,
    /// True only when the engine started and found a supported accelerator.
    pub generation_ready: bool,
    pub engine_version: Option<String>,
    pub torch_version: Option<String>,
    pub device: Option<String>,
    pub backend: Option<String>,
}

impl EngineStatus {
    fn unavailable(state: &'static str, message: &'static str) -> Self {
        Self {
            state,
            message,
            generation_ready: false,
            engine_version: None,
            torch_version: None,
            device: None,
            backend: None,
        }
    }
}

/// The last probe. Ready and unsupported results last for the session; other results
/// are retried, but not more often than `RETRY_AFTER`, since a probe imports PyTorch.
#[derive(Default)]
pub struct EngineCache(Mutex<Option<(EngineStatus, Instant)>>);

const RETRY_AFTER: Duration = Duration::from_secs(60);

impl EngineCache {
    pub fn ready(&self) -> Option<EngineStatus> {
        self.0
            .lock()
            .unwrap()
            .as_ref()
            .map(|(s, _)| s.clone())
            .filter(|s| s.generation_ready)
    }

    /// A result that is still good to reuse, if there is one.
    pub fn reusable(&self, now: Instant) -> Option<EngineStatus> {
        let cached = self.0.held();
        let (status, at) = cached.as_ref()?;
        let lasting = matches!(status.state, "ready" | "unsupported");
        (lasting || now.duration_since(*at) < RETRY_AFTER).then(|| status.clone())
    }

    pub fn store(&self, status: EngineStatus, at: Instant) {
        *self.0.held() = Some((status, at));
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Probe {
    protocol_version: u32,
    event: String,
    engine_version: String,
    yue_version: String,
    #[serde(default)]
    torch_version: Option<String>,
    device: Option<String>,
    backend: Option<String>,
    /// Why there is no backend: `missing_engine` or `no_accelerator`.
    #[serde(default)]
    reason: Option<String>,
}

fn parse_probe(bytes: &[u8]) -> Result<EngineStatus, String> {
    let probe: Probe = serde_json::from_slice(bytes).map_err(|_| "Invalid engine reply")?;
    if probe.protocol_version != PROTOCOL_VERSION
        || probe.event != "probe"
        || probe.engine_version != "1.0.10"
        || probe.yue_version != "0.1.6"
        || !matches!(
            probe.device.as_deref(),
            Some("cuda") | Some("mps") | Some("cpu")
        )
        || !matches!(
            probe.backend.as_deref(),
            None | Some("torch") | Some("torch-eager") | Some("gguf")
        )
    {
        return Err("Incompatible engine reply".into());
    }
    if probe.backend.is_none() && probe.reason.as_deref() == Some("missing_engine") {
        // This computer's engine (GGUF) should ship inside Aulo.
        return Ok(EngineStatus {
            engine_version: Some(probe.engine_version),
            torch_version: probe.torch_version,
            device: probe.device,
            ..EngineStatus::unavailable(
                "not_installed",
                "Part of Aulo is missing. Reinstall Aulo to fix it.",
            )
        });
    }
    let ready = probe.backend.is_some();
    Ok(EngineStatus {
        state: if ready { "ready" } else { "unsupported" },
        message: if ready {
            "The music engine is ready on this computer."
        } else {
            "The music engine started, but this computer has no supported graphics acceleration."
        },
        generation_ready: ready,
        engine_version: Some(probe.engine_version),
        torch_version: probe.torch_version,
        device: probe.device,
        backend: probe.backend,
    })
}

/// The engine's Python inside an engine directory built by `scripts/build_engine.py`.
fn engine_python(engine: &Path) -> PathBuf {
    if cfg!(target_os = "windows") {
        engine.join("python/python.exe")
    } else {
        engine.join("python/bin/python3")
    }
}

/// The engine that ships inside Aulo's bundle. Development builds may instead use
/// `AULO_DEV_PYTHON`, or an engine built into `src-tauri/engine`.
pub fn interpreter(resources: &Path) -> PathBuf {
    #[cfg(debug_assertions)]
    {
        if let Some(path) = std::env::var_os("AULO_DEV_PYTHON") {
            let path = PathBuf::from(path);
            if path.is_absolute() {
                return path;
            }
        }
        let built = engine_python(&Path::new(env!("CARGO_MANIFEST_DIR")).join("engine"));
        if built.is_file() {
            return built;
        }
    }
    engine_python(&resources.join("engine"))
}

/// Where the bundled engine lives: the app's resource directory.
pub fn resources(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path().resource_dir().map_err(|e| e.to_string())
}

/// The bridge is compiled into the app and written to a private temporary file per run.
pub fn bridge_script() -> std::io::Result<tempfile::NamedTempFile> {
    let mut script = tempfile::NamedTempFile::new()?;
    script.write_all(include_bytes!("../../runtime/bridge.py"))?;
    script.flush()?;
    Ok(script)
}

/// A bridge process with no shell, no inherited Python configuration and no network.
pub fn bridge_command(python: &Path, script: &Path) -> Command {
    let mut command = Command::new(python);
    command
        // -I ignores every PYTHON* variable, so these settings are flags: never write
        // bytecode into the read-only, signed engine (-B), and speak UTF-8 on every
        // platform (-X utf8), whatever the computer's language.
        .args(["-I", "-B", "-X", "utf8"])
        .arg(script)
        .env("HF_HUB_OFFLINE", "1")
        .env("TRANSFORMERS_OFFLINE", "1")
        // GROOVE's GGUF engine with its default, measured quantisation.
        .env("YUE2_GROOVE_GGUF_QUANT", "Q8_0")
        // GROOVE's Apple Silicon memory guard: keep PyTorch from driving the Mac into swap.
        .env("PYTORCH_MPS_HIGH_WATERMARK_RATIO", "0.8")
        .env("PYTORCH_MPS_LOW_WATERMARK_RATIO", "0.5")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped());
    // The engine this computer uses (see plan.rs); the bridge runs exactly that one.
    if let Ok(plan) = crate::plan::current() {
        command.env("AULO_ENGINE", plan.engine.name());
        if let Some(cap) = plan.context_cap {
            command.env("YUE2_GROOVE_GGUF_MAX_SEQ", cap.to_string());
        }
    }
    // GGUF engine binaries ship beside the bundled Python (`engine/yue2cpp`).
    let binaries = python
        .ancestors()
        .find(|dir| dir.file_name().is_some_and(|name| name == "python"))
        .and_then(Path::parent)
        .map(|engine| engine.join("yue2cpp"));
    if let Some(binaries) = binaries.filter(|dir| dir.is_dir()) {
        command.env("YUE2_GROOVE_YUE2CPP", binaries);
    }
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    command
}

fn probe_process(python: &Path, timeout: Duration) -> Result<EngineStatus, String> {
    let script = bridge_script().map_err(|e| e.to_string())?;
    let mut command = bridge_command(python, script.path());
    command.stderr(Stdio::null());
    let mut child = command.spawn().map_err(|e| e.to_string())?;
    let output = child.stdout.take().ok_or("Missing engine output")?;
    let reader = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        output.take(65537).read_to_end(&mut bytes).map(|_| bytes)
    });
    let input_result = child
        .stdin
        .take()
        .ok_or("Missing engine input")?
        .write_all(b"{\"protocolVersion\":3,\"operation\":\"probe\"}\n");
    let started = Instant::now();
    let result = loop {
        if input_result.is_err() {
            break Err("Engine input failed".to_string());
        }
        match child.try_wait() {
            Ok(Some(status)) if status.success() => break Ok(()),
            Ok(Some(_)) => break Err("Engine probe failed".into()),
            Err(_) => break Err("Engine process failed".into()),
            Ok(None) if started.elapsed() >= timeout => break Err("Engine probe timed out".into()),
            Ok(None) => std::thread::sleep(Duration::from_millis(25)),
        }
    };
    if result.is_err() {
        let _ = child.kill();
        let _ = child.wait();
    }
    let bytes = reader
        .join()
        .map_err(|_| "Engine output failed")?
        .map_err(|_| "Engine output failed")?;
    result?;
    if bytes.len() > 65536 {
        return Err("Engine output too large".into());
    }
    parse_probe(&bytes)
}

pub fn inspect(resources: &Path) -> EngineStatus {
    let python = interpreter(resources);
    if !python.is_file() {
        // The engine ships inside Aulo, so this only happens to a damaged install.
        return EngineStatus::unavailable(
            "not_installed",
            "Part of Aulo is missing. Reinstall Aulo to fix it.",
        );
    }
    probe_process(&python, Duration::from_secs(60)).unwrap_or_else(|_| {
        EngineStatus::unavailable(
            "unavailable",
            "The music engine could not start. Close and reopen Aulo to try again.",
        )
    })
}

#[tauri::command]
pub async fn engine_status(app: tauri::AppHandle) -> Result<EngineStatus, String> {
    // Without a plan the engine would be started with no engine chosen; say why instead.
    // Nothing is cached, so the answer follows the plan once the computer qualifies.
    let plan = tauri::async_runtime::spawn_blocking(crate::plan::current)
        .await
        .map_err(|e| e.to_string())?;
    if let Err(reason) = plan {
        return Ok(EngineStatus::unavailable("unsupported", reason));
    }
    if let Some(status) = app.state::<EngineCache>().reusable(Instant::now()) {
        return Ok(status);
    }
    let resources = resources(&app)?;
    let status = tauri::async_runtime::spawn_blocking(move || inspect(&resources))
        .await
        .map_err(|e| e.to_string())?;
    app.state::<EngineCache>()
        .store(status.clone(), Instant::now());
    Ok(status)
}

#[cfg(test)]
mod tests {
    use super::*;

    const GOOD: &str = r#"{"protocolVersion":3,"event":"probe","engineVersion":"1.0.10","yueVersion":"0.1.6","device":"mps","backend":"torch"}"#;

    #[test]
    fn the_engine_never_writes_bytecode_and_always_speaks_utf8() {
        let command = bridge_command(Path::new("python3"), Path::new("bridge.py"));
        let args: Vec<_> = command.get_args().map(|a| a.to_string_lossy()).collect();
        assert_eq!(args, ["-I", "-B", "-X", "utf8", "bridge.py"]);
    }

    #[cfg(unix)]
    #[test]
    fn isolated_python_honours_the_bytecode_flag() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("probe_module.py"), "x = 1\n").unwrap();
        let script = dir.path().join("main.py");
        std::fs::write(
            &script,
            "import sys\nsys.path.insert(0, sys.argv[1])\nimport probe_module\n",
        )
        .unwrap();
        let Ok(status) = bridge_command(Path::new("python3"), &script)
            .arg(dir.path())
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .status()
        else {
            return; // No Python on this machine; the argument test above still applies.
        };
        assert!(status.success());
        assert!(!dir.path().join("__pycache__").exists());
    }

    #[test]
    fn a_missing_gguf_engine_is_a_damaged_install_not_an_unsupported_computer() {
        let reply = GOOD
            .replace("\"torch\"", "null")
            .replace("}", ",\"reason\":\"missing_engine\"}");
        let status = parse_probe(reply.as_bytes()).unwrap();
        assert_eq!(status.state, "not_installed");
        assert!(status.message.contains("Reinstall"));
        assert!(!status.generation_ready);
    }

    #[test]
    fn a_supported_backend_makes_the_engine_ready() {
        let status = parse_probe(GOOD.as_bytes()).unwrap();
        assert_eq!(status.state, "ready");
        assert!(status.generation_ready);
        assert_eq!(status.backend.as_deref(), Some("torch"));
    }

    #[test]
    fn no_supported_backend_is_reported_honestly() {
        let reply = GOOD
            .replace("\"mps\"", "\"cpu\"")
            .replace("\"torch\"", "null");
        let status = parse_probe(reply.as_bytes()).unwrap();
        assert_eq!(status.state, "unsupported");
        assert!(!status.generation_ready);
    }

    #[test]
    fn rejects_noise_wrong_versions_and_unknown_backends() {
        for bad in [
            format!("log\n{GOOD}"),
            GOOD.replace("1.0.10", "1.0.11"),
            GOOD.replace("\"torch\"", "\"vllm\""),
            GOOD.replace("\"probe\"", "\"completed\""),
            GOOD.replace(":3,", ":2,"),
        ] {
            assert!(parse_probe(bad.as_bytes()).is_err());
        }
    }

    #[test]
    fn probe_results_are_reused_without_hiding_recovery_for_long() {
        let cache = EngineCache::default();
        let start = Instant::now();
        assert!(cache.reusable(start).is_none());
        cache.store(EngineStatus::unavailable("unavailable", "not yet"), start);
        assert!(cache.reusable(start + Duration::from_secs(5)).is_some());
        assert!(cache.reusable(start + RETRY_AFTER).is_none());
        assert!(cache.ready().is_none());
        let ready = parse_probe(GOOD.as_bytes()).unwrap();
        cache.store(ready, start);
        assert!(cache
            .reusable(start + Duration::from_secs(86_400))
            .is_some());
        assert!(cache.ready().is_some());
    }

    #[cfg(unix)]
    #[test]
    fn failed_and_stalled_children_do_not_become_ready() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let executable = dir.path().join("fixture");
        for script in ["#!/bin/sh\nexit 1\n", "#!/bin/sh\nexec sleep 5\n"] {
            std::fs::write(&executable, script).unwrap();
            std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o700)).unwrap();
            let started = Instant::now();
            assert!(probe_process(&executable, Duration::from_millis(100)).is_err());
            assert!(started.elapsed() < Duration::from_secs(3));
        }
    }

    #[test]
    #[ignore = "Requires an explicitly selected local development engine"]
    fn live_engine_probe() {
        let python = std::env::var_os("AULO_DEV_PYTHON").expect("Set AULO_DEV_PYTHON");
        let status = probe_process(Path::new(&python), Duration::from_secs(60)).unwrap();
        assert_eq!(status.state, "ready");
    }
}
