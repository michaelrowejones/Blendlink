# SPDX-License-Identifier: GPL-3.0-or-later
"""Independent public-GPU coordinate controls, separate from the port's algebra.

Run with Blender's --background --factory-startup --python-exit-code 1 -t 1
and BLENDLINK_RESAMPLE_GPU_COORDINATES=/absolute/output.json.
"""
import json
import os
import sys
import tempfile
from pathlib import Path

import bpy
import gpu
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'packages/blender-addon/tests'))
from compositor_reference import NativeCompositorReference


def main(destination):
    # Public compute APIs have no background GPU context before a real render.
    with tempfile.TemporaryDirectory(prefix='blendlink-gpu-coordinate-bootstrap-') as temporary:
        oracle = NativeCompositorReference(Path(temporary), device='GPU', pixels=np.ones((4, 4, 4), np.float32),
                                           node_previews=False)
        engines = {item.identifier for item in oracle.scene.render.bl_rna.properties['engine'].enum_items}
        oracle.scene.render.engine = 'BLENDER_EEVEE_NEXT' if 'BLENDER_EEVEE_NEXT' in engines else 'BLENDER_EEVEE'
        if hasattr(getattr(oracle.scene, 'eevee', None), 'taa_render_samples'):
            oracle.scene.eevee.taa_render_samples = 1
        oracle.scene.render.filepath = str(Path(temporary) / 'bootstrap.exr')
        bpy.ops.render.render(write_still=True)

    info = gpu.types.GPUShaderCreateInfo()
    info.local_group_size(1, 1, 1)
    info.push_constant('FLOAT', 'shift')
    info.push_constant('FLOAT', 'extent')
    info.image(0, 'RGBA32F', 'FLOAT_2D', 'outputImage', qualifiers={'WRITE'})
    info.compute_source('''
void main() {
  int i = int(gl_GlobalInvocationID.x);
  float p = (float(i) + 0.5) + shift;
  float divided = p / extent;
  float multiplied = p * (1.0 / extent);
  imageStore(outputImage, ivec2(i, 0), vec4(p, divided, multiplied, divided * extent));
}
''')
    shader = gpu.shader.create_from_info(info)
    rows = []
    for extent in (13, 31, 1920, 8192):
        texture = gpu.types.GPUTexture((extent, 1), format='RGBA32F')
        shader.image('outputImage', texture)
        for delta in (.1, .2, .25, .75, .5, -.5, 1 / 512, -1 / 512, .501953125, -.501953125,
                      1.2, -2.3, -.1, -.2):
            # from_origin_transform is constructed on the CPU in native 4.2.
            shift = -np.float32(np.float32(np.float32(delta) - np.float32(extent / 2)) + np.float32(extent / 2))
            shader.uniform_float('shift', float(shift))
            shader.uniform_float('extent', extent)
            gpu.compute.dispatch(shader, extent, 1, 1)
            rows.append({'extent': extent, 'delta': delta, 'shift': float(shift),
                         'values': texture.read().to_list()[0]})
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps({'blenderVersion': bpy.app.version_string,
        'blenderHash': bpy.app.build_hash.decode(), 'gpuBackend': gpu.platform.backend_type_get(),
        'columns': ['pixelPlusShift', 'division', 'reciprocalMultiplication', 'divisionTimesExtent'],
        'warning': 'The compiler can simplify divisionTimesExtent back to pixelPlusShift. It is not a sampler-coordinate readback.',
        'rows': rows}, separators=(',', ':')))
    print('BLENDLINK_RESAMPLING_GPU_COORDINATES_PASSED', len(rows))


main(Path(os.environ['BLENDLINK_RESAMPLE_GPU_COORDINATES']).resolve())
