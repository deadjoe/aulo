# Aulo

Your music, your space. A local music creation app for macOS and Windows, powered by [YUE2 // GROOVE](https://github.com/deadjoe/yue2_groove).

## Status

**0.2 creation workspace.** Aulo can create, play, and keep songs on a computer where the music engine is installed. The engine runtime is not yet packaged with the app, so on a clean computer the Create button stays disabled and says why.

Implemented:

- Tauri 2 desktop shell with React and TypeScript.
- First-run welcome, automatic hardware inspection, and music-model setup screens.
- Pinned official model downloads with byte-level progress, pause/resume, bounded retries, storage checks, and SHA-256 verification. Verified models stay ready across restarts while their files are unchanged.
- A Suno-style creation workspace: Simple and Advanced modes, lyrics with section shortcuts, style ideas, voice, weirdness, and style influence. No scores, seeds, engines, or other technical settings are shown.
- A native song service with a resident engine: the model stays loaded between songs and is released after 10 idle minutes; a queue, stop, a hang watchdog, crash recovery, keep-awake on macOS, and durable works under the application data folder.
- Suno-style progress: a spinner on the song's cover and "Creating…", with no technical stage names.
- A library grouped by day with generated cover art, likes and search; song details with lyrics; a song menu with Create another version, Reuse settings, Rename, Download, Show in Finder, Add to queue, and Move to Trash; and a bottom player.
- Engine selection is delegated to GROOVE's own rules (PyTorch on Apple Silicon and large NVIDIA cards, the GGUF engine on smaller NVIDIA cards).
- An independent placeholder for connecting the user's existing AI agent.

Not implemented: packaged inference runtime and installer, cover/edit integration, agent connection, signed installers, or automatic updates. Windows behavior compiles and is unit-tested but needs physical-device validation. See the [engine integration boundary](docs/ENGINE.md).

## Development

Use Node.js 24 LTS (or a compatible newer release) and npm. Desktop development additionally needs Rust and the [Tauri platform prerequisites](https://tauri.app/start/prerequisites/).

```sh
npm ci
npm run dev
```

Open `http://127.0.0.1:1420` for the browser preview. This mode cannot inspect real hardware, prepare models, or open native model-folder dialogs.

```sh
npm run desktop
```

This starts the native desktop app with hardware inspection, model preparation, and a folder picker. Downloads start only after an explicit action and model-license acknowledgement. Do not run the standalone Vite server simultaneously: both commands use port 1420.

```sh
npm run check
npm run format:check
cargo check --locked --manifest-path src-tauri/Cargo.toml
cargo test --locked --manifest-path src-tauri/Cargo.toml
```

For a local, unsigned macOS development bundle:

```sh
npm run tauri build -- --debug --bundles app
```

Production distribution requires signing, notarization where applicable, and platform testing. No public release workflow is configured.

## Model preparation

The bundled manifest pins 17 files from the official YuE2 repositories, totaling 7,794,565,436 bytes (7.79 GB). Model weights use CC BY-NC 4.0; the wizard links to the model license before download. Models are stored in the application data directory, outside the app bundle. Existing model folders are never rewritten. The supported import layout is a parent folder containing `YuE2-3B/` and `YuE2-Vae/` matching the manifest; GGUF-only folders and arbitrary cache layouts are not yet supported.

Verified models are one of two creation requirements; the other is a working music engine with a supported accelerator. No inference runtime is bundled or installed by this version. Full multi-GB transfer and clean-machine runtime compatibility remain validation gates; automated tests use small local fixtures and an explicit pinned 959-byte live download.

For development, point a debug build at an existing GROOVE 1.0.10 environment:

```sh
AULO_DEV_PYTHON=/absolute/path/to/yue2_groove/.venv/bin/python npm run desktop
```

Release builds ignore this variable.

## Product boundaries

Aulo owns the desktop experience, packaging, maintenance, and integration layer. YUE2 // GROOVE remains the source of music-generation capabilities. Aulo will consume pinned, tested releases through a versioned local service rather than copy the engine or call Gradio event handlers.

Users should not need to understand inference backends, Python environments, GPU parameters, or model file formats. Existing capabilities do not all need visible controls.

Songs live in `<app-data>/library/<id>/`, each with an `aulo.json` record next to the engine's own artifacts. Unsent text in the create panel is remembered per app profile. Leaving onboarding only records that the workspace was explored, not that setup succeeded. Ideas saved by the 0.1 draft workspace remain in that profile's local storage but are no longer shown.

All repository documentation, comments, commit messages, and pull-request text must be in English.

See [architecture](docs/ARCHITECTURE.md), [setup delivery plan](docs/SETUP.md), and [validation](docs/VALIDATION.md).
