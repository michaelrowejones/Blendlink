# SPDX-License-Identifier: GPL-3.0-or-later
"""Pure reflection-source and owned-path contract tests."""
from __future__ import annotations

import hashlib
import importlib.util
import sys
import tempfile
from pathlib import Path
from types import SimpleNamespace


ADDON_DIR = Path(__file__).resolve().parents[1]


def expect(condition, message):
    if not condition:
        raise AssertionError(message)


spec = importlib.util.spec_from_file_location(
    "blendlink_probe_authoring_pure", ADDON_DIR / "probe_authoring.py",
)
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)


class FakeImage:
    def __init__(self, *, name="Studio.exr", size=(1024, 512), filepath="//studio.exr",
                 file_format="OPEN_EXR", payload=None, colorspace="sRGB"):
        self.name = name
        self.size = size
        self.filepath = filepath
        self.file_format = file_format
        self.library = None
        self.colorspace_settings = SimpleNamespace(name=colorspace)
        self.packed_file = SimpleNamespace(data=payload) if payload is not None else None
        # Blender 5.2 exposes ImagePackedFile wrappers here while retaining the
        # direct PackedFile on image.packed_file.
        self.packed_files = (
            [SimpleNamespace(packed_file=self.packed_file, filepath=filepath)]
            if self.packed_file is not None else []
        )


def main():
    path = module.relative_asset_path("Hero / Chrome", "8B3F-71_a")
    expect(
        path == "//blendlink-derived/reflection-probes/hero-chrome-8b3f71a.exr",
        f"owned path was not readable and sanitized: {path}",
    )
    try:
        module.relative_asset_path("No identity", "---")
    except ValueError as error:
        expect("stable identity" in str(error), f"missing identity error was vague: {error}")
    else:
        raise AssertionError("an empty stable identity was accepted")

    class FakeObject(dict):
        def __init__(self, name, object_type, **properties):
            super().__init__(properties)
            self.name = name
            self.type = object_type

    receiver_b = FakeObject(
        "Receiver B", "MESH",
        blendlink_id="receiver-b", blendlink_reflection_probe="probe-a",
    )
    receiver_a = FakeObject(
        "Receiver A", "MESH",
        blendlink_id="receiver-a", blendlink_reflection_probe="probe-a",
    )
    assigned = module.assigned_receivers(
        SimpleNamespace(objects=[
            receiver_b,
            FakeObject(
                "Other Probe", "MESH",
                blendlink_id="other", blendlink_reflection_probe="probe-b",
            ),
            FakeObject(
                "Assigned Light", "LIGHT",
                blendlink_id="light", blendlink_reflection_probe="probe-a",
            ),
            receiver_a,
        ]),
        SimpleNamespace(name="Probe A", object_id="probe-a"),
    )
    expect(
        assigned == (receiver_a, receiver_b),
        f"assigned receiver membership was not exact and stable: {assigned}",
    )

    payload = bytes((0x76, 0x2F, 0x31, 0x01)) + b" exact packed EXR bytes"
    packed = FakeImage(payload=payload)
    evidence = module.inspect_image(packed, resolve_path=lambda value, _library: value)
    expect(evidence.valid and evidence.source == "packed", f"packed source failed: {evidence}")
    expect(evidence.bytes == len(payload), "packed byte evidence was not exact")
    expect(
        evidence.content_hash == hashlib.sha256(payload).hexdigest()[:16],
        "packed hash evidence was not the source-byte hash",
    )
    expect(evidence.color_space == "linear", "EXR source did not force the linear contract")
    mislabeled = module.inspect_image(
        FakeImage(
            name="Mislabeled.png", filepath="//mislabeled.png", file_format="PNG",
            payload=b"this is not a PNG",
        ),
        resolve_path=lambda value, _library: value,
    )
    expect(
        not mislabeled.valid and "do not match the declared PNG" in mislabeled.issue,
        f"mislabeled reflection bytes were accepted: {mislabeled}",
    )

    square = FakeImage(size=(512, 512), payload=b"square")
    square_evidence = module.inspect_image(
        square, resolve_path=lambda value, _library: value,
    )
    expect(
        not square_evidence.valid and "2:1 equirectangular" in square_evidence.issue,
        f"square reflection source was accepted: {square_evidence}",
    )
    oversized = module.inspect_image(
        FakeImage(size=(16384, 8192), payload=b"too large"),
        resolve_path=lambda value, _library: value,
    )
    expect(
        not oversized.valid and "portable reflection sources" in oversized.issue,
        f"non-portable reflection texture size was accepted: {oversized}",
    )

    with tempfile.TemporaryDirectory(prefix="blendlink-probe-source-") as directory:
        linked_path = Path(directory) / "graphic.webp"
        linked_payload = b"RIFF\x10\x00\x00\x00WEBP exact linked source bytes"
        linked_path.write_bytes(linked_payload)
        linked = FakeImage(
            name="Graphic.webp", size=(800, 400), filepath=str(linked_path),
            file_format="WEBP", colorspace="sRGB",
        )
        linked_evidence = module.inspect_image(
            linked, resolve_path=lambda value, _library: value,
        )
        expect(
            linked_evidence.valid and linked_evidence.source == "linked"
            and linked_evidence.color_space == "srgb",
            f"linked LDR evidence was wrong: {linked_evidence}",
        )
        changed = module.inspect_image(
            linked, resolve_path=lambda value, _library: value,
            expected_hash="0000000000000000",
        )
        expect(
            not changed.valid and "bytes changed" in changed.issue,
            "changed exact source bytes were not rejected",
        )

        probe = SimpleNamespace(
            capture_mode="CUSTOM", custom_image=linked, baked_image=None,
            baked_content_hash="", baked_source_hash="", resolution="256", samples=128,
        )
        status = module.evaluate_status(
            None, probe, resolve_path=lambda value, _library: value,
        )
        expect(
            status.code == "READY" and "LDR WEBP" in status.detail,
            f"custom source status did not explain its consequence: {status}",
        )

    runtime = module.evaluate_status(None, SimpleNamespace(capture_mode="RUNTIME"))
    expect(
        runtime.code == "RUNTIME" and "website loads" in runtime.label,
        f"runtime source did not describe itself: {runtime}",
    )

    cached_probe = SimpleNamespace(
        capture_mode="BAKED", object_id="same-probe", id_data=None,
    )
    module._cache.update(
        dirty=False, scene_pointer=None,
        statuses={
            "same-probe": module.ProbeStatus(
                "READY", "Bake is current", "old evidence", "OK", "BAKED",
            ),
        },
    )
    expect(module.status_for(cached_probe).code == "READY", "matching cached source was ignored")
    cached_probe.capture_mode = "CUSTOM"
    expect(
        module.status_for(cached_probe).code == "CHECKING",
        "prior-mode Ready evidence leaked after changing reflection source",
    )
    cached_probe.capture_mode = "BAKED"
    module._cache["dirty"] = True
    expect(
        module.status_for(cached_probe).code == "CHECKING",
        "dirty reflection evidence was shown as current",
    )
    print("BLENDLINK_PROBE_AUTHORING_PURE_PASSED")


if __name__ == "__main__":
    main()
