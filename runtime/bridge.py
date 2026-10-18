"""Private, versioned process boundary around the installed GROOVE adapter.

No web server, Gradio handlers, model downloads, or inference implementation.
One request per process; stdout is reserved for newline-delimited JSON events.
After a generate request, the host may send a single ``cancel`` line on stdin.
"""

from __future__ import annotations

import contextlib
import importlib.metadata
import json
import os
from pathlib import Path
import re
import secrets
import sys
import threading
import traceback

PROTOCOL_VERSION = 2
GROOVE_VERSION = "1.0.10"
YUE_VERSION = "0.1.6"
MAX_REQUEST_BYTES = 65536
WORK_ID = re.compile(r"^[0-9a-f]{32}$")

# GROOVE's own defaults (webui/runtime.py ABC_DEFAULTS / SEM_DEFAULTS, settings_store
# FIXED_DEFAULTS). Aulo only moves the knobs its simple controls name.
ABC_SAMPLING = {"temperature": 0.7, "top_p": 0.9, "top_k": 30, "repetition_penalty": 1.005,
                "penalty_window": 100, "min_tokens": 32, "max_tokens": 4096}
SEMANTIC_SAMPLING = {"temperature": 1.0, "top_p": 0.95, "top_k": 100, "repetition_penalty": 1.2,
                     "penalty_window": 50, "min_tokens": 200, "max_tokens": 9000}
MEMORY_BUDGET_GIB = 24
ODE_STEPS = 32

# The community recipe recorded in GROOVE's EXCLUDE_INSTRUMENTAL_RESEARCH.md: YuE2 has no
# instrumental switch, so ask with empty sections and no-vocal hints. Best effort only.
INSTRUMENTAL_LYRICS = "[Verse]\n\n[Chorus]\n\n[Bridge]\n\n[Outro]\n"
VOCAL_HINTS = {"female": "female vocal", "male": "male vocal"}


def emit(stream, event, **fields):
    stream.write(json.dumps({"protocolVersion": PROTOCOL_VERSION, "event": event, **fields}) + "\n")
    stream.flush()


def interpolate(value, low, middle, high):
    """Map a 0..100 control onto low..middle..high, with 50 at the engine default."""
    value = max(0.0, min(100.0, float(value)))
    if value <= 50:
        return low + (middle - low) * value / 50
    return middle + (high - middle) * (value - 50) / 50


def cfg_scale(style_influence):
    # 0 is upstream's unguided default (1.0); 50 is GROOVE's "stay close" recipe (1.5).
    scale = round(interpolate(style_influence, 1.0, 1.5, 2.0), 2)
    return None if scale == 1.0 else scale


def semantic_temperature(weirdness):
    # GROOVE's recipes: 0.85-0.95 safer, 1.0 default, 1.15-1.25 more surprising takes.
    return round(interpolate(weirdness, 0.85, 1.0, 1.25), 3)


def song_texts(request):
    """The style and lyrics strings the engine receives for Aulo's simple controls."""
    style = request.get("style", "").strip()
    hints = []
    if request.get("instrumental"):
        hints.append("instrumental")
        lyrics = INSTRUMENTAL_LYRICS
    else:
        lyrics = request.get("lyrics", "").strip()
        if not lyrics:
            raise ValueError("Add lyrics, or choose an instrumental.")
        # The model expects section labels; plain verses become one verse.
        if not any(line.lstrip().startswith("[") for line in lyrics.splitlines()):
            lyrics = f"[Verse]\n{lyrics}"
        if request.get("vocal") in VOCAL_HINTS:
            hints.append(VOCAL_HINTS[request["vocal"]])
    # Only add hints the style does not already say.
    hints = [hint for hint in hints if hint not in style.lower()]
    style = ", ".join(part for part in [style, *hints] if part)
    if not style:
        raise ValueError("Describe the sound you want.")
    return style, lyrics


