# SPDX-License-Identifier: GPL-3.0-or-later
"""Research capture of actual EEVEE Radial Tiling through a calibrated digit carrier.

This does not emit Blendlink IR or implement Radial Tiling in Python/JavaScript.
The source materials, data images and all unmodified packed carrier pixels remain
available independently of the decoded readbacks.
"""
import hashlib
import json
import os
from pathlib import Path
import platform
import sys
import tempfile
import bpy
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'packages/blendlink/blender'))
from compositor_gpu import native_gpu_profile

OUTPUT = Path(os.environ['BLENDLINK_RADIAL_OUTPUT']).resolve()
OUTPUT.mkdir(parents=True, exist_ok=True)
MF = Path(os.environ['BLENDLINK_RADIAL_MF']).resolve()
SIZE = 32
SCALE = 16
BOUND = SCALE / (512 * 1024 * 1024)
bpy.ops.wm.read_factory_settings(use_empty=True)
assert bpy.app.version in [(5, 2, 0), (5, 3, 0)]
scene = bpy.context.scene
ENGINE = os.environ.get('BLENDLINK_RADIAL_ENGINE', 'eevee')
assert ENGINE in ['eevee', 'cycles']
scene.render.engine = 'CYCLES' if ENGINE == 'cycles' else 'BLENDER_EEVEE'
if ENGINE == 'cycles':
    import _cycles
    _cycles.set_device_override('CPU')
    scene.cycles.device = 'CPU'
    scene.cycles.samples = 1
    scene.cycles.use_denoising = False
if hasattr(getattr(scene, 'eevee', None), 'taa_render_samples'):
    scene.eevee.taa_render_samples = 1
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
scene.world = None
camera_data = bpy.data.cameras.new('Radial orthographic research camera')
camera_data.type = 'ORTHO'
camera_data.ortho_scale = 2
camera = bpy.data.objects.new(camera_data.name, camera_data)
scene.collection.objects.link(camera)
camera.location = (0, 0, 2)
scene.camera = camera
mesh = bpy.data.meshes.new('Actual UV carrier quad')
mesh.from_pydata([(-1, -1, 0), (1, -1, 0), (1, 1, 0), (-1, 1, 0)], [], [(0, 1, 2, 3)])
uv = mesh.uv_layers.new()
for loop in mesh.loops:
    uv.data[loop.index].uv = [(0, 0), (1, 0), (1, 1), (0, 1)][loop.vertex_index]
owner = bpy.data.objects.new(mesh.name, mesh)
scene.collection.objects.link(owner)


def math(tree, op, a, b=None):
    node = tree.nodes.new('ShaderNodeMath')
    node.operation = op
    for i, v in enumerate([a, b]):
        if v is None:
            continue
        if isinstance(v, (int, float)):
            node.inputs[i].default_value = v
        else:
            tree.links.new(v, node.inputs[i])
    return node.outputs[0]


def encode(tree, scalar):
    """Signed magnitude, 9+10+10 fraction bits in exact-half RGB digits.

    |v| <16. Every operation before FLOOR/FRACT uses a power-of-two scale.
    Red carries sign in bit9; all outputs k/1024 are exactly half representable.
    No kernel output, native pixel or fitted constant enters this math.
    """
    absolute = math(tree, 'ABSOLUTE', scalar)
    negative = math(tree, 'LESS_THAN', scalar, 0)
    scaled = math(tree, 'MULTIPLY', absolute, 512 / SCALE)
    top = math(tree, 'MULTIPLY', math(tree, 'FLOOR', scaled), 1 / 1024)
    red = math(tree, 'ADD', top, math(tree, 'MULTIPLY', negative, .5))
    green = math(tree, 'MULTIPLY', math(tree, 'FLOOR', math(tree, 'MULTIPLY', math(tree, 'FRACT', scaled), 1024)), 1 / 1024)
    blue_scaled = math(tree, 'MULTIPLY', absolute, 512 * 1024 / SCALE)
    blue = math(tree, 'MULTIPLY', math(tree, 'FLOOR', math(tree, 'MULTIPLY', math(tree, 'FRACT', blue_scaled), 1024)), 1 / 1024)
    combine = tree.nodes.new('ShaderNodeCombineXYZ')
    for i, socket in enumerate([red, green, blue]):
        tree.links.new(socket, combine.inputs[i])
    return combine.outputs[0]


