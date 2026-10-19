//! Model preparation is independent of runtime readiness. Only pinned data files are fetched.
use crate::Held;
use reqwest::{
    blocking::Client,
    header::{CONTENT_RANGE, RANGE},
    StatusCode,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Component, Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};

const RESERVE: u64 = 512 * 1024 * 1024;

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelFile {
    pub path: String,
    pub url: String,
    pub bytes: u64,
    pub sha256: String,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub schema_version: u32,
    pub id: String,
    pub label: String,
    pub core_version: String,
    pub license: String,
    pub license_url: String,
    pub files: Vec<ModelFile>,
}
impl Manifest {
    fn total(&self) -> u64 {
        self.files.iter().map(|f| f.bytes).sum()
    }
    fn validate(&self) -> Result<(), String> {
        if self.schema_version != 1 || self.files.is_empty() {
            return Err("The model catalog is not supported.".into());
        }
        let mut paths = std::collections::HashSet::new();
        for file in &self.files {
            if file.path.is_empty()
                || file.path.contains('\\')
                || file.path.contains(':')
                || Path::new(&file.path)
                    .components()
                    .any(|c| !matches!(c, Component::Normal(_)))
                || !paths.insert(&file.path)
            {
                return Err("The model catalog contains an invalid path.".into());
            }
            if file.sha256.len() != 64
                || !file.sha256.bytes().all(|c| c.is_ascii_hexdigit())
                || file.bytes == 0
            {
                return Err("The model catalog contains an invalid checksum or size.".into());
            }
            // The official checkpoints, or the GGUF files yue2.cpp's author publishes
            // (GROOVE: the local Q8_0 conversion is tensor-for-tensor identical).
            if !file.url.starts_with("https://huggingface.co/m-a-p/")
                && !file
                    .url
                    .starts_with("https://huggingface.co/Serveurperso/YuE2-GGUF/")
            {
                return Err("The model source is not supported.".into());
            }
        }
        Ok(())
    }
}
/// The models this computer's engine runs, and nothing else: the PyTorch checkpoints
/// (7.8 GB) or the GGUF files with the tokenizer and licences (4.3 GB). A computer
/// without a plan gets none: guessing would download weights it may never use.
pub fn manifest() -> Result<Manifest, String> {
    let plan = crate::plan::current().map_err(String::from)?;
    manifest_for(plan.engine)
}

