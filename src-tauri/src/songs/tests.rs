use super::*;
use crate::collections::DEFAULT_WORKSPACE;

fn request() -> SongRequest {
    SongRequest {
        title: "Sunday".into(),
        style: "warm piano".into(),
        lyrics: "[Verse]\nhello".into(),
        instrumental: false,
        vocal: "auto".into(),
        weirdness: 50,
        style_influence: 50,
    }
}

fn work(id: &str, state: SongState) -> Work {
    Work {
        id: id.into(),
        created_ms: 1,
        request: request(),
        favorite: false,
        state,
        stage: None,
        progress: None,
        started_ms: None,
        duration: None,
        audio_path: None,
        message: None,
        workspace: DEFAULT_WORKSPACE.into(),
        trashed_ms: None,
        seed: None,
    }
}

const ID: &str = "0123456789abcdef0123456789abcdef";

#[test]
fn seeds_are_recorded_and_older_records_have_none() {
    assert!((0..100).all(|_| new_seed() < 1 << 31));
    let mut w = work(ID, SongState::Completed);
    let old = serde_json::to_value(&w).unwrap();
    assert!(old.get("seed").is_none());
    let back: Work = serde_json::from_value(old).unwrap();
    assert_eq!(back.seed, None);
    w.seed = Some(42);
    let json = serde_json::to_value(&w).unwrap();
    assert_eq!(json["seed"], 42);
}

#[test]
fn requests_need_a_sound_and_words_or_an_instrumental() {
    assert!(request().validate().is_ok());
    let mut r = request();
    r.style = " ".into();
    assert!(r.validate().is_err());
    let mut r = request();
    r.lyrics.clear();
    assert!(r.validate().is_err());
    r.instrumental = true;
    assert!(r.validate().is_ok());
    let mut r = request();
    r.vocal = "robot".into();
    assert!(r.validate().is_err());
    let mut r = request();
    r.weirdness = 101;
    assert!(r.validate().is_err());
}

#[test]
fn ids_are_random_lowercase_hex() {
    let id = new_id();
    assert!(valid_id(&id));
    assert_ne!(id, new_id());
    for bad in ["../etc", "ABCDEF0123456789abcdef0123456789", "abc"] {
        assert!(!valid_id(bad));
    }
}

#[test]
fn unfinished_works_are_interrupted_and_missing_audio_is_not_completed() {
    let temp = tempfile::tempdir().unwrap();
    let other = "fedcba9876543210fedcba9876543210";
    write_record(temp.path(), &work(ID, SongState::Running)).unwrap();
    write_record(temp.path(), &work(other, SongState::Completed)).unwrap();
    fs::create_dir_all(temp.path().join("not-a-work")).unwrap();
    let works = load_library(temp.path());
    assert_eq!(works.len(), 2);
    let interrupted = works.iter().find(|w| w.id == ID).unwrap();
    assert_eq!(interrupted.state, SongState::Interrupted);
    let reloaded: Work =
        serde_json::from_slice(&fs::read(temp.path().join(ID).join(RECORD)).unwrap()).unwrap();
    assert_eq!(reloaded.state, SongState::Interrupted);
    let missing = works.iter().find(|w| w.id == other).unwrap();
    assert_eq!(missing.state, SongState::Failed);
    assert!(missing.audio_path.is_none());
}

/// A FLAC header for 48 kHz stereo 24-bit audio of `frames` frames.
fn flac_header(frames: u64) -> Vec<u8> {
    let mut bytes = b"fLaC".to_vec();
    bytes.extend([0x80, 0, 0, 34]); // last metadata block, STREAMINFO, 34 bytes
    bytes.extend([0x10, 0x00, 0x10, 0x00, 0, 0, 0, 0, 0, 0]);
    // 20-bit rate, 3-bit channels - 1, 5-bit bits - 1, 36-bit frame count.
    let packed: u64 = (48_000 << 44) | (1 << 41) | (23 << 36) | frames;
    bytes.extend(packed.to_be_bytes());
    bytes.extend([0; 16]);
    bytes
}

