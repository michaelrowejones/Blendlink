import * as THREE from 'three'
import {WebGPURenderer,NodeMaterial,QuadMesh} from 'three/webgpu'
import {uniform,float,vec4} from 'three/tsl'
import {buildSourceCameraDofLayerWeights} from '../../packages/blendlink/src/tslSourceCameraDofLayers.ts'
import {SOURCE_CAMERA_DOF_SAMPLING} from '../../packages/blendlink/src/sourceCameraDof.ts'
import {cameraDofLayerWeights} from '../../packages/blendlink/src/sourceCameraDofLayers.ts'
import {buildSourceCameraDof,buildSourceCameraCoC} from '../../packages/blendlink/src/tslSourceCameraDof.ts'
import {installThreeCompiledScene} from '../../packages/blendlink/src/threeRuntime.ts'
import {impactFracture as original} from '@impact-descriptor'
const source=(await(await fetch('/optics.json')).json()).cameraDepthOfField
window.runProof=async()=>{
 const query=new URLSearchParams(location.search),webgl=query.get('backend')==='webgl2',enabled=query.get('enabled')==='true'
 const adapter=webgl?null:await navigator.gpu?.requestAdapter()
 if(!webgl&&!adapter)throw Error('Actual WebGPU adapter required')
 const device=await adapter?.requestDevice({requiredFeatures:[...adapter.features]})
 const renderer=new WebGPURenderer({forceWebGL:webgl,antialias:true,...(device?{device}:{})})
 await renderer.init()
 if(!webgl&&!renderer.backend.isWebGPUBackend)throw Error('Unexpected WebGL fallback')
 renderer.setPixelRatio(1);renderer.setSize(1280,720);document.body.appendChild(renderer.domElement)
 const actualBackend=renderer.backend.isWebGPUBackend?'webgpu':'webgl2',warnings=[]
 const target=new THREE.RenderTarget(1,1,{type:THREE.FloatType,depthBuffer:false})
 const z=uniform(1),material=new NodeMaterial();material.fragmentNode=vec4(buildSourceCameraCoC(source,z,float(1280)),0,0,1)
 const quad=new QuadMesh(material),controls=[]
 for(const depth of [source.clipNear,1,2,4,source.focusDistanceBlenderUnits,10,100,1e10]){
  z.value=depth;renderer.setRenderTarget(target);quad.render(renderer)
  const pixel=await renderer.readRenderTargetPixelsAsync(target,0,0,1,1),p=source.projection,f=source.focusDistanceBlenderUnits
  const project=x=>(p[0]*x-p[2]*f+p[3])/(p[12]*x-p[14]*f+p[15])
  const bias=(project(source.lensMillimeters/2000/source.apertureFStop)-project(0))*640
  const expected=Math.max(-100,Math.min(100,f*bias*(-1/depth)+bias)),error=Math.abs(pixel[0]-expected)
  controls.push({depth,actual:pixel[0],expected,error})
  if(error>0.0001)throw Error('CoC numerical readback mismatch '+JSON.stringify(controls.at(-1)))
 }
 const layerRadius=uniform(0),layerNodes=buildSourceCameraDofLayerWeights(layerRadius),layerControls=[]
 material.fragmentNode=vec4(layerNodes.foreground,layerNodes.background,layerNodes.slightForeground,layerNodes.slightBackground);material.needsUpdate=true
 for(const radius of [-6,-5,-4.5,-4,-3.5,-3,-2.5,-.500001,-.5,0,.5,.500001,2.5,3,3.5,4,4.5,5,6]){
  layerRadius.value=radius;quad.render(renderer)
  const pixel=await renderer.readRenderTargetPixelsAsync(target,0,0,1,1),w=cameraDofLayerWeights(radius)
  const expected=[w.foreground,w.background,w.slightForeground,w.slightBackground]
  const error=Math.max(...expected.map((v,i)=>Math.abs(v-pixel[i])))
  layerControls.push({radius,actual:[...pixel],expected,error})
  if(error>1e-6)throw Error('Layer boundary readback mismatch '+JSON.stringify(layerControls.at(-1)))
 }
 const constantControls=[]
 // Explicit16x9 synthetic constant-field fixture only. The original scene
 // below remains1280x720; this fixture verifies energy/focus, not image fidelity.
 renderer.setRenderTarget(null);renderer.setSize(16,9)
 for(const distance of [2,source.focusDistanceBlenderUnits,10]){
  const candidate=buildSourceCameraDof(source,vec4(4,.5,.02,1),float(distance));candidate.setExtent(16,9)
  material.fragmentNode=candidate.node;material.needsUpdate=true
  renderer.setRenderTarget(target);quad.render(renderer)
  const pixel=await renderer.readRenderTargetPixelsAsync(target,0,0,1,1),expected=[4,.5,.02,1]
  const error=Math.max(...expected.map((v,i)=>Math.abs(v-pixel[i])))
  constantControls.push({distance,fixtureExtent:[16,9],actual:[...pixel],expected,error})
  if(error>1e-4)throw Error('Constant HDR field changed '+JSON.stringify(constantControls.at(-1)))
  renderer.setRenderTarget(null);candidate.dispose()
 }
 renderer.setSize(1280,720);renderer.setRenderTarget(null);target.dispose();material.dispose()
 const presentation=await(await fetch('/candidate-presentation.json')).arrayBuffer()
 const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',presentation))].map(v=>v.toString(16).padStart(2,'0')).join('')
 const descriptor=structuredClone(original);delete descriptor.assetGraph
 descriptor.sourcePresentation={url:'/candidate-presentation.json',bytes:presentation.byteLength,hash:hash.slice(0,16)}
 const start=performance.now()
 const installed=await installThreeCompiledScene({renderer,scene:new THREE.Scene(),descriptor,assetBaseUrl:new URL('./',location.href),useAuthoringPreview:true,nodeRectAreaLights:'renderer-local',viewport:{width:1280,height:720},...(enabled?{sourceCameraDepthOfField:'experimental-physical-coc-v1'}:{}),onWarning:m=>warnings.push(m)})
 installed.update(0);installed.render(0)
 await renderer.backend.device?.queue.onSubmittedWorkDone()
 window.installed=installed;window.renderer=renderer
 return{actualBackend,enabled,sampling:SOURCE_CAMERA_DOF_SAMPLING,controls,layerControls,constantControls,warnings,readyMilliseconds:performance.now()-start,applied:installed.tslMaterials?.applied,skipped:installed.tslMaterials?.skipped,postOrder:installed.components.postprocessingOrder,camera:{name:installed.camera.name,near:installed.camera.near,far:installed.camera.far,projection:installed.camera.projectionMatrix.elements,world:installed.camera.matrixWorld.elements},physicalExtent:[renderer.domElement.width,renderer.domElement.height],originalSourceEdited:false,sceneAcceptance:false,supportCredit:0,scope:'Research derivative descriptor: original099 geometry/material assets + local evaluated optical metadata; not a fresh Final package qualification'}
}
