//! The song service: one generation at a time, durable works, and real engine progress.
//!
//! Each work is a folder under `<app-data>/library/<id>/` with an `aulo.json` record.
//! The engine writes its artifacts into the same folder; only `completed` works point
//! at audio. Records are replaced atomically and in-flight works found at startup are
//! marked interrupted rather than presented as finished.
use crate::{engine, models};
use serde::{Deserialize, Serialize};
use std::{
    collections::VecDeque,
    fs::{self, File},
    io::{BufRead, BufReader, Read, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, Stdio},
    sync::{Arc, Condvar, Mutex},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{Emitter, Manager};

const RECORD: &str = "aulo.json";
const MAX_EVENT_BYTES: u64 = 65536;
const CANCEL_GRACE: Duration = Duration::from_secs(30);

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SongRequest {
    pub title: String,
    pub style: String,
    pub lyrics: String,
    pub instrumental: bool,
    pub vocal: String,
    pub weirdness: u8,
    pub style_influence: u8,
}

impl SongRequest {
    fn validate(&self) -> Result<(), String> {
        if self.title.chars().count() > 120 {
            return Err("Song titles can be up to 120 characters.".into());
        }
        if self.style.chars().count() > 1000 {
            return Err("Keep the style description under 1,000 characters.".into());
        }
        if self.lyrics.chars().count() > 16000 {
            return Err("These lyrics are too long for one song.".into());
        }
        if self.style.trim().is_empty() {
            return Err("Describe the sound you want first.".into());
        }
        if !self.instrumental && self.lyrics.trim().is_empty() {
            return Err("Add some lyrics, or make it an instrumental.".into());
        }
        if !matches!(self.vocal.as_str(), "auto" | "female" | "male") {
            return Err("Choose a voice.".into());
        }
        if self.weirdness > 100 || self.style_influence > 100 {
            return Err("Choose a value between 0 and 100.".into());
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub completed: u32,
    pub total: u32,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Work {
    pub id: String,
    pub created_ms: u64,
    pub request: SongRequest,
    pub favorite: bool,
    /// queued | running | completed | failed | cancelled | interrupted
    pub state: String,
    #[serde(default)]
    pub stage: Option<String>,
    #[serde(default)]
    pub progress: Option<Progress>,
    #[serde(default)]
    pub started_ms: Option<u64>,
    #[serde(default)]
    pub duration: Option<f64>,
    #[serde(default)]
    pub audio_path: Option<String>,
    #[serde(default)]
    pub message: Option<String>,
}

impl Work {
    fn active(&self) -> bool {
        matches!(self.state.as_str(), "queued" | "running")
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as u64)
}

fn new_id() -> String {
    uuid::Uuid::new_v4().simple().to_string()
}

pub fn valid_id(id: &str) -> bool {
    id.len() == 32
        && id
            .bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
}

fn write_record(root: &Path, work: &Work) -> Result<(), String> {
    let folder = root.join(&work.id);
    fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    let mut tmp = tempfile::NamedTempFile::new_in(&folder).map_err(|e| e.to_string())?;
    serde_json::to_writer_pretty(&mut tmp, work).map_err(|e| e.to_string())?;
    tmp.as_file().sync_all().map_err(|e| e.to_string())?;
    tmp.persist(folder.join(RECORD))
        .map_err(|e| e.error.to_string())?;
    Ok(())
}

/// Read every work, reconciling anything a previous session left unfinished.
pub fn load_library(root: &Path) -> Vec<Work> {
    let mut works = Vec::new();
    let Ok(entries) = fs::read_dir(root) else {
        return works;
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if !valid_id(&name) {
            continue;
        }
        let Ok(bytes) = fs::read(entry.path().join(RECORD)) else {
            continue;
        };
        let Ok(mut work) = serde_json::from_slice::<Work>(&bytes) else {
            continue;
        };
        if work.id != name {
            continue;
        }
        if work.active() {
            work.state = "interrupted".into();
            work.stage = None;
            work.progress = None;
            work.message = Some("Aulo closed before this song was finished.".into());
            let _ = write_record(root, &work);
        }
        if work.state == "completed" {
            let audio = entry.path().join("audio.flac");
            if audio.is_file() && !entry.path().join("pending.json").exists() {
                work.audio_path = Some(audio.to_string_lossy().into_owned());
            } else {
                work.state = "failed".into();
                work.audio_path = None;
                work.message = Some("This song's audio file is missing.".into());
            }
        }
        works.push(work);
    }
    works.sort_by_key(|w| std::cmp::Reverse(w.created_ms));
    works
}

/// One engine event, as written by `runtime/bridge.py`.
#[derive(Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EngineEvent {
    protocol_version: u32,
    pub event: String,
    #[serde(default)]
    pub stage: Option<String>,
    #[serde(default)]
    pub completed: Option<u32>,
    #[serde(default)]
    pub total: Option<u32>,
    #[serde(default)]
    pub work: Option<EngineResult>,
}

#[derive(Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EngineResult {
    pub audio: String,
    pub duration: f64,
}

pub fn parse_event(line: &[u8]) -> Option<EngineEvent> {
    serde_json::from_slice::<EngineEvent>(line)
        .ok()
        .filter(|e| e.protocol_version == engine::PROTOCOL_VERSION)
}

/// Apply one engine event to a running work; returns true when the work changed.
pub fn apply_event(work: &mut Work, event: &EngineEvent, folder: &Path) -> bool {
    match event.event.as_str() {
        "progress" => {
            const STAGES: [&str; 6] = [
                "preparing",
                "writing",
                "performing",
                "rendering",
                "mixing",
                "saving",
            ];
            let Some(stage) = event.stage.as_deref().filter(|s| STAGES.contains(s)) else {
                return false;
            };
            work.stage = Some(stage.into());
            work.progress = match (event.completed, event.total) {
                (Some(completed), Some(total)) if total > 0 && completed <= total => {
                    Some(Progress { completed, total })
                }
                _ => None,
            };
            true
        }
        "completed" => {
            let Some(result) = &event.work else {
                return false;
            };
            let audio = folder.join("audio.flac");
            if result.audio != "audio.flac"
                || !result.duration.is_finite()
                || result.duration <= 0.0
                || !audio.is_file()
                || folder.join("pending.json").exists()
            {
                return false;
            }
            work.state = "completed".into();
            work.duration = Some(result.duration);
            work.audio_path = Some(audio.to_string_lossy().into_owned());
            work.stage = None;
            work.progress = None;
            work.message = None;
            true
        }
        "cancelled" => {
            work.state = "cancelled".into();
            work.stage = None;
            work.progress = None;
            true
        }
        "failed" => {
            work.state = "failed".into();
            work.stage = None;
            work.progress = None;
            work.message = Some("This song could not be finished. Try creating it again.".into());
            true
        }
        _ => false,
    }
}

struct Running {
    id: String,
    stdin: Option<ChildStdin>,
    child: Arc<Mutex<Child>>,
}

#[derive(Default)]
struct State {
    loaded: bool,
    works: Vec<Work>,
    queue: VecDeque<String>,
    running: Option<Running>,
    /// A cancellation for the work being started or run; it survives the gap before spawn.
    cancel_id: Option<String>,
    worker: bool,
}

#[derive(Clone, Default)]
pub struct SongService(Arc<(Mutex<State>, Condvar)>);

fn library_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("library"))
}

