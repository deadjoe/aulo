#!/usr/bin/env python3
"""Build the music engine that ships inside Aulo.

The result is a self-contained, relocatable directory: a standalone CPython with
YuE2, YUE2 // GROOVE and PyTorch installed, without the web UI, test tools or
anything else inference does not use. Tauri bundles it as an app resource, so a
person who installs Aulo never installs or configures Python.

Usage: python3 scripts/build_engine.py [--out src-tauri/engine]
Requires uv (https://docs.astral.sh/uv/) and network access while building.
"""

from __future__ import annotations

import argparse
import json
import os
import platform
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PYTHON = "3.12.9"
GROOVE = "git+https://github.com/deadjoe/yue2_groove@v1.0.10"
YUE2 = "git+https://github.com/multimodal-art-projection/YuE@yue2-v0.1.6"
GROOVE_VERSION = "1.0.10"
YUE2_VERSION = "0.1.6"

# GROOVE's validated replacements (its overrides/*.txt). macOS needs Torch 2.14.1
# for the MPS attention fix; other platforms keep upstream's CUDA build pin.
OVERRIDES = {
    "darwin": ["torch==2.14.1", "huggingface-hub==0.36.2", "soundfile==0.14.0",
               "safetensors==0.8.0"],
    "other": ["huggingface-hub==0.36.2", "soundfile==0.14.0", "safetensors==0.8.0"],
}
# Small, pure-Python: the GGUF engine converts checkpoints with it.
EXTRAS = ["gguf>=0.10"]

# Removed after installing: never imported for inference, or only by tooling.
PRUNE_PACKAGES = ["pip", "setuptools", "wheel", "_distutils_hack",
                  "pkg_resources", "ensurepip", "idlelib", "tkinter", "turtledemo",
                  "lib2to3", "pydoc_data", "test", "unittest/test"]
# Test suites shipped inside packages; nothing imports them at run time.
PRUNE_DIRS = ["tests"]
# torch/bin is required: Torch starts torch_shm_manager from it at import.
PRUNE_TORCH = ["include", "share"]


def run(*args: str, env: dict | None = None) -> None:
    print("+", " ".join(args), flush=True)
    subprocess.run(args, check=True, env=env)


def standalone_python(work: Path) -> Path:
    """A relocatable CPython from python-build-standalone, via uv."""
    install = work / "pythons"
    run("uv", "python", "install", PYTHON, "--install-dir", str(install), "--no-bin")
    # uv also adds a minor-version alias link; take the real, fully versioned directory.
    candidates = [p for p in install.iterdir()
                  if p.is_dir() and not p.is_symlink() and p.name.startswith(f"cpython-{PYTHON}-")]
    if len(candidates) != 1:
        raise SystemExit(f"expected one Python install, found {candidates}")
    return candidates[0]


def interpreter(prefix: Path) -> Path:
    return prefix / ("python.exe" if os.name == "nt" else "bin/python3")


def site_packages(prefix: Path) -> Path:
    if os.name == "nt":
        return prefix / "Lib" / "site-packages"
    return prefix / "lib" / f"python{PYTHON.rsplit('.', 1)[0]}" / "site-packages"


def install(prefix: Path, work: Path) -> None:
    python = str(interpreter(prefix))
    overrides = work / "overrides.txt"
    key = "darwin" if sys.platform == "darwin" else "other"
    overrides.write_text("\n".join(OVERRIDES[key]) + "\n", encoding="utf-8")
    env = os.environ | {"UV_PYTHON_PREFERENCE": "only-system"}
    common = ["--python", python, "--break-system-packages", "--compile-bytecode"]
    run("uv", "pip", "install", *common, f"yue2-infer @ {YUE2}", *EXTRAS,
        "--overrides", str(overrides), env=env)
    if sys.platform != "darwin":
        # PyPI's Windows Torch is CPU-only; use the CUDA build GROOVE validates.
        run("uv", "pip", "install", *common, "torch==2.10.0", "--index-url",
            "https://download.pytorch.org/whl/cu128", "--reinstall-package", "torch",
            "--no-deps", env=env)
    # GROOVE without its web UI: only the adapter and engines are imported.
    run("uv", "pip", "install", *common, "--no-deps", f"yue2-groove @ {GROOVE}", env=env)


