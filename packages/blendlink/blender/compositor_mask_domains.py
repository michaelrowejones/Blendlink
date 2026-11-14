# SPDX-License-Identifier: GPL-3.0-or-later
"""Closed source mask domains and conservative Ellipse sampler admission."""
import math
import struct
FAMILIES = {'CompositorNodeBoxMask': ('box-mask', 'Box Mask', 2048),
            'CompositorNodeEllipseMask': ('ellipse-mask', 'Ellipse Mask', 2048)}
SPATIAL = frozenset({'translate', 'image-affine', 'image-input', 'image-crop', 'alpha-crop',
                     'image-split', 'pixelate', 'blur', 'filter', 'glare', 'flip'})
ELLIPSE_POINTWISE = frozenset({'ellipse-mask','box-mask','value','rgb','utility-constant','math',
    'vector-math','vector-component','combine-vector','separate-vector','combine-color','separate-color',
    'mix','mix-rgb','alpha-over','set-alpha','convert-alpha','exposure','brightness-contrast','invert',
    'gamma','hue-saturation-value','rgb-to-bw','clamp','map-range','map-value','posterize','switch',
    'luminance-key','difference-key','distance-key','chroma-key','channel-key','color-spill','color-key',
    'color-correction','color-balance','normal-direction'})
DISPLAY_LOOKUPS = frozenset({'Lut1DTransform','Lut3DTransform'})

def ellipse_table_count(ops):
    count = 0
    for op in ops:
        if op['kind'] != 'ellipse-mask':continue
        p = op.get('properties', {});size = p.get('ellipse_mask_size')
        if isinstance(size, list) and len(size) == 2 and all(isinstance(n,(int,float)) and math.isfinite(n) for n in size) and any(n == 0 for n in size):continue
        m,v,o = p.get('ellipse_mask_mask'),p.get('ellipse_mask_value'),p.get('ellipse_mask_operation')
        if not all(isinstance(n,(int,float)) and not isinstance(n,bool) and math.isfinite(n) for n in (m,v)):
            count += 1;continue
        f32 = lambda n: struct.unpack('<f',struct.pack('<f',n))[0]
        try:
            inside = max(m,v) if o == 'ADD' else min(1,max(0,f32(m-v))) if o == 'SUBTRACT' else f32(m*v) if o == 'MULTIPLY' else (0 if m > 0 else v) if o == 'NOT' else None
        except (OverflowError,struct.error):inside = None
        outside = 0 if o == 'MULTIPLY' else m
        if inside is None or inside != outside:count += 1
    return count

def validate_mask_domains(result, native_class):
    if native_class not in FAMILIES:raise ValueError('Unknown static mask source class')
    kind,label,limit = FAMILIES[native_class]
    kinds = {family[0]: native for native,family in FAMILIES.items()}
    for op in result['ops']:
        if op['kind'] in kinds and op['source']['nodeType'] != kinds[op['kind']]:
            return op,'Static mask kind does not match its native source class'
    masks = [op for op in result['ops'] if op['kind'] == kind]
    if len(masks) > limit:return masks[0],label+' exceeds its static mask node budget'
    if masks and kind == 'ellipse-mask':
        if ellipse_table_count(result['ops']) > 1:return masks[0],'Ellipse Mask varying row texture budget permits at most one table'
        if any(op['kind'] not in ELLIPSE_POINTWISE for op in result['ops']):return masks[0],'Ellipse Mask requires closed texture-free pointwise composition; other sampler/domain producers remain unqualified'
    elif masks and any(op['kind'] in SPATIAL for op in result['ops']):
        return masks[0],label+' currently requires full-frame pointwise consumers; spatial/domain transformations remain unqualified'
    return None

def validate_mask_presentation(presentation):
    graph = presentation.get('compositor') or {};ops = graph.get('ops',[])
    masks = [op for op in ops if op.get('kind') == 'ellipse-mask']
    if not masks:return None
    display = presentation.get('display') or {}
    lookups = sum(op.get('type') in DISPLAY_LOOKUPS for op in display.get('ops',[]))
    if ellipse_table_count(ops)+lookups > 8:
        return masks[0],'Ellipse Mask combined row/display lookup budget is eight sampled textures'
    return None
