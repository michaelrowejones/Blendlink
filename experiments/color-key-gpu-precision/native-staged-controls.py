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

hsv_source = r"""
void source_hsv(vec4 rgb, out vec4 outcol) {
  float cmax, cmin, h, s, v, cdelta;
  vec3 c;
  cmax = max(rgb[0], max(rgb[1], rgb[2]));
  cmin = min(rgb[0], min(rgb[1], rgb[2]));
  cdelta = cmax - cmin;
  v = cmax;
  if (cmax != 0.0) s = cdelta / cmax;
  else { s = 0.0; h = 0.0; }
  if (s == 0.0) h = 0.0;
  else {
    c = (vec3(cmax) - rgb.xyz) / cdelta;
    if (rgb.x == cmax) h = c[2] - c[1];
    else if (rgb.y == cmax) h = 2.0 + c[0] - c[2];
    else h = 4.0 + c[1] - c[0];
    h /= 6.0;
    if (h < 0.0) h += 1.0;
  }
  outcol = vec4(h, s, v, rgb.w);
}
"""
models = {
 'saturation-primitives': 'float high=max(color.r,max(color.g,color.b)),low=min(color.r,min(color.g,color.b)); imageStore(outputImage,p,vec4(1.0/high,(high-low)/high,(high-low)*(1.0/high),1.0-low/high));',
 'key-only': 'vec4 b; source_hsv(key,b); imageStore(outputImage,p,b);',
 'hsv-both': 'vec4 a,b; source_hsv(color,a); source_hsv(key,b); imageStore(outputImage,p,vec4(a.x,b.x,a.y,b.y));',
 'key-wrap-terms': 'vec4 a,b; source_hsv(color,a); source_hsv(key,b); imageStore(outputImage,p,vec4(a.x,b.x,1.0-max(a.x,b.x),min(a.x,b.x)));',
 'key-hue-direct': 'vec4 a,b; source_hsv(color,a); source_hsv(key,b); imageStore(outputImage,p,vec4(a.x,b.x,a.x-b.x,min(a.x,b.x)+(1.0-max(a.x,b.x))));',
 'hsv-only': 'vec4 a; source_hsv(color, a); imageStore(outputImage,p,a);',
 'hue-only': 'vec4 a; source_hsv(color, a); imageStore(outputImage,p,vec4(a.x));',
 'hsv-with-key': 'vec4 a,b; source_hsv(color,a); source_hsv(key,b); imageStore(outputImage,p,vec4(a.xyz-b.xyz,1));',
 'key-matte': 'vec4 a,b; source_hsv(color,a); source_hsv(key,b); bool yes=distance(a.x,b.x)<thresholds.x/2.0 || min(a.x,b.x)+(1.0-max(a.x,b.x))<thresholds.x/2.0; float m=yes && distance(a.y,b.y)<thresholds.y && distance(a.z,b.z)<thresholds.z ? 0.0 : color.a; imageStore(outputImage,p,vec4(m));',
 'key-image': 'vec4 a,b; source_hsv(color,a); source_hsv(key,b); bool yes=distance(a.x,b.x)<thresholds.x/2.0 || min(a.x,b.x)+(1.0-max(a.x,b.x))<thresholds.x/2.0; float m=yes && distance(a.y,b.y)<thresholds.y && distance(a.z,b.z)<thresholds.z ? 0.0 : color.a; imageStore(outputImage,p,color*m);',
 'key-distances': 'vec4 a,b; source_hsv(color,a); source_hsv(key,b); imageStore(outputImage,p,vec4(distance(a.x,b.x),min(a.x,b.x)+(1.0-max(a.x,b.x)),distance(a.y,b.y),distance(a.z,b.z)));',
 'hsv-ratios': 'float high=max(color.r,max(color.g,color.b)), low=min(color.r,min(color.g,color.b)); vec3 c=(vec3(high)-color.rgb)/(high-low); imageStore(outputImage,p,vec4(c,1));',
 'hsv-scaled-ratios': 'float high=max(color.r,max(color.g,color.b)), low=min(color.r,min(color.g,color.b)); vec3 c=(vec3(high)-color.rgb)/(6.0*(high-low)); imageStore(outputImage,p,vec4(c,1));',
}
input_texture=gpu.types.GPUTexture((width,height),format='RGBA32F',data=gpu.types.Buffer('FLOAT',(height,width,4),pixels))
rows=[]
for name,body in models.items():
 info=gpu.types.GPUShaderCreateInfo();info.local_group_size(1,1,1)
 info.sampler(0,'FLOAT_2D','inputImage');info.image(0,'RGBA32F','FLOAT_2D','outputImage',qualifiers={'WRITE'})
 info.push_constant('VEC4','key');info.push_constant('VEC3','thresholds')
 info.compute_source(hsv_source+'\nvoid main(){ivec2 p=ivec2(gl_GlobalInvocationID.xy);vec4 color=texelFetch(inputImage,p,0);'+body+'}')
 shader=gpu.shader.create_from_info(info)
 texture=gpu.types.GPUTexture((width,height),format='RGBA32F');shader.uniform_sampler('inputImage',input_texture)
 shader.image('outputImage',texture);shader.uniform_float('key',(1,.25,.25,1));shader.uniform_float('thresholds',(.1250000149011612,1,1))
 gpu.compute.dispatch(shader,width,height,1)
 values=np.asarray(texture.read().to_list(),np.float32)
 rows.append({'model':name,'values':[None if not np.isfinite(v) else float(v) for v in values.ravel()], 'words':values.view(np.uint32).ravel().tolist()})
 try:
  from shutil import copyfile
  for suffix in ['.msl','.expanded.msl']:
   snapshot=Path('Shaders/_pyGPU_Shader_comp'+suffix)
   if snapshot.exists():copyfile(snapshot,destination.parent/(name+suffix))
 except OSError:raise
result={'blenderVersion':list(bpy.app.version),'blenderHash':bpy.app.build_hash.decode(),
 'gpu':{'backend':gpu.platform.backend_type_get(),'renderer':gpu.platform.renderer_get(),'vendor':gpu.platform.vendor_get(),'version':gpu.platform.version_get()},
 'width':width,'height':height,'input':pixels.ravel().tolist(),'rows':rows}
destination.write_text(json.dumps(result,separators=(',',':')))
print('BLENDLINK_COLOR_KEY_NATIVE_STAGED_PASSED',destination)