def prune(prefix: Path) -> None:
    site = site_packages(prefix)
    stdlib = site.parent
    for name in PRUNE_PACKAGES:
        for base in (site, stdlib):
            target = base / name
            if target.is_dir():
                shutil.rmtree(target)
    # setuptools' path hook would point at the removed _distutils_hack.
    (site / "distutils-precedence.pth").unlink(missing_ok=True)
    torch = site / "torch"
    for name in PRUNE_TORCH:
        target = torch / name
        if target.is_dir():
            shutil.rmtree(target)
    for path in sorted(site.rglob("*"), key=lambda p: len(p.parts)):
        if path.is_dir() and path.name in PRUNE_DIRS:
            shutil.rmtree(path, ignore_errors=True)
    # Console scripts carry the build machine's path; only the interpreter is used.
    bin_dir = prefix / "bin"
    if bin_dir.is_dir():
        for entry in bin_dir.iterdir():
            if not entry.name.startswith("python") or entry.name.endswith("-config"):
                entry.unlink()
    for pattern in ("*.a", "*.pyi", "*.h", "*.hpp", "*.cuh"):
        for path in prefix.rglob(pattern):
            path.unlink(missing_ok=True)


# Imported when the engine starts and loads the model; their bytecode is kept.
WARM_IMPORTS = (
    "import torch, transformers, soundfile, numpy, safetensors;"
    "from yue2_groove import adapter, gguf_engine; adapter._require();"
    "import yue2, yue2.pipeline, yue2.nar, yue2.modeling_vae, yue2.sampling, yue2.protocol"
)


def trim_bytecode(prefix: Path) -> None:
    """Keep compiled bytecode only for modules the engine imports.

    Bytecode for everything doubles the size of large libraries (most of
    transformers is model code Aulo never loads). Anything not kept is still
    compiled in memory if it is ever imported, so this only affects start-up time.
    """
    python = str(interpreter(prefix))
    listing = subprocess.run(
        [python, "-I", "-c", WARM_IMPORTS + ";import sys;"
         "print('\\n'.join(sorted({getattr(m, '__file__', None) or '' for m in list(sys.modules.values())})))"],
        check=True, capture_output=True, text=True,
    ).stdout
    used = {Path(line).resolve() for line in listing.splitlines() if line.endswith(".py")}
    for cached in prefix.rglob("*.pyc"):
        if cached.parent.name != "__pycache__":
            continue
        source = cached.parent.parent / (cached.name.split(".", 1)[0] + ".py")
        if source.resolve() not in used:
            cached.unlink()


def describe(prefix: Path) -> dict:
    python = str(interpreter(prefix))
    probe = (
        "import importlib.metadata as m, json, torch;"
        "print(json.dumps({'groove': m.version('yue2-groove'), 'yue2': m.version('yue2-infer'),"
        "'torch': torch.__version__}))"
    )
    quiet = os.environ | {"PYTHONDONTWRITEBYTECODE": "1"}
    result = subprocess.run([python, "-I", "-c", probe], capture_output=True, text=True,
                            env=quiet)
    if result.returncode != 0:
        raise SystemExit(f"the built engine does not start:\n{result.stderr}")
    out = result.stdout
    versions = json.loads(out.strip().splitlines()[-1])
    if versions["groove"] != GROOVE_VERSION or versions["yue2"] != YUE2_VERSION:
        raise SystemExit(f"unexpected engine versions: {versions}")
    # The adapter must import without the web UI being installed.
    subprocess.run([python, "-I", "-c", "from yue2_groove import adapter, gguf_engine;"
                    "adapter._require()"], check=True, env=quiet)
    return {"schemaVersion": 1, "platform": f"{sys.platform}-{platform.machine().lower()}",
            "python": PYTHON, **versions}


def main() -> int:
    parser = argparse.ArgumentParser(description="Build the music engine that ships inside Aulo.")
    parser.add_argument("--out", type=Path, default=ROOT / "src-tauri" / "engine")
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix="aulo-engine-") as temp:
        work = Path(temp)
        prefix = standalone_python(work)
        install(prefix, work)
        prune(prefix)
        trim_bytecode(prefix)
        info = describe(prefix)
        if args.out.exists():
            shutil.rmtree(args.out)
        args.out.parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(prefix, args.out / "python", symlinks=True)
        (args.out / "engine.json").write_text(json.dumps(info, indent=2) + "\n",
                                              encoding="utf-8")
    size = sum(p.stat().st_size for p in args.out.rglob("*") if p.is_file())
    print(f"engine ready at {args.out} ({size / 1e6:.0f} MB): {info}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