def inspect_runtime():
    # Offline is enforced before importing the engine, not left to the UI.
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    groove = importlib.metadata.version("yue2-groove")
    yue = importlib.metadata.version("yue2-infer")
    if groove != GROOVE_VERSION or yue != YUE_VERSION:
        raise RuntimeError("The installed music engine does not match this Aulo build.")
    from yue2_groove import adapter, gguf_engine
    import torch

    adapter._require()
    device = "cuda" if torch.cuda.is_available() else (
        "mps" if torch.backends.mps.is_available() else "cpu"
    )
    backend = select_backend(device, adapter, gguf_engine)
    return {"engineVersion": groove, "yueVersion": yue, "torchVersion": str(torch.__version__),
            "device": device, "backend": backend}


def select_backend(device, adapter, gguf_engine):
    """GROOVE's own BACKEND=auto rule plus its FlashAttention fallback; None when unsupported."""
    backend, _ = gguf_engine.auto_backend(device, gguf_engine.cuda_total_vram_gib())
    if backend == "gguf":
        return "gguf"
    if device == "cpu":
        return None  # GROOVE would run for hours on a CPU; Aulo does not offer that.
    if device == "cuda" and not adapter.cuda_flash_attention_usable():
        return "torch-eager"
    return "torch"


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
    allowed = {"protocolVersion", "operation", "workId", "style", "lyrics", "instrumental",
               "vocal", "weirdness", "styleInfluence", "modelRoot", "outputRoot"}
    if set(request) - allowed:
        raise ValueError("Unexpected generation fields.")
    for key, limit in (("style", 1000), ("lyrics", 16000)):
        value = request.get(key, "")
        if not isinstance(value, str) or len(value) > limit:
            raise ValueError(f"Invalid {key}.")
    if not isinstance(request.get("instrumental", False), bool):
        raise ValueError("Invalid instrumental choice.")
    if request.get("vocal", "auto") not in ("auto", "female", "male"):
        raise ValueError("Invalid vocal choice.")
    for key in ("weirdness", "styleInfluence"):
        value = request.get(key, 50)
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not 0 <= value <= 100:
            raise ValueError(f"Invalid {key}.")
    if not isinstance(request.get("workId"), str) or not WORK_ID.match(request["workId"]):
        raise ValueError("Invalid work identifier.")
    for key in ("modelRoot", "outputRoot"):
        value = request.get(key)
        if not isinstance(value, str) or not Path(value).is_absolute():
            raise ValueError(f"{key} must be an absolute application-owned path.")
    song_texts(request)
    return operation


def load_engine(adapter, gguf_engine, runtime, model, vae, report):
    if runtime["backend"] == "gguf":
        return gguf_engine.GgufPipeline.open(
            model_dir=model, vae_dir=vae, ode_steps=ODE_STEPS, vae_core_frames=None,
            log=lambda _line: report("progress", stage="preparing"),
        )
    pipe, _ = adapter.load_pipeline(
        str(model), vae=str(vae), device=runtime["device"], dtype="bfloat16",
        backend=runtime["backend"], quantization="none", offload_ar=False,
        memory_budget_gib=MEMORY_BUDGET_GIB, ode_steps=ODE_STEPS, vae_core_frames=None,
        revision=None, vae_revision=None, local_files_only=True,
    )
    return pipe


def fit_semantic_budget(adapter, gguf_engine, pipe, request, abc_sampling, semantic):
    """GROOVE's runtime.fit_semantic_budget: trim the song budget to the model's context."""
    tokenizer = getattr(pipe, "tokenizer", None)
    if tokenizer is None:
        return semantic
    _, capped = gguf_engine.semantic_budget(
        request, tokenizer, abc_sampling, semantic, gguf_engine.CONTEXT
    )
    if capped >= semantic.max_tokens:
        return semantic
    fields = {name: getattr(semantic, name) for name in adapter.sampling_fields(semantic)}
    fields["max_tokens"] = capped
    fields["min_tokens"] = min(fields["min_tokens"], capped)
    return adapter.sampling(**fields)


