import { BufferAttribute, BufferGeometry, Camera, Group, Mesh, MeshStandardMaterial, Scene } from 'three'
import { expect, it, vi } from 'vitest'
import { buildTslColorNode, type TslIrExpression } from './tslNodeRecipe.js'
import { createMagicCoordinateProof, validateMagicCoordinates } from './tslMagicBounds.js'
import { installTslMaterials } from './tslMaterialRuntime.js'
import { isUnitBoundedExpression } from './tslColorConversion.js'
import * as TSL from 'three/tsl'
import { buildTslMagicNode } from './tslMagicNodes.js'

const scalar=(value:number):TslIrExpression=>({op:'const_float',value})
const magic=(vector:TslIrExpression={op:'const_vec3',value:[.25,.5,.75]}):TslIrExpression=>({
  op:'tex_magic_native',model:'eevee-magic-f32-v1',sourceEngine:'EEVEE',nativeGpuBackend:'METAL',
  evaluationModel:'shader',depth:2,output:'color',vector,scale:scalar(5),distortion:scalar(1),
})
const document=(output:TslIrExpression)=>({schemaVersion:1 as const,model:'blendlink-tsl-ir-v1' as const,output})
const geometry=()=>new BufferGeometry().setAttribute('position',new BufferAttribute(new Float32Array([-1,-1,0,1,-1,0,0,1,0]),3))
  .setAttribute('uv',new BufferAttribute(new Float32Array([0,0,1,0,0,1]),2))
const options={objectSpace:{basis:'blender-z-up' as const},generatedTexspace:{location:[0,0,0] as [number,number,number],size:[1,1,1] as [number,number,number]}}

it('owns the validated primitive tags before deferred shader construction',()=>{
  const tsl=TSL as any
  for(const key of ['evaluationModel','nativeGpuBackend','output']){
    const expression=magic()
    const node=buildTslMagicNode(expression,child=>(child.op==='const_float'?tsl.float(child.value):tsl.vec3(...child.value as number[])),message=>{throw new Error(message)}) as any
    Object.defineProperty(expression,key,{get(){throw new Error('Late caller-owned '+key)}})
    const previous=tsl.getCurrentStack();tsl.setCurrentStack(tsl.stack())
    try{expect(()=>node.node.shaderNode.jsFunc()).not.toThrow()}finally{tsl.setCurrentStack(previous)}
  }
})

it('validates explicit native source versions without breaking versionless v1 documents',()=>{
  expect(()=>buildTslColorNode(document(magic()))).not.toThrow()
  for(const nativeVersion of [[4,2,0],[5,2,0],[5,3,0]])expect(()=>buildTslColorNode(document({...magic(),nativeVersion}))).not.toThrow()
  for(const nativeVersion of [[4,2,1],[5,0,0],[5,1,0],[5,2,1],[5,3,1],[6,0,0],[5,2,'0'],'5.2.0',null])
    expect(()=>buildTslColorNode(document({...magic(),nativeVersion}))).toThrow(/explicit native source version/)
  expect(()=>buildTslColorNode(document({...magic(),evaluationModel:'mf',nativeVersion:[4,2,0]}))).toThrow(/requires shader evaluation/)
  expect(()=>buildTslColorNode(document({...magic(),evaluationModel:'mf',nativeVersion:[5,2,0]}))).not.toThrow()
})

it('requires actual owner bounds for Generated/UV instead of trusting a unit-range annotation',()=>{
  const mesh=new Mesh(geometry()),expression=magic({op:'generated',range:[0,1]})
  expect(()=>buildTslColorNode(document(expression),options)).toThrow(/actual mesh-bound/)
  expect(()=>buildTslColorNode(document(expression),{...options,validateMagicCoordinates:entry=>validateMagicCoordinates(entry,mesh,options)})).not.toThrow()
  expect(()=>validateMagicCoordinates(expression,mesh,{...options,generatedTexspace:{location:[100,0,0],size:[1,1,1]}})).toThrow(/magnitude32/)
  const uv=mesh.geometry.getAttribute('uv')
  uv.setX(0,100);uv.needsUpdate=true
  expect(()=>validateMagicCoordinates(magic({op:'uv',range:[0,1]}),mesh,options)).toThrow(/magnitude32/)
})