#[test]
fn trash_expires_after_the_chosen_days_only() {
    let day = 24 * 60 * 60 * 1000;
    let now = 100 * day;
    let mut old = work(ID, SongState::Completed);
    old.trashed_ms = Some(now - 30 * day);
    let mut recent = work("fedcba9876543210fedcba9876543210", SongState::Completed);
    recent.trashed_ms = Some(now - 29 * day);
    let kept = work("00000000000000000000000000000001", SongState::Completed);
    assert_eq!(
        expired_trash(&[old, recent, kept], now, 30),
        vec![ID.to_string()]
    );
    // A clock set back never deletes anything early.
    let mut future = work(ID, SongState::Completed);
    future.trashed_ms = Some(now + day);
    assert!(expired_trash(&[future], now, 30).is_empty());
}

#[test]
fn the_engine_stays_loaded_only_as_long_as_settings_say() {
    assert_eq!(idle_limit(false), Some(Duration::from_secs(600)));
    assert_eq!(idle_limit(true), None);
    assert_eq!(
        idle_wait(true, false, false),
        IdleWait::For(Duration::from_secs(600))
    );
    assert_eq!(idle_wait(true, false, true), IdleWait::UntilWoken);
    // Free up memory now wins over keeping it loaded.
    assert_eq!(idle_wait(true, true, true), IdleWait::Unload);
    // Nothing loaded: a stale release request is simply dropped.
    assert_eq!(idle_wait(false, true, false), IdleWait::UntilWoken);
}

#[test]
fn changes_that_cannot_be_saved_are_undone() {
    let temp = tempfile::tempdir().unwrap();
    let mut w = work(ID, SongState::Completed);
    save_change(temp.path(), &mut w, |w| w.favorite = true).unwrap();
    assert!(w.favorite);
    // A library folder that cannot hold the record, like a full or read-only disk.
    let blocked = temp.path().join("blocked");
    fs::write(&blocked, b"").unwrap();
    let error = save_change(&blocked, &mut w, |w| w.request.title = "Lost".into()).unwrap_err();
    assert!(error.contains("couldn’t save"));
    assert_eq!(w.request.title, "Sunday");
    assert!(w.favorite);
}

#[test]
fn finished_audio_whose_record_was_not_saved_is_recovered() {
    let temp = tempfile::tempdir().unwrap();
    let other = "fedcba9876543210fedcba9876543210";
    for id in [ID, other] {
        write_record(temp.path(), &work(id, SongState::Running)).unwrap();
        fs::write(temp.path().join(id).join("audio.flac"), flac_header(96_000)).unwrap();
    }
    // The engine was still writing this one.
    fs::write(temp.path().join(other).join("pending.json"), b"{}").unwrap();
    let works = load_library(temp.path());
    let recovered = works.iter().find(|w| w.id == ID).unwrap();
    assert_eq!(recovered.state, SongState::Completed);
    assert_eq!(recovered.duration, Some(2.0));
    assert!(recovered.audio_path.is_some());
    let unfinished = works.iter().find(|w| w.id == other).unwrap();
    assert_eq!(unfinished.state, SongState::Interrupted);
}

#[test]
fn completed_works_with_audio_are_playable() {
    let temp = tempfile::tempdir().unwrap();
    write_record(temp.path(), &work(ID, SongState::Completed)).unwrap();
    fs::write(temp.path().join(ID).join("audio.flac"), b"fixture").unwrap();
    let works = load_library(temp.path());
    assert!(works[0]
        .audio_path
        .as_deref()
        .unwrap()
        .ends_with("audio.flac"));
}