impl SongService {
    fn with_state<T>(
        &self,
        app: &tauri::AppHandle,
        f: impl FnOnce(&mut State) -> T,
    ) -> Result<T, String> {
        let root = library_root(app)?;
        let mut state = self.0 .0.lock().unwrap();
        if !state.loaded {
            state.works = load_library(&root);
            state.loaded = true;
        }
        Ok(f(&mut state))
    }

    fn publish(app: &tauri::AppHandle, work: &Work) {
        let _ = app.emit("song-updated", work);
    }

    fn update(&self, app: &tauri::AppHandle, id: &str, persist: bool, f: impl FnOnce(&mut Work)) {
        let Ok(root) = library_root(app) else { return };
        let mut state = self.0 .0.lock().unwrap();
        if let Some(work) = state.works.iter_mut().find(|w| w.id == id) {
            f(work);
            if persist {
                let _ = write_record(&root, work);
            }
            Self::publish(app, work);
        }
    }

    fn ensure_worker(&self, app: &tauri::AppHandle) {
        let mut state = self.0 .0.lock().unwrap();
        if state.worker {
            return;
        }
        state.worker = true;
        let service = self.clone();
        let app = app.clone();
        std::thread::spawn(move || service.work_loop(app));
    }

    fn work_loop(&self, app: tauri::AppHandle) {
        loop {
            let id = {
                let (lock, wake) = &*self.0;
                let mut state = lock.lock().unwrap();
                loop {
                    if let Some(id) = state.queue.pop_front() {
                        break id;
                    }
                    state = wake.wait(state).unwrap();
                }
            };
            let result = self.run_one(&app, &id);
            let cancelled = {
                let mut state = self.0 .0.lock().unwrap();
                state.running = None;
                state.cancel_id.take().is_some_and(|c| c == id)
            };
            self.update(&app, &id, true, |work| {
                if work.active() {
                    match &result {
                        _ if cancelled => {
                            work.state = "cancelled".into();
                            work.message = None;
                        }
                        Ok(()) => {
                            work.state = "failed".into();
                            work.message = Some(
                                "The music engine stopped before the song was finished.".into(),
                            );
                        }
                        Err(message) => {
                            work.state = "failed".into();
                            work.message = Some(message.clone());
                        }
                    }
                    work.stage = None;
                    work.progress = None;
                }
            });
        }
    }

