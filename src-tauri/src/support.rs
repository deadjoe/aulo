//! Settings › Storage and Settings › Help: how much space Aulo uses, and a problem
//! report a person can save and send. Nothing here leaves the computer by itself.

use std::{
    fs,
    io::{Read, Seek, SeekFrom},
    path::Path,
};

use serde::Serialize;
use tauri::Manager;

use crate::songs::{SongService, Work};

#[derive(Debug, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StorageUsage {
    pub songs: u32,
    pub songs_bytes: u64,
    pub trash: u32,
    pub trash_bytes: u64,
    pub models_bytes: u64,
    /// The models live in a folder the person chose, outside Aulo's own folder.
    pub models_elsewhere: bool,
    pub free_bytes: Option<u64>,
}

/// Total size of a folder's files; links are not followed.
pub fn folder_bytes(path: &Path) -> u64 {
    let Ok(meta) = fs::symlink_metadata(path) else {
        return 0;
    };
    if meta.is_file() {
        return meta.len();
    }
    if !meta.is_dir() {
        return 0;
    }
    fs::read_dir(path)
        .map(|entries| entries.flatten().map(|e| folder_bytes(&e.path())).sum())
        .unwrap_or(0)
}

/// Song and Trash usage from the library's own folders.
pub fn library_usage(root: &Path, works: &[Work]) -> StorageUsage {
    let mut usage = StorageUsage::default();
    for work in works {
        let bytes = folder_bytes(&root.join(&work.id));
        if work.trashed_ms.is_some() {
            usage.trash += 1;
            usage.trash_bytes += bytes;
        } else {
            usage.songs += 1;
            usage.songs_bytes += bytes;
        }
    }
    usage
}

#[tauri::command]
pub async fn storage_usage(
    app: tauri::AppHandle,
    service: tauri::State<'_, SongService>,
) -> Result<StorageUsage, String> {
    let base = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let works = service.inner().works(&app)?;
    let models = crate::models::verified_root(&app, &app.state::<crate::models::ModelManager>());
    tauri::async_runtime::spawn_blocking(move || {
        let mut usage = library_usage(&base.join("library"), &works);
        let own = base.join("models");
        usage.models_bytes = folder_bytes(&own);
        if let Some(root) = models.filter(|root| !root.starts_with(&own)) {
            usage.models_bytes += folder_bytes(&root);
            usage.models_elsewhere = true;
        }
        let nearest = base.ancestors().find(|p| p.exists());
        usage.free_bytes = nearest.and_then(|p| fs2::available_space(p).ok());
        usage
    })
    .await
    .map_err(|e| e.to_string())
}

/// The last `limit` bytes of a log, starting at a whole line.
fn log_tail(path: &Path, limit: u64) -> String {
    let Ok(mut file) = fs::File::open(path) else {
        return "(no engine log yet)".into();
    };
    let length = file.metadata().map_or(0, |m| m.len());
    let start = length.saturating_sub(limit);
    let mut bytes = Vec::new();
    if file.seek(SeekFrom::Start(start)).is_err() || file.read_to_end(&mut bytes).is_err() {
        return "(the engine log could not be read)".into();
    }
    let text = String::from_utf8_lossy(&bytes).into_owned();
    match (start > 0, text.find('\n')) {
        (true, Some(cut)) => text[cut + 1..].to_string(),
        _ => text,
    }
}

/// Remove anything a person wrote from text that may have picked it up: every line
/// of their lyrics, styles and titles that is long enough to be recognisable.
pub fn redact(text: &str, works: &[Work]) -> String {
    let mut words: Vec<&str> = works
        .iter()
        .flat_map(|w| {
            [&w.request.lyrics, &w.request.style, &w.request.title]
                .into_iter()
                .flat_map(|field| field.lines())
        })
        .map(str::trim)
        .filter(|line| line.chars().count() >= 4)
        .collect();
    // Longest first, so a line is removed whole before any part of it.
    words.sort_by_key(|w| std::cmp::Reverse(w.len()));
    words.dedup();
    let mut out = text.to_string();
    for word in words {
        if out.contains(word) {
            out = out.replace(word, "[removed]");
        }
    }
    out
}

pub struct ReportFacts {
    pub version: String,
    pub settings: String,
    pub hardware: String,
    pub engine: String,
    pub models: String,
    pub songs: String,
    pub log: String,
}

pub fn report_text(facts: &ReportFacts) -> String {
    format!(
        "Aulo problem report\n\
         This report has no songs, lyrics, styles or titles. Send it only to someone you trust.\n\n\
         Aulo: {}\nSettings: {}\nComputer: {}\nMusic engine: {}\nMusic models: {}\nSongs: {}\n\n\
         Recent music engine messages:\n{}\n",
        facts.version,
        facts.settings,
        facts.hardware,
        facts.engine,
        facts.models,
        facts.songs,
        facts.log
    )
}

