# Architecture

## Current foundation

```text
React interface
  Setup guide / composer / draft library / settings
        |
        +-- Tauri commands: hardware inspection / model preparation
        +-- Native dialog: user-selected folder
        +-- Local draft storage (preview only)

Future integration boundary
  Desktop interface      Agent adapter
         |                    |
         +-- Local application service --+
             jobs / events / works        |
                              YUE2 // GROOVE
                              YuE2 / GGUF
```

`src/lib/core.ts` defines an initial application-facing contract. There is no service implementation or fabricated generation result. The unavailable runtime is explicitly represented.

`src/lib/hardware.ts` separates native observations from provisional eligibility. Native inspection performs no downloads, model loading, or environment modification. On Windows, `nvidia-smi` has a five-second timeout; memory from multiple devices is never summed. Failure to detect a GPU means unknown rather than a CPU fallback.

`src/lib/storage.ts` provides versioned, validated draft persistence. Production work storage must move to a durable application-owned library with migration, atomic writes, and backup/recovery policies before promising durable audio projects.

## Model preparation

`src-tauri/src/models.rs` owns the pinned catalog, downloads, checksums, and saved locations. UI components use typed commands in `src/lib/models.ts`; they never receive an arbitrary URL-download primitive. Network transfers run on a worker thread. An in-process guard and an OS file lock prevent concurrent preparation of shared storage.

Managed files use `.part` staging and SHA-256 verification before promotion. The downloader accepts a valid matching HTTP range or safely restarts on a full response. Bounded requests and retries allow pause and offline recovery; pausing a pending request can take up to its 30-second timeout. Saved locations are atomically replaced. On restart, a saved success becomes unverified, not ready. User-selected files are only read and hashed.

The model manifest targets the existing core version but does not prove packaged-runtime compatibility. Its hashes cover source checkpoints, tokenizer, configuration, and model notices. It does not install Python or execute model repository code. A separate runtime package and smoke test are required before enabling generation.

## Core integration

Extract a UI-independent service boundary in YUE2 // GROOVE through small compatible changes. Its existing runtime currently includes Gradio-facing errors and process-global task state. Aulo must not depend on Gradio routes or duplicate inference logic.

The future service owns model lifetime, a single GPU job queue, cancellation, progress, and artifact persistence. UI and agent clients share that service so they cannot independently load duplicate models or bypass the queue. Long operations return job identifiers; clients inspect events/status without holding a single blocking tool call open.

Use a pinned engine version and a versioned capability handshake. The service reports readiness only after runtime/model validation. Hardware recommendations alone cannot grant readiness.

## Desktop lifecycle and distribution

The Tauri host will own the child process lifecycle and recover from crashes. The packaged runtime must not depend on users having Python, Git, or build tools. macOS and Windows need separate tested artifacts. Application, runtime, and model versions may download independently but must obey a tested compatibility manifest.

Do not update a loaded engine while a job is running. Keep the previous working runtime until the replacement passes health checks. Store models and works outside the application bundle. Signing, update verification, and rollback remain future implementation work.

## AI agent connection

Reserved as an independent integration. A later settings flow may connect an existing compatible local agent through MCP or a CLI adapter. It must use the same job and work contracts as the UI and explicitly disclose any external data transfer. This preview reads no agent configuration and makes no agent requests.

## Visual direction

A quiet graphite and olive workspace with warm peach actions, native system typography, and an original waveform mark. The layout borrows the useful creation/list/player arrangement from the provided references while excluding social feeds, credits, subscriptions, and public-sharing controls.

The workspace starts honestly empty. It contains no seeded fake songs or fake playback progress. The desktop title bar remains native. Details are dismissible; at narrower widths they become an overlay. Reduced-motion and keyboard users are supported.