pub fn manifest_for(engine: crate::plan::Engine) -> Result<Manifest, String> {
    let text = match engine {
        crate::plan::Engine::Torch => include_str!("../../manifests/music-models.json"),
        crate::plan::Engine::Gguf => include_str!("../../manifests/music-models-gguf.json"),
    };
    let m: Manifest = serde_json::from_str(text).map_err(|e| e.to_string())?;
    m.validate()?;
    Ok(m)
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupStatus {
    pub phase: String,
    pub operation: Option<String>,
    pub completed_bytes: u64,
    pub total_bytes: u64,
    pub current_file: Option<String>,
    pub message: String,
    pub model_root: Option<String>,
    pub models_verified: bool,
    pub runtime_state: String,
    pub generation_ready: bool,
}
impl SetupStatus {
    fn initial(total: u64) -> Self {
        Self {
            phase: "not_started".into(),
            operation: None,
            completed_bytes: 0,
            total_bytes: total,
            current_file: None,
            message: "Download the music models, or choose a folder that already has them.".into(),
            model_root: None,
            models_verified: false,
            runtime_state: "not_bundled".into(),
            generation_ready: false,
        }
    }
}
#[derive(Default)]
struct Inner {
    status: Mutex<Option<SetupStatus>>,
    busy: AtomicBool,
    pause: AtomicBool,
}
#[derive(Clone, Default)]
pub struct ModelManager(Arc<Inner>);
impl ModelManager {
    fn update(&self, f: impl FnOnce(&mut SetupStatus)) {
        if let Some(s) = self.0.status.held().as_mut() {
            f(s);
        }
    }
    fn phase(&self, phase: &str, message: &str) {
        self.update(|s| {
            s.phase = phase.into();
            s.message = message.into();
        });
    }
    fn begin(&self, root: &Path, total: u64) -> Result<(), String> {
        if self
            .0
            .busy
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
        {
            return Err("The music models are already being prepared.".into());
        }
        self.0.pause.store(false, Ordering::SeqCst);
        let mut status = SetupStatus::initial(total);
        status.phase = "checking".into();
        status.message = "Checking the music models…".into();
        status.model_root = Some(root.to_string_lossy().into_owned());
        *self.0.status.held() = Some(status);
        Ok(())
    }
    fn cancelled(&self) -> bool {
        self.0.pause.load(Ordering::SeqCst)
    }
}
struct BusyGuard(ModelManager);
impl Drop for BusyGuard {
    fn drop(&mut self) {
        self.0 .0.busy.store(false, Ordering::SeqCst);
    }
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SavedModels {
    #[serde(default)]
    format: crate::FormatVersion,
    manifest_id: String,
    model_root: PathBuf,
    /// Size and modification time of every file when its checksum last passed.
    #[serde(default)]
    verified_files: Vec<FileStamp>,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FileStamp {
    path: String,
    bytes: u64,
    modified_nanos: u128,
}
fn stamp(root: &Path, file: &ModelFile) -> Option<FileStamp> {
    let metadata = fs::metadata(root.join(&file.path)).ok()?;
    let modified = metadata.modified().ok()?;
    let nanos = modified
        .duration_since(std::time::UNIX_EPOCH)
        .ok()?
        .as_nanos();
    (metadata.is_file() && metadata.len() == file.bytes).then(|| FileStamp {
        path: file.path.clone(),
        bytes: metadata.len(),
        modified_nanos: nanos,
    })
}
/// Unchanged files keep a checksum verification across restarts. Any size or
/// modification-time difference requires a full checksum pass again.
fn unchanged_since_verification(root: &Path, m: &Manifest, saved: &[FileStamp]) -> bool {
    saved.len() == m.files.len()
        && m.files
            .iter()
            .zip(saved)
            .all(|(file, recorded)| stamp(root, file).as_ref() == Some(recorded))
}
fn save_verified(base: &Path, root: &Path, m: &Manifest) -> Result<(), String> {
    let stamps = m
        .files
        .iter()
        .map(|file| stamp(root, file))
        .collect::<Option<Vec<_>>>()
        .ok_or("A model file changed during verification. Please verify again.")?;
    write_selection(base, root, &m.id, stamps)
}
#[cfg(test)]
fn save_selection(base: &Path, root: &Path, manifest_id: &str) -> Result<(), String> {
    write_selection(base, root, manifest_id, Vec::new())
}
fn write_selection(
    base: &Path,
    root: &Path,
    manifest_id: &str,
    verified_files: Vec<FileStamp>,
) -> Result<(), String> {
    fs::create_dir_all(base).map_err(io_error)?;
    let saved = SavedModels {
        format: crate::FormatVersion::CURRENT,
        manifest_id: manifest_id.into(),
        model_root: root.to_path_buf(),
        verified_files,
    };
    let mut tmp = tempfile::NamedTempFile::new_in(base).map_err(io_error)?;
    serde_json::to_writer(&mut tmp, &saved).map_err(|e| e.to_string())?;
    tmp.as_file().sync_all().map_err(io_error)?;
    tmp.persist(base.join("models.json"))
        .map_err(|e| io_error(e.error))?;
    Ok(())
}
fn io_error(e: std::io::Error) -> String {
    format!("Aulo couldn’t save the music models here ({e}).")
}
fn managed_root(base: &Path, m: &Manifest) -> PathBuf {
    models_home(base).join(&m.id)
}

/// Where Aulo keeps the music models it downloads: `<data>/models`.
///
/// yue2.cpp opens files through Windows' legacy code page, so on Windows the models need
/// a path in plain ASCII. A Windows account named in Chinese, Japanese, Korean or any
/// other script puts Aulo's data folder outside it; the models then live under
/// `C:\ProgramData\Aulo` instead, in a folder of that account's own.
pub fn models_home(base: &Path) -> PathBuf {
    models_home_for(
        &base.join("models"),
        cfg!(windows),
        std::env::var_os("ProgramData").map(PathBuf::from),
    )
}

fn models_home_for(own: &Path, windows: bool, program_data: Option<PathBuf>) -> PathBuf {
    if !windows || own.to_string_lossy().is_ascii() {
        return own.to_path_buf();
    }
    let shared = program_data
        .filter(|p| p.to_string_lossy().is_ascii())
        .unwrap_or_else(|| PathBuf::from(r"C:\ProgramData"));
    // One folder per account, named after its own data folder so it never changes.
    let digest = Sha256::digest(own.to_string_lossy().as_bytes());
    let account: String = digest[..8].iter().map(|b| format!("{b:02x}")).collect();
    shared.join("Aulo").join(account).join("models")
}

/// yue2.cpp cannot open a folder like this on Windows (see `models_home`).
fn unreadable_on_windows(folder: &Path) -> bool {
    cfg!(windows) && !folder.to_string_lossy().is_ascii()
}
fn base_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    crate::data_dir(app)
}
fn ensure_not_symlink(path: &Path) -> Result<(), String> {
    for ancestor in path.ancestors() {
        if fs::symlink_metadata(ancestor).is_ok_and(|m| m.file_type().is_symlink()) {
            return Err("Aulo can’t download into this folder. Choose a folder that already has the music models instead.".into());
        }
    }
    Ok(())
}
fn partial_path(root: &Path, file: &ModelFile) -> PathBuf {
    root.join(format!("{}.part", file.path))
}
fn lock_storage(base: &Path) -> Result<File, String> {
    fs::create_dir_all(base).map_err(io_error)?;
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(base.join("model-preparation.lock"))
        .map_err(io_error)?;
    fs2::FileExt::try_lock_exclusive(&file).map_err(|_| {
        "Another Aulo window is preparing the music models. Wait for it to finish.".to_string()
    })?;
    Ok(file)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelPlan {
    pub label: String,
    pub total_bytes: u64,
    pub required_free_bytes: u64,
    pub free_bytes: Option<u64>,
    pub destination: String,
    pub license: String,
    pub license_url: String,
    pub file_count: usize,
}
#[tauri::command]
pub async fn model_plan(app: tauri::AppHandle) -> Result<ModelPlan, String> {
    let base = base_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let m = manifest()?;
        let root = managed_root(&base, &m);
        let existing: u64 = m
            .files
            .iter()
            .map(|f| {
                let complete = fs::metadata(root.join(&f.path))
                    .ok()
                    .filter(|x| x.is_file() && x.len() == f.bytes)
                    .map_or(0, |x| x.len());
                if complete > 0 {
                    complete
                } else {
                    fs::metadata(partial_path(&root, f))
                        .ok()
                        .map_or(0, |x| x.len().min(f.bytes))
                }
            })
            .sum();
        let nearest = base.ancestors().find(|p| p.exists());
        Ok(ModelPlan {
            label: m.label.clone(),
            total_bytes: m.total(),
            required_free_bytes: m.total().saturating_sub(existing) + RESERVE,
            free_bytes: nearest.and_then(|p| fs2::available_space(p).ok()),
            destination: root.to_string_lossy().into_owned(),
            license: m.license,
            license_url: m.license_url,
            file_count: m.files.len(),
        })
    })
    .await
    .map_err(|e| e.to_string())?
}
/// The verified model folder, if model preparation has completed for this manifest.
pub fn verified_root(app: &tauri::AppHandle, manager: &ModelManager) -> Option<PathBuf> {
    let mut state = manager.0.status.held();
    if state.is_none() {
        let m = manifest().ok()?;
        *state = Some(restore_status(&base_path(app).ok()?, &m));
    }
    let status = state.as_ref()?;
    (status.models_verified && status.phase == "verified")
        .then(|| status.model_root.as_ref().map(PathBuf::from))
        .flatten()
}
/// What the problem report says about the music models, as label and value lines.
/// Works on any computer, with or without an engine plan.
pub fn report_lines(app: &tauri::AppHandle, manager: &ModelManager) -> Vec<(String, String)> {
    let Ok(base) = base_path(app) else {
        return vec![("State".into(), "Aulo’s data folder can’t be found".into())];
    };
    let saved = fs::read(base.join("models.json"))
        .ok()
        .and_then(|bytes| serde_json::from_slice::<SavedModels>(&bytes).ok());
    let m = manifest().ok();
    if m.is_some() {
        // Fills in the state on first use, as Settings would.
        let _ = verified_root(app, manager);
    }
    let status = manager.0.status.held().clone();
    let mut lines = Vec::new();
    lines.push((
        "Set for this computer".into(),
        match &m {
            Some(m) => format!(
                "{} ({}), {} files, {:.2} GB",
                m.label,
                m.id,
                m.files.len(),
                m.total() as f64 / 1e9
            ),
            None => "none: this computer has no engine plan".into(),
        },
    ));
    lines.push((
        "State".into(),
        match &status {
            Some(s) => format!("{} ({})", s.phase, s.message),
            None => "not looked at yet".into(),
        },
    ));
    lines.push((
        "Recorded set".into(),
        match &saved {
            Some(saved) => {
                let own = saved.model_root.starts_with(models_home(&base));
                format!(
                    "{}, {} files checked, in {} ({})",
                    saved.manifest_id,
                    saved.verified_files.len(),
                    if own {
                        "Aulo’s own folder"
                    } else {
                        "a folder the person chose"
                    },
                    saved.model_root.display()
                )
            }
            None => "none".into(),
        },
    ));
    let home = models_home(&base);
    let mut kept: Vec<String> = fs::read_dir(&home)
        .map(|entries| {
            entries
                .flatten()
                .map(|e| {
                    let bytes = crate::support::folder_bytes(&e.path());
                    format!(
                        "{} ({:.2} GB)",
                        e.file_name().to_string_lossy(),
                        bytes as f64 / 1e9
                    )
                })
                .collect()
        })
        .unwrap_or_default();
    kept.sort();
    lines.push((
        "Aulo’s models folder".into(),
        format!(
            "{}: {}",
            home.display(),
            if kept.is_empty() {
                "empty".into()
            } else {
                kept.join(", ")
            }
        ),
    ));
    lines
}

/// A song found the music models damaged: they must be checked again before the next
/// song, which Settings › Music models offers.
pub fn needs_checking(manager: &ModelManager) {
    manager.update(|s| {
        if s.models_verified {
            s.models_verified = false;
            s.phase = "unverified".into();
            s.operation = Some("verify".into());
            s.message = "Aulo needs to check the music models again before using them.".into();
        }
    });
}
#[tauri::command]
pub fn model_status(
    app: tauri::AppHandle,
    manager: tauri::State<ModelManager>,
) -> Result<SetupStatus, String> {
    let mut state = manager.0.status.held();
    if state.is_none() {
        let m = manifest()?;
        let base = base_path(&app)?;
        let s = restore_status(&base, &m);
        *state = Some(s);
    }
    Ok(state.as_ref().unwrap().clone())
}
fn restore_status(base: &Path, m: &Manifest) -> SetupStatus {
    let mut s = SetupStatus::initial(m.total());
    if let Ok(bytes) = fs::read(base.join("models.json")) {
        if let Ok(saved) = serde_json::from_slice::<SavedModels>(&bytes) {
            if saved.manifest_id == m.id
                && unchanged_since_verification(&saved.model_root, m, &saved.verified_files)
            {
                s.phase = "verified".into();
                s.models_verified = true;
                s.completed_bytes = m.total();
                s.model_root = Some(saved.model_root.to_string_lossy().into_owned());
                s.message = "Music models are ready.".into();
            } else if saved.manifest_id == m.id {
                s.phase = "unverified".into();
                s.operation = Some("verify".into());
                s.model_root = Some(saved.model_root.to_string_lossy().into_owned());
                s.message = "Aulo needs to check the music models again before using them.".into();
            }
        }
    }
    if s.model_root.is_none() && managed_root(base, m).exists() {
        s.phase = "paused".into();
        s.operation = Some("download".into());
        s.message = "Your download was paused. Pick up where you left off.".into();
        s.model_root = Some(managed_root(base, m).to_string_lossy().into_owned());
    }
    s
}

#[tauri::command]
pub fn open_model_license(app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_url(
            "https://creativecommons.org/licenses/by-nc/4.0/",
            None::<&str>,
        )
        .map_err(|_| "The license page couldn’t be opened.".to_string())
}

#[tauri::command]
pub fn pause_models(manager: tauri::State<ModelManager>) {
    manager.0.pause.store(true, Ordering::SeqCst);
}

fn finish(manager: &ModelManager, result: Result<(), String>) {
    if let Err(error) = result {
        manager.update(|s| {
            s.models_verified = false;
            s.phase = if manager.cancelled() {
                "paused"
            } else {
                "failed"
            }
            .into();
            s.message = if manager.cancelled() {
                "Paused. What’s downloaded so far is kept.".into()
            } else {
                error
            };
        });
    }
}
#[tauri::command]
pub fn download_models(
    app: tauri::AppHandle,
    manager: tauri::State<ModelManager>,
    terms_accepted: bool,
) -> Result<(), String> {
    if !terms_accepted {
        return Err("Agree to the music models’ license first.".into());
    }
    let m = manifest()?;
    let base = base_path(&app)?;
    let root = managed_root(&base, &m);
    ensure_not_symlink(&base)?;
    ensure_not_symlink(&root)?;
    manager.begin(&root, m.total())?;
    manager.update(|s| s.operation = Some("download".into()));
    let manager = manager.inner().clone();
    std::thread::spawn(move || {
        let _guard = BusyGuard(manager.clone());
        let result = (|| {
            let _lock = lock_storage(&base)?;
            adopt_previous(&base, &root, &m)?;
            fs::create_dir_all(&root).map_err(io_error)?;
            let client = Client::builder()
                .https_only(true)
                .connect_timeout(Duration::from_secs(15))
                .timeout(Duration::from_secs(30))
                .user_agent("Aulo/0.1 model-preparation")
                .build()
                .map_err(|e| e.to_string())?;
            prepare_downloads(&client, &root, &m, &manager)?;
            save_verified(&base, &root, &m)?;
            manager.phase("verified", "Music models are ready.");
            manager.update(|s| {
                s.models_verified = true;
                s.current_file = None;
            });
            Ok(())
        })();
        finish(&manager, result);
    });
    Ok(())
}
/// Delete Aulo's own copy of the music models: its models folder (downloaded files,
/// partial downloads and converted engine files) and its record of them. A folder the
/// person chose themselves lies outside it and is never touched; Aulo only stops using
/// it. Returns that folder, if there was one.
pub fn remove_model_files(base: &Path) -> Result<Option<PathBuf>, String> {
    let _lock = lock_storage(base)?;
    let models = models_home(base);
    let chosen = fs::read(base.join("models.json"))
        .ok()
        .and_then(|bytes| serde_json::from_slice::<SavedModels>(&bytes).ok())
        .map(|saved| saved.model_root)
        .filter(|root| !root.starts_with(&models));
    match fs::symlink_metadata(&models) {
        // Never follow a link out of Aulo's folder.
        Ok(meta) if meta.file_type().is_symlink() => fs::remove_file(&models),
        Ok(_) => fs::remove_dir_all(&models),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e),
    }
    .map_err(|_| {
        "Aulo couldn’t remove the music models. Close other apps using them and try again."
            .to_string()
    })?;
    match fs::remove_file(base.join("models.json")) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => {
            return Err("Aulo couldn’t finish removing the music models. Try again.".into())
        }
        _ => {}
    }
    Ok(chosen)
}

