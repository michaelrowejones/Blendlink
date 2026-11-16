import * as THREE from 'three'
import {WebGPURenderer,NodeMaterial,QuadMesh} from 'three/webgpu'
import {vec3,vec4,attribute,positionWorld,positionGeometry} from 'three/tsl'
import {buildGeometryContext} from '../../packages/blendlink/src/tslGeometryContext.ts'
import {createExperimentalSourceCameraProjection} from '../../packages/blendlink/src/sourceCameraProjection.ts'
import {geometryFrame} from '../box-image-storage-stage/geometry-inputs.mjs'
window.runProjectionProof=async({backend,inputs,cameras})=>{
 const adapter=backend==='webgpu'?await navigator.gpu?.requestAdapter():null
 if(backend==='webgpu'&&!adapter)throw Error('Actual WebGPU adapter required')
 const device=await adapter?.requestDevice({requiredFeatures:[...adapter.features]})
 const renderer=new WebGPURenderer({forceWebGL:backend==='webgl2',antialias:false,...(device?{device}:{})})
 const target=new THREE.RenderTarget(64,4,{type:THREE.FloatType,depthBuffer:true}),materials=[],frames=[]
 target.texture.colorSpace=THREE.NoColorSpace
 const result={backend,rows:[],errors:[],supportCredit:0,automaticEnablement:false};window.failedProjectionProof=result
 try{
  await renderer.init();result.actualBackend=renderer.backend.isWebGPUBackend?'webgpu':'webgl2'
  if(result.actualBackend!==backend)throw Error('Actual backend fallback refused')
  const gl=renderer.backend.gl,debug=gl?.getExtension('WEBGL_debug_renderer_info'),info=renderer.backend.device?.adapterInfo
  result.gpu=backend==='webgpu'?{vendor:info?.vendor,description:info?.description,architecture:info?.architecture}:{vendor:gl.getParameter(debug?.UNMASKED_VENDOR_WEBGL??gl.VENDOR),renderer:gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL??gl.RENDERER)}
  renderer.debug.onShaderError=(g,p,v,f)=>result.errors.push([g.getProgramInfoLog(p),g.getShaderInfoLog(v),g.getShaderInfoLog(f)].filter(Boolean).join('\n'))
  renderer.backend.device?.addEventListener('uncapturederror',e=>result.errors.push(String(e.error)))
  renderer.setPixelRatio(1);renderer.setSize(64,4);renderer.setClearColor(0,1)
  renderer.toneMapping=THREE.NoToneMapping;renderer.outputColorSpace=THREE.LinearSRGBColorSpace
  function material(node){const m=new NodeMaterial();m.fragmentNode=node;m.side=THREE.DoubleSide;m.blending=THREE.NoBlending;materials.push(m);return m}
  // Independent signed XY interpolation, no native geometry/pixel answers.
  // Its raw row order must match the predeclared backend layout on the host.
  const calibrationMaterial=material(vec4(positionGeometry.x,positionGeometry.y,.25,1))
  const quad=new QuadMesh(calibrationMaterial)
  renderer.setRenderTarget(target);quad.render(renderer)
  const calibration=await renderer.readRenderTargetPixelsAsync(target,0,0,64,4)
  result.calibration={words:Array.from(new Uint32Array(calibration.buffer,calibration.byteOffset,calibration.length))}
  async function draw(frame,camera,m,kind,negative=false){
   frame.mesh.material=m;renderer.setRenderTarget(target);renderer.render(frame.scene,camera)
   const pixels=await renderer.readRenderTargetPixelsAsync(target,0,0,64,4)
   result.rows.push({case:frame.input.id,kind,negative,projection:camera.projectionMatrix.elements,words:Array.from(new Uint32Array(pixels.buffer,pixels.byteOffset,pixels.length))})
  }
  for(const input of inputs){
   const frame={input,...geometryFrame(input)};frames.push(frame)
   const metadata=cameras[input.id],factory=createExperimentalSourceCameraProjection(metadata)
   const camera=factory.camera;camera.updateMatrixWorld(true)
   const n=buildGeometryContext({op:'geometry_context',model:'primary-triangles-v1',output:'object-normal',sourceEngine:'EEVEE',normalStorage:'SNORM10'},input.basis)
   const world=input.basis==='gltf-y-up'?vec3(positionWorld.x,positionWorld.z.negate(),positionWorld.y):positionWorld
   const choices={mask:material(vec4(1,1,1,1)),normal:material(vec4(n.mul(.5).add(.5),1)),face:material(vec4(vec3(attribute('boxFaceId','float')),1)),position:material(vec4(world.mul(.03125).add(.5),1))}
   for(const[kind,m]of Object.entries(choices))await draw(frame,camera,m,kind)
   // Fresh owned camera, centered before its first draw: simulate ignored
   // native lens shift without altering the positive camera or source mesh.
   const ignored=createExperimentalSourceCameraProjection(metadata).camera
   ignored.clearViewOffset();ignored.updateMatrixWorld(true)
   await draw(frame,ignored,choices.position,'position',true)
  }
  if(result.errors.length)throw Error('GPU shader errors')
  return result
 }finally{renderer.setRenderTarget(null);for(const material of materials)material.dispose();for(const frame of frames)frame.dispose();target.dispose();renderer.dispose()}
}
