import assert from 'node:assert/strict'
import {copyFile,cp,mkdir,readdir,readFile,writeFile,realpath} from 'node:fs/promises'
import {join,resolve,basename} from 'node:path'
import {createServer} from 'vite'
import {chromium} from '@playwright/test'
import {captureRuntimeSnapshot,hash} from '../../scripts/lib/runtime-provenance.mjs'
import {assertFinal,assertQualification,browserProofContract} from './protocol.mjs'
const root=resolve(import.meta.dirname,'../..'),directory=resolve(process.env.SCENETOWEB_NOISE_DEFAULT_FIELD_REFERENCES),built=process.argv.includes('--built'),final=process.argv.includes('--final')
const profile=process.env.BLENDLINK_TEST_PROFILE??'software';assert.ok(['metal','software'].includes(profile))
const qualification=assertQualification(JSON.parse(await readFile(join(directory,'qualification.json'))))
for(const[file,pin]of Object.entries(qualification.sourceHashes))assert.equal(hash(await readFile(join(root,file))),pin,'Native source changed: '+file)
const published=final?JSON.parse(await readFile(join(directory,'final-proof.json'))):null
if(published){
 assertFinal(published,qualification,{built,nativeSha256:hash(await readFile(join(directory,'qualification.json')))})
 for(const entry of published.provenance){assert.equal(hash(await readFile(join(root,entry.source))),entry.sha256);assert.equal(hash(await readFile(join(root,entry.artifact))),entry.sha256)}
}
const selected=qualification.cases.filter(entry=>!final||published.rows.some(row=>row.case===entry.case)),cases=[]
for(const entry of selected){
 const nativeProgram=join(directory,entry.programFile),pixels=join(directory,entry.pixelFile)
 assert.equal(hash(await readFile(nativeProgram)),entry.programSha256);assert.equal(hash(await readFile(pixels)),entry.pixelSha256)
 if(entry.controlFile)assert.equal(hash(await readFile(join(directory,entry.controlFile))),entry.controlSha256)
 const input=join(directory,entry.inputFile);assert.equal(hash(await readFile(input)),entry.inputSha256)
 const actual=published?.rows.find(row=>row.case===entry.case)
 if(actual)assert.equal(hash(await readFile(join(directory,actual.sourceFile))),actual.sourceSha256)
 const axis=qualification.coordinateControls.find(r=>r.width===entry.width&&r.height===entry.height);assert.ok(axis);assert.equal(hash(await readFile(join(directory,axis.pixelFile))),axis.pixelSha256);cases.push({...entry,coordinateUrl:'/@fs'+join(directory,axis.pixelFile),coordinateSha256:axis.pixelSha256,...(entry.controlFile?{controlUrl:'/@fs'+join(directory,entry.controlFile)}:{}),programUrl:'/@fs'+nativeProgram,pixelUrl:'/@fs'+pixels,inputUrl:'/@fs'+input,...(actual?{manifestUrl:'/@fs'+actual.manifestPath,manifestSha256:actual.manifestSha256,glbUrl:'/@fs'+actual.glbPath,glbSha256:actual.glbSha256,presentationUrl:'/@fs'+actual.presentationPath,presentationSha256:actual.presentationSha256,modulePath:actual.modulePath,moduleSha256:actual.moduleSha256,moduleExport:actual.moduleExport}: {})})
}
const resizeCases=[]
for(const entry of qualification.cases){
 for(const [file,pin]of [[entry.pixelFile,entry.pixelSha256],[entry.inputFile,entry.inputSha256]])assert.equal(hash(await readFile(join(directory,file))),pin)
 const axis=qualification.coordinateControls.find(r=>r.width===entry.width&&r.height===entry.height);resizeCases.push({...entry,coordinateUrl:'/@fs'+join(directory,axis.pixelFile),coordinateSha256:axis.pixelSha256,...(entry.controlFile?{controlUrl:'/@fs'+join(directory,entry.controlFile)}:{}),pixelUrl:'/@fs'+join(directory,entry.pixelFile),inputUrl:'/@fs'+join(directory,entry.inputFile)})
}
const destination=join(directory,`browser-${final?'final':'raw'}-${profile}`),fixture=join(destination,'fixture');await mkdir(destination);await mkdir(fixture)
const {provenance}=await captureRuntimeSnapshot({root,built,destination:join(destination,'runtime'),label:'CPU default Noise field'})
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
for(const name of ['browser.js','index.html','numeric-contract.mjs']){const bytes=await readFile(join(import.meta.dirname,name));provenance.fixturePins[name]=hash(bytes);await copyFile(join(import.meta.dirname,name),join(fixture,name))}
provenance.runnerSha256=hash(await readFile(join(import.meta.dirname,'run.mjs')))
provenance.protocolSha256=hash(await readFile(join(import.meta.dirname,'protocol.mjs')))
provenance.generatedFiles=[]
if(final){const generated=join(destination,'generated');await mkdir(generated,{recursive:true});for(const entry of cases){const name=basename(entry.modulePath);assert.equal(hash(await readFile(entry.modulePath)),entry.moduleSha256);await copyFile(entry.modulePath,join(generated,name));provenance.generatedFiles.push({name,sha256:entry.moduleSha256,source:entry.modulePath});entry.moduleUrl='/@fs'+join(generated,name)}}
const extension=built?'.js':'.ts',module=name=>join(destination,'runtime',name+extension)
const server=await createServer({root:fixture,configFile:false,publicDir:final?join(directory,'compiled/public'):false,logLevel:'warn',optimizeDeps:{noDiscovery:true},resolve:{dedupe:['three'],alias:{'@pixel-compositor':module('tslSourceCompositor'),'@pixel-source-display':module('sourceDisplay'),'@pixel-post-pipeline':module('threeWebgpuPostPipeline'),'@pixel-bindings':module('runtime'),'@field-runtime':module('threeRuntime'),'@field-axes':module('tslCompositorExactAxes')}},server:{host:'127.0.0.1',port:0,watch:null,hmr:false,fs:{allow:[root,directory,await realpath(join(root,'node_modules'))]}}})
const coordinateControls=qualification.coordinateControls.map(r=>({...r,pixelUrl:'/@fs'+join(directory,r.pixelFile)}));
const report={status:'running',built,final,profile,sourceDevice:qualification.device,provenance,rows:[]};let browser
const save=()=>writeFile(join(destination,'report.json'),JSON.stringify(report,null,2)+'\n')
const persist=async artifacts=>{const records=[];for(const a of artifacts){assert.match(a.file,/^[A-Za-z0-9.-]+\.rgba32f$/);const bytes=Buffer.from(a.bytesBase64,'base64');assert.equal(hash(bytes),a.sha256);await writeFile(join(destination,a.file),bytes,{flag:'wx'});records.push({file:a.file,sha256:a.sha256,bytes:bytes.length})}return records}
try{
 await server.listen();browser=await chromium.launch({headless:true,...(process.env.BLENDLINK_TEST_CHROMIUM_CHANNEL?{channel:process.env.BLENDLINK_TEST_CHROMIUM_CHANNEL}:{}),args:['--enable-unsafe-webgpu','--enable-unsafe-swiftshader',...JSON.parse(process.env.BLENDLINK_TEST_CHROMIUM_ARGS??'[]')]});report.browserVersion=browser.version()
 for(const backend of ['webgpu','webgl2']){
  const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text())})
  await page.goto(server.resolvedUrls.local[0]+'index.html?backend='+backend);await page.waitForFunction(()=>typeof window.runNoiseDefaultFieldProof==='function').catch(error=>{throw new Error(String(error)+' '+JSON.stringify(errors))})
  if(backend==='webgpu'){
   const negative=await page.evaluate(async proof=>{
    const gpu=navigator.gpu;if(!gpu)throw new Error('Positive proof needs navigator.gpu')
    const previous=Object.getOwnPropertyDescriptor(gpu,'requestAdapter');Object.defineProperty(gpu,'requestAdapter',{value:async()=>null,configurable:true})
    try{await window.runNoiseDefaultFieldProof(proof);return{refused:false}}catch(error){return{refused:true,error:String(error)}}finally{if(previous)Object.defineProperty(gpu,'requestAdapter',previous);else delete gpu.requestAdapter}
   },{final,cases,resizeCases,coordinateControls,assetBaseUrl:server.resolvedUrls.local[0]})
   assert.equal(negative.refused,true);assert.match(negative.error,/actual WebGPU adapter/);report.missingAdapterControl=negative
  }
  let row;try{row=await page.evaluate(proof=>window.runNoiseDefaultFieldProof(proof),{final,cases,resizeCases,coordinateControls,assetBaseUrl:server.resolvedUrls.local[0]})}catch(error){report.failureArtifacts=await persist(await page.evaluate(()=>window.__noiseArtifacts??[]));await save();throw error}await persist(row.artifacts);delete row.artifacts;report.rows.push({...row,pageErrors:errors});await save()
  assert.equal(row.backend,backend);assert.equal(row.gpu.api,backend==='webgpu'?'WebGPU':'WebGL2');assert.deepEqual(errors,[]);assert.deepEqual(row.errors,[]);assert.equal(row.rows.length,cases.length)
  if(profile==='metal'){assert.match(JSON.stringify(row.gpu),/apple|metal/i);assert.doesNotMatch(JSON.stringify(row.gpu),/swiftshader/i)}else assert.match(JSON.stringify(row.gpu),/swiftshader/i)
  await page.close()
 }
 assert.deepEqual(report.rows.map(row=>row.backend).sort(),['webgl2','webgpu']);report.status=browserProofContract.browserStatus;await save()
 console.log('SCENETOWEB_NOISE_DEFAULT_FIELD_BROWSER_PASSED '+JSON.stringify(report.rows.map(row=>({backend:row.backend,gpu:row.gpu,cases:row.rows.length,negatives:row.negatives.length}))))
}catch(error){report.status='failed';report.error=String(error);throw error}finally{await save();await browser?.close();await server.close()}
