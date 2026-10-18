# Private music engine boundary

Aulo calls the existing installed `yue2_groove.adapter`; it does not import Gradio handlers, start a web server, copy model implementations, or change the GROOVE checkout. `runtime/bridge.py` uses protocol version 3 over UTF-8 newline-delimited JSON. Library output, including native stdout, is redirected to stderr. A process either answers one `probe` and exits, or `serve`s: it stays running, keeps the loaded model between songs, and reads `generate`, `cancel` and `shutdown` commands. Every event of a song carries its `workId`. The process leaves with `os._exit` so a command reader blocked on stdin cannot crash interpreter shutdown.

## Discovery and readiness

The Rust `engine_status` command discovers only Aulo's private runtime location. Debug builds may use an absolute `AULO_DEV_PYTHON` interpreter path supplied by the developer. Release builds ignore that override. No interpreter selector, command field, or dependency configuration is exposed to users. There is no PATH search or shell invocation.

The probe checks the installed GROOVE 1.0.10 and YuE2 0.1.6 versions, imports the real adapter and PyTorch, and selects an engine with GROOVE's own rules:

- `gguf_engine.auto_backend` decides between PyTorch and the GGUF engine (yue2.cpp), including NVIDIA cards that a CPU-only PyTorch cannot see.
- On CUDA without a usable FlashAttention kernel, GROOVE's eager decoder is used, as in `webui/runtime.effective_backend`.
- A computer whose only option is the CPU is reported as unsupported; Aulo does not offer multi-hour CPU generation.

A successful probe is cached for the session. Creation requires both a ready engine and verified models; `creation_status` reports which one is missing in plain language. The native host enforces a probe timeout, limits protocol output, checks the versioned reply, and reaps failed or timed-out children.

The reserved interpreter locations are `runtime/python/bin/python3` on macOS and `runtime/python/python.exe` on Windows, under application data. GGUF binaries, when present, are read from `runtime/yue2cpp`, and converted GGUF files are written to `models/gguf`, both under application data.

## Generation

`generate` accepts the simple controls the UI shows: `style`, `lyrics`, `instrumental`, `vocal`, `weirdness`, and `styleInfluence`, plus the work identifier and absolute model and output roots. Scores, seeds, sampling values, and engine names are never accepted from the UI.

The bridge maps the controls onto GROOVE's documented recipes ([GENERATION_CREATIVITY_KNOBS.md](https://github.com/deadjoe/yue2_groove/blob/main/docs/GENERATION_CREATIVITY_KNOBS.md)) and keeps every other value at GROOVE's defaults:

| Control                       | Engine value                                                                       |
| ----------------------------- | ---------------------------------------------------------------------------------- |
| Style influence 0 / 50 / 100  | CFG unguided / 1.5 / 2.0                                                           |
| Weirdness 0 / 50 / 100        | Semantic temperature 0.85 / 1.0 / 1.25                                             |
| Voice female / male           | `female vocal` / `male vocal` added to the style                                   |
| Instrumental                  | GROOVE's best-effort recipe: empty lyric sections and an `instrumental` style hint |
| Lyrics without section labels | Wrapped in one `[Verse]`                                                           |

YuE2 has no instrumental switch, so the UI says that some humming can still appear. Plan mode is always `full`, ODE steps are GROOVE's default 32, the seed is random per song, and the semantic budget is trimmed to the model context as GROOVE does.

The engine reports real stages (preparing, writing, performing, rendering, mixing, saving) and NAR/VAE step counts. The interface does not show them: like Suno, it shows a spinner on the song's cover and "Creating…", because stage names mean nothing to the people Aulo is for. The stages remain in each record for diagnostics and the watchdog. Completed output must contain decodable, nonempty audio, and artifacts are flushed before the pending marker is removed. Cancelled and failed runs keep a pending marker with their state.

## Song service

`src-tauri/src/songs.rs` owns one queue, and `src-tauri/src/runner.rs` one resident engine process:

- The engine starts with the first song (180-second start limit, which covers importing PyTorch) and keeps the model loaded. After 10 minutes without songs it is shut down so the computer gets its memory back.
- Each stage reports at least every 100 tokens or render step. Ten minutes without any event is treated as a hang: the process is stopped and the song marked failed with a plain message. A crashed process is detected the same way and restarted for the next song.
- Stop sends `cancel` for that song; if the engine has not stopped after 30 seconds, the process is stopped.
- When Aulo quits, the engine is stopped. While a song is being made on macOS, `caffeinate -i` keeps the computer from idle sleep.
- The engine's stderr is appended to `<app-data>/logs/engine.log`, rotated at 5 MB.

Works are folders under `<app-data>/library/<id>/` with an atomically replaced `aulo.json` record. Only a `completed` event with an existing `audio.flac` and no pending marker makes a work playable. Works left queued or running by a previous session are marked interrupted at startup. Playback uses Tauri's asset protocol, scoped to `library/*/audio.flac`. Download offers M4A (macOS only, 256 kbps AAC through the system's `afconvert`), MP3 (320 kbps through the runtime's soundfile, `runtime/convert.py`), WAV (24-bit) and FLAC (the original file); the file is written beside the chosen name and only replaces it once complete; Move to Trash uses the operating system's trash so songs can be restored.

## Remaining integration gates

- Packaged runtimes per platform, installed and smoke-tested on clean machines.
- Windows device validation of the GGUF and PyTorch paths through Aulo.
- Keep-awake on Windows (macOS uses `caffeinate`).
- Cover and edit flows.
- Signed distribution, updates, and rollback.
