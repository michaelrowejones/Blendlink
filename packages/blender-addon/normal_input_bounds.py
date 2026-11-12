# SPDX-License-Identifier: GPL-3.0-or-later
"""Conservative finite ranges for native tangent-normal inputs.

Ranges come from actual serialized pixels or the actual Blender image buffer,
not a caller-supplied assertion. Runtime independently inspects the published
decoded texture. This is a zero/float32-domain proof, not a mip fidelity claim.
"""
import math
import bpy
import numpy as np

if __package__:
    from . import geometry_ir
else:
    import geometry_ir


def fail():raise ValueError('Normal Map tangent input has no verified finite range; use supported bounded image/procedural inputs')


def pixel_ranges(values,alpha):
    pixels=np.asarray(values,dtype=np.float32).reshape(-1,4)
    if not len(pixels) or not np.isfinite(pixels).all():fail()
    if alpha:
        lo,hi=float(pixels[:,3].min()),float(pixels[:,3].max())
        return [(lo,hi)]*3
    if np.any(pixels[:,3]!=1):
        raise ValueError('Normal Map tangent Color currently needs opaque image data; alpha association needs its own range proof')
    return [(float(pixels[:,axis].min()),float(pixels[:,axis].max())) for axis in range(3)]


def image_ranges(expression):
    alpha=expression.get('output')=='alpha'
    if expression.get('op')=='tex_image':
        if expression.get('sourceImageStorage')!='rgba8':
            raise ValueError('Normal Map tangent embedded image ranges currently need byte storage; float upload rounding needs a separate certificate')
        result=pixel_ranges(expression.get('pixels'),alpha)
    else:
        descriptor=expression.get('image') or {};image=bpy.data.images.get(descriptor.get('name',''))
        if image is None or image.is_float or image.file_format!='PNG' or tuple(image.size)!=(descriptor.get('width'),descriptor.get('height')):
            raise ValueError('Normal Map tangent external image ranges need an actual bound byte PNG')
        if image.size[0]*image.size[1]>4096*4096:
            raise ValueError('Normal Map tangent image-range inspection exceeds its 16-million-pixel budget')
        if not alpha and image.colorspace_settings.name not in {'Non-Color','Raw'}:
            raise ValueError('Normal Map tangent external Color currently needs non-color image data')
        cache=geometry_ir._validation_cache.get();key=('normal-image-range',image.as_pointer(),alpha)
        if cache is not None and key in cache:return cache[key]
        values=np.empty(len(image.pixels),dtype=np.float32);image.pixels.foreach_get(values)
        result=pixel_ranges(values,alpha)
        if cache is not None:cache[key]=result
    if expression.get('extension')=='CLIP':result=[(min(0,lo),max(0,hi)) for lo,hi in result]
    return result


def bounds(expression):
    if not isinstance(expression,dict):fail()
    op=expression.get('op')
    if op=='const_float':result=[(expression.get('value'),)*2]*3
    elif op=='const_vec3':result=[(value,value) for value in expression.get('value',[])]
    elif op=='combine':result=[bounds(expression.get(axis))[0] for axis in ('x','y','z')]
    elif op=='separate':result=[bounds(expression.get('input'))[{'x':0,'y':1,'z':2}.get(expression.get('channel'),0)]]*3
    elif op=='color_convert' and expression.get('mode')=='RGB':result=bounds(expression.get('input'))
    elif op=='rgb_to_bw':
        incoming=bounds(expression.get('input'));lo,hi=min(lo for lo,hi in incoming),max(hi for lo,hi in incoming)
        padding=max(1,abs(lo),abs(hi))*2**-22;result=[(lo-padding,hi+padding)]*3
    elif op in {'tex_image','texture_ref'}:result=image_ranges(expression)
    elif op=='tex_checker':
        if expression.get('output')=='fac':result=[(0,1)]*3
        else:result=[(min(a[0],b[0]),max(a[1],b[1])) for a,b in zip(bounds(expression.get('color1')),bounds(expression.get('color2')))]
    elif op=='mix_color' and expression.get('blendType')=='MIX' and expression.get('clampFactor',True):
        bounds(expression.get('factor'))
        result=[(min(a[0],b[0]),max(a[1],b[1])) for a,b in zip(bounds(expression.get('a')),bounds(expression.get('b')))]
        result=[(lo-max(1,abs(lo),abs(hi))*2**-22,hi+max(1,abs(lo),abs(hi))*2**-22) for lo,hi in result]
        if expression.get('clampResult'):
            result=[(max(0,min(1,lo)),max(0,min(1,hi))) for lo,hi in result]
    elif op=='math' and expression.get('operation') in {'ADD','SUBTRACT','MULTIPLY','MINIMUM','MAXIMUM'}:
        a,b=bounds(expression.get('a')),bounds(expression.get('b'));result=[]
        for left,right in zip(a,b):
            operation=expression['operation']
            values=[x+y if operation=='ADD' else x-y if operation=='SUBTRACT' else x*y if operation=='MULTIPLY' else min(x,y) if operation=='MINIMUM' else max(x,y) for x in left for y in right]
            lo,hi=min(values),max(values);padding=max(1,abs(lo),abs(hi))*2**-22
            result.append((lo-padding,hi+padding))
    elif op=='clamp01':
        bounds(expression.get('input'));result=[(0,1)]*3
    else:fail()
    if len(result)!=3 or any(not isinstance(value,(int,float)) or not math.isfinite(value) or abs(value)>16 for pair in result for value in pair):fail()
    return result


def coefficients(color,strength,convention):
    rgb=bounds(color);s=bounds(strength)[0]
    decoded=[(2*lo-1,2*hi-1) for lo,hi in rgb]
    if convention=='DIRECTX':decoded[1]=(-decoded[1][1],-decoded[1][0])
    result=[]
    for pair in decoded[:2]:
        values=[value*amount for value in pair for amount in s];result.append((min(values),max(values)))
    values=[1+(value-1)*max(0,min(1,amount)) for value in decoded[2] for amount in s]
    result.append((min(values),max(values)))
    # Every endpoint is expanded before the native float32 composition.
    result=[(lo-max(1,abs(lo),abs(hi))*2**-21,hi+max(1,abs(lo),abs(hi))*2**-21) for lo,hi in result]
    minimum=math.sqrt(sum((lo if lo>0 else -hi if hi<0 else 0)**2 for lo,hi in result))
    maximum=sum(max(abs(lo),abs(hi)) for lo,hi in result)
    if minimum<=0:raise ValueError('Normal Map tangent input ranges cannot certify a nonzero native normal')
    return minimum,maximum


def certify(frame,condition,minimum,maximum):
    least=frame['normalCosine']*frame['tangentCosine']*frame['sine']/(2*condition**4)
    if least*minimum<=64*2**-23*condition*maximum:
        raise ValueError('Normal Map tangent blend is too poorly conditioned for the verified float32 domain')
