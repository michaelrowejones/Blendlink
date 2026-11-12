# SPDX-License-Identifier: GPL-3.0-or-later
"""Native Noise fractal pixels; actual Blender node graphs are the oracle."""
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
native = os.environ.get('BLENDLINK_NOISE_NATIVE_MODULES')
sys.path.insert(0, native or str(ROOT / 'packages/blender-addon'))
sys.path.insert(0, native or str(ROOT / 'packages/blendlink/blender'))
import bakelib
import tsl_ir
from noise_fractal_ir import fractal_amplitude_bound, FRACTAL_TYPES

def source_qualified_roughness_refusal(case, engine, varying, reason, source_profile):
    """Only the actual unmeasured Cycles normalized child qualification."""
    expected = ('Normalized Noise has no verified live source precision profile for '
                'CYCLES on ' + sys.platform + '/' + platform.machine()
                + '; use source baking for this Cycles profile')
    return (varying and engine == 'CYCLES' and source_profile is None
            and case.get('kind') == 'noise' and case.get('roughnessStage') == 'constant-function'
            and reason == expected)


def native_live_distortion_refusal(case, engine, varying, reason, gpu_backend='METAL', native_version=(4,2,0)):
    precision_case = case.get('inputCancellationAxis') in {'x','w','rho'}
    admitted = (gpu_backend == 'METAL' and (case.get('dimensions') == '1D'
                or native_version >= (5,0,0) and case.get('stage') == 'constant') and not precision_case)
    expected_reason = ('Native normalized live Roughness nonzero Distortion requires exact MF coordinate inputs and portable constant arithmetic; use source baking'
        if native_version >= (5,0,0) else 'Native normalized live Roughness nonzero Distortion requires portable constant arithmetic; use exact inputs or source baking') if precision_case else 'Native normalized live Roughness nonzero Distortion requires verified Metal 1D shader or native MF inputs; use source baking'
    return (varying and engine in {'BLENDER_EEVEE','BLENDER_EEVEE_NEXT'} and case.get('kind') == 'noise'
            and case.get('normalize') is True and case.get('type','FBM') == 'FBM'
            and bool(case.get('roughnessStage')) and case.get('Distortion',0) != 0
            and not admitted
            and reason == expected_reason)


def authored_graph_state(material):
    def properties(value, depth=0):
        result = {}
        for prop in value.bl_rna.properties:
            if prop.is_readonly or prop.identifier == 'rna_type': continue
            item = getattr(value,prop.identifier)
            if prop.type in {'BOOLEAN','INT','FLOAT','STRING','ENUM'}:
                result[prop.identifier] = sorted(item) if isinstance(item,set) else list(item) if getattr(prop,'is_array',False) else item
            elif prop.type == 'POINTER' and item is not None:
                if isinstance(item,bpy.types.ID): result[prop.identifier]={'idType':item.bl_rna.identifier,'name':item.name}
                elif depth < 3: result[prop.identifier]=properties(item,depth+1)
        return result
    def sockets(values):
        return [{'identifier':socket.identifier,'name':socket.name,
                 **({'value':list(socket.default_value) if hasattr(socket.default_value,'__len__') and not isinstance(socket.default_value,str) else socket.default_value}
                    if hasattr(socket,'default_value') else {})} for socket in values]
    return {'material':material.name,'nodes':[{'name':node.name,'type':node.bl_idname,'properties':properties(node),
        'inputs':sockets(node.inputs),'outputs':sockets(node.outputs)} for node in material.node_tree.nodes],
        'links':[[link.from_node.name,link.from_socket.identifier,link.to_node.name,link.to_socket.identifier] for link in material.node_tree.links]}


def retain_refused_native_graph(material, case, engine, temporary):
    directory=OUTPUT/'refused';directory.mkdir(exist_ok=True)
    graph=authored_graph_state(material)
    images={}
    for node in material.node_tree.nodes:
        image=getattr(node,'image',None)
        if image is None or image.name in images: continue
        values=np.empty(len(image.pixels),np.float32);image.pixels.foreach_get(values)
        data=values.astype('<f4').tobytes();digest=hashlib.sha256(data).hexdigest()
        image_file='image-'+digest[:16]+'.f32';(directory/image_file).write_bytes(data)
        images[image.name]={'file':image_file,'hash':digest,'size':list(image.size),'channels':image.channels,
            'colorSpace':image.colorspace_settings.name,'alphaMode':image.alpha_mode,'source':image.source,'halfPrecision':image.use_half_precision}
    graph.update(engine=engine,case=case,images=images)
    graph_file=case['id']+'.graph.json';graph_bytes=json.dumps(graph,allow_nan=False).encode();(directory/graph_file).write_bytes(graph_bytes)
    raw=native_pixels(material,temporary,case['id']+'-refused')
    assert np.isfinite(raw).all(),case['id']
    pixels=raw.astype('<f4').tobytes();pixel_file=case['id']+'.f32';(directory/pixel_file).write_bytes(pixels)
    assert authored_graph_state(material)=={key:graph[key] for key in ['material','nodes','links']},'Refusal or native rendering changed the authored graph'
    return {'graph':{'file':'refused/'+graph_file,'hash':hashlib.sha256(graph_bytes).hexdigest()},
            'nativePixels':{'file':'refused/'+pixel_file,'hash':hashlib.sha256(pixels).hexdigest(),'components':3,'size':SIZE}}


OUTPUT = Path(os.environ['BLENDLINK_NOISE_REFERENCES']).resolve()
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
camera_data = bpy.data.cameras.new('Noise Reference Camera')
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



def exact_inputs(tree, precision='half'):
    image = bpy.data.images.new('Exact Noise inputs', width=SIZE, height=SIZE, alpha=True, float_buffer=True)
    image.colorspace_settings.name = 'Non-Color'
    if hasattr(image, 'use_half_precision'): image.use_half_precision = False
    values = np.ones((SIZE * SIZE, 4), np.float32)
    index = np.arange(SIZE * SIZE)
    for channel, multiplier in enumerate([1, 613, 1019]):
        values[:, channel] = ((index * multiplier) % 2048) / np.float32(1024) - .5
        if precision == 'float32': values[:, channel] = np.sin(index.astype(np.float32) * np.float32(.137 + channel * .071)) * np.float32(.973) + np.float32(.173)
    if precision in {'modulo-positive', 'modulo-negative'}:
        # Independent full-f32 field spans the admitted band, including endpoint
        # and quotient-rounding canaries. Never reconstruct input from GPU output.
        mixed = (index.astype(np.uint64) * np.uint64(1664525) + np.uint64(1013904223)) % np.uint64(2**31 - 2**24 - 128)
        values[:, 0] = (mixed + np.uint64(2**24)).astype(np.float32)
        controls = [2**24, 2**24+2, 1074099968, 1074100096, 1638499968, 2147483520, 1000000000]
        values[:len(controls), 0] = controls
        if precision == 'modulo-negative': values[:, 0] *= -1
    if precision in {'modulo-half-positive', 'modulo-half-negative'}:
        values[:, 0] = (((index * 613) % 65505) - 32752).astype(np.float16).astype(np.float32)
    image.pixels.foreach_set(values.ravel())
    image.update()
    texture = tree.nodes.new('ShaderNodeTexImage')
    texture.image = image
    texture.interpolation = 'Closest'
    coordinates = tree.nodes.new('ShaderNodeTexCoord')
    tree.links.new(coordinates.outputs['UV'], texture.inputs['Vector'])
    return texture.outputs['Color']


