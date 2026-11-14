import {createHash} from 'node:crypto'
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs'
import {join,resolve} from 'node:path'
import {expect,it} from 'vitest'
import {browserProofContract,expectedFinalProvenance,assertProgram} from './protocol.mjs'
import {resolveConfig} from '../../packages/blendlink/src/config.js'
import {parseManifest} from '../../packages/blendlink/src/typegen.js'
const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex')
it('publishes actual saved CPU Wave axis source presentations',async()=>{
 const native=resolve(process.env.SCENETOWEB_WAVE_AXIS_REFERENCES!),qualification=JSON.parse(readFileSync(join(native,'qualification.json'),'utf8'))
 const cases=qualification.cases.filter((entry:any)=>entry.sourceFile),root=join(native,'compiled');mkdirSync(root,{recursive:true})
 const built=process.env.BLENDLINK_WAVE_AXIS_BUILT==='1'
 const {syncAll,verifyAll,publishedAssetPath}=await import(built?'../../packages/blendlink/dist/sync.js':'../../packages/blendlink/src/sync.js')
 const provenance=expectedFinalProvenance(qualification)
 for(const entry of provenance){
  const bytes=readFileSync(entry.source);expect(hash(bytes)).toBe(entry.sha256);expect(readFileSync(entry.artifact)).toEqual(bytes)
 }
 for(const entry of cases)expect(hash(readFileSync(join(native,entry.sourceFile)))).toBe(entry.sourceSha256)
 const config=resolveConfig({blenderPath:process.env.BLENDLINK_BLENDER??'/Applications/Blender.app/Contents/MacOS/Blender',outDir:'public/models',genDir:'src/generated',scenes:cases.map((entry:any,index:number)=>({name:'waveAxis'+index,file:join(native,entry.sourceFile)}))},root)
 try{await syncAll(config,{force:true})}catch(error){console.error((error as any).detail??error);throw error}
 const rows=[]
 for(const[index,scene]of config.scenes.entries()){
  const reference=cases[index],manifestBytes=readFileSync(scene.manifestPath),manifest=parseManifest(manifestBytes.toString())!
  expect(manifest.sourcePresentation).toBeTruthy()
  const pointer=manifest.sourcePresentation!,assetPath=publishedAssetPath(scene,pointer.url,manifest)!,bytes=readFileSync(assetPath),presentation=JSON.parse(bytes.toString())
  expect(bytes.length).toBe(pointer.bytes);expect(hash(bytes).slice(0,16)).toBe(pointer.hash)
  assertProgram(presentation.compositor,reference)
  const nativeProgram=JSON.parse(readFileSync(join(native,reference.programFile),'utf8'))
  for(const field of ['status','ops','passes','output'])expect(presentation.compositor[field],reference.case+' '+field).toEqual(nativeProgram[field])
  expect(presentation.compositor.ops.some((op:any)=>op.kind==='wave-texture'&&op.source?.nodeType==='ShaderNodeTexWave')).toBe(true)
  expect(manifest.sourcePresentation).toBeTruthy()
  expect(hash(readFileSync(join(native,reference.sourceFile)))).toBe(reference.sourceSha256)
  rows.push({case:reference.case,sourceFile:reference.sourceFile,sourceSha256:reference.sourceSha256,manifestPath:scene.manifestPath,manifestSha256:hash(manifestBytes),glbPath:scene.glbPath,glbSha256:hash(readFileSync(scene.glbPath)),modulePath:scene.modulePath,moduleSha256:hash(readFileSync(scene.modulePath)),moduleExport:'waveAxis'+index,presentationPath:assetPath,presentationSha256:hash(bytes),presentationPointer:pointer})
 }
 const issues=await verifyAll(config);expect(issues.filter(issue=>issue.severity!=='warning')).toEqual([])
 writeFileSync(join(native,'final-proof.json'),JSON.stringify({status:browserProofContract.finalStatus,exporter:built?'built':'source',nativeQualificationSha256:hash(readFileSync(join(native,'qualification.json'))),sourcePreserved:true,provenance,rows},null,2)+'\n')
},240_000)
