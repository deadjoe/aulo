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
mod version;
use serde::Serialize;
use sysinfo::{Disks, System};
use tauri::Manager;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Hardware {
    pub(crate) platform: String,
    pub(crate) arch: String,
    pub(crate) chip: String,
    /// The operating system's own name for its version, such as "macOS 15.6".
    pub(crate) os_version: Option<String>,
    pub(crate) memory_gi_b: f64,
    pub(crate) free_disk_gi_b: Option<f64>,
    pub(crate) gpu: Option<String>,
    pub(crate) gpu_memory_gi_b: Option<f64>,
    /// The NVIDIA driver's version, when `nvidia-smi` could tell.
    pub(crate) gpu_driver: Option<String>,
    pub(crate) data_path: String,
    /// Why this computer cannot make songs (`plan::plan`), filled in for setup only, so
    /// the interface never keeps its own copy of the hardware rule.
    pub(crate) blocker: Option<&'static str>,
}

/// The format of the files Aulo keeps (song records, collections, settings, saved
/// lyrics and styles, the models record). Files from before this field read as 1.
/// Raise it when a format changes in a way that needs converting old files.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(transparent)]
pub(crate) struct FormatVersion(u32);

impl FormatVersion {
    pub(crate) const CURRENT: Self = Self(1);
}

impl Default for FormatVersion {
    fn default() -> Self {
        Self::CURRENT
    }
}

/// A lock that keeps working after a thread panicked while holding it. Aulo's shared
/// state is plain data that is valid after every statement, so it stays usable; without
/// this, one panic would make every later command panic until Aulo is restarted.
pub(crate) trait Held<T> {
    fn held(&self) -> std::sync::MutexGuard<'_, T>;
}

impl<T> Held<T> for std::sync::Mutex<T> {
    fn held(&self) -> std::sync::MutexGuard<'_, T> {
        self.lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }
}

/// Aulo's own data folder: songs, models, settings and logs.
///
/// The local (not roaming) folder: on Windows, Roaming is copied between the computers
/// of a domain account, which several gigabytes of models and songs must not be. On
/// macOS and Linux both are the same folder.
pub(crate) fn data_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    app.path().app_local_data_dir().map_err(|e| e.to_string())
}

/// What `nvidia_gpu` found.
#[derive(Default)]
struct Nvidia {
    name: Option<String>,
    memory_gi_b: Option<f64>,
    driver: Option<String>,
}

