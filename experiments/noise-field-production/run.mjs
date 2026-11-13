import assert from 'node:assert/strict'
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {resolve,join} from 'node:path'
import {createHash} from 'node:crypto'
import {chromium} from '@playwright/test'
import {createServer} from 'vite'
import {captureRuntimeSnapshot} from '../../scripts/lib/runtime-provenance.mjs'
import {freezeTslHarness} from '../../scripts/lib/frozen-tsl-harness.mjs'
const root=resolve(import.meta.dirname,'../..'),reference=resolve(process.argv[2]),evidence=resolve(process.argv[3])
const hash=data=>createHash('sha256').update(data).digest('hex')
const snapshot=join(evidence,'module-snapshot'),capture=await captureRuntimeSnapshot({root,built:true,destination:snapshot,label:'production-finite-noise-ownership'})
const harness=freezeTslHarness(root,snapshot),path=join(harness.directory,'main.js')
let source=readFileSync(path,'utf8')
source="import {installTslMaterials} from '@blendlink-tsl-materials'\nimport {vec4} from 'three/tsl'\n"+source
source+=`
window.__fieldSetup=async()=>{
 const old=state.mesh.material
 const material=new THREE.MeshStandardMaterial({color:0x336699});material.userData.blendlink_source_material='Paint'
 state.mesh.material=material;old.dispose();state.resources?.dispose();state.resources=null
 state.scene.add(new THREE.AmbientLight(0xffffff,1));state.callbackFrames=0
 state.originalCallback=()=>{state.callbackFrames++};state.mesh.onBeforeRender=state.originalCallback
 state.mesh.userData.blendlink_tsl_runtime={schemaVersion:1,uvChannels:{Proof:0},activeRenderUv:{schemaVersion:1,model:'source-active-render-v1',uvMap:'Proof',channel:0}}
 await state.renderer.compileAsync(state.scene,state.camera)
 await window.__fieldDraw()
}
window.__fieldDraw=async(timing)=>{
 if(timing)timing.drawStarted=performance.now()
 state.renderer.setRenderTarget(state.target)
 if(timing)timing.clearStarted=performance.now()
 await state.renderer.clearAsync()
 if(timing){timing.clearResolved=performance.now();timing.renderStarted=performance.now()}
 await state.renderer.renderAsync(state.scene,state.camera)
 if(timing)timing.renderResolved=performance.now()
 if(timing)timing.readbackStarted=performance.now()
 const data=await state.renderer.readRenderTargetPixelsAsync(state.target,0,0,state.target.width,state.target.height)
 if(timing)timing.readbackResolved=performance.now()
 state.renderer.setRenderTarget(null)
 if(timing)timing.encodingStarted=performance.now()
 const bytes=new Uint8Array(data.buffer,data.byteOffset,data.byteLength);let text=''
 for(let index=0;index<bytes.length;index+=0x8000)text+=String.fromCharCode(...bytes.subarray(index,index+0x8000))
 if(timing)timing.encodingResolved=performance.now()
 return{base64:btoa(text),environment:window.__tslDiffEnvironment()}
}
window.__fieldAttempt=async(path,abortAfter)=>{
 const timing={attemptStarted:performance.now()},response=await fetch(path)
 timing.fetchResolved=performance.now()
 const document=await response.json();timing.documentParsed=performance.now()
 const before=JSON.stringify(document),original=state.mesh.material,callback=state.mesh.onBeforeRender
 timing.sourceSnapshotResolved=performance.now()
 const controller=new AbortController(),longTasks=[],frames=[];let pending=true,trackCalls=0,releases=0,frameId=null,lastFrame=null
 const retain=entries=>longTasks.push(...entries.map(item=>({start:item.startTime,end:item.startTime+item.duration,duration:item.duration,name:item.name,
  receivedAt:performance.now(),attribution:Array.from(item.attribution||[],entry=>({name:entry.name,entryType:entry.entryType,start:entry.startTime,duration:entry.duration,
   containerType:entry.containerType,containerSrc:entry.containerSrc,containerName:entry.containerName,containerId:entry.containerId}))})))
 const observer=new PerformanceObserver(list=>retain(list.getEntries()))
 observer.observe({entryTypes:['longtask']})
 timing.observerStarted=performance.now()
 const animate=time=>{
  if(!pending)return
  if(state.mesh.material!==original)throw new Error('Material changed while preparation was pending')
  frames.push(lastFrame===null?0:time-lastFrame);lastFrame=time
  state.renderer.setRenderTarget(state.target);state.renderer.render(state.scene,state.camera);state.renderer.setRenderTarget(null)
  frameId=requestAnimationFrame(animate)
 }
 frameId=requestAnimationFrame(animate)
 const started=performance.now(),timer=abortAfter===null?null:setTimeout(()=>{timing.abortRequested=performance.now();controller.abort()},abortAfter)
 timing.installStarted=started
 try{
  const installed=await installTslMaterials({root:state.scene,descriptor:{materialPrograms:{url:path,bytes:1,hash:'test',materials:1}},signal:controller.signal,
   loadPrograms:async()=>({schemaVersion:1,model:'blendlink-material-programs-v1',materials:{Paint:{channels:{'Base Color':{tslIr:document}}}}}),
   trackMaterialClone:()=>{timing.materialCloneTracked=performance.now();trackCalls++;return()=>{releases++}}})
  timing.installResolved=performance.now()
  pending=false;cancelAnimationFrame(frameId)
  if(timer!==null)clearTimeout(timer)
  if(JSON.stringify(document)!==before)throw new Error('Installation changed source IR')
  timing.sourceValidated=performance.now()
  const material=state.mesh.material
  // Inspect the installed program directly, avoiding lighting/tone-map error
  // budgets in this lifecycle proof. Native numeric fidelity is separate.
  material.fragmentNode=vec4(material.colorNode,1)
  timing.fragmentOverridden=performance.now()
  state.fieldInstalled=installed;state.fieldReleases=()=>releases
  const rendered=await window.__fieldDraw(timing)
  timing.observerDrainStarted=performance.now();await new Promise(resolve=>setTimeout(resolve,0));retain(observer.takeRecords());timing.observerDrained=performance.now()
  return{ok:true,applied:installed.applied,skipped:installed.skipped,statistics:installed.noisePreparation,
   elapsedMs:performance.now()-started,preparationElapsedMs:timing.installResolved-started,coldDrawElapsedMs:timing.readbackResolved-timing.drawStarted,
   timing,frames:frames.length,maximumFrameGap:Math.max(...frames,0),longTasks,trackCalls,callbackFrames:state.callbackFrames,...rendered}
 }catch(error){
  pending=false;cancelAnimationFrame(frameId);if(timer!==null)clearTimeout(timer)
  timing.failed=performance.now();await new Promise(resolve=>setTimeout(resolve,0));retain(observer.takeRecords());timing.observerDrained=performance.now()
  return{ok:false,error:error.name+': '+error.message,stillOriginal:state.mesh.material===original,callbackPreserved:state.mesh.onBeforeRender===callback,
   elapsedMs:timing.failed-started,timing,longTasks,frames:frames.length,trackCalls,releases,environment:window.__tslDiffEnvironment()}
 }finally{observer.disconnect();timing.observerDisconnected=performance.now()}
}
window.__fieldRelease=()=>{state.fieldInstalled?.dispose();state.fieldInstalled?.dispose();state.fieldInstalled=null;return{releases:state.fieldReleases?.(),callbackPreserved:state.mesh.onBeforeRender===state.originalCallback}}
window.__fieldResize=size=>{state.target.setSize(size,size);state.renderer.setSize(size,size,false)}
`
writeFileSync(path,source)
const index=JSON.parse(readFileSync(join(reference,'index.json'))),cell=index.cases.find(cell=>cell.id.endsWith('-field-table-cap'))
assert.ok(cell,'Use actual native128px cap references')
const document=JSON.parse(readFileSync(join(reference,'ir',cell.id+'.json'))),changed=structuredClone(document)
const mutate=value=>{if(!value||typeof value!=='object')return;if(value.op==='tex_image'){
 for(let index=0;index<value.pixels.length;index+=4){const[a,b,c]=value.pixels.slice(index,index+3);value.pixels.splice(index,3,c,b,a)}
}else for(const child of Object.values(value))if(typeof child==='object')mutate(child)}
mutate(changed);mkdirSync(join(evidence,'ir'),{recursive:true})
for(const[name,value]of Object.entries({original:document,changed}))writeFileSync(join(evidence,'ir',name+'.json'),JSON.stringify(value))
const server=await createServer({configFile:false,root:harness.directory,cacheDir:join(evidence,'vite-cache'),logLevel:'warn',optimizeDeps:{noDiscovery:true},
 resolve:{dedupe:['three'],alias:{'@blendlink-tsl-recipe':join(snapshot,'tslNodeRecipe.js'),'@blendlink-tsl-materials':join(snapshot,'tslMaterialRuntime.js')}},
 server:{host:'127.0.0.1',port:0,watch:null,hmr:false,fs:{allow:[root,evidence]}}})