/// Delete every folder in Aulo's own `models` folder except `keep`, any folder holding
/// it and anything inside it. A link is removed, never followed. One set of weights
/// per computer.
fn remove_managed_except(base: &Path, keep: &Path) -> Result<(), String> {
    let Ok(entries) = fs::read_dir(models_home(base)) else {
        return Ok(());
    };
    // Compare real locations too: the same folder can be named through a link.
    let real_keep = fs::canonicalize(keep).unwrap_or_else(|_| keep.to_path_buf());
    let related = |a: &Path, b: &Path| a.starts_with(b) || b.starts_with(a);
    for entry in entries.flatten() {
        let path = entry.path();
        let real = fs::canonicalize(&path).unwrap_or_else(|_| path.clone());
        if related(&path, keep) || related(&real, &real_keep) {
            continue;
        }
        let removed = match fs::symlink_metadata(&path) {
            Ok(meta) if meta.file_type().is_symlink() => fs::remove_file(&path),
            Ok(meta) if meta.is_dir() => fs::remove_dir_all(&path),
            _ => continue,
        };
        removed.map_err(|_| {
            "Aulo couldn’t remove an older copy of the music models. Close other apps using them and try again."
                .to_string()
        })?;
    }
    Ok(())
}

/// Before downloading `m` into `root`: files an earlier model set left in Aulo's own
/// folder (after an update, say) that `m` lists at the same place and size are moved
/// over, then every earlier folder is deleted. Only what changed is downloaded again,
/// and there is never a second set of weights. Moved files are checked like any other.
fn adopt_previous(base: &Path, root: &Path, m: &Manifest) -> Result<(), String> {
    if let Ok(entries) = fs::read_dir(models_home(base)) {
        for entry in entries.flatten() {
            let old = entry.path();
            let is_dir = fs::symlink_metadata(&old).is_ok_and(|meta| meta.is_dir());
            if old == root || !is_dir {
                continue;
            }
            for file in &m.files {
                let (from, to) = (old.join(&file.path), root.join(&file.path));
                let same_size = fs::symlink_metadata(&from)
                    .is_ok_and(|meta| meta.is_file() && meta.len() == file.bytes);
                if same_size && !to.exists() {
                    if let Some(parent) = to.parent() {
                        fs::create_dir_all(parent).map_err(io_error)?;
                    }
                    // Best effort: a file that cannot be moved is downloaded instead.
                    let _ = fs::rename(&from, &to);
                }
            }
        }
    }
    remove_managed_except(base, root)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemovedModels {
    /// A folder of the person's own that Aulo stopped using but did not delete.
    pub kept_folder: Option<String>,
}

/// Settings › Remove music models.
#[tauri::command]
pub async fn remove_models(
    app: tauri::AppHandle,
    manager: tauri::State<'_, ModelManager>,
    songs: tauri::State<'_, crate::songs::SongService>,
) -> Result<RemovedModels, String> {
    // Removing works on any computer, even one that cannot make songs.
    let m = manifest().ok();
    let base = base_path(&app)?;
    if manager
        .0
        .busy
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err("The music models are being prepared. Pause or finish that first.".into());
    }
    let _guard = BusyGuard(manager.inner().clone());
    let base_for_status = base.clone();
    // From here on nothing may start a song with these models.
    manager.update(|s| {
        s.models_verified = false;
        s.phase = "removing".into();
        s.message = "Removing the music models…".into();
    });
    let songs = songs.inner().clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        songs.unload_engine()?;
        remove_model_files(&base).map(|kept| (kept, base))
    })
    .await
    .map_err(|e| e.to_string())?;
    // Whatever happened, read the state back from disk: after a partial removal the
    // models must not be considered ready, and after a refusal they still are.
    *manager.0.status.held() = m.map(|m| restore_status(&base_for_status, &m));
    result.map(|(kept, _)| RemovedModels {
        kept_folder: kept.map(|p| p.to_string_lossy().into_owned()),
    })
}

