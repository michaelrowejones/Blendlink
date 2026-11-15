import assert from'node:assert/strict'
import test from'node:test'
import{readFile,writeFile,mkdtemp,rm}from'node:fs/promises'
import{tmpdir}from'node:os'
import{join}from'node:path'
import{validatePlan,workloads,pairedOrder,distribution,performanceDecision,assertComparable,assertAccuracyRecord,verifyNative64Words,classifyNative64Words,normalizeWords}from'./metrics.mjs'
import{webglGpuSample,timerCapability}from'./gpu-timer.mjs'
import{measureStage,summarizeStages}from'./stages.mjs'
const plan=validatePlan(JSON.parse(await readFile(new URL('./plan.json',import.meta.url))))
test('declared workload bound and balanced paired order',()=>{
 assert.equal(plan.drawsPerGpuQuery,1);assert.equal(workloads(plan,['gradient-radial','checker']).length,4);assert.throws(()=>workloads(plan,plan.availableKinds));assert.throws(()=>workloads(plan,['missing']));assert.throws(()=>workloads(plan,['checker','checker']))
 for(let r=0;r<3;r++)assert.deepEqual(pairedOrder(0,r),pairedOrder(1,r).slice().reverse())
 assert.throws(()=>validatePlan({...plan,repetitions:1}));assert.throws(()=>validatePlan({...plan,maximumLeaseMs:120001}))
})
test('distributions retain tails; no performance winner without meaningful GPU evidence',()=>{
 assert.deepEqual(distribution([1,2,3]).n,3);assert.equal(distribution([1,2,100]).p95,100);assert.throws(()=>distribution([NaN]));assert.throws(()=>distribution([-1]))
 const decide=(over={})=>performanceDecision({profile:'metal',accuracyPassed:true,handGpu:Array(9).fill(1),nativeGpu:Array(9).fill(1.2),plan,...over})
 assert.equal(decide().status,'bounded-regression-signal');assert.equal(decide({nativeGpu:Array(9).fill(.8)}).status,'bounded-improvement-signal');assert.equal(decide({handGpu:[],nativeGpu:[]}).status,'insufficient-verified-gpu-timing');assert.equal(decide({profile:'software'}).status,'correctness-only-profile');assert.equal(decide({accuracyPassed:false}).status,'accuracy-failed-no-comparison');assert.equal(decide({nativeGpu:Array(9).fill(0)}).status,'invalid-gpu-timing')
})
test('same parameter/output/resource contracts and independent gate are mandatory',()=>{
 const a={kind:'checker',parameterContract:{scale:5},outputContract:'RGBA',resourceSignature:{samplers:0},kernelSourceSha256:'a'.repeat(64)};assertComparable(a,a)
 for(const k of['kind','parameterContract','outputContract','resourceSignature'])assert.throws(()=>assertComparable(a,{...a,[k]:'different'}))
 const gate={passed:true,contractId:'existing-unmodified',independentSourceSha256:'a'.repeat(64),comparedWords:2048,contractViolations:0};assertAccuracyRecord(gate);for(const mutation of[{passed:false},{contractViolations:1},{independentSourceSha256:''},{comparedWords:0}])assert.throws(()=>assertAccuracyRecord({...gate,...mutation}))
})
function fakeGl({disjoint=false,available=true,ns=8e6}={}){const gl={QUERY_RESULT_AVAILABLE:1,QUERY_RESULT:2,created:0,deleted:0,ended:0,createQuery(){this.created++;return{}},deleteQuery(){this.deleted++},beginQuery(){},endQuery(){this.ended++},getParameter(){return disjoint},getQueryParameter(_q,k){return k===1?available:ns}};return gl}
const ext={GPU_DISJOINT_EXT:4,TIME_ELAPSED_EXT:5}
test('only actual available nondisjoint query duration becomes GPU time',async()=>{
 const gl=fakeGl();const sample=await webglGpuSample(gl,ext,()=>{});assert.equal(sample.gpuMs,8);assert.equal(sample.verified,'actual-available-nondisjoint-query');assert.equal(gl.deleted,1)
 for(const config of[{disjoint:true},{ns:0},{ns:NaN}]){const g=fakeGl(config);assert.equal((await webglGpuSample(g,ext,()=>{})).gpuMs,null);assert.equal(g.deleted,1)}
 const g=fakeGl({available:false});let n=0;assert.equal((await webglGpuSample(g,ext,()=>{},{now:()=>++n,timeoutMs:2,delay:async()=>{}})).gpuMs,null);assert.equal(g.deleted,1)
 const bad=fakeGl();await assert.rejects(webglGpuSample(bad,ext,()=>{throw Error('draw failure')}));assert.equal(bad.deleted,1);assert.equal(bad.ended,1)
 assert.equal(timerCapability({backend:{device:{features:new Set(['timestamp-query'])}}}).kind,'unavailable')
})
test('stage recorder observes actual command intervals/failures and never commit-clock authoring time',async()=>{
 const root=await mkdtemp(join(tmpdir(),'port-stage-test-'))
 try{
  const common={method:'shared',trial:1,cwd:process.cwd(),budgetMs:2000,planSha256:'a'.repeat(64)}
  const good=await measureStage({...common,stage:'preflight',argv:[process.execPath,'-e','process.stdout.write("actual command")'],output:join(root,'one')});assert.equal(good.exitCode,0);assert.ok(good.elapsedMs>0);assert.equal(good.llmTimeMeasured,false);assert.ok(good.logs['stdout.log'].bytes>0)
  const bad=await measureStage({...common,stage:'validation',argv:[process.execPath,'-e','process.exit(3)'],output:join(root,'two')});assert.equal(bad.exitCode,3);assert.equal(summarizeStages([good,bad]).trials[0].allPassed,false);assert.deepEqual(summarizeStages([good]).trials[0].unobservedStages,['tooling','generation','adapter','validation']);assert.throws(()=>summarizeStages([good,good]));await assert.rejects(measureStage({...common,stage:'preflight',argv:[process.execPath],output:join(root,'one')}))
  const timeout=await measureStage({...common,trial:2,stage:'preflight',budgetMs:20,argv:[process.execPath,'-e','setTimeout(()=>{},10000)'],output:join(root,'three')});assert.equal(timeout.timedOut,true)
 }finally{await rm(root,{recursive:true,force:true})}
})

