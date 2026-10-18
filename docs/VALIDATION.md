# Validation record

## Local validation — 2026-10-18

- `npm run check`: passed; 12 tests and the TypeScript/Vite production build.
- `npm run format:check`: passed.
- `cargo check --manifest-path src-tauri/Cargo.toml`: passed on Apple Silicon macOS.
- `cargo test --locked --manifest-path src-tauri/Cargo.toml`: passed; two native tests, including real host hardware collection and the frontend JSON contract.
- `npm run tauri build -- --debug --bundles app`: passed; produced a local macOS `Aulo.app` development bundle, approximately 32.5 MiB.
- Source/documentation scan: no Chinese text found in repository source, comments, or documentation.
- The existing YUE2 // GROOVE checkout was not modified.

## Interaction coverage

Component tests exercise the welcome/check/essentials flow, unknown browser hardware, existing-folder selection labeling, download simulation pause/resume, workspace entry, draft persistence across remounts, search, favorites, variations, unavailable generation/playback controls, and agent-dialog dismissal/focus restoration.

Hardware-policy tests distinguish supported candidates, insufficient memory, unknown Windows GPUs, and unsupported platforms. Eligibility is never runtime readiness.

## Remaining verification

- Browser opening was denied by the browser permission gate. No screenshot-based or real-browser visual verification was completed. Component tests are not a substitute for that verification.
- The packaged macOS application was built but not launched or manually exercised. Native folder picking, exported downloads, and the IPC/UI connection still require manual testing.
- Windows compilation is configured in CI; physical NVIDIA detection and runtime behavior require Windows hardware testing.
- The download progress is an explicitly labeled simulation. No model transfer, integrity validation, inference, or audio playback was tested or claimed.
- The generated bundle is for local development; release signing, notarization, installer updates, and clean-machine installation remain future work.

## Manual preview checklist

1. Open the desktop app and confirm readable layouts at the default and minimum window sizes.
2. Complete the computer check and compare the reported memory/processor with the host.
3. Select an existing model folder; confirm the UI says it is unverified and imports nothing.
4. Try the explicitly labeled download simulation, pause/resume, and replay.
5. Explore the workspace, save an idea, favorite it, search, make a variation, and export the JSON draft.
6. Restart the app and verify saved drafts remain available.
7. Reopen setup through Settings; confirm the engine is still not ready.
8. Open the AI connection placeholder and confirm no connection is claimed.
