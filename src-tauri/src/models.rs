//! Model preparation is independent of runtime readiness. Only pinned data files are fetched.
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
use tauri::Manager;

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
            if !file.url.starts_with("https://huggingface.co/m-a-p/") {
                return Err("The model source is not supported.".into());
            }
        }
        Ok(())
    }
}
pub fn manifest() -> Result<Manifest, String> {
    let m: Manifest = serde_json::from_str(include_str!("../../manifests/music-models.json"))
        .map_err(|e| e.to_string())?;
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
            message: "Choose existing models or download the music models.".into(),
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
        if let Some(s) = self.0.status.lock().unwrap().as_mut() {
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
            return Err("Model preparation is already running.".into());
        }
        self.0.pause.store(false, Ordering::SeqCst);
        let mut status = SetupStatus::initial(total);
        status.phase = "checking".into();
        status.message = "Checking your model files…".into();
        status.model_root = Some(root.to_string_lossy().into_owned());
        *self.0.status.lock().unwrap() = Some(status);
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
    manifest_id: String,
    model_root: PathBuf,
}
fn save_selection(base: &Path, root: &Path, manifest_id: &str) -> Result<(), String> {
    fs::create_dir_all(base).map_err(io_error)?;
    let saved = SavedModels {
        manifest_id: manifest_id.into(),
        model_root: root.to_path_buf(),
    };
    let mut tmp = tempfile::NamedTempFile::new_in(base).map_err(io_error)?;
    serde_json::to_writer(&mut tmp, &saved).map_err(|e| e.to_string())?;
    tmp.as_file().sync_all().map_err(io_error)?;
    tmp.persist(base.join("models.json"))
        .map_err(|e| io_error(e.error))?;
    Ok(())
}
fn io_error(e: std::io::Error) -> String {
    format!("Could not access model storage: {e}")
}
fn managed_root(base: &Path, m: &Manifest) -> PathBuf {
    base.join("models").join(&m.id)
}
fn base_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|e| e.to_string())
}
fn ensure_not_symlink(path: &Path) -> Result<(), String> {
    for ancestor in path.ancestors() {
        if fs::symlink_metadata(ancestor).is_ok_and(|m| m.file_type().is_symlink()) {
            return Err("Model download storage must not contain symbolic links. Choose existing models instead.".into());
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
        "Another Aulo window is preparing models. Wait for it to finish.".to_string()
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
#[tauri::command]
pub fn model_status(
    app: tauri::AppHandle,
    manager: tauri::State<ModelManager>,
) -> Result<SetupStatus, String> {
    let mut state = manager.0.status.lock().unwrap();
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
            if saved.manifest_id == m.id {
                s.phase = "unverified".into();
                s.operation = Some("verify".into());
                s.model_root = Some(saved.model_root.to_string_lossy().into_owned());
                s.message =
                    "Your model location is saved. Verify the files before using them.".into();
            }
        }
    }
    if s.model_root.is_none() && managed_root(base, m).exists() {
        s.phase = "paused".into();
        s.operation = Some("download".into());
        s.message =
            "An earlier download can be resumed. Completed files will be checked again.".into();
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
        .map_err(|_| "Could not open the model license in your browser.".to_string())
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
                "Preparation paused. Your downloaded files are kept.".into()
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
        return Err("Please review the model license and confirm the download first.".into());
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
            fs::create_dir_all(&root).map_err(io_error)?;
            let client = Client::builder()
                .https_only(true)
                .connect_timeout(Duration::from_secs(15))
                .timeout(Duration::from_secs(30))
                .user_agent("Aulo/0.1 model-preparation")
                .build()
                .map_err(|e| e.to_string())?;
            prepare_downloads(&client, &root, &m, &manager)?;
            save_selection(&base, &root, &m.id)?;
            manager.phase(
                "verified",
                "Music models are verified. The music engine still needs to be installed.",
            );
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
#[tauri::command]
pub fn verify_models(
    app: tauri::AppHandle,
    manager: tauri::State<ModelManager>,
    folder: String,
) -> Result<(), String> {
    let root = PathBuf::from(folder)
        .canonicalize()
        .map_err(|_| "This model folder is unavailable. Please choose it again.".to_string())?;
    if !root.is_dir() {
        return Err("Please choose a folder containing YuE2-3B and YuE2-Vae.".into());
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
            save_selection(&base, &root, &m.id)?;
            manager.phase(
                "verified",
                "Your existing models are verified and can be reused. No model files were changed.",
            );
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
        manager.phase("verifying", "Checking model files. This may take a moment.");
        manager.update(|s| s.current_file = Some(file.path.clone()));
        if !verify_file(&root.join(&file.path), file, manager, completed)? {
            return Err(format!("{} is missing or does not match this model version. Choose a compatible folder or download a separate copy in Aulo.", file.path));
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
        manager.phase("verifying", "Checking saved model files…");
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
                "There is not enough free storage. Free up some space, then resume the download."
                    .into(),
            );
        }
        if offset < file.bytes {
            transfer(client, file, &partial, manager, complete)?;
        }
        manager.phase(
            "verifying",
            "Checking the downloaded file before keeping it…",
        );
        if !verify_file(&partial, file, manager, complete)? {
            fs::remove_file(&partial).map_err(io_error)?;
            return Err("A downloaded file did not pass verification. It was discarded; retry to download a fresh copy.".into());
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
    while offset < file.bytes {
        if manager.cancelled() {
            return Err("Paused".into());
        }
        manager.phase(
            "downloading",
            "Downloading music models. You can pause and return later.",
        );
        let result = transfer_range(client, file, partial, manager, base, offset);
        match result {
            Ok(next) if next > offset => {
                offset = next;
                failures = 0;
            }
            Ok(_) => return Err("The download did not make progress. Please retry.".into()),
            Err(error) => {
                if manager.cancelled() {
                    return Err("Paused".into());
                }
                failures += 1;
                if failures >= 3 {
                    return Err(error);
                }
                manager.phase(
                    "retrying",
                    "The download was interrupted. Retrying with saved progress…",
                );
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
fn transfer_range(
    client: &Client,
    file: &ModelFile,
    partial: &Path,
    manager: &ModelManager,
    base: u64,
    offset: u64,
) -> Result<u64, String> {
    let end = (offset + 8 * 1024 * 1024 - 1).min(file.bytes - 1);
    let mut response = client
        .get(&file.url)
        .header(RANGE, format!("bytes={offset}-{end}"))
        .header("Accept-Encoding", "identity")
        .send()
        .map_err(|_| {
            "Could not reach the model download service. Check your connection and retry."
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
            return Err("The server returned an unexpected download range. Please retry.".into());
        }
        true
    } else if response.status() == StatusCode::OK {
        false
    } else {
        return Err(format!(
            "The model service returned HTTP {}. Please try again later.",
            response.status().as_u16()
        ));
    };
    if manager.cancelled() {
        return Err("Paused".into());
    }
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
        let n = response.read(&mut buffer).map_err(|_| {
            "The download connection was interrupted. Your progress has been kept.".to_string()
        })?;
        if n == 0 {
            break;
        }
        if received + n as u64 > limit {
            return Err("The server returned more data than expected. Please retry.".into());
        }
        writer.write_all(&buffer[..n]).map_err(io_error)?;
        received += n as u64;
        manager.update(|s| s.completed_bytes = base + received);
    }
    writer.sync_all().map_err(io_error)?;
    if received != limit {
        return Err("The file download ended early. Your progress has been kept.".into());
    }
    Ok(received)
}

#[cfg(test)]
mod tests;
