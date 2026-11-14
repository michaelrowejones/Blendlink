# SPDX-License-Identifier: GPL-3.0-or-later
"""Closed binary CPU Mix over one current full-frame scene image."""
from array import array
import math
import struct
MODEL = 'native-cpu-binary-half-frame-v1'
FRAME_MODEL = 'three-r184-half-msaa0-physical-load-v1'

def _word(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):return None
    try:
        packed = struct.pack('<f', value)
        if struct.unpack('<f', packed)[0] != value:return None
        return struct.unpack('<I', packed)[0]
    except (OverflowError,struct.error):return None

def _positive(value):
    word = _word(value)
    return word is not None and (word == 0 or 0x00800000 <= word <= 0x3f800000)

def _ref(value, op, typ):
    return value == {'kind':'ref','type':typ,'node':op['id']}

def ellipse_scene_mix_contract(graph, *, require_model=True):
    """Return the one closed composition, never a general sampler exemption."""
    ops = graph.get('ops',[])
    if len(ops) != 3 or len({op.get('id') for op in ops}) != 3 or graph.get('outputAlpha') is not None or graph.get('images'):return None
    by_kind = {op.get('kind'):op for op in ops}
    if set(by_kind) != {'render-pass','ellipse-mask','mix'}:return None
    render,mask,mix = (by_kind[k] for k in ('render-pass','ellipse-mask','mix'))
    p = mix.get('properties',{});mp = mask.get('properties',{});rp = render.get('pass',{})
    if (mix.get('type') != 'RGBA' or mix.get('source',{}).get('nodeType') != 'ShaderNodeMix' or mix['source'].get('output') != 'Result_Color'
        or p.get('data_type') != 'RGBA' or p.get('blend_type') != 'MIX' or p.get('clamp_factor') is not True or p.get('clamp_result') is not False
        or p.get('evaluation_device') != 'CPU' or p.get('color_conversion_device') != 'CPU'
        or not _ref(graph.get('output'),mix,'RGBA')):return None
    if (mask.get('type') != 'VALUE' or mask.get('source',{}).get('nodeType') != 'CompositorNodeEllipseMask' or mask['source'].get('output') != 'Mask'
        or mp.get('ellipse_mask_operation') != 'ADD' or mp.get('ellipse_mask_mask') != 0 or _word(mp.get('ellipse_mask_mask')) != 0
        or mp.get('ellipse_mask_value') != 1 or mp.get('ellipse_mask_identity') is not False
        or mask.get('inputs') != {}):return None
    if (render.get('source',{}).get('nodeType') != 'CompositorNodeRLayers' or render.get('inputs') != {}
        or rp.get('pass') not in {'Image','Alpha'} or rp.get('name') != rp.get('pass') or rp.get('aov') is not None
        or not all(isinstance(rp.get(k),str) and rp[k] for k in ('scene','viewLayer'))
        or render['source'].get('output') != rp['pass'] or rp.get('type') != ('RGBA' if rp['pass']=='Image'else 'VALUE')
        or render.get('type') != rp.get('type') or graph.get('passes') != [rp]):return None
    inputs = mix.get('inputs',{})
    if set(inputs) != {'Factor_Float','A_Color','B_Color'}:return None
    if not _ref(inputs['Factor_Float'].get('value'),mask,'VALUE'):return None
    source = {'kind':'ref','type':render['type'],'node':render['id']}
    if render['type'] == 'VALUE':source = {'kind':'convert','fromType':'VALUE','type':'RGBA','input':source}
    side = 'A' if inputs['A_Color'].get('value') == source else 'B' if inputs['B_Color'].get('value') == source else None
    if side is None:return None
    background = inputs['B_Color' if side=='A'else 'A_Color'].get('value',{})
    values = background.get('value')
    if (background.get('kind') != 'constant' or background.get('type') != 'RGBA' or set(background) != {'kind','type','value'}
        or not isinstance(values,list) or len(values) != 4 or not all(_positive(v) for v in values)):return None
    if require_model and (p.get('ellipse_scene_mix_model') != MODEL or p.get('ellipse_scene_mix_frame_model') != FRAME_MODEL
        or p.get('ellipse_scene_mix_owner') != [rp['scene'],rp['viewLayer']] or p.get('ellipse_scene_mix_direction') != side
        or p.get('ellipse_scene_mix_background_words') != [_word(v) for v in values]):return None
    return {'render':render,'mask':mask,'mix':mix,'side':side,'background':values}

def normalize_ellipse_scene_mix(graph, scene, source_nodes):
    """Qualify native owner and raw authored storage before stamping the ABI."""
    if not any(op.get('kind')=='ellipse-mask' for op in graph['ops']) or not any(op.get('kind')=='render-pass' for op in graph['ops']):return
    contract = ellipse_scene_mix_contract(graph,require_model=False)
    if contract is None:raise ValueError('Ellipse scene composition requires one direct Image/Alpha source, binary ADD factor, and modern RGBA/MIX with an unlinked bounded positive background')
    import bpy
    render, mix = contract['render'],contract['mix'];node=source_nodes[render['id']];native_mix=source_nodes[mix['id']]
    if bpy.context.scene != scene or bpy.context.view_layer.id_data != scene or (node.scene or scene) != scene or node.layer != bpy.context.view_layer.name:
        raise ValueError('Ellipse scene composition requires the current scene and current exported view layer')
    background = next(s for s in native_mix.inputs if s.identifier == ('B_Color' if contract['side']=='A'else 'A_Color'))
    if background.is_linked:raise ValueError('Ellipse scene Mix background must be an unlinked native Color literal')
    raw = array('f',[0])*4;background.default_value.foreach_get(raw);words=list(struct.unpack('=4I',raw.tobytes()))
    if any(word != 0 and not 0x00800000 <= word <= 0x3f800000 for word in words):
        raise ValueError('Ellipse scene Mix background requires raw positive-zero or positive normal Float32 components at most one')
    if words != [_word(v) for v in contract['background']]:raise ValueError('Ellipse scene Mix background raw storage differs from its serialized values')
    mix['properties'].update(ellipse_scene_mix_model=MODEL,ellipse_scene_mix_frame_model=FRAME_MODEL,
        ellipse_scene_mix_owner=[scene.name,bpy.context.view_layer.name],ellipse_scene_mix_direction=contract['side'],ellipse_scene_mix_background_words=words)
