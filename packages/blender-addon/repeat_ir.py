# SPDX-License-Identifier: GPL-3.0-or-later
"""Bounded static EEVEE Repeat zones. Animation remains a separate transport."""
from contextvars import ContextVar
from functools import wraps
import math
import platform
import sys
MODEL='eevee-static-repeat-53-v1'
SOURCE_PROFILE='darwin-arm64-eevee-metal-repeat-53-v1'
NODES={'GeometryNodeRepeatInput','GeometryNodeRepeatOutput'}
MAX_ITERATIONS=64
MAX_STATES=4
MAX_BODY_NODES=256
MAX_WORK=8192
_context=ContextVar('scenetoweb_repeat_emission',default=None)
class RepeatUnsupported(ValueError):pass

def guarded_emission(function):
    @wraps(function)
    def run(*args,**kwargs):
        context=_context.get()
        if context is None:return function(*args,**kwargs)
        context['visits']+=1
        if context['visits']>2048 or len(context['path'])>64:raise RepeatUnsupported('Repeat exceeds bounded source emission work')
        value=args[0];socket=args[1]if function.__name__=='emit_output'else value
        node=value if function.__name__=='emit_output'else value.node
        stack=kwargs.get('stack',args[2]if len(args)>2 else args[1]if len(args)>1 and function.__name__=='emit_input'else())
        if len(stack)>16:raise RepeatUnsupported('Repeat group traversal exceeds depth16')
        key=(function.__name__,node.as_pointer(),socket.identifier,tuple(item.as_pointer()for item in stack))
        if key in context['path']:raise RepeatUnsupported('Repeat has a reachable source graph cycle')
        context['path'].add(key)
        try:return function(*args,**kwargs)
        finally:context['path'].remove(key)
    return run

def schema(node,output,stack=()):
    import bpy
    if (tuple(bpy.app.version)!=(5,3,0)or bpy.app.build_hash!=b'02f0899d78e3'
            or node.id_data.bl_idname!='ShaderNodeTree' or sys.platform!='darwin'
            or platform.machine()!='arm64' or bpy.context.preferences.system.gpu_backend!='METAL'):
        raise RepeatUnsupported('Repeat needs its measured Blender5.3 macOS arm64 EEVEE Metal shader source profile')
    animation=getattr(node.id_data,'animation_data',None)
    if animation and(animation.action or len(animation.drivers)or len(animation.nla_tracks)):raise RepeatUnsupported('Repeat animation/drivers need live timeline transport; current-frame capture is not live')
    starts=[item for item in node.id_data.nodes if item.bl_idname=='GeometryNodeRepeatInput'and item.paired_output==node]
    if node.bl_idname!='GeometryNodeRepeatOutput'or len(starts)!=1:raise RepeatUnsupported('Repeat needs one uniquely paired Input/Output zone')
    start=starts[0];items=list(node.repeat_items)
    inputs=[s for s in start.inputs if s.identifier!='__extend__'];outputs=[s for s in start.outputs if s.identifier!='__extend__'];body=[s for s in node.inputs if s.identifier!='__extend__'];result=[s for s in node.outputs if s.identifier!='__extend__']
    if not 1<=len(items)<=MAX_STATES or len(inputs)!=len(items)+1 or len(outputs)!=len(items)+1 or len(body)!=len(items)or len(result)!=len(items):raise RepeatUnsupported('Repeat needs1..4 native typed state items')
    if inputs[0].identifier!='Iterations'or inputs[0].type!='INT'or outputs[0].identifier!='Iteration'or outputs[0].type!='INT':raise RepeatUnsupported('Repeat iteration counter schema changed')
    kinds=[]
    for item,a,b,c,d in zip(items,inputs[1:],outputs[1:],body,result):
        kind={'FLOAT':'VALUE','VECTOR':'VECTOR'}.get(item.socket_type)
        if kind is None or len({s.identifier for s in[a,b,c,d]})!=1 or any(s.type!=kind for s in[a,b,c,d]):raise RepeatUnsupported('Repeat qualifies native Float/3D Vector states only')
        if kind=='VECTOR'and any(len(s.default_value)!=3 for s in[a,b,c,d]):raise RepeatUnsupported('Repeat vector state must have three components')
        kinds.append(kind)
    if output.identifier not in[s.identifier for s in result]or output.type!=kinds[[s.identifier for s in result].index(output.identifier)]:raise RepeatUnsupported('Repeat output is not a qualified state item')
    if __package__:from .static_selection import _literal
    else:from static_selection import _literal
    try:count=_literal(inputs[0],stack,[128])
    except ValueError as error:raise RepeatUnsupported('Repeat iterations need a fixed typed Integer source: '+str(error))from error
    if isinstance(count,bool)or not isinstance(count,int)or not 0<=count<=MAX_ITERATIONS:raise RepeatUnsupported('Repeat requires a fixed typed iteration count0..64')
    return start,inputs[1:],body,kinds,count,[s.identifier for s in result].index(output.identifier)

def dependencies(node,output,stack=()):
    start,seeds,body,kinds,count,index=schema(node,output,stack)
    return [seeds[index]]if count==0 else seeds+body

