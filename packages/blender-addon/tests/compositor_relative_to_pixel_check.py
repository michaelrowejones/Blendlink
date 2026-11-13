# SPDX-License-Identifier: GPL-3.0-or-later
# blendlink-headless-sentinel: BLENDLINK_RELATIVE_TO_PIXEL_CHECK_PASSED
"""Actual scalar domain reference, numeric refusal and native image-size proof."""
import hashlib
import json
import os
import platform
from pathlib import Path
import sys

import bpy
import numpy as np

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'packages/blendlink/blender'))
sys.path.insert(0, str(ROOT / 'packages/blender-addon/tests'))
from compositor_reference import NativeCompositorReference
import compositor_graph

DESTINATION = os.environ.get('BLENDLINK_RELATIVE_TO_PIXEL_REFERENCES')
DEVICE = os.environ.get('BLENDLINK_RELATIVE_TO_PIXEL_DEVICE', 'CPU')
if tuple(bpy.app.version) == (5, 3, 0) and sys.platform == 'darwin' and platform.machine() == 'arm64':
    reference = NativeCompositorReference(DESTINATION or '/tmp/scenetoweb-relative-policy', device=DEVICE,
        name='Relative To Pixel', pixels=np.ones((9, 13, 4), np.float32))
    if hasattr(reference.scene, 'eevee'):
        reference.scene.render.engine = 'BLENDER_EEVEE'
        reference.scene.eevee.taa_render_samples = 1
    sink, source = reference.reset()
    node = reference.tree.nodes.new('CompositorNodeRelativeToPixel')
    reference.tree.links.new(source.outputs['Image'], node.inputs['Image'])
    reference.tree.links.new(node.outputs['Float Value'], sink.inputs[0])
    for mode in ['X','Y','Greater','Smaller']:
        node.reference_dimension = mode
        node.inputs['Float Value'].default_value = .25
        p = compositor_graph.extract(reference.scene)
        assert p['status'] == 'extracted', p
        emitted = next(op for op in p['ops'] if op['kind'] == 'relative-to-pixel')
        assert list(emitted['inputs']) == ['Value'], emitted
        assert emitted['properties']['relative_to_pixel_image']['node'] == p['ops'][0]['id']
    for mode in ['PER_DIMENSION','Diagonal']:
        node.reference_dimension = mode
        reference.tree.links.new(node.outputs['Vector Value' if mode == 'PER_DIMENSION' else 'Float Value'], sink.inputs[0])
        p = compositor_graph.extract(reference.scene)
        assert p['status'] == 'unsupported', p
    node.reference_dimension = 'X'
    reference.tree.links.new(node.outputs['Float Value'], sink.inputs[0])
    node.inputs['Float Value'].default_value = 2**30
    assert compositor_graph.extract(reference.scene)['status'] == 'unsupported'
    node.inputs['Float Value'].default_value = -0.0
    assert compositor_graph.extract(reference.scene)['status'] == 'unsupported'
    reference.scene.world = None
    if DESTINATION:
        destination = Path(DESTINATION).resolve()
        destination.mkdir(parents=True, exist_ok=True)
        rows = []
        digest = lambda path: hashlib.sha256(Path(path).read_bytes()).hexdigest()
        for mode in ['X','Y','Greater','Smaller']:
            for factor in [0,.1,.25,-.5,1,2**-126,65536,-65536]:
                sink,source=reference.reset()
                node=reference.tree.nodes.new('CompositorNodeRelativeToPixel')
                node.reference_dimension=mode
                node.inputs['Float Value'].default_value=factor
                reference.tree.links.new(source.outputs['Image'],node.inputs['Image'])
                reference.tree.links.new(node.outputs['Float Value'],sink.inputs[0])
                if factor in (.1, -.5):
                    value_node=reference.tree.nodes.new('ShaderNodeValue')
                    value_node.outputs['Value'].default_value=factor
                    reference.tree.links.new(value_node.outputs['Value'],node.inputs['Float Value'])
                if factor == .25:
                    group=bpy.data.node_groups.new('Artist Size '+mode,'CompositorNodeTree')
                    group.interface.new_socket(name='Value',in_out='INPUT',socket_type='NodeSocketFloat')
                    group.interface.new_socket(name='Image',in_out='INPUT',socket_type='NodeSocketColor')
                    group.interface.new_socket(name='Value',in_out='OUTPUT',socket_type='NodeSocketFloat')
                    entry=group.nodes.new('NodeGroupInput');exit=group.nodes.new('NodeGroupOutput')
                    inner=group.nodes.new('CompositorNodeRelativeToPixel');inner.reference_dimension=mode
                    group.links.new(entry.outputs['Value'],inner.inputs['Float Value'])
                    group.links.new(entry.outputs['Image'],inner.inputs['Image'])
                    group.links.new(inner.outputs['Float Value'],exit.inputs['Value'])
                    instance=reference.tree.nodes.new('CompositorNodeGroup');instance.node_tree=group
                    instance.inputs['Value'].default_value=factor
                    reference.tree.links.new(source.outputs['Image'],instance.inputs['Image'])
                    reference.tree.links.new(instance.outputs['Value'],sink.inputs[0])
                label=mode.lower()+'-'+str(factor).replace('.','p')
                source_path=None
                if factor == .25:
                    source_path=destination/(label+'.blend')
                    bpy.ops.wm.save_as_mainfile(filepath=str(source_path))
                    source_sha=digest(source_path)
                reference.save(label,source,exact_alpha=True)
                case=reference.prefix+'-'+label
                path=destination/(case+'.json')
                data=json.loads(path.read_text())
                data.update({'requireFloat32Bits':True,'assertTextureCleanup':True,
                             'assertShaderCost':{'maxPasses':1,'maxFragmentBytes':16384}})
                path.write_text(json.dumps(data,separators=(',',':')))
                program_path=destination/(case+'.program.json')
                program_path.write_text(json.dumps(data['program'],indent=2)+'\n')
                pixel_path=destination/(case+'.rgba32f')
                pixel_path.write_bytes(np.asarray(data['expected'],np.float32).tobytes())
                rows.append({'case':case,'width':data['width'],'height':data['height'],
                             'programFile':program_path.name,'programSha256':digest(program_path),
                             'pixelFile':pixel_path.name,'pixelSha256':digest(pixel_path),
                             **({'sourceFile':source_path.name,'sourceSha256':source_sha} if source_path else {})})
                if source_path: assert digest(source_path)==source_sha

        reference.finish('BLENDLINK_RELATIVE_TO_PIXEL_REFERENCES_PASSED')
        source_paths=[Path(__file__),ROOT/'packages/blendlink/blender/compositor_relative_to_pixel.py',Path(compositor_graph.__file__)]
        (destination/'qualification.json').write_text(json.dumps({'status':'native-relative-scalar-qualified',
            'version':list(bpy.app.version),'build':bpy.app.build_hash.decode(),'device':DEVICE,
            'sourceHashes':{str(path.relative_to(ROOT)):digest(path) for path in source_paths},'cases':rows},indent=2)+'\n')
    print('BLENDLINK_RELATIVE_TO_PIXEL_POLICY_PASSED '+DEVICE)
print('BLENDLINK_RELATIVE_TO_PIXEL_CHECK_PASSED '+bpy.app.version_string)
