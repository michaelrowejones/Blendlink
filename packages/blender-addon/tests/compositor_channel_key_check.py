# SPDX-License-Identifier: GPL-3.0-or-later
# blendlink-headless-sentinel: BLENDLINK_COMPOSITOR_CHANNEL_KEY_PASSED
"""Independent Channel Key pixels, strict limits, source modes and alpha."""
import hashlib,importlib,json,math,os,shutil,sys,tempfile,types
from pathlib import Path
import bpy
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parent))
from compositor_reference import NativeCompositorReference
import compositor_graph


def fingerprint(tree):
    def value(item):
        if isinstance(item,bpy.types.ID):return (item.bl_rna.identifier,item.name_full)
        if item is None or isinstance(item,(str,int,float,bool)):return item
        return list(item)
    def sockets(items):
        return [(socket.identifier,value(getattr(socket,'default_value',None))) for socket in items]
    properties=['color_space','matte_channel','limit_method','limit_channel','limit_min','limit_max']
    return repr([(node.name,node.bl_idname,sockets(node.inputs),sockets(node.outputs),list(node.items()),
        [(name,value(getattr(node,name))) for name in properties if hasattr(node,name)]) for node in tree.nodes])+repr([
            (link.from_node.name,link.from_socket.identifier,link.to_node.name,link.to_socket.identifier) for link in tree.links])


def pixels():
    data=np.random.default_rng(814953).uniform(-4,6,(16,32,4)).astype(np.float32)
    data[...,3]=np.resize(np.asarray([-2,-1,-.5,-0.,0,2**-20,.125,.3,.5,.75,1,1.5,2,3,4,-.25],np.float32),(16,32))
    flat=data.reshape(-1,4);index=0
    for key in range(3):
        for difference in [0,1,.875,.375,.75,.5,.9,.4,.984375]:
            for base in [0,.1,.5,1,4,-2]:
                center=np.float32(np.float32(base)+np.float32(difference))
                for chosen in [np.nextafter(center,np.float32(-np.inf)),center,np.nextafter(center,np.float32(np.inf))]:
                    other=[axis for axis in range(3) if axis!=key]
                    flat[index,key]=chosen;flat[index,other[0]]=base;flat[index,other[1]]=np.float32(base-.25)
                    if index%5:flat[index,3]=3
                    index+=1
    assert index==486
    return data


