use super::*;

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

fn work(id: &str, state: &str) -> Work {
    Work {
        id: id.into(),
        created_ms: 1,
        request: request(),
        favorite: false,
        state: state.into(),
        stage: None,
        progress: None,
        started_ms: None,
        duration: None,
        audio_path: None,
        message: None,
    }
}

const ID: &str = "0123456789abcdef0123456789abcdef";

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
    write_record(temp.path(), &work(ID, "running")).unwrap();
    write_record(temp.path(), &work(other, "completed")).unwrap();
    fs::create_dir_all(temp.path().join("not-a-work")).unwrap();
    let works = load_library(temp.path());
    assert_eq!(works.len(), 2);
    let interrupted = works.iter().find(|w| w.id == ID).unwrap();
    assert_eq!(interrupted.state, "interrupted");
    let reloaded: Work =
        serde_json::from_slice(&fs::read(temp.path().join(ID).join(RECORD)).unwrap()).unwrap();
    assert_eq!(reloaded.state, "interrupted");
    let missing = works.iter().find(|w| w.id == other).unwrap();
    assert_eq!(missing.state, "failed");
    assert!(missing.audio_path.is_none());
}

#[test]
fn completed_works_with_audio_are_playable() {
    let temp = tempfile::tempdir().unwrap();
    write_record(temp.path(), &work(ID, "completed")).unwrap();
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
    let mut w = work(ID, "running");
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
    assert_eq!(w.state, "running");
    fs::write(folder.join("audio.flac"), b"fixture").unwrap();
    fs::write(folder.join("pending.json"), b"{}").unwrap();
    assert!(!apply_event(&mut w, &done, folder));
    fs::remove_file(folder.join("pending.json")).unwrap();
    assert!(apply_event(&mut w, &done, folder));
    assert_eq!(w.state, "completed");
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
        .send(&generate_command(&id, &r, &live.models, &live.output))
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
    let mut w = work(folder.file_name().unwrap().to_str().unwrap(), "running");
    assert!(apply_event(&mut w, events.last().unwrap(), &folder));
    assert_eq!(w.state, "completed");
    let (events, _, cancelled) = live_song(&live, Some("performing"));
    assert_eq!(events.last().unwrap().event, "cancelled");
    let (events, folder, second) = live_song(&live, None);
    let mut w = work(folder.file_name().unwrap().to_str().unwrap(), "running");
    assert!(apply_event(&mut w, events.last().unwrap(), &folder));
    eprintln!("first {first:.1}s, cancelled after {cancelled:.1}s, second {second:.1}s");
    live.process.shutdown(Duration::from_secs(20));
}