#[tauri::command]
pub fn verify_models(
    app: tauri::AppHandle,
    manager: tauri::State<ModelManager>,
    folder: String,
) -> Result<(), String> {
    let root = PathBuf::from(folder)
        .canonicalize()
        .map_err(|_| "That folder can’t be opened. Choose it again.".to_string())?;
    if !root.is_dir() {
        return Err("Choose the folder that contains the music models.".into());
    }
    if unreadable_on_windows(&root) {
        return Err("Aulo can’t use music models from a folder whose location has letters other than English ones. Move the folder to one like C:\\Aulo Models, then choose it again.".into());
    }
    let m = manifest()?;
    let base = base_path(&app)?;
    manager.begin(&root, m.total())?;
    manager.update(|s| s.operation = Some("verify".into()));
    let manager = manager.inner().clone();
    std::thread::spawn(move || {
        let _guard = BusyGuard(manager.clone());
        let result = (|| {
            let _lock = lock_storage(&base)?;
            verify_existing(&root, &m, &manager)?;
            // From now on these are the models; Aulo's own copy would be a second set.
            remove_managed_except(&base, &root)?;
            save_verified(&base, &root, &m)?;
            manager.phase("verified", "Your music models are ready.");
            manager.update(|s| {
                s.models_verified = true;
                s.current_file = None;
            });
            Ok(())
        })();
        finish(&manager, result);
    });
    Ok(())
}

