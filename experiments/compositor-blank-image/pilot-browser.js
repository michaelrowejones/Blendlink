import * as THREE from 'three'
import {WebGPURenderer,NodeMaterial,QuadMesh} from 'three/webgpu'
import {textureLoad,ivec2,uv,vec2} from 'three/tsl'
import {buildSourceCompositor} from '@blank-compositor'
const sha=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('')
const pinned=async(url,pin)=>{const response=await fetch(url);if(!response.ok)throw Error('Missing pinned input');const bytes=await response.arrayBuffer();if(await sha(bytes)!==pin)throw Error('Input pin changed');return bytes}
window.runBlankPilot=async cases=>{
 const wanted=new URLSearchParams(location.search).get('backend'),adapter=wanted==='webgpu'?await navigator.gpu?.requestAdapter({powerPreference:'high-performance'}):undefined
 if(wanted==='webgpu'&&!adapter)throw Error('Actual WebGPU adapter required')
 const device=await adapter?.requestDevice({requiredFeatures:[...adapter.features]}),renderer=new WebGPURenderer({forceWebGL:wanted==='webgl2',antialias:false,...(device?{device}:{})});await renderer.init();renderer.info.autoReset=false
 const backend=renderer.backend.isWebGPUBackend?'webgpu':'webgl2';if(backend!==wanted)throw Error('API fallback')
 const gl=renderer.backend.gl,debug=gl?.getExtension('WEBGL_debug_renderer_info'),gpu=adapter?{api:'WebGPU',...Object.fromEntries(['vendor','architecture','device','description'].map(k=>[k,adapter.info[k]]))}:{api:'WebGL2',renderer:gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL??gl.RENDERER)}
 renderer.outputColorSpace=THREE.LinearSRGBColorSpace;renderer.toneMapping=THREE.NoToneMapping
 const errors=[],live=new Set(),uploads=[];let ending=false
 renderer.debug.onShaderError=(g,p)=>errors.push(g.getProgramInfoLog(p));device?.addEventListener('uncapturederror',e=>errors.push(String(e.error)));device?.lost.then(e=>{if(!ending)errors.push('Device lost '+e.message)})
 const create=renderer.backend.createTexture.bind(renderer.backend),destroy=renderer.backend.destroyTexture.bind(renderer.backend),upload=renderer.backend.updateTexture.bind(renderer.backend)
 renderer.backend.createTexture=(texture,...args)=>{const result=create(texture,...args);live.add(texture);return result}
 renderer.backend.destroyTexture=(texture,...args)=>{const result=destroy(texture,...args);live.delete(texture);return result}
 renderer.backend.updateTexture=(texture,...args)=>{const result=upload(texture,...args);uploads.push(texture);return result}
 let target=new THREE.RenderTarget(13,9,{type:THREE.FloatType,depthBuffer:false});target.texture.colorSpace=THREE.NoColorSpace
 const outside=()=>[...live].filter(t=>!target.textures.includes(t)),draw=quad=>new Promise((resolve,reject)=>renderer.setAnimationLoop(()=>{renderer.setAnimationLoop(null);try{renderer.setRenderTarget(target);const before=renderer.info.render.drawCalls;quad.render(renderer);resolve(renderer.info.render.drawCalls-before)}catch(e){reject(e)}}).catch(reject))
 const extent=(width,height,ratio=1)=>{renderer.setPixelRatio(ratio);renderer.setSize(width/ratio,height/ratio);target.setSize(width,height);renderer.setRenderTarget(target)}
 const read=async(w,h)=>{const values=await renderer.readRenderTargetPixelsAsync(target,0,0,w,h),pad=Math.ceil(w*16/256)*256/16,stride=values.length===w*h*4?w:backend==='webgpu'&&[4*(pad*(h-1)+w),4*pad*h].includes(values.length)?pad:0;if(!(values instanceof Float32Array)||!stride)throw Error('F32 readback required');const result=new Uint32Array(w*h*4),source=new Uint32Array(values.buffer,values.byteOffset,values.length);for(let y=0;y<h;y++)result.set(source.subarray(y*stride*4,(y*stride+w)*4),y*w*4);return result}
 let flip=false;const rows=[]
 try{
  device?.pushErrorScope('validation')
  // Independent asymmetric raw texture fixes actual backend readback orientation.
  extent(13,9);const data=new Float32Array(13*9*4);for(let y=0;y<9;y++)for(let x=0;x<13;x++)data.set([x/16,y/16,(x+3*y)/64,1],(y*13+x)*4)
  const control=new THREE.DataTexture(data,13,9,THREE.RGBAFormat,THREE.FloatType);control.needsUpdate=true;const cm=new NodeMaterial();cm.fragmentNode=textureLoad(control,ivec2(uv().mul(vec2(13,9))));cm.blending=THREE.NoBlending;await draw(new QuadMesh(cm));const observed=await read(13,9),expected=new Uint32Array(data.buffer),matches=f=>{for(let y=0;y<9;y++)for(let x=0;x<13;x++)for(let c=0;c<4;c++)if(observed[(y*13+x)*4+c]!==expected[((f?8-y:y)*13+x)*4+c])return false;return true};if(matches(false)===matches(true))throw Error('Orientation calibration failed');flip=matches(true);control.dispose();cm.dispose();if(outside().length)throw Error('Calibration leak')
  for(const entry of cases){
   extent(entry.width,entry.height);const program=JSON.parse(new TextDecoder().decode(await pinned(entry.programUrl,entry.programSha256))),native=new Uint32Array(await pinned(entry.pixelUrl,entry.pixelSha256)),owner=buildSourceCompositor(program,()=>{throw Error('Blank resolved borrowed source')});const material=new NodeMaterial();material.fragmentNode=owner.node;material.blending=THREE.NoBlending;const quad=new QuadMesh(material),before=uploads.length
   const compare=async()=>{const actual=await read(entry.width,entry.height);let differences=0,first;for(let y=0;y<entry.height;y++)for(let x=0;x<entry.width;x++)for(let c=0;c<4;c++){const i=(y*entry.width+x)*4+c,j=((flip?entry.height-1-y:y)*entry.width+x)*4+c;if(actual[i]!==native[j]){differences++;first??={x,y,c,actualWord:actual[i],expectedWord:native[j]}}}if(differences)throw Error('Blank exact gate '+entry.case+' '+differences+' '+JSON.stringify(first));return actual.length}
   try{
    const calls=await draw(quad),wordCount=await compare(),firstUploads=uploads.length-before,bindings=outside();if(calls!==1||bindings.length!==2||bindings.some(t=>t.isRenderTargetTexture||t.image.width!==256||t.image.height!==32))throw Error('Blank mapping/pass census failed')
    const warm=uploads.length;await draw(quad);await compare();if(uploads.length!==warm)throw Error('Warm frame uploaded mapping')
    // A physical frame is retained through DPR changes without rebuilding maps.
    extent(entry.width,entry.height,2);await draw(quad);await compare();if(uploads.length!==warm)throw Error('Same physical frame DPR change uploaded')
    const oldX=target.viewport.x;target.viewport.x=1;let refusal;try{await draw(quad)}catch(e){refusal=String(e)}finally{target.viewport.x=oldX}if(!/Blank Image.*full-frame/.test(refusal))throw Error('Missing physical viewport refusal '+refusal);await draw(quad);await compare();if(uploads.length!==warm)throw Error('Refused viewport mutated mapping')
    rows.push({case:entry.case,wordCount,exactWordDifferences:0,firstUploads,warmUploads:0,drawCalls:calls,mappingTextures:2,mappingBytes:bindings.reduce((n,t)=>n+t.image.data.byteLength,0),sourceRenderTargets:0,dprRecovery:true,invalidViewportRefusal:refusal})
   }finally{owner.dispose();owner.dispose();material.dispose()}
   if(outside().length)throw Error('Blank owner leaked textures')
  }
  const validation=device?await device.popErrorScope():null;if(validation)errors.push(String(validation));if(gl&&gl.getError()!==gl.NO_ERROR)throw Error('GL error');if(errors.length)throw Error(JSON.stringify(errors))
  renderer.setRenderTarget(null);target.dispose();if(renderer.info.memory.textures!==0||renderer.info.memory.renderTargets!==0||live.size)throw Error('Physical cleanup failed')
  return{backend,gpu,rows,errors,orientationFlipped:flip,remainingTextures:0,remainingRenderTargets:0}
 }finally{ending=true;renderer.setRenderTarget(null);target.dispose();renderer.dispose();device?.destroy()}
}
