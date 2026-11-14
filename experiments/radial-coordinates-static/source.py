# SPDX-License-Identifier: GPL-3.0-or-later
# blendlink-headless-suite: manual Requires coordinated nativeF32/material references, savedFinal publication and actual browser matrix.
"""Actual native static Radial source/2D policy and untouched saved Final graphs."""
import hashlib,json,os,sys,struct,array
from pathlib import Path
import bpy,gpu
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'packages/blender-addon'))
import tsl_ir,radial_coordinates_ir
assert Path(tsl_ir.__file__).resolve()==ROOT/'packages/blender-addon/tsl_ir.py'
OUT=Path(os.environ['SCENETOWEB_RADIAL_STATIC']).resolve();PLAN=json.loads((OUT/'plan.json').read_text());REFERENCE=json.loads((OUT/'native-f32/report.json').read_text());sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
files=sorted({Path(__file__),ROOT/'experiments/radial-coordinates-static/protocol.mjs',ROOT/'experiments/radial-regular-coordinates/cases.mjs',*(ROOT/'packages/blender-addon').glob('*.py'),*(ROOT/'packages/blender-addon').glob('*.json'),*(ROOT/'packages/blendlink/blender').glob('*.py')});sourceHashes={str(p.relative_to(ROOT)):sha(p)for p in files}
bpy.ops.wm.read_factory_settings(use_empty=True);scene=bpy.context.scene;scene.name='Artist Static Radial';scene.render.engine='BLENDER_EEVEE';scene.world=None;scene.render.resolution_x=8;scene.render.resolution_y=8;scene.render.resolution_percentage=100
camera_data=bpy.data.cameras.new('Artist Camera');camera_data.type='ORTHO';camera_data.ortho_scale=2;camera=bpy.data.objects.new(camera_data.name,camera_data);scene.collection.objects.link(camera);camera.location=(0,0,2);scene.camera=camera
mesh=bpy.data.meshes.new('Artist Plane');mesh.from_pydata([(-1,-1,0),(1,-1,0),(1,1,0),(-1,1,0)],[],[(0,1,2,3)]);owner=bpy.data.objects.new(mesh.name,mesh);scene.collection.objects.link(owner)
material=bpy.data.materials.new('Artist Radial Coordinates');material.use_nodes=True;owner.data.materials.append(material);tree=material.node_tree

def setup(spec,route='literal'):
 tree.nodes.clear();surface=tree.nodes.new('ShaderNodeBsdfPrincipled');output=tree.nodes.new('ShaderNodeOutputMaterial');tree.links.new(surface.outputs['BSDF'],output.inputs['Surface']);radial=tree.nodes.new('ShaderNodeRadialTiling');radial.normalize=spec['normalize'];radial.inputs['Sides'].default_value=spec['sides'];radial.inputs['Roundness'].default_value=1;radial.inputs['Vector'].default_value=spec['xy'];assert tuple(radial.inputs['Vector'].default_value)==tuple(spec['xy'])
 if route.startswith('group2'):
  radial.inputs['Vector'].default_value=(1.5,-1.5)
  group=bpy.data.node_groups.new('Actual3to2boundary','ShaderNodeTree');inc=group.interface.new_socket(name='V',in_out='INPUT',socket_type='NodeSocketVector');inc.dimensions=3;out=group.interface.new_socket(name='V',in_out='OUTPUT',socket_type='NodeSocketVector');out.dimensions=2;i=group.nodes.new('NodeGroupInput');o=group.nodes.new('NodeGroupOutput');group.links.new(i.outputs[0],o.inputs[0]);instance=tree.nodes.new('ShaderNodeGroup');instance.node_tree=group;instance.inputs[0].default_value=(*spec['xy'],9);source=instance.outputs[0]
  if route.endswith('reroute'):
   reroute=tree.nodes.new('NodeReroute');tree.links.new(source,reroute.inputs[0]);source=reroute.outputs[0]
  tree.links.new(source,radial.inputs['Vector'])
 tree.links.new(radial.outputs['Segment Coordinates'],surface.inputs['Base Color']);return radial,surface

def emit(surface):return tsl_ir.emit_channel(surface.inputs['Base Color'],evaluation_engine='EEVEE')
def refuse(name,change):
 radial,surface=setup(PLAN['cases'][0]);change(radial,surface)
 try:emit(surface)
 except tsl_ir.TslIrRefusal as error:return{'kind':name,'message':str(error)}
 raise AssertionError('UnqualifiedstaticRadialadmitted '+name)

def computed(radial,surface):
 node=tree.nodes.new('ShaderNodeMath');node.operation='ADD';node.inputs[0].default_value=1;node.inputs[1].default_value=2;tree.links.new(node.outputs[0],radial.inputs['Sides'])
