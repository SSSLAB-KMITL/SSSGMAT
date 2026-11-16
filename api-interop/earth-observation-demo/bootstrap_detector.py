"""Fetch the pinned official model after installing requirements-detection.txt."""
import hashlib
import json
import urllib.request
from eo_engine.catalog import ROOT, DATA, save_json

if __name__ == "__main__":
    meta = json.loads((ROOT / "research/optical-detector-model.json").read_text())
    path = DATA / "models" / meta["weights"]
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        with urllib.request.urlopen(meta["download_url"], timeout=120) as response:
            content = response.read(100 * 1024**2)
        if hashlib.sha256(content).hexdigest() != meta["sha256"]:
            raise ValueError("Official model download does not match the pinned checksum")
        temporary = path.with_suffix(".tmp")
        temporary.write_bytes(content)
        temporary.replace(path)
    if hashlib.sha256(path.read_bytes()).hexdigest() != meta["sha256"]:
        raise ValueError("Existing model has an unexpected checksum")
    save_json(path.with_suffix(".json"), meta)
    print(f"Ready: {meta['name']} · {meta['sha256']}")
