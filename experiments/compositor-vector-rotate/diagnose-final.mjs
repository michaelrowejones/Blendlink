import assert from 'node:assert/strict'
import {copyFile,cp,mkdir,readdir,readFile,writeFile,realpath} from 'node:fs/promises'
import {join,resolve,basename} from 'node:path'
import {createServer} from 'vite'
import {chromium} from '@playwright/test'
import {captureRuntimeSnapshot,hash} from '../../scripts/lib/runtime-provenance.mjs'
import {assertFinal,assertQualification,browserProofContract,expectedTables} from './protocol.mjs'
const root=resolve(import.meta.dirname,'../..'),directory=resolve(process.argv[2]),built=true,final=true
const profile=process.env.BLENDLINK_TEST_PROFILE??'software';assert.ok(['metal','software'].includes(profile))
const qualification=assertQualification(JSON.parse(await readFile(join(directory,'qualification.json'))))
// Retained native/Final source stage belongs to the failed joint snapshot. This
// diagnostic compares it with a separately archived isolated scheduling fix.
// It cannot produce qualification or capability credit.
const published=final?JSON.parse(await readFile(join(directory,'final-proof.json'))):null
if(published){
 assertFinal(published,qualification,{built,nativeSha256:hash(await readFile(join(directory,'qualification.json')))})

}
const selected=qualification.cases.filter(entry=>entry.case==='X_AXIS-forward-ordinary'),cases=[]
for(const entry of selected){
 const nativeProgram=join(directory,entry.programFile),pixels=join(directory,entry.pixelFile)
 assert.equal(hash(await readFile(nativeProgram)),entry.programSha256);assert.equal(hash(await readFile(pixels)),entry.pixelSha256)
 if(entry.controlFile)assert.equal(hash(await readFile(join(directory,entry.controlFile))),entry.controlSha256)
 const input=join(directory,entry.inputFile);assert.equal(hash(await readFile(input)),entry.inputSha256)
 const actual=published?.rows.find(row=>row.case===entry.case)
 if(actual)assert.equal(hash(await readFile(join(directory,actual.sourceFile))),actual.sourceSha256)
 cases.push({...entry,tableCount:expectedTables(entry),...(entry.controlFile?{controlUrl:'/@fs'+join(directory,entry.controlFile)}:{}),programUrl:'/@fs'+nativeProgram,pixelUrl:'/@fs'+pixels,inputUrl:'/@fs'+input,...(actual?{manifestUrl:'/@fs'+actual.manifestPath,manifestSha256:actual.manifestSha256,glbUrl:'/@fs'+actual.glbPath,glbSha256:actual.glbSha256,presentationUrl:'/@fs'+actual.presentationPath,presentationSha256:actual.presentationSha256,modulePath:actual.modulePath,moduleSha256:actual.moduleSha256,moduleExport:actual.moduleExport}: {})})
}
const resizeCases=[]
for(const entry of qualification.cases){
 for(const [file,pin]of [[entry.pixelFile,entry.pixelSha256],[entry.inputFile,entry.inputSha256]])assert.equal(hash(await readFile(join(directory,file))),pin)
 resizeCases.push({...entry,...(entry.controlFile?{controlUrl:'/@fs'+join(directory,entry.controlFile)}:{}),pixelUrl:'/@fs'+join(directory,entry.pixelFile),inputUrl:'/@fs'+join(directory,entry.inputFile)})
}
const destination=resolve(process.argv[3]),fixture=join(destination,'fixture');await mkdir(destination);await mkdir(fixture)
const {provenance}=await captureRuntimeSnapshot({root,built,destination:join(destination,'runtime'),label:'CPU Vector Rotate'})
provenance.nativeQualificationSha256=hash(await readFile(join(directory,'qualification.json')))
if(final)provenance.finalProofSha256=hash(await readFile(join(directory,'final-proof.json')))
if(built){
 await cp(join(root,'packages/blendlink/dist/vendor'),join(destination,'runtime/vendor'),{recursive:true})
 provenance.snapshot.vendorFiles=[]
 const record=async directory=>{for(const entry of await readdir(directory,{withFileTypes:true})){
  const file=join(directory,entry.name);if(entry.isDirectory())await record(file)
  else{const name=file.slice(join(destination,'runtime').length+1),sha256=hash(await readFile(file));assert.equal(hash(await readFile(join(root,'packages/blendlink/dist',name))),sha256);provenance.snapshot.vendorFiles.push({name,sha256})}
 }}
 await record(join(destination,'runtime/vendor'))
}
provenance.fixturePins={}
for(const name of ['browser.js','full-index.html']){const bytes=await readFile(join(import.meta.dirname,name));provenance.fixturePins[name]=hash(bytes);await copyFile(join(import.meta.dirname,name),join(fixture,name))}
provenance.runnerSha256=hash(await readFile(join(import.meta.dirname,'run.mjs')))
provenance.protocolSha256=hash(await readFile(join(import.meta.dirname,'protocol.mjs')))
provenance.generatedFiles=[]
if(final){const generated=join(destination,'generated');await mkdir(generated,{recursive:true});for(const entry of cases){const name=basename(entry.modulePath);assert.equal(hash(await readFile(entry.modulePath)),entry.moduleSha256);await copyFile(entry.modulePath,join(generated,name));provenance.generatedFiles.push({name,sha256:entry.moduleSha256,source:entry.modulePath});entry.moduleUrl='/@fs'+join(generated,name)}}
const extension=built?'.js':'.ts',module=name=>join(destination,'runtime',name+extension)
const server=await createServer({root:fixture,configFile:false,publicDir:final?join(directory,'compiled/public'):false,logLevel:'warn',optimizeDeps:{noDiscovery:true},resolve:{dedupe:['three'],alias:{'@pixel-compositor':module('tslSourceCompositor'),'@pixel-source-display':module('sourceDisplay'),'@pixel-post-pipeline':module('threeWebgpuPostPipeline'),'@pixel-bindings':module('runtime'),'@field-runtime':module('threeRuntime'),'@rotate-pipeline':module('threeWebgpuPostPipeline')}},server:{host:'127.0.0.1',port:0,watch:null,hmr:false,fs:{allow:[root,directory,await realpath(directory),await realpath(join(root,'node_modules'))]}}})
const report={status:'running',supportCredit:0,FinalCredit:0,stage:'retained-source-isolated-scheduling-diagnostic',built,final,profile,sourceDevice:qualification.device,provenance,rows:[]};let browser,activePage
const save=()=>writeFile(join(destination,'report.json'),JSON.stringify(report,null,2)+'\n')
const persistCalibrations=async(rows,backend,failed=false)=>{
 await mkdir(join(destination,failed?'failure-calibration':'calibration'),{recursive:true})
 for(const row of rows??[])for(const role of['copy','pixel']){const key=role+'Words',words=row[key];if(!words){assert.ok(failed);continue}assert.ok(Array.isArray(words)&&words.length===row.width*row.height*4&&words.every(n=>Number.isSafeInteger(n)&&n>=0&&n<=0xffffffff));const bytes=Buffer.alloc(words.length*4);words.forEach((word,index)=>bytes.writeUInt32LE(word,index*4));const file=(failed?'failure-calibration/':'calibration/')+backend+'-'+row.index+'-'+role+'.rgba32f';await writeFile(join(destination,file),bytes,{flag:'wx'});row[role+'File']=file;row[role+'Sha256']=hash(bytes);delete row[key]}
}

