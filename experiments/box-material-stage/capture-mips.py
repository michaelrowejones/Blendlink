# SPDX-License-Identifier: GPL-3.0-or-later
"""Cold background-only native typed mip transport feasibility; no renders."""
import hashlib,json,sys,time
from pathlib import Path
import bpy,numpy as np
source,out,_retained=map(lambda p:Path(p).resolve(),sys.argv[sys.argv.index('--')+1:][:3])
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
assert bpy.app.background and bpy.app.version==(5,3,0) and bpy.app.build_hash==b'02f0899d78e3'
assert sha(source)=='9f636b2e1a59b3d181f90caf1b1703658eeadebad57f3c6207737d2fe3ffd85e'
bpy.ops.wm.open_mainfile(filepath=str(source))
report={'status':'RUNNING_COLD_BACKGROUND_MIP_RESEARCH','supportCredit':0,'materialCredit':0,'sceneCredit':0,'source':str(source),'sourceSha256':sha(source),'captureSha256':sha(__file__),'background':bpy.app.background,'renderCalls':0,'levels':[]}
(out/'partial.json').write_text(json.dumps(report,indent=2)+'\n')
print('MIP_TRANSPORT before_gpu_init',flush=True)
import gpu
from gpu_extras.batch import batch_for_shader
try:
 gpu.init();report['gpu']={'backend':gpu.platform.backend_type_get(),'renderer':gpu.platform.renderer_get()};assert report['gpu']['backend']=='METAL'
 print('MIP_TRANSPORT before_from_image',flush=True);started=time.perf_counter()
 native=gpu.texture.from_image(bpy.data.images['Plaster-Overlay.png'])
 report['sourceGpuFormat']=native.format;assert native.format=='SRGB8_A8'
 print('MIP_TRANSPORT image_ready',flush=True)
 info=gpu.types.GPUShaderCreateInfo();info.vertex_in(0,'VEC2','pos');info.fragment_out(0,'VEC4','fragColor');info.sampler(0,'FLOAT_2D','sourceTex');info.push_constant('VEC4','levelInfo')
 info.vertex_source('void main(){gl_Position=vec4(pos,0.0,1.0);}')
 info.fragment_source('void main(){vec2 uv=gl_FragCoord.xy/levelInfo.y;fragColor=textureLod(sourceTex,uv,levelInfo.x);}')
 shader=gpu.shader.create_from_info(info);batch=batch_for_shader(shader,'TRI_FAN',{'pos':[(-1,-1),(1,-1),(1,1),(-1,1)]})
 for level in range(11):
    size=1024>>level;target=gpu.types.GPUTexture((size,size),format='SRGB8_A8');assert target.format=='SRGB8_A8';frame=gpu.types.GPUFrameBuffer(color_slots=[target]);previous=gpu.state.viewport_get()
    try:
        with frame.bind():
            gpu.state.viewport_set(0,0,size,size);gpu.state.blend_set('NONE');gpu.state.depth_test_set('NONE');frame.clear(color=(0,0,0,0));shader.bind();shader.uniform_sampler('sourceTex',native);shader.uniform_float('levelInfo',[level,size,0,0]);batch.draw(shader)
            values=np.asarray(frame.read_color(0,0,size,size,4,0,'UBYTE'),np.uint8).copy();assert values.shape==(size,size,4)
    finally:gpu.state.viewport_set(*previous)
    file='mip-'+str(level)+'.rgba8';(out/file).write_bytes(values.tobytes());report['levels'].append({'level':level,'width':size,'height':size,'file':file,'bytes':values.size,'sha256':sha(out/file)})
    frame=None;target=None
    (out/'partial.json').write_text(json.dumps(report,indent=2)+'\n');print('MIP_TRANSPORT level_done '+str(level),flush=True)
 report['milliseconds']=(time.perf_counter()-started)*1000;report['status']='CAPTURED_COLD_BACKGROUND_TYPED_SRGB_MIPS_NO_RENDER'
finally:
 assert sha(source)==report['sourceSha256'];report['sourcePreserved']=True
 (out/'native.json').write_text(json.dumps(report,indent=2)+'\n')
print('SCENETOWEB_BOX_MIPS '+json.dumps({'status':report['status'],'sourceSettings':{},'rows':len(report['levels'])}))
