import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {mkdir,readFile,writeFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {createNodePortBlenderLauncher} from '../../scripts/lib/node-port-python.mjs'
import {archiveNativeLauncher,validateNativeArchive} from '../../scripts/lib/native-proof-archive.mjs'
const root=resolve(import.meta.dirname,'../..'),output=resolve(process.argv[2]),sources=resolve(process.argv[3]);await mkdir(output,{recursive:true})
const launcher=await createNodePortBlenderLauncher({blender:process.env.BLENDLINK_BLENDER??'/Applications/Blender.app/Contents/MacOS/Blender',directory:join(output,'native-active')});let archived=false
async function archive(complete){if(complete)await launcher.finalize();const proof=await archiveNativeLauncher(launcher,output,complete);const record={identity:launcher.identity,proof};await writeFile(join(output,'native-python-proof.json'),JSON.stringify(record,null,2)+'\n');archived=true;return record}
try{
 const script=join(root,'experiments/native-f32-oracle-research/probe.py'),start=Date.now()
 const result=await new Promise((resolve,reject)=>{const child=spawn(launcher.executable,['--background','--factory-startup','-t','1','--python-exit-code','1','--python',script],{cwd:root,env:{...process.env,SCENETOWEB_F32_ORACLE_PROBE:output,SCENETOWEB_F32_ORACLE_SOURCES:sources},stdio:'inherit'});const timeout=setTimeout(()=>{child.kill('SIGTERM');setTimeout(()=>child.kill('SIGKILL'),400)},120000);child.on('error',reject);child.on('close',code=>{clearTimeout(timeout);resolve(code)})});assert.equal(result,0)
 const record=await archive(true),nativePythonProof=await validateNativeArchive(record,output,{expectedFinalSources:[],expectedScripts:[{path:script,invocations:1}],helperInputs:{helper:join(root,'scripts/lib/node-port-python.mjs'),bridge:join(root,'scripts/node-port-blender.mjs')}})
 const report=JSON.parse(await readFile(join(output,'report.json')));assert.equal(report.status,'CALIBRATED_NATIVE_PYTHON_GPU_RGBA32F_RESEARCH');assert.equal(report.wordMismatches,0);assert.equal(report.rows.length,7);assert.equal(report.comparedFloat32Words,112)
 await writeFile(join(output,'closed-research.json'),JSON.stringify({status:'CLOSED_F32_ORACLE_RESEARCH_PILOT',qualificationCredit:0,milliseconds:Date.now()-start,nativePythonProof,report},null,2)+'\n')
}finally{try{if(!archived)await archive(false)}finally{await launcher.dispose()}}
