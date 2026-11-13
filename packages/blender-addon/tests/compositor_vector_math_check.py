# SPDX-License-Identifier: GPL-3.0-or-later
# blendlink-headless-suite: manual Requires matrix-owned references and actual saved Final/browser proofs.
"""Fresh native CPU/Metal compositor Vector Math exact-word literal output proofs."""
import hashlib
import json
import os
from pathlib import Path
import sys
import bpy
import numpy as np
ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT/'packages/blendlink/blender'))
sys.path.insert(0,str(ROOT/'packages/blender-addon/tests'))
sys.path.insert(0,str(ROOT/'experiments/compositor-vector-math'))
import compositor_graph
import compositor_vector_math as helper
from compositor_reference import NativeCompositorReference
from cases import signatures
DEVICE=os.environ.get('SCENETOWEB_VECTOR_MATH_DEVICE','CPU')
DESTINATION=Path(os.environ['SCENETOWEB_VECTOR_MATH_REFERENCES']).resolve()
DESTINATION.mkdir(parents=True,exist_ok=True)
sha=lambda path:hashlib.sha256(Path(path).read_bytes()).hexdigest()
assert tuple(bpy.app.version)==(5,3,0) and bpy.app.build_hash==b'02f0899d78e3' and sys.platform=='darwin'
oracle=NativeCompositorReference(DESTINATION,device=DEVICE,name='Artist Vector Math',image_only_scene=True)
scene,tree=oracle.scene,oracle.tree
scene.render.engine='BLENDER_EEVEE';scene.world=None

def reset():
    tree.nodes.clear()
    return tree.nodes.new('NodeGroupOutput')

def vector(target,coords):
    node=target.nodes.new('FunctionNodeInputVector');node.vector=coords
    return node.outputs['Vector']

def setup(spec):
    sink=reset();target=tree
    if spec['route']=='group':
        group=bpy.data.node_groups.new('Artist Vector Arithmetic','CompositorNodeTree')
        group.interface.new_socket(name='Vector',in_out='INPUT',socket_type='NodeSocketVector')
        group.interface.new_socket(name='Vector',in_out='OUTPUT',socket_type='NodeSocketVector')
        group_in=group.nodes.new('NodeGroupInput');group_out=group.nodes.new('NodeGroupOutput');target=group
    node=target.nodes.new('ShaderNodeVectorMath');node.operation=spec['mode']
    for key in helper.input_names(spec['mode']):node.inputs[key].default_value={'Vector':spec['a'],'Vector_001':spec['b'],'Vector_002':spec['c'],'Scale':spec['scale']}[key]
    if spec['route'] in {'direct','reroute'}:
        source=vector(target,spec['a'])
        if spec['route']=='reroute':
            reroute=target.nodes.new('NodeReroute');target.links.new(source,reroute.inputs[0]);source=reroute.outputs[0]
        target.links.new(source,node.inputs['Vector'])
    elif spec['route']=='combine':
        combine=target.nodes.new('ShaderNodeCombineXYZ')
        for axis,value in zip('XYZ',spec['a']):
            scalar=target.nodes.new('ShaderNodeValue');scalar.outputs[0].default_value=value;target.links.new(scalar.outputs[0],combine.inputs[axis])
        target.links.new(combine.outputs[0],node.inputs['Vector'])
    output=node.outputs['Value' if spec['mode']=='DOT_PRODUCT' else 'Vector']
    if spec['route']=='group':
        group.links.new(group_in.outputs[0],node.inputs['Vector']);group.links.new(output,group_out.inputs[0]);instance=tree.nodes.new('CompositorNodeGroup');instance.node_tree=group;instance.inputs[0].default_value=spec['a'];output=instance.outputs[0]
    tree.links.new(output,sink.inputs[0]);return node,sink

# Real extractor refusal paths, no private-helper-only coverage.
base=signatures()[0]
refusals=[]
def refused(label,edit):
    node,sink=setup(base);edit(node,sink)
    program=compositor_graph.extract(scene)
    assert program['status']=='unsupported',(label,program)
    assert program['diagnostics'],label
    refusals.append({'kind':label,'diagnostics':program['diagnostics']})
    tree.animation_data_clear()
