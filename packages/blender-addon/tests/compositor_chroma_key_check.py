# SPDX-License-Identifier: GPL-3.0-or-later
# blendlink-headless-sentinel: BLENDLINK_COMPOSITOR_CHROMA_KEY_PASSED
"""Native Chroma Key boundaries, fixed key controls and read-only extraction."""
import hashlib,json,math,os,sys,tempfile
from pathlib import Path
import bpy
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parent))
from compositor_reference import NativeCompositorReference
import compositor_graph


def fingerprint(tree):
    return repr([(node.name,node.bl_idname,node.label,list(node.items()),
        [[(socket.identifier,str(getattr(socket,'default_value',None))) for socket in sockets] for sockets in [node.inputs,node.outputs]],
        [(name,getattr(node,name)) for name in ['mode','tolerance','threshold','gain','lift','shadow_adjust'] if hasattr(node,name)])
        for node in tree.nodes])+repr([(link.from_node.name,link.from_socket.identifier,link.to_node.name,link.to_socket.identifier) for link in tree.links])


def main(output):
    random=np.random.default_rng(73196).uniform(-.5,2,(8,32,4)).astype(np.float32)
    random[...,3]=np.resize(np.array([-1,-.5,-0.,0,2**-20,.125,.3,.5,.75,1,1.5,2,3,.1,.9,1],np.float32),(8,32))
    oracle=NativeCompositorReference(output,name='Native Chroma Key',pixels=random,device=os.environ.get('BLENDLINK_COMPOSITOR_CHROMA_KEY_DEVICE','CPU'),image_only_scene=True)
    oracle.scene.render.engine='BLENDER_EEVEE_NEXT' if bpy.app.version<(5,0) else 'BLENDER_EEVEE'
    tree=oracle.tree
    def pixels(key,minimum,maximum):
        data=random.copy()
        rows=np.array([[.183,.614,.062],[-.101,-.338,.439],[.439,-.399,-.040]],np.float64)
        basis=np.asarray([2*(np.dot(row,key)+128/255)-1 for row in rows[1:]])
        basis/=np.linalg.norm(basis);perp=np.array([-basis[1],basis[0]])
        for axis in range(4):
            for index,delta in enumerate(np.linspace(-8,8,32)*2**-24):
                angle=([minimum/2,-minimum/2,maximum/2,-maximum/2][axis])+delta
                chroma=.25*(basis*np.cos(angle)+perp*np.sin(angle))
                data[axis,index,:3]=np.linalg.solve(rows,[.5-16/255,(chroma[0]-1/255)/2,(chroma[1]-1/255)/2])
        oracle.pixels[:]=data;oracle.image.pixels.foreach_set(data.ravel())
    def setup(key,minimum,maximum,falloff,constant=False,linked=False,alpha=1,key_kind='combine'):
        pixels(key,minimum,maximum)
        sink,source=oracle.reset();node=tree.nodes.new('CompositorNodeChromaMatte');node.name='Artist Chroma Key'
        node.label='Keep authored key';node['artist-note']='source stays unchanged'
        image=oracle.color((.2,.8,.15,.5)) if constant else source.outputs['Image']
        tree.links.new(image,node.inputs['Image'])
        if key_kind=='unlinked':node.inputs['Key Color'].default_value=(*key,alpha)
        elif key_kind=='rgb':
            rgb=tree.nodes.new('CompositorNodeRGB');rgb.outputs[0].default_value=(*key,alpha)
            tree.links.new(rgb.outputs[0],node.inputs['Key Color'])
        else:tree.links.new(oracle.color((*key,alpha)),node.inputs['Key Color'])
        if oracle.modern:
            for name,value in [('Minimum',minimum),('Maximum',maximum),('Falloff',falloff)]:
                if linked:tree.links.new(oracle.value(value),node.inputs[name])
                else:node.inputs[name].default_value=value
        else:node.tolerance=maximum;node.threshold=minimum;node.gain=falloff
        return sink,source,node
    def save(label,source):
        before=fingerprint(tree);result=compositor_graph.extract(oracle.scene)
        assert result['status']=='extracted',(label,result)
        assert fingerprint(tree)==before,'Extraction changed authored Chroma Key nodes'
        oracle.save(label,source)
        if 'cascade' in label:
            path=output/(oracle.rows[-1]['case']+'.json')
            data=json.loads(path.read_text());data['captureShader']=True;path.write_text(json.dumps(data))
    sink,source=oracle.reset();tree.links.new(source.outputs['Image'],sink.inputs[0]);save('chroma-independent-control',source)
    assert oracle.device=='CPU','Positive Chroma Key references must use the qualified CPU source compositor'
    for key_name,key in [('green',(0,1,0)),('blue',(0,0,1)),('red',(1,0,0)),('picked',(.15,.8,.23)),('cyan',(.05,.8,.9)),('magenta',(.8,.07,.7))]:
        for minimum,maximum,falloff in [(0,math.pi/6,1),(0,math.pi/3,.5),(0,math.pi/2,.25)]:
            for name in ['Image','Matte']:
                for constant in [False,True]:
                    sink,source,node=setup(key,minimum,maximum,falloff,constant)
                    tree.links.new(node.outputs[name],sink.inputs[0]);save(f'chroma-{key_name}-{maximum:.3f}-{falloff:.3f}-{name.lower()}-{constant}',source)
    for kind in ['unlinked','rgb','combine']:
        for alpha in [-3,0,5]:
            sink,source,node=setup((.15,.8,.23),0,.5,.5,linked=True,alpha=alpha,key_kind=kind)
            if not oracle.modern:node.lift=.3;node.shadow_adjust=.7
            tree.links.new(node.outputs['Image'],sink.inputs[0]);save(f'chroma-{kind}-key-alpha-{alpha}',source)
    for minimum,maximum,falloff in [(0,math.pi/32,1/64),(0,1,.5),(0,math.pi/2,1)]:
        for name in ['Image','Matte']:
            sink,source,node=setup((0,1,0),minimum,maximum,falloff,linked=True)
            tree.links.new(node.outputs[name],sink.inputs[0]);save(f'chroma-control-{minimum:.3f}-{maximum:.3f}-{falloff:.3f}-{name}',source)
    for name in ['Image','Matte']:
        sink,source,node=setup((0,1,0),0,.5,.5)
        second=tree.nodes.new('CompositorNodeChromaMatte');second.name='Second independently configured Chroma Key'
        tree.links.new(node.outputs['Image'],second.inputs['Image']);second.inputs['Key Color'].default_value=(0,0,1,-2)
        if oracle.modern:
            for control,value in [('Minimum',0),('Maximum',1),('Falloff',.75)]:second.inputs[control].default_value=value
        else:second.threshold=0;second.tolerance=1;second.gain=.75
        tree.links.new(second.outputs[name],sink.inputs[0]);save(f'chroma-cascade-{name}',source)
    controls_random=np.random.default_rng(84172)
    for index in range(16):
        key=controls_random.uniform(0,1,3).tolist()
        maximum=float(controls_random.uniform(math.pi/32,math.pi/2))
        minimum=0
        falloff=float(controls_random.uniform(1/64,1))
        for name in ['Image','Matte']:
            sink,source,node=setup(key,minimum,maximum,falloff,linked=index%2==0)
            tree.links.new(node.outputs[name],sink.inputs[0]);save(f'chroma-picked-boundary-{index}-{name}',source)
    refusals=[]
    for minimum,maximum,falloff in [(0,.001,1),(0,.5,0),(math.pi/18,math.pi/6,1)]+([(.6,.5,1)] if oracle.modern else []):
        sink,source,node=setup((0,1,0),minimum,maximum,falloff);tree.links.new(node.outputs[0],sink.inputs[0]);before=fingerprint(tree)
        result=compositor_graph.extract(oracle.scene)
        assert result['status']=='unsupported' and fingerprint(tree)==before,result
        refusals.append(result['diagnostics'])
    sink,source,node=setup((.5,.5,.5),0,.5,1);tree.links.new(node.outputs[0],sink.inputs[0])
    result=compositor_graph.extract(oracle.scene);assert result['status']=='unsupported',result;refusals.append(result['diagnostics'])
    # Fixed bounds are insufficient for freezing a spatial input: authored
    # controls and all four key channels must be genuinely fixed supported nodes.
    for target in ['key-alpha','control','key-rgb']:
        if target=='control' and not oracle.modern:continue
        sink,source,node=setup((0,1,0),0,.5,1)
        tree.links.new(node.outputs[0],sink.inputs[0])
        if target=='control':tree.links.new(source.outputs['Alpha'],node.inputs['Falloff'])
        else:
            combine=node.inputs['Key Color'].links[0].from_node
            tree.links.new(source.outputs['Alpha'],combine.inputs['Alpha' if target=='key-alpha' else 'Red'])
        before=fingerprint(tree);result=compositor_graph.extract(oracle.scene)
        assert result['status']=='unsupported' and fingerprint(tree)==before,(target,result)
        refusals.append(result['diagnostics'])
    for constant in [False,True]:
        sink,source,node=setup((0,1,0),0,.5,1,constant=constant)
        tree.links.new(node.outputs[0],sink.inputs[0]);before=fingerprint(tree)
        oracle.scene.render.compositor_device='GPU'
        result=compositor_graph.extract(oracle.scene)
        assert result['status']=='unsupported' and 'CPU compositor' in str(result) and fingerprint(tree)==before,result
        refusals.append(result['diagnostics']);oracle.scene.render.compositor_device='CPU'
    (output/'refusals.json').write_text(json.dumps(refusals,indent=2))
    files=[Path(__file__).resolve(),Path(compositor_graph.__file__).resolve(),Path(compositor_graph.__file__).with_name('compositor_chroma_key.py')]
    (output/'qualification.json').write_text(json.dumps({'sourcePreserved':True,'sceneEngine':oracle.scene.render.engine,'version':bpy.app.version_string,'device':oracle.device,'backend':bpy.context.preferences.system.gpu_backend,'cases':len(oracle.rows),'sha256':{file.name:hashlib.sha256(file.read_bytes()).hexdigest() for file in files}},indent=2))
    oracle.finish('BLENDLINK_COMPOSITOR_CHROMA_KEY_PASSED')

output=os.environ.get('BLENDLINK_COMPOSITOR_CHROMA_KEY_REFERENCES')
if output:main(Path(output).resolve())
else:
    with tempfile.TemporaryDirectory(prefix='blendlink-chroma-key-') as directory:main(Path(directory))
