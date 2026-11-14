import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { expect, it } from 'vitest'
import {browserProofContract} from './protocol.mjs'
import { resolveConfig } from '../../packages/blendlink/src/config.js'
import { parseManifest } from '../../packages/blendlink/src/typegen.js'
const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex')
it('publishes exact saved Blackbody MF colors through actual built source presentation',async()=>{
 const native=resolve(process.env.SCENETOWEB_BLACKBODY_REFERENCES!),q=JSON.parse(readFileSync(join(native,'qualification.json'),'utf8'))
 for(const[file,pin]of Object.entries(q.sourceHashes))expect(hash(readFileSync(file))).toBe(pin)
 for(const entry of q.artifactInputs){expect(hash(readFileSync(entry.source))).toBe(entry.sha256);expect(hash(readFileSync(entry.artifact))).toBe(entry.sha256)}
 const cases=q.cases.filter((row:any)=>row.sourceFile),root=join(native,'compiled');mkdirSync(root,{recursive:true})
 const {syncAll,verifyAll,publishedAssetPath}=await import('../../packages/blendlink/dist/sync.js')
 const config=resolveConfig({blenderPath:process.env.BLENDLINK_BLENDER??'/Applications/Blender.app/Contents/MacOS/Blender',outDir:'public/models',genDir:'src/generated',scenes:cases.map((entry:any,index:number)=>({name:'blackbody'+index,file:join(native,entry.sourceFile)}))},root)
 try{await syncAll(config,{force:true})}catch(error){console.error((error as any).detail??error);throw error}
 const rows=[]
 for(const[index,scene]of config.scenes.entries()){
  const entry=cases[index],manifestBytes=readFileSync(scene.manifestPath),manifest=parseManifest(manifestBytes.toString())!
  const pointer=manifest.sourcePresentation;expect(pointer,entry.case).toBeTruthy()
  const path=publishedAssetPath(scene,pointer!.url,manifest)!,bytes=readFileSync(path),body=JSON.parse(bytes.toString()),actual=JSON.parse(readFileSync(join(native,entry.programFile),'utf8'))
  expect(bytes.length).toBe(pointer!.bytes);expect(hash(bytes).slice(0,16)).toBe(pointer!.hash)
  for(const key of ['status','ops','passes','output'])expect(body.compositor[key],entry.case+' '+key).toEqual(actual[key])
  expect(hash(readFileSync(join(native,entry.sourceFile)))).toBe(entry.sourceSha256)
  rows.push({case:entry.case,sourceFile:entry.sourceFile,sourceSha256:entry.sourceSha256,manifestPath:scene.manifestPath,manifestSha256:hash(manifestBytes),glbPath:scene.glbPath,glbSha256:hash(readFileSync(scene.glbPath)),programPath:path,programSha256:hash(bytes),pointer})
 }
 expect((await verifyAll(config)).filter(issue=>issue.severity!=='warning')).toEqual([])
 writeFileSync(join(native,'final-proof.json'),JSON.stringify({status:browserProofContract.finalStatus,device:q.device,exporter:'built',sourcePreserved:true,nativeQualificationSha256:hash(readFileSync(join(native,'qualification.json'))),rows,provenance:q.artifactInputs},null,2)+'\n')
},480_000)
