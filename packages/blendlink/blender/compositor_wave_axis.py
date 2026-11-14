# SPDX-License-Identifier: GPL-3.0-or-later
"""Pinned CPU Wave axis fields. No shader-body reuse or native evaluation."""
import platform
import struct
import sys
import bpy
if __package__:
    from .compositor_white_noise import _active, _raw, _static, WhiteNoiseUnsupported
else:
    from compositor_white_noise import _active, _raw, _static, WhiteNoiseUnsupported
MODEL = 'native-compositor-wave-axis-cpu-53-v1'
PROFILE = 'darwin-arm64-53-wave-saw-tri-cpu-v1'

class WaveAxisUnsupported(ValueError):
    pass

def _context(scene):
    if (tuple(bpy.app.version) != (5,3,0) or bpy.app.build_hash != b'02f0899d78e3'
            or sys.platform != 'darwin' or platform.machine() != 'arm64'
            or scene.render.compositor_device != 'CPU'):
        raise WaveAxisUnsupported('Wave axis requires its pinned Blender 5.3 macOS arm64 CPU compositor profile')
    render=scene.render
    if not render.use_compositing:raise WaveAxisUnsupported('Wave axis source compositor was disabled')
    if render.use_border or render.use_crop_to_border or render.pixel_aspect_x != 1 or render.pixel_aspect_y != 1:
        raise WaveAxisUnsupported('Wave axis requires zero-offset full-frame square pixels without render borders')
    width=render.resolution_x*render.resolution_percentage//100
    height=render.resolution_y*render.resolution_percentage//100
    if not (4 <= width <= 8192 and 4 <= height <= 8192):
        raise WaveAxisUnsupported('Wave axis requires physical extents in [4,8192]')
    if render.compositor_precision not in {'AUTO','FULL'}:
        raise WaveAxisUnsupported('Wave axis requires CPU Float32 AUTO/FULL precision')
    root=scene.compositing_node_group
    return (scene.as_pointer(),scene.frame_current,scene.frame_subframe,width,height,render.compositor_precision,root.as_pointer() if root else None,render.engine)

def source_signature(node,scene):
    context=_context(scene)
    try:
        _static(node)
        if node.bl_idname != 'ShaderNodeTexWave' or node.mute or node.wave_type != 'BANDS' or node.bands_direction not in {'X','Y'} or node.wave_profile not in {'SAW','TRI'}:
            raise WaveAxisUnsupported('Wave axis admits only unmuted Bands X/Y SAW/TRI; SIN, Rings and distortion remain unqualified')
        vector=_active(node.inputs,'Vector','VECTOR')
        if vector.is_linked or len(vector.default_value) != 3:
            raise WaveAxisUnsupported('Wave axis requires its own unlinked native Uniform Vector; linked coordinates are unqualified')
        mapping=node.texture_mapping
        if list(mapping.translation)!=[0,0,0] or list(mapping.rotation)!=[0,0,0] or list(mapping.scale)!=[1,1,1] or mapping.use_min or mapping.use_max:
            raise WaveAxisUnsupported('Wave axis requires identity texture mapping')
        sockets=[_active(node.inputs,name,'VALUE') for name in ('Scale','Phase Offset','Distortion')]
        if any(socket.is_linked for socket in sockets):
            raise WaveAxisUnsupported('Wave axis controls must be unlinked raw Float32 literals')
        # The MF skips distortion arithmetic at +0, but a linked Detail field
        # can still affect native input/domain scheduling before that branch.
        if any(_active(node.inputs,name,'VALUE').is_linked for name in ('Detail','Detail Scale','Detail Roughness')):
            raise WaveAxisUnsupported('Wave axis Detail controls must be unlinked; linked unused-input domain scheduling is unqualified')
        words=tuple(row[0] for row in _raw(sockets,'VALUE'))
    except WhiteNoiseUnsupported as error:
        raise WaveAxisUnsupported(str(error)) from error
    # Classify stored words before scalar promotion. The shared copy reader
    # rejects -0/subnormal/nonfinite words without changing authored storage.
    if len(words)!=3 or any(not isinstance(word,int) or isinstance(word,bool) or word<0 or word>0xffffffff or word==0x80000000 or ((word&0x7fffffff)!=0 and not 0x00800000 <= (word&0x7fffffff) < 0x7f800000) for word in words):
        raise WaveAxisUnsupported('Wave axis requires raw normal Float32 or positive-zero words before promotion')
    if words[2] != 0:
        raise WaveAxisUnsupported('Wave axis requires raw positive-zero Distortion')
    for word in words[:2]:
        absolute=word&0x7fffffff
        if absolute and not (0x37800000 <= absolute <= 0x41000000):
            raise WaveAxisUnsupported('Wave axis Scale/Phase magnitude must be zero or in [2^-16,8]')
    return (node.as_pointer(),node.id_data.as_pointer(),node.wave_type,node.bands_direction,node.wave_profile,words,context)

