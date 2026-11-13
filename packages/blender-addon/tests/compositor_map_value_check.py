# SPDX-License-Identifier: GPL-3.0-or-later
# blendlink-headless-sentinel: BLENDLINK_COMPOSITOR_MAP_VALUE_PASSED
"""Legacy Map Value pixels, ordered clipping, conversions and native absence."""
import hashlib,importlib,json,os,shutil,sys,tempfile,types
from pathlib import Path
import bpy
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parent))
from compositor_reference import NativeCompositorReference
import compositor_graph


def source_hashes():
    helper=Path(compositor_graph.__file__).with_name('compositor_map_value.py')
    files=[Path(__file__),Path(compositor_graph.__file__),helper,helper.with_name('compositor_map_value_domain.py')]
    return {p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in files}


def fingerprint(tree):
    def val(v):
        if v is None or isinstance(v,(str,int,float,bool)):return v
        return list(v)
    return repr([(n.name,n.bl_idname,list(n.items()),[(s.identifier,val(getattr(s,'default_value',None))) for s in n.inputs],
        [(s.identifier,val(getattr(s,'default_value',None))) for s in n.outputs],
        [(name,val(getattr(n,name))) for name in ['offset','size','min','max','use_min','use_max','operation','use_clamp'] if hasattr(n,name)]) for n in tree.nodes])+repr([
        (l.from_node.name,l.from_socket.identifier,l.to_node.name,l.to_socket.identifier) for l in tree.links])


