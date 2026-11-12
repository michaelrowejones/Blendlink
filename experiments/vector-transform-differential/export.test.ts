import { createHash } from 'node:crypto'
import { mkdirSync,readFileSync,writeFileSync } from 'node:fs'
import { resolve,join } from 'node:path'
import { expect,it } from 'vitest'
import { resolveConfig } from '../../packages/blendlink/src/config.js'
import { parseManifest } from '../../packages/blendlink/src/typegen.js'
import { readGlbJson } from '../../packages/blendlink/src/gltfRuntimeCompatibility.js'

it('publishes native vector contexts as actual Final shared-mesh scenes in both bases',async()=>{
  const built=process.env.BLENDLINK_VECTOR_TRANSFORM_BUILT==='1'
  const {syncAll,verifyAll}=await import(built?'../../packages/blendlink/dist/sync.js':'../../packages/blendlink/src/sync.js')
  const native=resolve(process.env.BLENDLINK_VECTOR_TRANSFORM_NATIVE??'artifacts/verification-vector-transform/native53')
  const references=JSON.parse(readFileSync(join(native,'native-reference.json'),'utf8'))
  const root=join(native,'compiled');mkdirSync(root,{recursive:true})
  const sources=['Cycles','EEVEE'].map(engine=>join(native,'Vector '+engine+'.blend'))
  const hash=(path:string)=>createHash('sha256').update(readFileSync(path)).digest('hex')
  const before=sources.map(hash)
  const config=resolveConfig({blenderPath:process.env.BLENDLINK_VECTOR_TRANSFORM_BLENDER??'/Applications/Blender.app/Contents/MacOS/Blender',
    outDir:'public/models',genDir:'src/generated',scenes:['Cycles','EEVEE'].flatMap(engine=>[
      {file:join(native,'Vector '+engine+'.blend'),name:'vector_'+engine.toLowerCase()+'_yup'},
      {file:join(native,'Vector '+engine+'.blend'),name:'vector_'+engine.toLowerCase()+'_zup',exporterOverrides:{export_yup:false}},
    ])},root)
  let outcomes
  try{outcomes=await syncAll(config,{force:true})}catch(error){console.error((error as any).stderrTail??error);throw error}
  const scenes=[]
  for(const scene of config.scenes){
    const manifest=parseManifest(readFileSync(scene.manifestPath,'utf8'))!
    expect(manifest.materialPrograms).toBeTruthy()
    const gltf=readGlbJson(readFileSync(scene.glbPath),'actual Vector Transform Final') as any
    const owners=gltf.nodes.filter((node:any)=>node.extras?.blendlink_tsl_object)
    expect(owners).toHaveLength(2)
    expect(owners[0].mesh).toBe(owners[1].mesh)
    expect(gltf.meshes[owners[0].mesh].primitives).toHaveLength(28)
    const basis=scene.name.toLowerCase().endsWith('zup')?'blender-z-up':'gltf-y-up'
    expect(gltf.meshes[owners[0].mesh].extras.blendlink_tsl_runtime.objectSpace).toBe(basis)
    scenes.push({name:scene.name,manifestUrl:'/src/generated/'+scene.name+'.manifest.json',basis,
      engine:scene.name.toLowerCase().includes('cycles')?'CYCLES':references.rows.find((row:any)=>row.engine!=='CYCLES').engine})
  }
  expect((await verifyAll(config)).filter(issue=>issue.severity!=='warning')).toEqual([])
  expect(sources.map(hash)).toEqual(before)
  writeFileSync(join(root,'proof.json'),JSON.stringify({nativeVersion:references.blender,exporter:built?'built':'source',sourceUnchanged:true,outcomes,scenes,references},null,2))
},240_000)
