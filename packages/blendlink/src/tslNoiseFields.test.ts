import { describe, expect, it, vi } from 'vitest'
import { buildTslColorNode, createTslBuildResources, type TslIrExpression } from './tslNodeRecipe.js'
import { prepareTslNoiseFields, preparedNoiseField } from './tslNoiseFields.js'
import * as kernel from './staticNoise4d.js'

export function field(points = 4): TslIrExpression {
  const pixels = Array.from({length:points},(_,index) => {
    const half = 0x400 + index % 15360, exponent = (half >>> 10) & 31, fraction = half & 1023
    const value = 2 ** (exponent - 15) * (1 + fraction / 1024)
    return [value,.5,.51171875,1]
  }).flat()
  const image = {op:'tex_image',sourceEngine:'EEVEE',nativeGpuBackend:'METAL',sourceImageStorage:'rgba32f',
    sourceImageUploadRounding:'none',width:points,height:1,pixels,output:'color',interpolation:'Closest',extension:'REPEAT',vector:{op:'uv'}}
  return {op:'noise_field_nearest',profile:'finite-nearest-f32-v1',sourceSamples:'native-float-data-v1',sourceColorSpace:'Non-Color',kernel:{op:'noise_fractal',dimensions:4,output:'color',
    detail:6,roughness:1,lacunarity:1,noiseType:'FBM',evaluationModel:'shader',offsetModel:'float4-f32',
    scale:{op:'const_float',value:40},input:image,w:{op:'const_float',value:.375},colorOffsets:[[112.125,119.25,126.5,145.75],[142.5,128.25,166.125,103.75]]}}
}
const freeze = (value:unknown):void => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze);Object.freeze(value) } }

