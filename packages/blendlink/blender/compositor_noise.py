# SPDX-License-Identifier: GPL-3.0-or-later
"""Pinned default2D CPU compositor Noise admission; no shader equivalence."""
import math
import platform
import sys
import bpy

MODEL='native-compositor-noise2d-default-fbm-cpu-53-v1'
PROFILE='darwin-arm64-53-noise2d-default-fbm-cpu-v1'
COORDINATES='exact-uniform-r32f-axes-v1'
KERNEL='staged-bli-fade-perlin-fbm-noise2d-v3'
DEFAULTS={'Scale':5.,'Detail':2.,'Roughness':.5,'Lacunarity':2.,'Distortion':0.}


def source_shape(node,scene):
    render=scene.render;m=node.texture_mapping
    root=scene.compositing_node_group
    return (node.as_pointer(),node.id_data.as_pointer(),scene.as_pointer(),scene.frame_current,scene.frame_subframe,root.as_pointer()if root else None,render.engine,render.use_compositing,node.bl_idname,node.mute,node.noise_dimensions,node.noise_type,node.normalize,
        tuple(m.translation),tuple(m.rotation),tuple(m.scale),m.use_min,m.use_max,
        render.compositor_device,render.compositor_precision,render.resolution_x,render.resolution_y,
        render.resolution_percentage,render.use_border,render.use_crop_to_border,render.pixel_aspect_x,render.pixel_aspect_y,
        tuple((s.identifier,s.type,s.enabled,s.is_unavailable,tuple((l.is_valid,l.is_muted)for l in s.links))for s in node.inputs if s.enabled and not s.is_unavailable))


def normalize_noise(node, socket, op, scene, stack, fail, read_fixed):
    """read_fixed is the existing raw homogeneous socket-copy policy.

    Only the node's own default Uniform Vector is admitted. ALL active scalar
    controls must be unlinked, even when mathematically unused: native field
    dependencies can still determine compositor scheduling/domain.
    """
    if (tuple(bpy.app.version)!=(5,3,0) or bpy.app.build_hash!=b'02f0899d78e3'
            or sys.platform!='darwin' or platform.machine()!='arm64'
            or scene.render.compositor_device!='CPU'):
        fail(socket,'Noise requires its pinned Blender5.3 macOS arm64 CPU compositor source profile')
    if not scene.render.use_compositing or scene.compositing_node_group is None:
        fail(socket,'Noise requires an enabled actual scene compositor root')
    if (node.bl_idname!='ShaderNodeTexNoise' or node.mute or node.noise_dimensions!='2D'
            or node.noise_type!='FBM' or node.normalize is not True
            or socket.identifier not in {'Fac','Color'}
            or socket.type!=('VALUE' if socket.identifier=='Fac' else 'RGBA')):
        fail(socket,'Noise requires active native default2D normalized FBM Fac/Color schema')
    mapping=node.texture_mapping
    if (list(mapping.translation)!=[0,0,0] or list(mapping.rotation)!=[0,0,0]
            or list(mapping.scale)!=[1,1,1] or mapping.use_min or mapping.use_max):
        fail(socket,'Noise requires original identity texture mapping without clipping')
    def active(name,kind):
        matches=[s for s in node.inputs if s.identifier==name and s.type==kind and s.enabled and not s.is_unavailable]
        if len(matches)!=1:fail(socket,'Noise active native socket schema changed: '+name)
        return matches[0]
    def linked(s):return s.is_linked or bool(s.links)
    if sorted(s.identifier for s in node.inputs if s.enabled and not s.is_unavailable)!=sorted(['Vector',*DEFAULTS]):
        fail(socket,'Noise active native input census changed')
    vector=active('Vector','VECTOR')
    incoming=[active(name,'VALUE')for name in DEFAULTS]
    if linked(vector) or any(linked(s)for s in incoming):
        fail(socket,'Noise requires its own unlinked Uniform Vector and ALL five unlinked original scalar controls; linked scheduling dependencies refuse')
    render=scene.render
    width=render.resolution_x*render.resolution_percentage//100
    height=render.resolution_y*render.resolution_percentage//100
    if (render.compositor_precision not in {'AUTO','FULL'} or render.use_border or render.use_crop_to_border
            or render.pixel_aspect_x!=1 or render.pixel_aspect_y!=1 or not(4<=width<=8192 and 4<=height<=8192)):
        fail(socket,'Noise requires CPU Float32 AUTO/FULL, zero-origin full-frame square pixels and physical extents4..8192')
    # The canonical raw reader rejects signed-zero/subnormal/nonfinite words
    # before Python promotion and performs existing node/tree animation checks.
    shape=source_shape(node,scene)
    try:values,members=read_fixed(incoming,stack)
    except ValueError as error:fail(socket,'Noise raw fixed-input source: '+str(error))
    if source_shape(node,scene)!=shape:fail(socket,'Noise source/context changed during raw socket copy')
    if (len(values)!=len(DEFAULTS) or any(isinstance(v,bool) or not isinstance(v,(int,float))
            or not math.isfinite(v) or v!=wanted or v==0 and math.copysign(1,v)<0
            for v,wanted in zip(values,DEFAULTS.values()))):
        fail(socket,'Noise requires exact original Scale5 Detail2 Roughness.5 Lacunarity2 Distortion+0')
    for name,value in zip(DEFAULTS,values):
        op['inputs'][name]={'name':name,'socketType':'VALUE','value':{'kind':'constant','type':'VALUE','value':value}}
    op['properties'].update(noise_model=MODEL,noise_profile=PROFILE,noise_kernel=KERNEL,
        noise_version=list(bpy.app.version),noise_build=bpy.app.build_hash.decode(),noise_evaluator='CPU-MF',
        noise_dimensions=2,noise_type='FBM',noise_normalize=True,noise_fixed_sources=members,
        noise_coordinate_model=COORDINATES,noise_reference_model='full-frame-context-zero-offset-v1',
        noise_export_extent=[width,height],noise_precision='CPU_FLOAT32',noise_requested_precision=render.compositor_precision)

    return (shape,tuple(values),tuple(tuple(sorted(member.items()))for member in members))


