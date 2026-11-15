# SPDX-License-Identifier: GPL-3.0-or-later
"""Static native int3 constructor; presentation is distinct from Pixel int2."""
import platform
import sys
import bpy
MODEL='native-int3-constant-53-v1'
PROFILE='darwin-arm64-53-int3-cpu-v1'
PRESENTATION='component-rne-f32-alpha-one-v1'

class IntegerVectorUnsupported(ValueError):
    pass

def _static(owner):
    animation=getattr(owner,'animation_data',None)
    if animation and (animation.action or len(animation.drivers) or len(animation.nla_tracks)):
        raise IntegerVectorUnsupported('Integer Vector requires static source owners; actions, drivers and NLA remain unqualified')

def source_signature(node,socket,scene,stack=()):
    root=getattr(scene,'compositing_node_group',None)
    if (tuple(bpy.app.version)!=(5,3,0) or bpy.app.build_hash!=b'02f0899d78e3'
            or sys.platform!='darwin' or platform.machine()!='arm64'
            or scene.render.compositor_device!='CPU'
            or scene.render.compositor_precision not in {'AUTO','FULL'}
            or not scene.render.use_compositing or root is None):
        raise IntegerVectorUnsupported('Integer Vector requires its pinned Blender 5.3 macOS arm64 CPU compositor AUTO/FULL context')
    if len(stack)>16:
        raise IntegerVectorUnsupported('Integer Vector source group depth exceeds sixteen')
    _static(node.id_data)
    ancestry=[];owner=root
    for instance in stack:
        _static(instance.id_data)
        if instance.id_data!=owner or not getattr(instance,'node_tree',None):
            raise IntegerVectorUnsupported('Integer Vector source group ownership changed')
        ancestry.append((instance.as_pointer(),instance.id_data.as_pointer(),instance.node_tree.as_pointer()))
        owner=instance.node_tree
    if node.id_data!=owner or node.bl_idname!='FunctionNodeInputIntVector' or node.mute or node.vector_dimensions!=3:
        raise IntegerVectorUnsupported('Integer Vector admits only the unmuted native three-component constructor; other widths remain unqualified')
    if (len(node.inputs)!=0 or len(node.outputs)!=1 or socket!=node.outputs[0]
            or socket.identifier!='Vector' or socket.name!='Vector' or socket.type!='INT_VECTOR'
            or socket.bl_idname!='NodeSocketIntVector3D' or not socket.enabled or socket.is_unavailable
            or len(socket.default_value)!=3):
        raise IntegerVectorUnsupported('Integer Vector native int3 output schema changed')
    raw=tuple(node.vector)
    if len(raw)!=3 or any(isinstance(v,bool)or not isinstance(v,int)or not -2147483648<=v<=2147483647 for v in raw):
        raise IntegerVectorUnsupported('Integer Vector source property must retain three exact signed Int32 components')
    return (node.as_pointer(),node.id_data.as_pointer(),raw,tuple(ancestry),
            scene.as_pointer(),root.as_pointer(),scene.frame_current,scene.frame_subframe,scene.render.compositor_precision)

def normalize(node,socket,op,scene,stack,fail):
    try:signature=source_signature(node,socket,scene,stack)
    except IntegerVectorUnsupported as error:fail(socket,str(error))
    op['type']='INT_VECTOR3'
    op['value']=list(signature[2])
    op['properties'].update(integer_vector_model=MODEL,integer_vector_profile=PROFILE,
        integer_vector_version=[5,3,0],integer_vector_build='02f0899d78e3',integer_vector_dimensions=3,
        integer_vector_precision='CPU_INT32',integer_vector_presentation=PRESENTATION)
    return signature

def validate_edge(value,socket):
    if value.get('type')!='INT_VECTOR3':return socket.type
    if socket.type=='INT_VECTOR' and socket.bl_idname=='NodeSocketIntVector3D' and len(socket.default_value)==3:
        return 'INT_VECTOR3'
    if socket.type=='RGBA' and socket.bl_idname=='NodeSocketColor':return 'RGBA'
    if socket.type=='VECTOR' and socket.bl_idname=='NodeSocketVector' and len(socket.default_value)==3:return 'VECTOR'
    raise IntegerVectorUnsupported('Integer Vector permits only typed int3 forwarding and explicit float3/RGBA presentation; scalar, Boolean and other widths remain unqualified')

def validate_graph(program):
    family=[op for op in program['ops']if op['kind']=='integer-vector']
    if not family:return None
    op=family[0]
    def ref(value):return value=={'kind':'ref','node':op['id'],'type':'INT_VECTOR3'}
    output=program.get('output')or{}
    direct=(output.get('kind')=='convert' and output.get('fromType')=='INT_VECTOR3' and output.get('type')=='RGBA' and ref(output.get('input')))
    vector=output.get('input')or{}
    through_vector=(output.get('kind')=='convert' and output.get('fromType')=='VECTOR' and output.get('type')=='RGBA'
        and vector.get('kind')=='convert' and vector.get('fromType')=='INT_VECTOR3' and vector.get('type')=='VECTOR' and ref(vector.get('input')))
    if len(program['ops'])!=1 or program.get('passes')or not(direct or through_vector):
        return op,'Integer Vector first scope requires one terminal constructor with direct RGBA or explicit float3-to-RGBA presentation; consumers and additional operations remain unqualified'
    return None
