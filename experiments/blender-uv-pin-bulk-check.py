"""Verify Blender's non-deprecated bulk UV pin API stays warning-free."""

import bpy


mesh = bpy.data.meshes.new("Blendlink Pin Bulk Test")
mesh.from_pydata(
    [(0.0, 0.0, 0.0), (1.0, 0.0, 0.0), (1.0, 1.0, 0.0), (0.0, 1.0, 0.0)],
    [],
    [(0, 1, 2, 3)],
)
mesh.update()
layer = mesh.uv_layers.new(name="UVMap")
modern_pins = layer.pin
pin_count = len(modern_pins)
if pin_count == 0:
    # Blender 5.2 leaves the optional pin attribute absent until a pin exists.
    # Blender 4.2 exposes one default-false value per corner immediately.
    values = [False] * len(layer.data)
else:
    assert pin_count == len(layer.data)
    values = [False] * pin_count
    modern_pins.foreach_get("value", values)

assert len(values) == 4
assert not any(values)
print("BLENDLINK_PIN_BULK_CHECK_PASSED")
