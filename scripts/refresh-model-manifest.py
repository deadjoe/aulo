"""Refresh the pinned model manifest; downloads metadata and small files only."""
import hashlib
import json
from pathlib import Path
from urllib.request import urlopen

REVISIONS = {
    'YuE2-3B': '8f24312f187763b9854adeec87e437e2b03bbff1',
    'YuE2-Vae': '152733a19ad43aa67e367f9b5503ef8075bb5126',
}
ALLOWED = {
    'model.safetensors', 'config.json', 'generation_config.json',
    'yue2_generation_config.json', 'qwen.tiktoken', 'weights_manifest.json',
    'LICENSE', 'THIRD_PARTY_NOTICES.md',
    'licenses/SnakeBeta-NVIDIA-MIT.txt', 'licenses/stable-audio-tools-MIT.txt',
}
files = []
for model, revision in REVISIONS.items():
    repo = f'm-a-p/{model}'
    with urlopen(f'https://huggingface.co/api/models/{repo}/revision/{revision}?blobs=true', timeout=30) as response:
        metadata = json.load(response)
    assert metadata['sha'] == revision
    assert metadata['cardData']['license'] == 'cc-by-nc-4.0'
    for entry in metadata['siblings']:
        name = entry['rfilename']
        if name not in ALLOWED:
            continue
        url = f'https://huggingface.co/{repo}/resolve/{revision}/{name}'
        digest = entry.get('lfs', {}).get('sha256')
        if not digest:
            assert entry['size'] < 4_000_000
            with urlopen(url, timeout=30) as response:
                data = response.read(4_000_001)
            assert len(data) == entry['size']
            digest = hashlib.sha256(data).hexdigest()
        files.append({'path': f'{model}/{name}', 'url': url, 'bytes': entry['size'], 'sha256': digest})
manifest = {
    'schemaVersion': 1,
    'id': 'yue2-source-v1',
    'label': 'YuE2 music models',
    'coreVersion': '1.0.10',
    'license': 'CC BY-NC 4.0',
    'licenseUrl': 'https://creativecommons.org/licenses/by-nc/4.0/',
    'revisions': REVISIONS,
    'files': files,
}
path = Path(__file__).resolve().parents[1] / 'manifests/music-models.json'
path.write_text(json.dumps(manifest, indent=2) + '\n')
print(f'Wrote {len(files)} pinned files; {sum(f["bytes"] for f in files):,} bytes total. No model weights downloaded.')
