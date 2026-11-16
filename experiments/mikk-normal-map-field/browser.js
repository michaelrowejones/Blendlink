// SPDX-License-Identifier: MIT
import * as T from 'three'
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js'
import {WebGPURenderer,NodeMaterial,QuadMesh} from 'three/webgpu'
import {screenCoordinate,uniform,vec3,vec4} from 'three/tsl'
import {sourceFrameNodes} from './candidate.mjs'
import {canonicalCornerBytes} from './canonical-corner-bytes.mjs'
import {geometryFrame} from '/geometry-inputs.mjs'
const hash=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('')
const triples=a=>Array.from({length:a.count},(_,i)=>[a.getX(i),a.getY(i),a.getZ(i)])
window.run=async(backend,inputs)=>{
 const r=new WebGPURenderer({forceWebGL:backend==='webgl2',antialias:false}),result={backend,rows:[],errors:[],supportCredit:0};window.frameFailure=result
 const target=new T.RenderTarget(128,128,{type:T.FloatType,depthBuffer:true});target.texture.colorSpace=T.NoColorSpace
 const materials=[],frames=[];const material=node=>{const m=new NodeMaterial();m.fragmentNode=node;m.side=T.DoubleSide;m.blending=T.NoBlending;materials.push(m);return m}
 try{
  await r.init();if((r.backend.isWebGPUBackend?'webgpu':'webgl2')!==backend)throw Error('Unexpected actual API')
  const gl=r.backend.gl,ext=gl?.getExtension('WEBGL_debug_renderer_info'),i=r.backend.device?.adapterInfo;result.gpu=gl?{vendor:gl.getParameter(ext.UNMASKED_VENDOR_WEBGL),renderer:gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)}:{vendor:i.vendor,architecture:i.architecture,description:i.description};if(!/Apple|Metal|apple|metal/.test(JSON.stringify(result.gpu)))throw Error('Expected Metal identity')
  r.debug.onShaderError=(g,p)=>result.errors.push(g.getProgramInfoLog(p));r.backend.device?.addEventListener('uncapturederror',e=>result.errors.push(String(e.error)))
  r.setSize(128,128);r.setPixelRatio(1);r.setClearColor(0,1);r.outputColorSpace=T.LinearSRGBColorSpace;r.toneMapping=T.NoToneMapping;r.setRenderTarget(target)
  const read=async(kind,meta={})=>{const a=await r.readRenderTargetPixelsAsync(target,0,0,128,128);result.rows.push({kind,...meta,words:Array.from(new Uint32Array(a.buffer,a.byteOffset,a.length))})}
  const calibration=material(vec4(.125,.375,.625,1)),quad=new QuadMesh(calibration);quad.render(r);await read('storage-calibration')
  for(const input of inputs){
   const gltf=await new GLTFLoader().loadAsync('/'+input.exports.find(e=>!e.yup).file);let mesh;gltf.scene.traverse(o=>{if(o.isMesh){if(mesh)throw Error('Expected one mesh');mesh=o}})
   const geometry=mesh.geometry,attributeHashes={},cornerIds=geometry.getAttribute('_stw_corner')?.array;if(!cornerIds)throw Error('Missing original corner identity');for(const name of ['_STW_FRAME_N','_STW_FRAME_T','_STW_FRAME_SIGN','_STW_CORNER']){const a=geometry.getAttribute(name.toLowerCase());if(!a||a.normalized||!(a.array instanceof Float32Array))throw Error('Missing raw frame attribute '+name);const sourceLoopOrder=await hash(canonicalCornerBytes(a,cornerIds,input.loops)),exportVertexOrder=await hash(new Uint8Array(a.array.buffer,a.array.byteOffset,a.array.byteLength));attributeHashes[name]={sourceLoopOrder,exportVertexOrder};if(sourceLoopOrder!==input.attributes[name].sha256)throw Error('Frame payload hash changed '+name)}
   const frame=geometryFrame({basis:'blender-z-up',position:triples(geometry.getAttribute('position')),normal:triples(geometry.getAttribute('_stw_frame_n')),index:Array.from(geometry.index.array),modelMatrix:input.frame.modelMatrix,camera:input.frame.camera});frames.push(frame)
   for(const name of ['_stw_frame_n','_stw_frame_t','_stw_frame_sign','_stw_corner'])frame.mesh.geometry.setAttribute(name,geometry.getAttribute(name).clone())
   const state=sourceFrameNodes(input.frame),rgb=uniform(new T.Vector3()),programs={mask:material(vec4(1,1,1,1)),'geometry-normal':material(vec4(state.normal.mul(.5).add(.5),1)),'window-xy':material(vec4(vec3(screenCoordinate.x.div(128),screenCoordinate.y.div(128).oneMinus(),0),1)),normalmap:material(vec4(state.resolve(rgb).mul(.5).add(.5),1))}
   const draw=async(kind)=>{frame.mesh.material=programs[kind]??programs.normalmap;await new Promise((resolve,reject)=>r.setAnimationLoop(()=>{try{r.render(frame.scene,frame.camera);r.setAnimationLoop(null);resolve()}catch(e){r.setAnimationLoop(null);reject(e)}}).catch(reject));await read(kind,{name:input.name,attributeHashes})}
   for(const kind of ['mask','geometry-normal','window-xy'])await draw(kind)
   for(const p of input.frame.probes){rgb.value.set(...p.rgb);await draw(p.id)}
   geometry.dispose();const original=Array.isArray(mesh.material)?mesh.material:[mesh.material];for(const m of original)m.dispose()
  }
  if(result.errors.length)throw Error(result.errors.join(';'));result.status='CAPTURED_FRAME_BROWSER_DIAGNOSTIC_NOT_QUALIFICATION';return result
 }finally{target.dispose();for(const frame of frames)frame.dispose();for(const m of materials)m.dispose();r.dispose()}
}
