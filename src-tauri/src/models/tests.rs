use super::*;
use std::{net::TcpListener, thread};

fn fixture(bytes: &[u8]) -> ModelFile {
    ModelFile {
        path: "YuE2-3B/model.safetensors".into(),
        url: "https://huggingface.co/m-a-p/test/resolve/pinned/model".into(),
        bytes: bytes.len() as u64,
        sha256: format!("{:x}", Sha256::digest(bytes)),
    }
}
fn catalog(file: ModelFile) -> Manifest {
    Manifest {
        schema_version: 1,
        id: "test-v1".into(),
        label: "Test".into(),
        core_version: "test".into(),
        license: "test".into(),
        license_url: "https://example.org".into(),
        files: vec![file],
    }
}
fn manager(root: &Path, total: u64) -> ModelManager {
    let m = ModelManager::default();
    m.begin(root, total).unwrap();
    m
}
fn server(response: String, expected_range: &'static str) -> (String, thread::JoinHandle<()>) {
    let socket = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}/model", socket.local_addr().unwrap());
    let join = thread::spawn(move || {
        let (mut stream, _) = socket.accept().unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(3)))
            .unwrap();
        let mut request = Vec::new();
        let mut byte = [0u8; 1];
        while !request.ends_with(b"\r\n\r\n") {
            stream.read_exact(&mut byte).unwrap();
            request.push(byte[0]);
        }
        assert!(String::from_utf8_lossy(&request)
            .to_lowercase()
            .contains(expected_range));
        stream.write_all(response.as_bytes()).unwrap();
    });
    (url, join)
}
fn client() -> Client {
    Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(3))
        .build()
        .unwrap()
}

