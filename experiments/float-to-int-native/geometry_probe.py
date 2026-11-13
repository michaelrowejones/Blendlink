# SPDX-License-Identifier: GPL-3.0-or-later
"""Native MF integer readback on actual Geometry fields, not compositor support."""
import bpy,hashlib,json,os,sys
import numpy as np
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent))
from values import controls,json_controls
bpy.ops.wm.read_factory_settings(use_empty=True)
items=controls();mesh=bpy.data.meshes.new('Actual Float32 inputs');mesh.from_pydata([(float(index),0,0) for index in range(len(items))],[],[])
values=mesh.attributes.new('Source float words','FLOAT','POINT');requested=np.asarray([int(item['word'],16) for item in items],np.uint32).view(np.float32)
values.data.foreach_set('value',requested)
def source_words():
 storage=np.empty(len(items),np.float32);values.data.foreach_get('value',storage)
 return [f'{int(value):08x}' for value in storage.view(np.uint32)]
assert source_words()==[item['word'] for item in items],'Native source Float32 words changed'
owner=bpy.data.objects.new('Actual MF evaluation',mesh);bpy.context.scene.collection.objects.link(owner)
modifier=owner.modifiers.new('Native Float to Integer MF','NODES')
group=bpy.data.node_groups.new('MF Float to Integer','GeometryNodeTree');modifier.node_group=group
group.interface.new_socket(name='Geometry',in_out='INPUT',socket_type='NodeSocketGeometry');group.interface.new_socket(name='Geometry',in_out='OUTPUT',socket_type='NodeSocketGeometry')
incoming=group.nodes.new('NodeGroupInput');outgoing=group.nodes.new('NodeGroupOutput')
attribute=group.nodes.new('GeometryNodeInputNamedAttribute');attribute.data_type='FLOAT';attribute.inputs['Name'].default_value='Source float words'
convert=group.nodes.new('FunctionNodeFloatToInt');store=group.nodes.new('GeometryNodeStoreNamedAttribute');store.domain='POINT';store.data_type='INT';store.inputs['Name'].default_value='Actual integer result'
group.links.new(incoming.outputs['Geometry'],store.inputs['Geometry']);group.links.new(attribute.outputs['Attribute'],convert.inputs['Float']);group.links.new(convert.outputs['Integer'],store.inputs['Value']);group.links.new(store.outputs['Geometry'],outgoing.inputs['Geometry'])
rows=[]
for mode in ['ROUND','FLOOR','CEILING','TRUNCATE']:
 convert.rounding_mode=mode;bpy.context.view_layer.update();evaluated=owner.evaluated_get(bpy.context.evaluated_depsgraph_get());actual=evaluated.to_mesh()
 try:rows.append({'mode':mode,'integerResults':[item.value for item in actual.attributes['Actual integer result'].data]})
 finally:evaluated.to_mesh_clear()
report={'version':list(bpy.app.version),'build':bpy.app.build_hash.decode(),'context':'GeometryNodeTree evaluated POINT attribute via native MF; no compositor availability or GPU claim','fixtureSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'valuesSha256':hashlib.sha256((Path(__file__).parent/'values.py').read_bytes()).hexdigest(),'controls':json_controls(),'rows':rows,'sourcePreserved':source_words()==[item['word'] for item in items]}
output=Path(os.environ['BLENDLINK_FLOAT_TO_INT_GEOMETRY']);output.parent.mkdir(parents=True,exist_ok=True);output.write_text(json.dumps(report,indent=2)+'\n');print('BLENDLINK_FLOAT_TO_INT_GEOMETRY_CAPTURED',len(items),len(rows))
