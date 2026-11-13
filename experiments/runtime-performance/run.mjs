/** Actual production material/scene cost; no node numerical qualification. */
import assert from 'node:assert/strict'
import {cp,mkdir,readFile,readdir,realpath,writeFile} from 'node:fs/promises'
import {basename,dirname,join,resolve,extname,sep} from 'node:path'
import os from 'node:os'
import {execFileSync} from 'node:child_process'
import {performance} from 'node:perf_hooks'
import {createServer} from 'vite'
import {chromium} from '@playwright/test'
import sharp from 'sharp'
import {captureRuntimeSnapshot,hash} from '../../scripts/lib/runtime-provenance.mjs'
import {validateBenchmarkConfig} from './metrics.mjs'
import {linkedAssetRole,recordLinkedAsset} from './artifact-identity.mjs'

const root=resolve(import.meta.dirname,'../..'),args=process.argv.slice(2),options={}
for(let i=0;i<args.length;i++){
 const key=args[i];assert.ok(['--built','--glb','--materials','--manifest','--public-root','--output','--profile','--backend','--width','--height','--dpr','--warmup','--frames','--repeats','--gpu-samples','--animation','--variant','--case-id'].includes(key),'Unknown benchmark argument '+key)
 assert.ok(options[key]===undefined,'Duplicate '+key)
 if(key==='--built')options[key]=true;else {assert.ok(args[i+1]&&!args[i+1].startsWith('--'),'Missing '+key);options[key]=args[++i]}
}
assert.equal(options['--built'],true,'Benchmark the actual built runtime; build this isolated checkout first')
assert.ok(options['--output'],'Specify --output NEW_DIRECTORY')
const profile=options['--profile']??'metal',backend=options['--backend']??'both'
assert.ok(['metal','software'].includes(profile));assert.ok(['both','webgpu','webgl2'].includes(backend))
assert.ok(!options['--materials']||options['--glb'],'--materials requires the matching --glb')
assert.ok(!options['--manifest']||options['--glb'],'--manifest requires the matching --glb')
const config=validateBenchmarkConfig({width:Number(options['--width']??640),height:Number(options['--height']??360),dpr:Number(options['--dpr']??1),warmupFrames:Number(options['--warmup']??30),measuredFrames:Number(options['--frames']??90),repeats:Number(options['--repeats']??3),gpuSamples:Number(options['--gpu-samples']??30),animation:options['--animation']??'paused',fixedDeltaSeconds:1/60,
 camera:'authored-or-fit-static',antialias:false,variants:[],lighting:'authored manifest; otherwise imported lights or deterministic hemisphere+directional rig',gpuTimingPolicy:'separate-serial-query-pass-after-uninstrumented-RAF-window',loadPolicy:'fresh-page-HTTP-cache-disabled; OS/browser-driver-shader-cache-state-unknown'})
