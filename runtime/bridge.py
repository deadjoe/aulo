"""Private, versioned process boundary around the installed GROOVE adapter.

No web server, Gradio handlers, model downloads, or inference implementation.
stdout is reserved for newline-delimited JSON events.

A process either answers one ``probe`` and exits, or ``serve``s: it keeps the loaded
model between songs and reads ``generate``, ``cancel`` and ``shutdown`` commands
from stdin, one JSON object per line, until the host shuts it down.
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
import queue
import threading
import traceback

PROTOCOL_VERSION = 3
GROOVE_VERSION = "1.0.10"
YUE_VERSION = "0.1.6"
MAX_REQUEST_BYTES = 65536
HEARTBEAT_TOKENS = 100  # liveness for the host watchdog during long token stages
WORK_ID = re.compile(r"^[0-9a-f]{32}$")
MAX_PENDING_CANCELS = 64

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
INSTRUMENTAL_HINTS = ("instrumental", "no vocals")
VOCAL_HINTS = {"female": "female vocal", "male": "male vocal"}
# The same recipe asks for no vocal words in the style. Only style parts that plainly
# describe a voice are dropped; instruments, moods and genres stay as written.
VOICE_WORDS = re.compile(
    r"\b(vocals?|vocalists?|voices?|singers?|singing|sung|sings?|choirs?|choral|rap|rapping"
    r"|rappers?|humming|scat|falsetto|a ?cappella|acapella|spoken|lyrics?)\b",
    re.IGNORECASE)
# Language tags name the sung language; dropped only when a style part is just that.
LANGUAGES = {"english", "chinese", "mandarin", "cantonese", "japanese", "korean", "spanish",
             "french", "german", "italian", "portuguese", "russian"}
GENDER_WORDS = {
    "female": re.compile(r"\b(female|woman|women|girls?|feminine)\b", re.IGNORECASE),
    "male": re.compile(r"\b(male|man|men|boys?|masculine)\b", re.IGNORECASE),
}


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


def without_parts(style, drop):
    """``style`` without the comma-separated parts ``drop`` matches; unchanged otherwise."""
    parts = [part.strip() for part in re.split(r"[,\n]", style)]
    kept = [part for part in parts if part and not drop(part)]
    if len(kept) == len([part for part in parts if part]):
        return style
    return ", ".join(kept)


def is_voice_part(part):
    return bool(VOICE_WORDS.search(part)) or part.lower() in LANGUAGES


def song_texts(request):
    """The style and lyrics strings the engine receives for Aulo's simple controls."""
    style = request.get("style", "").strip()
    hints = []
    if request.get("instrumental"):
        style = without_parts(style, is_voice_part)
        hints.extend(INSTRUMENTAL_HINTS)
        lyrics = INSTRUMENTAL_LYRICS
    else:
        lyrics = request.get("lyrics", "").strip()
        if not lyrics:
            raise ValueError("Add lyrics, or choose an instrumental.")
        # The model expects section labels; plain verses become one verse.
        if not any(line.lstrip().startswith("[") for line in lyrics.splitlines()):
            lyrics = f"[Verse]\n{lyrics}"
        vocal = request.get("vocal")
        if vocal in VOCAL_HINTS:
            # The chosen voice wins over a voice of the other gender named in the style.
            other = GENDER_WORDS["male" if vocal == "female" else "female"]
            style = without_parts(
                style, lambda part: bool(other.search(part) and VOICE_WORDS.search(part)))
            hints.append(VOCAL_HINTS[vocal])
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
    wanted = os.environ.get("AULO_ENGINE") or None
    if wanted not in (None, "gguf", "torch"):
        raise ValueError("Unknown engine.")
    backend = select_backend(device, adapter, gguf_engine, wanted)
    reason = None
    if backend is None:
        reason = "missing_engine" if wanted == "gguf" else "no_accelerator"
    return {"engineVersion": groove, "yueVersion": yue, "torchVersion": str(torch.__version__),
            "device": device, "backend": backend, "reason": reason}


def select_backend(device, adapter, gguf_engine, wanted=None):
    """The engine Aulo decided on for this computer (``AULO_ENGINE``: ``gguf`` or ``torch``),
    or, without a decision (development), GROOVE's own BACKEND=auto rule. Adds GROOVE's
    FlashAttention fallback. None when this computer cannot run it."""
    if wanted == "gguf":
        return "gguf" if gguf_engine.available() else None
    if wanted is None:
        backend, _ = gguf_engine.auto_backend(device, gguf_engine.cuda_total_vram_gib())
        if backend == "gguf":
            return "gguf"
    if device == "cpu":
        return None  # GROOVE would run for hours on a CPU; Aulo does not offer that.
    if device == "cuda" and not adapter.cuda_flash_attention_usable():
        return "torch-eager"
    return "torch"


