//! The song service: one generation at a time, durable works, and real engine progress.
//!
//! Each work is a folder under `<app-data>/library/<id>/` with an `aulo.json` record.
//! The engine writes its artifacts into the same folder; only `completed` works point
//! at audio. Records are replaced atomically and in-flight works found at startup are
//! marked interrupted rather than presented as finished.
use crate::{
    collections::{Collections, Playlist, Workspace, DEFAULT_WORKSPACE},
    engine, models,
    runner::{send_line, EngineProcess, KeepAwake, Output},
};
use serde::{Deserialize, Serialize};
use std::{
    collections::VecDeque,
    fs::{self, File},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{Arc, Condvar, Mutex},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{Emitter, Manager};

const RECORD: &str = "aulo.json";
const CANCEL_GRACE: Duration = Duration::from_secs(30);
/// Starting includes importing PyTorch; the first song then loads the model.
const ENGINE_START: Duration = Duration::from_secs(180);
/// Every stage reports at least every 100 tokens or render step; silence this long is a hang.
const ENGINE_WATCHDOG: Duration = Duration::from_secs(600);
/// After this long without songs, the engine exits and returns its memory.

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

/// Where a song is in its life. Serialized in lowercase in `aulo.json` and to the UI.
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SongState {
    Queued,
    Running,
    Completed,
    Failed,
    Cancelled,
    Interrupted,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Work {
    pub id: String,
    pub created_ms: u64,
    pub request: SongRequest,
    pub favorite: bool,
    pub state: SongState,
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
    /// The workspace the song belongs to; older records belong to My Workspace.
    #[serde(default = "default_workspace")]
    pub workspace: String,
    /// Set while the song is in Aulo's Trash; it can be restored until deleted.
    #[serde(default)]
    pub trashed_ms: Option<u64>,
    /// The engine seed this take used, recorded so a take can be reproduced.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub seed: Option<u32>,
}

fn default_workspace() -> String {
    DEFAULT_WORKSPACE.into()
}

impl Work {
    fn active(&self) -> bool {
        matches!(self.state, SongState::Queued | SongState::Running)
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

/// A fresh take: any value the engine accepts, below 2^31.
fn new_seed() -> u32 {
    (uuid::Uuid::new_v4().as_u128() as u32) & 0x7FFF_FFFF
}

pub fn valid_id(id: &str) -> bool {
    id.len() == 32
        && id
            .bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
}

const NOT_SAVED: &str =
    "Aulo couldn’t save that change. Make sure your disk has free space, then try again.";

/// Change a work and save it, or leave it exactly as it was.
fn save_change(root: &Path, work: &mut Work, f: impl FnOnce(&mut Work)) -> Result<(), String> {
    let before = work.clone();
    f(work);
    write_record(root, work).map_err(|_| {
        *work = before;
        NOT_SAVED.to_string()
    })
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
            let audio = entry.path().join("audio.flac");
            // The engine removes pending.json only after the audio is complete and flushed,
            // so a finished song whose record could not be saved is still recognised.
            let finished = (!entry.path().join("pending.json").exists())
                .then(|| crate::audio::flac_duration(&audio))
                .flatten();
            if let Some(duration) = finished {
                work.state = SongState::Completed;
                work.duration = Some(duration);
                work.message = None;
            } else {
                work.state = SongState::Interrupted;
                work.message = Some("Aulo closed before this song was finished.".into());
            }
            work.stage = None;
            work.progress = None;
            let _ = write_record(root, &work);
        }
        if work.state == SongState::Completed {
            let audio = entry.path().join("audio.flac");
            if audio.is_file() && !entry.path().join("pending.json").exists() {
                work.audio_path = Some(audio.to_string_lossy().into_owned());
            } else {
                work.state = SongState::Failed;
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
    #[serde(default)]
    pub work_id: Option<String>,
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
            work.state = SongState::Completed;
            work.duration = Some(result.duration);
            work.audio_path = Some(audio.to_string_lossy().into_owned());
            work.stage = None;
            work.progress = None;
            work.message = None;
            true
        }
        "cancelled" => {
            work.state = SongState::Cancelled;
            work.stage = None;
            work.progress = None;
            true
        }
        "failed" => {
            work.state = SongState::Failed;
            work.stage = None;
            work.progress = None;
            work.message = Some("This song could not be finished. Try creating it again.".into());
            true
        }
        _ => false,
    }
}

/// Settle a song once its engine run is over. A song the engine already finished is
/// left alone; one still marked active ended without a result.
pub fn finish(work: &mut Work, result: &Result<(), String>, cancelled: bool) {
    if !work.active() {
        return;
    }
    if cancelled {
        work.state = SongState::Cancelled;
        work.message = None;
    } else {
        work.state = SongState::Failed;
        work.message = Some(match result {
            Ok(()) => "This song could not be finished. Try creating it again.".into(),
            Err(message) => message.clone(),
        });
    }
    work.stage = None;
    work.progress = None;
}

#[derive(Default)]
struct State {
    loaded: bool,
    works: Vec<Work>,
    collections: Collections,
    queue: VecDeque<String>,
    /// The work the engine is making now.
    current: Option<String>,
    /// A cancellation for the work being started or run; it survives the gap before sending.
    cancel_id: Option<String>,
    input: Option<Arc<Mutex<Option<ChildStdin>>>>,
    child: Option<Arc<Mutex<Child>>>,
    worker: bool,
    stopping: bool,
    /// Keep the engine loaded between songs until Aulo quits (Settings › Creating).
    keep_loaded: bool,
    /// Unload the engine as soon as it is idle (Settings › Free up memory now).
    release: bool,
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

/// The engine's stderr, kept across songs and trimmed when it grows large.
pub(crate) fn engine_log(base: &Path) -> Result<File, String> {
    let folder = base.join("logs");
    fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    let path = folder.join("engine.log");
    if fs::metadata(&path).is_ok_and(|m| m.len() > 5 * 1024 * 1024) {
        let _ = fs::rename(&path, folder.join("engine.previous.log"));
    }
    fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|e| e.to_string())
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
            state.collections = Collections::load(&root);
            let mut works = load_library(&root);
            for work in &mut works {
                if !state.collections.has_workspace(&work.workspace) {
                    work.workspace = DEFAULT_WORKSPACE.into();
                }
            }
            state.works = works;
            state.loaded = true;
            state.keep_loaded =
                crate::settings::current(app).keep_ready == crate::settings::KeepReady::Faster;
        }
        Ok(f(&mut state))
    }

    fn publish(app: &tauri::AppHandle, work: &Work) {
        let _ = app.emit("song-updated", work);
    }

    fn publish_collections(app: &tauri::AppHandle, service: &SongService) {
        let collections = service.0 .0.lock().unwrap().collections.clone();
        let _ = app.emit("collections-updated", collections);
    }

    /// Apply a change the engine reports. It stays in effect even if the record can't be
    /// saved: the song's own files are the truth, and the next start reconciles from them.
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

    /// Apply a change a person asked for. If it can't be saved it is undone, so what Aulo
    /// shows never differs from what it will show after a restart.
    fn change(
        &self,
        app: &tauri::AppHandle,
        id: &str,
        f: impl FnOnce(&mut Work),
    ) -> Result<(), String> {
        let root = library_root(app)?;
        let mut state = self.0 .0.lock().unwrap();
        let Some(work) = state.works.iter_mut().find(|w| w.id == id) else {
            return Ok(());
        };
        save_change(&root, work, f)?;
        Self::publish(app, work);
        Ok(())
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

    /// Stop the engine at once; used when Aulo quits.
    pub fn shutdown(&self) {
        let child = {
            let mut state = self.0 .0.lock().unwrap();
            state.stopping = true;
            state.child.take()
        };
        self.0 .1.notify_all();
        if let Some(child) = child {
            let mut child = child.lock().unwrap();
            let _ = child.kill();
            let _ = child.wait();
        }
    }

    /// A copy of every song record.
    pub fn works(&self, app: &tauri::AppHandle) -> Result<Vec<Work>, String> {
        self.with_state(app, |state| state.works.clone())
    }

    /// Apply Settings choices that affect the running service.
    pub fn apply_settings(&self, settings: &crate::settings::Settings) {
        let mut state = self.0 .0.lock().unwrap();
        state.keep_loaded = settings.keep_ready == crate::settings::KeepReady::Faster;
        drop(state);
        self.0 .1.notify_all();
    }

    /// Whether the engine holds memory, and whether it is making a song.
    fn engine_state(&self) -> EngineMemory {
        let state = self.0 .0.lock().unwrap();
        EngineMemory {
            loaded: state.child.is_some(),
            busy: state.current.is_some() || !state.queue.is_empty(),
        }
    }

    /// Delete songs that have stayed in Aulo's Trash longer than Settings allows.
    pub fn empty_expired_trash(&self, app: &tauri::AppHandle) {
        let Some(days) = crate::settings::current(app).empty_trash_after_days else {
            return;
        };
        let Ok(expired) = self.with_state(app, |state| expired_trash(&state.works, now_ms(), days))
        else {
            return;
        };
        if expired.is_empty() {
            return;
        }
        if let Ok(deleted) = delete_trashed(app, self, &expired) {
            let _ = app.emit("songs-removed", deleted);
        }
    }

    fn forget_engine(&self) {
        let mut state = self.0 .0.lock().unwrap();
        state.input = None;
        state.child = None;
    }

    fn work_loop(&self, app: tauri::AppHandle) {
        let mut engine: Option<EngineProcess> = None;
        loop {
            let next = {
                let (lock, wake) = &*self.0;
                let mut state = lock.lock().unwrap();
                loop {
                    if state.stopping {
                        return;
                    }
                    if let Some(id) = state.queue.pop_front() {
                        break Some(id);
                    }
                    let decision = idle_wait(engine.is_some(), state.release, state.keep_loaded);
                    state.release = false;
                    match decision {
                        IdleWait::Unload => break None,
                        IdleWait::UntilWoken => state = wake.wait(state).unwrap(),
                        IdleWait::For(idle) => {
                            let (guard, waited) = wake.wait_timeout(state, idle).unwrap();
                            state = guard;
                            if waited.timed_out() && state.queue.is_empty() {
                                break None;
                            }
                        }
                    }
                }
            };
            let Some(id) = next else {
                // Idle: give the model's memory back to the computer.
                // Forget it only once it has really exited: whoever waits for the
                // engine to go (removing the models) relies on that.
                if let Some(process) = engine.take() {
                    process.shutdown(Duration::from_secs(10));
                    self.forget_engine();
                }
                continue;
            };
            let result = self.run_one(&app, &id, &mut engine);
            let cancelled = {
                let mut state = self.0 .0.lock().unwrap();
                state.current = None;
                state.cancel_id.take().is_some_and(|c| c == id)
            };
            self.update(&app, &id, true, |work| finish(work, &result, cancelled));
        }
    }

    fn start_engine(
        &self,
        base: &Path,
        resources: &Path,
        model_root: &Path,
    ) -> Result<EngineProcess, String> {
        let script = engine::bridge_script().map_err(|e| e.to_string())?;
        let python = engine::interpreter(resources);
        let mut command = engine::bridge_command(&python, script.path());
        // The downloaded GGUF files, which GROOVE's engine uses as they are.
        command.env("YUE2_GROOVE_GGUF", model_root.join("gguf"));
        command.stderr(Stdio::from(engine_log(base)?));
        let process = EngineProcess::start(
            command,
            Some(script),
            engine::PROTOCOL_VERSION,
            ENGINE_START,
        )?;
        let mut state = self.0 .0.lock().unwrap();
        state.input = Some(process.input.clone());
        state.child = Some(process.child.clone());
        Ok(process)
    }

    fn run_one(
        &self,
        app: &tauri::AppHandle,
        id: &str,
        engine: &mut Option<EngineProcess>,
    ) -> Result<(), String> {
        let base = app.path().app_data_dir().map_err(|e| e.to_string())?;
        let root = base.join("library");
        let model_root = models::verified_root(app, &app.state::<models::ModelManager>())
            .ok_or("Your music models need to be checked again before creating.")?;
        let (request, seed) = {
            let state = self.0 .0.lock().unwrap();
            let work = state
                .works
                .iter()
                .find(|w| w.id == id)
                .ok_or("Missing work")?;
            if work.state != SongState::Queued {
                return Ok(());
            }
            (work.request.clone(), work.seed.unwrap_or_else(new_seed))
        };
        self.update(app, id, true, |work| {
            work.seed = Some(seed);
            work.state = SongState::Running;
            work.stage = Some("preparing".into());
            work.started_ms = Some(now_ms());
        });
        let _awake = KeepAwake::start();
        if engine.as_ref().is_none_or(|e| !e.alive()) {
            if let Some(old) = engine.take() {
                old.kill();
            }
            let resources = engine::resources(app)?;
            *engine = Some(
                self.start_engine(&base, &resources, &model_root)
                    .map_err(|_| {
                        "The music engine could not start. Close and reopen Aulo to try again."
                            .to_string()
                    })?,
            );
        }
        let process = engine.as_ref().expect("engine started");
        process.send(&generate_command(id, &request, seed, &model_root, &root))?;
        let cancel_now = {
            let mut state = self.0 .0.lock().unwrap();
            state.current = Some(id.to_string());
            state.cancel_id.as_deref() == Some(id)
        };
        if cancel_now {
            self.request_cancel(id);
        }
        let folder = root.join(id);
        loop {
            match process.next(ENGINE_WATCHDOG) {
                Ok(Output::Event(event)) if event.work_id.as_deref() == Some(id) => {
                    let terminal =
                        matches!(event.event.as_str(), "completed" | "cancelled" | "failed");
                    self.update(app, id, event.event != "progress", |work| {
                        apply_event(work, &event, &folder);
                    });
                    if terminal {
                        return Ok(());
                    }
                }
                Ok(Output::Event(_)) => continue,
                Ok(Output::Closed) => {
                    if let Some(old) = engine.take() {
                        old.kill();
                    }
                    self.forget_engine();
                    return Err(
                        "The music engine stopped unexpectedly. Try creating this song again."
                            .into(),
                    );
                }
                Err(_) => {
                    if let Some(old) = engine.take() {
                        old.kill();
                    }
                    self.forget_engine();
                    return Err(
                        "The music engine stopped responding. Try creating this song again.".into(),
                    );
                }
            }
        }
    }

    fn request_cancel(&self, id: &str) {
        let (input, child) = {
            let mut state = self.0 .0.lock().unwrap();
            state.cancel_id = Some(id.to_string());
            if state.current.as_deref() != Some(id) {
                return;
            }
            (state.input.clone(), state.child.clone())
        };
        if let Some(input) = input {
            let _ = send_line(
                &input,
                &serde_json::json!({"operation": "cancel", "workId": id}),
            );
        }
        // The engine stops at its next checkpoint; stop the process if it does not.
        let service = self.clone();
        let id = id.to_string();
        std::thread::spawn(move || {
            let started = std::time::Instant::now();
            while started.elapsed() < CANCEL_GRACE {
                if service.0 .0.lock().unwrap().current.as_deref() != Some(id.as_str()) {
                    return;
                }
                std::thread::sleep(Duration::from_millis(250));
            }
            if let Some(child) = child {
                let mut child = child.lock().unwrap();
                let _ = child.kill();
            }
        });
    }
}

pub fn generate_command(
    id: &str,
    request: &SongRequest,
    seed: u32,
    model_root: &Path,
    output_root: &Path,
) -> serde_json::Value {
    serde_json::json!({
        "operation": "generate",
        "workId": id,
        "style": request.style,
        "lyrics": request.lyrics,
        "instrumental": request.instrumental,
        "vocal": request.vocal,
        "weirdness": request.weirdness,
        "styleInfluence": request.style_influence,
        "seed": seed,
        "modelRoot": model_root,
        "outputRoot": output_root,
    })
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
    let hardware = tauri::async_runtime::spawn_blocking(crate::creation_hardware_blocker)
        .await
        .map_err(|e| e.to_string())?;
    if let Some(message) = hardware {
        return Ok(CreationStatus {
            ready: false,
            blocker: "unsupported",
            message: message.into(),
        });
    }
    let model_root = models::verified_root(&app, &app.state::<models::ModelManager>());
    let engine = engine::engine_status(app.clone()).await?;
    Ok(if model_root.is_none() {
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
    service.empty_expired_trash(&app);
    service.with_state(&app, |state| state.works.clone())
}

/// How long the engine stays loaded after the last song; None until Aulo quits.
fn idle_limit(keep_loaded: bool) -> Option<Duration> {
    let choice = if keep_loaded {
        crate::settings::KeepReady::Faster
    } else {
        crate::settings::KeepReady::SaveMemory
    };
    choice.idle_limit()
}

/// What the idle engine loop does next, with no song waiting.
#[derive(Debug, PartialEq)]
enum IdleWait {
    /// Unload the engine now and give its memory back.
    Unload,
    /// Sleep until a song, a setting change or a release request arrives.
    UntilWoken,
    /// Unload unless something arrives within this time.
    For(Duration),
}

fn idle_wait(loaded: bool, release: bool, keep_loaded: bool) -> IdleWait {
    match (loaded, release, idle_limit(keep_loaded)) {
        (false, _, _) => IdleWait::UntilWoken,
        (true, true, _) => IdleWait::Unload,
        (true, false, None) => IdleWait::UntilWoken,
        (true, false, Some(idle)) => IdleWait::For(idle),
    }
}

/// Songs in the Trash for at least `days` days.
fn expired_trash(works: &[Work], now: u64, days: u32) -> Vec<String> {
    let limit = u64::from(days) * 24 * 60 * 60 * 1000;
    works
        .iter()
        .filter(|w| w.trashed_ms.is_some_and(|t| now.saturating_sub(t) >= limit))
        .map(|w| w.id.clone())
        .collect()
}

#[derive(Serialize)]
pub struct EngineMemory {
    loaded: bool,
    busy: bool,
}

#[tauri::command]
pub fn engine_memory(service: tauri::State<SongService>) -> EngineMemory {
    service.engine_state()
}

impl SongService {
    /// Stop the engine and wait until it has gone; refused while songs are being made.
    pub fn unload_engine(&self) -> Result<(), String> {
        {
            let mut state = self.0 .0.lock().unwrap();
            if state.current.is_some() || !state.queue.is_empty() {
                return Err("Stop the songs being made first.".into());
            }
            if state.child.is_none() {
                return Ok(());
            }
            state.release = true;
        }
        self.0 .1.notify_all();
        let started = std::time::Instant::now();
        while self.0 .0.lock().unwrap().child.is_some() {
            if started.elapsed() > Duration::from_secs(20) {
                return Err("The music engine is still stopping. Try again in a moment.".into());
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        Ok(())
    }
}

/// Settings › Free up memory now: unload the engine if no song is being made, and
/// answer only once it has exited and its memory is really back.
#[tauri::command]
pub async fn release_engine(service: tauri::State<'_, SongService>) -> Result<(), String> {
    let service = service.inner().clone();
    tauri::async_runtime::spawn_blocking(move || service.unload_engine())
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| {
            if e.starts_with("Stop the songs") {
                "Aulo is making a song. Memory is freed after it finishes.".into()
            } else {
                e
            }
        })
}

// Async so the first hardware check (which runs nvidia-smi on Windows) never runs
// on the main thread.
#[tauri::command]
pub async fn create_song(
    app: tauri::AppHandle,
    service: tauri::State<'_, SongService>,
    request: SongRequest,
    workspace: Option<String>,
) -> Result<Work, String> {
    request.validate()?;
    let hardware = tauri::async_runtime::spawn_blocking(crate::creation_hardware_blocker)
        .await
        .map_err(|e| e.to_string())?;
    let workspace = workspace.unwrap_or_else(default_workspace);
    if !service.with_state(&app, |state| state.collections.has_workspace(&workspace))? {
        return Err("That workspace no longer exists.".into());
    }
    if let Some(reason) = hardware {
        return Err(reason.into());
    }
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
        state: SongState::Queued,
        stage: None,
        progress: None,
        started_ms: None,
        duration: None,
        audio_path: None,
        message: None,
        workspace,
        trashed_ms: None,
        seed: None,
    };
    write_record(&root, &work)?;
    service.with_state(&app, |state| {
        state.works.insert(0, work.clone());
        state.queue.push_back(work.id.clone());
    })?;
    service.0 .1.notify_one();
    service.ensure_worker(&app);
    SongService::publish(&app, &work);
    // Keep the words and style the song was made from in Saved lyrics and Saved styles.
    let lyrics = if work.request.instrumental {
        ""
    } else {
        work.request.lyrics.as_str()
    };
    crate::drafts::remember_song(&app, &work.request.title, lyrics, &work.request.style);
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
            work.state = SongState::Cancelled;
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
    service.change(&app, &id, |work| {
        if let Some(title) = title {
            work.request.title = title.trim().to_string();
        }
        if let Some(favorite) = favorite {
            work.favorite = favorite;
        }
    })
}

pub(crate) fn finished_audio(
    app: &tauri::AppHandle,
    service: &SongService,
    id: &str,
) -> Result<PathBuf, String> {
    if !valid_id(id) {
        return Err("Unknown song.".into());
    }
    let root = library_root(app)?;
    service.with_state(app, |state| {
        state
            .works
            .iter()
            .find(|w| w.id == id && w.state == SongState::Completed)
            .map(|_| root.join(id).join("audio.flac"))
            .filter(|path| path.is_file())
            .ok_or_else(|| "This song has no audio yet.".to_string())
    })?
}

/// Download formats. FLAC is the original; MP3 and WAV are encoded inside Aulo,
/// and M4A uses the AAC encoder that is part of macOS itself.
#[derive(Clone, Copy, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum AudioFormat {
    M4a,
    Mp3,
    Wav,
    Flac,
}

impl AudioFormat {
    pub(crate) fn extension(self) -> &'static str {
        match self {
            Self::M4a => "m4a",
            Self::Mp3 => "mp3",
            Self::Wav => "wav",
            Self::Flac => "flac",
        }
    }
}

/// Run a converter to completion within `limit`, stopping it otherwise.
fn run_converter(mut command: Command, limit: Duration) -> Result<(), String> {
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let mut child = command.spawn().map_err(|e| e.to_string())?;
    let started = std::time::Instant::now();
    loop {
        match child.try_wait().map_err(|e| e.to_string())? {
            Some(status) if status.success() => return Ok(()),
            Some(_) => return Err("conversion failed".into()),
            None if started.elapsed() > limit => {
                let _ = child.kill();
                let _ = child.wait();
                return Err("conversion timed out".into());
            }
            None => std::thread::sleep(Duration::from_millis(100)),
        }
    }
}

/// Write `source` to `destination` in `format`, replacing it only once complete.
pub fn export_audio(
    source: &Path,
    format: AudioFormat,
    destination: &Path,
    tags: &crate::audio::Tags,
) -> Result<(), String> {
    let parent = destination.parent().ok_or("Choose a folder to save in.")?;
    let staged = tempfile::Builder::new()
        .prefix(".aulo-")
        .suffix(&format!(".{}", format.extension()))
        .tempfile_in(parent)
        .map_err(|e| e.to_string())?;
    match format {
        AudioFormat::Flac => {
            fs::copy(source, staged.path()).map_err(|e| e.to_string())?;
        }
        AudioFormat::M4a => {
            if !cfg!(target_os = "macos") {
                return Err("M4A downloads are available on macOS.".into());
            }
            let mut command = Command::new("/usr/bin/afconvert");
            command
                .args(["-f", "m4af", "-d", "aac", "-b", "256000"])
                .arg(source)
                .arg(staged.path());
            run_converter(command, Duration::from_secs(300))?;
        }
        AudioFormat::Mp3 => {
            crate::audio::write_mp3(&crate::audio::decode_flac(source)?, staged.path())?
        }
        AudioFormat::Wav => {
            crate::audio::write_wav(&crate::audio::decode_flac(source)?, staged.path())?
        }
    }
    if fs::metadata(staged.path()).map_or(0, |m| m.len()) == 0 {
        return Err("conversion produced no audio".into());
    }
    // Title and cover are a courtesy; the audio is saved even if they can't be written.
    // WAV has no artwork music apps agree on, so it stays plain.
    if format != AudioFormat::Wav {
        let _ = crate::audio::write_tags(staged.path(), tags);
    }
    staged
        .persist(destination)
        .map_err(|e| e.error.to_string())?;
    Ok(())
}

/// Save a finished song where the person chose, in the format they chose.
#[tauri::command]
pub async fn export_song(
    app: tauri::AppHandle,
    service: tauri::State<'_, SongService>,
    id: String,
    format: AudioFormat,
    name: String,
    cover: Option<Vec<u8>>,
) -> Result<bool, String> {
    let source = finished_audio(&app, &service, &id)?;
    let extension = format.extension();
    // The person picks the place in the system's own save window, opened here, so the
    // interface can never name a file for Aulo to write. False means they cancelled.
    let Some(destination) =
        choose_save_path(&app, &crate::share::file_name(&name, extension), extension)?
    else {
        return Ok(false);
    };
    let tags = crate::audio::Tags {
        title: name,
        cover: cover.filter(|png| crate::audio::valid_cover(png)),
    };
    tauri::async_runtime::spawn_blocking(move || {
        export_audio(&source, format, &destination, &tags)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|_| {
        "The song could not be saved in that format. Try another format or folder.".to_string()
    })?;
    Ok(true)
}

/// Ask where to save a file with the system's save window. The chosen name always ends
/// in `extension`; Ok(None) when the person cancels.
pub(crate) fn choose_save_path(
    app: &tauri::AppHandle,
    file_name: &str,
    extension: &str,
) -> Result<Option<PathBuf>, String> {
    use tauri_plugin_dialog::DialogExt;
    let Some(chosen) = app
        .dialog()
        .file()
        .set_file_name(file_name)
        .add_filter(extension.to_uppercase(), &[extension])
        .blocking_save_file()
        .and_then(|path| path.into_path().ok())
    else {
        return Ok(None);
    };
    checked_destination(chosen, extension).map(Some)
}

/// The chosen path with its extension. The save window only asked about replacing the
/// name as typed, so a file that exists under the completed name is never replaced.
fn checked_destination(chosen: PathBuf, extension: &str) -> Result<PathBuf, String> {
    let completed = with_extension(chosen.clone(), extension);
    if completed != chosen && completed.exists() {
        let name = completed.file_name().unwrap_or_default().to_string_lossy();
        return Err(format!(
            "A file named “{name}” is already there. Choose another name."
        ));
    }
    Ok(completed)
}

/// `path` ending in `.extension`, keeping a name that already does.
fn with_extension(path: PathBuf, extension: &str) -> PathBuf {
    if path
        .extension()
        .is_some_and(|e| e.eq_ignore_ascii_case(extension))
    {
        return path;
    }
    let mut name = path.file_name().unwrap_or_default().to_os_string();
    name.push(".");
    name.push(extension);
    path.with_file_name(name)
}

#[tauri::command]
pub fn reveal_song(
    app: tauri::AppHandle,
    service: tauri::State<SongService>,
    id: String,
) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let audio = finished_audio(&app, &service, &id)?;
    app.opener()
        .reveal_item_in_dir(audio)
        .map_err(|_| "The song's folder could not be opened.".into())
}

/// Put songs in Aulo's Trash, or take them out again. Songs being made cannot be trashed.
#[tauri::command]
pub fn trash_songs(
    app: tauri::AppHandle,
    service: tauri::State<SongService>,
    ids: Vec<String>,
    trashed: bool,
) -> Result<Vec<String>, String> {
    let changed: Vec<String> = service.with_state(&app, |state| {
        state
            .works
            .iter()
            .filter(|w| ids.contains(&w.id) && !w.active())
            .filter(|w| w.trashed_ms.is_some() != trashed)
            .map(|w| w.id.clone())
            .collect()
    })?;
    let now = now_ms();
    let mut saved = Vec::new();
    for id in &changed {
        if service
            .change(&app, id, |work| work.trashed_ms = trashed.then_some(now))
            .is_ok()
        {
            saved.push(id.clone());
        }
    }
    if saved.is_empty() && !changed.is_empty() {
        return Err(NOT_SAVED.into());
    }
    if changed.is_empty() && trashed {
        return Err("Stop these songs before moving them to the Trash.".into());
    }
    Ok(saved)
}

/// Delete songs from Aulo's Trash for good. Their folders go to the computer's
/// trash, the last chance to get them back.
#[tauri::command]
pub fn delete_songs(
    app: tauri::AppHandle,
    service: tauri::State<SongService>,
    ids: Vec<String>,
) -> Result<Vec<String>, String> {
    if ids.iter().any(|id| !valid_id(id)) {
        return Err("Unknown song.".into());
    }
    // The songs that went, even if some could not: the interface shows exactly those.
    delete_trashed(&app, &service, &ids)
}

/// Send songs that are in Aulo's Trash to the computer's trash, and forget them.
fn delete_trashed(
    app: &tauri::AppHandle,
    service: &SongService,
    ids: &[String],
) -> Result<Vec<String>, String> {
    let root = library_root(app)?;
    let deletable: Vec<String> = service.with_state(app, |state| {
        state
            .works
            .iter()
            .filter(|w| ids.contains(&w.id) && w.trashed_ms.is_some())
            .map(|w| w.id.clone())
            .collect()
    })?;
    // The system trash can be slow; keep the library unlocked meanwhile.
    let deleted: Vec<String> = deletable
        .into_iter()
        .filter(|id| trash::delete(root.join(id)).is_ok())
        .collect();
    service.with_state(app, |state| -> Result<(), String> {
        state.works.retain(|w| !deleted.contains(&w.id));
        state.collections.forget_songs(&deleted);
        state.collections.save(&root)
    })??;
    SongService::publish_collections(app, service);
    Ok(deleted)
}

#[tauri::command]
pub fn list_collections(
    app: tauri::AppHandle,
    service: tauri::State<SongService>,
) -> Result<Collections, String> {
    service.with_state(&app, |state| state.collections.clone())
}

/// Apply a change to workspaces or playlists, save it, and tell the interface.
fn change_collections<T>(
    app: &tauri::AppHandle,
    service: &SongService,
    f: impl FnOnce(&mut Collections) -> Result<T, String>,
) -> Result<T, String> {
    let root = library_root(app)?;
    let result = service.with_state(app, |state| -> Result<T, String> {
        let mut next = state.collections.clone();
        let value = f(&mut next)?;
        next.save(&root)?;
        state.collections = next;
        Ok(value)
    })??;
    SongService::publish_collections(app, service);
    Ok(result)
}

#[tauri::command]
pub fn create_workspace(
    app: tauri::AppHandle,
    service: tauri::State<SongService>,
    name: String,
) -> Result<Workspace, String> {
    change_collections(&app, &service, |c| {
        c.create_workspace(new_id(), &name, now_ms())
    })
}

#[tauri::command]
pub fn rename_workspace(
    app: tauri::AppHandle,
    service: tauri::State<SongService>,
    id: String,
    name: String,
) -> Result<(), String> {
    change_collections(&app, &service, |c| c.rename_workspace(&id, &name))
}

#[tauri::command]
pub fn archive_workspace(
    app: tauri::AppHandle,
    service: tauri::State<SongService>,
    id: String,
    archived: bool,
) -> Result<(), String> {
    change_collections(&app, &service, |c| c.set_archived(&id, archived))
}

/// Delete a workspace; its songs move to My Workspace.
#[tauri::command]
pub fn delete_workspace(
    app: tauri::AppHandle,
    service: tauri::State<SongService>,
    id: String,
) -> Result<(), String> {
    change_collections(&app, &service, |c| c.delete_workspace(&id))?;
    let ids: Vec<String> = service.with_state(&app, |state| {
        state
            .works
            .iter()
            .filter(|w| w.workspace == id)
            .map(|w| w.id.clone())
            .collect()
    })?;
    for song in ids {
        service.update(&app, &song, true, |work| {
            work.workspace = DEFAULT_WORKSPACE.into()
        });
    }
    Ok(())
}

#[tauri::command]
pub fn move_songs(
    app: tauri::AppHandle,
    service: tauri::State<SongService>,
    ids: Vec<String>,
    workspace: String,
) -> Result<(), String> {
    if !service.with_state(&app, |state| state.collections.has_workspace(&workspace))? {
        return Err("That workspace no longer exists.".into());
    }
    for id in &ids {
        let target = workspace.clone();
        service.change(&app, id, |work| work.workspace = target)?;
    }
    Ok(())
}

#[tauri::command]
pub fn create_playlist(
    app: tauri::AppHandle,
    service: tauri::State<SongService>,
    name: String,
    songs: Vec<String>,
) -> Result<Playlist, String> {
    change_collections(&app, &service, |c| {
        let playlist = c.create_playlist(new_id(), &name, now_ms())?;
        c.add_to_playlist(&playlist.id, &songs)?;
        Ok(c.playlists[0].clone())
    })
}

#[tauri::command]
pub fn rename_playlist(
    app: tauri::AppHandle,
    service: tauri::State<SongService>,
    id: String,
    name: String,
) -> Result<(), String> {
    change_collections(&app, &service, |c| c.rename_playlist(&id, &name))
}

#[tauri::command]
pub fn delete_playlist(
    app: tauri::AppHandle,
    service: tauri::State<SongService>,
    id: String,
) -> Result<(), String> {
    change_collections(&app, &service, |c| c.delete_playlist(&id))
}

#[tauri::command]
pub fn add_to_playlist(
    app: tauri::AppHandle,
    service: tauri::State<SongService>,
    id: String,
    songs: Vec<String>,
) -> Result<usize, String> {
    change_collections(&app, &service, |c| c.add_to_playlist(&id, &songs))
}

#[tauri::command]
pub fn remove_from_playlist(
    app: tauri::AppHandle,
    service: tauri::State<SongService>,
    id: String,
    songs: Vec<String>,
) -> Result<(), String> {
    change_collections(&app, &service, |c| c.remove_from_playlist(&id, &songs))
}

/// A small counting gate: at most `limit` holders at once.
struct Turns {
    limit: usize,
    taken: Mutex<usize>,
    freed: Condvar,
}

struct Turn(&'static Turns);

impl Turns {
    const fn new(limit: usize) -> Self {
        Self {
            limit,
            taken: Mutex::new(0),
            freed: Condvar::new(),
        }
    }

    fn take(&'static self) -> Turn {
        let mut taken = self.taken.lock().unwrap();
        while *taken >= self.limit {
            taken = self.freed.wait(taken).unwrap();
        }
        *taken += 1;
        Turn(self)
    }
}

impl Drop for Turn {
    fn drop(&mut self) {
        *self.0.taken.lock().unwrap() -= 1;
        self.0.freed.notify_one();
    }
}

static WAVEFORM_TURNS: Turns = Turns::new(2);

/// Loudness peaks for drawing a finished song's waveform, cached beside its audio.
#[tauri::command]
pub async fn song_waveform(
    app: tauri::AppHandle,
    service: tauri::State<'_, SongService>,
    id: String,
) -> Result<Vec<f32>, String> {
    let audio = finished_audio(&app, &service, &id)?;
    tauri::async_runtime::spawn_blocking(move || {
        // Reading a song is quick but not free; a large library opening in the
        // waveform view reads a couple of songs at a time.
        let _turn = WAVEFORM_TURNS.take();
        let cache = audio.with_file_name("waveform.json");
        if let Some(peaks) = fs::read(&cache)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<Vec<f32>>(&bytes).ok())
            .filter(|peaks| peaks.len() == crate::audio::WAVEFORM_BARS)
        {
            return Ok(peaks);
        }
        let peaks = crate::audio::waveform_of(&audio)?;
        let _ = fs::write(&cache, serde_json::to_vec(&peaks).unwrap_or_default());
        Ok(peaks)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests;