def generate(request, report, runtime, cancelled):
    """Generate one song into ``outputRoot/workId``; returns the playable result."""
    from yue2_groove import adapter, gguf_engine
    import soundfile

    if runtime.get("backend") is None:
        raise RuntimeError("A supported accelerator is required.")
    root = Path(request["modelRoot"]).resolve(strict=True)
    model, vae = root / "YuE2-3B", root / "YuE2-Vae"
    if not model.is_dir() or not vae.is_dir():
        raise ValueError("The music model folder is incomplete.")
    style, lyrics = song_texts(request)
    output = Path(request["outputRoot"])
    output.mkdir(parents=True, exist_ok=True)
    work = output / request["workId"]
    work.mkdir(exist_ok=True)
    pending = work / "pending.json"
    pending.write_text(json.dumps({"state": "running"}), encoding="utf-8")
    pipe = None
    try:
        report("progress", stage="preparing")
        pipe = load_engine(adapter, gguf_engine, runtime, model, vae, report)
        song_request = adapter.song_request(
            style=style, lyrics=lyrics, cot="full", seed=secrets.randbelow(2**31),
            cfg_scale=cfg_scale(request.get("styleInfluence", 50)), id=request["workId"],
        )
        abc_sampling = adapter.sampling(**ABC_SAMPLING)
        semantic = adapter.sampling(**(SEMANTIC_SAMPLING | {
            "temperature": semantic_temperature(request.get("weirdness", 50))}))
        semantic = fit_semantic_budget(adapter, gguf_engine, pipe, song_request,
                                       abc_sampling, semantic)
        report("progress", stage="writing")
        stages = {"abc": "writing", "semantic": "performing"}
        last = {"stage": "writing"}

        def on_token(phase, _token, _count=1):
            stage = stages.get(phase)
            if stage and stage != last["stage"]:
                last["stage"] = stage
                report("progress", stage=stage)

        def on_progress(stage, done, total):
            name = {"nar": "rendering", "vae": "mixing"}.get(stage)
            if name:
                report("progress", stage=name, completed=done, total=total)

        song = adapter.generate(
            pipe, song_request, abc_sampling=abc_sampling, semantic_sampling=semantic,
            cancelled=cancelled, on_token=on_token, on_progress=on_progress,
        )
        report("progress", stage="saving")
        song.save_artifacts(work)
        audio = work / "audio.flac"
        info = soundfile.info(audio)
        if info.frames <= 0 or info.samplerate <= 0:
            raise RuntimeError("The music engine did not produce playable audio.")
        # Do not publish completion until all generated files have been flushed.
        for path in work.rglob("*"):
            if path.is_file():
                with path.open("rb") as handle:
                    os.fsync(handle.fileno())
        pending.unlink()
        return {"audio": "audio.flac", "duration": info.duration,
                "engineVersion": GROOVE_VERSION, "backend": runtime["backend"]}
    except BaseException as error:
        state = "cancelled" if isinstance(error, InterruptedError) else "failed"
        pending.write_text(json.dumps({"state": state}), encoding="utf-8")
        raise
    finally:
        if pipe is not None:
            adapter.close_pipeline(pipe)


def watch_for_cancel(stream, event):
    """Set *event* when the host sends ``cancel``; EOF alone is not a cancellation."""
    def run():
        with contextlib.suppress(Exception):
            for line in stream:
                if line.strip() == b"cancel":
                    event.set()
                    return

    threading.Thread(target=run, daemon=True).start()


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
                cancel = threading.Event()
                watch_for_cancel(sys.stdin.buffer, cancel)
                result = generate(request, report, runtime, cancel.is_set)
                report("completed", work=result)
            return 0
        except InterruptedError:
            report("cancelled")
            return 1
        except Exception:
            traceback.print_exc(file=sys.stderr)
            report("failed", message="The music engine could not complete this request.")
            return 1


if __name__ == "__main__":
    raise SystemExit(main())
