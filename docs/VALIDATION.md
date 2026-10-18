# Validation record

## Settings — 2026-10-19

- Native tests: settings defaults, damaged and out-of-range files, round trip; the idle-engine decision (keep loaded, unload after 10 minutes, unload now); Trash expiry including a clock set back; model removal deletes only Aulo's folder, keeps a chosen folder and does not follow a link; storage separates songs from the Trash and does not follow links; the problem report removes written lines and states what it leaves out.
- Component tests: every section; saving a choice and putting it back when saving fails; Free up memory only while memory is held and nothing is being made; Empty Trash and Remove only after an in-panel confirmation; the problem report saved where chosen; one notification per finished song and none for songs already done; ⌘, and Escape.
- A read-only check on a real data folder matched song and Trash counts and sizes to the records. The panel was reviewed in a browser preview with temporary fixtures, which were removed. System notifications, the engine unloading in the running app and model removal on a real installation were not exercised by hand.

## Reliability review — 2026-10-19

An outside review's findings were checked against the code; each was reproduced or confirmed by reading the code path before it was fixed.

- Saving: user changes are undone and reported when their record cannot be written (`changes_that_cannot_be_saved_are_undone`); a song whose audio finished but whose record was not saved is restored as completed at startup (`finished_audio_whose_record_was_not_saved_is_recovered`).
- Library refresh after setup: a hook test reproduces a song finishing while setup is open and confirms the library now shows the stored state; the test fails on the previous code.
- Setup: "You’re all set" and Start creating appear only when the creation status (models, engine and computer) is ready.
- Bytecode: with `-I`, `PYTHONDONTWRITEBYTECODE` was ignored and the bundled Python wrote `__pycache__` (reproduced); the engine now runs with `-B`, checked by a test that runs Python.
- Cancel before start: reproduced with the command reader; a pending cancel is now applied when its song begins.
- Waveforms: peaks now stream from the FLAC (equal to the full decode on a real 3:57 song, `live_waveform_streams_a_real_song`), at most two at a time, only for visible songs. Memory was reasoned from the code, not measured under a large library.
- Batch Trash: when only some songs could be saved, the message names what moved and how many could not, instead of reporting all as moved.
- Creation readiness also applies the setup guide's hardware rule (Apple silicon with 32 GB of memory; on Windows, 8 GB of NVIDIA graphics memory when it is known), so a computer below it never shows Start creating or an enabled Create button.
- Accessibility: input placeholders raised from 3.5:1 to 4.8:1 contrast; menus open and move with the arrow keys, Home and End, and return focus to their button.

## Bundled engine — 2026-10-18

- `scripts/build_engine.py` built a 694 MB engine (Python 3.12.9, GROOVE 1.0.10, YuE2 0.1.6, Torch 2.14.1) on Apple silicon.
- With that engine, `live_resident_engine_generates_and_reuses_the_model` made two songs (192.9 s and 264.9 s; 49.8 s and 70.6 s of audio) and stopped a third mid-song.
- The release app bundle is 678 MiB; an LZMA DMG of it is 200 MB. The installed app's engine answered the probe from an empty environment (`env -i`, no other Python), reporting MPS and the PyTorch backend.
- Not yet covered: a different, clean Mac; code signing and notarization of the engine's binaries; Windows.

## Design and code review pass — 2026-10-18

- A screen-by-screen review in a browser preview at 1440×900 and 960×700 (the minimum window) covered the first-run guide, models step, workspace in both modes, song details, menus, download, settings and AI connection dialogs, toasts and empty states, using temporary local fixtures that were not committed. The native window and the native-only model download states were not captured.
- `npm run check`: 31 tests and the production build. `cargo test --locked`: 37 native tests; clippy with warnings denied. `python3 -m unittest discover -s runtime/tests`: 14 tests.

## Download formats — 2026-10-18

