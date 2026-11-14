# SPDX-License-Identifier: GPL-3.0-or-later
# blendlink-headless-suite: manual Matrix owns actual native material references, saved Final publication and all API proofs.
"""Native origin source policy: emission must not initialize or query the GPU."""
import array,hashlib,json,os,struct,sys
from pathlib import Path
import bpy,gpu
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'packages/blender-addon'));import tsl_ir
OUT=Path(os.environ['SCENETOWEB_RADIAL_ORIGIN']).resolve();PLAN=json.loads((OUT/'plan.json').read_text());sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
files=sorted({Path(__file__),ROOT/'experiments/radial-origin/protocol.mjs',*(ROOT/'packages/blender-addon').glob('*.py'),*(ROOT/'packages/blender-addon').glob('*.json'),*(ROOT/'packages/blendlink/blender').glob('*.py')});pins={str(p.relative_to(ROOT)):sha(p)for p in files}
bpy.ops.wm.read_factory_settings(use_empty=True);scene=bpy.context.scene;scene.render.engine='BLENDER_EEVEE';scene.world=None;scene.render.resolution_x=8;scene.render.resolution_y=8;scene.render.resolution_percentage=100
camera_data=bpy.data.cameras.new('Origin Camera');camera_data.type='ORTHO';camera_data.ortho_scale=2;camera=bpy.data.objects.new(camera_data.name,camera_data);scene.collection.objects.link(camera);camera.location=(0,0,2);scene.camera=camera
mesh=bpy.data.meshes.new('Origin Plane');mesh.from_pydata([(-1,-1,0),(1,-1,0),(1,1,0),(-1,1,0)],[],[(0,1,2,3)]);owner=bpy.data.objects.new(mesh.name,mesh);scene.collection.objects.link(owner);material=bpy.data.materials.new('Artist Radial Coordinates');material.use_nodes=True;owner.data.materials.append(material);tree=material.node_tree
calls=[];originals={'init':gpu.init,'backend':gpu.platform.backend_type_get,'vendor':gpu.platform.vendor_get,'renderer':gpu.platform.renderer_get}
def forbidden_gpu():calls.append('init');raise RuntimeError('Origin emission queried GPU')
gpu.init=forbidden_gpu;gpu.platform.backend_type_get=forbidden_gpu;gpu.platform.vendor_get=forbidden_gpu;gpu.platform.renderer_get=forbidden_gpu

def setup(spec):
 tree.nodes.clear();surface=tree.nodes.new('ShaderNodeBsdfPrincipled');output=tree.nodes.new('ShaderNodeOutputMaterial');tree.links.new(surface.outputs[0],output.inputs['Surface']);radial=tree.nodes.new('ShaderNodeRadialTiling');radial.normalize=spec['normalize'];radial.inputs['Sides'].default_value=spec['sides'];radial.inputs['Roundness'].default_value=1;radial.inputs['Vector'].default_value=(0,0)
 source=None
 if spec['route'].startswith('group2'):
  radial.inputs['Vector'].default_value=(1.5,-1.5);group=bpy.data.node_groups.new('Origin3to2','ShaderNodeTree');a=group.interface.new_socket(name='V',in_out='INPUT',socket_type='NodeSocketVector');a.dimensions=3;b=group.interface.new_socket(name='V',in_out='OUTPUT',socket_type='NodeSocketVector');b.dimensions=2;i=group.nodes.new('NodeGroupInput');o=group.nodes.new('NodeGroupOutput');group.links.new(i.outputs[0],o.inputs[0]);instance=tree.nodes.new('ShaderNodeGroup');instance.node_tree=group;instance.inputs[0].default_value=(0,0,9);source=instance.outputs[0]
 elif spec['route']=='reroute':
  literal=tree.nodes.new('FunctionNodeInputVector');literal.vector=(0,0,9);source=literal.outputs[0]
 if spec['route'].endswith('reroute')or spec['route']=='reroute':
  reroute=tree.nodes.new('NodeReroute');tree.links.new(source,reroute.inputs[0]);source=reroute.outputs[0]
 if source is not None:tree.links.new(source,radial.inputs['Vector'])
 tree.links.new(radial.outputs['Segment Coordinates'],surface.inputs['Base Color']);return radial,surface

def emit(surface):return tsl_ir.emit_channel(surface.inputs['Base Color'],evaluation_engine='EEVEE')
def setwords(radial,words):
 values=array.array('f');values.frombytes(struct.pack('<2I',*words));radial.inputs['Vector'].default_value.foreach_set(values)
