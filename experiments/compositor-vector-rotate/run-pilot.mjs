/* SPDX-License-Identifier: MIT */
import assert from 'node:assert/strict'
import {copyFile,cp,mkdir,readdir,readFile,realpath,writeFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {createServer} from 'vite'
import {chromium} from '@playwright/test'
import {captureRuntimeSnapshot,hash} from '../../scripts/lib/runtime-provenance.mjs'
import {takeRawWords} from './raw-words.mjs'
const root=resolve(import.meta.dirname,'../..'),directory=resolve(process.argv[2]),profile=process.argv[3];assert.ok(process.argv[2]);assert.ok(['metal','software'].includes(profile))
const nativeBytes=await readFile(join(directory,'native.json')),native=JSON.parse(nativeBytes),closed=JSON.parse(await readFile(join(directory,'native-closed.json'))),pins=JSON.parse(await readFile(join(directory,'source-pins.json')))
assert.equal(hash(nativeBytes),closed.nativeSha256);assert.equal(native.status,'CAPTURED_VECTOR_ROTATE_NATIVE_PILOT');assert.equal(native.cases.length,22)
for(const[file,pin]of Object.entries(pins))assert.equal(hash(await readFile(join(root,file))),pin,'Native input drifted '+file)
for(const row of native.cases)for(const pin of[row.program,row.pixels,row.preStoreLow,row.preStoreHigh,row.preStoreHashes]){const bytes=await readFile(join(directory,pin.file));assert.equal(hash(bytes),pin.sha256);assert.equal(bytes.length,pin.bytes)}
for(const row of native.pixelControls){const bytes=await readFile(join(directory,row.file));assert.equal(hash(bytes),row.sha256)}
const namespace=process.argv[4]??'browser';assert.match(namespace,/^[a-z][a-z0-9-]*$/)
const destination=join(directory,namespace+'-'+profile),fixture=join(destination,'fixture'),runtime=join(destination,'runtime');await mkdir(destination);await mkdir(fixture)
const {provenance}=await captureRuntimeSnapshot({root,built:true,destination:runtime,label:'Vector Rotate pilot'})
await cp(join(root,'packages/blendlink/dist/vendor'),join(runtime,'vendor'),{recursive:true});provenance.snapshot.vendorFiles=[]
const vendor=async folder=>{for(const entry of await readdir(folder,{withFileTypes:true})){const file=join(folder,entry.name);if(entry.isDirectory())await vendor(file);else{const name=file.slice(runtime.length+1),sha256=hash(await readFile(file));assert.equal(hash(await readFile(join(root,'packages/blendlink/dist',name))),sha256);provenance.snapshot.vendorFiles.push({name,sha256})}}};await vendor(join(runtime,'vendor'))
provenance.fixturePins={};for(const name of['pilot-browser.js','index.html']){const bytes=await readFile(join(import.meta.dirname,name));provenance.fixturePins[name]=hash(bytes);await copyFile(join(import.meta.dirname,name),join(fixture,name))}
provenance.runnerSha256=hash(await readFile(import.meta.filename));provenance.nativeSha256=hash(nativeBytes)
provenance.rawArchiveSha256=hash(await readFile(join(import.meta.dirname,'raw-words.mjs')))
const server=await createServer({root:fixture,configFile:false,publicDir:false,logLevel:'warn',optimizeDeps:{noDiscovery:true},resolve:{dedupe:['three'],alias:{'@rotate-compositor':join(runtime,'tslSourceCompositor.js')}},server:{host:'127.0.0.1',port:0,watch:null,hmr:false,fs:{allow:[root,directory,await realpath(join(root,'node_modules'))]}}})
const report={status:'running',supportCredit:0,FinalCredit:0,profile,provenance,rows:[]};let browser,page
const save=()=>writeFile(join(destination,'report.json'),JSON.stringify(report,null,2)+'\n')
const persist=async(value,prefix)=>{
 const records=[...(value.orientation??[]).map((item,index)=>({item,label:'orientation-'+index})),...(value.rows??[]).flatMap(row=>row.samples.map(sample=>({item:sample,label:row.case+'-'+sample.frame}))),...(value.active?.words?[{item:value.active,label:'failure-active'}]:[])]
 await mkdir(join(destination,'raw'),{recursive:true})
 for(const{item,label}of records){const values=takeRawWords(item);if(!values)continue;const bytes=Buffer.alloc(values.length*4);values.forEach((word,index)=>bytes.writeUInt32LE(word,index*4));const file='raw/'+prefix+'-'+label+'.rgba32f';await writeFile(join(destination,file),bytes);item.rawFile=file;item.rawSha256=hash(bytes)}
}
try{
 await server.listen();browser=await chromium.launch({headless:true,...(profile==='metal'?{channel:'chromium'}:{}),args:['--enable-unsafe-webgpu','--enable-unsafe-swiftshader',...(profile==='software'?['--use-angle=swiftshader','--use-webgpu-adapter=swiftshader']:[])]});report.browserVersion=browser.version()
 for(const backend of['webgpu','webgl2']){
  const errors=[];page=await browser.newPage();page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text())})
  await page.goto(server.resolvedUrls.local[0]+'index.html?backend='+backend);await page.waitForFunction(()=>typeof window.runVectorRotatePilot==='function')
  const proof={cases:native.cases.map(row=>({...row,programUrl:'/@fs'+join(directory,row.program.file),pixelUrl:'/@fs'+join(directory,row.pixels.file)})),pixelControls:native.pixelControls.map(row=>({...row,url:'/@fs'+join(directory,row.file)}))}
  const result=await page.evaluate(proof=>window.runVectorRotatePilot(proof),proof);await persist(result,backend);report.rows.push({...result,pageErrors:errors});await save()
  assert.equal(result.status,'PASSED_RESEARCH_ONLY_VECTOR_ROTATE_BROWSER_PILOT');assert.equal(result.backend,backend);assert.equal(result.gpu.api,backend==='webgpu'?'WebGPU':'WebGL2');assert.deepEqual(result.rows.map(row=>row.case),native.cases.map(row=>row.case));assert.deepEqual(errors,[]);assert.deepEqual(result.errors,[])
  if(profile==='metal'){assert.match(JSON.stringify(result.gpu),/apple|metal/i);assert.doesNotMatch(JSON.stringify(result.gpu),/swiftshader/i)}else assert.match(JSON.stringify(result.gpu),/swiftshader/i)
  await page.close();page=undefined
 }
 report.status='PASSED_RESEARCH_ONLY_VECTOR_ROTATE_BUILT_PILOT';await save();console.log(report.status+' '+profile)
}catch(error){
 report.status='failed';report.error=String(error)
 try{const failure=await page?.evaluate(()=>window.vectorRotatePilotFailure??null);if(failure){await persist(failure,'failed');report.failure=failure}}catch(failureError){report.failureCaptureError=String(failureError)}
 throw error
}finally{await save();await browser?.close();await server.close()}