def normalize_wave_axis(node,socket,op,scene,fail):
    try:
        signature=source_signature(node,scene)
        if socket.identifier not in {'Color','Fac'} or socket.type != ('RGBA' if socket.identifier=='Color' else 'VALUE'):
            raise WaveAxisUnsupported('Wave axis native output schema changed')
    except WaveAxisUnsupported as error:
        fail(socket,str(error))
    words=signature[5]
    for name,word in zip(('Scale','Phase Offset','Distortion'),words):
        op['inputs'][name]={'name':name,'socketType':'VALUE','value':{'kind':'constant','type':'VALUE','value':struct.unpack('=f',struct.pack('=I',word))[0]}}
    op['properties'].update(wave_axis_model=MODEL,wave_axis_profile=PROFILE,wave_axis_version=list(bpy.app.version),wave_axis_build=bpy.app.build_hash.decode(),wave_axis_evaluator='CPU-MF',wave_axis_coordinate_model='implicit-uniform-f32-v1',wave_axis_reference_model='full-frame-context-zero-offset-v1',wave_axis_precision='CPU_FLOAT32',wave_axis_requested_precision=signature[6][5],wave_axis_export_extent=list(signature[6][3:5]),wave_axis_mapping_model='identity-v1',wave_axis_detail_model='unlinked-unused-v1',wave_axis_direction=node.bands_direction,wave_axis_wave_profile=node.wave_profile,wave_axis_parameter_words=list(words))
    return signature

def table_keys(ops):
    return {(op['properties']['wave_axis_direction'],op['properties']['wave_axis_wave_profile'],tuple(op['properties']['wave_axis_parameter_words'][:2])) for op in ops if op['kind']=='wave-texture'}

def validate_wave_axis_graph(program):
    if __package__:
        from .compositor_mask_domains import ELLIPSE_POINTWISE,ellipse_table_count
    else:
        from compositor_mask_domains import ELLIPSE_POINTWISE,ellipse_table_count
    fields=[op for op in program['ops'] if op['kind']=='wave-texture']
    if not fields:return None
    if len(fields)>128:return fields[0],'Wave axis exceeds its 128 source-operation budget'
    if program.get('passes'):return fields[0],'Wave axis requires no declared scene-pass inputs'
    if any(op['kind'] not in ELLIPSE_POINTWISE|{'wave-texture','white-noise-texture'} for op in program['ops']):
        return fields[0],'Wave axis requires closed full-frame texture-free pointwise composition'
    white=any(op.get('properties',{}).get('white_noise_model')=='native-compositor-white-noise-uniform-cpu-53-v1' for op in program['ops'])
    if len(table_keys(program['ops']))+ellipse_table_count(program['ops'])+int(white)>8:
        return fields[0],'Wave combined row/axis lookup budget is eight sampled textures'
    return None
