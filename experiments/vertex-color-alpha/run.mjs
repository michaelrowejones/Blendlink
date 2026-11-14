import assert from'node:assert/strict'
import{cp,copyFile,mkdir,readdir,readFile,writeFile}from'node:fs/promises'
import{resolve,join}from'node:path'
import{createServer}from'vite'
import{chromium}from'@playwright/test'
import{captureRuntimeSnapshot,hash}from'../../scripts/lib/runtime-provenance.mjs'
import{assertQualification,assertFinal,browserProofContract}from'./protocol.mjs'
const root=resolve(import.meta.dirname,'../..'),directory=resolve(process.argv[2]),phase=process.argv.includes('--final')?'final':'raw',profile=process.env.BLENDLINK_TEST_PROFILE??'software',built=true
const diagnostic=process.argv.find(arg=>arg.startsWith('--diagnostic='))?.slice('--diagnostic='.length)
if(diagnostic!==undefined)assert.match(diagnostic,/^[a-z][a-z0-9-]{0,31}$/,'Diagnostic runs require a bounded output identifier')
const materialIDs=process.argv.includes('--material-ids')
assert.ok(!materialIDs||diagnostic,'Material ID controls are diagnostic-only, never qualification inputs')
assert.ok(['metal','software'].includes(profile))
const native=assertQualification(JSON.parse(await readFile(join(directory,'qualification.json')))),nativePin=hash(await readFile(join(directory,'qualification.json')))
for(const[path,pin]of Object.entries(native.sourceHashes))assert.equal(hash(await readFile(join(root,path))),pin,'Native input changed: '+path)
const published=phase==='final'?assertFinal(JSON.parse(await readFile(join(directory,'final-proof.json'))),native):null
const cases=[]
for(const source of native.cases){
 const actual=published?.rows.find(row=>row.case===source.case)
 const glbPath=actual?.glbPath??join(directory,source.rawGlbFile),glbSha256=actual?.glbSha256??source.rawGlbSha256
 const materialPath=actual?.materialPath??join(directory,source.rawProgramFile),materialSha256=actual?.materialSha256??source.rawProgramSha256
 assert.equal(hash(await readFile(glbPath)),glbSha256);assert.equal(hash(await readFile(materialPath)),materialSha256)
 assert.equal(hash(await readFile(join(directory,source.sourceFile))),source.sourceSha256)
 if(actual)assert.equal(hash(await readFile(actual.manifestPath)),actual.manifestSha256)
 const frames=[]
 for(const frame of source.frames){assert.equal(hash(await readFile(join(directory,frame.pixelFile))),frame.pixelSha256);frames.push({...frame,pixelUrl:'/@fs'+join(directory,frame.pixelFile)})}
 cases.push({...source,frames,glbUrl:'/@fs'+glbPath,glbSha256,materialUrl:'/@fs'+materialPath,materialSha256})
}
const output=join(directory,(diagnostic?'diagnostic-'+diagnostic+'-':'browser-')+phase+'-'+profile),fixture=join(output,'fixture');await mkdir(output);await mkdir(fixture)
const{provenance}=await captureRuntimeSnapshot({root,built,destination:join(output,'runtime'),label:'Vertex Color Alpha field'})
provenance.nativeQualificationSha256=nativePin
if(published)provenance.finalProofSha256=hash(await readFile(join(directory,'final-proof.json')))
await cp(join(root,'packages/blendlink/dist/vendor'),join(output,'runtime/vendor'),{recursive:true})
provenance.snapshot.vendorFiles=[]
const inventory=async path=>{for(const entry of await readdir(path,{withFileTypes:true})){
 const file=join(path,entry.name);if(entry.isDirectory())await inventory(file)
 else{const name=file.slice(join(output,'runtime').length+1),sha256=hash(await readFile(file));assert.equal(hash(await readFile(join(root,'packages/blendlink/dist',name))),sha256);provenance.snapshot.vendorFiles.push({name,sha256})}
}};await inventory(join(output,'runtime/vendor'))
provenance.fixturePins={}
for(const name of['browser.js','index.html']){const bytes=await readFile(join(import.meta.dirname,name));provenance.fixturePins[name]=hash(bytes);await copyFile(join(import.meta.dirname,name),join(fixture,name))}
provenance.runnerSha256=hash(await readFile(new URL(import.meta.url)));provenance.protocolSha256=hash(await readFile(join(import.meta.dirname,'protocol.mjs')))
if(materialIDs)provenance.diagnosticProbe={file:'experiments/vertex-color-alpha/material-id-browser.js',sha256:hash(await readFile(join(import.meta.dirname,'material-id-browser.js')))}
const server=await createServer({root:fixture,configFile:false,publicDir:false,logLevel:'warn',optimizeDeps:{noDiscovery:true},
 resolve:{dedupe:['three'],alias:{'@alpha-materials':join(output,'runtime/tslMaterialRuntime.js'),'@alpha-field':join(output,'runtime/tslVertexColorAlpha.js')}},
 server:{host:'127.0.0.1',port:0,watch:null,hmr:false,fs:{allow:[root,directory]}}})
const report={status:diagnostic?'DIAGNOSTIC_ONLY_NOT_QUALIFIED':'running',built,phase,profile,provenance,rows:[],...(diagnostic?{diagnostic,numericalCredit:0}:{})};let browser
const save=()=>writeFile(join(output,'report.json'),JSON.stringify(report,null,2)+'\n')
try{
 await server.listen();browser=await chromium.launch({headless:true,...(process.env.BLENDLINK_TEST_CHROMIUM_CHANNEL?{channel:process.env.BLENDLINK_TEST_CHROMIUM_CHANNEL}:{}),
  args:['--enable-unsafe-webgpu','--enable-unsafe-swiftshader',...JSON.parse(process.env.BLENDLINK_TEST_CHROMIUM_ARGS??'[]')]})
 report.browserVersion=browser.version()
 for(const backend of['webgpu','webgl2']){
  const page=await browser.newPage(),errors=[],httpErrors=[];page.on('pageerror',error=>errors.push({kind:'pageerror',message:error.message}));page.on('console',message=>{if(message.type()==='error')errors.push({kind:'console',message:message.text(),location:message.location()})});page.on('response',response=>{if(response.status()>=400)httpErrors.push({url:response.url(),status:response.status()})})
  try{
   await page.goto(server.resolvedUrls.local[0]+'index.html?backend='+backend)
   await page.waitForFunction(()=>typeof window.runVertexAlphaProof==='function')
   const result=await page.evaluate(proof=>window.runVertexAlphaProof(proof),{cases,phase,...(materialIDs?{diagnostic,materialIdModuleUrl:'/@fs'+join(import.meta.dirname,'material-id-browser.js')}:{})})
   // Retain complete numerical rows even if a later host/HTTP check refuses.
   report.rows.push({...result,pageErrors:errors,httpErrors});await save();assert.deepEqual(errors,[]);assert.deepEqual(httpErrors,[]);assert.equal(result.backend,backend)
  }finally{await page.close()}
 }
 if(!diagnostic)report.status=browserProofContract.browserStatus
 await save()
 console.log((diagnostic?'SCENETOWEB_VERTEX_ALPHA_DIAGNOSTIC_COMPLETE':'SCENETOWEB_VERTEX_ALPHA_BROWSER_PASSED')+' '+JSON.stringify({phase,profile,apis:report.rows.map(row=>row.backend)}))
}catch(error){report.status='failed';report.error=String(error);throw error}finally{await save();await browser?.close();await server.close()}
