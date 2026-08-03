# SPDX-License-Identifier: GPL-3.0-or-later
"""Headless contract check for the scoped UV editing seam.

Every ``bpy.ops.uv.*`` primitive in bakelib runs inside
``scoped_uv_edit``. Its contract used to be nine partial re-statements
whose only proof was a full atlas bake; these assertions state it
directly. Each case here corresponds to a hazard measured on Blender 5.2:
sync mode deciding what the operand is, stale per-loop UV flags moving
islands nobody selected, select-mode flushing widening a face scope, and
Blender state surviving a failing body.
"""
import importlib.util
import sys
from pathlib import Path

import bpy


BLENDER_DIR = Path(__file__).resolve().parents[1].parent / "blendlink" / "blender"


def expect(condition, message):
    if not condition:
        raise AssertionError(message)


spec = importlib.util.spec_from_file_location(
    "blendlink_scoped_uv_bakelib", BLENDER_DIR / "bakelib.py",
)
bakelib = importlib.util.module_from_spec(spec)
sys.modules["blendlink_scoped_uv_bakelib"] = bakelib
spec.loader.exec_module(bakelib)

bpy.ops.wm.read_factory_settings(use_empty=True)


def make_grid(name, count_side=3, quad=0.4):
    """Disjoint quads, each its own island, with distinct authored UVs."""
    vertices, faces = [], []
    for row in range(count_side):
        for column in range(count_side):
            base = len(vertices)
            x0, y0 = column * 1.0, row * 1.0
            vertices.extend([
                (x0, y0, 0), (x0 + quad, y0, 0),
                (x0 + quad, y0 + quad, 0), (x0, y0 + quad, 0),
            ])
            faces.append((base, base + 1, base + 2, base + 3))
    mesh = bpy.data.meshes.new(name + " Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    uv = mesh.uv_layers.new(name=bakelib.ATLAS_UV)
    for index, polygon in enumerate(mesh.polygons):
        # Each island gets a distinct, well-separated square so any
        # unintended movement is unmistakable.
        u0 = (index % 3) * 0.3
        v0 = (index // 3) * 0.3
        for loop_index, (du, dv) in zip(
                polygon.loop_indices,
                ((0.0, 0.0), (0.2, 0.0), (0.2, 0.2), (0.0, 0.2))):
            uv.data[loop_index].uv = (u0 + du, v0 + dv)
    mesh.uv_layers.active = uv
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def uvs_of(obj, polygon_index):
    layer = obj.data.uv_layers.get(bakelib.ATLAS_UV)
    return [
        tuple(layer.data[i].uv)
        for i in obj.data.polygons[polygon_index].loop_indices
    ]


# --- The scope holds under BOTH sync modes -----------------------------
# Sync decides what the operand is: with sync ON the mesh selection is the
# operand and uv.select_all(SELECT) would re-select the whole mesh; with
# sync OFF stale per-loop UV flags would move unselected islands.
for sync_mode in (True, False):
    obj = make_grid(f"Scope {sync_mode}")
    bpy.context.scene.tool_settings.use_uv_select_sync = sync_mode

    # Dirty the state exactly the way production does before a scoped op:
    # everything selected, in both spaces.
    bakelib.select_only([obj])
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.select_all(action="SELECT")
    bpy.ops.object.mode_set(mode="OBJECT")

    kept_before = [uvs_of(obj, i) for i in range(1, 9)]
    with bakelib.scoped_uv_edit([obj], bakelib.ATLAS_UV, faces=[0]):
        bpy.ops.uv.smart_project(angle_limit=1.15, island_margin=0.0,
                                 scale_to_bounds=False)
    kept_after = [uvs_of(obj, i) for i in range(1, 9)]
    expect(
        kept_after == kept_before,
        f"sync={sync_mode}: a face-scoped UV operation moved islands "
        "outside its scope",
    )
    expect(
        uvs_of(obj, 0) != kept_before[0],
        f"sync={sync_mode}: the face-scoped UV operation did not reach its "
        "own scope",
    )
    bpy.data.objects.remove(obj, do_unlink=True)


# --- Blender state is restored, including after a failing body ---------
obj = make_grid("Restore")
bpy.context.scene.tool_settings.use_uv_select_sync = True
bpy.context.scene.tool_settings.mesh_select_mode = (True, False, False)
prior_sync = bpy.context.scene.tool_settings.use_uv_select_sync
prior_mode = tuple(bpy.context.scene.tool_settings.mesh_select_mode)


class ProbeError(RuntimeError):
    pass


try:
    with bakelib.scoped_uv_edit([obj], bakelib.ATLAS_UV, sync=False, faces=[0]):
        raise ProbeError("induced")
except ProbeError:
    pass
else:
    raise AssertionError("scoped_uv_edit swallowed the body's exception")

expect(bpy.context.mode == "OBJECT",
       f"scoped_uv_edit left Blender in {bpy.context.mode} after a failure")
expect(
    bpy.context.scene.tool_settings.use_uv_select_sync == prior_sync,
    "scoped_uv_edit did not restore use_uv_select_sync after a failure",
)
expect(
    tuple(bpy.context.scene.tool_settings.mesh_select_mode) == prior_mode,
    "scoped_uv_edit did not restore mesh_select_mode after a failure",
)
bpy.data.objects.remove(obj, do_unlink=True)


# --- Face scoping refuses a shape it cannot honor ----------------------
first = make_grid("Multi A")
second = make_grid("Multi B")
try:
    with bakelib.scoped_uv_edit(
            [first, second], bakelib.ATLAS_UV, faces=[0]):
        pass
except RuntimeError as error:
    expect("exactly one object" in str(error),
           f"unexpected refusal for multi-object face scoping: {error}")
else:
    raise AssertionError(
        "face-scoped UV editing accepted more than one object")
expect(bpy.context.mode == "OBJECT",
       "a refused face scope left Blender in Edit Mode")
bpy.data.objects.remove(first, do_unlink=True)
bpy.data.objects.remove(second, do_unlink=True)

print("BLENDLINK_SCOPED_UV_EDIT_CHECK_PASSED")