    fn run_one(&self, app: &tauri::AppHandle, id: &str) -> Result<(), String> {
        let base = app.path().app_data_dir().map_err(|e| e.to_string())?;
        let root = base.join("library");
        let model_root = models::verified_root(app, &app.state::<models::ModelManager>())
            .ok_or("Your music models need to be checked again before creating.")?;
        let request = {
            let state = self.0 .0.lock().unwrap();
            let work = state
                .works
                .iter()
                .find(|w| w.id == id)
                .ok_or("Missing work")?;
            if work.state != "queued" {
                return Ok(());
            }
            work.request.clone()
        };
        self.update(app, id, true, |work| {
            work.state = "running".into();
            work.stage = Some("preparing".into());
            work.started_ms = Some(now_ms());
        });
        let folder = root.join(id);
        let line = serde_json::json!({
            "protocolVersion": engine::PROTOCOL_VERSION,
            "operation": "generate",
            "workId": id,
            "style": request.style,
            "lyrics": request.lyrics,
            "instrumental": request.instrumental,
            "vocal": request.vocal,
            "weirdness": request.weirdness,
            "styleInfluence": request.style_influence,
            "modelRoot": model_root,
            "outputRoot": root,
        });
        let script = engine::bridge_script().map_err(|e| e.to_string())?;
        let python = engine::interpreter(&base);
        let mut command = engine::bridge_command(&python, script.path(), &base);
        let log = File::create(folder.join("engine.log")).map_err(|e| e.to_string())?;
        command.stderr(Stdio::from(log));
        let service = self.clone();
        let app_events = app.clone();
        let id_events = id.to_string();
        run_engine(
            command,
            &line,
            |child, stdin| {
                let mut state = service.0 .0.lock().unwrap();
                state.running = Some(Running {
                    id: id_events.clone(),
                    stdin: Some(stdin),
                    child,
                });
                let cancel_requested = state.cancel_id.as_deref() == Some(id_events.as_str());
                drop(state);
                if cancel_requested {
                    service.request_cancel(&id_events);
                }
            },
            |event| {
                service.update(&app_events, &id_events, event.event != "progress", |work| {
                    apply_event(work, &event, &folder);
                });
            },
        )
    }

    fn request_cancel(&self, id: &str) {
        let child = {
            let mut state = self.0 .0.lock().unwrap();
            state.cancel_id = Some(id.to_string());
            let Some(running) = state.running.as_mut().filter(|r| r.id == id) else {
                return;
            };
            if let Some(stdin) = running.stdin.as_mut() {
                let _ = stdin.write_all(b"cancel\n").and_then(|_| stdin.flush());
            }
            running.child.clone()
        };
        // The engine stops at its next checkpoint; stop it outright if it does not.
        std::thread::spawn(move || {
            let started = std::time::Instant::now();
            while started.elapsed() < CANCEL_GRACE {
                if child
                    .lock()
                    .unwrap()
                    .try_wait()
                    .map_or(true, |s| s.is_some())
                {
                    return;
                }
                std::thread::sleep(Duration::from_millis(200));
            }
            let mut child = child.lock().unwrap();
            let _ = child.kill();
        });
    }
}