describe('attempt-owned finite Noise preparation',()=>{
  it('requires explicit asynchronous preparation and leaves the original tree/range proof intact',async()=>{
    const output=field(),document={schemaVersion:1 as const,model:'blendlink-tsl-ir-v1' as const,output}
    const before=JSON.stringify(document);freeze(document)
    expect(()=>buildTslColorNode(document)).toThrow(/asynchronous prepareTslNoiseFields/)
    const prepared=await prepareTslNoiseFields(document),image=preparedNoiseField(prepared,output)!
    const ir=output.kernel as TslIrExpression,source=ir.input as TslIrExpression,pixels=source.pixels as number[]
    for(let index=0;index<pixels.length;index+=4){
      const color=kernel.foldStaticNoise4dColor({...ir,input:{op:'const_vec3',value:pixels.slice(index,index+3)}})
      expect((image.pixels as number[]).slice(index,index+4)).toEqual([...color!,1])
    }
    expect(JSON.stringify(document)).toBe(before)
    const resources=createTslBuildResources()
    expect(buildTslColorNode(document,{preparedNoiseFields:prepared,resources})).toBeDefined()
    expect(resources.textures).toHaveLength(1)
    prepared.dispose();expect(preparedNoiseField(prepared,output)).toBeUndefined()
    expect(()=>buildTslColorNode(document,{preparedNoiseFields:prepared})).toThrow(/asynchronous/)
    resources.dispose();expect(resources.textures).toHaveLength(0)
  })
  it('deduplicates actual kernel evaluations across immutable program copies within one transaction only',async()=>{
    const spy=vi.spyOn(kernel,'foldStaticNoise4dColor'),a=field(32),b=structuredClone(a)
    const prepared=await prepareTslNoiseFields([a,b]);expect(spy).toHaveBeenCalledTimes(32)
    expect(prepared.statistics).toMatchObject({fields:2,tables:1,texels:32,bytes:512,uniquePoints:32})
    expect(preparedNoiseField(prepared,a)).toBe(preparedNoiseField(prepared,b));prepared.dispose()
    const again=await prepareTslNoiseFields([a]);expect(spy).toHaveBeenCalledTimes(64);again.dispose();spy.mockRestore()
  })
  it('yields throughout certification/folding and aborts without mutating input or allocating GPU resources',async()=>{
    const source=field(4096),before=JSON.stringify(source),controller=new AbortController();let yields=0
    await expect(prepareTslNoiseFields(source,{signal:controller.signal,sliceMilliseconds:.25,yieldControl:async()=>{
      if(++yields===3)controller.abort()
    }})).rejects.toMatchObject({name:'AbortError'})
    expect(yields).toBe(3);expect(JSON.stringify(source)).toBe(before)
    const prepared=await prepareTslNoiseFields(source,{sliceMilliseconds:.25});expect(prepared.statistics.yields).toBeGreaterThan(3)
    expect(prepared.statistics.texels).toBe(4096);prepared.dispose()
  })
  it('does not swallow a scheduler rejection with an empty reason',async()=>{
    await expect(prepareTslNoiseFields(field(),{yieldControl:()=>Promise.reject(undefined)})).rejects.toBeUndefined()
  })
  it('cancels even while an application scheduler has not granted the next task',async()=>{
    const controller=new AbortController()
    const task=prepareTslNoiseFields(field(),{signal:controller.signal,yieldControl:()=>new Promise(()=>{})})
    const rejected=expect(task).rejects.toMatchObject({name:'AbortError'});controller.abort();await rejected
  })
  it('prepares executable image coordinates without traversing image pixel data',async()=>{
    const nested=field(),image={op:'tex_image',width:1,height:1,pixels:[.25,.5,.75,1],output:'color',interpolation:'Closest',extension:'REPEAT',vector:nested}
    const prepared=await prepareTslNoiseFields(image)
    expect(prepared.statistics.fields).toBe(1);expect(preparedNoiseField(prepared,nested)).toBeDefined()
    prepared.dispose()
  })
  it.each(['profile','pixels','wrapper'] as const)('refuses a caller mutating %s during an application yield',async kind=>{
    const source=field(32);let changed=false
    await expect(prepareTslNoiseFields(source,{yieldControl:async()=>{
      if(changed)return;changed=true
      if(kind==='profile')source.profile='future-profile'
      if(kind==='wrapper')source.futurePrecision='future'
      if(kind==='pixels')((source.kernel as TslIrExpression).input as TslIrExpression).pixels=[.75,.5,.25,1,...(((source.kernel as TslIrExpression).input as TslIrExpression).pixels as number[]).slice(4)]
    }})).rejects.toThrow(/source changed/)
  })
  it('refuses late source mutation on lookup without freezing or rewriting caller input',async()=>{
    const source=field(),preparation=await prepareTslNoiseFields(source)
    expect(Object.isFrozen(source)).toBe(false)
    source.sourceColorSpace='future-color'
    expect(()=>preparedNoiseField(preparation,source)).toThrow(/source changed/);preparation.dispose()
  })
  it('never specializes old serialized or unqualified precise kernels',async()=>{
    const source=field(),old=(source.kernel as TslIrExpression),prepared=await prepareTslNoiseFields(old)
    expect(prepared.statistics.tables).toBe(0);expect(preparedNoiseField(prepared,old)).toBeUndefined();prepared.dispose()
  })
  it.each([
    (x:TslIrExpression)=>{x.profile='unknown'},
    (x:TslIrExpression)=>{x.sourceSamples='future-native'},
    (x:TslIrExpression)=>{x.sourceColorSpace='Linear Rec.709'},
    (x:TslIrExpression)=>{x.sourceColorSpace='future-color'},
    (x:TslIrExpression)=>{x.futurePrecision='unverified'},
    (x:TslIrExpression)=>{(x.kernel as TslIrExpression).distortion=0},
    (x:TslIrExpression)=>{((x.kernel as TslIrExpression).input as TslIrExpression).workingSpace='sRGB'},
    (x:TslIrExpression)=>{((x.kernel as TslIrExpression).input as TslIrExpression).interpolation='Linear'},
    (x:TslIrExpression)=>{((x.kernel as TslIrExpression).input as TslIrExpression).width=16385},
    (x:TslIrExpression)=>{((x.kernel as TslIrExpression).input as TslIrExpression).pixels=[2**-24,.5,.5,1]},
  ])('refuses a forged fresh profile without a GPU fallback',async change=>{
    const source=field(1);change(source);await expect(prepareTslNoiseFields(source)).rejects.toThrow(/verified source/)
  })
})

