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
    let base = crate::data_dir(&app)?;
    let works = service.inner().works(&app)?;
    let models = crate::models::verified_root(&app, &app.state::<crate::models::ModelManager>());
    tauri::async_runtime::spawn_blocking(move || {
        let mut usage = library_usage(&base.join("library"), &works);
        let own = crate::models::models_home(&base);
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

/// Replace the person's home folder, and their account name where it is part of a
/// path, wherever they appear: paths in the report and the log say who the person is.
pub fn without_identity(text: &str, home: Option<&str>, user: Option<&str>) -> String {
    let mut out = text.to_string();
    if let Some(home) = home.filter(|h| h.len() > 1) {
        out = out.replace(home, "~");
        // Windows paths can appear with either slash.
        out = out.replace(&home.replace('\\', "/"), "~");
    }
    if let Some(user) = user.filter(|u| !u.is_empty()) {
        for sep in ['/', '\\'] {
            out = out.replace(
                &format!("{sep}{user}{sep}"),
                &format!("{sep}[account]{sep}"),
            );
        }
    }
    out
}

/// A UTC date and time, from milliseconds since 1970.
pub fn utc(ms: u64) -> String {
    let secs = ms / 1000;
    let days = (secs / 86_400) as i64;
    let (h, m) = ((secs % 86_400) / 3600, (secs % 3600) / 60);
    // Howard Hinnant's days-to-civil conversion.
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!("{year:04}-{month:02}-{day:02} {h:02}:{m:02} UTC")
}

fn minutes(ms: u64) -> String {
    let s = ms / 1000;
    format!("{}:{:02}", s / 60, s % 60)
}

/// One line about a song, with nothing the person wrote: only its shape and outcome.
pub fn song_line(work: &Work) -> String {
    let request = &work.request;
    let mut parts = vec![
        utc(work.created_ms),
        format!("{:?}", work.state).to_lowercase(),
    ];
    if let Some(reason) = &work.failure {
        parts.push(format!("reason {reason}"));
    }
    if let (Some(stage), false) = (&work.stage, work.state == crate::songs::SongState::Running) {
        parts.push(format!("stopped while {stage}"));
    }
    match (work.started_ms, work.finished_ms, work.duration) {
        (Some(start), Some(end), Some(audio)) if end > start => {
            let run = end - start;
            parts.push(format!(
                "made in {} for {} of audio ({:.1}× its length)",
                minutes(run),
                minutes((audio * 1000.0) as u64),
                run as f64 / 1000.0 / audio.max(1.0)
            ));
        }
        (Some(start), Some(end), None) if end > start => {
            parts.push(format!("ran {}", minutes(end - start)));
        }
        _ => {}
    }
    if request.instrumental {
        parts.push("instrumental".into());
    } else {
        let lines = request
            .lyrics
            .lines()
            .filter(|l| !l.trim().is_empty())
            .count();
        parts.push(format!(
            "lyrics {} characters in {} lines",
            request.lyrics.chars().count(),
            lines
        ));
    }
    parts.push(format!(
        "style {} characters, voice {}, weirdness {}, style influence {}",
        request.style.chars().count(),
        request.vocal,
        request.weirdness,
        request.style_influence
    ));
    parts.join(" · ")
}

/// Every song's outcome counted, and the latest songs one line each.
pub fn songs_section(works: &[Work], latest: usize) -> Vec<(String, String)> {
    let mut states = std::collections::BTreeMap::<String, usize>::new();
    let mut reasons = std::collections::BTreeMap::<String, usize>::new();
    for work in works {
        *states
            .entry(format!("{:?}", work.state).to_lowercase())
            .or_default() += 1;
        if let Some(reason) = &work.failure {
            *reasons.entry(reason.clone()).or_default() += 1;
        }
    }
    let count = |map: &std::collections::BTreeMap<String, usize>| {
        map.iter()
            .map(|(k, v)| format!("{v} {k}"))
            .collect::<Vec<_>>()
            .join(", ")
    };
    let mut lines = vec![(
        "All songs".to_string(),
        if works.is_empty() {
            "none yet".into()
        } else {
            format!("{} ({})", works.len(), count(&states))
        },
    )];
    if !reasons.is_empty() {
        lines.push(("Failures by reason".into(), count(&reasons)));
    }
    if let Some(typical) = crate::songs::typical_run_ms(works) {
        lines.push(("Usual time per song".into(), minutes(typical)));
    }
    let mut newest: Vec<&Work> = works.iter().collect();
    newest.sort_by_key(|w| std::cmp::Reverse(w.created_ms));
    for (n, work) in newest.into_iter().take(latest).enumerate() {
        lines.push((format!("Song {}", n + 1), song_line(work)));
    }
    lines
}

pub struct Section {
    pub title: &'static str,
    pub lines: Vec<(String, String)>,
}

pub fn report_text(saved_ms: u64, sections: &[Section], log: &str) -> String {
    let mut out = format!(
        "Aulo problem report\n\
         Saved {}. It has none of your songs, lyrics, styles, titles or your name.\n\
         Send it only to someone you trust.\n",
        utc(saved_ms)
    );
    for section in sections {
        out.push_str(&format!("\n== {}\n", section.title));
        let width = section
            .lines
            .iter()
            .map(|(label, _)| label.chars().count())
            .max()
            .unwrap_or(0);
        for (label, value) in &section.lines {
            let pad = width - label.chars().count();
            out.push_str(&format!("{label}:{} {value}\n", " ".repeat(pad)));
        }
    }
    out.push_str("\n== Recent music engine messages\n");
    out.push_str(log);
    if !log.ends_with('\n') {
        out.push('\n');
    }
    out
}

fn gb(value: f64) -> String {
    format!("{value:.0} GB")
}

/// Everything the problem report says above the engine log.
pub struct ReportInputs {
    pub version: String,
    pub base: std::path::PathBuf,
    pub settings: crate::settings::Settings,
    pub hardware: crate::Hardware,
    pub plan: Result<crate::plan::Plan, &'static str>,
    pub creation: Result<crate::songs::CreationStatus, String>,
    pub engine: Result<crate::engine::EngineStatus, String>,
    /// The built engine's own `engine.json`, when one was found.
    pub engine_json: Option<String>,
    pub models: Vec<(String, String)>,
    pub works: Vec<Work>,
}

pub fn report_sections(r: ReportInputs) -> Vec<Section> {
    let ReportInputs {
        version,
        base,
        settings,
        hardware,
        plan,
        creation,
        engine,
        engine_json,
        models,
        works,
    } = r;
    let summary = vec![
        (
            "Can make songs".to_string(),
            match &creation {
                Ok(c) if c.ready => "yes".into(),
                Ok(c) => format!("no, {} ({})", c.blocker, c.message),
                Err(e) => format!("unknown ({e})"),
            },
        ),
        (
            "Engine plan".into(),
            match plan {
                Ok(p) => format!(
                    "{}{}, songs up to about {}",
                    match p.engine {
                        crate::plan::Engine::Torch => "PyTorch",
                        crate::plan::Engine::Gguf => "GGUF (yue2.cpp)",
                    },
                    p.context_cap
                        .map(|c| format!(" with the small context ({c} tokens)"))
                        .unwrap_or_default(),
                    minutes(u64::from(p.max_song_seconds()) * 1000)
                ),
                Err(reason) => format!("none: {reason}"),
            },
        ),
    ];
    let data = base.to_string_lossy().into_owned();
    let aulo = vec![
        (
            "Version".to_string(),
            format!(
                "{version} ({} build)",
                if cfg!(debug_assertions) {
                    "development"
                } else {
                    "release"
                }
            ),
        ),
        ("Data folder".into(), data.clone()),
        (
            "Data folder name".into(),
            if data.is_ascii() {
                "English letters only".into()
            } else {
                "has other letters (models kept elsewhere on Windows)".into()
            },
        ),
        (
            "Settings".into(),
            format!(
                "notify when done {}, between songs {:?}, empty Trash after {}",
                if settings.notify_when_done {
                    "on"
                } else {
                    "off"
                },
                settings.keep_ready,
                settings
                    .empty_trash_after_days
                    .map_or("never".into(), |d| format!("{d} days"))
            ),
        ),
    ];
    let graphics = match (&hardware.gpu, hardware.gpu_memory_gi_b) {
        (Some(name), Some(memory)) => format!(
            "{name}, {} of its own memory, driver {}",
            gb(memory),
            hardware.gpu_driver.as_deref().unwrap_or("unknown")
        ),
        (Some(name), None) => name.clone(),
        (None, _) if hardware.platform == "macos" => {
            "Apple silicon graphics (shares the computer’s memory)".into()
        }
        (None, _) => "no NVIDIA graphics card found".into(),
    };
    let computer = vec![
        (
            "System".to_string(),
            format!(
                "{} ({} {})",
                hardware.os_version.as_deref().unwrap_or("unknown version"),
                hardware.platform,
                hardware.arch
            ),
        ),
        ("Processor".into(), hardware.chip.clone()),
        ("Memory".into(), gb(hardware.memory_gi_b)),
        ("Graphics".into(), graphics),
        (
            "Free disk space".into(),
            hardware.free_disk_gi_b.map_or("unknown".into(), gb),
        ),
    ];
    let engine_lines = vec![
        (
            "State".to_string(),
            match &engine {
                Ok(e) => format!("{} ({})", e.state, e.message),
                Err(e) => format!("unknown ({e})"),
            },
        ),
        (
            "Versions".into(),
            match &engine {
                Ok(e) => format!(
                    "GROOVE {}, PyTorch {}",
                    e.engine_version.as_deref().unwrap_or("unknown"),
                    e.torch_version.as_deref().unwrap_or("unknown")
                ),
                Err(_) => "unknown".into(),
            },
        ),
        (
            "Running on".into(),
            match &engine {
                Ok(e) => format!(
                    "{} with {}",
                    e.device.as_deref().unwrap_or("no device"),
                    e.backend.as_deref().unwrap_or("no engine")
                ),
                Err(_) => "unknown".into(),
            },
        ),
        (
            "Built engine".into(),
            engine_json
                .map(|text| text.split_whitespace().collect::<Vec<_>>().join(" "))
                .unwrap_or_else(|| "no engine.json found".into()),
        ),
    ];
    vec![
        Section {
            title: "Summary",
            lines: summary,
        },
        Section {
            title: "Aulo",
            lines: aulo,
        },
        Section {
            title: "Computer",
            lines: computer,
        },
        Section {
            title: "Music engine",
            lines: engine_lines,
        },
        Section {
            title: "Music models",
            lines: models,
        },
        Section {
            title: "Songs",
            lines: songs_section(&works, 10),
        },
    ]
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
    let base = crate::data_dir(&app)?;
    let works = service.inner().works(&app)?;
    // Each part is reported as it is; none of them may stop the report.
    let engine = crate::engine::engine_status(app.clone()).await;
    let creation = crate::songs::creation_status(app.clone()).await;
    let models = crate::models::report_lines(&app, &app.state::<crate::models::ModelManager>());
    let settings = crate::settings::current(&app);
    let version = app.package_info().version.to_string();
    let resources = crate::engine::resources(&app).ok();
    tauri::async_runtime::spawn_blocking(move || {
        let hardware = crate::collect_hardware(base.clone());
        let engine_json = resources
            .as_deref()
            .map(crate::engine::interpreter)
            .and_then(|python| {
                python
                    .ancestors()
                    .take(4)
                    .map(|dir| dir.join("engine.json"))
                    .find(|p| p.is_file())
            })
            .and_then(|p| fs::read_to_string(p).ok());
        let sections = report_sections(ReportInputs {
            version,
            base: base.clone(),
            settings,
            hardware,
            plan: crate::plan::current(),
            creation,
            engine,
            engine_json,
            models,
            works: works.clone(),
        });
        let log = redact(
            &log_tail(&base.join("logs").join("engine.log"), 64 * 1024),
            &works,
        );
        let home = std::env::var("HOME")
            .or_else(|_| std::env::var("USERPROFILE"))
            .ok();
        let user = std::env::var("USER")
            .or_else(|_| std::env::var("USERNAME"))
            .ok();
        let text = without_identity(
            &report_text(now_ms(), &sections, &log),
            home.as_deref(),
            user.as_deref(),
        );
        fs::write(&destination, text)
            .map(|_| true)
            .map_err(|_| "The report couldn’t be saved there. Choose another folder.".to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as u64)
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
    fn reports_name_neither_the_person_nor_their_home() {
        let text = "Data folder: /Users/张三/Library/Aulo\n\
                    log: C:\\Users\\张三\\AppData\\x and C:/Users/张三/AppData/y\n\
                    mount /Volumes/张三/models\nCan make songs: yes";
        let clean = without_identity(text, Some("/Users/张三"), Some("张三"));
        assert!(!clean.contains("张三"), "{clean}");
        assert!(clean.contains("~/Library/Aulo"));
        assert!(clean.contains("/Volumes/[account]/models"));
        let windows = without_identity(text, Some("C:\\Users\\张三"), Some("张三"));
        assert!(windows.contains("~\\AppData\\x") && windows.contains("~/AppData/y"));
        // A short account name inside ordinary words is left alone.
        let short = without_identity("Can make songs: yes", None, Some("an"));
        assert_eq!(short, "Can make songs: yes");
    }

    #[test]
    fn dates_are_written_in_utc() {
        assert_eq!(utc(0), "1970-01-01 00:00 UTC");
        assert_eq!(
            utc(1_792_368_000_000 + 15 * 3_600_000 + 2 * 60_000),
            "2026-10-19 15:02 UTC"
        );
        assert_eq!(utc(951_782_400_000), "2000-02-29 00:00 UTC");
    }

    #[test]
    fn song_lines_describe_the_outcome_and_never_the_words() {
        let mut failed = work(
            "0123456789abcdef0123456789abcdef",
            false,
            "[Verse]\nCity lights",
        );
        failed.state = crate::songs::SongState::Failed;
        failed.failure = Some("out_of_memory".into());
        failed.stage = Some("performing".into());
        failed.started_ms = Some(1_000);
        failed.finished_ms = Some(191_000);
        let line = song_line(&failed);
        assert!(line.contains("failed · reason out_of_memory · stopped while performing"));
        assert!(line.contains("ran 3:10") && line.contains("lyrics 19 characters in 2 lines"));
        assert!(!line.contains("City") && !line.contains("Night Drive") && !line.contains("synth"));

        let mut done = work("fedcba9876543210fedcba9876543210", false, "x");
        done.started_ms = Some(0);
        done.finished_ms = Some(240_000);
        done.duration = Some(120.0);
        assert!(song_line(&done).contains("made in 4:00 for 2:00 of audio (2.0× its length)"));
        let section = songs_section(&[failed, done], 10);
        assert_eq!(section[0].1, "2 (1 completed, 1 failed)");
        assert_eq!(
            section[1],
            ("Failures by reason".into(), "1 out_of_memory".into())
        );
        assert_eq!(section[2], ("Usual time per song".into(), "4:00".into()));
    }

    #[test]
    fn the_report_reads_as_labelled_sections() {
        let text = report_text(
            0,
            &[Section {
                title: "Computer",
                lines: vec![
                    ("System".into(), "macOS".into()),
                    ("Free disk space".into(), "9 GB".into()),
                ],
            }],
            "no log",
        );
        assert!(text.starts_with("Aulo problem report\nSaved 1970-01-01 00:00 UTC."));
        assert!(text.contains("\n== Computer\nSystem:          macOS\nFree disk space: 9 GB\n"));
        assert!(text.ends_with("== Recent music engine messages\nno log\n"));
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
        let text = report_text(0, &[], "ok");
        assert!(text.contains("It has none of your songs, lyrics, styles, titles or your name."));
    }

    #[test]
    fn a_full_report_for_a_small_windows_pc() {
        let mut failed = work(
            "0123456789abcdef0123456789abcdef",
            false,
            "[Verse]\nCity lights",
        );
        failed.state = crate::songs::SongState::Failed;
        failed.failure = Some("graphics_driver".into());
        failed.stage = Some("preparing".into());
        let sections = report_sections(ReportInputs {
            version: "0.1.0".into(),
            base: r"C:\Users\张三\AppData\Local\studio.aulo.desktop".into(),
            settings: Default::default(),
            hardware: crate::Hardware {
                platform: "windows".into(),
                arch: "x86_64".into(),
                chip: "AMD Ryzen 7 7700".into(),
                os_version: Some("Windows 11 (26100)".into()),
                memory_gi_b: 31.8,
                free_disk_gi_b: Some(120.4),
                gpu: Some("NVIDIA GeForce RTX 4060".into()),
                gpu_memory_gi_b: Some(8.0),
                gpu_driver: Some("566.36".into()),
                data_path: String::new(),
            },
            plan: Ok(crate::plan::Plan {
                engine: crate::plan::Engine::Gguf,
                context_cap: Some(crate::plan::SMALL_CONTEXT),
            }),
            creation: Err("not checked".into()),
            engine: Err("not started".into()),
            engine_json: Some("{\n  \"groove\": \"1.0.10\"\n}".into()),
            models: vec![("State".into(), "verified (Music models are ready.)".into())],
            works: vec![failed],
        });
        let text = without_identity(
            &report_text(0, &sections, "log"),
            Some(r"C:\Users\张三"),
            Some("张三"),
        );
        if let Ok(path) = std::env::var("AULO_SAMPLE_REPORT") {
            fs::write(path, &text).unwrap();
        }
        for heading in [
            "Summary",
            "Aulo",
            "Computer",
            "Music engine",
            "Music models",
            "Songs",
        ] {
            assert!(text.contains(&format!("\n== {heading}\n")), "{heading}");
        }
        assert!(text.contains(
            "GGUF (yue2.cpp) with the small context (12288 tokens), songs up to about 4:50"
        ));
        assert!(text.contains("NVIDIA GeForce RTX 4060, 8 GB of its own memory, driver 566.36"));
        assert!(text.contains("Windows 11 (26100) (windows x86_64)"));
        assert!(text.contains("has other letters"));
        assert!(text.contains("reason graphics_driver · stopped while preparing"));
        assert!(text.contains("Built engine:") && text.contains("{ \"groove\": \"1.0.10\" }"));
        assert!(!text.contains("张三") && !text.contains("City"));
    }
}
