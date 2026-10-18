mod engine;
mod models;
mod songs;
use serde::Serialize;
use sysinfo::{Disks, System};
use tauri::Manager;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Hardware {
    platform: String,
    arch: String,
    chip: String,
    memory_gi_b: f64,
    free_disk_gi_b: Option<f64>,
    gpu: Option<String>,
    gpu_memory_gi_b: Option<f64>,
    data_path: String,
}

#[cfg(target_os = "windows")]
fn nvidia_gpu() -> (Option<String>, Option<f64>) {
    use std::{
        os::windows::process::CommandExt,
        process::Command,
        time::{Duration, Instant},
    };
    let mut child = match Command::new("nvidia-smi")
        .args([
            "--query-gpu=name,memory.total",
            "--format=csv,noheader,nounits",
        ])
        .creation_flags(0x08000000)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .spawn()
    {
        Ok(child) => child,
        Err(_) => return (None, None),
    };
    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if started.elapsed() < Duration::from_secs(5) => {
                std::thread::sleep(Duration::from_millis(50))
            }
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return (None, None);
            }
        }
    }
    let output = match child.wait_with_output() {
        Ok(output) if output.status.success() => output,
        _ => return (None, None),
    };
    // Report one actual device; never add memory across GPUs.
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| {
            let (name, memory) = line.rsplit_once(',')?;
            Some((
                name.trim().to_string(),
                memory.trim().parse::<f64>().ok()? / 1024.0,
            ))
        })
        .max_by(|a, b| a.1.total_cmp(&b.1))
        .map(|(name, memory)| (Some(name), Some(memory)))
        .unwrap_or((None, None))
}

#[cfg(not(target_os = "windows"))]
fn nvidia_gpu() -> (Option<String>, Option<f64>) {
    (None, None)
}

#[tauri::command]
async fn inspect_hardware(app: tauri::AppHandle) -> Result<Hardware, String> {
    let path = app.path().app_data_dir().map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || collect_hardware(path))
        .await
        .map_err(|e| e.to_string())
}

fn collect_hardware(path: std::path::PathBuf) -> Hardware {
    let mut system = System::new();
    system.refresh_memory();
    system.refresh_cpu_all();
    let disks = Disks::new_with_refreshed_list();
    let disk = disks
        .iter()
        .filter(|d| path.starts_with(d.mount_point()))
        .max_by_key(|d| d.mount_point().as_os_str().len());
    let (gpu, gpu_memory) = nvidia_gpu();
    Hardware {
        platform: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        chip: system
            .cpus()
            .first()
            .map(|c| c.brand().to_string())
            .unwrap_or_else(|| "Unknown processor".into()),
        memory_gi_b: system.total_memory() as f64 / 1_073_741_824.0,
        free_disk_gi_b: disk.map(|d| d.available_space() as f64 / 1_073_741_824.0),
        gpu,
        gpu_memory_gi_b: gpu_memory,
        data_path: path.to_string_lossy().into_owned(),
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(models::ModelManager::default())
        .manage(engine::EngineCache::default())
        .manage(songs::SongService::default())
        .invoke_handler(tauri::generate_handler![
            inspect_hardware,
            engine::engine_status,
            models::model_plan,
            models::model_status,
            models::download_models,
            models::verify_models,
            models::pause_models,
            models::open_model_license,
            songs::creation_status,
            songs::list_songs,
            songs::create_song,
            songs::cancel_song,
            songs::update_song,
            songs::delete_song
        ])
        .run(tauri::generate_context!())
        .expect("Failed to start Aulo");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn native_inspection_returns_real_host_observations() {
        let report = collect_hardware(std::env::temp_dir());
        assert_eq!(report.platform, std::env::consts::OS);
        assert_eq!(report.arch, std::env::consts::ARCH);
        assert!(report.memory_gi_b > 0.0);
        assert!(!report.chip.is_empty());
        if let Some(free) = report.free_disk_gi_b {
            assert!(free >= 0.0);
        }
    }

    #[test]
    fn report_matches_frontend_contract_without_inventing_unknown_values() {
        let report = Hardware {
            platform: "macos".into(),
            arch: "aarch64".into(),
            chip: "Test chip".into(),
            memory_gi_b: 32.0,
            free_disk_gi_b: None,
            gpu: None,
            gpu_memory_gi_b: None,
            data_path: "/test/models".into(),
        };
        let json = serde_json::to_value(report).unwrap();
        assert_eq!(json["memoryGiB"], 32.0);
        assert!(json["freeDiskGiB"].is_null());
        assert!(json["gpuMemoryGiB"].is_null());
        assert_eq!(json["dataPath"], "/test/models");
        assert!(json.get("ready").is_none());
    }
}
