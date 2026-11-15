# SPDX-License-Identifier: GPL-3.0-or-later
# blendlink-headless-suite: manual Matrix-owned admitted Displace scenes, no renders.
"""Save actual admitted native classes. No injected Image or replacement operation."""
from array import array
from pathlib import Path
import hashlib,json,struct,sys
import bpy,gpu
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'packages/blendlink/blender'))
import compositor_graph
OUT=Path(sys.argv[sys.argv.index('--')+1]).resolve()
CASES=json.loads(Path(__file__).with_name('cases.json').read_text())
blocked=[0]
def no_gpu(*args,**kwargs):
 blocked[0]+=1
 raise RuntimeError('Displace source generation forbids gpu.init')
gpu.init=no_gpu
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
rows=[]
for definition in CASES:
 bpy.ops.wm.read_factory_settings(use_empty=False)
 scene=bpy.context.scene
 scene.render.engine='CYCLES';scene.cycles.device='CPU';scene.cycles.samples=1
 scene.render.compositor_device='CPU';scene.render.compositor_precision='FULL'
 scene.render.resolution_x=13;scene.render.resolution_y=9;scene.render.resolution_percentage=100
 scene.render.use_compositing=True;scene.render.film_transparent=True
 scene.render.dither_intensity=0
 scene.view_settings.view_transform='Raw';scene.view_settings.look='None'
 scene.view_settings.exposure=0;scene.view_settings.gamma=1
 cube=bpy.data.objects['Cube'];cube.scale=(.7,.7,.7);cube.location.x=-.4
 material=bpy.data.materials.new('Owned Displace frame material');material.use_nodes=True
 bsdf=material.node_tree.nodes.get('Principled BSDF');bsdf.inputs['Base Color'].default_value=(.5,.125,.0625,1)
 bsdf.inputs['Roughness'].default_value=.5
 cube.data.materials.clear();cube.data.materials.append(material)
 bpy.ops.mesh.primitive_uv_sphere_add(segments=12,ring_count=8,radius=.65,location=(.7,0,.2))
 bpy.context.object.data.materials.append(material)
 camera=scene.camera;camera.location=(0,-5,2.5)
 camera.rotation_euler=((Vector((0,0,.1))-camera.location).to_track_quat('-Z','Y').to_euler());camera.data.lens=45
 tree=bpy.data.node_groups.new('Owned Displace compositor','CompositorNodeTree')
 tree.interface.new_socket(name='Image',in_out='OUTPUT',socket_type='NodeSocketColor')
 scene.compositing_node_group=tree;sink=tree.nodes.new('NodeGroupOutput')
 owner=tree;target=sink.inputs[0]
 if definition['layout']=='group':
  owner=bpy.data.node_groups.new('Owned nested Displace','CompositorNodeTree')
  owner.interface.new_socket(name='Image',in_out='OUTPUT',socket_type='NodeSocketColor')
  end=owner.nodes.new('NodeGroupOutput');target=end.inputs[0]
  instance=tree.nodes.new('CompositorNodeGroup');instance.node_tree=owner
  tree.links.new(instance.outputs[0],sink.inputs[0])
 node=owner.nodes.new('CompositorNodeDisplace')
 raw=array('f');raw.frombytes(struct.pack('=2I',*definition['displacementWords']))
 if not definition.get('nativeDefaults'):node.inputs['Displacement'].default_value.foreach_set(raw)
 actual=array('f',[0,0]);node.inputs['Displacement'].default_value.foreach_get(actual)
 assert actual.tobytes()==raw.tobytes()
 if not definition.get('nativeDefaults'):
  node.inputs['Interpolation'].default_value=definition['interpolation']
  for name in ('Extension X','Extension Y'):node.inputs[name].default_value='Clip'
 assert node.inputs['Interpolation'].default_value==definition['interpolation']
 assert all(node.inputs[name].default_value=='Clip'for name in ('Extension X','Extension Y'))
 if definition['source']=='render-layer':
  image=owner.nodes.new('CompositorNodeRLayers');image.layer=bpy.context.view_layer.name
  owner.links.new(image.outputs['Image'],node.inputs['Image'])
 else:
  color=array('f');color.frombytes(struct.pack('=4I',*definition['colorWords']))
  socket=node.inputs['Image']
  if definition['layout']=='rgb':
   rgb=owner.nodes.new('CompositorNodeRGB');socket=rgb.outputs[0];owner.links.new(socket,node.inputs['Image'])
  if not definition.get('nativeDefaults'):socket.default_value.foreach_set(color)
  actual=array('f',[0])*4;socket.default_value.foreach_get(actual);assert actual.tobytes()==color.tobytes()
 output=node.outputs['Image']
 if definition['layout']=='reroute':
  route=owner.nodes.new('NodeReroute');owner.links.new(output,route.inputs[0]);output=route.outputs[0]
 owner.links.new(output,target)
 for group in bpy.data.node_groups:
  for current in group.nodes:current.show_preview=False
 before=[(g.as_pointer(),g.users)for g in bpy.data.node_groups]
 program=compositor_graph.extract(scene)
 assert program['status']=='extracted',program
 assert before==[(g.as_pointer(),g.users)for g in bpy.data.node_groups]
 op=next(op for op in program['ops']if op['source']['nodeType']=='CompositorNodeDisplace')
 assert op['properties']['displace_words']==definition['displacementWords']
 assert op['properties']['displace_source_kind']==definition['source']
 assert node.bl_idname=='CompositorNodeDisplace'and not any(n.bl_idname=='CompositorNodeImage'for n in owner.nodes)
 path=OUT/(definition['case']+'.program.json');path.write_text(json.dumps(program,sort_keys=True,indent=2)+'\n')
 source=OUT/(definition['case']+'.blend');bpy.ops.wm.save_as_mainfile(filepath=str(source))
 rows.append({**definition,'sourceFile':source.name,'sourceSha256':sha(source),'programFile':path.name,'programSha256':sha(path)})
assert blocked==[0]
report={'status':'CAPTURED_DISPLACE_ADMITTED_SOURCES','version':list(bpy.app.version),'build':bpy.app.build_hash.decode(),'nativeRenders':0,'gpuInitializations':0,'rows':rows}
(OUT/'sources.json').write_text(json.dumps(report,indent=2)+'\n')
print(report['status'],len(rows))
