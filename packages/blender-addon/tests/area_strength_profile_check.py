# SPDX-License-Identifier: GPL-3.0-or-later
"""Source-qualified legacy Area strength; modern/malformed fields remain strict."""
from pathlib import Path
import sys
from types import SimpleNamespace
import bpy
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import weblights

bpy.ops.wm.read_factory_settings(use_empty=True)
scene=bpy.context.scene;scene.render.engine="BLENDER_EEVEE_NEXT" if bpy.app.version<(5,0,0) else "BLENDER_EEVEE"
data=bpy.data.lights.new("Native Area strength","AREA");data.shape="RECTANGLE";data.size=1;data.size_y=2;data.energy=40;data.use_shadow=False
owner=bpy.data.objects.new("Native Area strength",data);scene.collection.objects.link(owner)
owner[weblights.AREA_LIGHT_MODE_PROPERTY]=weblights.AREA_LIGHT_MODE_THREE_RECT
if hasattr(data,"normalize"):data.normalize=True;data.exposure=0
before=(data.energy,data.size,data.size_y,tuple(owner.matrix_world))
plan=weblights.plan_rect_area_light(owner,scene,source_version=bpy.app.version[:3])
assert not plan.refusals and plan.descriptor is not None,plan
assert plan.descriptor.power==40 and plan.descriptor.intensity is None,plan
assert before==(data.energy,data.size,data.size_y,tuple(owner.matrix_world))
if bpy.app.version[:3]==(4,2,0):
    assert not hasattr(data,"normalize") and not hasattr(data,"exposure")
    for version in [None,(4,2,1),(5,2,0),(5,3,0),(99,0,0)]:
        blocked=weblights.plan_rect_area_light(owner,scene,source_version=version)
        assert blocked.descriptor is None and {item.code for item in blocked.refusals}>={"rect-area-normalize-invalid","rect-area-exposure-invalid"},blocked
missing=SimpleNamespace()
assert weblights._area_strength_settings(missing,(4,2,0))==(0,True)
assert weblights._area_strength_settings(SimpleNamespace(exposure=None,normalize=True),(4,2,0))==(None,True)
assert weblights._area_strength_settings(SimpleNamespace(exposure=2,normalize=False),(4,2,0))==(2,False)
print("BLENDLINK_AREA_STRENGTH_PROFILE_PASSED",bpy.app.version_string)
