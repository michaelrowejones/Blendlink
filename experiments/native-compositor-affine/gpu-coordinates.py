# SPDX-License-Identifier: GPL-3.0-or-later
"""Public GPU control for the exact matrix expression used by native realization."""
import json
import os
import sys
import tempfile
from pathlib import Path

import bpy
import gpu
from mathutils import Matrix
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'packages/blender-addon/tests'))
from compositor_reference import NativeCompositorReference


def main(source, destination):
    with tempfile.TemporaryDirectory(prefix='blendlink-affine-gpu-context-') as temporary:
        oracle = NativeCompositorReference(Path(temporary), device='GPU', pixels=np.ones((4, 4, 4), np.float32), node_previews=False)
        engines = {item.identifier for item in oracle.scene.render.bl_rna.properties['engine'].enum_items}
        oracle.scene.render.engine = 'BLENDER_EEVEE_NEXT' if 'BLENDER_EEVEE_NEXT' in engines else 'BLENDER_EEVEE'
        if hasattr(getattr(oracle.scene, 'eevee', None), 'taa_render_samples'):
            oracle.scene.eevee.taa_render_samples = 1
        sink, _source = oracle.reset()
        image = oracle.tree.nodes.new('CompositorNodeImage')
        image.image = oracle.image
        image.show_preview = False
        oracle.tree.links.new(image.outputs['Image'], sink.inputs[0])
        oracle.scene.render.filepath = str(Path(temporary) / 'bootstrap.exr')
        bpy.ops.render.render(write_still=True)
    info = gpu.types.GPUShaderCreateInfo()
    info.local_group_size(1, 1, 1)
    info.push_constant('MAT4', 'matrix')
    info.image(0, 'RGBA32F', 'FLOAT_2D', 'outputImage', qualifiers={'WRITE'})
    info.compute_source('''
void main() {
  ivec2 pixel = ivec2(gl_GlobalInvocationID.xy);
  vec2 position = (mat3(matrix) * vec3(vec2(pixel), 1.0)).xy;
  imageStore(outputImage, pixel, vec4(position, 0.0, 1.0));
}
''')
    shader = gpu.shader.create_from_info(info)
    rows = []
    for test in json.loads(source.read_text()):
        width, height = test['width'], test['height']
        matrix = Matrix([test['matrix'][offset:offset + 3] for offset in (0, 3, 6)]).to_4x4()
        texture = gpu.types.GPUTexture((width, height), format='RGBA32F')
        shader.image('outputImage', texture)
        shader.uniform_float('matrix', matrix)
        gpu.compute.dispatch(shader, width, height, 1)
        values = np.asarray(texture.read().to_list(), np.float32).ravel()
        rows.append({**test, 'expected': values.tolist(), 'words': values.view(np.uint32).tolist()})
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps({'blenderVersion': bpy.app.version_string, 'blenderHash': bpy.app.build_hash.decode(),
        'backend': gpu.platform.backend_type_get(), 'rows': rows}, separators=(',', ':')))
    print('BLENDLINK_AFFINE_GPU_COORDINATES_PASSED', len(rows))


main(Path(os.environ['BLENDLINK_AFFINE_COORDINATE_INPUT']).resolve(), Path(os.environ['BLENDLINK_AFFINE_COORDINATE_OUTPUT']).resolve())
