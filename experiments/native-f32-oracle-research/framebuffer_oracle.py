# SPDX-License-Identifier: MIT
"""Research-only direct Float32 shader surface; no EEVEE material credit."""
import hashlib
import gpu
import numpy as np
from gpu_extras.batch import batch_for_shader
VERTEX_SOURCE='void main(){gl_Position=vec4(pos,0.0,1.0);}'

def initialize_metal():
 gpu.init()
 identity={'backend':gpu.platform.backend_type_get(),'renderer':gpu.platform.renderer_get(),'vendor':gpu.platform.vendor_get(),'version':gpu.platform.version_get()}
 if identity['backend']!='METAL':raise RuntimeError('Research oracle requires its pinned Metal profile')
 return identity

class FramebufferOracle:
 def __init__(self,width):
  if not isinstance(width,int)or not 1<=width<=2048:raise ValueError('Research oracle width exceeds bounded1..2048')
  self.width=width;self.texture=gpu.types.GPUTexture((width,1),format='RGBA32F');self.framebuffer=gpu.types.GPUFrameBuffer(color_slots=[self.texture])
 def compile(self,fragment,*,samplers=(),uniforms=()):
  if len(fragment)>200000:raise ValueError('Research source exceeds200KB bound')
  info=gpu.types.GPUShaderCreateInfo();info.vertex_in(0,'VEC2','pos');info.fragment_out(0,'VEC4','fragColor')
  for slot,name in enumerate(samplers):info.sampler(slot,'FLOAT_2D',name)
  for name in uniforms:info.push_constant('VEC4',name)
  info.vertex_source(VERTEX_SOURCE);info.fragment_source(fragment);shader=gpu.shader.create_from_info(info)
  return shader,batch_for_shader(shader,'TRI_FAN',{'pos':[(-1,-1),(1,-1),(1,1),(-1,1)]})
 def draw(self,compiled,*,samplers=None,uniforms=None):
  shader,batch=compiled;previous=gpu.state.viewport_get()
  try:
   with self.framebuffer.bind():
    gpu.state.viewport_set(0,0,self.width,1);gpu.state.blend_set('NONE');gpu.state.depth_test_set('NONE');self.framebuffer.clear(color=(0,0,0,0));shader.bind()
    for name,texture in(samplers or{}).items():shader.uniform_sampler(name,texture)
    for name,value in(uniforms or{}).items():shader.uniform_float(name,np.asarray(value,np.float32).tolist())
    batch.draw(shader);return np.asarray(self.framebuffer.read_color(0,0,self.width,1,4,0,'FLOAT'),np.float32).reshape(self.width,4).copy()
  finally:gpu.state.viewport_set(*previous)
 def release(self):
  self.framebuffer=None;self.texture=None

def calibration(oracle):
 shader=oracle.compile('void main(){fragColor=sourceValue;}',uniforms=['sourceValue']);f=np.float32
 values=[('nonhalf-positive',[.1234567,.8765432,1.5678912,1]),('signed-hdr',[-.2345679,-2016.125,2049,1]),('tiny-normal',[2**-32,-2**-32,2**-126,1]),('adjacent',[np.nextafter(f(.5),f(1)),np.nextafter(f(.5),f(0)),np.nextafter(f(1),f(2)),1]),('signed-zero',[-0.,0.,-0.,1])];rows=[]
 for name,value in values:
  expected=np.asarray(value,np.float32);actual=oracle.draw(shader,uniforms={'sourceValue':expected});assert np.array_equal(actual.view(np.uint32),np.tile(expected,(oracle.width,1)).view(np.uint32)),name
  rows.append({'case':name,'expectedWords':expected.view(np.uint32).astype(np.uint64).tolist(),'pixelsSha256':hashlib.sha256(actual.tobytes()).hexdigest(),'wordMismatches':0})
 return rows
