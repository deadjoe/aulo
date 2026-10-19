# Private music engine boundary

Aulo calls the existing installed `yue2_groove.adapter`; it does not import Gradio handlers, start a web server, copy model implementations, or change the GROOVE checkout. `runtime/bridge.py` uses protocol version 3 over UTF-8 newline-delimited JSON. Library output, including native stdout, is redirected to stderr. A process either answers one `probe` and exits, or `serve`s: it stays running, keeps the loaded model between songs, and reads `generate`, `cancel` and `shutdown` commands. Every event of a song carries its `workId`. The process leaves with `os._exit` so a command reader blocked on stdin cannot crash interpreter shutdown.

## The bundled engine

The engine ships inside Aulo. `scripts/build_engine.py` (`npm run engine`) produces `src-tauri/engine/`: a relocatable CPython 3.12 from python-build-standalone with YuE2 0.1.6, YUE2 // GROOVE 1.0.10 (installed without its web UI) and PyTorch, using GROOVE's validated dependency overrides. Windows gets PyPI's CPU-only PyTorch: it runs only the GGUF engine, whose yue2.cpp binaries bring their own CUDA, so a CUDA PyTorch would add about 2.5 GB that is never used. The build fails if a Windows engine ends up with a CUDA PyTorch. The build removes packaging tools, test suites, headers and console scripts, and keeps bytecode only for modules the engine imports; it then checks that the interpreter starts in isolation and that the adapter imports. On Apple silicon the engine is about 690 MB on disk, and the DMG about 200 MB.

`npm run bundle` builds the app with `src-tauri/tauri.bundle.conf.json`, which adds the engine as an app resource (`Aulo.app/Contents/Resources/engine`). A person who installs Aulo never installs Python or anything else; after the music models are prepared, Create works. `.github/workflows/package-macos.yml` builds the engine and the DMG on demand and on version tags.

Upgrading GROOVE or YuE2 touches the engine build, the bridge, the model manifests and the probe check. `engine.rs` names the expected releases once (`GROOVE_VERSION`, `YUE_VERSION`), and the test `every_part_of_aulo_names_the_same_groove_and_yue2_releases` fails until every other place names the same ones. `.github/workflows/package-windows.yml` builds the Windows engine and installer the same way as the macOS package; it runs on demand and on version tags, and has not been run yet.

## Discovery and readiness

The Rust `engine_status` command uses only the engine inside the app bundle. Debug builds may instead use an absolute `AULO_DEV_PYTHON` interpreter, or an engine built into `src-tauri/engine`. Release builds ignore both. No interpreter selector, command field, or dependency configuration is exposed to users. There is no PATH search or shell invocation, and the engine never writes bytecode into the signed bundle.

The probe checks the installed GROOVE 1.0.10 and YuE2 0.1.6 versions, imports the real adapter and PyTorch, and reports the engine it would run:

- The engine plan (see Engine plan below) chooses PyTorch or the GGUF engine (yue2.cpp) and is passed as `AULO_ENGINE`; only without a plan (development) does GROOVE's `gguf_engine.auto_backend` decide, which also sees NVIDIA cards that a CPU-only PyTorch cannot.
- On CUDA without a usable FlashAttention kernel, GROOVE's eager decoder is used, as in `webui/runtime.effective_backend`.
- A computer whose only option is the CPU is reported as unsupported; Aulo does not offer multi-hour CPU generation.

