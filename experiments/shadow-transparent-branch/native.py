# SPDX-License-Identifier: GPL-3.0-or-later
"""Real EEVEE shadow-pass positive/control/negative and installed Final fixture."""
import hashlib
import json
import math
from pathlib import Path
import sys
import subprocess
import numpy as np
import bpy
import gpu

root = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(root/'packages/blendlink/blender'),str(root/'packages/blender-addon')]
import export_scene as exporter

out = Path(sys.argv[sys.argv.index('--')+1]).resolve()
glass = '--glass' in sys.argv
source_glass = '--source-glass' in sys.argv
out.mkdir()
(out/'producer.py').write_bytes(Path(__file__).read_bytes())
source_record = None
if source_glass:
    source_path=Path(bpy.data.filepath)
    source_hash=hashlib.sha256(source_path.read_bytes()).hexdigest()
    assert source_hash=='9f636b2e1a59b3d181f90caf1b1703658eeadebad57f3c6207737d2fe3ffd85e'
    authored_glass=bpy.data.materials['Glass'].copy()
    # Full file loading performs legacy scene-engine conversion. Material-only
    # library append omits the converted EEVEE branch, so cannot be this oracle.
    source_record={'path':str(source_path),'sha256':source_hash,'material':'Glass','load':'full-original-file'}
    bpy.context.window.scene=bpy.data.scenes.new('Original Glass Control')
    for obj in list(bpy.data.objects): bpy.data.objects.remove(obj,do_unlink=True)
    for old_scene in list(bpy.data.scenes):
        if old_scene!=bpy.context.scene: bpy.data.scenes.remove(old_scene)
    bpy.context.scene.world=bpy.data.worlds.new('Controlled Black World')
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
scene=bpy.context.scene;scene.render.engine='BLENDER_EEVEE'
scene.render.resolution_x=scene.render.resolution_y=128;scene.render.resolution_percentage=100
scene.eevee.taa_render_samples=64
scene.view_settings.view_transform='Standard'
scene.world.use_nodes=True;scene.world.node_tree.nodes.get('Background').inputs['Strength'].default_value=0
bpy.ops.mesh.primitive_plane_add(size=30)
floor=bpy.context.object;floor.name='Receiver'
ground=bpy.data.materials.new('Receiver Material');ground.use_nodes=True
ground.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value=(.5,.5,.5,1)
ground.node_tree.nodes.get('Principled BSDF').inputs['Roughness'].default_value=1
floor.data.materials.append(ground)
bpy.ops.mesh.primitive_plane_add(size=1.5,location=(4,0,4))
caster=bpy.context.object;caster.name='Offscreen Caster'
mat=bpy.data.materials.new('White Shadow Branch');mat.use_nodes=True
tree=mat.node_tree;tree.nodes.clear()
output=tree.nodes.new('ShaderNodeOutputMaterial');output.target='EEVEE'
opaque=tree.nodes.new('ShaderNodeBsdfPrincipled');opaque.inputs['Roughness'].default_value=1
transparent=tree.nodes.new('ShaderNodeBsdfTransparent')
primary=opaque.outputs[0]
if glass:
    # Same authored closure shape and Float32 mix factor as original Archviz
    # Glass; not a full-scene BRDF/lighting equivalence claim.
    opaque.inputs['Metallic'].default_value=1
    visible_mix=tree.nodes.new('ShaderNodeMixShader')
    visible_mix.inputs[0].default_value=0.949999988079071
    tree.links.new(opaque.outputs[0],visible_mix.inputs[1]);tree.links.new(transparent.outputs[0],visible_mix.inputs[2])
    primary=visible_mix.outputs[0]
cycles=tree.nodes.new('ShaderNodeOutputMaterial');cycles.target='CYCLES';tree.links.new(primary,cycles.inputs['Surface'])
mix=tree.nodes.new('ShaderNodeMixShader');ray=tree.nodes.new('ShaderNodeLightPath')
tree.links.new(primary,mix.inputs[1]);tree.links.new(transparent.outputs[0],mix.inputs[2]);tree.links.new(ray.outputs['Is Shadow Ray'],mix.inputs[0]);tree.links.new(mix.outputs[0],output.inputs['Surface'])
if source_glass:
    bpy.data.materials.remove(mat)
    mat=authored_glass;mat.name='White Shadow Branch';tree=mat.node_tree
    output=tree.get_output_node('EEVEE')
    mix=output.inputs['Surface'].links[0].from_node
    transparent=mix.inputs[2].links[0].from_node
    opaque=tree.nodes['Metallic']
    assert mix.inputs[0].links[0].from_socket.identifier=='Is Shadow Ray'
    assert mix.inputs[1].links[0].from_node==tree.get_output_node('CYCLES').inputs['Surface'].links[0].from_node
    assert mix.inputs[1].links[0].from_node.inputs[0].default_value==0.949999988079071