fn verify_existing(root: &Path, m: &Manifest, manager: &ModelManager) -> Result<(), String> {
    let mut completed = 0;
    for file in &m.files {
        manager.phase(
            "verifying",
            "Checking the music models. This takes about a minute.",
        );
        manager.update(|s| s.current_file = Some(file.path.clone()));
        if !verify_file(&root.join(&file.path), file, manager, completed)? {
            return Err("Some files in this folder are missing or aren’t the versions Aulo needs. Choose another folder, or let Aulo download its own copy.".into());
        }
        completed += file.bytes;
    }
    manager.update(|s| s.completed_bytes = m.total());
    Ok(())
}
fn verify_file(
    path: &Path,
    expected: &ModelFile,
    manager: &ModelManager,
    base: u64,
) -> Result<bool, String> {
    if manager.cancelled() {
        return Err("Paused".into());
    }
    let metadata = match fs::metadata(path) {
        Ok(m) if m.is_file() && m.len() == expected.bytes => m,
        _ => return Ok(false),
    };
    let mut reader = File::open(path).map_err(io_error)?;
    let mut hash = Sha256::new();
    let mut buffer = vec![0u8; 1024 * 1024];
    let mut read = 0u64;
    loop {
        if manager.cancelled() {
            return Err("Paused".into());
        }
        let n = reader.read(&mut buffer).map_err(io_error)?;
        if n == 0 {
            break;
        }
        hash.update(&buffer[..n]);
        read += n as u64;
        manager.update(|s| s.completed_bytes = base + read.min(expected.bytes));
    }
    Ok(read == metadata.len() && format!("{:x}", hash.finalize()) == expected.sha256)
}
fn prepare_downloads(
    client: &Client,
    root: &Path,
    m: &Manifest,
    manager: &ModelManager,
) -> Result<(), String> {
    let mut complete = 0u64;
    for file in &m.files {
        if manager.cancelled() {
            return Err("Paused".into());
        }
        let target = root.join(&file.path);
        let partial = partial_path(root, file);
        ensure_not_symlink(&target)?;
        ensure_not_symlink(&partial)?;
        manager.update(|s| {
            s.current_file = Some(file.path.clone());
            s.completed_bytes = complete;
        });
        manager.phase("verifying", "Checking what’s already downloaded…");
        if verify_file(&target, file, manager, complete)? {
            complete += file.bytes;
            continue;
        }
        // Only managed model files may be replaced. Imported folders are read-only.
        if target.exists() {
            fs::remove_file(&target).map_err(io_error)?;
        }
        fs::create_dir_all(target.parent().unwrap()).map_err(io_error)?;
        if fs::metadata(&partial).is_ok_and(|m| m.len() > file.bytes) {
            fs::remove_file(&partial).map_err(io_error)?;
        }
        let offset = fs::metadata(&partial).map_or(0, |m| m.len());
        let free = fs2::available_space(root).map_err(io_error)?;
        if free < file.bytes.saturating_sub(offset) + RESERVE {
            return Err(
                "There isn’t enough free space. Free up some space, then resume the download."
                    .into(),
            );
        }
        if offset < file.bytes {
            transfer(client, file, &partial, manager, complete)?;
        }
        manager.phase("verifying", "Checking the download…");
        if !verify_file(&partial, file, manager, complete)? {
            fs::remove_file(&partial).map_err(io_error)?;
            return Err(
                "Part of the download was damaged and was removed. Try again to download it fresh."
                    .into(),
            );
        }
        if manager.cancelled() {
            return Err("Paused".into());
        }
        fs::rename(&partial, &target).map_err(io_error)?;
        complete += file.bytes;
        manager.update(|s| s.completed_bytes = complete);
    }
    Ok(())
}