/// Run one bridge process: send the request, stream events, and wait for exit.
pub fn run_engine(
    mut command: std::process::Command,
    request: &serde_json::Value,
    started: impl FnOnce(Arc<Mutex<Child>>, ChildStdin),
    mut on_event: impl FnMut(EngineEvent),
) -> Result<(), String> {
    let mut child = command
        .spawn()
        .map_err(|_| "The music engine could not start.".to_string())?;
    let stdout = child.stdout.take().ok_or("Missing engine output")?;
    let mut stdin = child.stdin.take().ok_or("Missing engine input")?;
    let mut line = serde_json::to_vec(request).map_err(|e| e.to_string())?;
    line.push(b'\n');
    let child = Arc::new(Mutex::new(child));
    if stdin.write_all(&line).and_then(|_| stdin.flush()).is_err() {
        let mut child = child.lock().unwrap();
        let _ = child.kill();
        let _ = child.wait();
        return Err("The music engine could not start.".into());
    }
    started(child.clone(), stdin);
    let mut reader = BufReader::new(stdout);
    loop {
        let mut buffer = Vec::new();
        let read = (&mut reader)
            .take(MAX_EVENT_BYTES + 1)
            .read_until(b'\n', &mut buffer)
            .map_err(|_| "Lost contact with the music engine.")?;
        if read == 0 {
            break;
        }
        if buffer.len() as u64 > MAX_EVENT_BYTES {
            let _ = child.lock().unwrap().kill();
            break;
        }
        if let Some(event) = parse_event(&buffer) {
            on_event(event);
        }
    }
    // Reap the process; a cancel watchdog may hold the lock briefly.
    loop {
        if let Ok(Some(_)) | Err(_) = child.lock().unwrap().try_wait() {
            break;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreationStatus {
    ready: bool,
    /// models | engine | unsupported | ready
    blocker: &'static str,
    message: String,
}

#[tauri::command]
pub async fn creation_status(app: tauri::AppHandle) -> Result<CreationStatus, String> {
    let models_ready = models::verified_root(&app, &app.state::<models::ModelManager>()).is_some();
    let engine = engine::engine_status(app.clone()).await?;
    Ok(if !models_ready {
        CreationStatus {
            ready: false,
            blocker: "models",
            message: "Finish preparing the music models to start creating.".into(),
        }
    } else if !engine.generation_ready {
        CreationStatus {
            ready: false,
            blocker: if engine.state == "unsupported" {
                "unsupported"
            } else {
                "engine"
            },
            message: engine.message.into(),
        }
    } else {
        CreationStatus {
            ready: true,
            blocker: "ready",
            message: "Ready to create.".into(),
        }
    })
}

#[tauri::command]
pub fn list_songs(
    app: tauri::AppHandle,
    service: tauri::State<SongService>,
) -> Result<Vec<Work>, String> {
    service.with_state(&app, |state| state.works.clone())
}

#[tauri::command]
pub fn create_song(
    app: tauri::AppHandle,
    service: tauri::State<SongService>,
    request: SongRequest,
) -> Result<Work, String> {
    request.validate()?;
    if app.state::<engine::EngineCache>().ready().is_none()
        || models::verified_root(&app, &app.state::<models::ModelManager>()).is_none()
    {
        return Err("Aulo isn't ready to create yet.".into());
    }
    let root = library_root(&app)?;
    let mut request = request;
    request.title = request.title.trim().to_string();
    let work = Work {
        id: new_id(),
        created_ms: now_ms(),
        request,
        favorite: false,
        state: "queued".into(),
        stage: None,
        progress: None,
        started_ms: None,
        duration: None,
        audio_path: None,
        message: None,
    };
    write_record(&root, &work)?;
    service.with_state(&app, |state| {
        state.works.insert(0, work.clone());
        state.queue.push_back(work.id.clone());
    })?;
    service.0 .1.notify_one();
    service.ensure_worker(&app);
    SongService::publish(&app, &work);
    Ok(work)
}

#[tauri::command]
pub fn cancel_song(
    app: tauri::AppHandle,
    service: tauri::State<SongService>,
    id: String,
) -> Result<(), String> {
    let (queued, active) = service.with_state(&app, |state| {
        let queued = state.queue.iter().any(|q| q == &id);
        state.queue.retain(|q| q != &id);
        let active = state.works.iter().any(|w| w.id == id && w.active());
        (queued, active)
    })?;
    if !active {
        return Ok(());
    }
    if queued {
        service.update(&app, &id, true, |work| {
            work.state = "cancelled".into();
        });
    } else {
        service.request_cancel(&id);
    }
    Ok(())
}

#[tauri::command]
pub fn update_song(
    app: tauri::AppHandle,
    service: tauri::State<SongService>,
    id: String,
    title: Option<String>,
    favorite: Option<bool>,
) -> Result<(), String> {
    if let Some(title) = &title {
        if title.chars().count() > 120 {
            return Err("Song titles can be up to 120 characters.".into());
        }
    }
    service.with_state(&app, |_| ())?;
    service.update(&app, &id, true, |work| {
        if let Some(title) = title {
            work.request.title = title.trim().to_string();
        }
        if let Some(favorite) = favorite {
            work.favorite = favorite;
        }
    });
    Ok(())
}

#[tauri::command]
pub fn delete_song(
    app: tauri::AppHandle,
    service: tauri::State<SongService>,
    id: String,
) -> Result<(), String> {
    if !valid_id(&id) {
        return Err("Unknown song.".into());
    }
    let root = library_root(&app)?;
    service.with_state(&app, |state| {
        let work = state
            .works
            .iter()
            .find(|w| w.id == id)
            .ok_or("Unknown song.")?;
        if work.active() {
            return Err("Stop this song before deleting it.".to_string());
        }
        fs::remove_dir_all(root.join(&id))
            .map_err(|_| "This song could not be deleted.".to_string())?;
        state.works.retain(|w| w.id != id);
        Ok(())
    })?
}

#[cfg(test)]
mod tests;