#[test]
fn events_update_progress_and_completion_requires_real_audio() {
    let temp = tempfile::tempdir().unwrap();
    let folder = temp.path();
    let mut w = work(ID, SongState::Running);
    let progress = parse_event(
        br#"{"protocolVersion":3,"event":"progress","stage":"rendering","completed":3,"total":32}"#,
    )
    .unwrap();
    assert!(apply_event(&mut w, &progress, folder));
    assert_eq!(w.stage.as_deref(), Some("rendering"));
    assert_eq!(
        w.progress,
        Some(Progress {
            completed: 3,
            total: 32
        })
    );
    let unknown =
        parse_event(br#"{"protocolVersion":3,"event":"progress","stage":"hacking"}"#).unwrap();
    assert!(!apply_event(&mut w, &unknown, folder));
    let done = parse_event(
        br#"{"protocolVersion":3,"event":"completed","work":{"audio":"audio.flac","duration":61.5}}"#,
    )
    .unwrap();
    assert!(!apply_event(&mut w, &done, folder));
    assert_eq!(w.state, SongState::Running);
    fs::write(folder.join("audio.flac"), b"fixture").unwrap();
    fs::write(folder.join("pending.json"), b"{}").unwrap();
    assert!(!apply_event(&mut w, &done, folder));
    fs::remove_file(folder.join("pending.json")).unwrap();
    assert!(apply_event(&mut w, &done, folder));
    assert_eq!(w.state, SongState::Completed);
    assert_eq!(w.duration, Some(61.5));
    assert!(parse_event(br#"{"protocolVersion":2,"event":"failed"}"#).is_none());
}

#[cfg(unix)]
fn fixture_engine(dir: &Path, body: &str) -> std::process::Command {
    use std::os::unix::fs::PermissionsExt;
    let fixture = dir.join("engine");
    fs::write(&fixture, format!("#!/bin/sh\n{body}")).unwrap();
    fs::set_permissions(&fixture, fs::Permissions::from_mode(0o700)).unwrap();
    let mut command = std::process::Command::new(&fixture);
    command.stdin(Stdio::piped()).stdout(Stdio::piped());
    command
}

#[cfg(unix)]
#[test]
fn engine_process_serves_commands_and_streams_events() {
    let dir = tempfile::tempdir().unwrap();
    let captured = dir.path().join("commands");
    let command = fixture_engine(
        dir.path(),
        &format!(
            "read first; echo \"$first\" > '{0}'\necho noise\necho '{{\"protocolVersion\":3,\"event\":\"ready\"}}'\nread cmd; echo \"$cmd\" >> '{0}'\necho '{{\"protocolVersion\":3,\"event\":\"progress\",\"stage\":\"writing\",\"workId\":\"{1}\"}}'\nread done; echo \"$done\" >> '{0}'\n",
            captured.display(),
            ID
        ),
    );
    let process = EngineProcess::start(command, None, 3, Duration::from_secs(5)).expect("ready");
    process
        .send(&generate_command(
            ID,
            &request(),
            7,
            Path::new("/m"),
            Path::new("/o"),
        ))
        .unwrap();
    match process.next(Duration::from_secs(5)).unwrap() {
        Output::Event(event) => {
            assert_eq!(event.stage.as_deref(), Some("writing"));
            assert_eq!(event.work_id.as_deref(), Some(ID));
        }
        Output::Closed => panic!("closed early"),
    }
    process.shutdown(Duration::from_secs(5));
    let lines = fs::read_to_string(captured).unwrap();
    assert!(lines.contains("\"operation\":\"serve\""));
    assert!(lines.contains("\"operation\":\"generate\""));
    assert!(lines.contains("\"seed\":7"));
    assert!(lines.contains("\"operation\":\"shutdown\""));
}

#[cfg(unix)]
#[test]
fn engines_that_never_become_ready_are_stopped() {
    let dir = tempfile::tempdir().unwrap();
    for body in ["exit 1\n", "exec sleep 30\n"] {
        let started = std::time::Instant::now();
        let command = fixture_engine(dir.path(), body);
        assert!(EngineProcess::start(command, None, 3, Duration::from_millis(300)).is_err());
        assert!(started.elapsed() < Duration::from_secs(5));
    }
}

#[cfg(unix)]
#[test]
fn a_crashed_engine_reports_closed_output() {
    let dir = tempfile::tempdir().unwrap();
    let command = fixture_engine(
        dir.path(),
        "read first\necho '{\"protocolVersion\":3,\"event\":\"ready\"}'\nexit 3\n",
    );
    let process = EngineProcess::start(command, None, 3, Duration::from_secs(5)).unwrap();
    assert!(matches!(
        process.next(Duration::from_secs(5)),
        Ok(Output::Closed)
    ));
}

struct Live {
    process: EngineProcess,
    output: PathBuf,
    models: PathBuf,
}

fn live_engine() -> Live {
    let python = PathBuf::from(std::env::var_os("AULO_DEV_PYTHON").expect("Set AULO_DEV_PYTHON"));
    let models = PathBuf::from(std::env::var_os("AULO_DEV_MODELS").expect("Set AULO_DEV_MODELS"));
    let output = PathBuf::from(std::env::var_os("AULO_DEV_OUTPUT").expect("Set AULO_DEV_OUTPUT"));
    fs::create_dir_all(&output).unwrap();
    let script = engine::bridge_script().unwrap();
    let mut command = engine::bridge_command(&python, script.path(), &output);
    command.stderr(File::create(output.join("engine.log")).unwrap());
    let process = EngineProcess::start(
        command,
        Some(script),
        engine::PROTOCOL_VERSION,
        ENGINE_START,
    )
    .unwrap();
    Live {
        process,
        output,
        models,
    }
}

fn live_song(live: &Live, cancel_at: Option<&str>) -> (Vec<EngineEvent>, PathBuf, f64) {
    let id = new_id();
    let mut r = request();
    r.style = "warm acoustic folk, gentle guitar, female vocal".into();
    r.lyrics = "[Verse]\nMorning light across the kitchen floor\nCoffee warm and nothing more\n[Chorus]\nSlow down, slow down, Sunday".into();
    let started = std::time::Instant::now();
    live.process
        .send(&generate_command(&id, &r, 11, &live.models, &live.output))
        .unwrap();
    let mut events = Vec::new();
    loop {
        let Output::Event(event) = live.process.next(ENGINE_WATCHDOG).unwrap() else {
            panic!("engine closed");
        };
        if cancel_at.is_some() && event.stage.as_deref() == cancel_at {
            live.process
                .send(&serde_json::json!({"operation": "cancel", "workId": id}))
                .unwrap();
        }
        let terminal = matches!(event.event.as_str(), "completed" | "cancelled" | "failed");
        eprintln!(
            "{:?} {:?} {:?}",
            event.event,
            event.stage,
            started.elapsed()
        );
        events.push(event);
        if terminal {
            break;
        }
    }
    (
        events,
        live.output.join(id),
        started.elapsed().as_secs_f64(),
    )
}

#[test]
#[ignore = "Generates two real songs with one resident development engine"]
fn live_resident_engine_generates_and_reuses_the_model() {
    let live = live_engine();
    let (events, folder, first) = live_song(&live, None);
    let mut w = work(
        folder.file_name().unwrap().to_str().unwrap(),
        SongState::Running,
    );
    assert!(apply_event(&mut w, events.last().unwrap(), &folder));
    assert_eq!(w.state, SongState::Completed);
    let (events, _, cancelled) = live_song(&live, Some("performing"));
    assert_eq!(events.last().unwrap().event, "cancelled");
    let (events, folder, second) = live_song(&live, None);
    let mut w = work(
        folder.file_name().unwrap().to_str().unwrap(),
        SongState::Running,
    );
    assert!(apply_event(&mut w, events.last().unwrap(), &folder));
    eprintln!("first {first:.1}s, cancelled after {cancelled:.1}s, second {second:.1}s");
    live.process.shutdown(Duration::from_secs(20));
}

#[test]
fn flac_export_copies_the_original_and_replaces_only_when_done() {
    let dir = tempfile::tempdir().unwrap();
    let source = dir.path().join("audio.flac");
    fs::write(&source, b"original").unwrap();
    let destination = dir.path().join("Song.flac");
    fs::write(&destination, b"old").unwrap();
    export_audio(
        &source,
        AudioFormat::Flac,
        &destination,
        &Default::default(),
    )
    .unwrap();
    assert_eq!(fs::read(&destination).unwrap(), b"original");
    let leftovers = fs::read_dir(dir.path())
        .unwrap()
        .filter(|e| {
            e.as_ref()
                .unwrap()
                .file_name()
                .to_string_lossy()
                .starts_with(".aulo-")
        })
        .count();
    assert_eq!(leftovers, 0);
}

#[test]
fn failed_conversions_leave_the_destination_untouched() {
    let dir = tempfile::tempdir().unwrap();
    let source = dir.path().join("audio.flac");
    fs::write(&source, b"not audio").unwrap();
    let destination = dir.path().join("Song.mp3");
    fs::write(&destination, b"keep").unwrap();
    assert!(export_audio(&source, AudioFormat::Mp3, &destination, &Default::default()).is_err());
    assert_eq!(fs::read(&destination).unwrap(), b"keep");
}

#[cfg(target_os = "macos")]
#[test]
#[ignore = "Converts a real song produced by the music engine"]
fn live_exports_every_format() {
    let source = PathBuf::from(std::env::var_os("AULO_DEV_FLAC").expect("Set AULO_DEV_FLAC"));
    let dir = tempfile::tempdir().unwrap();
    let dir = std::env::var_os("AULO_DEV_EXPORT_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| dir.path().to_path_buf());
    for format in [
        AudioFormat::M4a,
        AudioFormat::Mp3,
        AudioFormat::Wav,
        AudioFormat::Flac,
    ] {
        let destination = dir.join(format!("Song.{}", format.extension()));
        let started = std::time::Instant::now();
        export_audio(&source, format, &destination, &Default::default()).unwrap();
        let size = fs::metadata(&destination).unwrap().len();
        eprintln!("{format:?}: {size} bytes in {:?}", started.elapsed());
        assert!(size > 100_000);
    }
}

#[test]
fn finishing_settles_only_songs_the_engine_left_active() {
    let mut done = work(ID, SongState::Completed);
    finish(&mut done, &Err("boom".into()), false);
    assert_eq!(done.state, SongState::Completed);

    let mut stopped = work(ID, SongState::Running);
    stopped.stage = Some("performing".into());
    finish(&mut stopped, &Err("closed".into()), true);
    assert_eq!(stopped.state, SongState::Cancelled);
    assert!(stopped.stage.is_none() && stopped.message.is_none());

    let mut crashed = work(ID, SongState::Running);
    finish(
        &mut crashed,
        &Err("The music engine stopped unexpectedly.".into()),
        false,
    );
    assert_eq!(crashed.state, SongState::Failed);
    assert_eq!(
        crashed.message.as_deref(),
        Some("The music engine stopped unexpectedly.")
    );

    let mut silent = work(ID, SongState::Running);
    finish(&mut silent, &Ok(()), false);
    assert_eq!(silent.state, SongState::Failed);
    assert!(silent.message.is_some());
}

#[test]
fn song_state_keeps_its_lowercase_file_format() {
    let json = serde_json::to_value(work(ID, SongState::Interrupted)).unwrap();
    assert_eq!(json["state"], "interrupted");
    let parsed: Work = serde_json::from_value(json).unwrap();
    assert_eq!(parsed.state, SongState::Interrupted);
}

#[test]
fn records_without_a_workspace_belong_to_my_workspace() {
    let mut json = serde_json::to_value(work(ID, SongState::Completed)).unwrap();
    json.as_object_mut().unwrap().remove("workspace");
    let parsed: Work = serde_json::from_value(json).unwrap();
    assert_eq!(parsed.workspace, DEFAULT_WORKSPACE);
}

#[test]
fn saved_files_always_end_in_their_format() {
    assert_eq!(
        with_extension(PathBuf::from("/Users/me/Music/Sunday.mp3"), "mp3"),
        PathBuf::from("/Users/me/Music/Sunday.mp3")
    );
    assert_eq!(
        with_extension(PathBuf::from("/Users/me/Music/Sunday.MP3"), "mp3"),
        PathBuf::from("/Users/me/Music/Sunday.MP3")
    );
    assert_eq!(
        with_extension(PathBuf::from("/Users/me/Music/Sunday"), "wav"),
        PathBuf::from("/Users/me/Music/Sunday.wav")
    );
    assert_eq!(
        with_extension(PathBuf::from("/Users/me/Music/Sunday.v2"), "flac"),
        PathBuf::from("/Users/me/Music/Sunday.v2.flac")
    );
}

#[test]
fn a_completed_name_never_replaces_a_file_the_save_window_did_not_ask_about() {
    let dir = tempfile::tempdir().unwrap();
    let typed = dir.path().join("foo");
    assert_eq!(
        checked_destination(typed.clone(), "wav").unwrap(),
        dir.path().join("foo.wav")
    );
    fs::write(dir.path().join("foo.wav"), b"keep").unwrap();
    let error = checked_destination(typed, "wav").unwrap_err();
    assert!(error.contains("“foo.wav” is already there"));
    assert_eq!(fs::read(dir.path().join("foo.wav")).unwrap(), b"keep");
    // A name the window showed in full was confirmed there, so it may be replaced.
    assert_eq!(
        checked_destination(dir.path().join("foo.wav"), "wav").unwrap(),
        dir.path().join("foo.wav")
    );
}
