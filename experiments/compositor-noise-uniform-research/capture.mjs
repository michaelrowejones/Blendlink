// Research capture only. Zero SDK/support/Final/browser credit.
import assert from'node:assert/strict'
import {execFile}from'node:child_process'
import {promisify}from'node:util'
import {mkdir,readFile,writeFile}from'node:fs/promises'
import {resolve,join}from'node:path'
import {createNodePortBlenderLauncher}from'../../scripts/lib/node-port-python.mjs'
import {archiveNativeLauncher,validateNativeArchive}from'../../scripts/lib/native-proof-archive.mjs'
import {hash}from'../../scripts/lib/runtime-provenance.mjs'
const root=resolve(import.meta.dirname,'../..'),out=resolve(process.argv[2]),script=join(import.meta.dirname,'native.py'),contract=JSON.parse(await readFile(join(import.meta.dirname,'contract.json')))
assert.equal(contract.gpuRuns,0);assert.equal(contract.portCredit,0);await mkdir(out)
const launcher=await createNodePortBlenderLauncher({blender:'/Applications/Blender.app/Contents/MacOS/Blender',directory:join(out,'launcher'),timeoutMs:120000})
let complete=false
try{
 const result=await promisify(execFile)(launcher.executable,['--background','--factory-startup','-t','1','--python-exit-code','1','--python',script,'--',out],{cwd:root,maxBuffer:32*1024*1024,timeout:120000})
 await writeFile(join(out,'native.log'),result.stdout+result.stderr)
 const report=JSON.parse(await readFile(join(out,'report.json')));assert.equal(report.nativeRenders,20);assert.equal(report.gpuRuns,0);assert.equal(report.portCredit,0)
 await launcher.finalize();const nativeArchive={identity:launcher.identity,proof:await archiveNativeLauncher(launcher,out,true)};complete=true
 const archive=await validateNativeArchive(nativeArchive,out,{expectedFinalSources:[],expectedScripts:[{path:script,invocations:1}],helperInputs:{helper:join(root,'scripts/lib/node-port-python.mjs'),bridge:join(root,'scripts/node-port-blender.mjs')}})
 const receipt={status:'RETAINED_NOISE_UNIFORM_CPU_RESEARCH',reportSha256:hash(await readFile(join(out,'report.json'))),contractSha256:hash(await readFile(join(import.meta.dirname,'contract.json'))),scriptSha256:hash(await readFile(script)),nativeArchive,archive,gpuRuns:0,finalCredit:0,browserCredit:0,portCredit:0}
 await writeFile(join(out,'research-receipt.json'),JSON.stringify(receipt,null,2)+'\n');console.log(receipt.status)
}catch(error){await writeFile(join(out,'failure.json'),JSON.stringify({error:String(error),stdout:error.stdout??'',stderr:error.stderr??'',gpuRuns:0,portCredit:0},null,2)+'\n');throw error}
finally{try{if(!complete)await writeFile(join(out,'failed-native-proof.json'),JSON.stringify({identity:launcher.identity,proof:await archiveNativeLauncher(launcher,out,false)},null,2)+'\n')}finally{await launcher.dispose()}}