try{
 await server.listen();browser=await chromium.launch({headless:true,...(process.env.BLENDLINK_TEST_CHROMIUM_CHANNEL?{channel:process.env.BLENDLINK_TEST_CHROMIUM_CHANNEL}:{}),args:['--enable-unsafe-webgpu','--enable-unsafe-swiftshader',...JSON.parse(process.env.BLENDLINK_TEST_CHROMIUM_ARGS??'[]')]});report.browserVersion=browser.version()
 for(const backend of ['webgpu','webgl2']){
  const page=await browser.newPage(),errors=[];activePage=page;page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text())})
  await page.goto(server.resolvedUrls.local[0]+'full-index.html?backend='+backend);await page.waitForFunction(()=>typeof window.runVectorRotateProof==='function').catch(error=>{throw new Error(String(error)+' '+JSON.stringify(errors))})
  if(backend==='webgpu'){
   const negative=await page.evaluate(async proof=>{
    const gpu=navigator.gpu;if(!gpu)throw new Error('Positive proof needs navigator.gpu')
    const previous=Object.getOwnPropertyDescriptor(gpu,'requestAdapter');Object.defineProperty(gpu,'requestAdapter',{value:async()=>null,configurable:true})
    try{await window.runVectorRotateProof(proof);return{refused:false}}catch(error){return{refused:true,error:String(error)}}finally{if(previous)Object.defineProperty(gpu,'requestAdapter',previous);else delete gpu.requestAdapter}
   },{final,cases,resizeCases,assetBaseUrl:server.resolvedUrls.local[0]})
   assert.equal(negative.refused,true);assert.match(negative.error,/actual WebGPU adapter/);report.missingAdapterControl=negative
  }
  const row=await page.evaluate(proof=>window.runVectorRotateProof(proof),{final,cases,resizeCases,assetBaseUrl:server.resolvedUrls.local[0]});const rawDirectory=join(destination,'raw');await mkdir(rawDirectory,{recursive:true});for(const entry of row.rows)for(const sample of entry.samples){for(const [field,suffix]of [['words',''],['displayWords','-display']]){const words=sample[field];if(!words){assert.equal(field,'displayWords');assert.equal(final,false);continue}assert.ok(Array.isArray(words)&&words.every(n=>Number.isSafeInteger(n)&&n>=0&&n<=0xffffffff));const bytes=Buffer.alloc(words.length*4);words.forEach((n,i)=>bytes.writeUInt32LE(n,i*4));const file='raw/'+backend+'-'+entry.case+'-'+sample.index+suffix+'.rgba32f';await writeFile(join(destination,file),bytes,{flag:'wx'});sample[field==='words'?'file':'displayFile']=file;sample[field==='words'?'sha256':'displaySha256']=hash(bytes);delete sample[field]}}await persistCalibrations(row.calibrations,backend);report.rows.push({...row,pageErrors:errors});await save()
  assert.equal(row.backend,backend);assert.equal(row.gpu.api,backend==='webgpu'?'WebGPU':'WebGL2');assert.deepEqual(errors,[]);assert.deepEqual(row.errors,[]);assert.equal(row.rows.length,cases.length)
  if(profile==='metal'){assert.match(JSON.stringify(row.gpu),/apple|metal/i);assert.doesNotMatch(JSON.stringify(row.gpu),/swiftshader/i)}else assert.match(JSON.stringify(row.gpu),/swiftshader/i)
  await page.close()
 }
 assert.deepEqual(report.rows.map(row=>row.backend).sort(),['webgl2','webgpu']);report.status='PASSED_RESEARCH_ONLY_VECTOR_ROTATE_FINAL_SCHEDULING';await save()
 console.log('SCENETOWEB_VECTOR_ROTATE_BROWSER_PASSED '+JSON.stringify(report.rows.map(row=>({backend:row.backend,gpu:row.gpu,cases:row.rows.length,negatives:row.negatives.length}))))
}catch(error){
 report.status='failed';report.error=String(error)
 // page.evaluate rejects atomically. Read the already retained browser journal
 // before closing the page so a bad pixel is preserved without another draw.
 try{
  const snapshot=await activePage?.evaluate(()=>window.vectorRotateFailureSnapshot??null)
  if(snapshot){
   await persistCalibrations(snapshot.calibrations,snapshot.backend,true)
   const failure=join(destination,'failure');await mkdir(failure,{recursive:true});const entries=[...(snapshot.rows??[]).flatMap(row=>(row.samples??[]).map(sample=>({origin:'completed-row',ownerCase:row.case,...sample}))),...(snapshot.activeSamples??[]).map(sample=>({origin:'active-case',ownerCase:snapshot.activeCase,...sample})),...(snapshot.currentComparison?[{origin:'current-comparison',...snapshot.currentComparison}]:[])]
   const artifacts=[];for(const[index,entry]of entries.entries())for(const field of['words','displayWords']){const words=entry[field];if(!words)continue;assert.ok(words.every(n=>Number.isSafeInteger(n)&&n>=0&&n<=0xffffffff));const bytes=Buffer.alloc(words.length*4);words.forEach((n,i)=>bytes.writeUInt32LE(n,i*4));const file='failure/'+index+'-'+field+'.rgba32f';await writeFile(join(destination,file),bytes,{flag:'wx'});artifacts.push({file,sha256:hash(bytes),words:words.length,origin:entry.origin,case:entry.case,stage:entry.stage,field})}
   const state=Buffer.from(JSON.stringify(snapshot,null,2)+'\n');await writeFile(join(failure,'browser-state.json'),state,{flag:'wx'});report.failureEvidence={supportCredit:0,stateFile:'failure/browser-state.json',stateSha256:hash(state),artifacts}
  }
 }catch(captureError){report.failureEvidenceError=String(captureError)}
 throw error
}finally{await save();await browser?.close();await server.close()}