def source_state(material):
    rows = []
    for n in material.node_tree.nodes:
        row = [n.name, n.bl_idname, {key: getattr(n, key) for key in ['operation', 'normalize', 'interpolation', 'extension'] if hasattr(n, key)}]
        if n.bl_idname == 'ShaderNodeTexImage':
            image = n.image
            row.append([image.name, image.source, image.file_format, bool(image.packed_file), image.colorspace_settings.name, image.colorspace_settings.is_data, image.use_half_precision, image.alpha_mode, list(image.size), hashlib.sha256(np.asarray(image.pixels[:], '<f4').tobytes()).hexdigest()])
        for s in list(n.inputs) + list(n.outputs):
            if hasattr(s, 'default_value'):
                v = s.default_value
                if not isinstance(v, (float, int, str, bool)) and v is not None:
                    v = list(v)
                row.append([s.identifier, v])
        rows.append(row)
    links = [(l.from_node.name, l.from_socket.identifier, l.to_node.name, l.to_socket.identifier) for l in material.node_tree.links]
    return hashlib.sha256(json.dumps([rows, links], sort_keys=True).encode()).hexdigest()


def data_image(name, values):
    image = bpy.data.images.new(name, width=SIZE, height=SIZE, alpha=True, float_buffer=True)
    image.colorspace_settings.name = 'Non-Color'
    image.use_half_precision = False
    image.alpha_mode = 'STRAIGHT'
    image.pixels.foreach_set(values.ravel())
    image.update()
    image.file_format = 'OPEN_EXR'
    image.pack()
    return image


def sample(tree, image):
    coords = tree.nodes.new('ShaderNodeTexCoord')
    texture = tree.nodes.new('ShaderNodeTexImage')
    texture.image = image
    texture.interpolation = 'Closest'
    texture.extension = 'EXTEND'
    tree.links.new(coords.outputs['UV'], texture.inputs['Vector'])
    separate = tree.nodes.new('ShaderNodeSeparateXYZ')
    tree.links.new(texture.outputs['Color'], separate.inputs[0])
    return texture.outputs['Color'], list(separate.outputs)


def capture(material, scalar, identifier):
    carrier = material.copy()
    carrier.name = 'Private carrier ' + identifier
    # Resolve the corresponding output in the copied tree, keeping source immutable.
    copied = carrier.node_tree.nodes[scalar.node.name].outputs[scalar.identifier]
    tree = carrier.node_tree
    emission = tree.nodes['Research Emission']
    tree.links.new(encode(tree, copied), emission.inputs['Color'])
    before = source_state(material)
    carrier_before = source_state(carrier)
    owner.data.materials.clear()
    owner.data.materials.append(carrier)
    scene.render.filepath = str(OUTPUT / (identifier + '.exr'))
    bpy.ops.render.render(write_still=True)
    image = bpy.data.images.load(scene.render.filepath, check_existing=False)
    pixels = np.asarray(image.pixels[:], np.float32).reshape(SIZE * SIZE, 4)[:, :3].copy()
    bpy.data.images.remove(image)
    assert np.isfinite(pixels).all(), identifier
    assert np.array_equal(pixels, pixels.astype(np.float16).astype(np.float32)), identifier
    assert pixels.min() >= 0 and pixels.max() <= 1023 / 1024, identifier
    assert np.array_equal(pixels * 1024, np.floor(pixels * 1024)), identifier
    sign = pixels[:, 0] >= .5
    digit = pixels[:, 0].astype(np.float64) - sign.astype(np.float64) * .5
    magnitude = digit * 1024 * SCALE / 512 + pixels[:, 1].astype(np.float64) * SCALE / 512 + pixels[:, 2].astype(np.float64) * SCALE / (512 * 1024)
    decoded = np.where(sign, -magnitude, magnitude).astype(np.float32)
    # Independent coarse positive carrier detects native NaN/Inf or out-of-band
    # outputs: a packed NaN can otherwise collapse to zero in a scene target.
    # This control is never used to improve/calibrate the decoded kernel value.
    coarse_socket = math(tree, 'ADD', math(tree, 'MULTIPLY', copied, 1 / 64), .5)
    tree.links.new(coarse_socket, emission.inputs['Color'])
    coarse_before = source_state(carrier)
    scene.render.filepath = str(OUTPUT / (identifier + '-coarse.exr'))
    bpy.ops.render.render(write_still=True)
    image = bpy.data.images.load(scene.render.filepath, check_existing=False)
    coarse = np.asarray(image.pixels[:], np.float32).reshape(SIZE * SIZE, 4)[:, 0].copy()
    bpy.data.images.remove(image)
    valid = np.isfinite(coarse) & (coarse >= .25) & (coarse <= .75) & (np.abs(coarse.astype(np.float64) - (decoded.astype(np.float64) / 64 + .5)) <= 2**-10)
    coarse_payload = coarse.astype('<f4').tobytes()
    valid_payload = valid.astype('u1').tobytes()
    (OUTPUT / (identifier + '-coarse.f32')).write_bytes(coarse_payload)
    (OUTPUT / (identifier + '-valid.u8')).write_bytes(valid_payload)
    raw = pixels.astype('<f4').tobytes()
    payload = decoded.astype('<f4').tobytes()
    (OUTPUT / (identifier + '-packed.f32')).write_bytes(raw)
    (OUTPUT / (identifier + '.f32')).write_bytes(payload)
    assert before == source_state(material), identifier
    assert coarse_before == source_state(carrier), identifier
    owner.data.materials.clear()
    bpy.data.materials.remove(carrier, do_unlink=True)
    return decoded, {'id': identifier, 'decoded': identifier + '.f32', 'sha256': hashlib.sha256(payload).hexdigest(), 'packed': identifier + '-packed.f32', 'packedSha256': hashlib.sha256(raw).hexdigest(), 'coarse': identifier + '-coarse.f32', 'coarseSha256': hashlib.sha256(coarse_payload).hexdigest(), 'finiteBandMask': identifier + '-valid.u8', 'finiteBandMaskSha256': hashlib.sha256(valid_payload).hexdigest(), 'unqualifiedSamples': int(np.count_nonzero(~valid)), 'sourceFingerprint': before, 'carrierFingerprint': carrier_before, 'coarseCarrierFingerprint': coarse_before, 'minimum': float(decoded[valid].min()) if valid.any() else None, 'maximum': float(decoded[valid].max()) if valid.any() else None}