def absence(destination):
    results={}
    for context in ['root','group']:
        if context=='root' and hasattr(bpy.context.scene,'compositing_node_group'):
            tree=bpy.data.node_groups.new('Native Map Value root','CompositorNodeTree');bpy.context.scene.compositing_node_group=tree
        elif context=='root':bpy.context.scene.use_nodes=True;tree=bpy.context.scene.node_tree
        else:tree=bpy.data.node_groups.new('Native Map Value group','CompositorNodeTree')
        try:node=tree.nodes.new('CompositorNodeMapValue')
        except RuntimeError as error:results[context]={'creatable':False,'reason':str(error)}
        else:results[context]={'creatable':True};tree.nodes.remove(node)
    if all(not x['creatable'] for x in results.values()):
        (destination/'index.json').write_text('[]\n')
        report={'status':'native-node-absent','protocol':'blendlink-map-value-native-absence-v1','nodeType':'CompositorNodeMapValue',
            'native':bpy.app.version_string,'hash':bpy.app.build_hash.decode(),
            'cases':0,'nativeApplicable':False,'contexts':results,'fixtureSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}
        (destination/'qualification.json').write_text(json.dumps(report,indent=2)+'\n')
        print('BLENDLINK_COMPOSITOR_MAP_VALUE_PASSED',json.dumps(report));return True
    assert all(x['creatable'] for x in results.values()),results
    return False


def main(destination):
    if absence(destination):return
    data=np.random.default_rng(827451).uniform(-4,6,(8,16,4)).astype(np.float32)
    data[...,3]=np.resize(np.asarray([-2,-.5,-0.,0,.125,.5,1,2],np.float32),(8,16))
    data.reshape(-1,4)[:16,0]=np.asarray([-0.,0,1,-1,.25,.75,.5,.1,-.3,2**-10,1+2**-23,1-2**-24,65536,-65536,2**-120,-2**-120],np.float32)
    oracle=NativeCompositorReference(destination,device=os.environ.get('BLENDLINK_COMPOSITOR_MAP_VALUE_DEVICE','CPU'),
        name='Native Map Value',pixels=data,image_only_scene=True)
    engines={e.identifier for e in oracle.scene.render.bl_rna.properties['engine'].enum_items}
    oracle.scene.render.engine='BLENDER_EEVEE' if 'BLENDER_EEVEE' in engines else 'BLENDER_EEVEE_NEXT'
    tree=oracle.tree
    def configure(node,controls):
        offset,size,use_min,minimum,use_max,maximum=controls
        node.offset=(offset,);node.size=(size,);node.min=(minimum,);node.max=(maximum,);node.use_min=use_min;node.use_max=use_max
    def setup(controls,mode='scalar'):
        sink,source=oracle.reset();node=tree.nodes.new('CompositorNodeMapValue');node.name='Artist Map Value';node['artist-note']='Preserve mapping'
        configure(node,controls)
        channels=oracle.separate(source.outputs['Image'])
        def bounded(incoming):
            minimum=tree.nodes.new('CompositorNodeMath');minimum.operation='MAXIMUM';minimum.inputs[1].default_value=.25
            tree.links.new(incoming,minimum.inputs[0])
            maximum=tree.nodes.new('CompositorNodeMath');maximum.operation='MINIMUM';maximum.inputs[1].default_value=16
            tree.links.new(minimum.outputs[0],maximum.inputs[0]);return maximum.outputs[0]
        if mode=='scalar':incoming=bounded(channels.outputs['Red'])
        else:
            color=tree.nodes.new('CompositorNodeCombineColor');color.mode='RGB'
            for name in ['Red','Green','Blue']:tree.links.new(bounded(channels.outputs[name]),color.inputs[name])
            incoming=color.outputs[0]
        tree.links.new(incoming,node.inputs['Value']);return sink,source,node
    def save(label,source):
        before=fingerprint(tree);groups=[(g.name,fingerprint(g)) for g in bpy.data.node_groups]
        program=compositor_graph.extract(oracle.scene)
        assert program['status']=='extracted',(label,program)
        assert fingerprint(tree)==before and groups==[(g.name,fingerprint(g)) for g in bpy.data.node_groups]
        oracle.save(label,source,exact_alpha=True)
    refusals=[]
    def refused(label,source,reason):
        before=fingerprint(tree);program=compositor_graph.extract(oracle.scene)
        assert program['status']=='unsupported' and reason in program['diagnostics'][0]['message'],program
        assert fingerprint(tree)==before
        links=[(link.from_socket,link.to_socket) for link in tree.links]
        image=tree.nodes.new('CompositorNodeImage');image.image=oracle.image
        try:
            for incoming,target in links:
                if incoming==source.outputs['Image']:tree.links.new(image.outputs['Image'],target)
            oracle.scene.render.filepath=str(destination/'refused-native.exr')
            with oracle._render_sampling():bpy.ops.render.render(write_still=True)
            result=bpy.data.images.load(oracle.scene.render.filepath,check_existing=False)
            try:
                result.alpha_mode='PREMUL';expected=np.asarray(result.pixels[:],np.float32);assert np.isfinite(expected).all()
            finally:bpy.data.images.remove(result)
        finally:
            tree.nodes.remove(image);tree.links.clear()
            for incoming,target in links:tree.links.new(incoming,target)
        assert fingerprint(tree)==before
        filename=oracle.prefix+'-refused-'+label+'.json'
        payload={'case':filename[:-5],'width':oracle.width,'height':oracle.height,'input':oracle.pixels.ravel().tolist(),
            'expected':expected.tolist(),'program':program,'sourcePreserved':True,'native':bpy.app.version_string,
            'device':oracle.device,'sourceBackend':bpy.context.preferences.system.gpu_backend}
        contents=json.dumps(payload,separators=(',',':')).encode();(destination/filename).write_bytes(contents)
        refusals.append({'file':filename,'sha256':hashlib.sha256(contents).hexdigest(),'reason':program['diagnostics'][0]['message']})
    sink,source=oracle.reset();tree.links.new(source.outputs['Image'],sink.inputs[0]);save('map-value-independent-control',source)
    if oracle.device=='GPU' and bpy.context.preferences.system.gpu_backend!='METAL':
        sink,source,node=setup((0,1,False,0,False,1));tree.links.new(node.outputs[0],sink.inputs[0]);refused('source-gpu-profile',source,'GPU source backend')
        (destination/'index.json').write_text(json.dumps(oracle.rows,indent=2)+'\n')
        (destination/'qualification.json').write_text(json.dumps({'status':'source-profile-refused','protocol':'blendlink-map-value-gpu-source-profile-v1',
            'native':bpy.app.version_string,'hash':bpy.app.build_hash.decode(),'device':oracle.device,'sourceBackend':bpy.context.preferences.system.gpu_backend,
            'cases':0,'numericalMapValueCases':0,'controlCases':len(oracle.rows),'sourcePreserved':True,'profileRefusals':refusals,'sources':source_hashes()},indent=2)+'\n')
        print('BLENDLINK_COMPOSITOR_MAP_VALUE_SOURCE_PROFILE_REFUSED');return
    controls=[('default',(0,1,False,0,False,1)),('offset',(1.25,1,False,0,False,1)),
      ('negative-size',(0,-2,False,0,False,1)),('add-before-scale',(1.25,2,False,0,False,1)),
      ('fractional',(-.3,1.2,False,0,False,1)),('negative-both',(-.5,-1.25,False,0,False,1)),
      ('zero',(2,0,False,0,False,1)),('negative-zero',(-0.,-0.,False,0,False,1)),
      ('tiny',(2**-10,2**-8,False,0,False,1)),('large',(0,1000,False,0,False,1)),
      ('minimum',(.125,2,True,.25,False,1)),('maximum',(.125,-2,False,0,True,.75)),
      ('both',(.125,1.5,True,-.5,True,.5)),('reversed',(0,1,True,.75,True,.25)),
      ('collapsed',(0,1,True,.25,True,.25)),('zero-tie',(0,1,True,-0.,True,0.)),
      ('inactive-limits',(.125,1,False,-1e30,False,1e30))]
    for label,values in controls:
        for mode in ['scalar','rgba']:
            for alpha in [False,True]:
                sink,source,node=setup(values,mode)
                if alpha:
                    out=tree.nodes.new('CompositorNodeSetAlpha');out.mode='REPLACE_ALPHA'
                    tree.links.new(source.outputs['Image'],out.inputs['Image']);tree.links.new(node.outputs['Value'],out.inputs['Alpha'])
                    tree.links.new(out.outputs[0],sink.inputs[0])
                else:tree.links.new(node.outputs[0],sink.inputs[0])
                case='map-value-'+label+'-'+mode+('-as-alpha' if alpha else '-gray')
                if oracle.device=='GPU' and mode=='rgba' and values[0]!=0:refused(case,source,'Offset zero')
                else:save(case,source)
    for index,number in enumerate([-2,-.3,-0.,0,.125,.5,1,3]):
        sink,source,node=setup((.125,-1.5,True,-.5,True,.75));tree.links.new(oracle.value(number),node.inputs[0]);tree.links.new(node.outputs[0],sink.inputs[0])
        save('map-value-constant-'+str(index),source)
    for index,direction in enumerate([(1,0,0),(.125,-.5,1),(-1,-1,-1)]):
        sink,source=oracle.reset();vector_group=bpy.data.node_groups.new('Fixed vector Map Value '+str(index),'CompositorNodeTree')
        vector_group.interface.new_socket(name='Vector',in_out='INPUT',socket_type='NodeSocketVector').default_value=direction
        vector_group.interface.new_socket(name='Value',in_out='OUTPUT',socket_type='NodeSocketFloat')
        given=vector_group.nodes.new('NodeGroupInput');result=vector_group.nodes.new('NodeGroupOutput');node=vector_group.nodes.new('CompositorNodeMapValue')
        configure(node,(0,1.5,False,0,False,1));vector_group.links.new(given.outputs[0],node.inputs[0]);vector_group.links.new(node.outputs[0],result.inputs[0])
        instance=tree.nodes.new('CompositorNodeGroup');instance.node_tree=vector_group;tree.links.new(instance.outputs[0],sink.inputs[0])
        save('map-value-vector-to-scalar-'+str(index),source)
    sink,source,node=setup((.125,-1.5,True,-.5,False,0));other=tree.nodes.new('CompositorNodeMapValue')
    configure(other,(-.5,1.25,False,0,True,.75));tree.links.new(node.outputs[0],other.inputs[0]);tree.links.new(other.outputs[0],sink.inputs[0]);save('map-value-cascade',source)
    sink,source=oracle.reset();group=bpy.data.node_groups.new('Artist Map Value Group','CompositorNodeTree')
    group.interface.new_socket(name='Value',in_out='INPUT',socket_type='NodeSocketFloat')
    group.interface.new_socket(name='Value',in_out='OUTPUT',socket_type='NodeSocketFloat')
    given=group.nodes.new('NodeGroupInput');result=group.nodes.new('NodeGroupOutput');inner=group.nodes.new('CompositorNodeMapValue')
    configure(inner,(0,-1.5,True,-.5,True,.75));group.links.new(given.outputs[0],inner.inputs[0]);group.links.new(inner.outputs[0],result.inputs[0])
    instance=tree.nodes.new('CompositorNodeGroup');instance.node_tree=group
    minimum=tree.nodes.new('CompositorNodeMath');minimum.operation='MAXIMUM';minimum.inputs[1].default_value=.25
    maximum=tree.nodes.new('CompositorNodeMath');maximum.operation='MINIMUM';maximum.inputs[1].default_value=16
    tree.links.new(oracle.separate(source.outputs['Image']).outputs['Red'],minimum.inputs[0]);tree.links.new(minimum.outputs[0],maximum.inputs[0])
    tree.links.new(maximum.outputs[0],instance.inputs[0]);tree.links.new(instance.outputs[0],sink.inputs[0]);save('map-value-group',source)
    for index,values in enumerate([(2**-130,1),(0,2**-130)]):
        sink,source,node=setup((values[0],values[1],False,0,False,1));tree.links.new(node.outputs[0],sink.inputs[0]);before=fingerprint(tree)
        program=compositor_graph.extract(oracle.scene)
        assert program['status']=='unsupported' and 'Map Value controls' in program['diagnostics'][0]['message'],program
        assert fingerprint(tree)==before
    sink,source,node=setup((0,1,False,0,False,1));math=tree.nodes.new('CompositorNodeMath');math.operation='ADD'
    tree.links.new(source.outputs['Image'],math.inputs[0]);tree.links.new(math.outputs[0],node.inputs[0]);tree.links.new(node.outputs[0],sink.inputs[0])
    refused('upstream-implicit-color-to-scalar',source,'farther upstream')
    sink,source,node=setup((0,1,False,0,False,1));tree.links.new(oracle.separate(source.outputs['Image']).outputs['Alpha'],node.inputs[0]);tree.links.new(node.outputs[0],sink.inputs[0])
    refused('unbounded-raw-field',source,'normal-or-zero')
    for label,input_value,size in [('subnormal-input',1e-40,1),('normal-product-underflow',1e-20,1e-20),('normal-product-overflow',1e38,1000)]:
        sink,source,node=setup((0,size,False,0,False,1));tree.links.new(oracle.value(input_value),node.inputs[0]);tree.links.new(node.outputs[0],sink.inputs[0]);before=fingerprint(tree)
        program=compositor_graph.extract(oracle.scene);assert program['status']=='unsupported' and 'normal-or-zero' in program['diagnostics'][0]['message'],program
        assert fingerprint(tree)==before
    sink,source,node=setup((0,1e-20,False,0,False,1));tree.links.new(oracle.value(1e-20),node.inputs[0])
    apply=tree.nodes.new('CompositorNodeSetAlpha');apply.mode='APPLY'
    tree.links.new(oracle.color((1e38,1e38,1e38,1)),apply.inputs['Image']);tree.links.new(node.outputs[0],apply.inputs['Alpha']);tree.links.new(apply.outputs[0],sink.inputs[0])
    refused('normal-product-underflow-amplified',source,'normal-or-zero')
    # Installed namespace loads the actual new sibling from copied build assets.
    sink,source,node=setup((.125,1.5,False,0,False,1));tree.links.new(node.outputs[0],sink.inputs[0]);expected=compositor_graph.extract(oracle.scene);before=fingerprint(tree)
    staged=Path(__file__).resolve().parents[2]/'blendlink/dist/addon';helper=Path(compositor_graph.__file__).with_name('compositor_map_value.py')
    assert (staged/helper.name).read_bytes()==helper.read_bytes(),'Rebuild worker add-on assets'
    package_name='isolated_map_value_extension'
    with tempfile.TemporaryDirectory(prefix='blendlink-map-value-package-') as temporary:
        package=Path(temporary)/package_name;package.mkdir()
        for file in staged.iterdir():
            if file.suffix in {'.py','.json'}:shutil.copy2(file,package/file.name)
        wrapper=types.ModuleType(package_name);wrapper.__path__=[str(package)];sys.modules[package_name]=wrapper
        try:
            qualified=importlib.import_module(package_name+'.compositor_graph')
            assert qualified.normalize_map_value.__module__==package_name+'.compositor_map_value'
            assert qualified.extract(oracle.scene)==expected and fingerprint(tree)==before
        finally:
            for name in list(sys.modules):
                if name==package_name or name.startswith(package_name+'.'):sys.modules.pop(name,None)
    (destination/'qualification.json').write_text(json.dumps({'status':'qualified','native':bpy.app.version_string,'hash':bpy.app.build_hash.decode(),
        'device':oracle.device,'sourceBackend':bpy.context.preferences.system.gpu_backend,'sourcePreserved':True,'cases':len(oracle.rows),
        'profileRefusals':refusals,'copiedPackageQualifiedProbe':True,'sources':source_hashes()},indent=2)+'\n')
    oracle.finish('BLENDLINK_COMPOSITOR_MAP_VALUE_PASSED')


output=os.environ.get('BLENDLINK_COMPOSITOR_MAP_VALUE_REFERENCES')
if output:
    destination=Path(output).resolve();destination.mkdir(parents=True,exist_ok=True);main(destination)
else:
    with tempfile.TemporaryDirectory(prefix='blendlink-map-value-') as directory:main(Path(directory))
