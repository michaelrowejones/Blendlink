import assert from'node:assert/strict'
import{readFile,writeFile,mkdir,copyFile,realpath,readdir}from'node:fs/promises'
import{resolve,join,dirname}from'node:path'
import{pathToFileURL}from'node:url'
import{createRequire}from'node:module'
import{createHash}from'node:crypto'
import{validatePlan,workloads}from'./metrics.mjs'
import{loadChromium}from'./host-dependencies.mjs'
import{bindNativeReference}from'./native-binding.mjs'
import{createReadbackArchive}from'./readback-server.mjs'
const hash=b=>createHash('sha256').update(b).digest('hex'),here=import.meta.dirname
const[configFile,flag]=process.argv.slice(2)
assert.equal(flag,'--execute-browser','Browser work requires explicit Root lease; pass --execute-browser only after handoff')
const raw=await readFile(resolve(configFile)),config=JSON.parse(raw),planBytes=await readFile(join(here,'plan.json')),plan=validatePlan(JSON.parse(planBytes))
assert.ok(['metal','software'].includes(config.profile));assert.ok(typeof config.leaseId==='string'&&config.leaseId);workloads(plan,config.kinds,{shapes:config.shapes??plan.shapes,projection:config.projection})
for(const key of['projectRoot','adapterFile','moduleFile','oracleFile','nativeInputFile','oracleContractFile','nativeClosedReceiptFile','output'])assert.ok(typeof config[key]==='string'&&config[key].startsWith('/'),key+' must be absolute')
const project=await realpath(config.projectRoot),require=createRequire(join(project,'package.json')),{createServer}=await import(pathToFileURL(require.resolve('vite'))),chromium=loadChromium(require),three=await realpath(join(project,'node_modules/three')),out=resolve(config.output)
await mkdir(dirname(out),{recursive:true});await mkdir(out);const fixture=join(out,'fixture');await mkdir(fixture)
const report={schemaVersion:1,status:'running',profile:config.profile,leaseId:config.leaseId,planSha256:hash(planBytes),configurationSha256:hash(raw),rows:[],pins:{},supportCredit:0,nativeParityCredit:0}
async function pin(path){const canonical=await realpath(path);report.pins[canonical]=hash(await readFile(canonical))}
for(const file of['index.html','browser.js','metrics.mjs','gpu-timer.mjs']){await copyFile(join(here,file),join(fixture,file));await pin(join(here,file))}
for(const path of[resolve(configFile),join(here,'run.mjs'),join(here,'plan.json'),config.adapterFile,config.moduleFile,config.oracleFile,...(config.handFile?[config.handFile]:[]),...(config.sourceFiles??[]),...['package.json','LICENSE','build/three.core.js','build/three.webgpu.js','build/three.tsl.js','src/renderers/common/Renderer.js','src/renderers/common/Backend.js','src/renderers/webgl-fallback/utils/WebGLTimestampQueryPool.js'].map(p=>join(three,p))])await pin(path)
// Optional complete source directories prevent selectively pinning only a public entrypoint.
let files=0;async function pinTree(path){for(const entry of(await readdir(path,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){if(entry.isSymbolicLink())throw Error('Source tree symlink requires explicit sourceFiles pin');const child=join(path,entry.name);if(entry.isDirectory())await pinTree(child);else if(entry.isFile()){if(++files>20000)throw Error('Source census budget');await pin(child)}}}
for(const path of config.sourceDirectories??[])await pinTree(await realpath(path))
if(!config.handFile&&!config.productionFile)throw Error('Explicit actual hand builder/production namespace required')
for(const path of[config.productionFile,config.handParametersFile].filter(Boolean))await pin(path)
const handOptions=config.handParametersFile?JSON.parse(await readFile(config.handParametersFile)):config.handOptions??{},modeSourceSha256={'hand-tsl':report.pins[await realpath(config.handFile??config.productionFile)],'native-generated':report.pins[await realpath(config.moduleFile)]}
const nativeBinding=await bindNativeReference(config);report.nativeBinding=nativeBinding;for(const path of nativeBinding.files)await pin(path);await pin(join(here,'native-binding.mjs'));await pin(join(here,'host-dependencies.mjs'));await pin(join(here,'readback-server.mjs'));
const inputBytes=await readFile(config.nativeInputFile);assert.equal(inputBytes.length,1024);await pin(config.nativeInputFile);await pin(config.oracleContractFile);const inputWords=Array.from({length:256},(_,i)=>inputBytes.readUInt32LE(i*4)),oracleData={contract:JSON.parse(await readFile(config.oracleContractFile)),references:{}}
for(const kind of config.kinds){const path=config.referenceFiles?.[kind];assert.ok(path,'Independent native reference missing for '+kind);const bytes=await readFile(path);assert.equal(bytes.length,1024);await pin(path);oracleData.references[kind]={sha256:hash(bytes),words:Array.from({length:256},(_,i)=>bytes.readUInt32LE(i*4))}}
const module=JSON.parse(await readFile(config.moduleFile)),allow=[project,three,out,dirname(config.adapterFile),dirname(config.oracleFile),...(config.handFile?[dirname(config.handFile)]:[]),...(config.productionFile?[dirname(config.productionFile)]:[]),...(config.sourceDirectories??[])],readbackArchive=createReadbackArchive({directory:join(out,'readbacks'),scenarios:workloads(plan,config.kinds,{shapes:config.shapes??plan.shapes,projection:config.projection})}),server=await createServer({plugins:[{name:'owned-benchmark-readbacks',configureServer(s){s.middlewares.use(readbackArchive.middleware)}}],root:fixture,configFile:false,publicDir:false,logLevel:'warn',optimizeDeps:{noDiscovery:true},resolve:{alias:[{find:'three/webgpu',replacement:join(three,'build/three.webgpu.js')},{find:'three/tsl',replacement:join(three,'build/three.tsl.js')},{find:/^three$/,replacement:join(three,'build/three.module.js')}],dedupe:['three']},server:{host:'127.0.0.1',port:0,watch:null,hmr:false,fs:{allow}}})
let browser,leaseTimer;const save=()=>writeFile(join(out,'report.json'),JSON.stringify(report,null,2)+'\n')
try{
 await server.listen();browser=await chromium.launch({headless:true,...(config.profile==='metal'?{channel:'chromium'}:{}),args:['--enable-unsafe-webgpu','--enable-unsafe-swiftshader',...(config.profile==='metal'?['--use-angle=metal']:['--use-angle=swiftshader','--use-vulkan=swiftshader'])]});report.browserVersion=browser.version();const begin=performance.now();leaseTimer=setTimeout(()=>{report.leaseTimedOut=true;browser.close().catch(()=>{})},plan.maximumLeaseMs)
 for(const backend of['webgpu','webgl2']){readbackArchive.setBackend(backend)
  const page=await browser.newPage(),errors=[],httpErrors=[];page.on('response',r=>{if(r.status()>=400)httpErrors.push({url:r.url(),status:r.status()})});page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});page.setDefaultTimeout(plan.maximumLeaseMs);await page.goto(server.resolvedUrls.local[0]);await page.waitForFunction(()=>typeof window.portThroughputBenchmark==='function')
  const payload={backend,profile:config.profile,plan,kinds:config.kinds,shapes:config.shapes??plan.shapes,module,handOptions,modeSourceSha256,inputWords,oracleData,readbackUrl:readbackArchive.path,readbackToken:readbackArchive.token,projection:config.projection,adapterOptions:{...config.adapterOptions,handSourceSha256:modeSourceSha256['hand-tsl']},adapterUrl:'/@fs/'+config.adapterFile,oracleUrl:'/@fs/'+config.oracleFile,...(config.handFile?{handUrl:'/@fs/'+config.handFile}:{}),...(config.productionFile?{productionUrl:'/@fs/'+config.productionFile}:{})}
  let api
  try{api=await page.evaluate(p=>window.portThroughputBenchmark(p),payload)}catch(e){api=await page.evaluate(()=>window.portThroughputFailure);report.rows.push({...api,pageErrors:errors,httpErrors});await save();throw e}
  assert.equal(api.backend,backend);assert.equal(api.gpu.api,backend==='webgpu'?'WebGPU':'WebGL2');if(config.profile==='metal'){assert.match(JSON.stringify(api.gpu),/apple|metal/i);assert.doesNotMatch(JSON.stringify(api.gpu),/swiftshader/i)}else assert.match(JSON.stringify(api.gpu),/swiftshader/i)
  for(const[index,control]of api.inputControls.entries()){const bytes=Buffer.alloc(control.words.length*4);control.words.forEach((w,i)=>bytes.writeUInt32LE(w,i*4));const file=backend+'-input-control-'+index+'.u32';await writeFile(join(out,file),bytes,{flag:'wx'});control.wordArchive={file,bytes:bytes.length,sha256:hash(bytes)};delete control.words}
  for(const[rowIndex,row]of api.rows.entries())for(const[mode,sample]of Object.entries(row.modes)){
   readbackArchive.assertRecord(sample.fullFrameAccuracy.wordArchive);
   for(const field of['vertexShader','fragmentShader']){const bytes=Buffer.from(sample[field]),file=backend+'-'+rowIndex+'-'+mode+'-'+field+'.txt';await writeFile(join(out,file),bytes,{flag:'wx'});sample[field+'Archive']={file,bytes:bytes.length,sha256:hash(bytes)};delete sample[field]}
   for(const[phaseIndex,accuracy]of sample.accuracy.entries()){const bytes=Buffer.alloc(accuracy.words.length*4);accuracy.words.forEach((w,i)=>bytes.writeUInt32LE(w,i*4));const file=backend+'-'+rowIndex+'-'+mode+'-accuracy-'+phaseIndex+'.u32';await writeFile(join(out,file),bytes,{flag:'wx'});accuracy.wordArchive={file,bytes:bytes.length,sha256:hash(bytes)};delete accuracy.words}
  }
  report.rows.push({...api,pageErrors:errors,httpErrors});await save();assert.deepEqual(errors,[]);assert.deepEqual(httpErrors,[]);await page.close();if(performance.now()-begin>plan.maximumLeaseMs)throw Error('Combined API lease budget exceeded')
 }
 for(const[path,pin]of Object.entries(report.pins))assert.equal(hash(await readFile(path)),pin,'Input changed during capture')
 readbackArchive.assertComplete();report.status='BOUNDED_BENCHMARK_CAPTURE_COMPLETE'
}catch(error){report.status='FAILED_ZERO_CREDIT';report.error=String(error);throw error}
finally{clearTimeout(leaseTimer);await save();await browser?.close();await server.close()}
console.log(JSON.stringify({status:report.status,profile:report.profile,workloads:report.rows.reduce((s,r)=>s+r.rows.length,0),supportCredit:0}))