def _proven_noise_topology(program):
    """Only the native/direct and three identity compositions in the proof.

    No general downstream precision propagation is claimed. In particular a
    broad pointwise whitelist cannot bound amplification of approximate RGB.
    """
    ops=program['ops'];by_id={op['id']:op for op in ops};used=set()
    if len(by_id)!=len(ops)or any(not isinstance(key,str)or not key for key in by_id):return False
    def keys(value,wanted):return isinstance(value,dict)and set(value)==set(wanted)
    def ref(value,kind):
        if not keys(value,('kind','node','type'))or value['kind']!='ref'or value['type']!=kind:raise ValueError()
        op=by_id[value['node']]
        if op['type']!=kind:raise ValueError()
        used.add(op['id']);return op
    def input(op,name,kind):
        item=op['inputs'][name]
        if not keys(item,('name','socketType','value'))or item['name']!=('Value'if name=='Value_001'else name)or item['socketType']!=kind:raise ValueError()
        return item['value']
    def linked(op,name,kind):return ref(input(op,name,kind),kind)
    def constant(op,name,value):
        v=input(op,name,'VALUE')
        if not keys(v,('kind','type','value'))or v['kind']!='constant'or v['type']!='VALUE'or type(v['value'])not in(int,float)or v['value']!=value:raise ValueError()
    def source(op,kind,node_type,output=None):
        actual=op['source']
        if not keys(actual,('path','node','nodeType','output'))or not isinstance(actual['path'],list)or not all(isinstance(v,str)for v in actual['path'])or not isinstance(actual['node'],str)or not actual['node']or op['kind']!=kind or actual['nodeType']!=node_type or output is not None and actual['output']!=output:raise ValueError()
    def physical(op):return (tuple(op['source']['path']),op['source']['node'])
    def leaf(op,output):
        source(op,'noise-texture','ShaderNodeTexNoise',output)
        if op['type']!=('VALUE'if output=='Fac'else'RGBA'):raise ValueError()
        return op
    try:
        output=program['output']
        if output.get('kind')=='convert':
            if not keys(output,('kind','fromType','type','input'))or output['fromType']!='VALUE'or output['type']!='RGBA':return False
            leaf(ref(output['input'],'VALUE'),'Fac');return len(ops)==1
        root=ref(output,'RGBA')
        if root['kind']=='noise-texture':leaf(root,'Color');return len(ops)==1
        source(root,'combine-color','CompositorNodeCombineColor','Image')
        if root['properties'].get('mode')!='RGB'or set(root['inputs'])!={'Red','Green','Blue','Alpha'}:return False
        alpha_extra=0
        alpha=input(root,'Alpha','VALUE')
        if alpha.get('kind')=='ref':
            literal=ref(alpha,'VALUE')
            if literal['kind']!='value'or type(literal.get('value'))not in(int,float)or literal['value']!=1 or literal['inputs']!={}:return False
            actual=literal['source']
            if not keys(actual,('path','node','nodeType','output'))or not isinstance(actual['path'],list)or not all(isinstance(v,str)for v in actual['path'])or not all(isinstance(actual[k],str)and actual[k]for k in ('node','nodeType','output')):return False
            alpha_extra=1
        else:constant(root,'Alpha',1)
        def separate(name,channel):
            op=linked(root,name,'VALUE');source(op,'separate-color','CompositorNodeSeparateColor',channel)
            if op['properties'].get('mode')!='RGB'or set(op['inputs'])!={'Image'}:raise ValueError()
            return leaf(linked(op,'Image','RGBA'),'Color')
        red=linked(root,'Red','VALUE')
        if red['kind']=='noise-texture':
            fac=leaf(red,'Fac');green=separate('Green','Green');blue=separate('Blue','Blue')
            return len(ops)==5+alpha_extra and len(used)==len(ops) and green['id']==blue['id']and physical(fac)==physical(green)
        if red['kind']=='separate-color':
            a=separate('Red','Red');green=separate('Green','Green');blue=separate('Blue','Blue')
            return len(ops)==6+alpha_extra and len(used)==len(ops) and green['id']==blue['id']and a['id']!=green['id']and physical(a)!=physical(green)
        leaves=[]
        for name in ('Red','Green','Blue'):
            half=linked(root,name,'VALUE');source(half,'math','ShaderNodeMath','Value')
            if half['properties'].get('operation')!='MULTIPLY'or half['properties'].get('use_clamp')is not False or set(half['inputs'])!={'Value','Value_001'}:return False
            constant(half,'Value_001',.5)
            add=linked(half,'Value','VALUE');source(add,'math','ShaderNodeMath','Value')
            if add['properties'].get('operation')!='ADD'or add['properties'].get('use_clamp')is not False or set(add['inputs'])!={'Value','Value_001'}:return False
            leaves.extend(leaf(linked(add,input_name,'VALUE'),'Fac')for input_name in ('Value','Value_001'))
        return len(ops)==13+alpha_extra and len(used)==len(ops) and len({op['id']for op in leaves})==6 and len({physical(op)for op in leaves})==6
    except (KeyError,TypeError,ValueError):return False


def validate_noise_graph(program):
    fields=[op for op in program['ops']if op.get('properties',{}).get('noise_model')==MODEL]
    if not fields:return None
    if program.get('passes')!=[]or program.get('images'):return fields[0],'Noise requires no declared scene-pass/image inputs'
    if sum(9 if op['source']['output']=='Color'else 3 for op in fields)>18:return fields[0],'Noise exceeds its eighteen-Perlin-call source/code budget'
    if not _proven_noise_topology(program):return fields[0],'Noise requires proven pointwise topology only: direct/group forwarding, shared Fac/Color RGB, two-Color RGB or six-Fac pair means; all operations must contribute with exact typed edges. Other consumers/amplification remain unqualified'
    return None

def validate_noise_presentation(result):
    program=result.get('compositor')
    if not program or program.get('status')!='extracted':return None
    conflict=validate_noise_graph(program)
    if conflict:return conflict
    fields=[op for op in program['ops']if op.get('properties',{}).get('noise_model')==MODEL]
    ops=result.get('display',{}).get('ops',[])
    if fields and (not isinstance(ops,list)or 1+sum(op.get('type')in {'Lut1DTransform','Lut3DTransform'}for op in ops)>8):return fields[0],'Noise axis/display sampler budget is eight'
    return None
