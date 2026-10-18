//! Private engine discovery and a bounded, offline compatibility handshake.
use serde::{Deserialize, Serialize};
use std::{
    io::{Read, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::{Duration, Instant},
};
use tauri::Manager;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineStatus {
    state: &'static str,
    message: &'static str,
    generation_ready: bool,
    engine_version: Option<String>,
    device: Option<String>,
}

impl EngineStatus {
    fn unavailable(state: &'static str, message: &'static str) -> Self {
        Self {
            state,
            message,
            generation_ready: false,
            engine_version: None,
            device: None,
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Probe {
    protocol_version: u32,
    event: String,
    engine_version: String,
    yue_version: String,
    device: Option<String>,
    generation_ready: bool,
}

fn parse_probe(bytes: &[u8]) -> Result<EngineStatus, String> {
    let probe: Probe = serde_json::from_slice(bytes).map_err(|_| "Invalid engine reply")?;
    if probe.protocol_version != 1
        || probe.event != "probe"
        || probe.engine_version != "1.0.10"
        || probe.yue_version != "0.1.6"
        || probe.generation_ready
        || !matches!(probe.device.as_deref(), None | Some("cuda") | Some("mps"))
    {
        return Err("Incompatible engine reply".into());
    }
    Ok(EngineStatus {
        state: "detected",
        message:
            "The music engine was detected. Model loading and generation still need verification.",
        generation_ready: false,
        engine_version: Some(probe.engine_version),
        device: probe.device,
    })
}

fn interpreter(base: &Path) -> PathBuf {
    #[cfg(debug_assertions)]
    if let Some(path) = std::env::var_os("AULO_DEV_PYTHON") {
        let path = PathBuf::from(path);
        if path.is_absolute() {
            return path;
        }
    }
    if cfg!(target_os = "windows") {
        base.join("runtime/python/python.exe")
    } else {
        base.join("runtime/python/bin/python3")
    }
}

fn probe_process(python: &Path, timeout: Duration) -> Result<EngineStatus, String> {
    let mut script = tempfile::NamedTempFile::new().map_err(|e| e.to_string())?;
    script
        .write_all(include_bytes!("../../runtime/bridge.py"))
        .map_err(|e| e.to_string())?;
    script.flush().map_err(|e| e.to_string())?;
    let mut command = Command::new(python);
    command
        .arg("-I")
        .arg(script.path())
        .env("HF_HUB_OFFLINE", "1")
        .env("TRANSFORMERS_OFFLINE", "1")
        .env("PYTHONIOENCODING", "utf-8")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
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
        .write_all(b"{\"protocolVersion\":1,\"operation\":\"probe\"}\n");
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

#[tauri::command]
pub async fn engine_status(app: tauri::AppHandle) -> Result<EngineStatus, String> {
    let base = app.path().app_data_dir().map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        let python = interpreter(&base);
        if !python.is_file() {
            return EngineStatus::unavailable(
                "not_installed",
                "The music engine is not installed in this preview.",
            );
        }
        probe_process(&python, Duration::from_secs(30)).unwrap_or_else(|_| {
            EngineStatus::unavailable(
                "unavailable",
                "The music engine could not start. Close and reopen Aulo to try again.",
            )
        })
    })
    .await
    .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compatibility_is_not_generation_readiness() {
        let status = parse_probe(br#"{"protocolVersion":1,"event":"probe","engineVersion":"1.0.10","yueVersion":"0.1.6","device":"mps","generationReady":false}"#).unwrap();
        assert_eq!(status.state, "detected");
        assert!(!status.generation_ready);
    }

    #[test]
    fn rejects_noise_wrong_versions_and_false_readiness() {
        let good = r#"{"protocolVersion":1,"event":"probe","engineVersion":"1.0.10","yueVersion":"0.1.6","device":null,"generationReady":false}"#;
        for bad in [
            format!("log\n{good}"),
            good.replace("1.0.10", "1.0.11"),
            good.replace("false", "true"),
            good.replace("\"probe\"", "\"completed\""),
            good.replace(":1,", ":2,"),
        ] {
            assert!(parse_probe(bad.as_bytes()).is_err());
        }
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
        let status = probe_process(Path::new(&python), Duration::from_secs(30)).unwrap();
        assert_eq!(status.state, "detected");
        assert!(!status.generation_ready);
    }
}
