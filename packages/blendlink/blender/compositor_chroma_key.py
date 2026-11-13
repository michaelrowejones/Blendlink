# SPDX-License-Identifier: GPL-3.0-or-later
"""Fixed chromatic key/controls; no source graph or legacy storage mutation."""
import math
import struct
import ctypes
import ctypes.util
from functools import lru_cache
import sys


def _f32(value):
    return struct.unpack('f', struct.pack('f', value))[0]


@lru_cache(maxsize=1)
def _native_math():
    """Use the producing CPU's scalar C math for the fixed key and angle.

    These are authored parameters, not sampled image/matte data. Host double
    trig and NumPy SIMD trig can differ from scalar sinf/cosf/tanf by an ULP.
    """
    # Windows LoadLibrary requires a DLL name; the POSIX process handle
    # (None) is not a valid candidate there. Use the existing system UCRT.
    names = ['ucrtbase.dll'] if sys.platform == 'win32' else [None]
    if sys.platform != 'win32':
        library = ctypes.util.find_library('m')
        if library:
            names.append(library)
    for name in names:
        try:
            library = ctypes.CDLL(name, **({'winmode': 0x800} if sys.platform == 'win32' and name else {}))
            functions = [getattr(library, symbol) for symbol in ('sinf', 'cosf', 'tanf', 'sqrtf', 'atan2f')]
            for index, function in enumerate(functions):
                function.argtypes = (ctypes.c_float,) * (2 if index == 4 else 1)
                function.restype = ctypes.c_float
            return functions
        except (OSError, AttributeError):
            continue
    raise ValueError('Chroma Key requires the native scalar C math functions for its fixed parameters')


def _key_parameters(key, maximum, legacy):
    f = _f32
    red, green, blue = [f(value * 255) for value in key]
    cb = f(f(f(f(f(-.101) * red) - f(f(.338) * green)) + f(f(.439) * blue)) + 128)
    cr = f(f(f(f(f(.439) * red) - f(f(.399) * green)) - f(f(.040) * blue)) + 128)
    divide = (lambda value: f(value * f(1 / 255))) if legacy else (lambda value: f(value / 255))
    cc = [f(f(divide(value) * 2) - 1) for value in (cb, cr)]
    sinf, cosf, tanf, sqrtf, atan2f = _native_math()
    if legacy:
        angle = atan2f(cc[1], cc[0])
        basis = [cosf(angle), sinf(angle)]
    else:
        length = sqrtf(f(f(cc[0] * cc[0]) + f(cc[1] * cc[1])))
        basis = [f(value / length) for value in cc]
    return basis, tanf(f(maximum / 2))


def _source(socket):
    links = [link for link in socket.links if link.is_valid and not getattr(link, 'is_muted', False)]
    return links[0].from_socket if len(links) == 1 else None


def _fixed_scalar(socket):
    if not socket.is_linked:
        return float(socket.default_value)
    source = _source(socket)
    if source is not None and source.node.bl_idname in {'ShaderNodeValue', 'CompositorNodeValue'}:
        return float(source.default_value)
    return None


def _fixed_rgba(socket):
    if not socket.is_linked:
        values=getattr(socket,'default_value',None)
        return list(values) if hasattr(values,'__iter__') else None
    source=_source(socket)
    if source is None:return None
    node=source.node
    if node.bl_idname=='CompositorNodeRGB':return list(source.default_value)
    if node.bl_idname=='CompositorNodeCombineColor' and node.mode=='RGB':
        values=[_fixed_scalar(incoming) for incoming in list(node.inputs)[:4]]
        if all(value is not None for value in values):return values
    return None


def normalize_chroma_key(node,socket,op,scene,read,bounds,fail):
    if socket.identifier not in {'Image','Matte'}:fail(socket,'Chroma Key requires Image or Matte output')
    if getattr(scene.render,'compositor_device','CPU') != 'CPU':
        fail(socket,"Chroma Key currently needs Blender's CPU compositor; GPU-authored threshold decisions are not yet verified. Set the compositor device to CPU")
    modern=node.inputs.get('Minimum') is not None
    controls=[]
    for name,attribute in [('Minimum','threshold'),('Maximum','tolerance'),('Falloff','gain')]:
        incoming=node.inputs.get(name)
        if modern:
            number=_fixed_scalar(incoming)
            if number is None:fail(incoming,'Chroma Key requires fixed scalar Minimum, Maximum and Falloff; use unlinked controls or Value nodes')
            op['inputs'][name]={'name':name,'socketType':incoming.type,'value':read(incoming)}
        else:number=float(getattr(node,attribute))
        controls.append(number)
    minimum,maximum,falloff=controls
    if not all(math.isfinite(number) for number in controls) or not 0<=minimum<=maximum or not struct.unpack('f',struct.pack('f',math.pi/32))[0]<=maximum<=struct.unpack('f',struct.pack('f',math.pi/2))[0] or not 1/64<=falloff<=1:
        fail(socket,'Chroma Key requires 0 <= Minimum <= Maximum, Maximum within [pi/32,pi/2], and Falloff within [1/64,1]')
    if minimum != 0:
        fail(socket,'Chroma Key currently requires Minimum (legacy Cutoff) = 0 for verified soft keying; positive angular cutoffs depend on unverified native atan2 rounding')
    rgba=_fixed_rgba(node.inputs['Key Color'])
    if rgba is None or len(rgba)!=4 or not all(math.isfinite(number) for number in rgba) or not all(0<=number<=1 for number in rgba[:3]):
        fail(node.inputs['Key Color'],'Chroma Key requires a fixed finite RGBA key with RGB within [0,1]; use an unlinked key, RGB node, or fixed RGB Combine Color')
    key=rgba[:3]
    incoming=node.inputs['Key Color']
    # Keep the authored input in the graph even though its proven fixed RGB is
    # transported below. This validates links and preserves single-value facts;
    # the unused Alpha channel must not hide unsupported or cyclic subgraphs.
    op['inputs']['Key Color']={'name':'Key Color','socketType':incoming.type,'value':read(incoming)}
    # Standard BT.709 chroma rows; this only rejects poorly conditioned keys.
    chroma=[2*(sum(a*b for a,b in zip(row,key))+128/255)-1 for row in [(-.101,-.338,.439),(.439,-.399,-.040)]]
    if math.hypot(*chroma)<1/32:fail(node.inputs['Key Color'],'Chroma Key needs a chromatic key with chroma magnitude at least 1/32; neutral/near-neutral keys remain unproved')
    try:
        basis,acceptance=_key_parameters(key,maximum,not modern)
    except ValueError as error:
        fail(socket,str(error))
    op['properties'].update({'chroma_key_model':'native-cpu-fixed-chroma-key-v1','chroma_key_schema':'modern' if modern else 'legacy',
        'chroma_key_controls':controls,'chroma_key_rgb':key,'chroma_key_basis':basis,'chroma_key_acceptance':acceptance})
    incoming=node.inputs['Image'];op['inputs']['Image']={'name':'Image','socketType':incoming.type,'value':read(incoming)}