def validate_request(request):
    """The first line: ``probe`` or ``serve``."""
    if not isinstance(request, dict) or request.get("protocolVersion") != PROTOCOL_VERSION:
        raise ValueError("Unsupported engine protocol.")
    operation = request.get("operation")
    if operation not in ("probe", "serve"):
        raise ValueError("Unknown engine operation.")
    if set(request) != {"protocolVersion", "operation"}:
        raise ValueError("Unexpected fields.")
    return operation


def validate_command(command):
    """A command while serving: ``generate``, ``cancel`` or ``shutdown``."""
    if not isinstance(command, dict):
        raise ValueError("Invalid command.")
    operation = command.get("operation")
    if operation == "shutdown":
        if set(command) != {"operation"}:
            raise ValueError("Unexpected shutdown fields.")
        return operation
    if not isinstance(command.get("workId"), str) or not WORK_ID.match(command["workId"]):
        raise ValueError("Invalid work identifier.")
    if operation == "cancel":
        if set(command) != {"operation", "workId"}:
            raise ValueError("Unexpected cancel fields.")
        return operation
    if operation != "generate":
        raise ValueError("Unknown engine command.")
    allowed = {"operation", "workId", "style", "lyrics", "instrumental", "vocal", "weirdness",
               "styleInfluence", "seed", "modelRoot", "outputRoot"}
    if set(command) - allowed:
        raise ValueError("Unexpected generation fields.")
    for key in ("style", "lyrics"):
        value = command.get(key, "")
        if not isinstance(value, str) or (key == "lyrics" and len(value) > 16000):
            raise ValueError(f"Invalid {key}.")
    if not isinstance(command.get("instrumental", False), bool):
        raise ValueError("Invalid instrumental choice.")
    if command.get("vocal", "auto") not in ("auto", "female", "male"):
        raise ValueError("Invalid vocal choice.")
    for key in ("weirdness", "styleInfluence"):
        value = command.get(key, 50)
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not 0 <= value <= 100:
            raise ValueError(f"Invalid {key}.")
    seed = command.get("seed", 0)
    if isinstance(seed, bool) or not isinstance(seed, int) or not 0 <= seed < 2**31:
        raise ValueError("Invalid seed.")
    for key in ("modelRoot", "outputRoot"):
        value = command.get(key)
        if not isinstance(value, str) or not Path(value).is_absolute():
            raise ValueError(f"{key} must be an absolute application-owned path.")
    song_texts(command)
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


class Engine:
    """One loaded pipeline, reused for every song with the same model folder."""

    def __init__(self, runtime):
        self.runtime = runtime
        self.pipe = None
        self.key = None

    def pipeline(self, adapter, gguf_engine, model, vae, report):
        key = (str(model), str(vae), self.runtime["backend"])
        if self.pipe is not None and self.key == key:
            return self.pipe
        self.close(adapter)
        self.pipe = load_engine(adapter, gguf_engine, self.runtime, model, vae, report)
        self.key = key
        return self.pipe

    def close(self, adapter=None):
        if self.pipe is None:
            return
        if adapter is None:
            from yue2_groove import adapter
        with contextlib.suppress(Exception):
            adapter.close_pipeline(self.pipe)
        self.pipe, self.key = None, None

    def generate(self, request, report, cancelled):
        """Generate one song into ``outputRoot/workId``; returns the playable result."""
        from yue2_groove import adapter, gguf_engine
        import soundfile

        if self.runtime.get("backend") is None:
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
        try:
            report("progress", stage="preparing")
            pipe = self.pipeline(adapter, gguf_engine, model, vae, report)
            if cancelled():
                raise InterruptedError("Cancelled before generation")
            song_request = adapter.song_request(
                style=style, lyrics=lyrics, cot="full",
                seed=request["seed"] if "seed" in request else secrets.randbelow(2**31),
                cfg_scale=cfg_scale(request.get("styleInfluence", 50)), id=request["workId"],
            )
            abc_sampling = adapter.sampling(**ABC_SAMPLING)
            semantic = adapter.sampling(**(SEMANTIC_SAMPLING | {
                "temperature": semantic_temperature(request.get("weirdness", 50))}))
            semantic = fit_semantic_budget(adapter, gguf_engine, pipe, song_request,
                                           abc_sampling, semantic)
            report("progress", stage="writing")
            stages = {"abc": "writing", "semantic": "performing"}
            state = {"stage": "writing", "tokens": 0}

            def on_token(phase, _token, count=1):
                stage = stages.get(phase, state["stage"])
                before = state["tokens"] // HEARTBEAT_TOKENS
                state["tokens"] += count
                if stage != state["stage"] or state["tokens"] // HEARTBEAT_TOKENS != before:
                    state["stage"] = stage
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
            # Windows only flushes handles opened for writing, so open them read-write.
            for path in work.rglob("*"):
                if path.is_file():
                    with path.open("r+b") as handle:
                        os.fsync(handle.fileno())
            pending.unlink()
            return {"audio": "audio.flac", "duration": info.duration,
                    "engineVersion": GROOVE_VERSION, "backend": self.runtime["backend"]}
        except BaseException as error:
            state = "cancelled" if isinstance(error, InterruptedError) else "failed"
            pending.write_text(json.dumps({"state": state}), encoding="utf-8")
            raise
        finally:
            release_cache()


