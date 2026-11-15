import assert from'node:assert/strict'
import{readFile,realpath,writeFile}from'node:fs/promises'
import{resolve,join,dirname,basename}from'node:path'
import{pathToFileURL}from'node:url'
import{createHash}from'node:crypto'
import{bindNativeReference}from'./native-binding.mjs'
import{validatePlan,workloads,pairedOrder,performanceDecision,assertAccuracyRecord,assertComparable,verifyNative64Words,normalizeWords,distribution}from'./metrics.mjs'
const hash=b=>createHash('sha256').update(b).digest('hex'),[configArg,reportArg,outArg]=process.argv.slice(2)
if(!configArg||!reportArg||!outArg)throw Error('Usage: verify.mjs CONFIG REPORT FRESH_OUTPUT')
const configBytes=await readFile(resolve(configArg)),config=JSON.parse(configBytes),report=JSON.parse(await readFile(resolve(reportArg))),base=await realpath(dirname(resolve(reportArg))),planBytes=await readFile(new URL('./plan.json',import.meta.url)),plan=validatePlan(JSON.parse(planBytes)),expected=workloads(plan,config.kinds,{shapes:config.shapes??plan.shapes,projection:config.projection})
assert.equal(report.status,'BOUNDED_BENCHMARK_CAPTURE_COMPLETE');assert.equal(report.profile,config.profile);assert.equal(report.configurationSha256,hash(configBytes));assert.equal(report.planSha256,hash(planBytes));assert.equal(report.supportCredit,0);assert.equal(report.nativeParityCredit,0);assert.notEqual(report.leaseTimedOut,true)
for(const[path,pin]of Object.entries(report.pins))assert.equal(hash(await readFile(path)),pin,'Source drift')
for(const name of['browser.js','metrics.mjs','gpu-timer.mjs'])assert.equal(hash(await readFile(join(base,'fixture',name))),report.pins[await realpath(new URL(name,import.meta.url))],'Served fixture drift')
assert.deepEqual(await bindNativeReference(config),report.nativeBinding)
const oracle=await import(pathToFileURL(await realpath(config.oracleFile))),inputBytes=await readFile(config.nativeInputFile),inputWords=Array.from({length:256},(_,i)=>inputBytes.readUInt32LE(i*4)),oracleData={contract:JSON.parse(await readFile(config.oracleContractFile)),references:{}}
for(const kind of config.kinds){const bytes=await readFile(config.referenceFiles[kind]);oracleData.references[kind]={sha256:hash(bytes),words:Array.from({length:256},(_,i)=>bytes.readUInt32LE(i*4))}}
async function archived(record){assert.equal(basename(record.file),record.file);const path=await realpath(join(base,record.file));assert.equal(dirname(path),base);const bytes=await readFile(path);assert.equal(bytes.length,record.bytes);assert.equal(hash(bytes),record.sha256);return bytes}
const words=bytes=>Array.from({length:bytes.length/4},(_,i)=>bytes.readUInt32LE(i*4)),summary=[]
assert.deepEqual(report.rows.map(a=>a.backend),['webgpu','webgl2'])
for(const api of report.rows){
 assert.equal(api.status,'BOUNDED_BENCHMARK_CAPTURE_COMPLETE');assert.equal(api.gpu.api,api.backend==='webgpu'?'WebGPU':'WebGL2');assert.deepEqual(api.pageErrors,[]);assert.deepEqual(api.httpErrors,[]);assert.deepEqual(api.errors,[])
 if(config.profile==='metal'){assert.match(JSON.stringify(api.gpu),/apple|metal/i);assert.doesNotMatch(JSON.stringify(api.gpu),/swiftshader/i)}else assert.match(JSON.stringify(api.gpu),/swiftshader/i)
 assert.deepEqual(api.inputControls.map(c=>c.phase),plan.accuracyPhases);const rowFlip=api.inputControls[0].rowFlip;for(const control of api.inputControls){assert.deepEqual([control.width,control.height],[8,8]);assert.equal(control.rowFlip,rowFlip);verifyNative64Words(words(await archived(control.wordArchive)),inputWords,control.phase,control.rowFlip)}
 assert.deepEqual(api.rows.map(r=>r.id),expected.map(r=>r.id))
 for(const[index,row]of api.rows.entries()){
  assert.equal(row.status,'checked');for(const key of['id','kind','shape','projection','width','height'])assert.equal(row[key],expected[index][key]);assertComparable(row.modes['hand-tsl'].metadata,row.modes['native-generated'].metadata)
  for(const mode of plan.modes){
   const sample=row.modes[mode];for(const key of['nodeConstructionMs','sourceBuildMs','pipelineCompileAwaitMs','firstRenderCompletionMs','warmCompileAwaitMs'])assert.ok(Number.isFinite(sample[key])&&sample[key]>=0)
   const fragment=await archived(sample.fragmentShaderArchive);await archived(sample.vertexShaderArchive);assert.equal(fragment.length,sample.fragmentBytes);assert.ok(fragment.length<=plan.maximumFragmentBytes)
   assert.deepEqual(sample.accuracy.map(a=>a.phase),plan.accuracyPhases)
   for(const a of sample.accuracy){assert.equal(a.rowFlip,rowFlip);const raw=words(await archived(a.wordArchive));assert.equal(raw.length,plan.accuracyExtent[0]*plan.accuracyExtent[1]*4);const record=await oracle.checkAccuracy({mode,scenario:expected[index],phase:a.phase,words:normalizeWords(raw,...plan.accuracyExtent,a.rowFlip),width:plan.accuracyExtent[0],height:plan.accuracyExtent[1],metadata:sample.metadata,oracleData,coordinateContract:'native64-repeat-v1'});assertAccuracyRecord(record);assert.deepEqual(record,a.record);assert.ok(Object.values(report.pins).includes(record.independentSourceSha256),'Oracle source must be actually pinned')}
   const full=sample.fullFrameAccuracy;assert.equal(full.phase,17);assert.equal(full.rowFlip,rowFlip);assert.equal(full.wordArchive.file,'readbacks/'+api.backend+'-'+index+'-'+mode+'-full.u32');const fullPath=await realpath(join(base,full.wordArchive.file));assert.equal(dirname(fullPath),join(base,'readbacks'));const fullBytes=await readFile(fullPath);assert.equal(hash(fullBytes),full.wordArchive.sha256);assert.equal(fullBytes.length,row.width*row.height*16);assert.equal(full.wordArchive.bytes,fullBytes.length);const fullRecord=await oracle.checkAccuracy({mode,scenario:expected[index],phase:17,words:new Uint32Array(fullBytes.buffer,fullBytes.byteOffset,fullBytes.length/4),width:row.width,height:row.height,rowFlip,metadata:sample.metadata,oracleData,coordinateContract:'native64-repeat-v1'});assertAccuracyRecord(fullRecord);assert.deepEqual(fullRecord,full.record)
   if(config.profile==='software'){assert.deepEqual(sample.blocks,[]);assert.deepEqual(sample.gpuSamplesMs,[])}else{
    assert.equal(sample.blocks.length,plan.repetitions);const verified=[]
    for(const[r,b]of sample.blocks.entries()){assert.equal(b.repeat,r);assert.equal(b.orderIndex,pairedOrder(index,r).indexOf(mode));assert.equal(b.discardedWarmupFrames,plan.warmupFramesDiscardedPerBlock);assert.equal(b.cpuApiSubmissionMsPerFrame,b.cpuApiSubmissionMs/plan.framesPerSubmissionBatch);for(const k of['cpuApiSubmissionMs','completionDrainWallMs','readbackWallMs'])assert.ok(Number.isFinite(b[k])&&b[k]>=0);assert.ok(Number.isSafeInteger(b.readbackBytes)&&b.readbackBytes>=row.width*row.height*16);assert.equal(b.gpuSamples.length,plan.gpuQueriesPerBlock)
     for(const g of b.gpuSamples){if(g.gpuMs!==null){assert.equal(api.backend,'webgl2');assert.equal(api.gpuTimer.kind,'webgl2-disjoint-timer');assert.equal(g.verified,'actual-available-nondisjoint-query');assert.ok(Number.isFinite(g.gpuMs)&&g.gpuMs>0);assert.ok(Number.isFinite(g.consumptionReadbackWallMs)&&g.consumptionReadbackWallMs>=0);assert.ok(Number.isSafeInteger(g.consumedBytes)&&g.consumedBytes>=row.width*row.height*16);verified.push(g.gpuMs/plan.drawsPerGpuQuery)}else assert.ok(typeof g.reason==='string'&&g.reason)}
    }
    assert.deepEqual(verified,sample.gpuSamplesMs);assert.deepEqual(sample.cpuSubmission,distribution(sample.blocks.map(b=>b.cpuApiSubmissionMsPerFrame)));assert.deepEqual(sample.gpu,verified.length?distribution(verified):null)
   }
  }
  const decision=performanceDecision({profile:config.profile,accuracyPassed:true,handGpu:row.modes['hand-tsl'].gpuSamplesMs,nativeGpu:row.modes['native-generated'].gpuSamplesMs,plan});assert.deepEqual(decision,row.decision);summary.push({api:api.backend,workload:row.id,decision})
 }
}
await writeFile(resolve(outArg),JSON.stringify({status:'RECHECKED_BOUNDED_BENCHMARK_NOT_QUALIFICATION',reportSha256:hash(await readFile(resolve(reportArg))),summary,supportCredit:0,nativeParityCredit:0},null,2)+'\n',{flag:'wx'})
