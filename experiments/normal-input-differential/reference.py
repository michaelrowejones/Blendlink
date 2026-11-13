# SPDX-License-Identifier: GPL-3.0-or-later
"""Native Normal direction and dot-product graphs."""
import json
import hashlib
import os
import sys
import tempfile
import math
import struct
import platform
from pathlib import Path
import bpy
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
native = os.environ.get('BLENDLINK_NORMAL_INPUT_NATIVE_MODULES')
sys.path.insert(0, native or str(ROOT / 'packages/blender-addon'))
sys.path.insert(0, native or str(ROOT / 'packages/blendlink/blender'))
import bakelib
import tsl_ir

OUTPUT = Path(os.environ['BLENDLINK_NORMAL_INPUT_REFERENCES']).resolve()
OUTPUT.mkdir(parents=True, exist_ok=True)
(OUTPUT / 'ir').mkdir(exist_ok=True)
SIZE = 64
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.cycles.samples = 1
scene.cycles.device = 'CPU'
import _cycles
_cycles.set_device_override('CPU')
bakelib._CYCLES_GPU_BACKENDS = ()
proxy = bakelib.uv_tile_proxy([], window=(0, 0, 1, 1))
camera_data = bpy.data.cameras.new('Normal Input Reference Camera')
camera_data.type = 'ORTHO'
camera_data.ortho_scale = 2
camera = bpy.data.objects.new(camera_data.name, camera_data)
scene.collection.objects.link(camera)
camera.location = (0, 0, 2)
scene.camera = camera
scene.world = None
scene.render.resolution_x = scene.render.resolution_y = SIZE
scene.render.resolution_percentage = 100
scene.render.use_compositing = False
scene.render.film_transparent = False
scene.render.dither_intensity = 0
scene.view_settings.view_transform = 'Raw'
scene.view_settings.look = 'None'
scene.render.image_settings.file_format = 'OPEN_EXR'
scene.render.image_settings.color_mode = 'RGBA'
scene.render.image_settings.color_depth = '32'
engines = {item.identifier for item in scene.render.bl_rna.properties['engine'].enum_items}
EEVEE = 'BLENDER_EEVEE' if 'BLENDER_EEVEE' in engines else 'BLENDER_EEVEE_NEXT'



def exact_inputs(tree):
    image = bpy.data.images.new('Exact Normal inputs', width=SIZE, height=SIZE, alpha=True, float_buffer=True)
    image.colorspace_settings.name = 'Non-Color'
    values = np.ones((SIZE * SIZE, 4), np.float32)
    index = np.arange(SIZE * SIZE)
    for channel, multiplier in enumerate([1, 613, 1019]):
        values[:, channel] = ((index * multiplier) % 2048) / np.float32(1024) - .5
    image.pixels.foreach_set(values.ravel())
    image.update()
    texture = tree.nodes.new('ShaderNodeTexImage')
    texture.image = image
    texture.interpolation = 'Closest'
    coordinates = tree.nodes.new('ShaderNodeTexCoord')
    tree.links.new(coordinates.outputs['UV'], texture.inputs['Vector'])
    return texture.outputs['Color']


def material_for(case):
    material = bpy.data.materials.new('Native Normal Input ' + case['id'])
    material.use_nodes = True
    tree = material.node_tree; tree.nodes.clear()
    output = tree.nodes.new('ShaderNodeOutputMaterial')
    emission = tree.nodes.new('ShaderNodeEmission')
    tree.links.new(emission.outputs[0], output.inputs['Surface'])
    if case['kind'] == 'constant':
        emission.inputs['Color'].default_value = (*case['value'], 1)
        return material, emission
    if case['kind'] == 'image-control':
        affine = tree.nodes.new('ShaderNodeVectorMath'); affine.operation = 'MULTIPLY_ADD'
        affine.inputs[1].default_value = (.25,) * 3
        affine.inputs[2].default_value = (.5,) * 3
        tree.links.new(exact_inputs(tree), affine.inputs[0])
        tree.links.new(affine.outputs[0], emission.inputs['Color'])
        return material, emission
    normal = tree.nodes.new('ShaderNodeNormal')
    normal.outputs['Normal'].default_value = case['direction']
    if case['stage'] == 'image':
        incoming = exact_inputs(tree)
    else:
        value = tree.nodes.new('ShaderNodeCombineXYZ')
        for socket, number in zip(value.inputs, case['input']): socket.default_value = number
        incoming = value.outputs[0]
    tree.links.new(incoming, normal.inputs['Normal'])
    affine = tree.nodes.new('ShaderNodeVectorMath'); affine.operation = 'MULTIPLY_ADD'
    affine.inputs[1].default_value = (case['oracleScale'],) * 3
    affine.inputs[2].default_value = (.5,) * 3
    tree.links.new(normal.outputs[case['output']], affine.inputs[0])
    tree.links.new(affine.outputs[0], emission.inputs['Color'])
    return material, emission