it('independently rejects unsafe controls, stages and constant arithmetic islands',()=>{
  const cancelled:TslIrExpression={op:'math',operation:'SUBTRACT',a:{op:'math',operation:'ADD',a:scalar(1e8),b:scalar(1)},b:scalar(1e8)}
  for(const key of ['scale','distortion','vector']){
    const expression=magic()
    expression[key]=key==='vector'?{op:'combine',x:cancelled,y:scalar(0),z:scalar(0)}:{op:'clamp_minmax',value:cancelled,min:scalar(.25),max:scalar(1)}
    expect(()=>buildTslColorNode(document(expression))).toThrow(/exact constant arithmetic/)
  }
  for(const distortion of [.125,-1,2,-2])expect(()=>buildTslColorNode(document({...magic(),distortion:scalar(distortion)}))).toThrow(/distortion/i)
  expect(()=>buildTslColorNode(document({...magic(),sourceEngine:'CYCLES'}))).toThrow(/native EEVEE/)
  expect(()=>buildTslColorNode(document({...magic(),evaluationModel:'mf',vector:{op:'uv'}}))).toThrow(/MF coordinates/)
  expect(()=>buildTslColorNode(document({...magic(),evaluationModel:'mf',vector:{op:'const_vec3',value:Array(3)}}))).toThrow()
  const raw=magic({op:'const_vec3',value:[32,0,0]});raw.scale=scalar(1)
  expect(()=>buildTslColorNode(document(raw))).not.toThrow()
  expect(()=>buildTslColorNode(document({op:'mix_color',blendType:'MIX',factor:magic(),a:{op:'const_vec3',value:[0,0,0]},b:{op:'const_vec3',value:[1,1,1]}}))).toThrow(/vector-typed/)
  expect(isUnitBoundedExpression({...magic(),output:'fac',range:[0,1],normalize:true})).toBe(false)
  expect(isUnitBoundedExpression({op:'clamp01',input:{...magic(),output:'fac'}})).toBe(true)
})

it('requires actual finite opaque data-image transport as well as its source certificate',()=>{
  const image:TslIrExpression={op:'tex_image',sourceEngine:'EEVEE',nativeGpuBackend:'METAL',sourceImageStorage:'rgba32f',sourceImageUploadRounding:'none',
    interpolation:'Closest',extension:'REPEAT',width:1,height:1,pixels:[.25,.5,.75,1],vector:{op:'uv'},output:'color'}
  const expression={...magic(image),sourceSamples:'native-float-data-v1',sourceColorSpaces:['Non-Color']}
  expect(()=>buildTslColorNode(document(expression))).not.toThrow()
  expect(()=>buildTslColorNode(document({...expression,sourceColorSpaces:['sRGB']}))).toThrow(/source certificate/)
  image.pixels=[.25,.5,.75,.5]
  expect(()=>buildTslColorNode(document(expression))).toThrow(/opaque/)
  image.pixels=[.25,.5,.75,1];image.sourceImageUploadRounding='nearest-even'
  expect(()=>buildTslColorNode(document(expression))).toThrow(/nearest pixels/)
})

it('owns derived image bounds without retaining or rewalking caller pixel arrays on draws',()=>{
  const image:TslIrExpression={op:'tex_image',output:'color',interpolation:'Closest',sourceImageStorage:'rgba32f',sourceImageUploadRounding:'none',pixels:[.25,.5,.75,1]}
  const expression=magic(image),proof=createMagicCoordinateProof(expression)
  expression.scale=scalar(100);image.interpolation='Linear'
  Object.defineProperty(image,'pixels',{get(){throw new Error('Caller pixel array was revisited')}})
  expect(()=>proof.validate(new Mesh(geometry()),{})).not.toThrow()
})

it('rechecks actual installed geometry mutations while unchanged frames reuse cached bounds',async()=>{
  const material=new MeshStandardMaterial();material.userData.blendlink_source_material='Magic'
  const mesh=new Mesh(geometry(),material),root=new Group();root.add(mesh)
  mesh.userData.blendlink_tsl_runtime={objectSpace:'blender-z-up',texspace:{location:[0,0,0],size:[1,1,1]}}
  const installed=await installTslMaterials({root,descriptor:{materialPrograms:{url:'/magic.json',bytes:1,hash:'x',materials:1}},loadPrograms:async()=>({
    schemaVersion:1,model:'blendlink-material-programs-v1',materials:{Magic:{channels:{'Base Color':{tslIr:document(magic({op:'generated'}))}}}},
  })})
  expect(installed.applied).toBe(1);expect(installed.skipped).toEqual([])
  const position=mesh.geometry.getAttribute('position'),read=vi.spyOn(position,'getX')
  const draw=()=>mesh.onBeforeRender({backend:{isWebGPUBackend:false}} as any,new Scene(),new Camera(),mesh.geometry,mesh.material as MeshStandardMaterial,null as any)
  // The first GPU upload can observe CPU edits made before needsUpdate.
  position.setX(0,100);expect(draw).toThrow(/magnitude32/)
  position.setX(0,-1);draw();const initial=read.mock.calls.length;expect(initial).toBe(position.count*2)
  draw();expect(read.mock.calls.length).toBe(initial)
  position.setX(0,100);position.needsUpdate=true
  expect(draw).toThrow(/magnitude32/)
  expect(read).toHaveBeenCalled()
  // Three already captured the geometry argument before a user's callback
  // can replace mesh.geometry. Validate the attributes that will be drawn.
  const captured=mesh.geometry;mesh.geometry=geometry()
  expect(()=>mesh.onBeforeRender({backend:{isWebGPUBackend:false}} as any,new Scene(),new Camera(),captured,mesh.material as MeshStandardMaterial,null as any)).toThrow(/magnitude32/)
  installed.dispose();expect(mesh.material).toBe(material)
  expect(draw).not.toThrow()
})

