# SPDX-License-Identifier: GPL-3.0-or-later
"""Magic coordinate certificates from actual owners/pixels, never IR bounds tags."""
import math
if __package__:
    from . import normal_noise_bounds
    from .magic_ir import control_range
else:
    import normal_noise_bounds
    from magic_ir import control_range
LIMIT=32.001


def requirements(value,result):
    if isinstance(value,dict):
        if value.get('op')=='tex_magic_native':result.append(value)
        for key,child in value.items():
            if key not in {'pixels','values'}:requirements(child,result)
    elif isinstance(value,(tuple,list)):
        for child in value:requirements(child,result)


def ranges(expression,owner=None,depth=0):
    if not isinstance(expression,dict) or depth>32:raise ValueError('Magic Texture coordinates exceed their bounded proof grammar')
    op=expression.get('op');child=lambda key:ranges(expression.get(key),owner,depth+1)
    if op=='const_float':result=[(expression.get('value'),)*2]*3
    elif op=='const_vec3':result=[(x,x) for x in expression.get('value',[])]
    elif op in {'object_coords','generated'}:
        if owner is None:raise ValueError('Magic Texture coordinates require their actual mesh owner')
        result=normal_noise_bounds.coordinate_ranges(expression,owner)
    elif op in {'uv','uv_active'}:
        if owner is None:raise ValueError('Magic Texture UV coordinates require their actual mesh owner')
        layers=owner.data.uv_layers
        name=expression.get('uvMap','')
        layer=layers.get(name) if op=='uv' and name else next((item for item in layers if item.active_render),layers.active)
        if layer is None or not len(layer.data):raise ValueError('Magic Texture UV coordinates need their actual nonempty exported map')
        result=[(min(entry.uv[axis] for entry in layer.data),max(entry.uv[axis] for entry in layer.data)) for axis in range(2)]+[(0,0)]
    elif op=='combine':result=[child(key)[0] for key in ['x','y','z']]
    elif op=='separate' and expression.get('channel') in {'x','y','z'}:
        pair=child('input')[{'x':0,'y':1,'z':2}[expression['channel']]];result=[pair]*3
    elif op=='vector_math' and expression.get('operation') in {'ADD','SUBTRACT','MULTIPLY'}:
        a,b=child('a'),child('b');result=[]
        for left,right in zip(a,b):
            values=[x+y if expression['operation']=='ADD' else x-y if expression['operation']=='SUBTRACT' else x*y for x in left for y in right]
            result.append((min(values),max(values)))
    elif op=='vector_scale':
        scale=child('scale');result=[(min(x*y for x in pair for y in scale[i]),max(x*y for x in pair for y in scale[i])) for i,pair in enumerate(child('input'))]
    elif op=='tex_image' and expression.get('interpolation')=='Closest' and expression.get('output','color')=='color' and expression.get('sourceImageStorage')=='rgba32f' and expression.get('sourceImageUploadRounding')=='none':
        pixels=expression.get('pixels',[])
        if len(pixels)<4 or len(pixels)%4 or len(pixels)>128*128*4 or not all(isinstance(x,(int,float)) and math.isfinite(x) for x in pixels) or any(x!=1 for x in pixels[3::4]):
            raise ValueError('Magic Texture image coordinates need actual finite opaque embedded nearest pixels')
        # This fresh source profile requires float data with Half Precision off.
        # Actual finite opaque payloads and nearest sampling establish bounds.
        result=[]
        for i in range(3):
            values=pixels[i::4];low,high=min(values),max(values)
            result.append((min(0,low),max(0,high)))
    elif op=='clamp01':result=[(0,1)]*3
    elif op=='clamp_minmax':
        low,high=child('min'),child('max')
        if any(a[0]!=a[1] or b[0]!=b[1] for a,b in zip(low,high)):raise ValueError('Magic Texture coordinate Clamp needs fixed limits')
        result=[(min(a[0],b[0]),max(a[0],b[0])) for a,b in zip(low,high)]
    else:raise ValueError('Magic Texture coordinates need actual mesh/opaque nearest pixels or bounded static arithmetic')
    if len(result)!=3 or any(not isinstance(v,(int,float)) or not math.isfinite(v) for pair in result for v in pair):
        raise ValueError('Magic Texture coordinates have no actual finite range')
    return [(lo-max(1,abs(lo),abs(hi))*2**-20,hi+max(1,abs(lo),abs(hi))*2**-20) for lo,hi in result]


def validate_owner(owner,expression):
    if expression.get('evaluationModel')!='shader':return
    if owner.type!='MESH' or owner.data.shape_keys or owner.find_armature() or any(mod.show_render for mod in owner.modifiers):
        raise ValueError('Magic Texture coordinate proof currently requires static authored mesh attributes without skin/morph/modifiers')
    interval=control_range(expression.get('scale'))
    if interval is None:raise ValueError('Magic Texture coordinate proof requires its qualified finite Scale')
    scale=max(map(abs,interval))
    animation=owner.data.animation_data
    if animation and (animation.action or animation.drivers or any(track.strips for track in animation.nla_tracks)):
        raise ValueError('Magic Texture coordinate proof does not yet preserve animated mesh-data attributes')
    if max(abs(v) for pair in ranges(expression['vector'],owner) for v in pair)*abs(scale)>LIMIT:
        raise ValueError('Magic Texture scaled coordinates exceed their verified magnitude32 band; reduce Scale or bound coordinates')
