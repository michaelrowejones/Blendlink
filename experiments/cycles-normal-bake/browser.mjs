import assert from'node:assert/strict'
import{readFile,mkdir,writeFile,copyFile,cp,readdir}from'node:fs/promises'
import{resolve,join,basename}from'node:path'
import{createServer}from'vite'
import{chromium}from'@playwright/test'
import{captureRuntimeSnapshot,captureRuntimeProvenance,hash}from'../../scripts/lib/runtime-provenance.mjs'
import{assertBuiltRuntimeArchive}from'../../scripts/lib/runtime-proof-archive.mjs'
import{assertCarrierBrowserReport}from'./protocol.mjs'
import{assertCaptureManifest}from'./archive.mjs'
const root=resolve(import.meta.dirname,'../..'),destination=resolve(process.argv[2]),folders=process.argv.slice(3).map(value=>resolve(value))
assert.equal(folders.length,2);await mkdir(destination)
const{provenance}=await captureRuntimeSnapshot({root,built:true,destination:join(destination,'runtime'),label:'Actual Cycles normal carrier loading',compilerInputs:true})
const fixture=join(destination,'fixture');await mkdir(fixture)
provenance.fixturePins={}
for(const name of ['browser.js','index.html']){const bytes=await readFile(join(import.meta.dirname,name));provenance.fixturePins[name]=hash(bytes);await copyFile(join(import.meta.dirname,name),join(fixture,name))}
provenance.runnerSha256=hash(await readFile(import.meta.filename));provenance.protocolSha256=hash(await readFile(join(import.meta.dirname,'protocol.mjs')))
await cp(join(root,'packages/blendlink/dist/vendor'),join(destination,'runtime/vendor'),{recursive:true})
provenance.snapshot.vendorFiles=[]
async function vendors(directory){for(const row of await readdir(directory,{withFileTypes:true})){assert.equal(row.isSymbolicLink(),false);const path=join(directory,row.name);if(row.isDirectory())await vendors(path);else provenance.snapshot.vendorFiles.push({name:path.slice(join(destination,'runtime').length+1),sha256:hash(await readFile(path))})}}
await vendors(join(destination,'runtime/vendor'))
const sources=[]
for(const folder of folders){const capture=await assertCaptureManifest(folder),report=JSON.parse(await readFile(join(folder,capture.manifest.report.path)));assert.equal(report.status,'PASSED_OWNED_CUBE_NORMAL_BAKE_CARRIER');const glb=join(folder,'material.glb');const native=report.compilation.gltfEvidence[0].materialBake;sources.push({name:basename(folder),captureDirectory:folder,captureManifestSha256:capture.sha256,nativeReportSha256:capture.manifest.report.sha256,glbUrl:'/@fs'+glb,glbSha256:capture.manifest.glb.sha256,texCoord:native.normalBasis.texCoord,coat:report.normalChannels.includes('Coat Normal'),normalHashes:Object.fromEntries(report.rows.map(row=>[row.channel.includes('Coat Normal')?'Coat Normal':'Normal',row.sha256])),materialProgramSha256:capture.manifest.programs.sha256,materialPrograms:{url:'/@fs'+report.materialPrograms.path,hash:report.materialPrograms.hash,bytes:report.materialPrograms.bytes}})}
const server=await createServer({root:fixture,configFile:false,publicDir:false,logLevel:'warn',optimizeDeps:{noDiscovery:true},resolve:{dedupe:['three'],alias:{'@normal-carrier-runtime':join(destination,'runtime/tslMaterialRuntime.js')}},server:{host:'127.0.0.1',port:0,watch:null,hmr:false,fs:{allow:[root,destination,...folders]}}})
let browser;const report={scope:'Actual bake carrier loading only, no live-node numerical credit',sources,provenance,rows:[]}
try{
 await server.listen();browser=await chromium.launch({headless:true,channel:process.env.BLENDLINK_TEST_CHROMIUM_CHANNEL??'chromium',args:['--enable-unsafe-webgpu','--enable-unsafe-swiftshader',...JSON.parse(process.env.BLENDLINK_TEST_CHROMIUM_ARGS??'[]')]})
 for(const backend of['webgpu','webgl2']){const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text())});await page.goto(server.resolvedUrls.local[0]+'?backend='+backend);await page.waitForFunction(()=>typeof window.normalCarrierProof==='function')
  if(backend==='webgpu'){const bad=await page.evaluate(async proof=>{const gpu=navigator.gpu,prior=Object.getOwnPropertyDescriptor(gpu,'requestAdapter');Object.defineProperty(gpu,'requestAdapter',{value:async()=>null,configurable:true});try{await window.normalCarrierProof(proof);return{refused:false}}catch(error){return{refused:true,error:String(error)}}finally{if(prior)Object.defineProperty(gpu,'requestAdapter',prior);else delete gpu.requestAdapter}},{sources});assert.equal(bad.refused,true);assert.match(bad.error,/actual WebGPU adapter/);report.missingAdapter=bad}
  const row=await page.evaluate(proof=>window.normalCarrierProof(proof),{sources});assert.equal(row.backend,backend);assert.deepEqual(errors,[]);assert.deepEqual(row.errors,[]);if(process.env.BLENDLINK_TEST_PROFILE==='software')assert.match(JSON.stringify(row.gpu),/swiftshader/i);else{assert.match(JSON.stringify(row.gpu),/apple|metal/i);assert.doesNotMatch(JSON.stringify(row.gpu),/swiftshader/i)}report.rows.push(row);await page.close()
 }
 for(const source of sources)await assertCaptureManifest(source.captureDirectory,source.captureManifestSha256)
 const{provenance:current}=await captureRuntimeProvenance({root,built:true,compilerInputs:true,label:'Normal carrier fresh closing emission'})
 assert.deepEqual(current.compilerAttestation,provenance.compilerAttestation,'Compiler inputs changed during carrier proof')
 const runtimeFingerprint=await assertBuiltRuntimeArchive({root,current,provenance,runtimeDirectory:join(destination,'runtime'),fixtureDirectory:fixture,fixtureSourceDirectory:import.meta.dirname})
 assert.equal(provenance.runnerSha256,hash(await readFile(import.meta.filename)));assert.equal(provenance.protocolSha256,hash(await readFile(join(import.meta.dirname,'protocol.mjs'))))
 report.closure={independentlyEmittedAtClose:true,runtimeFingerprint,archiveHelperSha256:hash(await readFile(join(root,'scripts/lib/runtime-proof-archive.mjs')))}
 report.status='PASSED_CYCLES_NORMAL_CARRIER_BROWSER';assertCarrierBrowserReport(report);await writeFile(join(destination,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(report.status)
}catch(error){report.status='FAILED_CYCLES_NORMAL_CARRIER_BROWSER';report.error=String(error);await writeFile(join(destination,'report.json'),JSON.stringify(report,null,2)+'\n');throw error}finally{await browser?.close();await server.close()}
