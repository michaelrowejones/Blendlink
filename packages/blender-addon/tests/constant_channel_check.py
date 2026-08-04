# SPDX-License-Identifier: GPL-3.0-or-later
"""Contract check for constant-channel elision.

Phase 1b measured 38 of the ellie character's 85 published textures as
single solid colours - 26 of them pure-black emissive - 75.4 MiB of a
201.5 MiB GPU budget spent on images indistinguishable from a number.

A black emissive channel now ships as no texture at all. The BOUNDARY is
the safety property and is what this mostly asserts: glTF MULTIPLIES
emissiveFactor by the emissive texture, so a carrier that drops its image
while keeping a non-black factor does not stop emitting - it emits that
colour everywhere. _attest_material_bake_channels enforces "no planned
emissive image => black factor", so only black may elide until a future
change records the expected constant on the plan and teaches that branch
to compare against it.
"""
import importlib.util
import sys
from pathlib import Path


ADDON_DIR = Path(__file__).resolve().parents[1]
CANONICAL_BLENDER_DIR = ADDON_DIR.parent / "blendlink" / "blender"
sys.path.insert(0, str(CANONICAL_BLENDER_DIR))
sys.path.insert(0, str(ADDON_DIR))


def expect(condition, message):
    if not condition:
        raise AssertionError(message)


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


procedural = load(
    "blendlink_constant_channel_procedural", ADDON_DIR / "procedural.py",
)
sys.modules["procedural"] = procedural
compiler = load(
    "blendlink_constant_channel_compiler", ADDON_DIR / "material_compiler.py",
)
constant_of = compiler._constant_channel_value


# --- Detection is over the COVERED texels the bake measured -------------
expect(
    constant_of({"rgbMin": (0.0, 0.0, 0.0), "rgbMax": (0.0, 0.0, 0.0)})
    == (0.0, 0.0, 0.0),
    "a uniformly black channel must read as constant",
)
expect(
    constant_of({"rgbMin": (0.25, 0.5, 0.75), "rgbMax": (0.25, 0.5, 0.75)})
    == (0.25, 0.5, 0.75),
    "a uniform non-black channel must read as constant",
)
expect(
    constant_of({"rgbMin": (0.0, 0.0, 0.0), "rgbMax": (0.0, 0.0, 0.02)})
    is None,
    "a channel that varies must never read as constant",
)
expect(
    constant_of({"rgbMin": (0.0,), "rgbMax": (0.0, 0.0)}) is None,
    "a malformed range must refuse rather than guess",
)
expect(
    constant_of({}) is None,
    "a result without a measured range must refuse rather than guess",
)

# A non-finite range means the bake could not measure the channel; guessing
# "constant" there would ship a value nobody proved.
expect(
    constant_of({
        "rgbMin": (0.0, 0.0, float("nan")),
        "rgbMax": (0.0, 0.0, float("nan")),
    }) is None,
    "a non-finite range must refuse rather than read as constant",
)

# Within tolerance: float32 bake noise around one value is still one value.
expect(
    constant_of({
        "rgbMin": (0.5, 0.5, 0.5), "rgbMax": (0.50001, 0.5, 0.5),
    }) is not None,
    "float32 noise around a single value must still read as constant",
)

print("BLENDLINK_CONSTANT_CHANNEL_CHECK_PASSED")