def release_cache():
    """Return scratch memory between songs; the loaded weights stay resident."""
    with contextlib.suppress(Exception):
        import gc

        import torch

        gc.collect()
        if torch.backends.mps.is_available():
            torch.mps.empty_cache()
        elif torch.cuda.is_available():
            torch.cuda.empty_cache()


class Commands:
    """Reads commands on a background thread so ``cancel`` arrives mid-song."""

    def __init__(self, stream):
        self.queue = queue.Queue()
        self.current = None
        # Cancels for songs not started yet: a cancel can overtake its own generate.
        self.pending_cancels = set()
        self.cancel = threading.Event()
        self.lock = threading.Lock()
        self.thread = threading.Thread(target=self.read, args=(stream,), daemon=True)

    def start(self):
        self.thread.start()
        return self

    def read(self, stream):
        try:
            while True:
                raw = stream.readline(MAX_REQUEST_BYTES + 1)
                if not raw:
                    break
                if len(raw) > MAX_REQUEST_BYTES:
                    self.queue.put(("invalid", None))
                    continue
                try:
                    command = json.loads(raw)
                    operation = validate_command(command)
                except (ValueError, json.JSONDecodeError):
                    work_id = None
                    with contextlib.suppress(Exception):
                        candidate = json.loads(raw).get("workId")
                        work_id = candidate if WORK_ID.match(candidate) else None
                    self.queue.put(("invalid", work_id))
                    continue
                if operation == "cancel":
                    with self.lock:
                        if self.current == command["workId"]:
                            self.cancel.set()
                        elif len(self.pending_cancels) < MAX_PENDING_CANCELS:
                            self.pending_cancels.add(command["workId"])
                    continue
                self.queue.put((operation, command))
        finally:
            self.queue.put(("shutdown", None))

    def begin(self, work_id):
        with self.lock:
            self.current = work_id
            self.cancel.clear()
            if work_id in self.pending_cancels:
                self.pending_cancels.discard(work_id)
                self.cancel.set()

    def end(self):
        with self.lock:
            self.current = None


def serve(runtime, commands, report):
    engine = Engine(runtime)
    report("ready", **runtime)
    try:
        while True:
            operation, command = commands.queue.get()
            if operation == "shutdown":
                return
            if operation == "invalid":
                fields = {"workId": command} if command else {}
                report("failed", message="The music engine rejected a request.", **fields)
                continue
            work_id = command["workId"]
            commands.begin(work_id)
            try:
                result = engine.generate(
                    command,
                    lambda event, **fields: report(event, workId=work_id, **fields),
                    commands.cancel.is_set,
                )
                report("completed", workId=work_id, work=result)
            except InterruptedError:
                report("cancelled", workId=work_id)
            except Exception:
                traceback.print_exc(file=sys.stderr)
                report("failed", workId=work_id,
                       message="The music engine could not complete this song.")
            finally:
                commands.end()
    finally:
        engine.close()


def main():
    # Keep library/native stdout out of the protocol, including C-level writes.
    protocol = os.fdopen(os.dup(sys.stdout.fileno()), "w", encoding="utf-8", buffering=1)
    os.dup2(sys.stderr.fileno(), sys.stdout.fileno())
    code = 1
    with protocol, contextlib.redirect_stdout(sys.stderr):
        def report(event, **fields):
            emit(protocol, event, **fields)
        try:
            raw = sys.stdin.buffer.readline(MAX_REQUEST_BYTES + 1)
            if len(raw) > MAX_REQUEST_BYTES:
                raise ValueError("Engine request is too large.")
            operation = validate_request(json.loads(raw))
            runtime = inspect_runtime()
            if operation == "probe":
                report("probe", **runtime)
            else:
                serve(runtime, Commands(sys.stdin.buffer).start(), report)
            code = 0
        except Exception:
            traceback.print_exc(file=sys.stderr)
            report("failed", message="The music engine could not start.")
        protocol.flush()
        sys.stderr.flush()
    # The command reader may still be blocked on stdin; leave without waiting for it.
    os._exit(code)


if __name__ == "__main__":
    main()
