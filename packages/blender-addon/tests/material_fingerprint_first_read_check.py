# SPDX-License-Identifier: GPL-3.0-or-later
"""A virgin owner's first fingerprint is stable without weakening invalidation."""
import sys
from pathlib import Path
import bpy

addon=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(addon));sys.path.insert(0,str(addon.parent/'blendlink/blender'))
import material_compiler

bpy.ops.wm.read_factory_settings(use_empty=True)
mesh=bpy.data.meshes.new('Fingerprint untouched source')
mesh.from_pydata([(0,0,0),(1,0,0),(0,1,0)],[],[(0,1,2)]);mesh.update()
owner=bpy.data.objects.new('Virgin fingerprint owner',mesh)
bpy.context.scene.collection.objects.link(owner)
bpy.context.scene.render.engine='CYCLES';bpy.context.view_layer.update()

# Do not access owner.cycles or warm the plan before this first hash. In4.2
# the getter itself creates the empty registered IDPropertyGroup. Hashing
# obj.items() before that getter previously changed the second hash.
if bpy.app.version<(5,0):assert 'cycles' not in owner.keys()
first=material_compiler._materialized_binding_hash(owner)
second=material_compiler._materialized_binding_hash(owner)
assert first==second,(first,second)

cycles=owner.cycles
key=next((key for key in ('shadow_terminator_offset','ao_distance','dicing_rate') if hasattr(cycles,key)),None)
assert key is not None,'Native Cycles contributor needs a measured scalar setting'
old=getattr(cycles,key);setattr(cycles,key,.25 if old!=.25 else .5)
changed=material_compiler._materialized_binding_hash(owner)
assert changed!=first,'Actual Cycles scalar mutation failed to invalidate the fingerprint'
assert material_compiler._materialized_binding_hash(owner)==changed

owner['artist_parameter']=.25
custom=material_compiler._materialized_binding_hash(owner)
assert custom!=changed,'Artist custom-property addition failed to invalidate'
owner['artist_parameter']=.5
assert material_compiler._materialized_binding_hash(owner)!=custom,'Artist custom-property mutation failed to invalidate'
print('BLENDLINK_MATERIAL_FINGERPRINT_FIRST_READ_PASSED '+bpy.app.version_string)
