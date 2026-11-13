# SPDX-License-Identifier: GPL-3.0-or-later
"""GPU Color Key without approximate HSV: gray RGB and strict dead predicates."""
import hashlib
import json
import math
import os
import sys
import tempfile
from pathlib import Path
import bpy
import numpy as np
sys.path.insert(0, str(Path(__file__).resolve().parent))
from compositor_reference import NativeCompositorReference
import compositor_graph


def fingerprint(tree):
    def value(item):
        if isinstance(item, bpy.types.ID): return {'idType': item.bl_rna.identifier, 'name': item.name_full}
        if item is None or isinstance(item, (bool, str)): return item
        if isinstance(item, (int, float)):
            assert math.isfinite(item)
            return item
        return [value(part) for part in item]
    def sockets(items):
        return [(s.identifier, value(s.default_value) if hasattr(s, 'default_value') else None) for s in items]
    return repr([(n.name, n.bl_idname, sockets(n.inputs), sockets(n.outputs),
        [(k, value(getattr(n, k))) for k in ('mode','color_hue','color_saturation','color_value') if hasattr(n, k)]) for n in tree.nodes]) + repr([
        (l.from_node.name,l.from_socket.identifier,l.to_node.name,l.to_socket.identifier) for l in tree.links])


def main(output):
    pixels=np.random.default_rng(284716).uniform(-2,4,(8,16,4)).astype(np.float32)
    pixels[...,3]=np.asarray([-1,-.5,-0.,0,2**-20,.125,.3,.5,.75,1,1.5,2,3,-.25,.1,.9],np.float32)[None,:]
    center=np.float32(np.float32(.25)+np.float32(.1))
    pixels[0,:,0]=np.asarray([-2,-.25,0,.125,.25,np.nextafter(center,-np.inf,dtype=np.float32),center,
        np.nextafter(center,np.inf,dtype=np.float32),.5,.75,1,1.5,2,3,4,2**-20],np.float32)
    pixels[1,:,0]=np.asarray([np.float32(.25)+np.float32(.125),np.float32(.25)-np.float32(.125)]*8,np.float32)
    oracle=NativeCompositorReference(output,device='GPU',name='Native GPU Color Key Subsets',pixels=pixels,image_only_scene=True)
    engines={item.identifier for item in oracle.scene.render.bl_rna.properties['engine'].enum_items}
    oracle.scene.render.engine='BLENDER_EEVEE_NEXT' if 'BLENDER_EEVEE_NEXT' in engines else 'BLENDER_EEVEE'
    tree=oracle.tree
    def replicate(channel,alpha):
        node=tree.nodes.new('CompositorNodeCombineColor')
        for incoming in list(node.inputs)[:3]: tree.links.new(channel,incoming)
        tree.links.new(alpha,list(node.inputs)[3]);return node.outputs[0]
    def setup(settings=(.01,.1,.1),mode='replicated',key_value=.25):
        sink,source=oracle.reset();parts=oracle.separate(source.outputs['Image'])
        if mode=='scalar':image=parts.outputs['Red']
        elif mode=='constant':image=oracle.color((.375,.375,.375,-.5))
        elif mode=='chromatic':image=source.outputs['Image']
        else:image=replicate(parts.outputs['Red'],parts.outputs['Alpha'])
        key=replicate(parts.outputs['Blue'],oracle.value(3)) if mode=='two-fields' else oracle.color((key_value,key_value,key_value,3))
        node=tree.nodes.new('CompositorNodeColorMatte');node.name='Artist GPU Color Key'
        tree.links.new(image,node.inputs['Image']);tree.links.new(key,node.inputs['Key Color'])
        for name,attribute,number in zip(('Hue','Saturation','Value'),('color_hue','color_saturation','color_value'),settings):
            if oracle.modern:node.inputs[name].default_value=number
            else:setattr(node,attribute,number)
        return sink,source,node
    def save(label,source,model=None):
        before=fingerprint(tree);groups=[(g.name,fingerprint(g)) for g in bpy.data.node_groups];result=compositor_graph.extract(oracle.scene)
        assert result['status']=='extracted',(label,result)
        assert before==fingerprint(tree) and groups==[(g.name,fingerprint(g)) for g in bpy.data.node_groups],label
        key_ops=[op for op in result['ops'] if op['kind']=='color-key']
        if model:
            assert len(key_ops)==1 and key_ops[0]['properties']['color_key_model']==model,(label,key_ops)
        oracle.save(label,source,exact_alpha=True)
    sink,source=oracle.reset();tree.links.new(source.outputs['Image'],sink.inputs[0]);save('gpu-key-independent-control',source)
    for mode in ('replicated','scalar','constant','two-fields'):
        for settings in ((.01,.1,.1),(1,1,1),(0,.1,.1),(.125,.25,.125)):
            for name in ('Image','Matte'):
                sink,source,node=setup(settings,mode);tree.links.new(node.outputs[name],sink.inputs[0])
                save('gpu-key-gray-'+mode+'-'+str(settings[0])+'-'+str(settings[2])+'-'+name.lower(),source,'native-color-key-gray-v1')
    # Literal RGBA sockets are certified independently
    # of replicated live links; preserve the native all-constant fold too.
    for literal_image in (False,True):
        for name in ('Image','Matte'):
            sink,source,node=setup()
            for link in list(node.inputs['Key Color'].links):tree.links.remove(link)
            node.inputs['Key Color'].default_value=(.25,.25,.25,3)
            if literal_image:
                for link in list(node.inputs['Image'].links):tree.links.remove(link)
                node.inputs['Image'].default_value=(.375,.375,.375,.5)
            tree.links.new(node.outputs[name],sink.inputs[0])
            save('gpu-key-gray-literal-'+str(literal_image).lower()+'-'+name.lower(),source,'native-color-key-gray-v1')
    # Native strict boundary, independently chosen binary/decimal Value controls.
    for threshold in (np.float32(.125),np.float32(.1)):
        for direction in (-1,0,1):
            number=threshold if direction==0 else np.nextafter(threshold,np.float32(direction*np.inf))
            for name in ('Image','Matte'):
                sink,source,node=setup((.01,.1,float(number)));tree.links.new(node.outputs[name],sink.inputs[0])
                save('gpu-key-gray-boundary-'+str(float(threshold))+'-'+str(direction)+'-'+name.lower(),source,'native-color-key-gray-v1')
    for key_value in (-1,0,1,2):
        for name in ('Image','Matte'):
            sink,source,node=setup(key_value=key_value);tree.links.new(node.outputs[name],sink.inputs[0])
            save('gpu-key-gray-key-'+str(key_value)+'-'+name.lower(),source,'native-color-key-gray-v1')
    for settings in ((.01,0,.1),(.01,.1,0),(0,0,0)):
        for name in ('Image','Matte'):
            sink,source,node=setup(settings,'chromatic');tree.links.new(node.outputs[name],sink.inputs[0])
            save('gpu-key-dead-'+str(settings[1])+'-'+str(settings[2])+'-'+name.lower(),source,'native-color-key-dead-v1')
    # An unsupported, authored Key Color is genuinely dead when Saturation=0.
    for name in ('Image','Matte'):
        sink,source,node=setup((.01,0,.1),'chromatic')
        unsupported=tree.nodes.new('CompositorNodeDespeckle');unsupported.name='Unused Artist Despeckle'
        tree.links.new(source.outputs['Image'],unsupported.inputs['Image']);tree.links.new(unsupported.outputs[0],node.inputs['Key Color'])
        tree.links.new(node.outputs[name],sink.inputs[0]);before=fingerprint(tree)
        result=compositor_graph.extract(oracle.scene)
        assert result['status']=='extracted' and all(op['source']['node']!=unsupported.name for op in result['ops']),result
        assert fingerprint(tree)==before
        save('gpu-key-dead-unported-key-'+name.lower(),source,'native-color-key-dead-v1')
    # Gray proof follows actual flattened group inputs, not group annotations.
    group=bpy.data.node_groups.new('Artist Gray Group','CompositorNodeTree')
    group.interface.new_socket(name='Scalar',in_out='INPUT',socket_type='NodeSocketFloat')
    group.interface.new_socket(name='Image',in_out='OUTPUT',socket_type='NodeSocketColor')
    incoming=group.nodes.new('NodeGroupInput');outgoing=group.nodes.new('NodeGroupOutput')
    combine=group.nodes.new('CompositorNodeCombineColor')
    for target in list(combine.inputs)[:3]:group.links.new(incoming.outputs['Scalar'],target)
    group.links.new(combine.outputs[0],outgoing.inputs[0])
    for name in ('Image','Matte'):
        sink,source,node=setup()
        instance=tree.nodes.new('CompositorNodeGroup');instance.node_tree=group
        tree.links.new(oracle.separate(source.outputs['Image']).outputs['Red'],instance.inputs[0])
        tree.links.new(instance.outputs[0],node.inputs['Image']);tree.links.new(node.outputs[name],sink.inputs[0])
        save('gpu-key-gray-group-'+name.lower(),source,'native-color-key-gray-v1')
    refusals=[]
    sink,source,node=setup((2**-126,.1,.1));tree.links.new(node.outputs['Image'],sink.inputs[0]);before=fingerprint(tree)
    result=compositor_graph.extract(oracle.scene)
    assert result['status']=='unsupported' and any('half threshold remains normal' in d['message'] for d in result['diagnostics']),result
    assert before==fingerprint(tree);refusals.append(result['diagnostics'])
    sink,source,node=setup();tree.links.new(node.outputs['Image'],sink.inputs[0])
    next(link.from_node for link in node.inputs['Image'].links).mode='HSV'
    before=fingerprint(tree);result=compositor_graph.extract(oracle.scene)
    assert result['status']=='unsupported' and any('chromatic RGB' in d['message'] for d in result['diagnostics']),result
    assert before==fingerprint(tree);refusals.append(result['diagnostics'])
    for settings in ((.01,.1,.1),(0,.1,.1)):
        sink,source,node=setup(settings,'chromatic');tree.links.new(node.outputs['Image'],sink.inputs[0]);before=fingerprint(tree)
        result=compositor_graph.extract(oracle.scene)
        assert result['status']=='unsupported' and any('chromatic RGB' in d['message'] for d in result['diagnostics']),result
        assert fingerprint(tree)==before;refusals.append(result['diagnostics'])
    (output/'refusals.json').write_text(json.dumps(refusals,indent=2))
    from compositor_gpu import native_gpu_profile
    paths=[Path(__file__).resolve(),Path(compositor_graph.__file__).resolve(),Path(compositor_graph.__file__).with_name('compositor_color_key.py')]
    (output/'qualification.json').write_text(json.dumps({'blenderVersion':list(bpy.app.version),'sceneEngine':oracle.scene.render.engine,
        'compositorDevice':'GPU','compositorPrecision':oracle.scene.render.compositor_precision,'nativeGpuProfile':native_gpu_profile(),
        'cases':len(oracle.rows),'sourcePreserved':True,'sha256':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}},indent=2))
    oracle.finish('BLENDLINK_COMPOSITOR_COLOR_KEY_GPU_SUBSET_PASSED')


destination=os.environ.get('BLENDLINK_COMPOSITOR_COLOR_KEY_GPU_REFERENCES')
if destination:main(Path(destination).resolve())
else:
    with tempfile.TemporaryDirectory(prefix='blendlink-key-gpu-subsets-') as directory:main(Path(directory))