- MP3 and WAV are encoded inside Aulo (claxon FLAC decoding, hound WAV writing, LAME through mp3lame-encoder); no Python runtime or installed tool is involved.
- Opt-in live test `live_exports_every_format` (release build) converted a real 3:57 song: M4A 7.5 MB in 2.0 s, MP3 9.5 MB in 4.6 s (320 kbps), WAV 68.2 MB in 0.5 s, FLAC 47.8 MB copied. The WAV matched the original FLAC sample for sample (maximum difference 1.2e-7, float rounding); the MP3 decoded to the same length (236.76 s) and loudness (RMS 0.161) as the original.
- Unit tests cover the FLAC copy, staged replacement and a failed conversion leaving the existing file untouched; a component test covers choosing and remembering a format.
- Windows offers MP3, WAV and FLAC; M4A needs a Windows encoder that is not integrated yet.

## Resident engine and song actions increment — 2026-10-18

- `npm run check`: 24 frontend/component tests and the production build.
- `python3 -m unittest discover -s runtime/tests`: 14 bridge tests (serving protocol, command validation, cancellation routing, model reuse, failure isolation).
- `cargo test --locked`: 29 native tests, including fixture engines that serve commands, never become ready, or crash; clippy with warnings denied.
- Opt-in live test `live_resident_engine_generates_and_reuses_the_model` (64 GiB Apple Silicon, MPS, existing GROOVE development interpreter): one resident engine made a song (185.2 s), stopped a second song 0.15 s after `cancel` was sent in the performing stage, then made a third song whose preparation took under 1 ms because the loaded model was reused (203.9 s). Both songs decoded fully (53.0 s and 47.8 s of audio). The engine shut down cleanly; the log has no fatal error.
- Browser-preview review of the Suno-style progress (cover spinner, "Creating…"), the song menu and the song details, using temporary local fixtures that were not committed.
- Not covered: Download, Show in Finder and Move to Trash through the native window, the 10-minute idle shutdown in real use, and Windows.

## Creation workspace increment — 2026-10-18

- `npm run check`: 23 frontend/component tests and the production build.
- `python3 -m unittest discover -s runtime/tests`: 13 bridge tests with mocked engine modules (control mapping, GROOVE backend delegation, GGUF opening, cancellation, protocol bounds).
- `cargo test --locked`: 27 native tests (song records, startup reconciliation, event handling, process streaming, verified-model persistence), plus opt-in live tests.
- Visual review of the create panel, advanced options, library states and player in a browser preview at 1440×900 and 1000×720, using temporary local fixtures that were not committed. The native window was not exercised by hand.
  - Opt-in live test `live_generation_produces_playable_audio` (64 GiB Apple Silicon, MPS, GROOVE 1.0.10 development interpreter, the existing local model folder): the Rust runner launched the compiled-in bridge, received preparing, writing, performing, all 32 rendering steps, mixing and saving events, and a `completed` event. The song took 274.75 seconds and produced 69.6 seconds of 48 kHz stereo FLAC; full decoding found finite samples (peak 0.999, RMS 0.149). SHA-256 `943019889f56ff94db9ab81ad8e21febf41726a174ebe1821c32cb6c51e819e1`. The engine chose PyTorch on MPS through GROOVE's rule; CFG 1.5 and 32 ODE steps were used. One smoke test, not a benchmark or listening review.
- Opt-in live test `live_cancellation_stops_the_engine`: sending `cancel` when the performing stage began produced a `cancelled` event, a `cancelled` pending marker and no audio; the whole run including model loading took 29.8 seconds.
- Not covered: a clean-machine runtime install, the GGUF path through Aulo, Windows devices, and the full native window flow by hand (create, play, restart recovery).

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

Component tests exercise the first-run flow, unknown browser hardware, model preparation availability, explicit download consent, native license-link delegation, insufficient storage, existing-folder verification, actionable verification failure, pause/resume state, creation readiness, simple and advanced controls, library progress, stop, like and delete, and agent-dialog keyboard behavior.

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
7. Create a song, stop another, like, rename, reuse settings, delete; confirm finished songs survive restart and play.
8. Verify the UI at default/minimum sizes and with keyboard navigation.
