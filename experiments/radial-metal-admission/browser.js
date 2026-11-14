import*as THREE from'three'
import{WebGPURenderer,NodeMaterial,QuadMesh}from'three/webgpu'
import{vec3,vec4}from'three/tsl'
import{assertRadialMetalRenderer,guardRadialMetalNode}from'@radial-metal-guard'
window.testRadialMetalGuard=async backend=>{
const renderer=new WebGPURenderer({forceWebGL:backend==='webgl2'});await renderer.init();renderer.setSize(2,1);renderer.toneMapping=THREE.NoToneMapping;renderer.outputColorSpace=THREE.LinearSRGBColorSpace
const actual=renderer.backend.isWebGPUBackend?'webgpu':'webgl2';if(actual!==backend)throw Error('Fallback');const gl=renderer.backend.gl,debug=gl?.getExtension('WEBGL_debug_renderer_info'),device=renderer.backend.device,info=device?.adapterInfo,gpu=info?{vendor:info.vendor,architecture:info.architecture,description:info.description}:{vendor:gl.getParameter(debug?.UNMASKED_VENDOR_WEBGL??gl.VENDOR),renderer:gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL??gl.RENDERER)}
const negativePayloads=[{}, {isRenderer:true,backend:{isWebGPUBackend:true,device:{adapterInfo:{vendor:'apple',architecture:'metal-3'}}}}, {isRenderer:true,backend:{isWebGLBackend:true,gl:{getExtension:()=>({}),getParameter:()=> 'Apple Metal'}}}];const payloadRefusals=negativePayloads.map(value=>{try{assertRadialMetalRenderer(value);return false}catch(e){return /actual WebGL2 ANGLE Apple M5 Pro Metal/.test(String(e))}})
let calls=0,drawReached=false,error,pixels;const node=guardRadialMetalNode(vec3(.125,.25,.5)),update=node.update;node.update=function(frame){calls++;return update.call(this,frame)};const material=new NodeMaterial();material.fragmentNode=vec4(node,1);const quad=new QuadMesh(material),target=new THREE.RenderTarget(2,1,{type:THREE.FloatType,depthBuffer:false});target.texture.colorSpace=THREE.NoColorSpace
const shaders=await renderer.debug.getShaderAsync(quad,quad.camera,quad);try{renderer.setRenderTarget(target);quad.render(renderer);pixels=Array.from(await renderer.readRenderTargetPixelsAsync(target,0,0,2,1));drawReached=true}catch(e){error=String(e)}
renderer.setRenderTarget(null);target.dispose();material.dispose();const remainingTextures=renderer.info.memory.textures;renderer.dispose()
return{backend:actual,gpu,calls,drawReached,error,pixels,payloadRefusals,remainingTextures,fragmentShader:shaders.fragmentShader,source:'actualrenderer.backend only; payloadmarkers do not grant admission'}
}
