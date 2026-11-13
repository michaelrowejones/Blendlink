"""Retain original failing attestation inputs before temporary assets disappear."""
import json
import os
from pathlib import Path
import runpy
import sys

ROOT = Path(__file__).resolve().parents[2]
output = Path(os.environ["BLENDLINK_QA_ATTESTATION_TRACE"]); output.mkdir(parents=True, exist_ok=True)
seen = set()


def trace(frame, event, arg):
    if frame.f_code.co_name != "_attest_material_bake_texture" or not frame.f_code.co_filename.endswith("material_compiler.py"):
        return trace if event == "call" else None
    if event == "exception":
        values = frame.f_locals
        if "payload" in values and id(frame) not in seen:
            seen.add(id(frame)); index = len(seen)
            (output / f"actual-{index}.png").write_bytes(values["payload"])
            (output / f"attestation-{index}.json").write_text(json.dumps({key: values[key] for key in ["fact", "image_fact", "image", "texture", "texture_info", "channel", "document"]}, indent=2, default=repr))
            import bpy
            for image in bpy.data.images:
                if getattr(image, "filepath_raw", ""):
                    path = Path(bpy.path.abspath(image.filepath_raw))
                    if path.is_file():
                        (output / (f"source-{index}-" + path.name)).write_bytes(path.read_bytes())
    return trace


sys.settrace(trace)
try: runpy.run_path(str(ROOT / "packages/blender-addon/tests/material_bake_check.py"), run_name="__main__")
finally: sys.settrace(None)
