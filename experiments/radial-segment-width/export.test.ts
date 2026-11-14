import {createHash} from 'node:crypto'
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs'
import {join,resolve} from 'node:path'
import {expect,it} from 'vitest'
import {browserProofContract} from './protocol.mjs'
import {resolveConfig} from '../../packages/blendlink/src/config.js'
import {parseManifest} from '../../packages/blendlink/src/typegen.js'
const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex')
it('publishes actual saved shader and compositor Radial Tiling Segment Width source presentations',async()=>{
 const native=resolve(process.env.SCENETOWEB_RADIAL_WIDTH_REFERENCES!),qualification=JSON.parse(readFileSync(join(native,'qualification.json'),'utf8'))
 const cases=qualification.cases.filter((entry:any)=>entry.sourceFile),root=join(native,'compiled');mkdirSync(root,{recursive:true})
 const built=process.env.BLENDLINK_RADIAL_WIDTH_BUILT==='1'
 const {syncAll,verifyAll,publishedAssetPath}=await import(built?'../../packages/blendlink/dist/sync.js':'../../packages/blendlink/src/sync.js')
 const provenance=['packages/blendlink/blender/compositor_graph.py','packages/blendlink/blender/compositor_radial_width.py','packages/blendlink/blender/source_presentation.py','packages/blendlink/blender/export_scene.py','packages/blender-addon/radial_width_ir.py','packages/blender-addon/tsl_ir.py','packages/blender-addon/material_compiler.py','packages/blender-addon/engine_fallback.py'].map(source=>{
  const artifact=built?'packages/blendlink/dist/blender/'+source.split('/').at(-1):source
  expect(readFileSync(artifact)).toEqual(readFileSync(source));return{source,artifact,sha256:hash(readFileSync(source))}
 })
 for(const entry of cases)expect(hash(readFileSync(join(native,entry.sourceFile)))).toBe(entry.sourceSha256)
 const config=resolveConfig({blenderPath:process.env.BLENDLINK_BLENDER??'/Applications/Blender.app/Contents/MacOS/Blender',outDir:'public/models',genDir:'src/generated',scenes:cases.map((entry:any,index:number)=>({name:'radial-segment-width'+index,file:join(native,entry.sourceFile)}))},root)
 try{await syncAll(config,{force:true})}catch(error){console.error((error as any).detail??error);throw error}
 const rows=[]
 for(const[index,scene]of config.scenes.entries()){
  const reference=cases[index],manifestBytes=readFileSync(scene.manifestPath),manifest=parseManifest(manifestBytes.toString())!
  expect(manifest.sourcePresentation).toBeTruthy()
  const pointer=manifest.sourcePresentation!,assetPath=publishedAssetPath(scene,pointer.url,manifest)!,bytes=readFileSync(assetPath),presentation=JSON.parse(bytes.toString())
  expect(bytes.length).toBe(pointer.bytes);expect(hash(bytes).slice(0,16)).toBe(pointer.hash)
  const nativeProgram=JSON.parse(readFileSync(join(native,reference.programFile),'utf8'))
  for(const field of ['status','ops','passes','output'])expect(presentation.compositor[field],reference.case+' '+field).toEqual(nativeProgram[field])
  expect(presentation.compositor.ops.some((op:any)=>op.kind==='radial-segment-width')).toBe(true)
  expect(manifest.materialPrograms).toBeTruthy()
  const materialPath=publishedAssetPath(scene,manifest.materialPrograms!.url,manifest)!,materialBytes=readFileSync(materialPath),materialPrograms=JSON.parse(materialBytes.toString())
  const nativeShader=JSON.parse(readFileSync(join(native,reference.shaderIrFile),'utf8'))
  expect(materialPrograms.materials['Artist Radial Width'].channels['Base Color'].tslIr).toEqual(nativeShader)
  expect(hash(materialBytes).slice(0,16)).toBe(manifest.materialPrograms!.hash)
  expect(hash(readFileSync(join(native,reference.sourceFile)))).toBe(reference.sourceSha256)
  rows.push({case:reference.case,sourceFile:reference.sourceFile,sourceSha256:reference.sourceSha256,manifestPath:scene.manifestPath,manifestSha256:hash(manifestBytes),glbPath:scene.glbPath,glbSha256:hash(readFileSync(scene.glbPath)),presentationPath:assetPath,presentationSha256:hash(bytes),presentationPointer:pointer,materialPath,materialSha256:hash(materialBytes),materialPointer:manifest.materialPrograms})
 }
 const issues=await verifyAll(config);expect(issues.filter(issue=>issue.severity!=='warning')).toEqual([])
 writeFileSync(join(native,'final-proof.json'),JSON.stringify({status:browserProofContract.finalStatus,exporter:built?'built':'source',nativeQualificationSha256:hash(readFileSync(join(native,'qualification.json'))),sourcePreserved:true,provenance,rows},null,2)+'\n')
},240_000)
