"""Observe native legacy RNA without rendering or changing artist resources."""
import bpy, json
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'packages/blendlink/blender'))
import bakelib, preparation_cache
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.mesh.primitive_cube_add()
mesh=bpy.context.object.data;layer=mesh.uv_layers.new(name=bakelib.ATLAS_UV)
def attrs():return [(a.name,a.data_type,a.domain) for a in mesh.attributes]
rows=[['before',attrs()]]
pins=layer.pin;rows.append(['pin-getter',len(pins),attrs()])
mask=bakelib._uv_layer_pin_mask(layer);rows.append(['pin-mask',mask,attrs()])
from array import array
values=array('f',[0])*(len(layer.data)*2);layer.data.foreach_get('uv',values)
preparation_cache._apply(layer,values,array('b',mask));rows.append(['cache-apply',attrs()])
group=bpy.data.node_groups.new('Capabilities','GeometryNodeTree')
curve=group.nodes.new('GeometryNodeCurveToMesh')
geo={'curveToMeshInputs':[(s.name,s.bl_idname) for s in curve.inputs]}
try:group.nodes.new('GeometryNodeGreasePencilToCurves');geo['greaseToCurves']=True
except RuntimeError as error:geo['greaseToCurves']=str(error)
print('LEGACY_NATIVE_CAPABILITIES',json.dumps({'version':bpy.app.version_string,'hash':bpy.app.build_hash.decode(),'uv':rows,'geometry':geo}))
