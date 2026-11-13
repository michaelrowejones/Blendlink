# SPDX-FileCopyrightText: 2019-2023 Blender Authors
# SPDX-FileCopyrightText: 2026 Blendlink contributors
# SPDX-License-Identifier: GPL-3.0-or-later
# HSV control adapted from Blender gpu_shader_common_color_utils.glsl (GPL-2.0-or-later).
"""Independent dynamic Metal arithmetic controls; never supplies port pixels."""
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

source = json.loads(Path(os.environ['BLENDLINK_COLOR_KEY_PRIMITIVE_INPUT']).read_text())
destination = Path(os.environ['BLENDLINK_COLOR_KEY_PRIMITIVE_OUTPUT']).resolve()
destination.parent.mkdir(parents=True, exist_ok=True)
pixels = np.asarray(source['input'], np.float32).reshape(source['height'], source['width'], 4)
height, width = pixels.shape[:2]
with tempfile.TemporaryDirectory(prefix='blendlink-color-key-primitives-') as temporary:
    oracle = NativeCompositorReference(Path(temporary), device='GPU', pixels=pixels, image_only_scene=True, node_previews=False)
    engines = {item.identifier for item in oracle.scene.render.bl_rna.properties['engine'].enum_items}
    oracle.scene.render.engine = 'BLENDER_EEVEE_NEXT' if 'BLENDER_EEVEE_NEXT' in engines else 'BLENDER_EEVEE'
    sink, source_node = oracle.reset()
    image = oracle.tree.nodes.new('CompositorNodeImage'); image.image = oracle.image
    oracle.tree.links.new(image.outputs['Image'], sink.inputs[0])
    oracle.scene.render.filepath = str(Path(temporary) / 'bootstrap.exr')
    with oracle._render_sampling(): bpy.ops.render.render(write_still=True)

info = gpu.types.GPUShaderCreateInfo()
info.local_group_size(1, 1, 1)
info.sampler(0, 'FLOAT_2D', 'inputImage')
info.image(0, 'RGBA32F', 'FLOAT_2D', 'outputImage', qualifiers={'WRITE'})
info.push_constant('INT', 'height')
info.compute_source('''
vec3 source_hsv(vec3 rgb) {
  float cmax = max(rgb[0], max(rgb[1], rgb[2]));
  float cmin = min(rgb[0], min(rgb[1], rgb[2]));
  float cdelta = cmax - cmin;
  float h = 0.0, s = 0.0;
  if (cmax != 0.0) s = cdelta / cmax;
  if (s != 0.0) {
    vec3 c = (vec3(cmax) - rgb) / cdelta;
    if (rgb.x == cmax) h = c.z - c.y;
    else if (rgb.y == cmax) h = 2.0 + c.x - c.z;
    else h = 4.0 + c.y - c.x;
    h /= 6.0;
    if (h < 0.0) h += 1.0;
  }
  return vec3(h, s, cmax);
}
void main() {
  ivec2 p = ivec2(gl_GlobalInvocationID.xy);
  vec3 rgb = texelFetch(inputImage, p, 0).rgb;
  float high = max(rgb.r, max(rgb.g, rgb.b));
  float low = min(rgb.r, min(rgb.g, rgb.b));
  float delta = high - low;
  vec3 c = (vec3(high) - rgb) / delta;
  float raw = rgb.r == high ? c.b - c.g : rgb.g == high ? 2.0 + c.r - c.b : 4.0 + c.g - c.r;
  imageStore(outputImage, p, vec4(high, low, delta, 1.0 / delta));
  imageStore(outputImage, p + ivec2(0, height), vec4(c, raw));
  imageStore(outputImage, p + ivec2(0, 2 * height), vec4(raw / 6.0, raw * (1.0 / 6.0), (rgb.g-rgb.b) / (6.0 * delta), source_hsv(rgb).x));
  imageStore(outputImage, p + ivec2(0, 3 * height), vec4(source_hsv(rgb), 1.0));
  imageStore(outputImage, p + ivec2(0, 4 * height), vec4(delta / delta, (high-rgb.b) / delta, (high-rgb.g) / delta, (high-rgb.g) * (1.0 / delta)));
}
''')
shader = gpu.shader.create_from_info(info)
input_texture = gpu.types.GPUTexture((width, height), format='RGBA32F', data=gpu.types.Buffer('FLOAT', (height, width, 4), pixels))
output_texture = gpu.types.GPUTexture((width, height * 5), format='RGBA32F')
shader.uniform_sampler('inputImage', input_texture)
shader.image('outputImage', output_texture)
shader.uniform_int('height', height)
gpu.compute.dispatch(shader, width, height, 1)
values = np.asarray(output_texture.read().to_list(), np.float32).reshape(5, height, width, 4)
# Raw RGB includes achromatic inputs whose diagnostic divisions are undefined;
# only the native source_hsv stage is required to be finite on this corpus.
assert np.isfinite(values[3]).all()
def serial(array):
    return [None if not np.isfinite(value) else float(value) for value in array.ravel()]
result = {'blenderVersion': list(bpy.app.version), 'blenderHash': bpy.app.build_hash.decode(),
    'gpu': {'backend': gpu.platform.backend_type_get(), 'renderer': gpu.platform.renderer_get(),
            'vendor': gpu.platform.vendor_get(), 'version': gpu.platform.version_get()},
    'width': width, 'height': height, 'input': pixels.ravel().tolist(),
    'columns': [['high','low','delta','reciprocalDelta'], ['cR','cG','cB','rawSextant'],
        ['divide6','multiplyOneSixth','directRedHue','functionHue'], ['hue','saturation','value','one'],
        ['deltaOverDelta','cB','cG','cGReciprocal']],
    'stages': [serial(value) for value in values], 'words': values.view(np.uint32).ravel().tolist()}
destination.write_text(json.dumps(result, separators=(',', ':')))
print('BLENDLINK_COLOR_KEY_NATIVE_PRIMITIVES_PASSED', destination)