#[test]
fn bundled_manifest_is_pinned_and_contains_both_weights() {
    let m = manifest_for(crate::plan::Engine::Torch).unwrap();
    assert_eq!(m.files.len(), 17);
    assert_eq!(m.total(), 7_794_565_436);
    for file in &m.files {
        assert!(!file.url.contains("/main/"));
    }
    assert!(m
        .files
        .iter()
        .any(|f| f.path == "YuE2-3B/model.safetensors"));
    assert!(m
        .files
        .iter()
        .any(|f| f.path == "YuE2-Vae/model.safetensors"));
}
#[test]
fn manifest_rejects_traversal_duplicate_paths_and_untrusted_hosts() {
    let mut m = catalog(fixture(b"hello"));
    m.files[0].path = "../escape".into();
    assert!(m.validate().is_err());
    m.files[0].path = "C:\\escape".into();
    assert!(m.validate().is_err());
    m.files[0] = fixture(b"hello");
    m.files.push(m.files[0].clone());
    assert!(m.validate().is_err());
    m.files.pop();
    m.files[0].url = "https://example.com/model".into();
    assert!(m.validate().is_err());
}
#[test]
fn existing_model_validation_is_read_only_and_rejects_same_size_corruption() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path();
    let m = catalog(fixture(b"hello world"));
    let file = root.join(&m.files[0].path);
    fs::create_dir_all(file.parent().unwrap()).unwrap();
    fs::write(&file, b"hello world").unwrap();
    let state = manager(root, m.total());
    verify_existing(root, &m, &state).unwrap();
    fs::write(&file, b"HELLO WORLD").unwrap();
    assert!(verify_existing(root, &m, &state).is_err());
    assert_eq!(fs::read(&file).unwrap(), b"HELLO WORLD");
    assert!(!root.join("models.json").exists());
}
#[test]
fn partial_download_resumes_and_promotes_only_after_checksum_validation() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().canonicalize().unwrap();
    let mut f = fixture(b"hello world");
    let part = partial_path(&root, &f);
    fs::create_dir_all(part.parent().unwrap()).unwrap();
    fs::write(&part, b"hello").unwrap();
    let (url, join) = server("HTTP/1.1 206 Partial Content\r\nContent-Range: bytes 5-10/11\r\nContent-Length: 6\r\nConnection: close\r\n\r\n world".into(), "range: bytes=5-10");
    f.url = url;
    let m = catalog(f.clone());
    let state = manager(&root, m.total());
    prepare_downloads(&client(), &root, &m, &state).unwrap();
    join.join().unwrap();
    assert_eq!(fs::read(root.join(&f.path)).unwrap(), b"hello world");
    assert!(!part.exists());
    assert!(
        !state
            .0
            .status
            .lock()
            .unwrap()
            .as_ref()
            .unwrap()
            .generation_ready
    );
}
#[test]
fn ignored_range_restarts_instead_of_appending_duplicate_bytes() {
    let temp = tempfile::tempdir().unwrap();
    let part = temp.path().join("model.part");
    fs::write(&part, b"hello").unwrap();
    let mut f = fixture(b"hello world");
    let (url, join) = server(
        "HTTP/1.1 200 OK\r\nContent-Length: 11\r\nConnection: close\r\n\r\nhello world".into(),
        "range: bytes=5-10",
    );
    f.url = url;
    let state = manager(temp.path(), f.bytes);
    assert_eq!(
        transfer_range(&client(), &f, &part, &state, 0, 5).unwrap(),
        11
    );
    join.join().unwrap();
    assert_eq!(fs::read(&part).unwrap(), b"hello world");
}
#[test]
fn unexpected_range_never_modifies_existing_partial() {
    let temp = tempfile::tempdir().unwrap();
    let part = temp.path().join("model.part");
    fs::write(&part, b"hello").unwrap();
    let mut f = fixture(b"hello world");
    let (url, join) = server("HTTP/1.1 206 Partial Content\r\nContent-Range: bytes 0-5/11\r\nContent-Length: 6\r\nConnection: close\r\n\r\n world".into(), "range: bytes=5-10");
    f.url = url;
    assert!(transfer_range(&client(), &f, &part, &manager(temp.path(), f.bytes), 0, 5).is_err());
    join.join().unwrap();
    assert_eq!(fs::read(&part).unwrap(), b"hello");
}
#[test]
fn corrupt_complete_partial_is_discarded_not_promoted() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().canonicalize().unwrap();
    let m = catalog(fixture(b"hello world"));
    let part = partial_path(&root, &m.files[0]);
    fs::create_dir_all(part.parent().unwrap()).unwrap();
    fs::write(&part, b"HELLO WORLD").unwrap();
    assert!(prepare_downloads(&client(), &root, &m, &manager(&root, m.total())).is_err());
    assert!(!part.exists());
    assert!(!root.join(&m.files[0].path).exists());
}
#[test]
fn pause_preserves_partial_and_exclusive_job_slot() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().canonicalize().unwrap();
    let m = catalog(fixture(b"hello world"));
    let part = partial_path(&root, &m.files[0]);
    fs::create_dir_all(part.parent().unwrap()).unwrap();
    fs::write(&part, b"hello").unwrap();
    let state = manager(&root, m.total());
    assert!(state.begin(&root, m.total()).is_err());
    state.0.pause.store(true, Ordering::SeqCst);
    finish(&state, prepare_downloads(&client(), &root, &m, &state));
    assert_eq!(fs::read(&part).unwrap(), b"hello");
    assert_eq!(
        state.0.status.lock().unwrap().as_ref().unwrap().phase,
        "paused"
    );
}
#[test]
fn lock_blocks_another_process_and_releases_on_drop() {
    let temp = tempfile::tempdir().unwrap();
    let first = lock_storage(temp.path()).unwrap();
    assert!(lock_storage(temp.path()).is_err());
    drop(first);
    assert!(lock_storage(temp.path()).is_ok());
}
#[test]
fn selected_location_is_persisted_atomically_and_replaceable() {
    let temp = tempfile::tempdir().unwrap();
    save_selection(temp.path(), Path::new("first"), "v1").unwrap();
    save_selection(temp.path(), Path::new("second"), "v1").unwrap();
    let saved: SavedModels =
        serde_json::from_slice(&fs::read(temp.path().join("models.json")).unwrap()).unwrap();
    assert_eq!(saved.model_root, Path::new("second"));
}
#[cfg(unix)]
#[test]
fn managed_download_rejects_symlinks_before_writing() {
    use std::os::unix::fs::symlink;
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().canonicalize().unwrap();
    let outside = tempfile::tempdir().unwrap();
    symlink(outside.path(), root.join("YuE2-3B")).unwrap();
    let m = catalog(fixture(b"hello world"));
    assert!(prepare_downloads(&client(), &root, &m, &manager(&root, m.total())).is_err());
    assert_eq!(fs::read_dir(outside.path()).unwrap().count(), 0);
}

