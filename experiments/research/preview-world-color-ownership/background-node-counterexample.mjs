import assert from 'node:assert/strict'
import Background from 'three/src/renderers/common/Background.js'
import {Scene,CubeTexture,DataTexture,FloatType,RGBAFormat,LinearSRGBColorSpace,Color} from 'three'
import {cubeTexture} from 'three/tsl'
const renderer={_clearColor:{r:0,g:0,b:0,a:1},xr:{getEnvironmentBlendMode:()=>null},backend:{isWebGLBackend:false},autoClear:true,autoClearColor:true,autoClearDepth:true,autoClearStencil:true,getClearDepth:()=>1,getClearStencil:()=>0}
const scene=new Scene(),background=new Background(renderer,{getBackgroundNode:s=>s.backgroundNode}),seen=[]
const list={unshift:(mesh)=>seen.push(mesh)},context={clearColorValue:{}}
const source=()=>{const t=new CubeTexture(Array.from({length:6},()=>new DataTexture(new Float32Array([.125,.25,.5,1]),1,1,RGBAFormat,FloatType)));t.type=FloatType;t.colorSpace=LinearSRGBColorSpace;return t}
const first=source();scene.background=first;scene.backgroundNode=cubeTexture(first);background.update(scene,list,context)
const mesh=seen[0];let disposals=0;mesh.geometry.addEventListener('dispose',()=>disposals++);scene.backgroundNode.dispose();assert.equal(disposals,1)
const second=source();scene.background=second;scene.backgroundNode=cubeTexture(second);background.update(scene,list,context);assert.equal(seen[1],mesh);scene.backgroundNode.dispose();assert.equal(disposals,1)
scene.background=new Color(.75,.25,.125);seen.length=0;background.update(scene,list,context);assert.equal(seen[0],mesh)
console.log(JSON.stringify({status:'RETAINED_ZERO_CREDIT_BACKGROUND_NODE_COUNTEREXAMPLE',gpuCalls:0,firstNodeGeometryDispose:1,secondNodeGeometryAdditionalDispose:0,reusedBackgroundMesh:true,laterColorMaskedByNode:true}))