caster.data.materials.append(mat)
bpy.ops.object.light_add(type='SUN',rotation=(0,math.pi/4,0))
sun=bpy.context.object;sun.name='Shadow Test Sun';sun.data.energy=2;sun.data.angle=0
bpy.ops.object.camera_add(location=(0,0,6))
camera=bpy.context.object;camera.name='Shadow Test Camera';camera.data.type='ORTHO';camera.data.ortho_scale=6;camera.data.clip_end=50;scene.camera=camera
rows=[]
for name,socket in [('shadow-branch',mix.outputs[0]),('transparent-control',transparent.outputs[0]),('opaque-negative',opaque.outputs[0])]:
    tree.links.new(socket,output.inputs['Surface'])
    bpy.ops.render.render()
    path=out/(name+'.png');scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGBA';bpy.data.images['Render Result'].save_render(str(path),scene=scene)
    image=bpy.data.images.load(str(path),check_existing=False);raw=np.empty(128*128*4,dtype=np.float32);image.pixels.foreach_get(raw);bpy.data.images.remove(image)
    binary=out/(name+'.f32');binary.write_bytes(raw.astype('<f4').tobytes())
    rows.append({'id':name,'file':binary.name,'sha256':hashlib.sha256(binary.read_bytes()).hexdigest(),'png':path.name})
tree.links.new(mix.outputs[0],output.inputs['Surface'])
a=np.frombuffer((out/rows[0]['file']).read_bytes(),dtype='<f4');b=np.frombuffer((out/rows[1]['file']).read_bytes(),dtype='<f4');c=np.frombuffer((out/rows[2]['file']).read_bytes(),dtype='<f4')
report={'status':'CAPTURED_NOT_QUALIFIED','native':{'version':bpy.app.version_string,'build':bpy.app.build_hash.decode()},'source':{'engine':scene.render.engine,'dimensions':[128,128],'samples':64,'casterOutsideCamera':True},'rows':rows,'shadowVsTransparentDifferentWords':int(np.count_nonzero(a.view(np.uint32)!=b.view(np.uint32))),'opaqueVsTransparentDifferentWords':int(np.count_nonzero(c.view(np.uint32)!=b.view(np.uint32))),'supportCredit':0}
settings=out/'settings.json';settings.write_text(json.dumps({'automaticMaterials':True}))
sys.argv=['export_scene.py','--',str(out/'shadow.glb'),str(settings),str(out/'final.json')]
exporter.main()
report['finalGlbSha256']=hashlib.sha256((out/'shadow.glb').read_bytes()).hexdigest();report['producerSha256']=hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
report['fixture']='original-archviz-glass' if source_glass else 'archviz-glass-closure-shape' if glass else 'opaque-primary'
report['expectedVisibleAlpha']=1.0-0.949999988079071 if glass or source_glass else 1.0
if source_record:
    assert hashlib.sha256(source_path.read_bytes()).hexdigest()==source_hash
    report['originalSource']=source_record
report['sourceCommit']=subprocess.check_output(['git','-C',str(root),'rev-parse','HEAD'],text=True).strip()
report['trackedSourceClean']=not subprocess.check_output(['git','-C',str(root),'status','--porcelain','--untracked-files=no'],text=True).strip()
report['native']['gpuBackend']=bpy.context.preferences.system.gpu_backend
report['native']['actualGpu']={name:getattr(gpu.platform,name+'_get')() for name in ['backend_type','vendor','renderer','version']}
report['sourceHashes']={str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest() for p in [root/'packages/blender-addon/tsl_ir.py',root/'packages/blender-addon/shadow_branch_ir.py',root/'packages/blender-addon/material_compiler.py']}
(out/'report.json').write_text(json.dumps(report,indent=2)+'\n')
assert report['shadowVsTransparentDifferentWords']==0,report
assert report['opaqueVsTransparentDifferentWords']>100,report
print('SCENETOWEB_NATIVE_SHADOW_BRANCH_CAPTURED '+json.dumps(report),flush=True)
