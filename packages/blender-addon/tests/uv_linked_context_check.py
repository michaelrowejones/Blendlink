# SPDX-License-Identifier: GPL-3.0-or-later
"""Pinned native UV islands use a valid, restored editor context on 4.2."""
from pathlib import Path
import sys
import bpy
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "blendlink/blender"))
import bakelib

bpy.ops.wm.read_factory_settings(use_empty=True)
mesh=bpy.data.meshes.new("Two native UV islands")
mesh.from_pydata([(0,0,0),(1,0,0),(1,1,0),(0,1,0),(2,0,0),(3,0,0),(3,1,0),(2,1,0)],[],[(0,1,2,3),(4,5,6,7)])
mesh.update();owner=bpy.data.objects.new("Pinned island owner",mesh);bpy.context.scene.collection.objects.link(owner)
layer=mesh.uv_layers.new(name=bakelib.ATLAS_UV)
coords=[(0,0),(.25,0),(.25,.25),(0,.25),(.5,0),(.75,0),(.75,.25),(.5,.25)]
for loop,uv in zip(layer.data,coords):loop.uv=uv
layer=bakelib.set_uv_layer_pin_mask(layer,[True]+[False]*7)
areas=lambda:[(area.as_pointer(),area.type,area.ui_type) for area in bpy.context.window.screen.areas]
before=areas();tools=(bpy.context.tool_settings.use_uv_select_sync,tuple(bpy.context.tool_settings.mesh_select_mode))
held=bakelib.average_unpinned([owner],bakelib.ATLAS_UV)
assert held=={owner.name:[True]*4+[False]*4},held
assert areas()==before,"Temporary UV editor changed the caller's area/subtype"
assert tools==(bpy.context.tool_settings.use_uv_select_sync,tuple(bpy.context.tool_settings.mesh_select_mode))
assert [tuple(loop.uv) for loop in mesh.uv_layers[bakelib.ATLAS_UV].data][:4]==coords[:4]
try:
    with bakelib._linked_uv_selection_context():raise RuntimeError("Injected UV operator failure")
except RuntimeError as error:assert str(error)=="Injected UV operator failure"
else:raise AssertionError("Injected operator error disappeared")
assert areas()==before,"Failure did not restore the caller's area/subtype"
print("BLENDLINK_UV_LINKED_CONTEXT_PASSED",bpy.app.version_string)
