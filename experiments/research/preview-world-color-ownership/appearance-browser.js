import * as T from 'three'
import {WebGPURenderer} from 'three/webgpu'
window.comparePreviewBackgrounds=async()=>{
 const api=new URLSearchParams(location.search).get('api'),renderer=new WebGPURenderer({forceWebGL:api==='webgl2',antialias:false});await renderer.init();renderer.setSize(32,24);renderer.setPixelRatio(1)
 const gl=renderer.backend.gl,adapter=renderer.backend.device?.adapterInfo,ext=gl?.getExtension('WEBGL_debug_renderer_info'),gpu=adapter?{api:'WebGPU',vendor:adapter.vendor,architecture:adapter.architecture,description:adapter.description}:{api:'WebGL2',renderer:gl.getParameter(ext?.UNMASKED_RENDERER_WEBGL??gl.RENDERER)}
 const camera=new T.PerspectiveCamera(50,32/24,.1,20);camera.position.z=2
 const scene=new T.Scene(),rows=[],errors=[];renderer.debug.onShaderError=(g,p)=>errors.push(g.getProgramInfoLog(p));renderer.backend.device?.addEventListener('uncapturederror',e=>errors.push(String(e.error)))
 const target=new T.RenderTarget(32,24,{type:T.FloatType,depthBuffer:false});target.texture.colorSpace=T.NoColorSpace
 const geometryBaseline=renderer.info.memory.geometries
 const colors=[[.125,.25,.5],[.1,.8,1/3],[4,1,.1],[0,0,0],[1,1,1]],modes=[['Raw',T.NoToneMapping],['Standard-linear',T.LinearToneMapping],['ACES',T.ACESFilmicToneMapping],['AgX',T.AgXToneMapping],['Neutral',T.NeutralToneMapping],['Reinhard',T.ReinhardToneMapping]]
 const draw=(action,screenshot=false)=>new Promise((resolve,reject)=>renderer.setAnimationLoop(()=>{renderer.setAnimationLoop(null);try{action();resolve(screenshot?new Promise(r=>renderer.domElement.toBlob(r)):undefined)}catch(e){reject(e)}}).catch(reject))
 const screenshot=async blob=>{if(!blob)throw Error('Missing canvas snapshot');const image=await createImageBitmap(blob),canvas=document.createElement('canvas');canvas.width=32;canvas.height=24;const c=canvas.getContext('2d',{willReadFrequently:true});c.drawImage(image,0,0);image.close();return c.getImageData(0,0,32,24).data}
 const differences=(a,b)=>{if(a.length!==b.length)throw Error('Shape drift');let count=0,max=0;for(let i=0;i<a.length;i++)if(a[i]!==b[i]){count++;max=Math.max(max,Math.abs(a[i]-b[i]))}return{compared:a.length,differences:count,max}}
 const cube=color=>{const pixel=new Float32Array([...color,1]),faces=Array.from({length:6},()=>new T.DataTexture(pixel,1,1,T.RGBAFormat,T.FloatType)),t=new T.CubeTexture(faces);Object.assign(t,{type:T.FloatType,format:T.RGBAFormat,colorSpace:T.LinearSRGBColorSpace,minFilter:T.LinearFilter,magFilter:T.LinearFilter,generateMipmaps:false});t.needsUpdate=true;t.addEventListener('dispose',()=>faces.forEach(f=>f.dispose()));return t}
 try{
  for(const color of colors){const source=new Float32Array([...color,1]),old=cube(color),next=new T.Color().fromArray(source);scene.backgroundIntensity=1;scene.backgroundBlurriness=0
   renderer.outputColorSpace=T.LinearSRGBColorSpace;renderer.toneMapping=T.NoToneMapping;renderer.setRenderTarget(target);scene.background=old;await draw(()=>renderer.render(scene,camera));const a=await renderer.readRenderTargetPixelsAsync(target,0,0,32,24);scene.background=next;await draw(()=>renderer.render(scene,camera));const b=await renderer.readRenderTargetPixelsAsync(target,0,0,32,24)
   const linear=differences(new Uint32Array(a.buffer,a.byteOffset,a.length),new Uint32Array(b.buffer,b.byteOffset,b.length));if(linear.differences)throw Error('Linear appearance changed '+JSON.stringify({color,linear}))
   renderer.setRenderTarget(null);renderer.outputColorSpace=T.SRGBColorSpace
   for(const[mode,tone]of modes)for(const exposure of[.5,2]){renderer.toneMapping=tone;renderer.toneMappingExposure=exposure;scene.background=old;const aa=await screenshot(await draw(()=>renderer.render(scene,camera),true));scene.background=next;const bb=await screenshot(await draw(()=>renderer.render(scene,camera),true));const display=differences(aa,bb);rows.push({color:Array.from(source).slice(0,3),mode,exposure,linear,display});if(display.differences)throw Error('Displayed appearance changed '+JSON.stringify(rows.at(-1)))}
   old.dispose()
  }
  // Explicitly retain the public-type behavior difference: Three applies this
  // texture-only property to Cube, while a Color uses its own RGB directly.
  renderer.outputColorSpace=T.LinearSRGBColorSpace;renderer.toneMapping=T.NoToneMapping;renderer.setRenderTarget(target);scene.backgroundIntensity=.5;const old=cube([.125,.25,.5]);scene.background=old;await draw(()=>renderer.render(scene,camera));const a=await renderer.readRenderTargetPixelsAsync(target,0,0,32,24);scene.background=new T.Color(.125,.25,.5);await draw(()=>renderer.render(scene,camera));const b=await renderer.readRenderTargetPixelsAsync(target,0,0,32,24);const laterIntensity=differences(a,b);old.dispose()
  if(!laterIntensity.differences)throw Error('Intensity compatibility witness missing')
  if(errors.length)throw Error(JSON.stringify(errors))
  return{status:'NONQUALIFYING_CUBE_COLOR_APPEARANCE_COMPARISON',portCredit:0,api,gpu,rows,laterIntensityCompatibility:{equivalent:false,...laterIntensity},geometryBaseline,geometryAfterOldCubeControls:renderer.info.memory.geometries,errors}
 }finally{renderer.setRenderTarget(null);target.dispose();renderer.dispose()}
}