def make_material(case):
    material = bpy.data.materials.new('Native Noise ' + case['id'])
    material.use_nodes = True
    tree = material.node_tree
    tree.nodes.clear()
    output = tree.nodes.new('ShaderNodeOutputMaterial')
    emission = tree.nodes.new('ShaderNodeEmission')
    tree.links.new(emission.outputs[0], output.inputs['Surface'])
    def opaque_island_value():
        if case.get('exactIsland'):
            add = tree.nodes.new('ShaderNodeMath'); add.operation = 'ADD'
            add.inputs[0].default_value, add.inputs[1].default_value = .125, .25
            return add.outputs[0]
        if 'islandLiteral' in case:
            value = tree.nodes.new('ShaderNodeValue'); value.outputs[0].default_value = case['islandLiteral']
            return value.outputs[0]
        direction = case['islandDirection']
        first = tree.nodes.new('ShaderNodeMath'); first.operation = 'ADD'
        first.inputs[0].default_value, first.inputs[1].default_value = 100000000, direction
        second = tree.nodes.new('ShaderNodeMath'); second.operation = 'SUBTRACT'
        tree.links.new(first.outputs[0], second.inputs[0]); second.inputs[1].default_value = 100000000
        third = tree.nodes.new('ShaderNodeMath'); third.operation = 'SUBTRACT'
        tree.links.new(second.outputs[0], third.inputs[0]); third.inputs[1].default_value = direction
        return third.outputs[0]

    if case['kind'] == 'constant':
        emission.inputs['Color'].default_value = (*case['value'], 1)
        return material, emission
    if case.get('coordinateStage', case['stage']) == 'constant':
        source = tree.nodes.new('ShaderNodeCombineXYZ')
        for index, value in enumerate(case.get('coordinates', [.173, -.375, .625])):
            source.inputs[index].default_value = value
            assert source.inputs[index].default_value == float(np.float32(value)), 'Coordinate socket changed the authored test value'
        incoming = source.outputs[0]
        if case.get('coordinateCanary'):
            first = tree.nodes.new('ShaderNodeMath'); first.operation = 'ADD'
            first.inputs[0].default_value = 100000000
            first.inputs[1].default_value = case['coordinateCanary']
            second = tree.nodes.new('ShaderNodeMath'); second.operation = 'SUBTRACT'
            tree.links.new(first.outputs[0], second.inputs[0]); second.inputs[1].default_value = 100000000
            third = tree.nodes.new('ShaderNodeMath'); third.operation = 'SUBTRACT'
            tree.links.new(second.outputs[0], third.inputs[0]); third.inputs[1].default_value = case['coordinateCanary']
            tree.links.new(third.outputs[0], source.inputs[0])
    else:
        incoming = exact_inputs(tree, case.get('inputPrecision', 'half'))
    if 'coordinateOffset' in case:
        translated = tree.nodes.new('ShaderNodeVectorMath'); translated.operation = 'ADD'
        tree.links.new(incoming, translated.inputs[0]); translated.inputs[1].default_value = case['coordinateOffset']
        incoming = translated.outputs[0]
    if case.get('opaqueIsland') == 'vector':
        shift = tree.nodes.new('ShaderNodeCombineXYZ')
        tree.links.new(opaque_island_value(), shift.inputs[0])
        add = tree.nodes.new('ShaderNodeVectorMath'); add.operation = 'ADD'
        tree.links.new(incoming, add.inputs[0]); tree.links.new(shift.outputs[0], add.inputs[1])
        incoming = add.outputs[0]
    if case['kind'] == 'image-control':
        factor, bias = .25, .5
        raw = incoming
    elif case['kind'] == 'coordinate-quotient':
        component = tree.nodes.new('ShaderNodeSeparateXYZ'); tree.links.new(incoming, component.inputs[0])
        divide = tree.nodes.new('ShaderNodeMath'); divide.operation = 'DIVIDE'
        tree.links.new(component.outputs[0], divide.inputs[0]); divide.inputs[1].default_value = 100000
        floor = tree.nodes.new('ShaderNodeMath'); floor.operation = 'FLOOR'
        tree.links.new(divide.outputs[0], floor.inputs[0])
        subtract = tree.nodes.new('ShaderNodeMath'); subtract.operation = 'SUBTRACT'
        tree.links.new(floor.outputs[0], subtract.inputs[0]); subtract.inputs[1].default_value = 10740
        raw = subtract.outputs[0]; factor, bias = .25, .5
    elif case['kind'] == 'coordinate-control':
        component = tree.nodes.new('ShaderNodeSeparateXYZ'); tree.links.new(incoming, component.inputs[0])
        modulo = tree.nodes.new('ShaderNodeMath'); modulo.operation = 'MODULO'
        tree.links.new(component.outputs[0], modulo.inputs[0]); modulo.inputs[1].default_value = 100000
        raw = modulo.outputs[0]; factor, bias = (1 if case['coordinateOffset'][0] > 0 else -1)/128, .5
    elif case['kind'] == 'math-modulo-probe':
        component = tree.nodes.new('ShaderNodeSeparateXYZ'); tree.links.new(incoming, component.inputs[0])

        def math_node(operation, a, b=None):
            node = tree.nodes.new('ShaderNodeMath'); node.operation = operation
            for index, value in enumerate((a, b)):
                if value is None: continue
                if isinstance(value, bpy.types.NodeSocket): tree.links.new(value, node.inputs[index])
                else: node.inputs[index].default_value = value
            return node.outputs[0]

        a = component.outputs[0]
        if case['variant'] == 'quotient':
            quotient = math_node('TRUNC', math_node('DIVIDE', a, 100000))
            raw = math_node('SUBTRACT', quotient, math.trunc(case['point'] / 100000))
            factor, bias = .125, .5
        else:
            remainder = math_node('MODULO', a, 100000)
            if case['variant'] == 'zero-sign':
                raw = math_node('ARCTAN2', remainder, -1)
                factor, bias = .125, .5
            else:
                # Split into independently representable positive lanes. The
                # low lane distinguishes a32-unit remainder error even when
                # the native half target would hide it in a large raw value.
                absolute = math_node('ABSOLUTE', remainder)
                high = math_node('FLOOR', math_node('DIVIDE', absolute, 256))
                low = math_node('SUBTRACT', absolute, math_node('MULTIPLY', high, 256))
                output = tree.nodes.new('ShaderNodeCombineXYZ')
                for socket, value in zip(output.inputs, (
                    math_node('ADD', math_node('MULTIPLY', high, 1/1024), .125),
                    math_node('ADD', math_node('MULTIPLY', low, 1/256), .125),
                    math_node('ADD', math_node('MULTIPLY', math_node('SIGN', remainder), .125), .5))):
                    tree.links.new(value, socket)
                tree.links.new(output.outputs[0], emission.inputs['Color'])
                return material, emission
    else:
        node = tree.nodes.new('ShaderNodeTexNoise')
        node.noise_type = case.get('type', 'FBM')
        node.normalize = case.get('normalize', False)
        node.noise_dimensions = case['dimensions']
        for key, default in [('Scale', 1), ('Detail', 2), ('Roughness', .5), ('Lacunarity', 2), ('Distortion', 0), ('Offset', 0), ('Gain', 1)]:
            socket = node.inputs.get(key)
            if socket is not None:
                socket.default_value = case.get(key, default)
                assert socket.default_value == float(np.float32(case.get(key,default))), ('Native socket changed authored scalar',key,case.get(key,default),socket.default_value)
        if case.get('roughnessStage'):
            if case['roughnessStage'] == 'constant-function':
                rough_coordinates = tree.nodes.new('ShaderNodeCombineXYZ')
                for index, value in enumerate([.375, -.173, .625]): rough_coordinates.inputs[index].default_value = value
                rough_noise = tree.nodes.new('ShaderNodeTexNoise')
                rough_noise.inputs['Scale'].default_value = 1
                rough_noise.inputs['Detail'].default_value = 0
                rough_noise.normalize = True
                tree.links.new(rough_coordinates.outputs[0], rough_noise.inputs['Vector'])
                rough = rough_noise.outputs['Fac']
            else:
                rough_components = tree.nodes.new('ShaderNodeSeparateXYZ')
                tree.links.new(exact_inputs(tree), rough_components.inputs[0])
                rough = rough_components.outputs[0]
            if 'roughnessTransform' in case:
                transform=tree.nodes.new('ShaderNodeMath');transform.operation='MULTIPLY_ADD'
                transform.inputs[1].default_value,transform.inputs[2].default_value=case['roughnessTransform']
                tree.links.new(rough,transform.inputs[0]);rough=transform.outputs[0]
            rough_clamp = tree.nodes.new('ShaderNodeClamp')
            tree.links.new(rough, rough_clamp.inputs['Value'])
            tree.links.new(rough_clamp.outputs[0], node.inputs['Roughness'])
        if 'roughnessLinked' in case:
            roughness = tree.nodes.new('ShaderNodeValue')
            roughness.outputs[0].default_value = case['roughnessLinked']
            tree.links.new(roughness.outputs[0], node.inputs['Roughness'])
        components = tree.nodes.new('ShaderNodeSeparateXYZ')
        tree.links.new(incoming, components.inputs[0])
        if case['dimensions'] != '1D': tree.links.new(incoming, node.inputs['Vector'])
        if case['dimensions'] in {'1D', '4D'} and case.get('coordinateProbe'):
            tree.links.new(components.outputs[0], node.inputs['W'])
        elif case['dimensions'] in {'1D', '4D'}:
            w = tree.nodes.new('ShaderNodeMath')
            w.operation = 'MULTIPLY_ADD'
            w.inputs[1].default_value = .5
            w.inputs[2].default_value = .125
            tree.links.new(components.outputs[1], w.inputs[0])
            tree.links.new(w.outputs[0], node.inputs['W'])
        if case.get('inputCancellationAxis'):
            first=tree.nodes.new('ShaderNodeMath');first.operation='ADD';first.inputs[0].default_value=1e8;first.inputs[1].default_value=1
            second=tree.nodes.new('ShaderNodeMath');second.operation='SUBTRACT';second.inputs[1].default_value=1e8;tree.links.new(first.outputs[0],second.inputs[0])
            third=tree.nodes.new('ShaderNodeMath');third.operation='SUBTRACT';third.inputs[1].default_value=1;tree.links.new(second.outputs[0],third.inputs[0])
            if case['inputCancellationAxis']=='w':tree.links.new(third.outputs[0],node.inputs['W'])
            elif case['inputCancellationAxis']=='x':
                point=tree.nodes.new('ShaderNodeCombineXYZ');point.inputs[1].default_value=-.375;point.inputs[2].default_value=.625
                tree.links.new(third.outputs[0],point.inputs[0]);tree.links.new(point.outputs[0],node.inputs['Vector'])
            else:
                clamp=node.inputs['Roughness'].links[0].from_node;inner=clamp.inputs['Value'].links[0].from_socket
                scaled=tree.nodes.new('ShaderNodeMath');scaled.operation='MULTIPLY';scaled.inputs[1].default_value=.01;tree.links.new(inner,scaled.inputs[0])
                mixed=tree.nodes.new('ShaderNodeMath');mixed.operation='ADD';tree.links.new(scaled.outputs[0],mixed.inputs[0]);tree.links.new(third.outputs[0],mixed.inputs[1]);tree.links.new(mixed.outputs[0],clamp.inputs['Value'])
        if case.get('opaqueIsland') == 'w':
            base = node.inputs['W'].links[0].from_socket
            add = tree.nodes.new('ShaderNodeMath'); add.operation = 'ADD'
            tree.links.new(base, add.inputs[0]); tree.links.new(opaque_island_value(), add.inputs[1])
            tree.links.new(add.outputs[0], node.inputs['W'])
        raw = node.outputs[case['output']]
        factor, bias = case.get('oracleScale', .0625), .5
        if 'staticBaseline' in case:
            subtract = tree.nodes.new('ShaderNodeVectorMath')
            subtract.operation = 'SUBTRACT'
            subtract.inputs[1].default_value = (case['staticBaseline'],) * 3
            tree.links.new(raw, subtract.inputs[0])
            raw = subtract.outputs[0]
    affine = tree.nodes.new('ShaderNodeVectorMath')
    affine.operation = 'MULTIPLY_ADD'
    affine.inputs[1].default_value = (factor,) * 3
    affine.inputs[2].default_value = (bias,) * 3
    tree.links.new(raw, affine.inputs[0])
    tree.links.new(affine.outputs[0], emission.inputs['Color'])
    return material, emission