def source_node(kind):
 def change(radial,surface):
  node=tree.nodes.new(kind)
  if kind=='ShaderNodeTexCoord':tree.links.new(node.outputs['Object'],radial.inputs['Vector'])
  else:
   image=bpy.data.images.new('Unsupporteddatafield',1,1,float_buffer=True);image.use_half_precision=False;image.colorspace_settings.name='Non-Color';image.pixels[:]=[.25,.5,0,1];node.image=image;node.interpolation='Closest';tree.links.new(node.outputs['Color'],radial.inputs['Vector'])
 return change
def raw_subnormal(radial,surface):
 values=array.array('f');values.frombytes(struct.pack('<2I',1,0));radial.inputs['Vector'].default_value.foreach_set(values)
refusals=[]
for name,change in [('sides4',lambda n,s:setattr(n.inputs['Sides'],'default_value',4)),('fractional',lambda n,s:setattr(n.inputs['Sides'],'default_value',3.5)),('roundness',lambda n,s:setattr(n.inputs['Roundness'],'default_value',.5)),('range',lambda n,s:setattr(n.inputs['Vector'],'default_value',(2.5,0))),('negative-zero',lambda n,s:setattr(n.inputs['Vector'],'default_value',(-0.,0))),('computed-sides',computed),('raw-subnormal',raw_subnormal),('Object',source_node('ShaderNodeTexCoord')),('imagefield',source_node('ShaderNodeTexImage')),('muted',lambda n,s:setattr(n,'mute',True)),('animated',lambda n,s:n.inputs['Sides'].keyframe_insert(data_path='default_value',frame=1))]:
 refusals.append(refuse(name,change));tree.animation_data_clear()
# Direct actualVECTOR3 scalar edges use the existing namedmeanrefusal;
# componentselection remains a valid scalar path.
for grouped in[False,True]:
 radial,surface=setup(PLAN['cases'][0]);tree.links.new(radial.outputs['Segment Coordinates'],surface.inputs['Roughness'])
 if grouped:
  group=bpy.data.node_groups.new('Native3Doutput','ShaderNodeTree');group.interface.new_socket(name='V',in_out='INPUT',socket_type='NodeSocketVector');group.interface.new_socket(name='V',in_out='OUTPUT',socket_type='NodeSocketVector');i=group.nodes.new('NodeGroupInput');o=group.nodes.new('NodeGroupOutput');group.links.new(i.outputs[0],o.inputs[0]);instance=tree.nodes.new('ShaderNodeGroup');instance.node_tree=group;tree.links.new(radial.outputs['Segment Coordinates'],instance.inputs[0]);tree.links.new(instance.outputs[0],surface.inputs['Roughness'])
 try:tsl_ir.emit_channel(surface.inputs['Roughness'],evaluation_engine='EEVEE')
 except tsl_ir.TslIrRefusal as error:refusals.append({'kind':'group-vector-scalar'if grouped else'direct-vector-scalar','message':str(error)});assert'component average'in str(error)
 else:raise AssertionError('Nativevector3scalarmeanwasnotrefused')
rows=[]
for spec in PLAN['cases']:
 radial,surface=setup(spec);ir=emit(surface);assert ir['output']['op']=='radial_segment_coordinates';reference=next(r for r in REFERENCE['rows']if r['case']==spec['case']);assert reference['inputWords']==spec['inputWords'];file=spec['case']+'.ir.json';(OUT/file).write_text(json.dumps(ir,indent=2)+'\n');rows.append({**spec,'irFile':file,'irSha256':sha(OUT/file),'expectedWords':[reference['rawOutputWords'][1],reference['rawOutputWords'][0],0,1065353216]})
finals=[]
for spec in PLAN['finals']:
 radial,surface=setup(spec,spec['route']);ir=emit(surface);file=spec['finalCase']+'.ir.json';(OUT/file).write_text(json.dumps(ir,indent=2)+'\n');path=OUT/spec['sourceFile'];bpy.ops.wm.save_as_mainfile(filepath=str(path));finals.append({**spec,'irFile':file,'irSha256':sha(OUT/file),'sourceSha256':sha(path),'expectedWords':next(r['expectedWords']for r in rows if r['case']==spec['case'])})
assert sourceHashes=={str(p.relative_to(ROOT)):sha(p)for p in files};gpu.init();backend={'backend':gpu.platform.backend_type_get(),'vendor':gpu.platform.vendor_get(),'renderer':gpu.platform.renderer_get()}
record={'status':'native-radial-coordinates-static-qualified','schemaVersion':1,'sourceBackend':backend,'nativeF32ReportSha256':sha(OUT/'native-f32/report.json'),'referenceModel':REFERENCE['model'],'referenceStage':REFERENCE['sourceStage'],'sourceHashes':sourceHashes,'cases':rows,'finals':finals,'refusals':refusals,'qualificationLimits':'StaticliteralXY only; reference is independentlyassembled unchangedGPUkernel plus separate actualEEVEE selectedcontrols; noimagefield/originaldemo orportablehardwareclaim.'};(OUT/'qualification.json').write_text(json.dumps(record,indent=2)+'\n');print('SCENETOWEB_RADIAL_STATIC_SOURCE_PASSED '+json.dumps({'cases':len(rows),'Finals':len(finals),'refusals':len(refusals)}))