test('native64 integer phase permutation is bitwise exact and catches changing source floats',()=>{
 const source=Array.from({length:256},(_,i)=>0x3e800000+i)
 for(const phase of plan.accuracyPhases){const actual=Array.from({length:256},(_,i)=>source[((Math.floor(i/4)+phase)%64)*4+i%4]);assert.equal(classifyNative64Words(actual,source,phase).rowFlip,false);verifyNative64Words(normalizeWords(actual,8,8,true),source,phase,true);actual[0]^=1;assert.throws(()=>verifyNative64Words(actual,source,phase,false))}
})

test('native64 oracle independently enforces BOTH numeric gates and scalar alpha',async()=>{
 const {checkAccuracy}=await import('./native64-oracle.mjs'),contract=JSON.parse(await readFile(new URL('./oracle-contract.json',import.meta.url))),source=Array(256).fill(0x3e800000)
 const args={scenario:{kind:'noise-fbm3-default',projection:'rgba'},phase:0,words:source.slice(),width:8,height:8,oracleData:{contract,references:{'noise-fbm3-default':{sha256:'a'.repeat(64),words:source.slice()}}}}
 assert.equal(checkAccuracy(args).passed,true)
 const ulpOnly=structuredClone(args);ulpOnly.words[0]+=9;const u=checkAccuracy(ulpOnly);assert.equal(u.passed,false);assert.ok(u.maxAbsoluteError<2**-20);assert.equal(u.maxUlps,9)
 const absOnly=structuredClone(args);absOnly.oracleData.references['noise-fbm3-default'].words[0]=0x41800000;absOnly.words[0]=0x41800001;const a=checkAccuracy(absOnly);assert.equal(a.passed,false);assert.equal(a.maxUlps,1);assert.ok(a.maxAbsoluteError>2**-20)
 const scalar=structuredClone(args);scalar.scenario.projection='scalar';for(let p=0;p<64;p++)scalar.words[p*4+3]=0x3f800000;assert.equal(checkAccuracy(scalar).passed,true);scalar.words[3]++;assert.equal(checkAccuracy(scalar).passed,false)
 assert.throws(()=>checkAccuracy({...args,phase:1}));assert.throws(()=>checkAccuracy({...args,oracleData:{}}))
})