def native_pixels(material, temporary, label):
    proxy.data.materials.clear()
    proxy.data.materials.append(material)
    if scene.render.engine == 'CYCLES':
        result = bakelib.bake_channel_field_pixels([proxy], size=SIZE, margin_px=0,
            uv_layer='BLENDLINK_TILE_BAKE', label=label, allow_hdr=True)
        return np.asarray(result['pixels'], np.float32).reshape(SIZE, SIZE, 3)
    scene.render.filepath = str(Path(temporary) / 'native.exr')
    bpy.ops.render.render(write_still=True)
    image = bpy.data.images.load(scene.render.filepath, check_existing=False)
    raw = np.asarray(image.pixels[:], np.float32).reshape(SIZE, SIZE, 4)[..., :3]
    bpy.data.images.remove(image)
    return raw


def add_residual_control(material, emission, coarse, scale, amplification):
    # The native half target supplies a coarse baseline only. Reevaluate the
    # same native noise subgraph after subtracting that baseline, so final
    # target quantization cannot hide shader-kernel arithmetic discrepancies.
    baseline = (coarse - np.float32(.5)) / np.float32(scale)
    assert np.array_equal(baseline, baseline.astype(np.float16).astype(np.float32))
    tree = material.node_tree
    image = bpy.data.images.new('Exact Noise residual baseline', width=SIZE, height=SIZE, alpha=True, float_buffer=True)
    image.colorspace_settings.name = 'Non-Color'
    values = np.ones((SIZE, SIZE, 4), np.float32)
    values[..., :3] = baseline
    image.pixels.foreach_set(values.ravel())
    image.update()
    texture = tree.nodes.new('ShaderNodeTexImage')
    texture.image = image
    texture.interpolation = 'Closest'
    coordinates = tree.nodes.new('ShaderNodeTexCoord')
    tree.links.new(coordinates.outputs['UV'], texture.inputs['Vector'])
    affine = emission.inputs['Color'].links[0].from_node
    raw = affine.inputs[0].links[0].from_socket
    subtract = tree.nodes.new('ShaderNodeVectorMath')
    subtract.operation = 'SUBTRACT'
    tree.links.new(raw, subtract.inputs[0])
    tree.links.new(texture.outputs['Color'], subtract.inputs[1])
    tree.links.new(subtract.outputs[0], affine.inputs[0])
    affine.inputs[1].default_value = (amplification,) * 3