A successful probe is cached for the session. Creation requires both a ready engine and verified models; `creation_status` reports which one is missing in plain language. The native host enforces a probe timeout (three minutes, because a fresh Mac checks the engine's files the first time they open), and the app looks again every minute while the engine is not ready. It also limits protocol output, checks the versioned reply, and reaps failed or timed-out children.

GGUF engine binaries sit beside the interpreter in `engine/yue2cpp`; the GGUF model files are downloaded ready-made (see Engine plan).

## Generation

`generate` accepts the simple controls the UI shows: `style`, `lyrics`, `instrumental`, `vocal`, `weirdness`, and `styleInfluence`, plus the work identifier, the take's seed, and absolute model and output roots. Aulo chooses the seed when a song starts and records it with the song; scores, sampling values, and engine names are never accepted from the UI.

The bridge maps the controls onto GROOVE's documented recipes ([GENERATION_CREATIVITY_KNOBS.md](https://github.com/deadjoe/yue2_groove/blob/main/docs/GENERATION_CREATIVITY_KNOBS.md)) and keeps every other value at GROOVE's defaults:

| Control                       | Engine value                                                                                                                                         |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Style influence 0 / 50 / 100  | CFG unguided / 1.5 / 2.0                                                                                                                             |
| Weirdness 0 / 50 / 100        | Semantic temperature 0.85 / 1.0 / 1.25                                                                                                               |
| Voice female / male           | `female vocal` / `male vocal` added to the style; style parts naming a voice of the other gender are dropped                                         |
| Instrumental                  | GROOVE's best-effort recipe: empty lyric sections, style parts that describe a voice or a sung language dropped, and `instrumental, no vocals` added |
| Lyrics without section labels | Wrapped in one `[Verse]`                                                                                                                             |

YuE2 has no instrumental switch, so the UI says that some humming can still appear. Plan mode is always `full`, ODE steps are GROOVE's default 32, the seed is random per song and recorded with it, and the semantic budget is trimmed to the model context as GROOVE does.

The engine reports real stages (preparing, writing, performing, rendering, mixing, saving) and NAR/VAE step counts. The interface does not show them: like Suno, it shows a spinner on the song's cover and "Creating…", because stage names mean nothing to the people Aulo is for. The stages remain in each record for diagnostics and the watchdog. Completed output must contain decodable, nonempty audio, and artifacts are flushed before the pending marker is removed. Cancelled and failed runs keep a pending marker with their state.

## Engine plan

Aulo decides the engine from the hardware, never from a person's choice (`src-tauri/src/plan.rs`). The rule is evaluated the same way on every start, since a computer's hardware does not change:

| Computer                               | Engine                                                                                              |
| -------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Mac, Apple silicon, 16 GB or more      | PyTorch on MPS (GROOVE's reference engine)                                                          |
| Mac, Apple silicon, 8–15 GB            | GGUF Q8_0 on Metal; 8 GB machines get GROOVE's 12 288-token context (songs up to about 4.9 minutes) |
| Windows, NVIDIA card with 8 GB or more | GGUF Q8_0 on CUDA, the same small context on 8 GB cards; Windows uses only this engine              |
| Anything else                          | Not supported, said plainly in setup                                                                |

The bridge receives the plan as `AULO_ENGINE` (and `YUE2_GROOVE_GGUF_MAX_SEQ` for the small context) and runs exactly that engine; if the GGUF binaries are missing it reports a damaged install rather than switching engines. Without a plan (development) it falls back to GROOVE's `BACKEND=auto`. Development builds can force an engine with `AULO_FORCE_ENGINE=gguf|torch`.

Once a plan is found it holds until Aulo quits, so the engine never changes under a running app. A computer that could not get a plan (no NVIDIA card found, for instance) is looked at again every 30 seconds, and at once when setup's Check again runs, so installing a driver unblocks creating without reopening Aulo.

The GGUF engine's binaries are GROOVE's pinned yue2.cpp release (`e8b39f7`), fetched and checksum-verified by `scripts/build_engine.py` into `engine/yue2cpp`.

**One set of weights per computer.** The model download follows the plan (`models::manifest`): the PyTorch engine downloads the official checkpoints (`manifests/music-models.json`, 7.79 GB); the GGUF engine downloads only the published `YuE2-3B-Q8_0.gguf` and `YuE2-Vae-F32.gguf` (pinned revision of `Serveurperso/YuE2-GGUF`, which GROOVE documents as tensor-for-tensor identical to its own conversion) plus the tokenizer, configs and licences from the official repositories (`manifests/music-models-gguf.json`, 4.34 GB). Nothing is converted on the computer. The engine is pointed at that folder's `gguf/` directory, which GROOVE's engine uses as ready-made files.

A computer without a plan gets no manifest at all: setup shows why it cannot make songs and offers neither a download nor a folder to check, because either could be the wrong set. When a manifest changes (an update to new models), files the new manifest lists at the same place and size are moved over from the earlier folder under `<app-data>/models/` and checked again, only the rest is downloaded, and the earlier folder is deleted. Choosing a folder of one's own also deletes Aulo's downloaded copy once the chosen folder is verified. A folder the person chose is never changed.

On Windows, the graphics card, its own memory and the driver version come from `nvidia-smi`, which every NVIDIA driver installs (also looked for in its older install folder); if it cannot be run, DXGI, which is part of Windows, answers instead (without the driver version).

**Song length.** GROOVE's song budget is 9 000 semantic tokens at 25 per second, about six minutes; with the small context it leaves about 4.9 minutes, and longer lyrics are cut off at the limit. `creation_status` reports the limit (`maxSongSeconds`), and Create notes under the lyrics when they may run past it. The note uses a rough estimate (about 4.5 s per sung line), not the tokenizer.

**Windows paths.** yue2.cpp opens files through Windows' legacy code page, so a path with letters outside it cannot be opened; GROOVE then tries the folder's 8.3 short name and fails without one. Aulo's data lives in the local (not roaming) application data folder, and when that path is not plain ASCII (an account named in Chinese, Japanese, Korean or another script) the downloaded models go to `C:\ProgramData\Aulo\<account>\models` instead (`models::models_home`). A folder of the person's own whose path is not ASCII is refused with a plain message.

## Song service

`src-tauri/src/songs.rs` owns one queue, and `src-tauri/src/runner.rs` one resident engine process:

- The engine starts with the first song (180-second start limit, which covers importing PyTorch) and keeps the model loaded. After 10 minutes without songs it is shut down so the computer gets its memory back.
- Each stage reports at least every 100 tokens or render step. Ten minutes without any event is treated as a hang: the process is stopped and the song marked failed with a plain message. A crashed process is detected the same way and restarted for the next song.
- Stop sends `cancel` for that song; if the engine has not stopped after 30 seconds, the process is stopped. A `cancel` that arrives before its `generate` has started is kept and applied when that song begins.
- The interpreter runs with `-I -B -X utf8`: isolated from the computer's Python settings (which also makes it ignore `PYTHON*` variables), never writing bytecode into the read-only engine, and using UTF-8 on every platform.
- When Aulo quits, the engine is stopped. While a song is being made, the computer is kept from idle sleep: `caffeinate -i` on macOS, `SetThreadExecutionState` on Windows. Closing the window or quitting while a song is being made asks first, and a second launch brings the open window forward instead of starting another engine.
- The engine's stderr is appended to `<app-data>/logs/engine.log`, rotated at 5 MB.

**Failures.** The bridge sends a reason with every failed song (`failure_reason`, matched on the error text of GROOVE, PyTorch and yue2.cpp): `lyrics_too_long`, `out_of_memory`, `graphics_driver`, `models_damaged`, `engine_damaged`, `folder_name` or `unknown`. The song service adds its own (`engine_start`, `engine_stopped`, `engine_hang`, `models_unverified`). Each reason has its own message saying what to do (`songs::failure_message`), and the reason is kept with the song for the problem report. A `models_damaged` failure marks the models as needing a check, so the next song waits for Settings › Music models.

**Time.** Each song records when its run started and ended. While a song is being made the interface shows a clock and, once this computer has made a song, about how long is left, from the middle of the last five finished songs (`songs::typical_run_ms`). Before the first song it says that the first one takes longer.

Works are folders under `<app-data>/library/<id>/` with an atomically replaced `aulo.json` record. Only a `completed` event with an existing `audio.flac` and no pending marker makes a work playable. Works left queued or running by a previous session are marked interrupted at startup, unless their folder holds a playable `audio.flac` and no pending marker: then the song had finished but its record could not be saved, and it is restored as completed. A change a person makes (rename, like, move, Trash) is undone and reported if its record cannot be saved. Playback uses Tauri's asset protocol, scoped to `library/*/audio.flac`. Download offers M4A (macOS only, 256 kbps AAC through `afconvert`, which is part of macOS itself), MP3 (320 kbps, LAME built into Aulo), WAV (24-bit, written by Aulo) and FLAC (the original file). MP3 and WAV need neither the music engine nor anything installed on the computer (`src-tauri/src/audio.rs`). The file is written beside the chosen name and only replaces it once complete; Move to Trash uses the operating system's trash so songs can be restored.

## Remaining integration gates

- Building and validating the Windows engine (GGUF on CPU-only PyTorch) and its installer size.
- Signing and notarizing every binary in the bundled engine.
- File-level delta updates, so an app update downloads only changed files and the engine layer is reused.
- Windows device validation of the GGUF and PyTorch paths through Aulo.
- Cover and edit flows.
- Signed distribution, updates, and rollback.