#[test]
#[ignore = "Explicit network smoke test: downloads one pinned 959-byte configuration file, never weights"]
fn live_pinned_configuration_download() {
    let mut m = manifest_for(crate::plan::Engine::Torch).unwrap();
    m.files.retain(|f| f.path == "YuE2-3B/config.json");
    assert_eq!(m.total(), 959);
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().canonicalize().unwrap();
    let client = Client::builder()
        .https_only(true)
        .timeout(Duration::from_secs(30))
        .build()
        .unwrap();
    prepare_downloads(&client, &root, &m, &manager(&root, m.total())).unwrap();
    assert_eq!(
        fs::metadata(root.join("YuE2-3B/config.json"))
            .unwrap()
            .len(),
        959
    );
}

#[test]
fn restart_requires_reverification_even_after_a_saved_success() {
    let temp = tempfile::tempdir().unwrap();
    let m = catalog(fixture(b"hello world"));
    save_selection(temp.path(), Path::new("previously-verified"), &m.id).unwrap();
    let state = restore_status(temp.path(), &m);
    assert_eq!(state.phase, "unverified");
    assert_eq!(state.operation.as_deref(), Some("verify"));
    assert!(!state.models_verified);
    assert!(!state.generation_ready);
    assert_eq!(state.runtime_state, "not_bundled");
}
#[test]
fn restart_recovers_an_interrupted_managed_download() {
    let temp = tempfile::tempdir().unwrap();
    let m = catalog(fixture(b"hello world"));
    fs::create_dir_all(managed_root(temp.path(), &m)).unwrap();
    let state = restore_status(temp.path(), &m);
    assert_eq!(state.phase, "paused");
    assert_eq!(state.operation.as_deref(), Some("download"));
    assert!(!state.models_verified);
    assert!(!state.generation_ready);
}
#[test]
fn corrupt_saved_settings_do_not_grant_readiness() {
    let temp = tempfile::tempdir().unwrap();
    let m = catalog(fixture(b"hello world"));
    fs::write(temp.path().join("models.json"), b"{broken").unwrap();
    let state = restore_status(temp.path(), &m);
    assert_eq!(state.phase, "not_started");
    assert!(!state.models_verified);
}

#[test]
fn unchanged_verified_models_stay_ready_after_restart_and_changes_require_checks() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("models");
    let m = catalog(fixture(b"hello world"));
    fs::create_dir_all(root.join("YuE2-3B")).unwrap();
    fs::write(root.join(&m.files[0].path), b"hello world").unwrap();
    save_verified(temp.path(), &root, &m).unwrap();
    let state = restore_status(temp.path(), &m);
    assert_eq!(state.phase, "verified");
    assert!(state.models_verified);
    assert!(!state.generation_ready);
    fs::write(root.join(&m.files[0].path), b"hello there").unwrap();
    let file = File::options()
        .write(true)
        .open(root.join(&m.files[0].path))
        .unwrap();
    file.set_modified(std::time::SystemTime::UNIX_EPOCH + Duration::from_secs(1))
        .unwrap();
    let state = restore_status(temp.path(), &m);
    assert_eq!(state.phase, "unverified");
    assert!(!state.models_verified);
}

