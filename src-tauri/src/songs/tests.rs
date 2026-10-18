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
        br#"{"protocolVersion":2,"event":"progress","stage":"rendering","completed":3,"total":32}"#,
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
        parse_event(br#"{"protocolVersion":2,"event":"progress","stage":"hacking"}"#).unwrap();
    assert!(!apply_event(&mut w, &unknown, folder));
    let done = parse_event(
        br#"{"protocolVersion":2,"event":"completed","work":{"audio":"audio.flac","duration":61.5}}"#,
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
    assert!(parse_event(br#"{"protocolVersion":1,"event":"failed"}"#).is_none());
}

#[cfg(unix)]
#[test]
fn engine_process_streams_events_and_receives_the_request() {
    use std::os::unix::fs::PermissionsExt;
    let dir = tempfile::tempdir().unwrap();
    let fixture = dir.path().join("engine");
    let captured = dir.path().join("request.json");
    fs::write(
        &fixture,
        format!(
            "#!/bin/sh\nhead -n 1 > '{}'\necho 'noise'\necho '{{\"protocolVersion\":2,\"event\":\"progress\",\"stage\":\"writing\"}}'\necho '{{\"protocolVersion\":2,\"event\":\"cancelled\"}}'\n",
            captured.display()
        ),
    )
    .unwrap();
    fs::set_permissions(&fixture, fs::Permissions::from_mode(0o700)).unwrap();
    let mut command = std::process::Command::new(&fixture);
    command.stdin(Stdio::piped()).stdout(Stdio::piped());
    let mut events = Vec::new();
    run_engine(
        command,
        &serde_json::json!({"operation": "generate"}),
        |_, _| {},
        |e| events.push(e.event),
    )
    .unwrap();
    assert_eq!(events, ["progress", "cancelled"]);
    assert!(fs::read_to_string(captured).unwrap().contains("generate"));
}

fn live_run(cancel_after: Option<&'static str>) -> (Vec<EngineEvent>, PathBuf) {
    let python = PathBuf::from(std::env::var_os("AULO_DEV_PYTHON").expect("Set AULO_DEV_PYTHON"));
    let models = PathBuf::from(std::env::var_os("AULO_DEV_MODELS").expect("Set AULO_DEV_MODELS"));
    let output = PathBuf::from(std::env::var_os("AULO_DEV_OUTPUT").expect("Set AULO_DEV_OUTPUT"));
    let id = new_id();
    fs::create_dir_all(output.join(&id)).unwrap();
    let script = engine::bridge_script().unwrap();
    let mut command = engine::bridge_command(&python, script.path(), &output);
    command.stderr(File::create(output.join(&id).join("engine.log")).unwrap());
    let request = serde_json::json!({
        "protocolVersion": engine::PROTOCOL_VERSION,
        "operation": "generate",
        "workId": id,
        "style": "warm acoustic folk, gentle guitar, female vocal",
        "lyrics": "[Verse]\nMorning light across the kitchen floor\nCoffee warm and nothing more\n[Chorus]\nSlow down, slow down, Sunday",
        "instrumental": false,
        "vocal": "female",
        "weirdness": 50,
        "styleInfluence": 50,
        "modelRoot": models,
        "outputRoot": output,
    });
    let stdin = Arc::new(Mutex::new(None));
    let mut events = Vec::new();
    run_engine(
        command,
        &request,
        |_, input| *stdin.lock().unwrap() = Some(input),
        |event| {
            if cancel_after.is_some() && event.stage.as_deref() == cancel_after {
                if let Some(input) = stdin.lock().unwrap().as_mut() {
                    input.write_all(b"cancel\n").unwrap();
                    input.flush().unwrap();
                }
            }
            eprintln!("{event:?}");
            events.push(event);
        },
    )
    .unwrap();
    (events, output.join(id))
}

#[test]
#[ignore = "Generates a real song with a local development engine and models"]
fn live_generation_produces_playable_audio() {
    let (events, folder) = live_run(None);
    let last = events.last().expect("engine events");
    let mut w = work(folder.file_name().unwrap().to_str().unwrap(), "running");
    assert!(apply_event(&mut w, last, &folder), "{last:?}");
    assert_eq!(w.state, "completed");
    assert!(w.duration.unwrap() > 10.0);
}

#[test]
#[ignore = "Starts and cancels a real song with a local development engine and models"]
fn live_cancellation_stops_the_engine() {
    let (events, folder) = live_run(Some("performing"));
    assert_eq!(events.last().unwrap().event, "cancelled");
    assert!(!folder.join("audio.flac").exists());
}
