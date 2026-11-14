import {createHash} from 'node:crypto'
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs'
import {join,resolve} from 'node:path'
import {expect,it} from 'vitest'
import {browserProofContract} from './protocol.mjs'
import {resolveConfig} from '../../packages/blendlink/src/config.js'
import {parseManifest} from '../../packages/blendlink/src/typegen.js'
const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex')
it('publishes actual saved CPU Static Euler source presentations',async()=>{
 const native=resolve(process.env.SCENETOWEB_STATIC_EULER_REFERENCES!),qualification=JSON.parse(readFileSync(join(native,'qualification.json'),'utf8'))
 const cases=qualification.cases.filter((entry:any)=>entry.sourceFile),root=join(native,'compiled');mkdirSync(root,{recursive:true})
 const built=process.env.BLENDLINK_STATIC_EULER_BUILT==='1'
 const {syncAll,verifyAll,publishedAssetPath}=await import(built?'../../packages/blendlink/dist/sync.js':'../../packages/blendlink/src/sync.js')
 const provenance=['compositor_graph.py','compositor_static_euler.py','compositor_static_rotation.py','compositor_static_matrix.py','source_presentation.py','export_scene.py'].map(name=>{
  const source='packages/blendlink/blender/'+name,artifact=built?'packages/blendlink/dist/blender/'+name:source
  expect(readFileSync(artifact)).toEqual(readFileSync(source));return{source,artifact,sha256:hash(readFileSync(source))}
 })
 for(const entry of cases)expect(hash(readFileSync(join(native,entry.sourceFile)))).toBe(entry.sourceSha256)
 const config=resolveConfig({blenderPath:process.env.BLENDLINK_BLENDER??'/Applications/Blender.app/Contents/MacOS/Blender',outDir:'public/models',genDir:'src/generated',scenes:cases.map((entry:any,index:number)=>({name:'static-euler'+index,file:join(native,entry.sourceFile)}))},root)
 try{await syncAll(config,{force:true})}catch(error){console.error((error as any).detail??error);throw error}
 const rows=[]
 for(const[index,scene]of config.scenes.entries()){
  const reference=cases[index],manifestBytes=readFileSync(scene.manifestPath),manifest=parseManifest(manifestBytes.toString())!
  expect(manifest.sourcePresentation).toBeTruthy()
  const pointer=manifest.sourcePresentation!,assetPath=publishedAssetPath(scene,pointer.url,manifest)!,bytes=readFileSync(assetPath),presentation=JSON.parse(bytes.toString())
  expect(bytes.length).toBe(pointer.bytes);expect(hash(bytes).slice(0,16)).toBe(pointer.hash)
  const nativeProgram=JSON.parse(readFileSync(join(native,reference.programFile),'utf8'))
  for(const field of ['status','ops','passes','output'])expect(presentation.compositor[field],reference.case+' '+field).toEqual(nativeProgram[field])
  expect(presentation.compositor.ops.some((op:any)=>op.kind==='value'&&op.source?.nodeType==='FunctionNodeRotationToQuaternion')).toBe(true)
  expect(presentation.compositor.compileTimeRotations).toEqual(nativeProgram.compileTimeRotations)
  expect(manifest.sourcePresentation).toBeTruthy()
  expect(hash(readFileSync(join(native,reference.sourceFile)))).toBe(reference.sourceSha256)
  rows.push({case:reference.case,sourceFile:reference.sourceFile,sourceSha256:reference.sourceSha256,manifestPath:scene.manifestPath,manifestSha256:hash(manifestBytes),glbPath:scene.glbPath,glbSha256:hash(readFileSync(scene.glbPath)),presentationPath:assetPath,presentationSha256:hash(bytes),presentationPointer:pointer})
 }
 const issues=await verifyAll(config);expect(issues.filter(issue=>issue.severity!=='warning')).toEqual([])
 writeFileSync(join(native,'final-proof.json'),JSON.stringify({status:browserProofContract.finalStatus,exporter:built?'built':'source',nativeQualificationSha256:hash(readFileSync(join(native,'qualification.json'))),sourcePreserved:true,provenance,rows},null,2)+'\n')
},240_000)