describe('automatic material installation boundary',()=>{
  it('preserves materials and callbacks when aborted during cooperative preparation',async()=>{
    const THREE=await import('three'),{installTslMaterials}=await import('./tslMaterialRuntime.js')
    const root=new THREE.Group(),material=new THREE.MeshStandardMaterial(),mesh=new THREE.Mesh(new THREE.PlaneGeometry(),material)
    material.userData.blendlink_source_material='Paint';root.add(mesh)
    const callback=()=>{};mesh.onBeforeRender=callback
    const source={schemaVersion:1 as const,model:'blendlink-material-programs-v1' as const,materials:{Paint:{channels:{'Base Color':{tslIr:{schemaVersion:1 as const,model:'blendlink-tsl-ir-v1' as const,output:field(4096)}}}}}}
    const serialized=JSON.stringify(source),controller=new AbortController(),track=vi.fn(),texture=vi.fn()
    const task=installTslMaterials({root,descriptor:{materialPrograms:{url:'https://example.test/programs.json',bytes:1,hash:'x',materials:1}},
      loadPrograms:async()=>source,signal:controller.signal,trackMaterialClone:track,loadProgramTexture:texture})
    const rejected=expect(task).rejects.toMatchObject({name:'AbortError'})
    setTimeout(()=>controller.abort(),2);await rejected
    expect(mesh.material).toBe(material);expect(mesh.onBeforeRender).toBe(callback)
    expect(track).not.toHaveBeenCalled();expect(texture).not.toHaveBeenCalled();expect(JSON.stringify(source)).toBe(serialized)
    material.dispose();mesh.geometry.dispose()
  })
  it('releases partially built textures if a custom transport mutates another channel after preparation',async()=>{
    const THREE=await import('three'),{installTslMaterials}=await import('./tslMaterialRuntime.js')
    const root=new THREE.Group(),material=new THREE.MeshStandardMaterial(),mesh=new THREE.Mesh(new THREE.PlaneGeometry(),material)
    material.userData.blendlink_source_material='Paint';root.add(mesh)
    const callback=mesh.onBeforeRender,a=field(),b=structuredClone(a)
    const document=(output:TslIrExpression)=>({schemaVersion:1 as const,model:'blendlink-tsl-ir-v1' as const,output})
    const programs={schemaVersion:1 as const,model:'blendlink-material-programs-v1' as const,
      images:{unused:{file:'unused.png',bytes:1,hash:'x',mime:'image/png',width:1,height:1,colorSpace:'sRGB'}},
      materials:{Paint:{channels:{'Base Color':{tslIr:document(a)},'Emission Color':{tslIr:document(b)}}}}}
    const dispose=vi.spyOn(THREE.Texture.prototype,'dispose')
    try {
      await expect(installTslMaterials({root,descriptor:{materialPrograms:{url:'https://example.test/programs.json',bytes:1,hash:'x',materials:1}},
        loadPrograms:async()=>programs,loadProgramTexture:async()=>{b.profile='future';return new THREE.Texture()}})).rejects.toThrow(/source changed/)
      expect(dispose).toHaveBeenCalledTimes(2)
      expect(mesh.material).toBe(material);expect(mesh.onBeforeRender).toBe(callback)
    } finally {dispose.mockRestore();material.dispose();mesh.geometry.dispose()}
  })
  it('shares CPU preparation across matching materials and restores draw callbacks/resources on dispose',async()=>{
    const THREE=await import('three'),{installTslMaterials}=await import('./tslMaterialRuntime.js')
    const root=new THREE.Group(),sources=['Paint','Other'].map(name=>{
      const material=new THREE.MeshStandardMaterial();material.userData.blendlink_source_material=name
      const mesh=new THREE.Mesh(new THREE.PlaneGeometry(),material);root.add(mesh);return{mesh,material,callback:mesh.onBeforeRender}
    })
    const expression=field(16),document={schemaVersion:1 as const,model:'blendlink-tsl-ir-v1' as const,output:expression}
    const programs={schemaVersion:1 as const,model:'blendlink-material-programs-v1' as const,materials:{
      Paint:{channels:{'Base Color':{tslIr:document}}},Other:{channels:{'Base Color':{tslIr:structuredClone(document)}}}}}
    const release=vi.fn(),installed=await installTslMaterials({root,descriptor:{materialPrograms:{url:'https://example.test/programs.json',bytes:1,hash:'x',materials:2}},
      loadPrograms:async()=>programs,trackMaterialClone:()=>release})
    expect(installed.applied).toBe(2);expect(installed.skipped).toEqual([])
    expect(installed.noisePreparation).toMatchObject({fields:2,tables:1,texels:16,uniquePoints:16})
    const textures=sources.map(({mesh})=>{ const clone=mesh.material as THREE.MeshStandardMaterial;expect(clone).not.toBe(sources.find(x=>x.mesh===mesh)!.material);return vi.spyOn(clone,'dispose') })
    installed.dispose();installed.dispose();expect(release).toHaveBeenCalledTimes(2)
    for(const{mesh,material,callback}of sources){expect(mesh.material).toBe(material);expect(mesh.onBeforeRender).toBe(callback);material.dispose();mesh.geometry.dispose()}
    textures.forEach(spy=>expect(spy).toHaveBeenCalledOnce())
  })
})
