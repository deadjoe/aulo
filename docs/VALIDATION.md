# Validation record

## Engine bridge increment — 2026-10-18

- `npm run check`: passed; 20 frontend/component tests and the production build.
- `python3 -m unittest discover -s runtime/tests -v`: passed; 7 bridge tests, with explicitly mocked generation/audio fixtures.
- `cargo test --locked --manifest-path src-tauri/Cargo.toml`: passed; 19 native tests on macOS, with 2 explicit integration tests ignored by default.
- The explicit `engine::tests::live_engine_probe` test passed against the existing local development interpreter. The Rust host launched the bridge, imported GROOVE 1.0.10 / YuE2 0.1.6 / PyTorch 2.14.1, detected MPS, and correctly retained `generationReady: false`. No environment dependencies were installed or upgraded.
- Native tests cover incompatible versions, malformed/noisy replies, false readiness, unsuccessful process exit, and timeout cleanup. Shell-process fault fixtures run on Unix; Windows compilation and protocol coverage run in CI.
- Clippy with warnings denied and repository formatting checks passed.
- The updated macOS development bundle built successfully, approximately 45.65 MiB. It was not manually launched or visually verified.
- Read-only comparison of the existing model folder matched all 9 available runtime files to the pinned catalog, including both weight files. Eight license/notice files were absent; this folder does not pass the full 17-file import contract and was not marked prepared.
- A real developer-side generation completed through `runtime/bridge.py` and the existing GROOVE adapter on a 64 GiB MPS host. It used the existing interpreter read-only, the hash-matched runtime files, eager PyTorch, and a separate temporary output directory. No Gradio service or new dependencies were involved. This was not a clean-machine or packaged-runtime test.
- The run took 236.57 seconds and produced 59.2787 seconds of 48 kHz stereo FLAC (2,845,376 frames). Full decoding verified finite, nonzero samples; peak 0.830125 and RMS 0.140516. SHA-256: `ef2ed45a89decf6b63da54e281d59999829b0cb5389b47ffef5b284afbcc7d77`. This is one smoke test, not a performance benchmark or a listening-quality assessment.
- The event stream included loading, composing, all 50 NAR steps, both VAE chunks, saving and completion. Audio and metadata were written and the pending marker removed. Local evidence is retained under ignored `artifacts/engine-smoke-2026-10-18/`; model files and generated audio are not committed.

Desktop generation, cancellation, durable library indexing, playback and private runtime distribution remain unavailable. A successful compatibility probe does not validate a complete installation or a generated song; the separate generation smoke test above validates only that developer-side path.

## Model preparation increment — 2026-10-18

- `npm run check`: passed; 18 frontend/component tests and the TypeScript/Vite production build.
- `cargo test --manifest-path src-tauri/Cargo.toml`: passed; 16 native tests. The explicit network test is ignored by default.
- `cargo test --locked --manifest-path src-tauri/Cargo.toml live_pinned_configuration_download -- --ignored --nocapture`: passed. Downloaded and SHA-256-verified one pinned 959-byte configuration file from the official model repository into temporary storage. No complete model weights were downloaded.
- `cargo clippy --locked --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`: passed.
- `npm run tauri build -- --debug --bundles app`: passed; updated the local macOS development bundle, approximately 45.36 MiB.
- Source/documentation scan: no Chinese text found in repository source, comments, or documentation.
- The existing YUE2 // GROOVE checkout was not modified.

## Interaction and recovery coverage

Component tests exercise the first-run flow, unknown browser hardware, model preparation availability, explicit download consent, native license-link delegation, insufficient storage, existing-folder verification, actionable verification failure, pause/resume state, unavailable generation, local draft workflows, and agent-dialog keyboard behavior.

Native tests exercise actual host hardware inspection, the frontend JSON contract, pinned manifest validation, same-size corrupt files, read-only imports, partial-download resume, servers ignoring ranges, invalid range responses, checksum failures, pause preservation, process locking, symlink rejection for managed downloads, atomic saved-location replacement, restart recovery, and revalidation after saved success.

The full model catalog is 17 files totaling 7,794,565,436 bytes. Automated transfer tests use tiny local HTTP fixtures. The real-network smoke test covers a small configuration file, not a complete multi-GB or long-duration transfer.

## Prior remote validation

The foundation commit `3e6e25f` passed frontend, macOS native, and Windows native jobs in [GitHub Actions](https://github.com/deadjoe/aulo/actions/runs/39082529994). That result does not validate this later model-preparation increment; inspect the workflow for its exact commit separately.

## Remaining verification

- Browser access was previously denied by the browser permission gate. No screenshot-based or real-browser visual verification was completed. Component tests are not a substitute for that verification.
- The updated macOS app was built but not launched or manually exercised. Native folder selection, external license opening, JSON export, and the IPC/UI connection still require manual testing.
- Physical Windows NVIDIA detection and device behavior require real hardware testing, independently of compilation in CI.
- Full-size model downloads, restrictive networks, disk exhaustion during transfer, and abrupt machine shutdown need manual endurance tests.
- No packaged inference runtime or desktop audio playback has been tested. Developer-side model loading and inference were subsequently tested in the engine bridge increment above.
- The bundle is for local development. Signing, notarization, installer updates, and clean-machine distribution remain future work.

## Manual preview checklist

1. Open the desktop app and compare hardware observations with the host.
2. Confirm the model plan shows size, storage, license information, and the unavailable music engine.
3. Choose a compatible existing folder; verify that checksums are checked and no source files are changed.
4. On a test machine, explicitly start a managed download, pause/resume it, and restart the app during transfer.
5. Confirm partial files recover, a saved success returns as unverified after restart, and generation stays disabled.
6. Leave the wizard during preparation and confirm the workspace badge shows current progress and reopens model preparation.
7. Exercise drafts, favorites, search, variations, and export; confirm saved drafts survive restart.
8. Verify the UI at default/minimum sizes and with keyboard navigation.