def _nodes(value):
    if isinstance(value,dict):
        yield value
        for item in value.values():yield from _nodes(item)
    elif isinstance(value,list):
        for item in value:yield from _nodes(item)

def validate(expression,seed=False):
    allowed={'const_float','const_vec3','combine'}if seed else{'const_float','const_vec3','repeat_state','repeat_iteration','typed_convert','math','vector_math','vector_scale','combine'}
    count=0
    for item in _nodes(expression):
        if'op'not in item:continue
        count+=1
        if item['op']not in allowed:raise RepeatUnsupported('Repeat body/seed uses an unqualified operation; textures, derivatives, nested zones and dynamic execution need separate proof')
        if item['op']in{'math','vector_math'}and item.get('operation')not in({'MINIMUM','MAXIMUM','SNAP'}if seed else{'ADD','SUBTRACT'}):raise RepeatUnsupported('Repeat first body slice supports bounded independent own-state add/sub accumulation only')
        if item['op']=='vector_scale':raise RepeatUnsupported('Repeat multiplication recurrence needs separate error and range proof')
        if item['op']=='typed_convert'and(item.get('fromType')!='INT'or item.get('toType')not in{'VALUE','VECTOR'}):raise RepeatUnsupported('Repeat counter conversion is limited to Float/Vector')
        if item['op']in{'const_float','const_vec3'}:
            values=item['value']if isinstance(item['value'],list)else[item['value']]
            if any(not math.isfinite(x)or abs(x)>16 or x*16!=int(x*16)or x==0 and math.copysign(1,x)<0 for x in values):raise RepeatUnsupported('Repeat constants require sixteenth-grid values within+/-16')
    if count>MAX_BODY_NODES:raise RepeatUnsupported('Repeat body exceeds256 serialized operations')
    return count

def seed_shape(expression):
    op=expression.get('op')
    if op in{'const_float','const_vec3'}:return True
    if op=='combine':return all(seed_shape(expression.get(key,{}))for key in'xyz')
    return False

def _state(expression):return expression.get('op')=='repeat_state'
def _step(expression):
    if expression.get('op')in{'const_float','const_vec3'}:return True
    return expression.get('op')=='typed_convert'and expression.get('input',{}).get('op')=='repeat_iteration'
def body_shape(expression,index):
    if _state(expression):return expression.get('index')==index
    if expression.get('op')in{'math','vector_math'}and expression.get('operation')in{'ADD','SUBTRACT'}:
        return _state(expression.get('a',{}))and expression['a'].get('index')==index and _step(expression.get('b',{}))
    return False

def emit_repeat(node,output,stack,emit_input,refuse,engine):
    context=_context.get()
    if node.bl_idname=='GeometryNodeRepeatInput':
        if context is None or context['phase']!='body'or context['start']!=node:raise RepeatUnsupported('Repeat Input requires its own paired active body context')
        if output.identifier=='Iteration':return {'op':'repeat_iteration','type':'INT'}
        matches=[i for i,s in enumerate(context['seeds'])if s.identifier==output.identifier]
        if len(matches)!=1:raise RepeatUnsupported('Repeat Input state identifier changed')
        return {'op':'repeat_state','index':matches[0],'type':output.type}
    if context is not None:raise RepeatUnsupported('Nested or chained Repeat zones need an independent cost/error contract')
    if engine!='EEVEE':raise RepeatUnsupported('Repeat live shader scope uses EEVEE; Cycles needs separate qualification or baking')
    start,seeds,body,kinds,count,index=schema(node,output,stack)
    context={'visits':0,'path':set(),'phase':'seed','start':start,'seeds':seeds};token=_context.set(context)
    try:
        if count==0:return emit_input(seeds[index],stack=stack,as_vector=kinds[index]=='VECTOR')
        initial=[emit_input(s,stack=stack,as_vector=k=='VECTOR')for s,k in zip(seeds,kinds)]
        for item in initial:
            if not seed_shape(item):raise RepeatUnsupported('Repeat positive iterations require bounded literal seeds; UV fields including clamped SNAP have no qualified phase-margin producer contract')
            validate(item,True)
        context['phase']='body'
        updates=[emit_input(s,stack=stack,as_vector=k=='VECTOR')for s,k in zip(body,kinds)]
        cost=sum(validate(item)for item in updates)
        if any(not body_shape(item,i)for i,item in enumerate(updates)):raise RepeatUnsupported('Repeat qualifies own-state copy/add/sub only; cross-state aliases and constant overwrites need separate native assignment semantics')
        if cost*count>MAX_WORK:raise RepeatUnsupported('Repeat exceeds8192 iteration-weighted body operations')
        return {'op':'repeat_static','model':MODEL,'sourceProfile':SOURCE_PROFILE,'sourceVersion':[5,3,0],'sourceBuild':'02f0899d78e3','iterations':count,'output':index,'states':[{'type':kind,'initial':seed,'body':update}for kind,seed,update in zip(kinds,initial,updates)]}
    finally:_context.reset(token)
