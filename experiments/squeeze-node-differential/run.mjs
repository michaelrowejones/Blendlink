import {assertSqueezeBackend,assertSqueezeApiSet} from './protocol.mjs'
import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {createServer} from 'vite'
import {chromium} from '@playwright/test'
import {captureRuntimeSnapshot,hash} from '../../scripts/lib/runtime-provenance.mjs'
const root=resolve(import.meta.dirname,'../..'),native=resolve(process.env.BLENDLINK_SQUEEZE_REFERENCES),built=process.argv.includes('--built'),final=process.argv.includes('--final'),profile=process.env.BLENDLINK_TEST_PROFILE??'default'
const references=JSON.parse(await readFile(join(native,'references.json'),'utf8'))
assert.equal(references.fixtureSha256,hash(await readFile(join(import.meta.dirname,'reference.py'))))
for(const[file,sha256]of Object.entries(references.pythonHashes))assert.equal(hash(await readFile(join(root,file))),sha256,'Regenerate native references after Python source changes: '+file)
const snapshot=join(native,`runtime-${built?'built':'source'}-${profile}-${final?'final':'raw'}`)
const {provenance}=await captureRuntimeSnapshot({root,built,destination:snapshot,label:'Squeeze native'+(final?' Final':'')})
provenance.browserFixtureSha256=hash(await readFile(join(import.meta.dirname,'browser.js')))
provenance.nativeReferenceSha256=hash(await readFile(join(native,'references.json')))
const compiled=final?JSON.parse(await readFile(join(native,'final-proof.json'),'utf8')):null
if(compiled){assert.equal(compiled.exporter,built?'built':'source');assert.equal(compiled.sourcePreserved,true);assert.equal(compiled.nativeReferenceSha256,provenance.nativeReferenceSha256);for(const entry of compiled.pythonProvenance){assert.equal(hash(await readFile(join(root,entry.source))),entry.sha256);assert.equal(hash(await readFile(join(root,entry.artifact))),entry.sha256)}}
const proof={...references,final,cases:references.cases.map(entry=>({...entry,...(compiled?.cases.find(case_=>case_.id===entry.id)??{}),irUrl:'/@fs'+join(native,entry.ir),irSha256:entry.irSha256,native:entry.native.map(file=>({...file,url:'/@fs'+join(native,file.file)}))}))}
for(const entry of proof.cases){assert.equal(hash(await readFile(join(native,entry.ir))),entry.irSha256,'Native IR pin changed');assert.equal(hash(await readFile(join(native,entry.file))),entry.sourceSha256,'Actual source blend pin changed');if(compiled)assert.equal(entry.sourceSha256,references.cases.find(row=>row.id===entry.id).sourceSha256)}
const server=await createServer({root:import.meta.dirname,configFile:false,publicDir:final?join(native,'compiled/public'):false,logLevel:'warn',optimizeDeps:{noDiscovery:true},resolve:{dedupe:['three'],alias:{'@squeeze-bounds':join(snapshot,'tslSqueeze'+(built?'.js':'.ts')),'@squeeze-recipe':join(snapshot,'tslNodeRecipe'+(built?'.js':'.ts')),'@squeeze-runtime':join(snapshot,'tslMaterialRuntime'+(built?'.js':'.ts')),'@squeeze-document':join(snapshot,'materialProgramDocument'+(built?'.js':'.ts'))}},server:{host:'127.0.0.1',port:0,watch:null,hmr:false,fs:{allow:[root,native]}}})
let browser,status='running',failure;const rows=[]
const reportPath=join(native,`browser-${final?'final':'raw'}-${profile}.json`)
const save=()=>writeFile(reportPath,JSON.stringify({status,failure,built,final,provenance,nativeVersion:references.version,rows},null,2))
try{
 await server.listen();browser=await chromium.launch({headless:true,...(process.env.BLENDLINK_TEST_CHROMIUM_CHANNEL?{channel:process.env.BLENDLINK_TEST_CHROMIUM_CHANNEL}:{}),args:['--enable-unsafe-webgpu','--enable-unsafe-swiftshader',...JSON.parse(process.env.BLENDLINK_TEST_CHROMIUM_ARGS??'[]')]})
 for(const backend of ['webgpu','webgl2']){
  const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text())})
  await page.goto(server.resolvedUrls.local[0]+'?backend='+backend);await page.waitForFunction(()=>typeof window.runProof==='function')
  if(backend==='webgpu'){
   const missingAdapter=await page.evaluate(async proof=>{
    const gpu=navigator.gpu;if(!gpu)throw new Error('The real positive WebGPU proof needs navigator.gpu')
    const descriptor=Object.getOwnPropertyDescriptor(gpu,'requestAdapter')
    Object.defineProperty(gpu,'requestAdapter',{value:async()=>null,configurable:true})
    try{await window.runProof(proof);return{rejected:false}}catch(error){return{rejected:true,error:String(error)}}
    finally{if(descriptor)Object.defineProperty(gpu,'requestAdapter',descriptor);else delete gpu.requestAdapter}
   },proof)
   assert.equal(missingAdapter.rejected,true);assert.match(missingAdapter.error,/requires an actual WebGPU adapter/)
   provenance.missingWebGpuAdapterControl=missingAdapter
  }
  const row=await page.evaluate(proof=>window.runProof(proof),proof);rows.push({...row,pageErrors:errors});await save();assertSqueezeBackend(row,backend);assert.deepEqual(errors,[]);assert.deepEqual(row.failures,[]);assert.equal(row.rows.length,proof.cases.length)
  const adapter=JSON.stringify(row.gpu).toLowerCase()
  if(profile==='software')assert.match(adapter,/swiftshader/)
  if(profile==='metal'){assert.match(adapter,/apple|metal/);assert.doesNotMatch(adapter,/swiftshader/)}
  await page.close()
 }
 assertSqueezeApiSet(rows);status='passed';await save();console.log('BLENDLINK_SQUEEZE_BROWSER_PASSED '+JSON.stringify(rows.map(row=>({backend:row.backend,cases:row.rows.length,maximum:row.maximum,gpu:row.gpu}))))
}catch(error){status='failed';failure=String(error);throw error}finally{await save();await browser?.close();await server.close()}