const micro=!options['--glb'],microProgram={schemaVersion:1,model:'blendlink-material-programs-v1',materials:{Benchmark:{channels:{'Base Color':{tslIr:{schemaVersion:1,model:'blendlink-tsl-ir-v1',output:{op:'separate',channel:'x',input:{op:'uv'}}}},Roughness:{tslIr:{schemaVersion:1,model:'blendlink-tsl-ir-v1',output:{op:'separate',channel:'y',input:{op:'uv'}}}}}}}}
const hasPrograms=micro||!!options['--materials']
config.variants=options['--variant']?[options['--variant']]:hasPrograms?['carrier','program']:['carrier']
assert.ok(config.variants.every(value=>['carrier','program'].includes(value)));assert.ok(hasPrograms||!config.variants.includes('program'),'No matching production programs; a stock control cannot become a program benchmark')
const evidence=resolve(options['--output']);await mkdir(dirname(evidence),{recursive:true});await mkdir(evidence)
const result={schemaVersion:1,kind:'blendlink-runtime-benchmark-v1',status:'running',correctnessQualification:false,performanceQualification:false,profile,config,comparisonIdentity:null,provenance:null,rows:[],errors:[]}
const save=()=>writeFile(join(evidence,'results.json'),JSON.stringify(result,null,2)+'\n')
await save()
let server,browser
const provenance={sourceCommit:null,artifacts:{},harness:{},runtime:null,browser:null,linkedAssets:[],three:{version:null,files:[]},limits:['Performance evidence only; source correctness requires a separate native conformance gate.','CPU submission is synchronous JS render/update cost. RAF is paced host cadence, never uncapped throughput.','First-frame and compile wall clocks do not imply GPU completion. Driver/OS shader caches are not reset.','GPU queries are measured in a separate serial pass. WebGPU uses pinned Three0.184 backend trackTimestamp seam; WebGL2 rejects disjoint/timeout samples.','Renderer.info counts describe tracked allocations, not total driver VRAM or total JS heap.']}
try{
 try{provenance.sourceCommit=execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'}).trim()}catch{}
 const artifact=async(role,path)=>{const actual=await realpath(resolve(path)),bytes=await readFile(actual);provenance.artifacts[role]={path:actual,bytes:bytes.length,sha256:hash(bytes)};return {actual,bytes}}
 let descriptor={name:options['--case-id']??(micro?'micro-production-uv':basename(options['--glb'],extname(options['--glb']))),nodes:{},url:'micro://production',hash:'',materialPrograms:null}
 let publicRoot=options['--public-root']?await realpath(resolve(options['--public-root'])):null
 if(!micro){
  const glb=await artifact('glb',options['--glb']);assert.equal(glb.bytes.subarray(0,4).toString(),'glTF','Not a binary glTF artifact')
  if(options['--manifest']){
   const manifest=await artifact('manifest',options['--manifest']);descriptor=JSON.parse(manifest.bytes)
   assert.equal(descriptor.generator,'blendlink');assert.equal(descriptor.hash,hash(glb.bytes).slice(0,16));assert.equal(descriptor.stats.bytes,glb.bytes.length)
   assert.ok(!Object.keys(descriptor.states??{}).length&&!Object.keys(descriptor.lightGroups??{}).length,'Baked state/light-group recipes need an explicit future benchmark loader; no silent omission')
   const suffix=descriptor.url.replace(/^\//,'').split('/').join(sep)
   if(!publicRoot&&glb.actual.endsWith(suffix))publicRoot=glb.actual.slice(0,-suffix.length)
  }
  descriptor={...descriptor,name:options['--case-id']??descriptor.name??basename(glb.actual,extname(glb.actual)),nodes:descriptor.nodes??{},url:'/@fs'+glb.actual,hash:hash(glb.bytes).slice(0,16)}
  if(options['--materials']){
   const programs=await artifact('materials',options['--materials']);const parsed=JSON.parse(programs.bytes)
   assert.equal(parsed.model,'blendlink-material-programs-v1');assert.ok(Object.keys(parsed.materials??{}).length>0,'Material program document is empty')
   if(options['--manifest']){assert.ok(descriptor.materialPrograms,'Manifest has no program pointer');assert.equal(descriptor.materialPrograms.bytes,programs.bytes.length);assert.equal(descriptor.materialPrograms.hash,hash(programs.bytes).slice(0,16))}
   descriptor.materialPrograms={url:'/@fs'+programs.actual,hash:hash(programs.bytes).slice(0,16),bytes:programs.bytes.length,materials:Object.keys(parsed.materials).length}
  }else if(descriptor.materialPrograms)throw new Error('Manifest declares programs: pass its actual matching --materials or choose a separate stock control GLB')
  if(!publicRoot){const marker=sep+'public'+sep,index=glb.actual.lastIndexOf(marker);publicRoot=index>=0?glb.actual.slice(0,index+marker.length-1):dirname(glb.actual)}
 }else{
  const bytes=Buffer.from(JSON.stringify(microProgram));provenance.artifacts.microProgram={bytes:bytes.length,sha256:hash(bytes),path:null}
  descriptor.materialPrograms={url:'micro://production-program',hash:hash(bytes).slice(0,16),bytes:bytes.length,materials:1}
 }
 const snapshot=join(evidence,'runtime'),captured=await captureRuntimeSnapshot({root,built:true,destination:snapshot,label:'runtime benchmark'});provenance.runtime=captured.provenance
 const vendor=join(root,'packages/blendlink/dist/vendor');try{await cp(vendor,join(snapshot,'vendor'),{recursive:true})}catch(error){if(error.code!=='ENOENT')throw error}
 const harness=join(evidence,'harness');await mkdir(harness)
 for(const name of ['browser.js','metrics.mjs','index.html']){const bytes=await readFile(join(import.meta.dirname,name));provenance.harness[name]=hash(bytes);await writeFile(join(harness,name),bytes)}
 provenance.harness['artifact-identity.mjs']=hash(await readFile(join(import.meta.dirname,'artifact-identity.mjs')))
 const threeRoot=await realpath(join(root,'node_modules/three'));provenance.three.version=JSON.parse(await readFile(join(threeRoot,'package.json'),'utf8')).version
 const hashTree=async(folder,prefix='')=>{for(const entry of(await readdir(folder,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){const path=join(folder,entry.name),name=prefix+entry.name;if(entry.isDirectory())await hashTree(path,name+'/');else if(/\.(js|wasm|json)$/.test(name))provenance.three.files.push({path:name,sha256:hash(await readFile(path))})}}
 await hashTree(threeRoot);const threeSourceDigest=hash(JSON.stringify(provenance.three.files))
 const cpuModel=[...new Set(os.cpus().map(cpu=>cpu.model))].sort().join('; ')||null
 const hostOpaqueId=hash([os.hostname(),process.platform,process.arch,cpuModel].join('\0'))
 const harnessDigest=hash(JSON.stringify({...provenance.harness,runner:hash(await readFile(new URL(import.meta.url)))}))
 const linkedAssets=new Map()
 const artifactIdentity=Object.fromEntries(Object.entries(provenance.artifacts).map(([key,value])=>[key,{bytes:value.bytes,sha256:value.sha256}]))
 result.comparisonIdentity={profile,platform:process.platform,architecture:process.arch,cpuModel,hostOpaqueId,browserVersion:null,threeVersion:provenance.three.version,threeSourceDigest,harnessDigest,artifactsDigest:hash(JSON.stringify(artifactIdentity)),config}
 server=await createServer({root:harness,configFile:false,publicDir:publicRoot??false,cacheDir:join(evidence,'vite-cache'),resolve:{dedupe:['three'],alias:{'@benchmark/runtime':join(snapshot,'threeRuntime.js'),'@benchmark/materials':join(snapshot,'tslMaterialRuntime.js'),'@benchmark/monitor':join(snapshot,'runtimePerformance.js')}},server:{host:'127.0.0.1',port:0,watch:null,hmr:false,fs:{allow:[root,evidence,...(publicRoot?[publicRoot]:[]),...Object.values(provenance.artifacts).filter(item=>item.path).map(item=>dirname(item.path))]}}})
 await server.listen();const origin=server.resolvedUrls.local[0]
 const browserArgs=JSON.parse(process.env.BLENDLINK_TEST_CHROMIUM_ARGS??(profile==='software'?'["--use-angle=swiftshader","--use-webgpu-adapter=swiftshader"]':'[]'))
 config.browserLaunch={headless:process.env.BLENDLINK_TEST_CHROMIUM_HEADED!=='1',requestedArgs:browserArgs,nodeVersion:process.versions.node,osRelease:os.release(),viteVersion:JSON.parse(await readFile(join(root,'node_modules/vite/package.json'),'utf8')).version,playwrightVersion:JSON.parse(await readFile(join(root,'node_modules/@playwright/test/package.json'),'utf8')).version}
 const channel=process.env.BLENDLINK_TEST_CHROMIUM_CHANNEL??(profile==='metal'?'chromium':undefined),headless=process.env.BLENDLINK_TEST_CHROMIUM_HEADED!=='1'
 config.browserLaunch.requestedChannel=channel??null
 browser=await chromium.launch({headless,...(channel?{channel}:{}),args:['--enable-unsafe-webgpu','--enable-unsafe-swiftshader',...browserArgs]})
 const cdp=await browser.newBrowserCDPSession();provenance.browser={version:browser.version(),headless,requestedChannel:channel??null,args:browserArgs,systemInfo:await cdp.send('SystemInfo.getInfo')};result.comparisonIdentity.browserVersion=browser.version()
 for(let repeat=0;repeat<config.repeats;repeat++)for(const api of backend==='both'?['webgpu','webgl2']:[backend])for(const variant of repeat%2?[...config.variants].reverse():config.variants){
  const page=await browser.newPage({viewport:{width:config.width,height:config.height},deviceScaleFactor:config.dpr}),errors=[],network=[]
  page.on('pageerror',error=>errors.push(error.message));page.on('console',entry=>{if(entry.type()==='error')errors.push(entry.text())});page.on('requestfailed',request=>errors.push('Request failed: '+request.url()+' '+request.failure()?.errorText))
  page.on('response',response=>{if(response.url().startsWith(origin))network.push(response)})
  await page.route('**/*',route=>{const url=new URL(route.request().url());return ['http:','https:'].includes(url.protocol)&&url.origin!==new URL(origin).origin?route.abort('blockedbyclient'):route.continue()})
  const session=await page.context().newCDPSession(page);await session.send('Network.enable');await session.send('Network.setCacheDisabled',{cacheDisabled:true})
  let currentRow
  try{
   const loadStart=performance.now();await page.goto(origin);await page.waitForFunction(()=>window.__benchmarkReady,null,{timeout:60000});const harnessModuleLoadMs=performance.now()-loadStart
   const rowDescriptor=structuredClone(descriptor);rowDescriptor.url=new URL(rowDescriptor.url,origin).href
   if(rowDescriptor.materialPrograms&&!micro)rowDescriptor.materialPrograms.url=new URL(rowDescriptor.materialPrograms.url,origin).href
   const request={caseId:options['--case-id']??descriptor.name,repeat,variant,backend:api,config,micro,microProgram,manifestMode:!!options['--manifest'],descriptor:rowDescriptor}
   const pending=page.evaluate(async request=>{try{return await window.runBenchmark(request)}finally{window.__benchmarkFinished=true}},request).then(value=>({value}),error=>({error:String(error)}))
   await page.waitForFunction(()=>window.__benchmarkCaptureReady||window.__benchmarkFinished,null,{timeout:120000})
   const name=[repeat,api,variant].join('-');let screenshot=null
   if(await page.evaluate(()=>!!window.__benchmarkCaptureReady)){
    try{const file=join(evidence,name+'.png');await page.locator('canvas').screenshot({path:file});const data=await readFile(file),stats=await sharp(data).stats();screenshot={file:basename(file),sha256:hash(data),nonUniform:stats.channels.slice(0,3).some(channel=>channel.stdev>.1),channelStats:stats.channels}}
    finally{await page.evaluate(()=>window.__benchmarkCaptureDone?.())}
   }
   const settled=await pending;assert.ok(settled.value,settled.error);const row=settled.value;currentRow=row
   row.phases.harnessModuleLoadMs=harnessModuleLoadMs;row.screenshot=screenshot;row.errors.push(...errors);row.scope=micro?'production-builder-micro':options['--manifest']?'published-manifest-scene':hasPrograms?'published-material-program-scene':'stock-geometry-control-no-port-coverage'
   result.rows.push(row);await save()
   for(const response of network){
    const type=response.headers()['content-type']??'';if(/javascript|text\/html|text\/css/.test(type)||new URL(response.url()).pathname.endsWith('.map'))continue
    const bytes=await response.body(),role=linkedAssetRole(response.url(),{artifacts:provenance.artifacts,publicRoot}),identity={bytes:bytes.length,sha256:hash(bytes)}
    recordLinkedAsset(linkedAssets,role,identity,role.startsWith('declared:')?provenance.artifacts[role.slice(9)]:null)
   }
   provenance.linkedAssets=[...linkedAssets.entries()].map(([role,identity])=>({role,...identity})).sort((a,b)=>a.role.localeCompare(b.role));result.comparisonIdentity.artifactsDigest=hash(JSON.stringify({declared:artifactIdentity,linked:provenance.linkedAssets}))
   assert.equal(row.status,'measured',row.error);assert.deepEqual(row.errors,[])
   if(micro)assert.equal(screenshot?.nonUniform,true,'Micro scene did not visibly render')
   const gpuText=JSON.stringify(row.gpu).toLowerCase();assert.match(gpuText,profile==='software'?/swiftshader/:/apple|metal/)
   if(profile==='metal')assert.doesNotMatch(gpuText,/swiftshader/)
  }catch(error){if(currentRow){currentRow.status='failed';currentRow.error=String(error.stack??error)}result.errors.push({repeat,backend:api,variant,error:String(error.stack??error)});await save();throw error}
  finally{await page.close()}
 }
 result.status='measured'
}catch(error){result.status='failed';result.error=String(error.stack??error);process.exitCode=1}
finally{await browser?.close();await server?.close();result.provenance=provenance;await save();await writeFile(join(evidence,'provenance.json'),JSON.stringify(provenance,null,2)+'\n')}
console.log('BLENDLINK_RUNTIME_BENCHMARK '+JSON.stringify({status:result.status,rows:result.rows.length,profile,report:join(evidence,'results.json'),correctnessQualification:false,error:result.error??null}))