/// The NVIDIA card and its own memory (VRAM, not the computer's memory). `nvidia-smi`
/// is installed with every NVIDIA driver; DXGI, part of Windows itself, answers when it
/// cannot be found or run.
#[cfg(target_os = "windows")]
fn nvidia_gpu() -> Nvidia {
    let smi = [
        std::path::PathBuf::from("nvidia-smi"),
        std::path::PathBuf::from(r"C:\Program Files\NVIDIA Corporation\NVSMI\nvidia-smi.exe"),
    ];
    if let Some(found) = smi.iter().find_map(|program| nvidia_smi(program)) {
        return found;
    }
    dxgi_nvidia()
        .map(|(name, memory)| Nvidia {
            name: Some(name),
            memory_gi_b: Some(memory),
            driver: None,
        })
        .unwrap_or_default()
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
fn nvidia_smi(program: &std::path::Path) -> Option<Nvidia> {
    use std::{
        os::windows::process::CommandExt,
        process::Command,
        time::{Duration, Instant},
    };
    let mut child = match Command::new(program)
        .args([
            "--query-gpu=name,memory.total,driver_version",
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
    parse_nvidia_smi(&String::from_utf8_lossy(&output.stdout))
}

/// `name, memory (MiB), driver` lines from nvidia-smi. Reports one actual device, the
/// one with the most memory; memory is never added across GPUs.
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
fn parse_nvidia_smi(text: &str) -> Option<Nvidia> {
    text.lines()
        .filter_map(|line| {
            let (rest, driver) = line.rsplit_once(',')?;
            let (name, memory) = rest.rsplit_once(',')?;
            Some(Nvidia {
                name: Some(name.trim().to_string()),
                memory_gi_b: Some(memory.trim().parse::<f64>().ok()? / 1024.0),
                driver: Some(driver.trim().to_string()).filter(|d| !d.is_empty()),
            })
        })
        .max_by(|a, b| {
            a.memory_gi_b
                .unwrap_or(0.0)
                .total_cmp(&b.memory_gi_b.unwrap_or(0.0))
        })
}

#[cfg(not(target_os = "windows"))]
fn nvidia_gpu() -> Nvidia {
    Nvidia::default()
}

/// Why this computer cannot make songs, if it cannot (see `plan`).
pub(crate) fn creation_hardware_blocker() -> Option<&'static str> {
    plan::current().err()
}

#[tauri::command]
async fn inspect_hardware(app: tauri::AppHandle) -> Result<Hardware, String> {
    let path = data_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut hardware = collect_hardware(path);
        // "Check again" after installing a driver must be able to unblock creating.
        plan::recheck(&hardware);
        hardware.blocker = plan::current().err();
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
    let nvidia = nvidia_gpu();
    Hardware {
        platform: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        chip: system
            .cpus()
            .first()
            .map(|c| c.brand().to_string())
            .unwrap_or_else(|| "Unknown processor".into()),
        os_version: System::long_os_version(),
        memory_gi_b: system.total_memory() as f64 / 1_073_741_824.0,
        free_disk_gi_b: disk.map(|d| d.available_space() as f64 / 1_073_741_824.0),
        gpu: nvidia.name,
        gpu_memory_gi_b: nvidia.memory_gi_b,
        gpu_driver: nvidia.driver,
        data_path: path.to_string_lossy().into_owned(),
        blocker: None,
    }
}

/// The person agreed to quit although a song was being made.
static QUIT_CONFIRMED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
/// The question is on screen; a second close must not ask twice.
static QUIT_ASKED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// Quitting stops the song being made and loses it, so ask first. True when Aulo asked
/// and the quit must wait for the answer.
fn ask_before_quitting(app: &tauri::AppHandle) -> bool {
    use std::sync::atomic::Ordering;
    use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
    if QUIT_CONFIRMED.load(Ordering::SeqCst) || !app.state::<songs::SongService>().making_songs() {
        return false;
    }
    if QUIT_ASKED.swap(true, Ordering::SeqCst) {
        return true;
    }
    let handle = app.clone();
    app.dialog()
        .message("If you quit now, the song being made stops and is lost.")
        .title("Quit while a song is being made?")
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom(
            "Quit".into(),
            "Keep making".into(),
        ))
        .show(move |quit| {
            QUIT_ASKED.store(false, Ordering::SeqCst);
            if quit {
                QUIT_CONFIRMED.store(true, Ordering::SeqCst);
                handle.exit(0);
            }
        });
    true
}

pub fn run() {
    let builder = tauri::Builder::default()
        // First: a second launch brings this window forward instead of loading a second
        // music engine (and a second copy of the model in memory).
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init());
    // Windows has no app menu; the macOS one names the build in its About panel.
    #[cfg(target_os = "macos")]
    let builder = builder.menu(version::menu);
    builder
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
            models::replaced_bytes,
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
            version::app_version,
            support::save_report
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if ask_before_quitting(window.app_handle()) {
                    api.prevent_close();
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("Failed to start Aulo")
        .run(|app, event| match event {
            // ⌘Q and the app menu's Quit arrive here without closing the window first.
            tauri::RunEvent::ExitRequested { api, .. } => {
                if ask_before_quitting(app) {
                    api.prevent_exit();
                }
            }
            // Never leave a music engine running after Aulo quits.
            tauri::RunEvent::Exit => app.state::<songs::SongService>().shutdown(),
            _ => {}
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
            os_version: None,
            memory_gi_b: 32.0,
            free_disk_gi_b: None,
            gpu: None,
            gpu_memory_gi_b: None,
            gpu_driver: None,
            data_path: "/test/models".into(),
            blocker: None,
        };
        let json = serde_json::to_value(report).unwrap();
        assert_eq!(json["memoryGiB"], 32.0);
        assert!(json["freeDiskGiB"].is_null());
        assert!(json["gpuMemoryGiB"].is_null());
        assert_eq!(json["dataPath"], "/test/models");
        assert!(json.get("ready").is_none());
    }

    #[test]
    fn files_record_their_format_and_older_files_read_as_the_first() {
        let saved = serde_json::to_value(crate::settings::Settings::default()).unwrap();
        assert_eq!(saved["format"], 1);
        let old: crate::collections::Collections =
            serde_json::from_str(r#"{"workspaces": [], "playlists": []}"#).unwrap();
        assert_eq!(old.format, FormatVersion::CURRENT);
    }

    #[test]
    fn the_app_has_one_version_everywhere() {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
        let read = |path: &str| -> serde_json::Value {
            serde_json::from_str(&std::fs::read_to_string(root.join(path)).unwrap()).unwrap()
        };
        let version = env!("CARGO_PKG_VERSION");
        assert_eq!(read("tauri.conf.json")["version"], version);
        assert_eq!(read("../package.json")["version"], version);
        let lock = read("../package-lock.json");
        assert_eq!(lock["version"], version);
        assert_eq!(lock["packages"][""]["version"], version);
    }

    #[test]
    fn a_panic_while_holding_a_lock_does_not_break_aulo() {
        let shared = std::sync::Arc::new(std::sync::Mutex::new(1));
        let held = shared.clone();
        let _ = std::thread::spawn(move || {
            let _guard = held.lock().unwrap();
            panic!("a bug in one command");
        })
        .join();
        assert!(shared.is_poisoned());
        *shared.held() += 1;
        assert_eq!(*shared.held(), 2);
    }

    #[test]
    fn nvidia_smi_reports_the_largest_card_with_its_driver() {
        let found = parse_nvidia_smi(
            "NVIDIA GeForce RTX 4060, 8188, 566.36\nNVIDIA RTX A4000, 16376, 566.36\nnot a card\n",
        )
        .unwrap();
        assert_eq!(found.name.as_deref(), Some("NVIDIA RTX A4000"));
        assert!((found.memory_gi_b.unwrap() - 15.99).abs() < 0.01);
        assert_eq!(found.driver.as_deref(), Some("566.36"));
        // A name with a comma in it still reads.
        let odd = parse_nvidia_smi("NVIDIA, Special, 8192, 551.0").unwrap();
        assert_eq!(odd.name.as_deref(), Some("NVIDIA, Special"));
        assert!(parse_nvidia_smi("").is_none());
    }
}