records, refusals = [], []
with tempfile.TemporaryDirectory(prefix='blendlink-native-normal-input-') as temporary:
    for engine in ['CYCLES', EEVEE]:
        scene.render.engine = engine
        if engine != 'CYCLES': scene.eevee.taa_render_samples = 1
        cases = [{'id':engine.lower()+'-constant-'+str(i),'kind':'constant','value':v}
                 for i,v in enumerate([[.1234567,1.234567,5.413859],[.3333333,2.003,12.3456]])]
        cases.append({'id':engine.lower()+'-image-control','kind':'image-control','stage':'image'})
        directions = [(0,0,1),(.25,-.5,1),(2,-3,4),(0,0,0),(1e-12,-1e-12,1e-12),(1e-5,0,0),(16,-16,8)]
        for index, direction in enumerate(directions):
            cases.append({'id':f'{engine.lower()}-normal-direction-{index}', 'kind':'normal',
                          'direction':direction,'output':'Normal','input':(0,0,1),'stage':'constant','oracleScale':1/64})
            for stage in ['constant','image']:
                for j, incoming in enumerate([(0,0,1),(1,-1,2),(0,0,0),(1e-22,0,0),(1e-12,1e-12,0),(1e-5,0,0),(1e16,1e16,1e16),(2**54,0,-2**54)] if stage=='constant' else [(0,0,1)]):
                    cases.append({'id':f'{engine.lower()}-normal-dot-{index}-{stage}-{j}', 'kind':'normal',
                                  'direction':direction,'output':'Dot','input':incoming,'stage':stage,'oracleScale':1/64})
        for case in cases:
            case['engine'] = engine
            material, emission = material_for(case)
            proxy.data.materials.clear(); proxy.data.materials.append(material)
            before = len(material.node_tree.nodes), len(material.node_tree.links), len(bpy.data.node_groups)
            expected_refusal = case['kind'] == 'normal' and (
                engine == 'CYCLES' and sum(v*v for v in case['direction']) < 1e-30 or
                case['output'] == 'Dot' and case['stage'] == 'constant' and sum(v*v for v in case['input']) < 1e-30)
            try:
                document = tsl_ir.emit_channel(emission.inputs['Color'])
            except tsl_ir.TslIrRefusal as error:
                assert expected_refusal and 'nonzero' in str(error), (case['id'], str(error))
                assert before == (len(material.node_tree.nodes),len(material.node_tree.links),len(bpy.data.node_groups))
                refusals.append({'id':case['id'],'reason':str(error)})
                bpy.data.materials.remove(material,do_unlink=True)
                continue
            assert not expected_refusal, case['id']
            assert before == (len(material.node_tree.nodes),len(material.node_tree.links),len(bpy.data.node_groups))
            (OUTPUT/'ir'/(case['id']+'.json')).write_text(json.dumps(document))
            if engine == 'CYCLES':
                result = bakelib.bake_channel_field_pixels([proxy],size=SIZE,margin_px=0,uv_layer='BLENDLINK_TILE_BAKE',label=case['id'],allow_hdr=True)
                raw = np.asarray(result['pixels'],np.float32).reshape(SIZE,SIZE,3)
            else:
                scene.render.filepath = str(Path(temporary)/'native.exr')
                bpy.ops.render.render(write_still=True)
                image = bpy.data.images.load(scene.render.filepath,check_existing=False)
                raw = np.asarray(image.pixels[:],np.float32).reshape(SIZE,SIZE,4)[...,:3]
                bpy.data.images.remove(image)
            pixels = raw if case.get('stage')=='image' else np.tile(raw[SIZE//2,SIZE//2,:3],(SIZE,SIZE,1))
            assert np.isfinite(pixels).all(),case['id']
            pixels.astype('<f4').tofile(OUTPUT/(case['id']+'.f32'))
            records.append(case)
            bpy.data.materials.remove(material,do_unlink=True)
(OUTPUT/'index.json').write_text(json.dumps({'blender':bpy.app.version_string,'buildHash':bpy.app.build_hash.decode(),
    'gpuBackend':bpy.context.preferences.system.gpu_backend,'cyclesDevice':'CPU','size':SIZE,'cases':records,'refusals':refusals,
    'nativeModuleHashes':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in Path(native).iterdir()
                          if p.suffix in {'.py','.json'}} if native else {}},indent=2))
print('BLENDLINK_NORMAL_INPUT_REFERENCES_PASSED '+str(len(records)))
