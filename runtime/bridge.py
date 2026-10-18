"""Private, versioned process boundary around the installed GROOVE adapter.

No web server, Gradio handlers, model downloads, or inference implementation.
One request per process; stdout is reserved for newline-delimited JSON events.
"""

from __future__ import annotations

import contextlib
import importlib.metadata
import json
import os
from pathlib import Path
import secrets
import sys
import traceback

PROTOCOL_VERSION = 1
GROOVE_VERSION = "1.0.10"
YUE_VERSION = "0.1.6"
MAX_REQUEST_BYTES = 65536


def emit(stream, event, **fields):
    stream.write(json.dumps({"protocolVersion": PROTOCOL_VERSION, "event": event, **fields}) + "\n")
    stream.flush()


def inspect_runtime():
    # Offline is enforced before importing the engine, not left to the UI.
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    groove = importlib.metadata.version("yue2-groove")
    yue = importlib.metadata.version("yue2-infer")
    if groove != GROOVE_VERSION or yue != YUE_VERSION:
        raise RuntimeError("The installed music engine does not match this Aulo build.")
    from yue2_groove import adapter
    import torch

    adapter._require()
    device = "cuda" if torch.cuda.is_available() else (
        "mps" if torch.backends.mps.is_available() else None
    )
    return {"engineVersion": groove, "yueVersion": yue, "torchVersion": str(torch.__version__),
            "device": device, "generationReady": False}


def validate_request(request):
    if not isinstance(request, dict) or request.get("protocolVersion") != PROTOCOL_VERSION:
        raise ValueError("Unsupported engine protocol.")
    operation = request.get("operation")
    if operation == "probe":
        if set(request) != {"protocolVersion", "operation"}:
            raise ValueError("Unexpected probe fields.")
        return operation
    if operation != "generate":
        raise ValueError("Unknown engine operation.")
    allowed = {"protocolVersion", "operation", "style", "lyrics", "title", "abc", "modelRoot", "outputRoot"}
    if set(request) - allowed:
        raise ValueError("Unexpected generation fields.")
    for key, limit in (("style", 4000), ("lyrics", 16000), ("title", 200), ("abc", 16000)):
        value = request.get(key, "")
        if not isinstance(value, str) or len(value) > limit:
            raise ValueError(f"Invalid {key}.")
    if not request.get("style", "").strip() and not request.get("lyrics", "").strip():
        raise ValueError("Add a music style or lyrics first.")
    for key in ("modelRoot", "outputRoot"):
        value = request.get(key)
        if not isinstance(value, str) or not Path(value).is_absolute():
            raise ValueError(f"{key} must be an absolute application-owned path.")
    return operation


def generate(request, report, runtime):
    """Developer integration path; desktop generation remains gated off."""
    from yue2_groove import adapter
    import soundfile

    if runtime["device"] is None:
        raise RuntimeError("A supported accelerator is required.")
    # Start with the existing eager PyTorch path; GGUF needs its own packaging gate.
    root = Path(request["modelRoot"]).resolve(strict=True)
    model, vae = root / "YuE2-3B", root / "YuE2-Vae"
    if not model.is_dir() or not vae.is_dir():
        raise ValueError("The music model folder is incomplete.")
    output = Path(request["outputRoot"])
    output.mkdir(parents=True, exist_ok=True)
    work_id = secrets.token_hex(16)
    work = output / work_id
    work.mkdir()
    pending = work / "pending.json"
    pending.write_text(json.dumps({"state": "running"}), encoding="utf-8")
    pipe = None
    try:
        report("progress", stage="loading")
        pipe, _ = adapter.load_pipeline(
            str(model), vae=str(vae), device=runtime["device"], dtype="bfloat16",
            backend="torch-eager", quantization="none", offload_ar=True,
            memory_budget_gib=24, ode_steps=50, vae_core_frames=None,
            revision=None, vae_revision=None, local_files_only=True,
        )
        song_request = adapter.song_request(
            style=request.get("style", ""), lyrics=request.get("lyrics", ""),
            abc=request.get("abc") or None, cot="full", seed=secrets.randbelow(2**31), id=work_id,
        )
        report("progress", stage="composing")
        song = adapter.generate(
            pipe, song_request,
            abc_sampling=adapter.sampling(temperature=0.7, top_p=0.9, top_k=30,
                repetition_penalty=1.005, penalty_window=100, min_tokens=32, max_tokens=4096),
            semantic_sampling=adapter.sampling(temperature=1.0, top_p=0.95, top_k=100,
                repetition_penalty=1.2, penalty_window=50, min_tokens=200, max_tokens=9000),
            on_progress=lambda stage, done, total: report("progress", stage=stage, completed=done, total=total),
        )
        report("progress", stage="saving")
        song.save_artifacts(work)
        audio = work / "audio.flac"
        info = soundfile.info(audio)
        if info.frames <= 0 or info.samplerate <= 0:
            raise RuntimeError("The music engine did not produce playable audio.")
        record = {"id": work_id, "title": request.get("title") or "Untitled song",
                  "audio": "audio.flac", "duration": info.duration,
                  "engineVersion": GROOVE_VERSION}
        (work / "aulo.json").write_text(json.dumps(record, indent=2), encoding="utf-8")
        # Do not publish completion until all generated files have been flushed.
        for path in work.rglob("*"):
            if path.is_file():
                with path.open("rb") as handle:
                    os.fsync(handle.fileno())
        pending.unlink()
        return record
    except BaseException:
        pending.write_text(json.dumps({"state": "failed"}), encoding="utf-8")
        raise
    finally:
        if pipe is not None:
            adapter.close_pipeline(pipe)


def main():
    # Keep library/native stdout out of the protocol, including C-level writes.
    protocol = os.fdopen(os.dup(sys.stdout.fileno()), "w", encoding="utf-8", buffering=1)
    os.dup2(sys.stderr.fileno(), sys.stdout.fileno())
    with protocol, contextlib.redirect_stdout(sys.stderr):
        def report(event, **fields):
            emit(protocol, event, **fields)
        try:
            raw = sys.stdin.buffer.readline(MAX_REQUEST_BYTES + 1)
            if len(raw) > MAX_REQUEST_BYTES:
                raise ValueError("Engine request is too large.")
            request = json.loads(raw)
            operation = validate_request(request)
            runtime = inspect_runtime()
            if operation == "probe":
                report("probe", **runtime)
            else:
                result = generate(request, report, runtime)
                report("completed", work=result)
            return 0
        except Exception:
            traceback.print_exc(file=sys.stderr)
            report("failed", message="The music engine could not complete this request.")
            return 1


if __name__ == "__main__":
    raise SystemExit(main())
