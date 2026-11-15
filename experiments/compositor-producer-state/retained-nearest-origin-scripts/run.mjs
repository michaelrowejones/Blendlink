/* SPDX-License-Identifier: MIT */
import assert from 'node:assert/strict'
import {cp,copyFile,mkdir,readdir,readFile,writeFile} from 'node:fs/promises'
import {resolve,join,basename,relative} from 'node:path'
import {createServer} from 'vite'
import {chromium} from '@playwright/test'
import {captureRuntimeSnapshot,hash} from '../../scripts/lib/runtime-provenance.mjs'
import {nativeInputs} from './inputs.mjs'
import {assertSources,assertFinal,assertNative,assertBaseline,assertComparison,statuses,browserProofContract} from './protocol.mjs'
const root=resolve(import.meta.dirname,'../..'),phase=process.argv[2],out=resolve(process.argv[3]),profile=process.argv[4]
assert.ok(['baseline','compare'].includes(phase));assert.ok(['metal','software'].includes(profile))
const json=async file=>JSON.parse(await readFile(file)),sources=assertSources(await json(join(out,'sources.json'))),rawFinal=await json(join(out,'final.json')),publication=assertFinal(rawFinal,sources,Object.fromEntries(rawFinal.provenance.map(row=>[row.source,row.sha256])))
const destination=join(out,'diagnostic-nearest-texel-'+profile),fixture=join(destination,'fixture'),generated=join(destination,'generated')
await mkdir(destination);await mkdir(fixture);await mkdir(generated)
const {provenance}=await captureRuntimeSnapshot({root,built:true,destination:join(destination,'runtime'),label:'Displace actual default Final',compilerInputs:true})
await cp(join(root,'packages/blendlink/dist/vendor'),join(destination,'runtime/vendor'),{recursive:true});provenance.snapshot.vendorFiles=[]
async function inventory(folder){for(const entry of await readdir(folder,{withFileTypes:true})){const file=join(folder,entry.name);if(entry.isDirectory())await inventory(file);else{const name=relative(join(destination,'runtime'),file),sha256=hash(await readFile(file));assert.equal(hash(await readFile(join(root,'packages/blendlink/dist',name))),sha256);provenance.snapshot.vendorFiles.push({name,sha256})}}}
await inventory(join(destination,'runtime/vendor'))
provenance.fixturePins={}
for(const name of['browser.js','browser-contract.mjs','same-frame.mjs','index.html']){const bytes=await readFile(join(import.meta.dirname,name));provenance.fixturePins[name]=hash(bytes);await copyFile(join(import.meta.dirname,name),join(fixture,name))}
provenance.runnerSha256=hash(await readFile(import.meta.filename));provenance.protocolSha256=hash(await readFile(join(import.meta.dirname,'protocol.mjs')))
provenance.finalSha256=hash(await readFile(join(out,'final.json')));provenance.sourcesSha256=hash(await readFile(join(out,'sources.json')))
provenance.generatedFiles=[]
provenance.retainedInputMode='ZERO_CREDIT_NATIVE_FINAL_REPLAY_WITH_NEW_SDK';provenance.currentPython=await nativeInputs(root)
const proofSources=[]
for(const row of publication.rows){
 for(const role of['manifest','glb','presentation','module'])assert.equal(hash(await readFile(row[role+'Path'])),row[role+'Sha256'])
 const name=basename(row.modulePath);await copyFile(row.modulePath,join(generated,name));provenance.generatedFiles.push({name,sha256:row.moduleSha256,source:row.modulePath})
 proofSources.push({...row,moduleUrl:'/@fs'+join(generated,name),presentationUrl:'/@fs'+row.presentationPath})
}
proofSources.splice(1);proofSources[0].frames=proofSources[0].frames.slice(0,1)
let references=[]
if(phase==='compare'){
 const native=assertNative(await json(join(out,'native.json')));provenance.nativeSha256=hash(await readFile(join(out,'native.json')));provenance.baselinesSha256=hash(await readFile(join(out,'baselines.json')))
 for(const row of native.rows){for(const role of['baseline','linear','display'])assert.equal(hash(await readFile(join(out,row[role+'File']))),row[role+'Sha256']);references.push({...row,baselineUrl:'/@fs'+join(out,row.baselineFile),linearUrl:'/@fs'+join(out,row.linearFile),displayUrl:'/@fs'+join(out,row.displayFile)})}
}
const server=await createServer({root:fixture,configFile:false,publicDir:join(out,'compiled/public'),logLevel:'warn',optimizeDeps:{noDiscovery:true},resolve:{dedupe:['three'],alias:Object.fromEntries([['@runtime','threeRuntime'],['@pipeline','threeWebgpuPostPipeline'],['@compositor','tslSourceCompositor']].map(([alias,name])=>[alias,join(destination,'runtime',name+'.js')]))},server:{host:'127.0.0.1',port:0,watch:null,hmr:false,fs:{allow:[root,out,'/tmp/scenetoweb-node-ports-next-union','/private/tmp/scenetoweb-node-ports-next-union']}}})
const report={status:'running',phase,profile,provenance,apis:[]};let browser
const save=()=>writeFile(join(destination,'report.json'),JSON.stringify(report,null,2)+'\n')
try{
 await server.listen();browser=await chromium.launch({headless:true,...(profile==='metal'?{channel:'chromium'}:{}),args:['--enable-unsafe-webgpu','--enable-unsafe-swiftshader',...(profile==='software'?['--use-angle=swiftshader','--use-webgpu-adapter=swiftshader']:['--use-angle=metal'])]});report.browserVersion=browser.version()
 for(const backend of['webgpu','webgl2']){
  const page=await browser.newPage(),pageErrors=[],httpErrors=[]
  page.on('pageerror',error=>pageErrors.push(String(error)));page.on('console',message=>{if(message.type()==='error')pageErrors.push(message.text())});page.on('response',response=>{if(response.status()>=400)httpErrors.push({url:response.url(),status:response.status()})})
  try{
   await page.goto(server.resolvedUrls.local[0]+'index.html?backend='+backend);await page.waitForFunction(()=>typeof window.runDisplaceProof==='function')
   const result=await page.evaluate(proof=>window.runDisplaceProof(proof),{phase,profile,sources:proofSources,references,assetBaseUrl:server.resolvedUrls.local[0]})
   if(result.status===statuses.failed){
    const folder=join(destination,'failed-readbacks');await mkdir(folder,{recursive:true})
    if(result.failureFrame)for(const buffer of result.failureFrame.buffers){const bytes=Buffer.from(new Uint32Array(buffer.words).buffer),file=join(folder,backend+'--'+result.failureFrame.id+'.'+buffer.role+'.rgba32f');await writeFile(file,bytes);Object.assign(buffer,{file:relative(destination,file),sha256:hash(bytes),wordCount:bytes.length/4});delete buffer.words}
    report.apis.push({...result,pageErrors,httpErrors});await save();continue
   }
   assert.equal(result.backend,backend)
   for(const row of result.rows){
    if(phase==='baseline'){
     const bytes=Buffer.from(new Uint32Array(row.baselinePixels).buffer),file=join(out,'frames',row.id+'.rgba32f');await mkdir(join(out,'frames'),{recursive:true});await writeFile(file,bytes)
     row.baselineFile=relative(out,file);row.baselineSha256=hash(bytes);delete row.baselinePixels
    }else{
     const roles=['direct',...Array.from({length:3},(_,cycle)=>['installed','repeated','display','repeatedDisplay'].map(role=>role+'-'+cycle)).flat()]
     assert.deepEqual(row.buffers.map(buffer=>buffer.role),roles)
     row.readbacks=[];const directory=join(destination,'readbacks');await mkdir(directory,{recursive:true})
     for(const buffer of row.buffers){const bytes=Buffer.from(new Uint32Array(buffer.words).buffer),file=join(directory,row.id+'.'+buffer.role+'.rgba32f');await writeFile(file,bytes);row.readbacks.push({role:buffer.role,file:relative(destination,file),sha256:hash(bytes),words:bytes.length/4})}
     delete row.buffers
    }
   }
   report.apis.push({...result,pageErrors,httpErrors});await save();assert.deepEqual(pageErrors,[]);assert.deepEqual(httpErrors,[])
  }finally{await page.close()}
 }
 report.status='DIAGNOSTIC_ONLY_ZERO_CREDIT';report.qualificationCredit=0
 await save();console.log(report.status,profile,report.apis.reduce((n,api)=>n+api.rows.length,0))
}catch(error){report.status='failed';report.error=String(error);await save();throw error}
finally{await browser?.close();await server.close()}