it('keeps named-UV validation bound to the installed channel when metadata later changes',async()=>{
  const material=new MeshStandardMaterial();material.userData.blendlink_source_material='Magic'
  const mesh=new Mesh(geometry(),material),root=new Group();root.add(mesh)
  mesh.geometry.setAttribute('uv1',new BufferAttribute(new Float32Array([0,0,1,0,0,1]),2))
  mesh.userData.blendlink_tsl_runtime={uvChannels:{Authored:0}}
  const installed=await installTslMaterials({root,descriptor:{materialPrograms:{url:'/magic.json',bytes:1,hash:'x',materials:1}},loadPrograms:async()=>({
    schemaVersion:1,model:'blendlink-material-programs-v1',materials:{Magic:{channels:{'Base Color':{tslIr:document(magic({op:'uv',uvMap:'Authored'}))}}}},
  })})
  expect(installed.applied).toBe(1)
  mesh.userData.blendlink_tsl_runtime.uvChannels.Authored=1
  mesh.geometry.getAttribute('uv').setX(0,100)
  expect(()=>mesh.onBeforeRender({backend:{isWebGPUBackend:false}} as any,new Scene(),new Camera(),mesh.geometry,mesh.material as MeshStandardMaterial,null as any)).toThrow(/magnitude32/)
  installed.dispose()
})

it('keeps draw bounds attached to the built source after a custom transport reuses its IR',async()=>{
  const material=new MeshStandardMaterial();material.userData.blendlink_source_material='Magic'
  const mesh=new Mesh(geometry(),material),root=new Group();root.add(mesh)
  const expression=magic({op:'uv'})
  const installed=await installTslMaterials({root,descriptor:{materialPrograms:{url:'/magic.json',bytes:1,hash:'x',materials:1}},loadPrograms:async()=>({
    schemaVersion:1,model:'blendlink-material-programs-v1',materials:{Magic:{channels:{'Base Color':{tslIr:document(expression)}}}},
  })})
  expect(installed.applied).toBe(1)
  expression.evaluationModel='mf';expression.vector={op:'const_vec3',value:[0,0,0]};expression.scale=scalar(0)
  mesh.geometry.getAttribute('uv').setX(0,100)
  expect(()=>mesh.onBeforeRender({backend:{isWebGPUBackend:false}} as any,new Scene(),new Camera(),mesh.geometry,mesh.material as MeshStandardMaterial,null as any)).toThrow(/magnitude32/)
  installed.dispose()
})

it('validates edited source pixels again when the same custom document is reinstalled',async()=>{
  const material=new MeshStandardMaterial();material.userData.blendlink_source_material='Magic'
  const mesh=new Mesh(geometry(),material),root=new Group();root.add(mesh)
  const pixels=[.25,.5,.75,1],image:TslIrExpression={op:'tex_image',sourceEngine:'EEVEE',nativeGpuBackend:'METAL',sourceImageStorage:'rgba32f',sourceImageUploadRounding:'none',
    output:'color',interpolation:'Closest',extension:'REPEAT',width:1,height:1,pixels,vector:{op:'uv'}}
  const expression={...magic(image),sourceSamples:'native-float-data-v1',sourceColorSpaces:['Non-Color']}
  const options={root,descriptor:{materialPrograms:{url:'/magic.json',bytes:1,hash:'x',materials:1}},loadPrograms:async()=>({
    schemaVersion:1 as const,model:'blendlink-material-programs-v1' as const,materials:{Magic:{channels:{'Base Color':{tslIr:document(expression)}}}},
  })}
  const first=await installTslMaterials(options);expect(first.applied).toBe(1);first.dispose()
  pixels[0]=100
  const reapplied=await installTslMaterials(options)
  expect(reapplied.applied).toBe(0);expect(reapplied.skipped.some(item=>item.reason.includes('magnitude32'))).toBe(true)
  expect(mesh.material).toBe(material);reapplied.dispose()
})