const rows=[],failures=[];let browser
const persist=()=>writeFileSync(join(evidence,'report.json'),JSON.stringify({provenance:capture.provenance,harnessSha256:hash(source),reference,
 referenceIndexSha256:hash(readFileSync(join(reference,'index.json'))),rows,failures},null,2))
const record=(backend,phase,result,context={})=>{
 const directory=join(evidence,'attempts');mkdirSync(directory,{recursive:true})
 const rawResultFile='attempts/'+String(rows.length).padStart(2,'0')+'-'+backend+'-'+phase+'.json'
 writeFileSync(join(evidence,rawResultFile),JSON.stringify(result,null,2))
 const{base64,...metadata}=result,row={backend,phase,...context,...metadata,rawResultFile,
  ...(base64?{pixelHash:hash(Buffer.from(base64,'base64'))}:{})}
 rows.push(row);persist();return row
}
try{
 await server.listen();browser=await chromium.launch({headless:true,args:['--enable-unsafe-webgpu','--enable-unsafe-swiftshader']})
 for(const backend of['webgpu','webgl2']){
  const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text())})
  try{
   await page.goto(server.resolvedUrls.local[0]+(backend==='webgl2'?'?backend=webgl2':''));const initialized=await page.evaluate(()=>window.__tslDiffInit());assert.equal(initialized.error,null)
   await page.evaluate(()=>window.__fieldSetup())
   const original=await page.evaluate(()=>window.__fieldDraw()),originalHash=hash(Buffer.from(original.base64,'base64'))
   const abortResult=await page.evaluate(path=>window.__fieldAttempt(path,15),'/@fs/'+join(evidence,'ir/original.json'))
   record(backend,'abort',abortResult)
   assert.equal(abortResult.ok,false);assert.match(abortResult.error,/AbortError/);assert.equal(abortResult.stillOriginal,true);assert.equal(abortResult.callbackPreserved,true);assert.equal(abortResult.trackCalls,0)
   assert.ok(abortResult.elapsedMs<150,'Cancellation did not stop cooperative preparation promptly')
   const afterAbort=await page.evaluate(()=>window.__fieldDraw());assert.equal(hash(Buffer.from(afterAbort.base64,'base64')),originalHash)
   const hashes=new Map()
   for(const name of['original','changed','original']){
    const result=await page.evaluate(path=>window.__fieldAttempt(path,null),'/@fs/'+join(evidence,'ir',name+'.json'))
    record(backend,'install',result,{source:name})
    assert.equal(result.ok,true,result.error);assert.equal(result.applied,1);assert.deepEqual(result.skipped,[])
    assert.equal(result.statistics.texels,16384);assert.equal(result.statistics.uniquePoints,16384)
    assert.ok(result.statistics.maximumSliceMilliseconds<16,'Preparation exceeded a frame CPU budget')
    assert.ok(result.frames>=5,'Animation frame observer did not witness responsive preparation');assert.ok(result.maximumFrameGap<75,'Preparation stalled animation frames')
    assert.deepEqual(result.longTasks,[],'Preparation generated a browser long task')
    const bytes=Buffer.from(result.base64,'base64'),values=new Float32Array(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));assert.ok(values.every(Number.isFinite))
    const pixelHash=hash(bytes);if(hashes.has(name))assert.equal(pixelHash,hashes.get(name));else hashes.set(name,pixelHash)
    if(name==='changed')assert.notEqual(pixelHash,hashes.get('original'))
    const release=await page.evaluate(()=>window.__fieldRelease());assert.equal(release.releases,1);assert.equal(release.callbackPreserved,true)
    const restored=await page.evaluate(()=>window.__fieldDraw());assert.equal(hash(Buffer.from(restored.base64,'base64')),originalHash)
    assert.equal(restored.environment.memory.textures,original.environment.memory.textures)
   }
   for(const size of[128,32,64]){
    await page.evaluate(size=>window.__fieldResize(size),size)
    const result=await page.evaluate(path=>window.__fieldAttempt(path,null),'/@fs/'+join(evidence,'ir/original.json'))
    record(backend,'resize',result,{size})
    assert.equal(result.ok,true,result.error);assert.deepEqual(result.skipped,[]);assert.equal(result.statistics.tables,1)
    assert.equal((await page.evaluate(()=>window.__fieldRelease())).releases,1)
   }
   assert.deepEqual(errors,[])
  }catch(error){failures.push({backend,error:String(error),errors});persist()}finally{await page.close()}
 }
}finally{await browser?.close();await server.close();persist()}
assert.deepEqual(failures,[]);console.log('BLENDLINK_PRODUCTION_FINITE_NOISE_OWNERSHIP_PASSED',rows.length)
