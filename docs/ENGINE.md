# Private music engine boundary

Aulo calls the existing installed `yue2_groove.adapter`; it does not import Gradio handlers, start a web server, copy model implementations, or change the GROOVE checkout. `runtime/bridge.py` uses protocol version 1 over UTF-8 newline-delimited JSON. Library output, including native stdout, is redirected to stderr. Each process accepts exactly one request and exits.

## Current desktop integration

The Rust `engine_status` command discovers only Aulo's private runtime location. Debug builds may use an absolute `AULO_DEV_PYTHON` interpreter path supplied by the developer. Release builds ignore that override. No interpreter selector, command field, or dependency configuration is exposed to users. There is no PATH search or shell invocation.

The bridge checks the installed GROOVE 1.0.10 and YuE2 0.1.6 versions, imports the real adapter and PyTorch, and checks accelerator availability. The native host enforces a 30-second timeout, limits protocol output to 64 KiB, checks the versioned reply, and reaps failed or timed-out children. Offline mode is forced and no weights are loaded by this check. A successful probe means **detected**, never generation-ready. The Settings dialog reports the result.

This increment does not distribute a runtime. The reserved interpreter locations are `runtime/python/bin/python3` on macOS and `runtime/python/python.exe` on Windows, under application data. Installation must add verified platform artifacts and compatibility checks before those paths become a supported user-facing setup flow.

## Developer generation path

The bridge also accepts a `generate` operation with `protocolVersion`, `style`, `lyrics`, optional `title` and `abc`, and absolute `modelRoot` and `outputRoot` paths. This path is not exposed as a desktop command. The model root contains `YuE2-3B` and `YuE2-Vae`; use a separately verified model folder. No network fallback or model download is permitted.

Generation delegates to the existing adapter's pipeline loading, request, sampling, generation, progress, artifact-saving and cleanup APIs. The initial integration profile uses eager PyTorch, the upstream 24 GiB memory budget, bfloat16, AR offloading, 50 ODE steps, and GROOVE's existing sampling defaults. This is a developer profile, not an automatically validated hardware recommendation. CPU fallback is rejected. GGUF and low-memory hardware require a separate tested integration profile before enabling generation for users.

Progress reports real stages and available NAR/VAE step counts, without estimating a whole-song percentage. Works receive random directory identifiers, never title-derived paths. Completed output must contain decodable, nonempty audio. Artifacts are flushed before the pending marker is removed; failed runs retain that marker and cannot be treated as completed. Abruptly interrupted runs can retain `running` markers and must be reconciled by the future library service.

Unit tests use explicit fake adapter/audio fixtures to verify delegation and failure handling. They do not validate inference quality, performance, or real audio generation. A separate real MPS smoke test generated and fully decoded a 59.28-second stereo song through this bridge; see [validation](VALIDATION.md). That run reused an existing development interpreter and does not validate private runtime installation.

## Remaining integration gates

- Real model-load and full-song smoke test in an isolated Aulo runtime.
- Hardware-specific profiles, including the existing GGUF backend and Windows device validation.
- Native generation supervisor with a single GPU queue, cancellation and app-exit cleanup.
- Durable library indexing, interrupted-job recovery, restricted audio serving and playback.
- Verified runtime distribution, signatures, installation recovery and upgrades.

The composer stays disabled until these gates are implemented and validated. Model verification, a compatible import, and a successful CI run cannot independently unlock it.
