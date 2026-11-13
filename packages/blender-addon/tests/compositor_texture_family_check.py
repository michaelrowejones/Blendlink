# SPDX-License-Identifier: GPL-3.0-or-later
# blendlink-headless-sentinel: BLENDLINK_COMPOSITOR_TEXTURE_FAMILY_CHECK_PASSED
"""Native modern compositor Gradient/Checker programs, with separate field controls."""
import hashlib
import json
import os
from pathlib import Path
import struct
import sys
import tempfile

import bpy
import numpy as np

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'packages/blendlink/blender'))
sys.path.insert(0, str(ROOT / 'packages/blender-addon/tests'))
import compositor_graph
import compositor_procedural_texture as helper
from compositor_reference import NativeCompositorReference

DEVICE = os.environ.get('BLENDLINK_TEXTURE_DEVICE', 'CPU')
DESTINATION = os.environ.get('BLENDLINK_TEXTURE_REFERENCES')
sha = lambda path: hashlib.sha256(Path(path).read_bytes()).hexdigest()


def main(destination):
    oracle = NativeCompositorReference(destination, device=DEVICE, name='Artist Texture Family', image_only_scene=True)
    scene, tree = oracle.scene, oracle.tree
    scene.render.engine = 'BLENDER_EEVEE'
    scene.world = None
    oracle.pixels[0, 0] = [-0., .25, .5, 1]
    oracle.image.pixels.foreach_set(oracle.pixels.ravel())
    try:
        node = tree.nodes.new('ShaderNodeTexGradient')
    except RuntimeError:
        print('BLENDLINK_COMPOSITOR_TEXTURE_FAMILY_UNAVAILABLE zero numerical credit')
        return
    if tuple(bpy.app.version) != (5, 3, 0) or bpy.app.build_hash != b'02f0899d78e3' or sys.platform != 'darwin':
        print('BLENDLINK_COMPOSITOR_TEXTURE_FAMILY_PROFILE_NA zero numerical credit')
        return

    def reset():
        tree.nodes.clear()
        return tree.nodes.new('NodeGroupOutput')

    def vector(coords, target=tree):
        value = target.nodes.new('FunctionNodeInputVector')
        value.vector = coords
        return value.outputs['Vector']

    def texture(kind, coords, mode='LINEAR', output='Fac', scale=5, target=tree):
        node = target.nodes.new('ShaderNodeTexGradient' if kind == 'gradient' else 'ShaderNodeTexChecker')
        if kind == 'gradient':
            node.gradient_type = mode
        else:
            node.inputs['Scale'].default_value = scale
            node.inputs['Color1'].default_value = [-.25, 1.5, .125, -.5]
            node.inputs['Color2'].default_value = [2, -.125, .75, 1.5]
        target.links.new(vector(coords, target), node.inputs['Vector'])
        return node, node.outputs[output]

    sink = reset()
    node = tree.nodes.new('ShaderNodeTexGradient')
    tree.links.new(node.outputs['Fac'], sink.inputs[0])
    refused = compositor_graph.extract(scene)
    assert refused['status'] == 'extracted' and refused['ops'][0]['properties']['procedural_texture_coordinate_model'] == 'implicit-uniform-full-frame-v1'
    node, output = texture('gradient', [.5, -.25, .125])
    tree.links.new(output, sink.inputs[0])
    node.gradient_type = 'RADIAL'
    assert compositor_graph.extract(scene)['status'] == 'unsupported'
    node.gradient_type = 'EASING'
    node.inputs['Vector'].links[0].from_node.vector[0] = .1
    assert compositor_graph.extract(scene)['status'] == 'unsupported'
    node.inputs['Vector'].links[0].from_node.vector[0] = .5
    node.texture_mapping.translation[0] = 1
    assert compositor_graph.extract(scene)['status'] == 'unsupported'
    assert not helper.finite_word(-0.) and helper.finite_word(0.)
    if not DESTINATION:
        print('BLENDLINK_COMPOSITOR_TEXTURE_FAMILY_POLICY_PASSED '+bpy.app.version_string)
        return

    rows = []
    source_hashes = {str(p.relative_to(ROOT)): sha(p) for p in [Path(__file__), Path(helper.__file__), Path(compositor_graph.__file__)]}
    coords = [[x, -.25, .125] for x in [-16, -1, -.5, 0, .0625, .25, .5, .75, .9375, 1, 2, 16]]
    coords += [[-.5, .75, -.25], [.75, 1.5, -2]]

    def capture(label, sink, output, *, save=False, field_source=None):
        tree.links.new(output, sink.inputs[0])
        for item in tree.nodes:
            item.show_preview = False
        source = destination / (label + '.blend') if save else None
        if source:
            bpy.ops.wm.save_as_mainfile(filepath=str(source))
            source_hash = sha(source)
        program = compositor_graph.extract(scene)
        assert program['status'] == 'extracted', program
        program_path = destination / (label + '.program.json')
        program_path.write_text(json.dumps(program, indent=2)+'\n')
        replacement = None
        if field_source:
            replacement = tree.nodes.new('CompositorNodeImage')
            replacement.image = oracle.image
            for link in list(field_source.outputs['Image'].links):
                tree.links.new(replacement.outputs['Image'], link.to_socket)
        scene.render.filepath = str(destination / (label + '.exr'))
        with oracle._render_sampling():
            bpy.ops.render.render(write_still=True)
        image = bpy.data.images.load(scene.render.filepath, check_existing=False)
        image.alpha_mode = 'PREMUL'
        pixels = np.empty(8*8*4, np.float32)
        image.pixels.foreach_get(pixels)
        bpy.data.images.remove(image)
        assert np.isfinite(pixels).all()
        pixel_path = destination / (label + '.rgba32f')
        pixel_path.write_bytes(pixels.tobytes())
        if source:
            assert sha(source) == source_hash
        row = {'case': label, 'programFile': program_path.name, 'programSha256': sha(program_path),
               'pixelFile': pixel_path.name, 'pixelSha256': sha(pixel_path), 'field': bool(field_source),
               **({'sourceFile': source.name, 'sourceSha256': source_hash} if source else {})}
        if field_source:
            input_path = destination / (label + '.input.rgba32f')
            input_path.write_bytes(oracle.pixels.tobytes())
            row.update(inputFile=input_path.name, inputSha256=sha(input_path))
        rows.append(row)

    for mode in ['LINEAR', 'QUADRATIC', 'EASING', 'DIAGONAL']:
        for output in ['Fac', 'Color']:
            for i, point in enumerate(coords):
                sink = reset()
                node, socket = texture('gradient', point, mode=mode, output=output)
                capture('gradient-'+mode.lower()+'-'+output.lower()+'-'+str(i), sink, socket, save=i==6)
    for mode in ['LINEAR']:
        for output in ['Fac', 'Color']:
            for i, x in enumerate([-(2**-125), 2**-125, float(np.nextafter(np.float32(.5), np.float32(1)))]):
                sink = reset()
                node, socket = texture('gradient', [x, 0, 0], mode=mode, output=output)
                capture('gradient-'+mode.lower()+'-'+output.lower()+'-edge-'+str(i), sink, socket)
    for scale in [0, 1, 5, 16, 256]:
        for output in ['Fac', 'Color']:
            for i, point in enumerate(coords):
                sink = reset()
                node, socket = texture('checker', point, output=output, scale=scale)
                capture('checker-'+str(scale)+'-'+output.lower()+'-'+str(i), sink, socket, save=i==6 and scale==5)
    sink = reset()
    source = tree.nodes.new('CompositorNodeRLayers')
    node = tree.nodes.new('ShaderNodeTexGradient')
    tree.links.new(source.outputs['Image'], node.inputs['Vector']);tree.links.new(node.outputs['Fac'], sink.inputs[0])
    refused = compositor_graph.extract(scene)
    assert refused['status'] == 'unsupported' and any('general fields' in row['message'] for row in refused['diagnostics'])
    # Actual authored group default proves flattened vectors are literals, not default texture coordinates.
    for kind in ['gradient', 'checker']:
        sink = reset()
        group = bpy.data.node_groups.new('Artist '+kind+' Group', 'CompositorNodeTree')
        group.interface.new_socket(name='Vector', in_out='INPUT', socket_type='NodeSocketVector')
        group.interface.new_socket(name='Color', in_out='OUTPUT', socket_type='NodeSocketColor')
        group_in = group.nodes.new('NodeGroupInput');group_out = group.nodes.new('NodeGroupOutput')
        node = group.nodes.new('ShaderNodeTexGradient' if kind=='gradient' else 'ShaderNodeTexChecker')
        group.links.new(group_in.outputs[0], node.inputs['Vector']);group.links.new(node.outputs['Color'], group_out.inputs[0])
        instance = tree.nodes.new('CompositorNodeGroup');instance.node_tree = group;instance.inputs['Vector'].default_value = [.5, -.25, .125]
        capture(kind+'-group', sink, instance.outputs[0], save=True)
    for kind in ['gradient', 'checker']:
        sink = reset()
        combine = tree.nodes.new('ShaderNodeCombineXYZ')
        for axis, value in zip('XYZ', [-.5 if kind=='gradient' else -1.5, .25, .5]):
            scalar = tree.nodes.new('ShaderNodeValue');scalar.outputs[0].default_value = value
            tree.links.new(scalar.outputs[0], combine.inputs[axis])
        node = tree.nodes.new('ShaderNodeTexGradient' if kind=='gradient' else 'ShaderNodeTexChecker')
        tree.links.new(combine.outputs[0], node.inputs['Vector'])
        if kind=='checker':
            color = tree.nodes.new('CompositorNodeRGB');color.outputs['Color'].default_value = [-.25, 1.5, .125, -.5]
            tree.links.new(color.outputs['Color'], node.inputs['Color1'])
        capture(kind+'-linked-'+('vector' if kind=='gradient' else 'colors'), sink, node.outputs['Color'], save=True)
    report = {'status':'CAPTURED_TEXTURE_FAMILY_NATIVE','version':list(bpy.app.version),'build':bpy.app.build_hash.decode(),
              'device':DEVICE,'width':8,'height':8,'sourceHashes':source_hashes,'cases':rows}
    (destination/'qualification.json').write_text(json.dumps(report,indent=2)+'\n')
    print('BLENDLINK_COMPOSITOR_TEXTURE_REFERENCES_PASSED '+json.dumps({'device':DEVICE,'cases':len(rows)}))


if DESTINATION:
    destination=Path(DESTINATION).resolve();destination.mkdir(parents=True,exist_ok=True);main(destination)
else:
    with tempfile.TemporaryDirectory(prefix='scenetoweb-texture-policy-') as temporary:
        main(Path(temporary))
print('BLENDLINK_COMPOSITOR_TEXTURE_FAMILY_CHECK_PASSED '+bpy.app.version_string)