refusals=[]
for name,change in [('negative-zero',lambda n,s:setwords(n,[0x80000000,0])),('subnormal',lambda n,s:setwords(n,[1,0])),('sides4',lambda n,s:setattr(n.inputs['Sides'],'default_value',4)),('roundness',lambda n,s:setattr(n.inputs['Roundness'],'default_value',.5)),('animated',lambda n,s:n.inputs['Sides'].keyframe_insert(data_path='default_value',frame=1)),('muted',lambda n,s:setattr(n,'mute',True))]:
 radial,surface=setup({**PLAN['finals'][0],'route':'literal'});change(radial,surface)
 try:emit(surface)
 except tsl_ir.TslIrRefusal as error:refusals.append({'kind':name,'message':str(error)})
 else:raise AssertionError('Unqualified origin input admitted '+name)
 tree.animation_data_clear()
# Vector3 origin folding must not erase source link-conversion refusal.
for grouped in[False,True]:
 radial,surface=setup({**PLAN['finals'][0],'route':'literal'});source=radial.outputs['Segment Coordinates']
 if grouped:
  group=bpy.data.node_groups.new('OriginOutput3','ShaderNodeTree');group.interface.new_socket(name='V',in_out='INPUT',socket_type='NodeSocketVector');group.interface.new_socket(name='V',in_out='OUTPUT',socket_type='NodeSocketVector');i=group.nodes.new('NodeGroupInput');o=group.nodes.new('NodeGroupOutput');group.links.new(i.outputs[0],o.inputs[0]);instance=tree.nodes.new('ShaderNodeGroup');instance.node_tree=group;tree.links.new(source,instance.inputs[0]);source=instance.outputs[0]
 tree.links.new(source,surface.inputs['Roughness'])
 try:tsl_ir.emit_channel(surface.inputs['Roughness'],evaluation_engine='EEVEE')
 except tsl_ir.TslIrRefusal as error:assert'component average'in str(error);refusals.append({'kind':'group-mean'if grouped else'direct-mean','message':str(error)})
 else:raise AssertionError('Origin vector mean incorrectly admitted')
rows=[]
try:
 for spec in PLAN['finals']:
  radial,surface=setup(spec);raw=emit(surface);assert raw['output']=={'op':'const_vec3','value':spec['rawTuple']};raw_file=spec['case']+'.raw.json';(OUT/raw_file).write_text(json.dumps(raw,indent=2)+'\n')
  # Independent reversible positive carrier preserves raw radius -1 without
  # requiring a negative glTF material factor. It does not change Radial inputs.
  add=tree.nodes.new('ShaderNodeVectorMath');add.operation='ADD';tree.links.new(radial.outputs['Segment Coordinates'],add.inputs[0]);add.inputs[1].default_value=(0,1,0);tree.links.new(add.outputs['Vector'],surface.inputs['Base Color']);carrier=emit(surface);assert'radial_segment_coordinates'not in json.dumps(carrier);file=spec['case']+'.ir.json';(OUT/file).write_text(json.dumps(carrier,indent=2)+'\n');source=OUT/spec['sourceFile'];bpy.ops.wm.save_as_mainfile(filepath=str(source))
  rows.append({**spec,'irFile':raw_file,'irSha256':sha(OUT/raw_file),'carrierIrFile':file,'carrierIrSha256':sha(OUT/file),'sourceSha256':sha(source),'expectedWords':list(struct.unpack('<4I',struct.pack('<4f',*spec['rawTuple'],1))),'carrierWords':list(struct.unpack('<4I',struct.pack('<4f',*spec['carrierTuple'],1)))})
 assert calls==[]
finally:
 gpu.init=originals['init'];gpu.platform.backend_type_get=originals['backend'];gpu.platform.vendor_get=originals['vendor'];gpu.platform.renderer_get=originals['renderer']
assert pins=={str(p.relative_to(ROOT)):sha(p)for p in files}
report={'schemaVersion':1,'status':'native-radial-origin-qualified','cases':rows,'finals':rows,'refusals':refusals,'sourceHashes':pins,'gpuCallsDuringEmission':len(calls),'sourceVersion':list(bpy.app.version),'sourceBuild':bpy.app.build_hash.decode(),'constantModel':'source-proven regular/full-roundness exact-positive-zero origin','noGeneralSceneAcceptance':True};(OUT/'qualification.json').write_text(json.dumps(report,indent=2)+'\n');print('RADIAL_ORIGIN_SOURCE_READY '+json.dumps({'cases':len(rows),'refusals':len(refusals),'gpuCalls':len(calls)}))