#[test]
fn removing_models_deletes_only_aulos_own_folder() {
    let base = tempfile::tempdir().unwrap();
    let own = base.path().join("models").join("test-v1").join("YuE2-3B");
    fs::create_dir_all(&own).unwrap();
    fs::write(own.join("model.safetensors"), b"weights").unwrap();
    fs::create_dir_all(base.path().join("models").join("gguf")).unwrap();
    save_selection(base.path(), &own, "test-v1").unwrap();
    // Songs live beside the models and must survive.
    fs::create_dir_all(base.path().join("library")).unwrap();
    assert_eq!(remove_model_files(base.path()).unwrap(), None);
    assert!(!base.path().join("models").exists());
    assert!(!base.path().join("models.json").exists());
    assert!(base.path().join("library").exists());
    // Nothing left to remove is not an error.
    assert_eq!(remove_model_files(base.path()).unwrap(), None);
}

#[test]
fn removing_models_never_touches_a_folder_the_person_chose() {
    let base = tempfile::tempdir().unwrap();
    let theirs = tempfile::tempdir().unwrap();
    fs::write(theirs.path().join("model.safetensors"), b"weights").unwrap();
    save_selection(base.path(), theirs.path(), "test-v1").unwrap();
    let kept = remove_model_files(base.path()).unwrap();
    assert_eq!(kept.as_deref(), Some(theirs.path()));
    assert!(theirs.path().join("model.safetensors").exists());
    assert!(!base.path().join("models.json").exists());
}

#[cfg(unix)]
#[test]
fn removing_models_does_not_follow_a_link_out_of_aulos_folder() {
    let base = tempfile::tempdir().unwrap();
    let elsewhere = tempfile::tempdir().unwrap();
    fs::write(elsewhere.path().join("keep.txt"), b"mine").unwrap();
    std::os::unix::fs::symlink(elsewhere.path(), base.path().join("models")).unwrap();
    remove_model_files(base.path()).unwrap();
    assert!(!base.path().join("models").exists());
    assert!(elsewhere.path().join("keep.txt").exists());
}

#[test]
fn a_removal_that_stops_halfway_never_leaves_the_models_ready() {
    let base = tempfile::tempdir().unwrap();
    let m = catalog(fixture(b"hello world"));
    let root = managed_root(base.path(), &m);
    fs::create_dir_all(root.join("YuE2-3B")).unwrap();
    fs::write(root.join(&m.files[0].path), b"hello world").unwrap();
    save_verified(base.path(), &root, &m).unwrap();
    assert!(restore_status(base.path(), &m).models_verified);
    // Files gone but the record still there, as after an interrupted removal.
    fs::remove_file(root.join(&m.files[0].path)).unwrap();
    let state = restore_status(base.path(), &m);
    assert!(!state.models_verified);
    assert_ne!(state.phase, "verified");
    // A completed removal starts from scratch.
    remove_model_files(base.path()).unwrap();
    let state = restore_status(base.path(), &m);
    assert_eq!(state.phase, "not_started");
}

#[test]
fn each_engine_downloads_only_its_own_weights() {
    use crate::plan::Engine;
    let torch = manifest_for(Engine::Torch).unwrap();
    let gguf = manifest_for(Engine::Gguf).unwrap();
    assert_ne!(torch.id, gguf.id);
    let weights = |m: &Manifest| -> Vec<String> {
        m.files
            .iter()
            .filter(|f| f.path.ends_with(".safetensors") || f.path.ends_with(".gguf"))
            .map(|f| f.path.clone())
            .collect()
    };
    assert_eq!(
        weights(&torch),
        ["YuE2-3B/model.safetensors", "YuE2-Vae/model.safetensors"]
    );
    assert_eq!(
        weights(&gguf),
        ["gguf/YuE2-3B-Q8_0.gguf", "gguf/YuE2-Vae-F32.gguf"]
    );
    // The GGUF engine still reads the tokenizer from the checkpoint folder.
    assert!(gguf.files.iter().any(|f| f.path == "YuE2-3B/qwen.tiktoken"));
    assert!(torch.total() > 7_700_000_000);
    assert!(gguf.total() < 4_400_000_000);
}