def main(destination):
    oracle=NativeCompositorReference(destination,device=os.environ.get('BLENDLINK_COMPOSITOR_CHANNEL_KEY_DEVICE','CPU'),
        name='Native Channel Key',pixels=pixels(),image_only_scene=True)
    engines={item.identifier for item in oracle.scene.render.bl_rna.properties['engine'].enum_items}
    oracle.scene.render.engine='BLENDER_EEVEE' if 'BLENDER_EEVEE' in engines else 'BLENDER_EEVEE_NEXT'
    tree=oracle.tree
    def configure(node,key,method,limit,low,high):
        if oracle.modern:
            for name,setting in [('Color Space','RGB'),('RGB Key Channel',key),('Limit Method',method.title()),('RGB Limit Channel',limit)]:
                node.inputs[name].default_value=setting
            node.inputs['Minimum'].default_value=low;node.inputs['Maximum'].default_value=high
        else:
            node.color_space='RGB';node.matte_channel=key;node.limit_method=method;node.limit_channel=limit
            node.limit_min=low;node.limit_max=high
    def setup(key='G',method='MAX',limit='R',low=0,high=1,color=None):
        sink,source=oracle.reset();node=tree.nodes.new('CompositorNodeChannelMatte');node.name='Artist Channel Key'
        node['artist-note']='preserve authored key';configure(node,key,method,limit,low,high)
        tree.links.new(source.outputs['Image'] if color is None else oracle.color(color),node.inputs['Image'])
        return sink,source,node
    def save(label,source):
        before=fingerprint(tree);groups=[(group.name,fingerprint(group)) for group in bpy.data.node_groups]
        program=compositor_graph.extract(oracle.scene)
        assert program['status']=='extracted',(label,program)
        assert fingerprint(tree)==before and groups==[(group.name,fingerprint(group)) for group in bpy.data.node_groups],'Source was changed'
        oracle.save(label,source,exact_alpha=True)
    sink,source=oracle.reset();tree.links.new(source.outputs['Image'],sink.inputs[0]);save('channel-key-independent-control',source)
    if oracle.device=='GPU' and bpy.context.preferences.system.gpu_backend!='METAL':
        refused=[]
        for output in ['Image','Matte']:
            sink,source,node=setup();tree.links.new(node.outputs[output],sink.inputs[0]);before=fingerprint(tree)
            program=compositor_graph.extract(oracle.scene)
            assert program['status']=='unsupported' and 'GPU source backend' in program['diagnostics'][0]['message'],program
            assert before==fingerprint(tree)
            links=[(link.from_socket,link.to_socket) for link in tree.links]
            source_links=[(link.from_socket,link.to_socket) for link in source.outputs['Image'].links]
            image=tree.nodes.new('CompositorNodeImage');image.image=oracle.image
            try:
                for _,target in source_links:tree.links.new(image.outputs['Image'],target)
                oracle.scene.render.filepath=str(destination/'unverified-gpu-source.exr')
                with oracle._render_sampling():bpy.ops.render.render(write_still=True)
                reference=bpy.data.images.load(oracle.scene.render.filepath,check_existing=False)
                try:
                    reference.alpha_mode='PREMUL';expected=np.asarray(reference.pixels[:],np.float32)
                    assert np.isfinite(expected).all()
                finally:bpy.data.images.remove(reference)
            finally:
                tree.nodes.remove(image);tree.links.clear()
                for incoming,target in links:tree.links.new(incoming,target)
            assert fingerprint(tree)==before
            filename=oracle.prefix+'-channel-key-source-profile-refused-'+output.lower()+'.json'
            payload={'case':filename[:-5],'width':oracle.width,'height':oracle.height,'input':oracle.pixels.ravel().tolist(),
                'expected':expected.tolist(),'program':program,'diagnostics':program['diagnostics'],'sourcePreserved':True,
                'blenderVersion':bpy.app.version_string,'blenderHash':bpy.app.build_hash.decode(),'compositorDevice':oracle.device,
                'sourceBackend':bpy.context.preferences.system.gpu_backend,'output':output}
            contents=json.dumps(payload,separators=(',',':')).encode();(destination/filename).write_bytes(contents)
            refused.append({'file':filename,'sha256':hashlib.sha256(contents).hexdigest(),'reason':program['diagnostics'][0]['message']})
        (destination/'qualification.json').write_text(json.dumps({'status':'source-profile-refused',
            'protocol':'blendlink-channel-gpu-source-profile-v1','cases':0,'controlCases':len(oracle.rows),
            'numericalChannelCases':0,'sourcePreserved':True,'profileRefusals':refused,
            'native':bpy.app.version_string,'hash':bpy.app.build_hash.decode(),'device':oracle.device,
            'sourceBackend':bpy.context.preferences.system.gpu_backend},indent=2))
        (destination/'index.json').write_text(json.dumps(oracle.rows,indent=2))
        (destination/'render-profile.json').write_text(json.dumps(oracle.render_profiles,indent=2))
        print('BLENDLINK_COMPOSITOR_CHANNEL_KEY_SOURCE_PROFILE_REFUSED',json.dumps({'blender':bpy.app.version_string,'cases':0,'controlCases':len(oracle.rows)}))
        return
    for key in ['R','G','B']:
        for method,limit in [('MAX','R')]+[('SINGLE',value) for value in ['R','G','B']]:
            for low,high in [(0,1),(.125,.625),(.25,.5),(.5,1),(0,1/64),(.1,.6)]:
                for output in ['Image','Matte']:
                    sink,source,node=setup(key,method,limit,low,high);tree.links.new(node.outputs[output],sink.inputs[0])
                    save(f'channel-key-{key}-{method}-{limit}-{low}-{high}-{output}'.lower(),source)
    for key in ['R','G','B']:
        for color_index,color in enumerate([(.1,.1,.1,3),(.125,.5,.25,-.5),(2,-.5,.125,2),(-2,1,3,1.5)]):
            for output in ['Image','Matte']:
                sink,source,node=setup(key=key,color=color);tree.links.new(node.outputs[output],sink.inputs[0])
                save(f'channel-key-constant-{key}-{color_index}-{output}'.lower(),source)
    if oracle.modern:
        for mode in ['both','minimum','maximum']:
            for output in ['Image','Matte']:
                sink,source,node=setup(low=.125,high=.625)
                for name,number in [('Minimum',.125),('Maximum',.625)]:
                    if mode=='both' or name.lower()==mode:tree.links.new(oracle.value(number),node.inputs[name])
                tree.links.new(node.outputs[output],sink.inputs[0]);save('channel-key-linked-'+mode+'-'+output.lower(),source)
    for output in ['Image','Matte']:
        sink,source,node=setup(low=.125,high=.625)
        other=tree.nodes.new('CompositorNodeChannelMatte');configure(other,'B','SINGLE','R',.25,.5)
        tree.links.new(node.outputs['Image'],other.inputs['Image']);tree.links.new(other.outputs[output],sink.inputs[0])
        save('channel-key-two-instance-cascade-'+output.lower(),source)
    # A node inside a real group, including literal group control inputs.
    for output in ['Image','Matte']:
        sink,source=oracle.reset();group=bpy.data.node_groups.new('Artist Channel Key Group','CompositorNodeTree')
        group.interface.new_socket(name='Image',in_out='INPUT',socket_type='NodeSocketColor')
        for name,number in [('Minimum',.125),('Maximum',.625)]:
            group.interface.new_socket(name=name,in_out='INPUT',socket_type='NodeSocketFloat').default_value=number
        for name,kind in [('Image','NodeSocketColor'),('Matte','NodeSocketFloat')]:group.interface.new_socket(name=name,in_out='OUTPUT',socket_type=kind)
        given=group.nodes.new('NodeGroupInput');result=group.nodes.new('NodeGroupOutput');inner=group.nodes.new('CompositorNodeChannelMatte')
        configure(inner,'R','MAX','B',.125,.625);group.links.new(given.outputs['Image'],inner.inputs['Image'])
        if oracle.modern:
            for name in ['Minimum','Maximum']:group.links.new(given.outputs[name],inner.inputs[name])
        for name in ['Image','Matte']:group.links.new(inner.outputs[name],result.inputs[name])
        instance=tree.nodes.new('CompositorNodeGroup');instance.node_tree=group
        tree.links.new(source.outputs['Image'],instance.inputs['Image']);tree.links.new(instance.outputs[output],sink.inputs[0])
        save('channel-key-group-'+output.lower(),source)
    for low,high in [(0,1),(.125,.625)]:
        sink,source,node=setup(low=low,high=high);set_alpha=tree.nodes.new('CompositorNodeSetAlpha')
        if oracle.modern:set_alpha.inputs['Type'].default_value='Replace Alpha'
        else:set_alpha.mode='REPLACE_ALPHA'
        tree.links.new(source.outputs['Image'],set_alpha.inputs['Image']);tree.links.new(node.outputs['Matte'],set_alpha.inputs['Alpha'])
        tree.links.new(set_alpha.outputs[0],sink.inputs[0]);save('channel-key-matte-as-alpha-'+str(low),source)
    # Named refusals preserve authoring state, including inactive choices.
    for space in ['HSV','YUV','YCC']:
        sink,source,node=setup()
        if oracle.modern:node.inputs['Color Space'].default_value='YCbCr' if space=='YCC' else space
        else:node.color_space=space
        tree.links.new(node.outputs['Image'],sink.inputs[0]);before=fingerprint(tree)
        program=compositor_graph.extract(oracle.scene)
        assert program['status']=='unsupported' and 'currently requires RGB' in program['diagnostics'][0]['message'],program
        assert fingerprint(tree)==before
    for low,high in [(.5,.5),(.75,.25),(0,.3),(0,1/128)]:
        sink,source,node=setup(low=low,high=high);tree.links.new(node.outputs['Image'],sink.inputs[0]);before=fingerprint(tree)
        program=compositor_graph.extract(oracle.scene)
        assert program['status']=='unsupported' and 'power-of-two' in program['diagnostics'][0]['message'],(low,high,program)
        assert fingerprint(tree)==before
    # Real copied-package lookup exercises the new canonical sibling loader.
    sink,source,node=setup();tree.links.new(node.outputs['Image'],sink.inputs[0])
    expected=compositor_graph.extract(oracle.scene);before=fingerprint(tree)
    staged=Path(__file__).resolve().parents[2]/'blendlink/dist/addon'
    helper=Path(compositor_graph.__file__).with_name('compositor_channel_key.py')
    assert (staged/helper.name).read_bytes()==helper.read_bytes(),'Build fresh addon assets for the installed Channel Key probe'
    package_name='isolated_channel_key_extension'
    with tempfile.TemporaryDirectory(prefix='blendlink-channel-key-package-') as temporary:
        package=Path(temporary)/package_name;package.mkdir()
        for file in staged.iterdir():
            if file.suffix in {'.py','.json'}:shutil.copy2(file,package/file.name)
        wrapper=types.ModuleType(package_name);wrapper.__path__=[str(package)];sys.modules[package_name]=wrapper
        try:
            qualified=importlib.import_module(package_name+'.compositor_graph')
            assert qualified.normalize_channel_key.__module__==package_name+'.compositor_channel_key'
            assert qualified.extract(oracle.scene)==expected and fingerprint(tree)==before
        finally:
            for name in list(sys.modules):
                if name==package_name or name.startswith(package_name+'.'):sys.modules.pop(name,None)
    files=[Path(__file__),Path(compositor_graph.__file__),Path(compositor_graph.__file__).with_name('compositor_channel_key.py')]
    (destination/'qualification.json').write_text(json.dumps({'native':bpy.app.version_string,'hash':bpy.app.build_hash.decode(),
        'device':oracle.device,'sourceBackend':bpy.context.preferences.system.gpu_backend,'sourcePreserved':True,
        'cases':len(oracle.rows),'copiedPackageQualifiedProbe':True,
        'sources':{file.name:hashlib.sha256(file.read_bytes()).hexdigest() for file in files}},indent=2))
    oracle.finish('BLENDLINK_COMPOSITOR_CHANNEL_KEY_PASSED')


output=os.environ.get('BLENDLINK_COMPOSITOR_CHANNEL_KEY_REFERENCES')
if output:
    destination=Path(output).resolve();destination.mkdir(parents=True,exist_ok=True);main(destination)
else:
    with tempfile.TemporaryDirectory(prefix='blendlink-channel-key-') as directory:main(Path(directory))
