// Experiment-only capture/runner. Never grants SDK/Final/node support credit.
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {mkdir,readFile,writeFile,readdir,copyFile,realpath} from 'node:fs/promises'
import {resolve,join,relative} from 'node:path'
import {createServer} from 'vite'
import {chromium} from '@playwright/test'
import {createNodePortBlenderLauncher} from '../../scripts/lib/node-port-python.mjs'
import {archiveNativeLauncher,validateNativeArchive} from '../../scripts/lib/native-proof-archive.mjs'
import {captureRuntimeSnapshot,hash} from '../../scripts/lib/runtime-provenance.mjs'
const root=resolve(import.meta.dirname,'../..'),mode=process.argv[2],native=resolve(process.argv[3]),directory=resolve(process.argv[4]??native)
const script=join(import.meta.dirname,'prototype_reference.py'),read=async file=>JSON.parse(await readFile(file,'utf8')),pin=async(file,wanted)=>assert.equal(hash(await readFile(file)),wanted,'Changed proof source '+file)
const sourcePaths=['prototype_reference.py','prototype.mjs','sources.json'].map(name=>join(import.meta.dirname,name))
for(const sub of ['packages/blendlink/blender','packages/blender-addon'])for(const name of await readdir(join(root,sub)))if(name.endsWith('.py')||sub==='packages/blender-addon'&&name.endsWith('.json'))sourcePaths.push(join(root,sub,name))
sourcePaths.push(join(root,'packages/blender-addon/tests/compositor_reference.py'),join(root,'experiments/compositor-white-noise/hash_reference.py'))
if(mode==='capture'){
 await mkdir(resolve(native,'..'),{recursive:true});await mkdir(native)
 const pins=Object.fromEntries(await Promise.all(sourcePaths.map(async path=>[relative(root,path),hash(await readFile(path))])))
 const launcher=await createNodePortBlenderLauncher({blender:process.env.BLENDLINK_BLENDER??'/Applications/Blender.app/Contents/MacOS/Blender',directory:join(native,'active'),timeoutMs:120000})
 let archived=false
 try{
  let output='';const code=await new Promise((done,reject)=>{const child=spawn(launcher.executable,['--background','--factory-startup','-t','1','--python-exit-code','1','--python',script],{cwd:root,env:{...process.env,SCENETOWEB_WHITE_NOISE_FIELD_RESEARCH:native}});child.stdout.on('data',bytes=>output+=bytes);child.stderr.on('data',bytes=>output+=bytes);child.once('error',reject);child.once('close',done)})
  await writeFile(join(native,'native.log'),output);assert.equal(code,0,'Native prototype failed: '+output.slice(-3000))
  const report=await read(join(native,'report.json'));assert.equal(report.status,'RESEARCH_ONLY_AXIS_TABLE_NATIVE_INPUTS');assert.equal(report.nativeRenders,48);assert.equal(report.exactWordDifferences,0)
  for(const [path,sha]of Object.entries(pins))await pin(join(root,path),sha)
  await launcher.finalize();const record={identity:launcher.identity,proof:await archiveNativeLauncher(launcher,native,true)};archived=true
  await writeFile(join(native,'native-python-proof.json'),JSON.stringify(record,null,2)+'\n')
  const archive=await validateNativeArchive(record,native,{expectedFinalSources:[],expectedScripts:[{path:script,invocations:1}],helperInputs:{helper:join(root,'scripts/lib/node-port-python.mjs'),bridge:join(root,'scripts/node-port-blender.mjs')}})
  await writeFile(join(native,'capture.json'),JSON.stringify({status:'EXPERIMENT_ONLY_AXIS_TABLE_NATIVE_CAPTURE',portCredit:0,sourceHashes:pins,reportSha256:hash(await readFile(join(native,'report.json'))),nativeArchive:archive},null,2)+'\n')
  console.log(JSON.stringify({status:report.status,renders:report.nativeRenders,words:report.primaryFloat32Words,portCredit:0}))
 }finally{try{if(!archived)await writeFile(join(native,'failed-native-python-proof.json'),JSON.stringify({identity:launcher.identity,proof:await archiveNativeLauncher(launcher,native,false)},null,2)+'\n')}finally{await launcher.dispose()}}
}else if(mode==='browser'){
 const capture=await read(join(native,'capture.json')),report=await read(join(native,'report.json'))
 assert.equal(capture.status,'EXPERIMENT_ONLY_AXIS_TABLE_NATIVE_CAPTURE');assert.equal(capture.portCredit,0);await pin(join(native,'report.json'),capture.reportSha256)
 for(const [path,sha]of Object.entries(capture.sourceHashes))await pin(join(root,path),sha)
 await validateNativeArchive(await read(join(native,'native-python-proof.json')),native,{expectedFinalSources:[],expectedScripts:[{path:script,invocations:1}],helperInputs:{helper:join(root,'scripts/lib/node-port-python.mjs'),bridge:join(root,'scripts/node-port-blender.mjs')}})
 assert.equal(report.rows.length,48);assert.equal(new Set(report.rows.map(row=>row.case)).size,48)
 const rows=[];for(const row of report.rows){await pin(join(native,row.pixelFile),row.pixelSha256);rows.push({...row,pixelUrl:'/@fs'+join(native,row.pixelFile)})}
 await mkdir(resolve(directory,'..'),{recursive:true});await mkdir(directory)
 const fixture=join(directory,'fixture');await mkdir(fixture)
 const provenance=(await captureRuntimeSnapshot({root,built:false,destination:join(directory,'runtime'),label:'Exact axis table experiment'})).provenance
 const fixturePins={}
 for(const name of ['axis-table.mjs','browser-prototype.js','index.html']){const bytes=await readFile(join(import.meta.dirname,name));fixturePins[name]=hash(bytes);await copyFile(join(import.meta.dirname,name),join(fixture,name))}
 const server=await createServer({root:fixture,configFile:false,publicDir:false,logLevel:'warn',optimizeDeps:{noDiscovery:true},resolve:{dedupe:['three'],alias:{'@exact-hash':join(directory,'runtime/tslNodeRecipe.ts'),'@old-coordinates':join(directory,'runtime/tslCompositorFloatCoordinates.ts')}},server:{host:'127.0.0.1',port:0,watch:null,hmr:false,fs:{allow:[root,native,directory,await realpath(join(root,'node_modules'))]}}})
 const result={status:'running',portCredit:0,savedFinalCredit:0,nativeReportSha256:capture.reportSha256,fixturePins,runtime:provenance,tuples:[]};let browser
 const save=()=>writeFile(join(directory,'report.json'),JSON.stringify(result,null,2)+'\n')
 try{
  await server.listen()
  for(const profile of ['metal','software']){
   browser=await chromium.launch({headless:true,...(profile==='metal'?{channel:'chromium'}:{}),args:['--enable-unsafe-webgpu','--enable-unsafe-swiftshader',...(profile==='software'?['--use-angle=swiftshader','--use-webgpu-adapter=swiftshader']:[])]})
   for(const backend of ['webgpu','webgl2']){
    const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push({text:message.text(),location:message.location()})})
    await page.goto(server.resolvedUrls.local[0]+'index.html?backend='+backend);await page.waitForFunction(()=>typeof window.runAxisTablePrototype==='function')
    const row=await page.evaluate(proof=>window.runAxisTablePrototype(proof),{rows});result.tuples.push({profile,backend,browserVersion:browser.version(),...row,consoleErrors:errors});await save()
    assert.equal(row.status,'EXPERIMENT_ONLY_EXACT_AXIS_TABLE');assert.equal(row.backend,backend);assert.equal(row.portCredit,0);assert.equal(row.rows.length,48);assert.equal(row.remainingTextures,0);assert.equal(row.remainingRenderTargets,0);assert.deepEqual(errors,[])
    if(profile==='metal'){assert.match(JSON.stringify(row.gpu),/apple|metal/i);assert.doesNotMatch(JSON.stringify(row.gpu),/swiftshader/i)}else assert.match(JSON.stringify(row.gpu),/swiftshader/i)
    assert.ok(row.rows.every(row=>row.exactWordDifferences===0&&row.liveTableBindings===1&&row.allocation.bytes<=65536))
    await page.close()
   }
   await browser.close();browser=undefined
  }
  for(const [path,sha]of Object.entries(fixturePins))await pin(join(import.meta.dirname,path),sha)
  result.status='EXPERIMENT_ONLY_AXIS_TABLE_CLOSED';await save();console.log(JSON.stringify({status:result.status,tuples:result.tuples.length,words:result.tuples.reduce((n,t)=>n+t.rows.reduce((s,r)=>s+r.comparedWords,0),0),portCredit:0}))
 }catch(error){result.status='failed';result.error=String(error);throw error}finally{await save();await browser?.close();await server.close()}
}else throw Error('Use capture <fresh-native-directory> or browser <native-directory> <fresh-browser-directory>')
