# First-run setup and delivery plan

## Implemented flow

1. Welcome: explain the local workspace and current limits.
2. Computer check: read processor, architecture, physical memory, destination-volume free space, and Windows NVIDIA device memory. Browser mode reports unknown values.
3. Music essentials: choose existing models or request a managed download. The wizard shows total size, required free storage, the storage location, and model-license information before downloading.
4. Preparation: real transfer or read-only checksum verification, with progress, pause, retry, and restart recovery. No progress simulation remains.
5. Explore: open the creation workspace. The sidebar keeps preparation status visible and reopens the essentials screen directly. Exploring never means the engine is ready; the create panel says what is still missing.

## Implemented model state machine

```text
not_started -> checking -> downloading -> verifying -> verified
                  |            |             |
                  +------------+-------------+--> paused / failed

application restart:
  saved verified location, files unchanged -> verified
  saved verified location, files changed   -> unverified -> explicit verification
  partial managed download -> paused -> explicit resume
```

`modelsVerified` means every file passed its checksum. After a restart, a saved verification stays valid only while every file keeps the size and modification time recorded when it passed; any difference requires a full check again. Verification does not load a model or test inference; engine readiness is checked separately (see [engine](ENGINE.md)).

## Catalog and storage

`manifests/music-models.json` pins immutable official revisions for YuE2-3B and YuE2-Vae. The catalog contains 17 data/notice files totaling 7,794,565,436 bytes. Every file has a size and SHA-256 digest. The maintenance script reads pinned metadata and small files; it never downloads model weights.

Managed downloads use `<app-data>/models/yue2-source-v1/`. Existing selections must contain the `YuE2-3B/` and `YuE2-Vae/` subfolders. Imported files may use existing cache symlinks, but are never changed. Managed download paths reject symlinks. Selection is remembered in atomically replaced `models.json` only after successful validation.

The initial space estimate subtracts existing complete/partial byte counts and includes a 512 MiB reserve. Existing files are then hashed, and space is rechecked per file before download. This estimate covers model preparation only, not a future packaged runtime, conversion scratch space, or generated audio. Unknown free space does not bypass the native storage check.

HTTPS downloads use immutable URLs and 8 MiB range requests. Valid partial responses must match the requested range and total size. A full response restarts that file safely. Interrupted transfers retain partial files, retry at most three times per interruption, and offer manual retry. A 30-second request timeout bounds cancellation latency. Corrupt partials are discarded instead of promoted. An OS lock prevents competing application processes from writing the same store.

The model license is shown as CC BY-NC 4.0 (non-commercial), with a fixed official license link opened by the native host. No license agreement is accepted automatically.

## Remaining before generation

- Package a pinned YUE2 // GROOVE runtime for each supported platform.
- Verify the prepared models against those exact runtime artifacts.
- Include runtime, conversion, and rollback overhead in the complete installation plan.
- Implement a UI-independent local service with capabilities, jobs, events, cancellation, and durable works.
- Run real engine startup and minimal inference checks before reporting ready.
- Validate full-size transfers and clean-machine installations on macOS and Windows.
- Add signed distribution, update verification, and rollback.

## Initial hardware targets

Targets: Apple Silicon with 8 GB of memory or more (16 GB and up on the PyTorch engine, below that on the GGUF engine), and x86-64 Windows with an NVIDIA GPU of at least 8 GB (GGUF engine only). These do not guarantee performance or compatibility. No AMD, Intel GPU, CPU-only, Intel Mac, or Windows ARM support is promised.

Only a computer the engine plan accepts is offered the music models, and only the set its engine runs. Creating needs verified models and a ready engine. Runtime choices belong to the native plan and the engine, never to settings people see.
