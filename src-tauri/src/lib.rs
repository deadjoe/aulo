mod audio;
mod collections;
mod drafts;
mod engine;
mod models;
mod plan;
mod runner;
mod settings;
mod share;
mod songs;
mod support;
use serde::Serialize;
use sysinfo::{Disks, System};
use tauri::Manager;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Hardware {
    pub(crate) platform: String,
    pub(crate) arch: String,
    pub(crate) chip: String,
    pub(crate) memory_gi_b: f64,
    pub(crate) free_disk_gi_b: Option<f64>,
    pub(crate) gpu: Option<String>,
    pub(crate) gpu_memory_gi_b: Option<f64>,
    pub(crate) data_path: String,
}

/// The NVIDIA card and its own memory (VRAM, not the computer's memory). `nvidia-smi`
/// is installed with every NVIDIA driver; DXGI, part of Windows itself, answers when it
/// cannot be found or run.
#[cfg(target_os = "windows")]
fn nvidia_gpu() -> (Option<String>, Option<f64>) {
    let smi = [
        std::path::PathBuf::from("nvidia-smi"),
        std::path::PathBuf::from(r"C:\Program Files\NVIDIA Corporation\NVSMI\nvidia-smi.exe"),
    ];
    smi.iter()
        .find_map(|program| nvidia_smi(program))
        .or_else(dxgi_nvidia)
        .map(|(name, memory)| (Some(name), Some(memory)))
        .unwrap_or((None, None))
}

/// The NVIDIA adapter with the most dedicated memory, from DXGI.
#[cfg(target_os = "windows")]
fn dxgi_nvidia() -> Option<(String, f64)> {
    use windows::Win32::Graphics::Dxgi::{CreateDXGIFactory1, IDXGIFactory1};
    const NVIDIA: u32 = 0x10DE;
    // SAFETY: plain COM calls on a factory owned here.
    let factory: IDXGIFactory1 = unsafe { CreateDXGIFactory1() }.ok()?;
    let mut best: Option<(String, f64)> = None;
    for index in 0.. {
        let Ok(adapter) = (unsafe { factory.EnumAdapters1(index) }) else {
            break;
        };
        let Ok(desc) = (unsafe { adapter.GetDesc1() }) else {
            continue;
        };
        if desc.VendorId != NVIDIA {
            continue;
        }
        let len = desc
            .Description
            .iter()
            .position(|&c| c == 0)
            .unwrap_or(desc.Description.len());
        let name = String::from_utf16_lossy(&desc.Description[..len]);
        let memory = desc.DedicatedVideoMemory as f64 / 1_073_741_824.0;
        if best.as_ref().is_none_or(|(_, m)| memory > *m) {
            best = Some((name, memory));
        }
    }
    best
}

#[cfg(target_os = "windows")]
fn nvidia_smi(program: &std::path::Path) -> Option<(String, f64)> {
    use std::{
        os::windows::process::CommandExt,
        process::Command,
        time::{Duration, Instant},
    };
    let mut child = match Command::new(program)
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
        Err(_) => return None,
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
                return None;
            }
        }
    }
    let output = match child.wait_with_output() {
        Ok(output) if output.status.success() => output,
        _ => return None,
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
}

#[cfg(not(target_os = "windows"))]
fn nvidia_gpu() -> (Option<String>, Option<f64>) {
    (None, None)
}

/// Why this computer cannot make songs, if it cannot (see `plan`).
pub(crate) fn creation_hardware_blocker() -> Option<&'static str> {
    plan::current().err()
}

#[tauri::command]
async fn inspect_hardware(app: tauri::AppHandle) -> Result<Hardware, String> {
    let path = app.path().app_data_dir().map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        let hardware = collect_hardware(path);
        // "Check again" after installing a driver must be able to unblock creating.
        plan::recheck(&hardware);
        hardware
    })
    .await
    .map_err(|e| e.to_string())
}

pub(crate) fn collect_hardware(path: std::path::PathBuf) -> Hardware {
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
        .plugin(tauri_plugin_notification::init())
        .manage(models::ModelManager::default())
        .manage(engine::EngineCache::default())
        .manage(songs::SongService::default())
        .manage(settings::SettingsStore::default())
        .manage(drafts::SavedStore::default())
        .invoke_handler(tauri::generate_handler![
            inspect_hardware,
            engine::engine_status,
            models::model_plan,
            models::model_status,
            models::download_models,
            models::verify_models,
            models::pause_models,
            models::open_model_license,
            models::remove_models,
            songs::creation_status,
            songs::list_songs,
            songs::create_song,
            songs::cancel_song,
            songs::update_song,
            songs::trash_songs,
            songs::delete_songs,
            songs::delete_workspace,
            songs::list_collections,
            songs::create_workspace,
            songs::rename_workspace,
            songs::archive_workspace,
            songs::move_songs,
            songs::create_playlist,
            songs::rename_playlist,
            songs::delete_playlist,
            songs::add_to_playlist,
            songs::remove_from_playlist,
            songs::song_waveform,
            songs::export_song,
            songs::reveal_song,
            share::share_song,
            settings::get_settings,
            drafts::list_saved,
            drafts::save_text,
            drafts::delete_saved,
            settings::update_settings,
            songs::engine_memory,
            songs::release_engine,
            support::storage_usage,
            support::save_report
        ])
        .build(tauri::generate_context!())
        .expect("Failed to start Aulo")
        .run(|app, event| {
            // Never leave a music engine running after Aulo quits.
            if let tauri::RunEvent::Exit = event {
                app.state::<songs::SongService>().shutdown();
            }
        });
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