test('native authority binding rejects missing authority, changed source and kind substitutions',async()=>{
 const {bindNativeReference}=await import('./native-binding.mjs'),{createHash}=await import('node:crypto'),hash=b=>createHash('sha256').update(b).digest('hex'),dir=await mkdtemp(join(tmpdir(),'native-binding-synthetic-'))
 try{
  const b=Buffer.alloc(1024);await writeFile(join(dir,'input.bin'),b);await writeFile(join(dir,'noise.bin'),b);await writeFile(join(dir,'shader.glsl'),'synthetic-schema-only')
  const report={status:'CAPTURED_NATIVE_PRE_NAGA_KERNEL_F32',model:'Blender53-PythonGPU-original-lowered-GLSL-Metal-RGBA32F-v1',originalBodiesChanged:false,calibration:{wordMismatches:0,cases:5},backend:{backend:'METAL'},runs:['input','noise-fbm3-default'].map((name,i)=>({case:name,rawFile:i?'noise.bin':'input.bin',rawSha256:hash(b),shaderFile:'shader.glsl',shaderSha256:hash('synthetic-schema-only'),words:256}))},r=Buffer.from(JSON.stringify(report));await writeFile(join(dir,'report.json'),r)
  const closed=Buffer.from(JSON.stringify({status:'CLOSED_NATIVE_REFERENCE_RESEARCH',nativeBackend:'METAL',nativeVersion:[5,3,0],nativeBuild:'02f0899d78e3',consumedTargetCompilerOutput:false,remainingBodyTokensUnchanged:true,calibration:{wordMismatches:0},reports:{direct:{path:join(dir,'report.json'),sha256:hash(r)}}}));await writeFile(join(dir,'closed.json'),closed)
  const config={nativeClosedReceiptFile:join(dir,'closed.json'),nativeClosedReceiptSha256:hash(closed),nativeInputFile:join(dir,'input.bin'),kinds:['noise-fbm3-default'],referenceFiles:{'noise-fbm3-default':join(dir,'noise.bin')}}
  assert.equal((await bindNativeReference(config)).closedSha256,hash(closed));await assert.rejects(bindNativeReference({...config,nativeClosedReceiptSha256:'a'.repeat(64)}));await assert.rejects(bindNativeReference({...config,referenceFiles:{'noise-fbm3-default':join(dir,'input.bin')}}))
  b[0]=1;await writeFile(join(dir,'noise.bin'),b);await assert.rejects(bindNativeReference(config))
 }finally{await rm(dir,{recursive:true,force:true})}
})
test('full-frame binary archive is exclusive, API-owned, bounded and hash checked',async()=>{
 const {createReadbackArchive}=await import('./readback-server.mjs'),{createServer}=await import('node:http'),{createHash}=await import('node:crypto'),dir=await mkdtemp(join(tmpdir(),'benchmark-readback-')),archive=createReadbackArchive({directory:join(dir,'readbacks'),scenarios:[{width:8,height:8}]}),server=createServer((req,res)=>archive.middleware(req,res,()=>{res.statusCode=404;res.end()}));await new Promise(r=>server.listen(0,'127.0.0.1',r))
 try{
  const bytes=Buffer.alloc(1024),sha=createHash('sha256').update(bytes).digest('hex'),post=(file,body=bytes,token=archive.token)=>fetch('http://127.0.0.1:'+server.address().port+archive.path+'?file='+file,{method:'POST',headers:{'x-benchmark-token':token,'x-benchmark-sha256':sha},body})
  for(const backend of['webgpu','webgl2']){archive.setBackend(backend);for(const mode of['hand-tsl','native-generated']){const file=backend+'-0-'+mode+'-full.u32';assert.equal((await post(file,bytes,'wrong')).status,400);assert.equal((await post(file,bytes.subarray(0,1020))).status,400);const response=await post(file);assert.equal(response.status,200);archive.assertRecord(await response.json());assert.equal((await post(file)).status,400)}}archive.assertComplete()
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true})}
})

test('host uses the actual CommonJS Playwright export condition',async()=>{
 const {loadChromium}=await import('./host-dependencies.mjs'),chromium={launch(){}}
 assert.equal(loadChromium(id=>{assert.equal(id,'@playwright/test');return{chromium}}),chromium)
 assert.throws(()=>loadChromium(()=>({default:{chromium}})))
})

test('owned benchmark page declares a non-network favicon',async()=>{
 assert.match(await readFile(new URL('./index.html',import.meta.url),'utf8'),/<link rel="icon" href="data:,">/)
})
