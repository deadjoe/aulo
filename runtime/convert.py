"""Convert a finished song's FLAC into a download format with the runtime's soundfile.

Usage: convert.py <source.flac> <destination> <wav|mp3>
Imports no model code, so it runs quickly and alongside a generation.
"""

from __future__ import annotations

import sys
from pathlib import Path

FORMATS = {
    # 24-bit PCM keeps the model's output precision for editing.
    "wav": {"format": "WAV", "subtype": "PCM_24"},
    # 320 kbps constant bit rate: the highest quality MP3 offers.
    "mp3": {"format": "MP3", "subtype": "MPEG_LAYER_III", "bitrate_mode": "CONSTANT",
            "compression_level": 0.0},
}


def convert(source: Path, destination: Path, kind: str) -> None:
    import soundfile

    options = FORMATS[kind]
    data, rate = soundfile.read(source, dtype="float32")
    soundfile.write(destination, data, rate, **options)
    info = soundfile.info(destination)
    if info.frames <= 0:
        raise RuntimeError("The converted file is empty.")


def main(argv: list[str]) -> int:
    if len(argv) != 4 or argv[3] not in FORMATS:
        print("usage: convert.py <source.flac> <destination> <wav|mp3>", file=sys.stderr)
        return 2
    source, destination = Path(argv[1]), Path(argv[2])
    if not source.is_absolute() or not destination.is_absolute():
        print("paths must be absolute", file=sys.stderr)
        return 2
    convert(source, destination, argv[3])
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
