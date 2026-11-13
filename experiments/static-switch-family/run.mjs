import assert from 'node:assert/strict'
import {copyFile,cp,mkdir,readdir,readFile,writeFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {createServer} from 'vite'
import {chromium} from '@playwright/test'
import {loadRuntimeTransaction} from '../../scripts/lib/runtime-transaction-snapshot.mjs'
import {captureRuntimeSnapshot,hash} from '../../scripts/lib/runtime-provenance.mjs'
import {assertFinal,assertQualification} from './protocol.mjs'
const root=resolve(import.meta.dirname,'../..'),directory=resolve(process.env.SCENETOWEB_SWITCH_REFERENCES),built=process.argv.includes('--built'),final=process.argv.includes('--final')
const profile=process.env.BLENDLINK_TEST_PROFILE??'software';assert.ok(['metal','software'].includes(profile))
const qualification=assertQualification(JSON.parse(await readFile(join(directory,'qualification.json'))))
for(const[file,pin]of Object.entries(qualification.sourceHashes))assert.equal(hash(await readFile(join(root,file))),pin,'Native source changed: '+file)
for(const entry of qualification.artifactInputs){assert.equal(hash(await readFile(join(root,entry.source))),entry.sha256);assert.equal(hash(await readFile(join(root,entry.artifact))),entry.sha256)}
const published=final?JSON.parse(await readFile(join(directory,'final-proof.json'))):null
if(published){
 assert.equal(built,true);assertFinal(published,qualification,hash(await readFile(join(directory,'qualification.json'))))

}
const selected=qualification.cases.filter(entry=>!final||published.rows.some(row=>row.case===entry.case)),cases=[]
for(const entry of selected){
 const nativeProgram=join(directory,entry.programFile),pixels=join(directory,entry.pixelFile)
 assert.equal(hash(await readFile(nativeProgram)),entry.programSha256);assert.equal(hash(await readFile(pixels)),entry.pixelSha256)
 const actual=published?.rows.find(row=>row.case===entry.case)
 if(actual){
  assert.equal(hash(await readFile(join(directory,actual.sourceFile))),actual.sourceSha256)
  for(const name of ['manifest','glb','program'])assert.equal(hash(await readFile(actual[name+'Path'])),actual[name+'Sha256'])
 }
 cases.push({...entry,programUrl:'/@fs'+nativeProgram,pixelUrl:'/@fs'+pixels,...(actual?{manifestUrl:'/@fs'+actual.manifestPath,manifestSha256:actual.manifestSha256,glbUrl:'/@fs'+actual.glbPath,glbSha256:actual.glbSha256,publishedProgramUrl:'/@fs'+actual.programPath,publishedProgramSha256:actual.programSha256}: {})})
}
const destination=join(directory,`browser-${final?'final':'raw'}-${profile}`),fixture=join(destination,'fixture');await mkdir(fixture,{recursive:true})
const transactionPath=process.env.SCENETOWEB_RUNTIME_TRANSACTION,transactionSha256=process.env.SCENETOWEB_RUNTIME_TRANSACTION_SHA256
let provenance,runtimeDirectory=join(destination,'runtime')
if(transactionPath||transactionSha256){
 assert.equal(built,true);const shared=await loadRuntimeTransaction({root,path:transactionPath,sha256:transactionSha256});provenance=structuredClone(shared.provenance);provenance.transaction=shared.transaction;runtimeDirectory=shared.provenance.snapshot.directory
}else({provenance}=await captureRuntimeSnapshot({root,built,destination:runtimeDirectory,label:'Static Selection family'}))
provenance.nativeQualificationSha256=hash(await readFile(join(directory,'qualification.json')))
if(final)provenance.finalProofSha256=hash(await readFile(join(directory,'final-proof.json')))
if(built&&!transactionPath){
 await cp(join(root,'packages/blendlink/dist/vendor'),join(destination,'runtime/vendor'),{recursive:true})
 provenance.snapshot.vendorFiles=[]
 const record=async directory=>{for(const entry of await readdir(directory,{withFileTypes:true})){
  const file=join(directory,entry.name);if(entry.isDirectory())await record(file)
  else{const name=file.slice(join(destination,'runtime').length+1),sha256=hash(await readFile(file));assert.equal(hash(await readFile(join(root,'packages/blendlink/dist',name))),sha256);provenance.snapshot.vendorFiles.push({name,sha256})}
 }}
 await record(join(destination,'runtime/vendor'))
}
provenance.fixturePins={}
for(const name of ['browser.js','index.html']){const bytes=await readFile(join(import.meta.dirname,name));provenance.fixturePins[name]=hash(bytes);await copyFile(join(import.meta.dirname,name),join(fixture,name))}
provenance.runnerSha256=hash(await readFile(join(import.meta.dirname,'run.mjs')))
provenance.protocolSha256=hash(await readFile(join(import.meta.dirname,'protocol.mjs')))
const extension=built?'.js':'.ts',module=name=>join(runtimeDirectory,name+extension)
const server=await createServer({root:fixture,configFile:false,publicDir:final?join(directory,'compiled/public'):false,logLevel:'warn',optimizeDeps:{noDiscovery:true},resolve:{dedupe:['three'],alias:{'@selection-recipe':module('tslNodeRecipe'),'@selection-materials':module('tslMaterialRuntime'),'@selection-compositor':module('tslSourceCompositor'),'@selection-source':module('sourceDisplay'),'@selection-pipeline':module('threeWebgpuPostPipeline'),'@selection-bindings':module('runtime')}},server:{host:'127.0.0.1',port:0,watch:null,hmr:false,fs:{allow:[root,directory,runtimeDirectory]}}})
const report={status:'running',built,final,profile,sourceContext:qualification.context,provenance,rows:[]};let browser
const save=()=>writeFile(join(destination,'report.json'),JSON.stringify(report,null,2)+'\n')
try{
 await server.listen();browser=await chromium.launch({headless:true,...(process.env.BLENDLINK_TEST_CHROMIUM_CHANNEL?{channel:process.env.BLENDLINK_TEST_CHROMIUM_CHANNEL}:{}),args:['--enable-unsafe-webgpu','--enable-unsafe-swiftshader',...JSON.parse(process.env.BLENDLINK_TEST_CHROMIUM_ARGS??'[]')]});report.browserVersion=browser.version()
 for(const backend of ['webgpu','webgl2']){
  const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text())})
  await page.goto(server.resolvedUrls.local[0]+'index.html?backend='+backend);await page.waitForFunction(()=>typeof window.staticSelectionProof==='function').catch(error=>{throw new Error(String(error)+' '+JSON.stringify(errors))})
  if(backend==='webgpu'){
   const negative=await page.evaluate(async proof=>{
    const gpu=navigator.gpu;if(!gpu)throw new Error('Positive proof needs navigator.gpu')
    const previous=Object.getOwnPropertyDescriptor(gpu,'requestAdapter');Object.defineProperty(gpu,'requestAdapter',{value:async()=>null,configurable:true})
    try{await window.staticSelectionProof(proof);return{refused:false}}catch(error){return{refused:true,error:String(error)}}finally{if(previous)Object.defineProperty(gpu,'requestAdapter',previous);else delete gpu.requestAdapter}
   },{context:qualification.context,final,cases})
   assert.equal(negative.refused,true);assert.match(negative.error,/actual WebGPU adapter/);report.missingAdapterControl=negative
  }
  const row=await page.evaluate(proof=>window.staticSelectionProof(proof),{context:qualification.context,final,cases});report.rows.push({...row,pageErrors:errors});await save()
  assert.equal(row.backend,backend);assert.equal(row.gpu.api,backend==='webgpu'?'WebGPU':'WebGL2');assert.deepEqual(errors,[]);assert.deepEqual(row.errors,[]);assert.equal(row.rows.length,cases.length);assert.deepEqual(row.rows.map(x=>x.case),cases.map(x=>x.case));for(const x of row.rows){assert.equal(x.wordMismatches,0);assert.equal(x.remainingTextures,0);assert.equal(x.ownershipPreserved,true);assert.equal(x.finalBindings,final);if(final)assert.equal(x.pinRejected,true)}
  if(profile==='metal'){assert.match(JSON.stringify(row.gpu),/apple|metal/i);assert.doesNotMatch(JSON.stringify(row.gpu),/swiftshader/i)}else assert.match(JSON.stringify(row.gpu),/swiftshader/i)
  await page.close()
 }
 assert.deepEqual(report.rows.map(row=>row.backend).sort(),['webgl2','webgpu']);report.status='PASSED_STATIC_SELECTION_BUILT_PROOF';await save()
 console.log('SCENETOWEB_STATIC_SELECTION_BROWSER_PASSED '+JSON.stringify(report.rows.map(row=>({backend:row.backend,gpu:row.gpu,cases:row.rows.length}))))
}catch(error){report.status='failed';report.error=String(error);throw error}finally{await save();await browser?.close();await server.close()}
