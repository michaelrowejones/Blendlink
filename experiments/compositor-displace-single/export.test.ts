/* SPDX-License-Identifier: MIT */
import {it,expect} from 'vitest'
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {join,resolve} from 'node:path'
import {createHash} from 'node:crypto'
import {resolveConfig} from '../../packages/blendlink/src/config.js'
import {parseManifest} from '../../packages/blendlink/src/typegen.js'
import {nativeInputs,assertPackagedInputs} from './inputs.mjs'
import {assertSources,assertProgram,statuses,expectedFinalProvenance} from './protocol.mjs'
const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex')
it('publishes unchanged admitted Displace source graphs through the actual built Final exporter',async()=>{
 const out=resolve(process.env.SCENETOWEB_DISPLACE_REFERENCES!),sources=assertSources(JSON.parse(readFileSync(join(out,'sources.json'),'utf8'))),root=join(out,'compiled')
 mkdirSync(root,{recursive:true})
 const repo=resolve(import.meta.dirname,'../..'),inputs=JSON.parse(readFileSync(join(out,'sources-source-inputs.json'),'utf8'))
 expect(await nativeInputs(repo)).toEqual(inputs)
 const provenance=expectedFinalProvenance(inputs)
 await assertPackagedInputs(repo,provenance)
 const {syncAll,verifyAll,publishedAssetPath}=await import('../../packages/blendlink/dist/sync.js')
 const config=resolveConfig({blenderPath:process.env.BLENDLINK_BLENDER!,outDir:'public/models',genDir:'src/generated',scenes:sources.rows.map((r:any,i:number)=>({name:'displace'+i,file:join(out,r.sourceFile)}))},root)
 try{await syncAll(config,{force:true})}catch(error){console.error((error as any).detail??error);throw error}
 const rows=[]
 for(const[i,scene]of config.scenes.entries()){
  const original=sources.rows[i],manifestBytes=readFileSync(scene.manifestPath),manifest=parseManifest(manifestBytes.toString())!
  const presentationPath=publishedAssetPath(scene,manifest.sourcePresentation!.url,manifest)!,presentationBytes=readFileSync(presentationPath),presentation=JSON.parse(presentationBytes.toString())
  const native=assertProgram(JSON.parse(readFileSync(join(out,original.programFile),'utf8')),original)
  assertProgram(presentation.compositor,original)
  for(const key of['status','ops','passes','output'])expect(presentation.compositor[key]).toEqual(native[key])
  expect(presentation.display.view).toBe('Raw');expect(presentation.display.ops).toEqual([])
  expect(sha(readFileSync(join(out,original.sourceFile)))).toBe(original.sourceSha256)
  rows.push({...original,manifestPath:scene.manifestPath,manifestSha256:sha(manifestBytes),glbPath:scene.glbPath,glbSha256:sha(readFileSync(scene.glbPath)),modulePath:scene.modulePath,moduleSha256:sha(readFileSync(scene.modulePath)),moduleExport:'displace'+i,presentationPath,presentationSha256:sha(presentationBytes)})
 }
 await assertPackagedInputs(repo,provenance);expect(await nativeInputs(repo)).toEqual(inputs)
 expect((await verifyAll(config)).filter(row=>row.severity!=='warning')).toEqual([])
 writeFileSync(join(out,'final.json'),JSON.stringify({status:statuses.final,sourcePreserved:true,provenance,rows},null,2)+'\n')
},300000)