records = []
refusals = []
source_qualified_refusal_ids = set()
native_distortion_refusal_ids = set()
requested_count = 0
native_varying = bool(os.environ.get('BLENDLINK_NOISE_NATIVE_VARYING'))
varying = bool(os.environ.get('BLENDLINK_NOISE_VARYING')) or native_varying
coordinate_probes = bool(os.environ.get('BLENDLINK_NOISE_COORDINATES'))
normalized = bool(os.environ.get('BLENDLINK_NOISE_NORMALIZED')) or coordinate_probes
assert not (varying and normalized)
requested_types = json.loads(os.environ.get('BLENDLINK_NOISE_TYPES', json.dumps(['FBM', *sorted(FRACTAL_TYPES)]) if varying and not native_varying else '["FBM"]'))
assert requested_types and all(kind in {'FBM', *FRACTAL_TYPES} for kind in requested_types)
parameters = [
    {'Detail': 0, 'Roughness': .5, 'Lacunarity': 2, 'Scale': 1},
    {'Detail': .5, 'Roughness': .7, 'Lacunarity': 1.7, 'Scale': 1},
    {'Detail': 2, 'Roughness': 0, 'Lacunarity': 0, 'Scale': 4},
    {'Detail': 2.5, 'Roughness': .7, 'Lacunarity': -2, 'Scale': 1},
    {'Detail': 6, 'Roughness': 1, 'Lacunarity': 2, 'Scale': 40},
    {'Detail': 6, 'Roughness': .5, 'Lacunarity': 2, 'Scale': 80},
    {'Detail': 2, 'Roughness': .5, 'Lacunarity': 2, 'Scale': 1, 'Distortion': -1},
    {'Detail': 2, 'Roughness': .5, 'Lacunarity': 2, 'Scale': 1, 'Distortion': 1},
    {'Detail': -.5, 'Roughness': .5, 'Lacunarity': 2, 'Scale': 1},
    {'Detail': 2.5, 'roughnessLinked': -.5, 'Lacunarity': 2, 'Scale': 1},
]
with tempfile.TemporaryDirectory(prefix='blendlink-native-noise-') as temporary:
    only = os.environ.get('BLENDLINK_NOISE_ENGINE')
    if only == 'EEVEE': only = EEVEE
    if native_varying and only is None: only = EEVEE
    if native_varying: assert only == EEVEE, 'Native live Roughness is EEVEE-only'
    for engine in ([only] if only else ['CYCLES', EEVEE]):
        scene.render.engine = engine
        if engine != 'CYCLES': scene.eevee.taa_render_samples = 1
        cases = [{'id': engine.lower() + '-constant-' + str(i), 'kind': 'constant', 'value': value}
                 for i, value in enumerate([[.1234567, 1.234567, 5.413859], [.3333333, 2.003, 12.3456]])]
        cases.append({'id': engine.lower() + '-image-control', 'kind': 'image-control', 'stage': 'image'})
        for dimension in ['1D', '2D', '3D', '4D']:
            for output in ['Fac', 'Color']:
                for stage in ['constant', 'image']:
                    for index, settings in enumerate(parameters):
                        if 'FBM' not in requested_types: continue
                        cases.append({'id': f'{engine.lower()}-fbm-raw-{dimension.lower()}-{output.lower()}-{stage}-{index}',
                                      'kind': 'noise', 'dimensions': dimension, 'output': output, 'stage': stage,
                                      'oracleScale': .0625, **settings})
        if engine != 'CYCLES' and 'FBM' in requested_types:
            for dimension in ['1D', '2D', '3D', '4D']:
                for stage in ['constant', 'image']:
                    cases.append({'id': f'{engine.lower()}-fbm-residual-{dimension.lower()}-{stage}',
                                  'kind': 'noise', 'dimensions': dimension, 'output': 'Color', 'stage': stage,
                                  'oracleScale': .0625, 'residual': True, **parameters[4]})
        variations = [
            {'Detail': 0, 'Roughness': .5, 'Lacunarity': 2, 'Scale': 1},
            {'Detail': .5, 'Roughness': .7, 'Lacunarity': 1.7, 'Scale': 1, 'Offset': -.5, 'Gain': 2},
            {'Detail': 1, 'Roughness': 0, 'Lacunarity': 0, 'Scale': 40, 'Offset': 1, 'Gain': -2},
            {'Detail': 1.5, 'Roughness': .7, 'Lacunarity': -2, 'Scale': 1, 'Offset': .5, 'Gain': 0},
            {'Detail': 2, 'Roughness': 1, 'Lacunarity': 2, 'Scale': 40, 'Offset': 1, 'Gain': 2},
            {'Detail': 2, 'Roughness': .5, 'Lacunarity': 2, 'Scale': 80, 'Offset': -1, 'Gain': -1},
            {'Detail': 2, 'Roughness': .5, 'Lacunarity': 2, 'Scale': 1, 'Distortion': -1},
            {'Detail': 2, 'Roughness': .5, 'Lacunarity': 2, 'Scale': 1, 'Offset': 1, 'Gain': 2, 'Distortion': 1},
        ]
        for kind in requested_types:
            if kind == 'FBM': continue
            for dimension in ['1D', '2D', '3D', '4D']:
                for output in ['Fac', 'Color']:
                    for stage in ['constant', 'image']:
                        cases.append({'id': f'{engine.lower()}-{kind.lower()}-{dimension.lower()}-{output.lower()}-{stage}',
                                      'kind': 'noise', 'type': kind, 'dimensions': dimension, 'output': output, 'stage': stage})
            for output in ['Fac', 'Color']:
                for stage in ['constant', 'image']:
                    for index, settings in enumerate(variations):
                        cases.append({'id': f'{engine.lower()}-{kind.lower()}-variant-{output.lower()}-{stage}-{index}',
                                      'kind': 'noise', 'type': kind, 'dimensions': '3D', 'output': output, 'stage': stage, **settings})
            for stage in ['constant', 'image']:
                cases.append({'id': f'{engine.lower()}-{kind.lower()}-ignored-normalize-{stage}',
                              'kind': 'noise', 'type': kind, 'dimensions': '3D', 'output': 'Color', 'stage': stage, 'normalize': True})
            if engine != 'CYCLES':
                for dimension in ['1D', '2D', '3D', '4D']:
                    for stage in ['constant', 'image']:
                        cases.append({'id': f'{engine.lower()}-{kind.lower()}-residual-{dimension.lower()}-{stage}',
                                      'kind': 'noise', 'type': kind, 'dimensions': dimension, 'output': 'Color', 'stage': stage,
                                      'residual': True, **variations[4]})
        if 'HYBRID_MULTIFRACTAL' in requested_types:
            boundary = struct.unpack('I', struct.pack('f', .001))[0]
            for side, bits in [('below', boundary - 1), ('equal', boundary), ('above', boundary + 1)]:
                offset = struct.unpack('f', struct.pack('I', bits))[0]
                for stage in ['constant', 'image']:
                    cases.append({'id': f'{engine.lower()}-hybrid-cutoff-{side}-{stage}',
                                  'kind': 'noise', 'type': 'HYBRID_MULTIFRACTAL', 'dimensions': '3D',
                                  'output': 'Fac', 'stage': stage, 'Detail': 2, 'Scale': 0, 'Offset': offset, 'Gain': 1,
                                  'staticBaseline': offset, 'oracleScaleOverride': 2048})
        if 'RIDGED_MULTIFRACTAL' in requested_types:
            for stage in ['constant', 'image']:
                for detail in [1, 1.75]:
                    cases.append({'id': f'{engine.lower()}-ridged-floor-{stage}-{str(detail).replace(".", "_")}',
                                  'kind': 'noise', 'type': 'RIDGED_MULTIFRACTAL', 'dimensions': '3D',
                                  'output': 'Color', 'stage': stage, 'Detail': detail, 'Offset': 1, 'Gain': 2})
        if varying:
            boundaries = [case for case in cases if '-hybrid-cutoff-' in case['id'] or '-ridged-floor-' in case['id']]
            cases = cases[:3]
            families = [(kind, False) for kind in requested_types] + ([('FBM', True)] if 'FBM' in requested_types else [])
            for kind, normalize in families:
                label = kind.lower() + ('-normalized' if normalize else '-raw')
                base = {'kind': 'noise', 'type': kind, 'normalize': normalize, 'Roughness': 1}
                for dimension in ['1D', '2D', '3D', '4D']:
                    for output in ['Fac', 'Color']:
                        for stage in ['constant', 'image']:
                            cases.append({**base, 'id': f'{engine.lower()}-varying-{label}-{dimension.lower()}-{output.lower()}-{stage}',
                                          'dimensions': dimension, 'output': output, 'stage': stage,
                                          'roughnessStage': 'constant-function' if stage == 'constant' else 'image'})
                for index, detail in enumerate([-.5, 0, .5, 1, 1.5, 2]):
                    for stage in ['constant', 'image']:
                        cases.append({**base, 'id': f'{engine.lower()}-varying-{label}-detail-{index}-{stage}',
                                      'dimensions': '3D', 'output': 'Fac', 'stage': stage,
                                      'roughnessStage': 'constant-function' if stage == 'constant' else 'image',
                                      'Detail': detail, 'Lacunarity': 1.7 if index % 2 == 0 else -2,
                                      'Offset': .5 if index % 2 == 0 else -1, 'Gain': 2 if index % 2 == 0 else -2,
                                      'Distortion': -1 if index == 5 else 0})
                for coordinate_stage, roughness_stage in [('constant', 'image'), ('image', 'constant-function')]:
                    for output in ['Fac', 'Color']:
                        cases.append({**base, 'id': f'{engine.lower()}-varying-{label}-stages-{coordinate_stage}-{roughness_stage}-{output.lower()}',
                                      'dimensions': '3D', 'output': output, 'stage': 'image',
                                      'coordinateStage': coordinate_stage, 'roughnessStage': roughness_stage})
                if engine != 'CYCLES':
                    for dimension in ['1D', '2D', '3D', '4D']:
                        for stage in ['constant', 'image']:
                            cases.append({**base, 'id': f'{engine.lower()}-varying-{label}-residual-{dimension.lower()}-{stage}',
                                          'dimensions': dimension, 'output': 'Color', 'stage': stage, 'residual': True,
                                          'roughnessStage': 'constant-function' if stage == 'constant' else 'image',
                                          'Offset': 1, 'Gain': 2})
            for case in boundaries:
                case.update(roughnessStage='constant-function' if case['stage'] == 'constant' else 'image', Roughness=1)
                cases.append(case)
        if native_varying:
            cases = [case for case in cases if case['kind'] in {'constant','image-control'} or case.get('normalize') is True]
            for dimension in ['1D','2D','3D','4D']:
                for output in ['Fac','Color']:
                    for stage in ['constant','image']:
                        for index,(scale,bias) in enumerate([(0,0),(0,1),(-2,.25),(4,-1)]):
                            cases.append({'id':f'{engine.lower()}-native-varying-control-{dimension.lower()}-{output.lower()}-{stage}-{index}',
                                'kind':'noise','type':'FBM','normalize':True,'Roughness':1,'dimensions':dimension,'output':output,
                                'stage':stage,'roughnessStage':'constant-function' if stage=='constant' else 'image',
                                'roughnessTransform':[scale,bias],'Detail':-.5 if index==0 else 2,'Scale':1,'Lacunarity':-2 if index==2 else 1.7})
            control_settings=[{'Scale':0},{'Scale':-1,'Lacunarity':1.7},{'Scale':40},{'Scale':80},
                {'Lacunarity':0},{'Distortion':-1},{'Distortion':1,'Lacunarity':-2},
                {'Scale':40,'Distortion':.37,'Lacunarity':1.7}]
            for dimension in ['1D','2D','3D','4D']:
                for output in ['Fac','Color']:
                    for stage in ['constant','image']:
                        for index,settings in enumerate(control_settings):
                            cases.append({'id':f'{engine.lower()}-native-varying-kernel-{dimension.lower()}-{output.lower()}-{stage}-{index}',
                                'kind':'noise','type':'FBM','normalize':True,'Roughness':1,'dimensions':dimension,'output':output,'stage':stage,
                                'roughnessStage':'constant-function' if stage=='constant' else 'image','Detail':2,**settings})
            for dimension in ['1D','2D','3D','4D']:
                for stage in ['constant','image']:
                    cases.append({'id':f'{engine.lower()}-native-varying-residual-warp-{dimension.lower()}-{stage}',
                        'kind':'noise','type':'FBM','normalize':True,'Roughness':1,'dimensions':dimension,'output':'Color','stage':stage,
                        'roughnessStage':'constant-function' if stage=='constant' else 'image','Detail':2,'Scale':40,'Lacunarity':1.7,'Distortion':.37,'residual':True})
            for label,settings in [('no-warp',{'Scale':40,'Lacunarity':1.7,'Distortion':0}),
                                   ('small-warp',{'Scale':1,'Lacunarity':2,'Distortion':.37})]:
                for dimension in ['1D','2D','3D','4D']:
                    for stage in ['constant','image']:
                        cases.append({'id':f'{engine.lower()}-native-varying-residual-{label}-{dimension.lower()}-{stage}',
                            'kind':'noise','type':'FBM','normalize':True,'Roughness':1,'dimensions':dimension,'output':'Color','stage':stage,
                            'roughnessStage':'constant-function' if stage=='constant' else 'image','Detail':2,'residual':True,**settings})
            # Earn nonzero Distortion independently of the D0 capability.
            # Constant vector cases remain actual shader refusals on 4.2;
            # 5.x native MF and the 1D Metal shader have separate tags.
            distortion_controls = [
                {'Distortion':-.37,'Detail':1.5,'Scale':80,'Lacunarity':-2},
                {'Distortion':1,'Detail':.5,'Scale':-1,'Lacunarity':1.7},
                {'Distortion':-1,'Detail':2,'Scale':1,'Lacunarity':0},
                {'Distortion':2**-35,'Detail':0,'Scale':0,'Lacunarity':2},
                {'Distortion':.37,'Detail':2,'Scale':40,'Lacunarity':1.7,'roughnessTransform':[0,0]},
                {'Distortion':-.37,'Detail':2,'Scale':40,'Lacunarity':1.7,'roughnessTransform':[0,1]},
            ]
            for dimension,stage in [('1D','image'),*[(d,'constant') for d in ['1D','2D','3D','4D']]]:
                for index,settings in enumerate(distortion_controls):
                    cases.append({'id':f'{engine.lower()}-native-varying-distortion-domain-{dimension.lower()}-{stage}-{index}',
                        'kind':'noise','type':'FBM','normalize':True,'Roughness':1,'dimensions':dimension,'output':'Color','stage':stage,
                        'roughnessStage':'constant-function' if stage=='constant' else 'image','residual':True,**settings})
            if os.environ.get('BLENDLINK_NOISE_NATIVE_DISTORTION_COORDINATES'):
                cases = [case for case in cases if case['kind'] in {'constant','image-control'}]
                points = []
                for boundary in [100000,1000000]:
                    center = np.float32(boundary)
                    for point in [np.nextafter(center,np.float32(-math.inf)),center,np.nextafter(center,np.float32(math.inf))]:
                        points.extend([float(point),-float(point)])
                points.extend([1074100096.,-1074100096.])
                for index,point in enumerate(points):
                    for stage in ['constant','image']:
                        position = {'coordinates':[point,0,0]} if stage=='constant' else {'coordinateOffset':[point,0,0]}
                        cases.append({'id':f'{engine.lower()}-native-varying-distortion-coordinate-{stage}-{index}',
                            'kind':'noise','type':'FBM','normalize':True,'Roughness':1,'dimensions':'1D','output':'Color','stage':stage,
                            'roughnessStage':'constant-function' if stage=='constant' else 'image','residual':True,
                            'coordinateProbe':True,'Detail':1.5,'Scale':1,'Lacunarity':1.7,'Distortion':-.37 if point<0 else .37,**position})
            if not os.environ.get('BLENDLINK_NOISE_NATIVE_DISTORTION_COORDINATES'):
                if os.environ.get('BLENDLINK_NOISE_NATIVE_DISTORTION_INPUTS_ONLY'):
                    cases=[case for case in cases if case['kind'] in {'constant','image-control'}]
                domains=[('3D','x'),('4D','x'),('4D','w'),('1D','w'),('3D','rho')] if bpy.app.version >= (5,0,0) else [('1D','w'),('1D','rho')]
                for dimension,axis in domains:
                    cases.append({'id':f'{engine.lower()}-native-varying-input-precision-{dimension.lower()}-{axis}',
                        'kind':'noise','type':'FBM','normalize':True,'Roughness':1,'dimensions':dimension,'output':'Color','stage':'constant',
                        'roughnessStage':'constant-function','inputCancellationAxis':axis,'Detail':2,'Scale':1,'Lacunarity':1.7,'Distortion':.37,
                        'residual':axis=='rho'})
        if normalized:
            cases = [case for case in cases if case['kind'] in {'constant', 'image-control'} or case.get('type', 'FBM') == 'FBM']
            for case in cases:
                if case['kind'] == 'noise':
                    case['normalize'] = True
                    case['id'] = case['id'].replace('-fbm-raw-', '-fbm-normalized-')
                    case['oracleScale'] = .0625 if case.get('residual') else 1
            for stage in ['constant', 'image']:
                for output in ['Fac', 'Color']:
                    cases.append({'id': f'{engine.lower()}-fbm-normalized-artist-3d-{output.lower()}-{stage}',
                                  'kind': 'noise', 'type': 'FBM', 'normalize': True, 'dimensions': '3D',
                                  'stage': stage, 'output': output, 'Scale': .15, 'Detail': 1,
                                  'Roughness': .5, 'Lacunarity': 2, 'Distortion': 0, 'oracleScale': 1})
            if engine == 'CYCLES':
                cases.append({'id': 'cycles-artist-float32-image-control', 'kind': 'image-control', 'stage': 'image', 'inputPrecision': 'float32'})
                for output in ['Fac', 'Color']:
                    for distortion in [0, -1, 1]:
                        cases.append({'id': f'cycles-fbm-normalized-artist-float32-3d-{output.lower()}-dist{distortion}',
                                      'kind': 'noise', 'type': 'FBM', 'normalize': True, 'dimensions': '3D',
                                      'stage': 'image', 'output': output, 'Scale': .15, 'Detail': 1,
                                      'Roughness': .5, 'Lacunarity': 2, 'Distortion': distortion, 'oracleScale': 1,
                                      'inputPrecision': 'float32'})
        if coordinate_probes:
            cases = cases[:3]
            endpoints = []
            for boundary in [100000., 1000000.]:
                value = np.float32(boundary)
                for side, point in [('before', np.nextafter(value, np.float32(-math.inf))),
                                    ('equal', value), ('after', np.nextafter(value, np.float32(math.inf)))]:
                    for sign in [1, -1]: endpoints.append((f'{int(boundary)}-{side}-{sign}', float(point) * sign))
            large = np.float32(10741*100000)
            endpoints.extend((label, sign*float(point)) for label,sign,point in [
                ('large-positive',1,large),('large-negative',-1,large),
                ('large-positive-after',1,np.nextafter(large,np.float32(math.inf))),
                ('large-negative-after',-1,np.nextafter(large,np.float32(math.inf)))])
            # Independent diagnostic of native compiler lowering. Large
            # ShaderMath modulo has its own source-profile contract; these
            # controls are opt-in rather than counted as Noise translations.
            if os.environ.get('BLENDLINK_NOISE_COORDINATE_ARITHMETIC_CONTROLS') or os.environ.get('BLENDLINK_NOISE_COORDINATE_CONTROLS_ONLY'):
                cases.append({'id':f'{engine.lower()}-coordinate-quotient-control', 'kind':'coordinate-quotient',
                              'stage':'image','coordinateOffset':[float(large),0,0]})
                for point in [float(large),float(np.nextafter(large,np.float32(math.inf))),-float(large)]:
                    cases.append({'id':f'{engine.lower()}-coordinate-mod-control-{int(point)}', 'kind':'coordinate-control',
                                  'stage':'image','coordinateOffset':[point,0,0]})
            for dimension in ['1D','2D','3D','4D']:
                for output in ['Fac','Color']:
                    for stage in ['constant','image']:
                        for label, point in endpoints:
                            settings = {'coordinates': [point, -point, point*.5]} if stage == 'constant' else {'coordinateOffset': [point, -point, point*.5]}
                            cases.append({'id': f'{engine.lower()}-coordinate-{dimension.lower()}-{output.lower()}-{stage}-{label}',
                                          'kind':'noise','type':'FBM','normalize':True,'dimensions':dimension,'output':output,
                                          'stage':stage,'Detail':0,'Scale':1,'oracleScale':1,'coordinateProbe':True, **settings})
            if bpy.app.version >= (5,0,0):
                for point in [float(np.float32(2**28)), float(np.float32(-(2**35))), float(np.float32(2**80)), float(np.finfo(np.float32).max)]:
                    for dimension in ['1D','2D','3D','4D']:
                        for output in ['Fac','Color']:
                            cases.append({'id':f'{engine.lower()}-coordinate-mf-large-{dimension.lower()}-{output.lower()}-{len(cases)}',
                                          'kind':'noise','type':'FBM','normalize':True,'dimensions':dimension,'output':output,
                                          'stage':'constant','Detail':0,'Scale':1,'oracleScale':1,'coordinateProbe':True,
                                          'coordinates':[point,-point,point*.5]})
        if os.environ.get('BLENDLINK_NOISE_OPAQUE_ISLAND'):
            cases = [case for case in cases if case['kind'] in {'constant', 'image-control'}]
            for placement in ('vector', 'w'):
                common = {'kind': 'noise', 'stage': 'image', 'dimensions': '4D', 'output': 'Color',
                    'Detail': 0, 'Roughness': .5, 'Lacunarity': 2, 'Scale': 1, 'normalize': normalized,
                    'opaqueIsland': placement, 'oracleScale': .0625}
                for direction in (-1, 1):
                    cases.append({**common, 'id': f'{engine.lower()}-opaque-island-{placement}-{direction}', 'islandDirection': direction})
                for value in (-1, 0, 1):
                    cases.append({**common, 'id': f'{engine.lower()}-opaque-island-{placement}-literal-{value}', 'islandLiteral': value})
                cases.append({**common, 'id': f'{engine.lower()}-opaque-island-{placement}-exact', 'exactIsland': True})
                cases.append({**common, 'id': f'{engine.lower()}-opaque-island-{placement}-literal-exact', 'islandLiteral': .375})
        if os.environ.get('BLENDLINK_NOISE_INPUT_STAGE_CANARY'):
            cases = [case for case in cases if case['kind'] in {'constant', 'image-control'}]
            for direction in (-1, 1):
                cases.append({'id': f'{engine.lower()}-input-stage-canary-{direction}', 'kind': 'noise',
                    'dimensions': '4D', 'output': 'Color', 'stage': 'constant', 'coordinateCanary': direction,
                    'Detail': 0, 'Roughness': .5, 'Lacunarity': 2, 'Scale': 1, 'oracleScale': .0625})
        if os.environ.get('BLENDLINK_MATH_MODULO_PROBE') or os.environ.get('BLENDLINK_MATH_MODULO_NATIVE'):
            cases = [case for case in cases if case['kind'] in {'constant', 'image-control'}]
            points = [0.0, -0.0, 99999.9921875, 100000.0, 100000.0078125, -100000.0,
                      1000000.0, -1000000.0, 16777216.0, -16777216.0, 1000000000.0, -1000000000.0,
                      1074099968.0, 1074100096.0, -1074099968.0, -1074100096.0,
                      1638499968.0, -1638499968.0, 2147483520.0, -2147483520.0, 2147483648.0, -2147483648.0]
            qualified_modulo = bool(os.environ.get('BLENDLINK_MATH_MODULO_NATIVE'))
            if qualified_modulo:
                points = [16777232.0, -16777232.0, 1000000000.0, -1000000000.0,
                          1074099968.0, 1074100096.0, -1074099968.0, -1074100096.0,
                          1638499968.0, -1638499968.0, 2147483520.0, -2147483520.0]
            for index, point in enumerate(points):
                for stage in ('constant', 'image'):
                    for variant in (('remainder',) if qualified_modulo else ('remainder', 'quotient')):
                        cases.append({'id': f'{engine.lower()}-math-modulo-{index}-{stage}-{variant}',
                            'kind': 'math-modulo-probe', 'stage': stage, 'point': point, 'variant': variant,
                            **({'coordinates': [point, 0, 0]} if stage == 'constant' else {'coordinateOffset': [point, 0, 0]})})
                    if point in (0, -100000, -1000000, -1000000000) or qualified_modulo and point == 1000000000:
                        cases.append({'id': f'{engine.lower()}-math-modulo-{index}-{stage}-zero-sign',
                            'kind': 'math-modulo-probe', 'stage': stage, 'point': point, 'variant': 'zero-sign',
                            **({'coordinates': [point, 0, 0]} if stage == 'constant' else {'coordinateOffset': [point, 0, 0]})})
            if qualified_modulo:
                for sign in ('positive', 'negative'):
                    cases.append({'id': f'{engine.lower()}-math-modulo-wide-{sign}', 'kind': 'math-modulo-probe',
                        'stage': 'image', 'point': 0, 'variant': 'remainder', 'coordinateOffset': [0,0,0],
                        'inputPrecision': 'modulo-' + sign})
                    cases.append({'id': f'{engine.lower()}-math-modulo-half-field-{sign}', 'kind': 'math-modulo-probe',
                        'stage': 'image', 'point': 0, 'variant': 'remainder', 'coordinateOffset': [1000000000 * (1 if sign == 'positive' else -1),0,0],
                        'inputPrecision': 'modulo-half-' + sign})
        if os.environ.get('BLENDLINK_NOISE_COORDINATE_CONTROLS_ONLY'):
            cases = [case for case in cases if case['kind'] in {'constant','image-control','coordinate-control','coordinate-quotient'}]
        if os.environ.get('BLENDLINK_NOISE_ARTIST_ONLY'):
            cases = [case for case in cases if case['kind'] in {'constant','image-control'} or '-artist-' in case['id']]
        if os.environ.get('BLENDLINK_NOISE_RESIDUAL_ONLY'):
            cases = [case for case in cases if case['kind'] in {'constant', 'image-control'} or case.get('residual')]
        if os.environ.get('BLENDLINK_NOISE_BOUNDARY_ONLY'):
            cases = [case for case in cases if case['kind'] in {'constant', 'image-control'} or '-hybrid-cutoff-' in case['id'] or '-ridged-floor-' in case['id']]
        if os.environ.get('BLENDLINK_NOISE_STATIC_4D_ONLY'):
            cases = [case for case in cases if case['kind'] in {'constant', 'image-control'}
                     or (case.get('dimensions') == '4D' and case.get('output') == 'Color'
                         and case.get('stage') == 'constant')]
        if os.environ.get('BLENDLINK_MATH_MODULO_MF_ONLY'):
            assert os.environ.get('BLENDLINK_MATH_MODULO_NATIVE') and bpy.app.version >= (5, 0, 0), 'MF-only Modulo requires the native profile and modern Blender'
            cases = [case for case in cases if case['kind'] in {'constant', 'image-control'}
                     or case['kind'] == 'math-modulo-probe' and case['stage'] == 'constant']
        if os.environ.get('BLENDLINK_NOISE_FIELD_FOCUS'):
            # Start with the actual expensive Color fields, before a long
            # corpus can hide their compiler/device failure behind earlier rows.
            # Keep the independent row/carrier controls and amplified residual.
            cases = [case for case in cases if case['kind'] in {'constant', 'image-control'}
                or (case['kind'] == 'noise' and case.get('dimensions') == '4D'
                    and case.get('output') == 'Color' and case.get('stage') == 'image'
                    and case.get('type', 'FBM') == 'FBM' and case.get('Detail', 0) >= 4
                    and case.get('Distortion', 0) == 0 and not case.get('roughnessStage'))]
            assert any(case['kind'] == 'noise' for case in cases), 'Field focus selected no actual native field'
        requested_count += len(cases)
        source_profile = tsl_ir._normalized_noise_source_profile(engine, sys.platform, platform.machine(), scene.cycles.device)
        expected_source_refusals = {case['id'] for case in cases if varying and engine == 'CYCLES'
            and source_profile is None and case.get('roughnessStage') == 'constant-function'}
        observed_source_refusals = set()
        expected_native_distortion_refusals = {case['id'] for case in cases if varying and engine != 'CYCLES' and case.get('kind') == 'noise'
            and case.get('normalize') is True and case.get('type','FBM') == 'FBM' and case.get('roughnessStage') and case.get('Distortion',0) != 0
            and (bool(case.get('inputCancellationAxis')) or not (bpy.context.preferences.system.gpu_backend == 'METAL' and (case.get('dimensions') == '1D'
                     or bpy.app.version >= (5,0,0) and case.get('stage') == 'constant')))}
        observed_native_distortion_refusals = set()
        assert len({case['id'] for case in cases}) == len(cases), 'Native reference case IDs must be unique'
        for case in cases:
            if case.get('roughnessStage') and case.get('type', 'FBM') == 'FBM':
                bound = 1 if case.get('normalize') else 9
                case['oracleScale'] = case.get('oracleScaleOverride', 2 ** math.floor(math.log2(.25 / bound)))
            elif case.get('type', 'FBM') != 'FBM':
                bound = fractal_amplitude_bound(case['type'], case.get('Detail', 2), case.get('Roughness', .5),
                                               case.get('Offset', 0) if case['type'] != 'MULTIFRACTAL' else 0,
                                               case.get('Gain', 1) if case['type'] in {'HYBRID_MULTIFRACTAL', 'RIDGED_MULTIFRACTAL'} else 1)
                case['amplitudeBound'] = bound
                case['oracleScale'] = case.get('oracleScaleOverride', 2 ** math.floor(math.log2(.25 / max(1, bound))))
            material, emission = make_material(case)
            proxy.data.materials.clear()
            proxy.data.materials.append(material)
            if case.get('residual'):
                coarse = native_pixels(material, temporary, case['id'] + '-coarse')
                amplification = 256 * case['oracleScale']
                add_residual_control(material, emission, coarse, case['oracleScale'], amplification)
                case['oracleScale'] = amplification
            before = (len(bpy.data.materials), len(bpy.data.node_groups), len(material.node_tree.nodes))
            try:
                document = tsl_ir.emit_channel(emission.inputs['Color'])
            except tsl_ir.TslIrRefusal as error:
                # These are declared Cycles source/cost limits, not hidden
                # omissions from the primary EEVEE numerical corpus.
                qualified = source_qualified_roughness_refusal(case, engine, varying, str(error), source_profile)
                native_distortion = native_live_distortion_refusal(case,engine,varying,str(error),bpy.context.preferences.system.gpu_backend,bpy.app.version)
                input_arithmetic = (case.get('coordinateCanary') and engine != 'CYCLES' and bpy.app.version < (5, 0, 0)
                                    and str(error).startswith('Static 4D Noise Color shader input arithmetic'))
                opaque_island = (os.environ.get('BLENDLINK_NOISE_OPAQUE_ISLAND') and case.get('opaqueIsland')
                                 and 'islandDirection' in case and str(error).startswith('Static 4D Noise Color mixed input has unverified constant arithmetic'))
                modulo_zero = (os.environ.get('BLENDLINK_MATH_MODULO_NATIVE') and case.get('kind') == 'math-modulo-probe'
                               and case.get('stage') == 'constant' and case.get('point') == -1000000000
                               and bpy.app.version >= (5,0,0) and str(error).startswith('Native MF fixed100000 Modulo negative-zero composition'))
                modulo_image = (os.environ.get('BLENDLINK_MATH_MODULO_NATIVE') and case.get('inputPrecision') in ('modulo-positive','modulo-negative')
                                and bpy.app.version < (5,0,0) and str(error).startswith('Legacy Metal fixed100000 Modulo image input requires exactly-half payload'))
                if not (opaque_island or modulo_image or modulo_zero or input_arithmetic or native_distortion or qualified or normalized and engine == 'CYCLES' and (
                        'no verified live source precision profile' in str(error)
                        or 'Normalized Noise Cycles SIMD 3D/4D' in str(error))): raise
                assert before == (len(bpy.data.materials), len(bpy.data.node_groups), len(material.node_tree.nodes))
                refusal = {'id': case['id'], 'engine': engine, 'reason': str(error)}
                if opaque_island:
                    refusal['sourceQualification'] = 'mixed-opaque-noise-constant-arithmetic-island'
                    refusal.update(retain_refused_native_graph(material,case,engine,temporary))
                if modulo_image:
                    refusal['sourceQualification'] = 'native-legacy-metal-modulo-image-precision'
                    refusal.update(retain_refused_native_graph(material,case,engine,temporary))
                if modulo_zero:
                    refusal['sourceQualification'] = 'native-mf-modulo-negative-zero-composition'
                    refusal.update(retain_refused_native_graph(material,case,engine,temporary))
                if input_arithmetic:
                    refusal['sourceQualification'] = 'shader-constant-noise-input-arithmetic'
                    refusal.update(retain_refused_native_graph(material,case,engine,temporary))
                if qualified:
                    refusal['sourceQualification'] = 'unmeasured-cycles-normalized-roughness'
                    observed_source_refusals.add(case['id']);source_qualified_refusal_ids.add(case['id'])
                if native_distortion:
                    refusal['capabilityLimit']='native-live-roughness-distortion-source-domain'
                    refusal.update(retain_refused_native_graph(material,case,engine,temporary))
                    observed_native_distortion_refusals.add(case['id']);native_distortion_refusal_ids.add(case['id'])
                refusals.append(refusal)
                bpy.data.materials.remove(material, do_unlink=True)
                for image in list(bpy.data.images):
                    if image.name.startswith('Exact Noise') and not image.users: bpy.data.images.remove(image)
                continue

            if case['kind'] == 'noise':
                def collect(value):
                    if isinstance(value, dict):
                        return ([value] if value.get('op') in {'noise_fractal', 'noise_normalized', 'noise_varying', 'noise_varying_native'} else []) + [item for child in value.values() for item in collect(child)]
                    if isinstance(value, list): return [item for child in value for item in collect(child)]
                    return []
                all_expressions = collect(document)
                # The authored Roughness subtree deliberately contains a
                # separately qualified normalized child. Validate the outer
                # capability without assigning its mode/stage to that child.
                expected_varying_op = 'noise_varying_native' if engine != 'CYCLES' and case.get('normalize') is True else 'noise_varying'
                expressions = [item for item in all_expressions if item['op'] == expected_varying_op] if varying else all_expressions
                if varying and case.get('roughnessStage') == 'constant-function':
                    nested = [item for item in all_expressions if item['op'] == 'noise_normalized']
                    assert nested and all(item['normalize'] is True for item in nested), case['id']
                assert expressions and all(expression['normalize'] == (case.get('type', 'FBM') == 'FBM' and case.get('normalize', False)) for expression in expressions), case['id']
                if normalized: assert all(expression['op'] == 'noise_normalized' for expression in expressions)
                if case.get('roughnessStage'): assert all(expression['op'] == expected_varying_op for expression in expressions)
                expected_model = 'shader-mf' if bpy.app.version >= (5, 0, 0) and case['stage'] == 'constant' else 'shader'
                assert all(expression['evaluationModel'] == expected_model for expression in expressions), case['id']
                case['evaluationModel'] = expected_model
            if case['kind'] == 'math-modulo-probe' and os.environ.get('BLENDLINK_MATH_MODULO_NATIVE'):
                def native_modulos(value):
                    if isinstance(value, dict):
                        return ([value] if value.get('op') == 'math_modulo_native' else []) + [item for child in value.values() for item in native_modulos(child)]
                    if isinstance(value, list): return [item for child in value for item in native_modulos(child)]
                    return []
                modulos = native_modulos(document)
                expected_model = 'mf-fmod100000-v1' if bpy.app.version >= (5, 0, 0) and case['stage'] == 'constant' else 'metal-mod100000-v1'
                assert modulos and all(item['precisionModel'] == expected_model for item in modulos), case['id']
                expected_input = ('literal-f32-v1' if case['stage'] == 'constant' else 'metal-half-exact-image-v1'
                                  if bpy.app.version < (5,0,0) else 'metal-f32-image-v1')
                assert all(item['inputModel'] == expected_input for item in modulos), case['id']
                case['moduloPrecisionModel'] = expected_model
                case['moduloInputModel'] = expected_input
            assert before == (len(bpy.data.materials), len(bpy.data.node_groups), len(material.node_tree.nodes))
            (OUTPUT / 'ir' / (case['id'] + '.json')).write_text(json.dumps(document))
            raw = native_pixels(material, temporary, case['id'])
            pixels = raw if case.get('stage') == 'image' else np.tile(raw[SIZE // 2, SIZE // 2, :3], (SIZE, SIZE, 1))
            assert np.isfinite(pixels).all(), case['id']
            pixels.astype('<f4').tofile(OUTPUT / (case['id'] + '.f32'))
            case.update(engine=engine, minimum=pixels.min(axis=(0, 1)).tolist(), maximum=pixels.max(axis=(0, 1)).tolist())
            records.append(case)
            bpy.data.materials.remove(material, do_unlink=True)
            for image in list(bpy.data.images):
                if image.name.startswith('Exact Noise') and not image.users: bpy.data.images.remove(image)
        assert observed_native_distortion_refusals == expected_native_distortion_refusals,(engine,sorted(expected_native_distortion_refusals),sorted(observed_native_distortion_refusals))
        assert observed_source_refusals == expected_source_refusals, (engine, sorted(expected_source_refusals), sorted(observed_source_refusals))
        if 'RIDGED_MULTIFRACTAL' in requested_types and not os.environ.get('BLENDLINK_NOISE_RESIDUAL_ONLY'):
            for stage in ['constant', 'image']:
                first = OUTPUT / f'{engine.lower()}-ridged-floor-{stage}-1.f32'
                fractional = OUTPUT / f'{engine.lower()}-ridged-floor-{stage}-1_75.f32'
                first_id = first.stem;fractional_id = fractional.stem
                if first_id in observed_source_refusals or fractional_id in observed_source_refusals:
                    assert {first_id,fractional_id} <= observed_source_refusals
                else:
                    assert first.read_bytes() == fractional.read_bytes(), 'Native Ridged fractional-detail semantics changed'
assert len(records) + len(refusals) == requested_count, 'Native corpus cases disappeared without a qualified refusal'
(OUTPUT / 'index.json').write_text(json.dumps({'blender': bpy.app.version_string, 'buildHash': bpy.app.build_hash.decode(),
    'gpuBackend': bpy.context.preferences.system.gpu_backend, 'gpuRenderer': tsl_ir._noise_gpu_renderer(),
    'platform': sys.platform, 'architecture': platform.machine(), 'cyclesDevice': 'CPU', 'size': SIZE, 'cases': records, 'refusals': refusals,
    'requestedCases': requested_count, 'sourceQualifiedRefusalIds': sorted(source_qualified_refusal_ids), 'nativeDistortionRefusalIds': sorted(native_distortion_refusal_ids),
    'nativeModuleHashes': {path.name: hashlib.sha256(path.read_bytes()).hexdigest() for path in Path(native).iterdir()
                           if path.suffix in {'.py', '.json'}} if native else {}}, indent=2))
print('BLENDLINK_NOISE_REFERENCES_PASSED ' + str(len(records)))
