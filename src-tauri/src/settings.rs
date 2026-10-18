//! The few choices a person can make in Settings, saved in Aulo's data folder.
//! Everything has a default that is right for most people, so a missing or
//! unreadable file simply means "the defaults".

use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
    time::Duration,
};

use serde::{Deserialize, Serialize};
use tauri::Manager;

const FILE: &str = "settings.json";

/// How long the music engine stays loaded after the last song.
#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum KeepReady {
    /// Give the memory back ten minutes after the last song.
    #[default]
    SaveMemory,
    /// Stay loaded until Aulo quits, so the next song starts sooner.
    Faster,
}

impl KeepReady {
    /// None: never unload while Aulo runs.
    pub fn idle_limit(self) -> Option<Duration> {
        match self {
            Self::SaveMemory => Some(Duration::from_secs(600)),
            Self::Faster => None,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    /// A system notification when a song finishes or fails while Aulo is in the background.
    pub notify_when_done: bool,
    pub keep_ready: KeepReady,
    /// Delete songs that have been in Aulo's Trash this many days; None keeps them.
    pub empty_trash_after_days: Option<u32>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            notify_when_done: true,
            keep_ready: KeepReady::SaveMemory,
            empty_trash_after_days: None,
        }
    }
}

/// The only Trash periods Settings offers.
pub const TRASH_PERIODS: [u32; 1] = [30];

impl Settings {
    fn valid(&self) -> bool {
        self.empty_trash_after_days
            .is_none_or(|days| TRASH_PERIODS.contains(&days))
    }
}

pub fn load(base: &Path) -> Settings {
    fs::read(base.join(FILE))
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Settings>(&bytes).ok())
        .filter(Settings::valid)
        .unwrap_or_default()
}

pub fn save(base: &Path, settings: &Settings) -> Result<(), String> {
    fs::create_dir_all(base).map_err(|e| e.to_string())?;
    let mut tmp = tempfile::NamedTempFile::new_in(base).map_err(|e| e.to_string())?;
    serde_json::to_writer_pretty(&mut tmp, settings).map_err(|e| e.to_string())?;
    tmp.as_file().sync_all().map_err(|e| e.to_string())?;
    tmp.persist(base.join(FILE))
        .map_err(|e| e.error.to_string())?;
    Ok(())
}

/// The current settings, read once and kept in memory.
#[derive(Default)]
pub struct SettingsStore(Mutex<Option<Settings>>);

fn base(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|e| e.to_string())
}

impl SettingsStore {
    pub fn get(&self, app: &tauri::AppHandle) -> Settings {
        let mut current = self.0.lock().unwrap();
        if current.is_none() {
            *current = Some(base(app).map(|b| load(&b)).unwrap_or_default());
        }
        current.clone().unwrap()
    }
}

/// The settings as Aulo uses them now.
pub fn current(app: &tauri::AppHandle) -> Settings {
    app.state::<SettingsStore>().get(app)
}

#[tauri::command]
pub fn get_settings(app: tauri::AppHandle) -> Settings {
    current(&app)
}

/// Save new settings and apply them at once.
#[tauri::command]
pub fn update_settings(app: tauri::AppHandle, settings: Settings) -> Result<Settings, String> {
    if !settings.valid() {
        return Err("That choice isn’t available.".into());
    }
    save(&base(&app)?, &settings).map_err(|_| {
        "Aulo couldn’t save your settings. Make sure your disk has free space, then try again."
            .to_string()
    })?;
    *app.state::<SettingsStore>().0.lock().unwrap() = Some(settings.clone());
    let songs = app.state::<crate::songs::SongService>();
    songs.apply_settings(&settings);
    songs.empty_expired_trash(&app);
    Ok(settings)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_or_damaged_settings_mean_the_defaults() {
        let dir = tempfile::tempdir().unwrap();
        let defaults = load(dir.path());
        assert!(defaults.notify_when_done);
        assert_eq!(defaults.keep_ready, KeepReady::SaveMemory);
        assert_eq!(defaults.empty_trash_after_days, None);
        fs::write(dir.path().join(FILE), b"{not json").unwrap();
        assert_eq!(load(dir.path()), Settings::default());
        // A value Settings never offers is not trusted.
        fs::write(dir.path().join(FILE), br#"{"emptyTrashAfterDays":1}"#).unwrap();
        assert_eq!(load(dir.path()), Settings::default());
    }

    #[test]
    fn settings_round_trip_and_unknown_fields_keep_their_defaults() {
        let dir = tempfile::tempdir().unwrap();
        let chosen = Settings {
            notify_when_done: false,
            keep_ready: KeepReady::Faster,
            empty_trash_after_days: Some(30),
        };
        save(dir.path(), &chosen).unwrap();
        assert_eq!(load(dir.path()), chosen);
        let json: serde_json::Value =
            serde_json::from_slice(&fs::read(dir.path().join(FILE)).unwrap()).unwrap();
        assert_eq!(json["keepReady"], "faster");
        fs::write(
            dir.path().join(FILE),
            br#"{"keepReady":"faster","future":1}"#,
        )
        .unwrap();
        let partial = load(dir.path());
        assert_eq!(partial.keep_ready, KeepReady::Faster);
        assert!(partial.notify_when_done);
    }

    #[test]
    fn keeping_ready_controls_how_long_the_engine_stays_loaded() {
        assert_eq!(
            KeepReady::SaveMemory.idle_limit(),
            Some(Duration::from_secs(600))
        );
        assert_eq!(KeepReady::Faster.idle_limit(), None);
    }
}