/// Settings › Help › Save a problem report.
#[tauri::command]
pub async fn save_report(
    app: tauri::AppHandle,
    service: tauri::State<'_, SongService>,
) -> Result<bool, String> {
    let Some(destination) = crate::songs::choose_save_path(&app, "Aulo problem report.txt", "txt")?
    else {
        return Ok(false);
    };
    let base = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let works = service.inner().works(&app)?;
    let engine = crate::engine::engine_status(app.clone()).await?;
    let models = crate::models::model_status(app.clone(), app.state())?;
    let settings = crate::settings::current(&app);
    let version = app.package_info().version.to_string();
    tauri::async_runtime::spawn_blocking(move || {
        let hardware = crate::collect_hardware(base.clone());
        let mut states = std::collections::BTreeMap::new();
        for work in &works {
            *states
                .entry(format!("{:?}", work.state).to_lowercase())
                .or_insert(0) += 1;
        }
        let facts = ReportFacts {
            version,
            settings: serde_json::to_string(&settings).unwrap_or_default(),
            hardware: format!(
                "{} {}, {}, {:.0} GB memory, graphics {}, {} free",
                hardware.platform,
                hardware.arch,
                hardware.chip,
                hardware.memory_gi_b,
                hardware.gpu.as_deref().unwrap_or("built in"),
                hardware
                    .free_disk_gi_b
                    .map_or("unknown".into(), |gb| format!("{gb:.0} GB")),
            ),
            engine: format!(
                "plan {:?}; {} ({}), version {}, {} / {}",
                crate::plan::current(),
                engine.state,
                engine.message,
                engine.engine_version.as_deref().unwrap_or("unknown"),
                engine.device.as_deref().unwrap_or("no device"),
                engine.backend.as_deref().unwrap_or("no backend"),
            ),
            models: format!("{} ({})", models.phase, models.message),
            songs: format!("{} in total, {:?}", works.len(), states),
            log: redact(
                &log_tail(&base.join("logs").join("engine.log"), 64 * 1024),
                &works,
            ),
        };
        fs::write(&destination, report_text(&facts))
            .map(|_| true)
            .map_err(|_| "The report couldn’t be saved there. Choose another folder.".to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn work(id: &str, trashed: bool, lyrics: &str) -> Work {
        serde_json::from_value(serde_json::json!({
            "id": id,
            "createdMs": 1,
            "request": {
                "title": "Night Drive",
                "style": "dreamy synth pop, female vocal",
                "lyrics": lyrics,
                "instrumental": false,
                "vocal": "auto",
                "weirdness": 50,
                "styleInfluence": 50
            },
            "favorite": false,
            "state": "completed",
            "trashedMs": if trashed { Some(5) } else { None },
        }))
        .unwrap()
    }

    #[test]
    fn usage_separates_songs_from_the_trash_and_ignores_links() {
        let dir = tempfile::tempdir().unwrap();
        let a = "0123456789abcdef0123456789abcdef";
        let b = "fedcba9876543210fedcba9876543210";
        for (id, size) in [(a, 1000), (b, 300)] {
            fs::create_dir_all(dir.path().join(id)).unwrap();
            fs::write(dir.path().join(id).join("audio.flac"), vec![0u8; size]).unwrap();
        }
        #[cfg(unix)]
        std::os::unix::fs::symlink(dir.path(), dir.path().join(a).join("loop")).unwrap();
        let usage = library_usage(dir.path(), &[work(a, false, "x"), work(b, true, "x")]);
        assert_eq!((usage.songs, usage.songs_bytes), (1, 1000));
        assert_eq!((usage.trash, usage.trash_bytes), (1, 300));
    }

    #[test]
    fn reports_never_carry_what_people_wrote() {
        let works = [work(
            "0123456789abcdef0123456789abcdef",
            false,
            "[Verse]\nCity lights are calling me\nOh",
        )];
        let log = "prompt: dreamy synth pop, female vocal\nlyric City lights are calling me here\nOh no\nTraceback: CUDA error\n";
        let clean = redact(log, &works);
        assert!(!clean.contains("City lights"));
        assert!(!clean.contains("dreamy synth pop"));
        assert!(clean.contains("Traceback: CUDA error"));
        // Very short lines are too common to mean anything and are left alone.
        assert!(clean.contains("Oh no"));
    }

    /// AULO_LIVE_DATA="$HOME/Library/Application Support/studio.aulo.desktop" cargo test live_report -- --ignored
    #[test]
    #[ignore = "Reads a real Aulo data folder"]
    fn live_report_and_usage_on_real_data() {
        let base = std::path::PathBuf::from(std::env::var("AULO_LIVE_DATA").unwrap());
        // Read the records directly: loading the library could rewrite them.
        let works: Vec<Work> = fs::read_dir(base.join("library"))
            .unwrap()
            .flatten()
            .filter_map(|e| fs::read(e.path().join("aulo.json")).ok())
            .filter_map(|bytes| serde_json::from_slice(&bytes).ok())
            .collect();
        let usage = library_usage(&base.join("library"), &works);
        assert_eq!((usage.songs + usage.trash) as usize, works.len());
        assert!(usage.songs_bytes > 0);
        let log = redact(
            &log_tail(&base.join("logs").join("engine.log"), 64 * 1024),
            &works,
        );
        for work in &works {
            for line in work
                .request
                .lyrics
                .lines()
                .chain(work.request.style.lines())
            {
                let line = line.trim();
                if line.chars().count() >= 4 {
                    assert!(!log.contains(line), "a written line survived");
                }
            }
        }
        println!(
            "{} songs, {} bytes, log {} bytes",
            works.len(),
            usage.songs_bytes,
            log.len()
        );
    }

    #[test]
    fn the_log_tail_starts_on_a_whole_line() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("engine.log");
        fs::write(&path, "first line\nsecond line\nthird line\n").unwrap();
        assert_eq!(log_tail(&path, 15), "third line\n");
        assert_eq!(
            log_tail(&path, 1000),
            "first line\nsecond line\nthird line\n"
        );
        assert_eq!(
            log_tail(&dir.path().join("none"), 10),
            "(no engine log yet)"
        );
    }

    #[test]
    fn the_report_says_what_it_leaves_out() {
        let text = report_text(&ReportFacts {
            version: "0.1.0".into(),
            settings: "{}".into(),
            hardware: "macos".into(),
            engine: "ready".into(),
            models: "verified".into(),
            songs: "2".into(),
            log: "ok".into(),
        });
        assert!(text.starts_with("Aulo problem report\nThis report has no songs, lyrics"));
        assert!(text.contains("Aulo: 0.1.0"));
    }
}