// Bounded ranges keep pause responsive and avoid a multi-hour request timeout.
// A server ignoring Range is handled as a full response after truncating partial data.
fn transfer(
    client: &Client,
    file: &ModelFile,
    partial: &Path,
    manager: &ModelManager,
    base: u64,
) -> Result<(), String> {
    let mut offset = fs::metadata(partial).map_or(0, |m| m.len());
    let mut failures = 0;
    // Hugging Face answers each request with a redirect to its file servers. The address
    // it redirects to is reused for the next ranges, saving a round trip per 8 MiB; it
    // expires, and then the next request goes through Hugging Face again. Every byte is
    // still checked against the pinned SHA-256.
    let mut source: Option<reqwest::Url> = None;
    while offset < file.bytes {
        if manager.cancelled() {
            return Err("Paused".into());
        }
        manager.phase(
            "downloading",
            "Downloading. You can pause and come back later.",
        );
        let result = transfer_range(client, file, partial, manager, base, offset, &mut source);
        match result {
            Ok(next) if next > offset => {
                offset = next;
                failures = 0;
            }
            Ok(_) => return Err("The download stopped making progress. Try again.".into()),
            Err(error) => {
                if manager.cancelled() {
                    return Err("Paused".into());
                }
                source = None;
                // A slow or flaky connection that still moves forward is not a failure.
                let reached = fs::metadata(partial).map_or(0, |m| m.len());
                failures = if reached > offset { 1 } else { failures + 1 };
                if failures >= 3 {
                    return Err(error);
                }
                manager.phase("retrying", "The connection dropped. Trying again…");
                let start = Instant::now();
                while start.elapsed() < Duration::from_secs(failures) {
                    if manager.cancelled() {
                        return Err("Paused".into());
                    }
                    std::thread::sleep(Duration::from_millis(100));
                }
                offset = fs::metadata(partial).map_or(0, |m| m.len());
            }
        }
    }
    Ok(())
}
/// Bytes asked for at a time.
const RANGE_BYTES: u64 = 8 * 1024 * 1024;