def base_material(name):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    tree = material.node_tree
    tree.nodes.clear()
    output = tree.nodes.new('ShaderNodeOutputMaterial')
    emission = tree.nodes.new('ShaderNodeEmission')
    emission.name = 'Research Emission'
    tree.links.new(emission.outputs[0], output.inputs['Surface'])
    material.use_fake_user = True
    return material, tree, emission


original = np.fromfile(MF / 'coordinates.f32', '<f4').reshape(-1, 3)
coordinates = np.resize(original, (SIZE * SIZE, 3))
rgba = np.ones((SIZE * SIZE, 4), np.float32)
rgba[:, :3] = coordinates
source_image = data_image('Actual full-float radial coordinate field', rgba)
input_payload = coordinates.astype('<f4').tobytes()
(OUTPUT / 'authored-coordinate-field.f32').write_bytes(input_payload)

records = []
calibrations = []
material, tree, emission = base_material('Independent coordinate upload controls')
_, channels = sample(tree, source_image)
for i in range(2):
    decoded, record = capture(material, channels[i], 'control-coordinate-' + str(i))
    error = float(np.max(np.abs(decoded.astype(np.float64) - coordinates[:, i].astype(np.float64))))
    record.update(expected='authored-coordinate-field.f32', expectedChannel=i, maximumError=error, calibratedBound=BOUND, withinBound=error <= BOUND)
    calibrations.append(record)
angle = math(tree, 'ARCTAN2', channels[1], channels[0])
negative_y = math(tree, 'LESS_THAN', channels[1], 0)
segment_id = math(tree, 'FLOOR', math(tree, 'MULTIPLY', math(tree, 'ADD', math(tree, 'DIVIDE', angle, float(np.float32(2 * np.pi))), negative_y), 5))
primitive_controls = []
for name, scalar in [('atan2-y-x', angle), ('negative-y', negative_y), ('separately-authored-five-sided-id', segment_id)]:
    _, record = capture(material, scalar, 'primitive-' + name)
    record['proofRole'] = 'INDEPENDENT_NATIVE_SHADER_MATH_COMPOSITION_NO_FITTING'
    primitive_controls.append(record)

# Independent non-kernel signed, near-zero and endpoint values. Half-exact input
# rows isolate carrier math from floating image upload changes.
known = np.resize(np.asarray([-15.5, -8, -1, -2**-10, -2**-20, 0, 2**-20, 2**-10, .5, 1, 8, 15.5], np.float32), (SIZE * SIZE,))
rgba = np.ones((SIZE * SIZE, 4), np.float32)
rgba[:, :3] = known[:, None]
control_image = data_image('Independent signed carrier control', rgba)
material, tree, emission = base_material('Independent signed raw carrier')
_, channels = sample(tree, control_image)
decoded, record = capture(material, channels[0], 'control-signed-powers')
record.update(maximumError=float(np.max(np.abs(decoded.astype(np.float64) - known.astype(np.float64)))), calibratedBound=BOUND)
assert record['maximumError'] <= BOUND
calibrations.append(record)

