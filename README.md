# Aulo

Your music, your space. A local music creation app for macOS and Windows, powered by [YUE2 // GROOVE](https://github.com/deadjoe/yue2_groove).

## Status

**0.1 desktop foundation and interactive design preview.** This is not a music-generation release.

Implemented:

- Tauri 2 desktop shell with React and TypeScript.
- First-run welcome, automatic hardware inspection, and music-essentials setup screens.
- Native memory, processor, and available-storage inspection; bounded NVIDIA detection on Windows.
- Explicit browser fallback: hardware is unknown, never fabricated.
- An opt-in download simulation with pause, resume, and replay. It transfers no files and never marks the engine ready.
- Native selection of an existing model directory; no model validation or import yet.
- A creative workspace with locally saved drafts, search, favorites, variations, JSON export, and optional details.
- An independent placeholder for connecting the user's existing AI agent.

Not implemented: packaged inference runtime, model download/verification, audio generation/playback, cover/edit integration, agent connection, signed installers, or automatic updates. Windows hardware behavior is implemented but still requires physical-device validation. Eligibility recommendations are not runtime compatibility guarantees.

## Development

Use Node.js 24 LTS (or a compatible newer release) and npm. Desktop development additionally needs Rust and the [Tauri platform prerequisites](https://tauri.app/start/prerequisites/).

```sh
npm ci
npm run dev
```

Open `http://127.0.0.1:1420` for the browser preview. This mode cannot inspect real hardware or open native model-folder dialogs.

```sh
npm run desktop
```

This starts the native desktop app with hardware inspection and a folder picker. Do not run the standalone Vite server simultaneously: both commands use port 1420.

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

## Product boundaries

Aulo owns the desktop experience, packaging, maintenance, and integration layer. YUE2 // GROOVE remains the source of music-generation capabilities. Aulo will consume pinned, tested releases through a versioned local service rather than copy the engine or call Gradio event handlers.

Users should not need to understand inference backends, Python environments, GPU parameters, or model file formats. Existing capabilities do not all need visible controls.

Drafts currently live in versioned local storage for this app/browser profile. Browser and native profiles are separate. Clearing site/app data deletes these drafts; export important ideas as JSON. The production library will use durable application-managed storage. Leaving onboarding only records that the workspace was explored, not that setup succeeded.

All repository documentation, comments, commit messages, and pull-request text must be in English.

See [architecture](docs/ARCHITECTURE.md), [setup delivery plan](docs/SETUP.md), and [validation](docs/VALIDATION.md).