fn transfer_range(
    client: &Client,
    file: &ModelFile,
    partial: &Path,
    manager: &ModelManager,
    base: u64,
    offset: u64,
    source: &mut Option<reqwest::Url>,
) -> Result<u64, String> {
    transfer_range_sized(
        client,
        file,
        partial,
        manager,
        base,
        offset,
        source,
        RANGE_BYTES,
    )
}

#[allow(clippy::too_many_arguments)]
fn transfer_range_sized(
    client: &Client,
    file: &ModelFile,
    partial: &Path,
    manager: &ModelManager,
    base: u64,
    offset: u64,
    source: &mut Option<reqwest::Url>,
    range: u64,
) -> Result<u64, String> {
    let end = (offset + range - 1).min(file.bytes - 1);
    let url = source
        .clone()
        .map_or_else(|| file.url.clone(), |u| u.to_string());
    let mut response = client
        .get(&url)
        .header(RANGE, format!("bytes={offset}-{end}"))
        .header("Accept-Encoding", "identity")
        .send()
        .map_err(|_| {
            "Aulo couldn’t reach the download. Check your internet connection and try again."
                .to_string()
        })?;
    let append = if response.status() == StatusCode::PARTIAL_CONTENT {
        let expected = format!("bytes {offset}-{end}/{}", file.bytes);
        if response
            .headers()
            .get(CONTENT_RANGE)
            .and_then(|h| h.to_str().ok())
            != Some(expected.as_str())
        {
            return Err("The download was interrupted. Try again.".into());
        }
        true
    } else if response.status() == StatusCode::OK {
        false
    } else {
        *source = None;
        return Err(format!(
            "The download isn’t available right now (error {}). Try again later.",
            response.status().as_u16()
        ));
    };
    if manager.cancelled() {
        return Err("Paused".into());
    }
    *source = Some(response.url().clone());
    let mut writer = OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(!append)
        .append(append)
        .open(partial)
        .map_err(io_error)?;
    let mut received = if append { offset } else { 0 };
    let limit = if append { end + 1 } else { file.bytes };
    let mut buffer = [0u8; 64 * 1024];
    loop {
        if manager.cancelled() {
            writer.sync_all().map_err(io_error)?;
            return Err("Paused".into());
        }
        let n = response
            .read(&mut buffer)
            .map_err(|_| "The connection dropped. What’s downloaded so far is kept.".to_string())?;
        if n == 0 {
            break;
        }
        if received + n as u64 > limit {
            return Err("The download was interrupted. Try again.".into());
        }
        writer.write_all(&buffer[..n]).map_err(io_error)?;
        received += n as u64;
        manager.update(|s| s.completed_bytes = base + received);
    }
    writer.sync_all().map_err(io_error)?;
    if received != limit {
        return Err("The download stopped early. What’s downloaded so far is kept.".into());
    }
    Ok(received)
}

#[cfg(test)]
mod tests;
