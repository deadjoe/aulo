# First-run setup and delivery plan

## Implemented preview flow

1. Welcome: explain the local workspace and clearly identify preview limitations.
2. Computer check: read processor, architecture, physical memory, destination-volume free space, and Windows NVIDIA device memory. Browser mode reports unknown values.
3. Music essentials: explain forthcoming installation and allow an existing folder to be selected for the current session. No folder contents are trusted or imported.
4. Optional simulation: show preparing, paused, resumed, and completed download presentation. Every state is explicitly a simulation, with no transfer or readiness flag.
5. Explore: open the real local draft workspace. This does not mean the engine is ready.

## Production setup state machine

```text
unconfigured -> inspecting -> eligible -> awaiting-download-consent
  -> downloading -> verifying -> installing -> runtime-smoke-test -> ready
```

Each operation needs a persisted checkpoint. Unsupported, unknown, insufficient-storage, paused, offline, verification-failed, installation-failed, and runtime-failed are distinct states with understandable next steps. Cancellation should preserve valid downloaded chunks and never promote partial files to complete models.

## Required before real downloads

- Pin a compatible YUE2 // GROOVE release and platform runtime artifact.
- Define a versioned manifest with immutable model revisions, file sizes, checksums, download sources, and licensing information.
- Derive storage requirements from the complete install plan, including unpacking and rollback overhead. The current free-space display is informational; it is not a storage gate.
- Choose a standard application data destination and offer an optional location picker.
- Show actual download size and applicable model terms before transfer. Never claim the app's license covers model weights.
- Detect existing files only in explicit user-selected or application-owned locations. Validate their contents and versions before reuse.
- Support resumable transfers, verified staging, atomic promotion, retries, and a readable recovery path.
- Run a real engine startup and minimal inference check before reporting ready.
- Recheck readiness on subsequent launches. The preview's explored flag must never become a readiness flag.

## Initial hardware targets

Provisional targets follow the current YUE2 // GROOVE documentation: Apple Silicon with 32 GB or more memory, and x86-64 Windows with an NVIDIA GPU of at least 8 GB graphics memory. These do not guarantee performance or compatibility. macOS recommendations and Windows driver/runtime compatibility must be validated against the actual packaged engine. No AMD, Intel GPU, CPU-only, Intel Mac, or Windows ARM support is promised.

Memory rounding tolerates marketed capacities; allocation limits and available memory must be checked by the core before generation. Model and runtime choices belong to the installer/core, not to user-facing dropdowns.
