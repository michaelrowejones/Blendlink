// Fresh bounded diagnostic; this never substitutes for complete Final/all-profile qualification.
import assert from'node:assert/strict'
import{spawnSync}from'node:child_process'
import{mkdir,readFile,writeFile}from'node:fs/promises'
import{resolve,join}from'node:path'
import{createNodePortBlenderLauncher}from'../../scripts/lib/node-port-python.mjs'
import{archiveNativeLauncher,validateNativeArchive}from'../../scripts/lib/native-proof-archive.mjs'
import{captureRuntimeTransaction}from'../../scripts/lib/runtime-transaction-snapshot.mjs'
import{hash}from'../../scripts/lib/runtime-provenance.mjs'
const root=resolve(import.meta.dirname,'../..'),out=resolve(process.argv[2]);await mkdir(out)
process.env.SCENETOWEB_SWITCH_VARIANT='finite-image-info'
const{assertQualification,assertFiniteImageInfoProgram,assertIntegerVectorWords,assertBrowserReport}=await import('../static-switch-family/protocol.mjs')
const launcher=await createNodePortBlenderLauncher({blender:'/Applications/Blender.app/Contents/MacOS/Blender',directory:join(out,'native-active')});let archived=false
const execute=(name,exe,args,env={})=>{const result=spawnSync(exe,args,{cwd:root,env:{...process.env,...env},encoding:'utf8',maxBuffer:32*1024*1024,timeout:240000});return writeFile(join(out,name+'.log'),String(result.stdout)+String(result.stderr)+String(result.error??'')).then(()=>assert.equal(result.status,0,name+' failed; inspect fresh retained namespace'))}
try{
 await execute('protocol',process.execPath,['--test','experiments/static-switch-family/protocol.test.mjs'])
 const transaction=await captureRuntimeTransaction({root,directory:join(out,'runtime-transaction'),label:'Finite metadata diagnostic'})
 await execute('policy',launcher.executable,['--background','--factory-startup','--disable-autoexec','-t','1','--python-exit-code','1','--python',join(import.meta.dirname,'policy.py'),'--',join(out,'policy')])
 const cpu=join(out,'cpu');await mkdir(cpu)
 const env={SCENETOWEB_SWITCH_CONTEXT:'CPU',SCENETOWEB_SWITCH_REFERENCES:cpu,SCENETOWEB_RUNTIME_TRANSACTION:transaction.path,SCENETOWEB_RUNTIME_TRANSACTION_SHA256:transaction.sha256,BLENDLINK_BLENDER:launcher.executable}
 await execute('native',launcher.executable,['--background','--factory-startup','--disable-autoexec','-t','1','--python-exit-code','1','--python',join(root,'experiments/static-switch-family/reference.py')],env)
 const q=assertQualification(JSON.parse(await readFile(join(cpu,'qualification.json'))))
 for(const entry of q.cases){const program=await readFile(join(cpu,entry.programFile)),pixels=await readFile(join(cpu,entry.pixelFile));assert.equal(hash(program),entry.programSha256);assert.equal(hash(pixels),entry.pixelSha256);assertFiniteImageInfoProgram(JSON.parse(program),entry);assertIntegerVectorWords(pixels,entry)}
 await launcher.finalize();await writeFile(join(out,'native-archive.json'),JSON.stringify({identity:launcher.identity,proof:await archiveNativeLauncher(launcher,out,true)},null,2)+'\n');archived=true
 await validateNativeArchive(JSON.parse(await readFile(join(out,'native-archive.json'))),out,{expectedScripts:[{path:join(import.meta.dirname,'policy.py'),invocations:1},{path:join(root,'experiments/static-switch-family/reference.py'),invocations:1}],expectedFinalSources:[],helperInputs:{helper:join(root,'scripts/lib/node-port-python.mjs'),bridge:join(root,'scripts/node-port-blender.mjs')}})
 await execute('metal-raw',process.execPath,['experiments/static-switch-family/run.mjs','--built'],{...env,BLENDLINK_TEST_PROFILE:'metal',BLENDLINK_TEST_CHROMIUM_CHANNEL:'chromium',BLENDLINK_TEST_CHROMIUM_ARGS:'[]'})
 const browser=assertBrowserReport(JSON.parse(await readFile(join(cpu,'browser-raw-metal/report.json'))),q,{rows:[]},{profile:'metal',final:false})
 let words=0
 for(const api of browser.rows)for(const row of api.rows){const entry=q.cases.find(x=>x.case===row.case);for(const capture of row.readbacks){const bytes=await readFile(join(cpu,'browser-raw-metal',capture.wordFile));assert.equal(hash(bytes),capture.wordSha256);words+=assertIntegerVectorWords(bytes,entry)}}
 assert.equal(words,21504)
 await writeFile(join(out,'diagnostic.json'),JSON.stringify({status:'DIAGNOSTIC_FINITE_IMAGE_INFO_METAL_RAW_PASSED',nativeGraphs:21,savedSources:8,exportedFinals:0,actualApis:browser.rows.map(row=>row.gpu),primaryBrowserCases:42,primaryWords:10752,independentlyRecomputedAllReadWords:words,wordDifferences:0,browserReportSha256:hash(await readFile(join(cpu,'browser-raw-metal/report.json'))),runtimeTransaction:{sha256:transaction.sha256},supportCredit:0,productionCredit:false,finalCredit:0},null,2)+'\n');console.log('DIAGNOSTIC_FINITE_IMAGE_INFO_METAL_RAW_PASSED')
}finally{try{if(!archived)await writeFile(join(out,'failed-native-archive.json'),JSON.stringify({identity:launcher.identity,proof:await archiveNativeLauncher(launcher,out,false)},null,2)+'\n')}finally{await launcher.dispose()}}
