"""Diagnostic-only byte trace of the original cache fixture; no hash changes."""
import hashlib
import inspect
import json
import os
from pathlib import Path
import runpy
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "packages/blendlink/blender"))
import bakelib

records = []
original = bakelib.fingerprint_bake_dependencies


def traced(*args, **kwargs):
    writers = []
    class Writer:
        def __init__(self, *a, **kw):
            self._inner = hashlib.sha256(*a, **kw); self.chunks = []; writers.append(self)
        def update(self, data):
            frame = inspect.currentframe().f_back
            self.chunks.append({"caller": frame.f_code.co_name, "line": frame.f_lineno, "bytes": len(data),
                "sha256": hashlib.sha256(data).hexdigest(), "prefixHex": bytes(data[:96]).hex(),
                "text": repr(bytes(data)) if len(data) <= 180 else None})
            self._inner.update(data)
        def __getattr__(self, name): return getattr(self._inner, name)
    class Hashes:
        sha256 = Writer
    real = bakelib.hashlib; bakelib.hashlib = Hashes()
    try: result = original(*args, **kwargs)
    finally: bakelib.hashlib = real
    records.append({"result": result, "writers": [{"sha256": writer.hexdigest(), "chunks": writer.chunks} for writer in writers]})
    return result


bakelib.fingerprint_bake_dependencies = traced
try: runpy.run_path(str(ROOT / "packages/blender-addon/tests/preparation_cache_check.py"), run_name="__main__")
finally:
    output = Path(os.environ["BLENDLINK_QA_FINGERPRINT_TRACE"]); output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(records, indent=2))