cases = []
for normalize in [False, True]:
    for sides, roundness in [(5, 0), (5, .5), (5, 1), (3, 0), (2.5, 0), (2.5, .5), (2.5, 1), (8, .5)]:
        cases.append({'id': f'field-s{sides}-r{roundness}-n{int(normalize)}', 'sides': sides, 'roundness': roundness, 'normalize': normalize, 'stage': 'image-field'})
    for coord in [(0, 0), (.173, -.375), (1, 0), (1, -0.0), (-1, 0), (-1, -0.0)]:
        cases.append({'id': f'literal-{coord[0]}-{coord[1]}-n{int(normalize)}', 'coordinate': coord, 'sides': 5, 'roundness': 0, 'normalize': normalize, 'stage': 'literal'})
if ENGINE == 'cycles':
    cases = [case for case in cases if case['sides'] == 5 and case['roundness'] == 0]

outputs = [('Segment Coordinates', 0), ('Segment Coordinates', 1), ('Segment ID', None), ('Segment Width', None), ('Segment Rotation', None)]
for case in cases:
    material, tree, emission = base_material('Actual source Radial ' + case['id'])
    radial = tree.nodes.new('ShaderNodeRadialTiling')
    radial.normalize = case['normalize']
    radial.inputs['Sides'].default_value = case['sides']
    radial.inputs['Roundness'].default_value = case['roundness']
    if case['stage'] == 'image-field':
        incoming, _ = sample(tree, source_image)
        tree.links.new(incoming, radial.inputs['Vector'])
    else:
        radial.inputs['Vector'].default_value = case['coordinate']
    tree.links.new(radial.outputs['Segment Coordinates'], emission.inputs['Color'])
    separate = tree.nodes.new('ShaderNodeSeparateXYZ')
    tree.links.new(radial.outputs['Segment Coordinates'], separate.inputs[0])
    for output, channel in outputs:
        scalar = radial.outputs[output] if channel is None else separate.outputs[channel]
        identifier = case['id'] + '-' + output.lower().replace(' ', '-') + ('' if channel is None else '-' + str(channel))
        decoded, record = capture(material, scalar, identifier)
        record.update(case=case, output=output, channel=channel, carrierBound=BOUND)
        records.append(record)
    print('RADIAL_NATIVE_CASE', case['id'], flush=True)

source_file = OUTPUT / 'actual-source-materials.blend'
bpy.ops.wm.save_as_mainfile(filepath=str(source_file))
bpy.ops.wm.open_mainfile(filepath=str(source_file))
for record in records:
    saved_material = bpy.data.materials['Actual source Radial ' + record['case']['id']]
    assert source_state(saved_material) == record['sourceFingerprint'], record['id']
result = {'version': list(bpy.app.version), 'buildHash': bpy.app.build_hash.decode(), 'platform': platform.system(), 'machine': platform.machine(), 'sourceEngine': bpy.context.scene.render.engine, 'nativeGpuProfile': native_gpu_profile() if ENGINE == 'eevee' else None, 'proofRole': 'ACTUAL_NATIVE_' + ENGINE.upper() + '_KERNEL_RESEARCH_NO_PORT', 'carrier': {'type': 'signed-base1024-three-exact-half-digits', 'absoluteOutputLimitExclusive': SCALE, 'absoluteQuantizationBound': BOUND, 'preservesNegativeZero': False, 'nativeOutputIsNeverAProductionCoefficient': True, 'coarseControl': 'source/64+.5, [0.25,0.75], fixed target bound2^-10; no numerical comparison for mask=0'}, 'inputField': {'file': 'authored-coordinate-field.f32', 'sha256': hashlib.sha256(input_payload).hexdigest(), 'shape': list(coordinates.shape)}, 'calibrations': calibrations, 'primitiveControls': primitive_controls, 'cases': records, 'fixtureSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(), 'sourceBlendSha256': hashlib.sha256(source_file.read_bytes()).hexdigest(), 'sourcePreserved': True, 'sourceReloadPreserved': True}
(OUTPUT / 'index.json').write_text(json.dumps(result, indent=2, allow_nan=False) + '\n')
print('BLENDLINK_RADIAL_NATIVE_CAPTURED', ENGINE, len(records), flush=True)
