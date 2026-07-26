"""Verify saved bake bytes through Blender's image decoder."""
import sys

import bpy

paths = sys.argv[sys.argv.index("--") + 1:]
if len(paths) != 2:
    raise SystemExit("expected lit.png dark.png")


def inspect(path):
    image = bpy.data.images.load(path, check_existing=False)
    pixels = list(image.pixels)
    width, height = image.size
    corners = []
    for x, y in ((0, 0), (width - 1, 0), (0, height - 1), (width - 1, height - 1)):
        offset = (y * width + x) * 4
        corners.append(tuple(pixels[offset:offset + 4]))
    spread = max(abs(channel - corners[0][index])
                 for corner in corners[1:] for index, channel in enumerate(corner))
    if spread > 1 / 255 + 1e-5:
        raise AssertionError(f"{path}: unbaked corner background is not constant (spread {spread})")
    return pixels


lit = inspect(paths[0])
dark = inspect(paths[1])
delta = sum(abs(a - b) for a, b in zip(lit, dark)) / len(lit)
if delta < 1e-4:
    raise AssertionError(f"lighting states do not visibly differ (mean delta {delta})")
print("BLENDLINK_BAKED_E2E_IMAGES_PASSED", delta)
