/* SPDX-License-Identifier: MIT */
import assert from 'node:assert/strict'
import {cp,copyFile,mkdir,readdir,readFile,writeFile} from 'node:fs/promises'
import {resolve,join,relative} from 'node:path'
import {createServer} from 'vite'
import {chromium} from '@playwright/test'
import {captureRuntimeSnapshot,captureRuntimeProvenance,hash} from '../../../scripts/lib/runtime-provenance.mjs'
import {assertBuiltRuntimeArchive} from '../../../scripts/lib/runtime-proof-archive.mjs'
const root=resolve(import.meta.dirname,'../../..'),out=resolve(process.argv[2]);assert.ok(process.argv[2],'Fresh output namespace required');await mkdir(out)
const {provenance}=await captureRuntimeSnapshot({root,built:true,destination:join(out,'runtime'),label:'Owned rows partial allocation control'})
await cp(join(root,'packages/blendlink/dist/vendor'),join(out,'runtime/vendor'),{recursive:true});provenance.snapshot.vendorFiles=[]
async function inventory(folder){for(const entry of await readdir(folder,{withFileTypes:true})){const file=join(folder,entry.name);if(entry.isDirectory())await inventory(file);else provenance.snapshot.vendorFiles.push({name:relative(join(out,'runtime'),file),sha256:hash(await readFile(file))})}}
await inventory(join(out,'runtime/vendor'));await mkdir(join(out,'fixture'));provenance.fixturePins={}
for(const name of['browser.js','index.html']){const bytes=await readFile(join(import.meta.dirname,name));provenance.fixturePins[name]=hash(bytes);await copyFile(join(import.meta.dirname,name),join(out,'fixture',name))}
const server=await createServer({root:join(out,'fixture'),configFile:false,logLevel:'warn',optimizeDeps:{noDiscovery:true},resolve:{dedupe:['three'],alias:{'@rows':join(out,'runtime/tslCompositorRowTable.js')}},server:{host:'127.0.0.1',port:0,hmr:false,watch:null,fs:{allow:[root,out]}}})
const report={status:'running',supportCredit:0,provenance,rows:[]};let browser
const save=()=>writeFile(join(out,'report.json'),JSON.stringify(report,null,2)+'\n')
try{
 await server.listen()
 for(const profile of['metal','software']){
  browser=await chromium.launch({headless:true,args:['--enable-unsafe-webgpu','--enable-unsafe-swiftshader',...(profile==='software'?['--use-angle=swiftshader','--use-webgpu-adapter=swiftshader']:['--use-angle=metal'])]})
  for(const backend of['webgpu','webgl2']){
   const page=await browser.newPage(),errors=[]
   page.on('pageerror',error=>errors.push(String(error)));page.on('console',message=>{if(message.type()==='error')errors.push(message.text())})
   await page.goto(server.resolvedUrls.local[0]+'index.html?backend='+backend);await page.waitForFunction(()=>typeof window.rowUploadControl==='function')
   const result=await page.evaluate(()=>window.rowUploadControl()),edge=await page.evaluate(()=>window.rowCleanupEdgeControl());assert.equal(result.backend,backend);assert.deepEqual(errors,[]);assert.deepEqual(result.errors,[])
   assert.equal(result.gpu.api,backend==='webgpu'?'WebGPU':'WebGL2');if(profile==='metal'){assert.match(JSON.stringify(result.gpu),/apple|metal/i);assert.doesNotMatch(JSON.stringify(result.gpu),/swiftshader/i)}else assert.match(JSON.stringify(result.gpu),/swiftshader/i)
   assert.deepEqual(result.rows.map(row=>row.case),['none-dispose','none-retry','create-dispose','create-retry','upload-dispose','upload-retry','create-saved-dispose'])
   for(const row of result.rows){assert.equal(row.allocated,row.case==='create-retry'||row.case==='upload-retry'?2:1);assert.deepEqual(row.destroys,Array(row.allocated).fill(1))}
   assert.equal(edge.backend,backend);assert.deepEqual(edge.rows.map(row=>row.case),['observer-before-native-reset','observer-after-native-reset','borrowed-destructor-field','mutated-default-flag',...backend==='webgl2'?['late-partial-replaced-context']:[]]);for(const row of edge.rows){assert.equal(row.backend,backend);assert.equal(row.gpu.api,backend==='webgpu'?'WebGPU':'WebGL2');if(profile==='metal'){assert.match(JSON.stringify(row.gpu),/apple|metal/i);assert.doesNotMatch(JSON.stringify(row.gpu),/swiftshader/i)}else assert.match(JSON.stringify(row.gpu),/swiftshader/i);assert.equal(row.ownedDestroys,1);assert.equal(row.borrowedDestroys,0);assert.equal(row.replacementContextDeletes,0);assert.deepEqual(row.errors,[])}
   report.rows.push({profile,browserVersion:browser.version(),...result,edgeControls:edge.rows});await save();await page.close()
  }
  await browser.close();browser=undefined
 }
 const {provenance:current}=await captureRuntimeProvenance({root,built:true,label:'closed owned row partial control'})
 const runtimeFingerprint=await assertBuiltRuntimeArchive({root,current,provenance,runtimeDirectory:join(out,'runtime'),fixtureDirectory:join(out,'fixture'),fixtureSourceDirectory:import.meta.dirname,fixtureNames:['browser.js','index.html']})
 report.status='RESEARCH_CLOSED_ACTUAL_ROW_PARTIAL_ALLOCATION_CONTROLS';report.closedReader={runtimeFingerprint,runnerSha256:hash(await readFile(import.meta.filename))};report.actualCases=report.rows.reduce((n,row)=>n+row.rows.length+row.edgeControls.length,0);report.physicalHandles=report.rows.reduce((total,row)=>total+row.rows.reduce((n,control)=>n+control.allocated,0)+row.edgeControls.length,0)
 await save();console.log(report.status,report.actualCases,report.physicalHandles)
}catch(error){report.status='failed';report.error=String(error);await save();throw error}
finally{await browser?.close();await server.close()}
