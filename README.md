# Aulo

Your music, your space. A local music creation app for macOS and Windows, powered by [YUE2 // GROOVE](https://github.com/deadjoe/yue2_groove).

## Status

**0.1 desktop foundation with real model preparation.** This is not a music-generation release.

Implemented:

- Tauri 2 desktop shell with React and TypeScript.
- First-run welcome, automatic hardware inspection, and music-essentials setup screens.
- Native memory, processor, and available-storage inspection; bounded NVIDIA detection on Windows.
- Explicit browser fallback: hardware is unknown, never fabricated.
- Pinned official model downloads with byte-level progress, pause/resume, bounded retries, storage checks, and SHA-256 verification.
- Read-only verification of an existing folder containing `YuE2-3B/` and `YuE2-Vae/`; successful locations are saved for reuse.
- Restart recovery that preserves partial downloads but requires model revalidation.
- A workspace status badge for background model preparation.
- A creative workspace with locally saved drafts, search, favorites, variations, JSON export, and optional details.
- An independent placeholder for connecting the user's existing AI agent.

Not implemented: packaged inference runtime, audio generation/playback, cover/edit integration, agent connection, signed installers, or automatic updates. Windows hardware behavior is implemented but still requires physical-device validation. Eligibility recommendations are not runtime compatibility guarantees.

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

Model preparation is useful groundwork, but **verified models do not make generation available**. No inference runtime is bundled or installed by this version. Full multi-GB transfer and clean-machine runtime compatibility remain validation gates; automated tests use small local fixtures and an explicit pinned 959-byte live download.

## Product boundaries

Aulo owns the desktop experience, packaging, maintenance, and integration layer. YUE2 // GROOVE remains the source of music-generation capabilities. Aulo will consume pinned, tested releases through a versioned local service rather than copy the engine or call Gradio event handlers.

Users should not need to understand inference backends, Python environments, GPU parameters, or model file formats. Existing capabilities do not all need visible controls.

Drafts currently live in versioned local storage for this app/browser profile. Browser and native profiles are separate. Clearing site/app data deletes these drafts; export important ideas as JSON. The production library will use durable application-managed storage. Leaving onboarding only records that the workspace was explored, not that setup succeeded.

All repository documentation, comments, commit messages, and pull-request text must be in English.

See [architecture](docs/ARCHITECTURE.md), [setup delivery plan](docs/SETUP.md), and [validation](docs/VALIDATION.md).