refused('unqualified-mode',lambda node,sink:setattr(node,'operation','NORMALIZE'))
refused('compound-off-grid',lambda node,sink:(setattr(node,'operation','MULTIPLY_ADD'),setattr(node.inputs['Vector'],'default_value',[.1,1,2])))
refused('out-of-range',lambda node,sink:setattr(node.inputs['Vector'],'default_value',[2**17,1,2]))
refused('below-normal-contract',lambda node,sink:setattr(node.inputs['Vector'],'default_value',[2**-33,1,2]))
refused('image-field',lambda node,sink:tree.links.new(tree.nodes.new('CompositorNodeRLayers').outputs['Image'],node.inputs['Vector']))
refused('computed-vector',lambda node,sink:tree.links.new(tree.nodes.new('ShaderNodeVectorMath').outputs['Vector'],node.inputs['Vector']))
refused('negative-zero',lambda node,sink:setattr(node.inputs['Vector'],'default_value',[-0.,1,2]))
refused('unsafe-product-zero',lambda node,sink:(setattr(node,'operation','MULTIPLY'),setattr(node.inputs['Vector'],'default_value',[0,1,2]),setattr(node.inputs['Vector_001'],'default_value',[-1,1,1])))
refused('non-dyadic-divisor',lambda node,sink:(setattr(node,'operation','DIVIDE'),setattr(node.inputs['Vector_001'],'default_value',[3,1,1])))
refused('unsafe-ceil-zero',lambda node,sink:(setattr(node,'operation','CEIL'),setattr(node.inputs['Vector'],'default_value',[-.5,1,2])))
refused('animated-input',lambda node,sink:node.inputs['Vector'].keyframe_insert(data_path='default_value',frame=1))
rows=[]
for spec in signatures():
    node,sink=setup(spec)
    for item in tree.nodes:item.show_preview=False
    source=DESTINATION/(spec['case']+'.blend') if spec['saved'] else None
    if source:bpy.ops.wm.save_as_mainfile(filepath=str(source));source_hash=sha(source)
    before=json.dumps([(item.bl_idname,item.name,[(socket.identifier,list(socket.default_value) if socket.type in {'VECTOR','RGBA'} else socket.default_value) for socket in item.inputs if hasattr(socket,'default_value')]) for item in tree.nodes],sort_keys=True)
    program=compositor_graph.extract(scene);assert program['status']=='extracted',(spec,program)
    after=json.dumps([(item.bl_idname,item.name,[(socket.identifier,list(socket.default_value) if socket.type in {'VECTOR','RGBA'} else socket.default_value) for socket in item.inputs if hasattr(socket,'default_value')]) for item in tree.nodes],sort_keys=True);assert before==after
    program_path=DESTINATION/(spec['case']+'.program.json');program_path.write_text(json.dumps(program,indent=2)+'\n')
    scene.render.filepath=str(DESTINATION/(spec['case']+'.exr'))
    with oracle._render_sampling():bpy.ops.render.render(write_still=True)
    image=bpy.data.images.load(scene.render.filepath,check_existing=False);image.alpha_mode='PREMUL';pixels=np.empty(8*8*4,np.float32);image.pixels.foreach_get(pixels);bpy.data.images.remove(image);assert np.isfinite(pixels).all()
    pixel_path=DESTINATION/(spec['case']+'.rgba32f');pixel_path.write_bytes(pixels.tobytes())
    if source:assert sha(source)==source_hash
    rows.append({'case':spec['case'],'mode':spec['mode'],'route':spec['route'],'programFile':program_path.name,'programSha256':sha(program_path),'pixelFile':pixel_path.name,'pixelSha256':sha(pixel_path),**({'sourceFile':source.name,'sourceSha256':source_hash} if source else {})})
files=[Path(__file__),ROOT/'packages/blender-addon/tests/compositor_reference.py',ROOT/'experiments/compositor-vector-math/cases.py']
for folder in ['packages/blendlink/blender','packages/blender-addon']:files.extend((ROOT/folder).glob('*.py'))
report={'status':'native-vector-math-qualified','version':list(bpy.app.version),'build':bpy.app.build_hash.decode(),'device':DEVICE,'width':8,'height':8,'cases':rows,'refusals':refusals,'sourceHashes':{str(path.relative_to(ROOT)):sha(path) for path in sorted(files)}}
(DESTINATION/'qualification.json').write_text(json.dumps(report,indent=2)+'\n')
print('SCENETOWEB_VECTOR_MATH_NATIVE_PASSED '+json.dumps({'device':DEVICE,'cases':len(rows),'saved':sum(bool(row.get('sourceFile')) for row in rows),'refusals':len(refusals)}))