#[test]
fn an_update_to_new_models_reuses_unchanged_files_and_leaves_one_set() {
    let temp = tempfile::tempdir().unwrap();
    let base = temp.path();
    let old = base.join("models/yue2-source-v1");
    let root = base.join("models/yue2-source-v2");
    let same = fixture(b"unchanged weights");
    fs::create_dir_all(old.join("YuE2-3B")).unwrap();
    fs::write(old.join(&same.path), b"unchanged weights").unwrap();
    fs::write(old.join("YuE2-3B/retired.bin"), b"no longer listed").unwrap();
    let changed = ModelFile {
        path: "YuE2-Vae/model.safetensors".into(),
        bytes: 99,
        ..fixture(b"x")
    };
    fs::create_dir_all(old.join("YuE2-Vae")).unwrap();
    fs::write(old.join(&changed.path), b"a different size").unwrap();
    let mut m = catalog(same.clone());
    m.files.push(changed.clone());

    adopt_previous(base, &root, &m).unwrap();

    assert_eq!(
        fs::read(root.join(&same.path)).unwrap(),
        b"unchanged weights"
    );
    assert!(
        !root.join(&changed.path).exists(),
        "a changed file is downloaded"
    );
    assert!(!old.exists(), "the earlier set is gone");
    let left: Vec<_> = fs::read_dir(base.join("models")).unwrap().collect();
    assert_eq!(left.len(), 1);
}

#[test]
fn clearing_old_sets_keeps_the_folder_in_use_and_never_follows_links() {
    let temp = tempfile::tempdir().unwrap();
    let base = temp.path();
    let models = base.join("models");
    let keep = models.join("chosen/inside");
    fs::create_dir_all(&keep).unwrap();
    fs::write(keep.join("weights"), b"in use").unwrap();
    fs::create_dir_all(models.join("old-v1")).unwrap();
    let outside = tempfile::tempdir().unwrap();
    fs::write(outside.path().join("theirs"), b"not Aulo's").unwrap();
    #[cfg(unix)]
    std::os::unix::fs::symlink(outside.path(), models.join("link")).unwrap();

    remove_managed_except(base, &keep).unwrap();

    assert_eq!(fs::read(keep.join("weights")).unwrap(), b"in use");
    assert!(!models.join("old-v1").exists());
    #[cfg(unix)]
    assert!(fs::symlink_metadata(models.join("link")).is_err());
    assert!(outside.path().join("theirs").exists());
    // Nothing to clear is fine too.
    remove_managed_except(&base.join("missing"), &keep).unwrap();
}

#[test]
fn windows_models_always_get_a_path_yue2cpp_can_open() {
    let plain = Path::new(r"C:\Users\amy\AppData\Local\studio.aulo.desktop\models");
    assert_eq!(models_home_for(plain, true, None), plain);
    for name in ["张三", "さくら", "김민준", "José"] {
        let own = PathBuf::from(format!(
            r"C:\Users\{name}\AppData\Local\studio.aulo.desktop\models"
        ));
        let home = models_home_for(&own, true, Some(PathBuf::from(r"D:\ProgramData")));
        assert!(home.to_string_lossy().is_ascii(), "{name}");
        assert!(home.starts_with(r"D:\ProgramData"));
        // The same account always gets the same folder; another account another one.
        assert_eq!(
            home,
            models_home_for(&own, true, Some(PathBuf::from(r"D:\ProgramData")))
        );
        assert_ne!(home, models_home_for(&plain.join("x"), true, None));
    }
    // Other systems open any path.
    let mac = Path::new("/Users/张三/Library/Application Support/studio.aulo.desktop/models");
    assert_eq!(models_home_for(mac, false, None), mac);
}
