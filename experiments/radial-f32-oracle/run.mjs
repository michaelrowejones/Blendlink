import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {mkdir,readFile,writeFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {createNodePortBlenderLauncher} from '../../scripts/lib/node-port-python.mjs'
import {archiveNativeLauncher,validateNativeArchive} from '../../scripts/lib/native-proof-archive.mjs'
const root=resolve(import.meta.dirname,'../..'),output=resolve(process.argv[2]),sources=resolve(process.argv[3]),cases=resolve(process.argv[4]);await mkdir(output,{recursive:true})
const launcher=await createNodePortBlenderLauncher({blender:process.env.BLENDLINK_BLENDER??'/Applications/Blender.app/Contents/MacOS/Blender',directory:join(output,'native-active')});let archived=false
async function archive(complete){if(complete)await launcher.finalize();const proof=await archiveNativeLauncher(launcher,output,complete);const record={identity:launcher.identity,proof};await writeFile(join(output,'native-python-proof.json'),JSON.stringify(record,null,2)+'\n');archived=true;return record}
try{
 const script=join(root,'experiments/radial-f32-oracle/capture.py'),start=Date.now()
 const result=await new Promise((resolve,reject)=>{const child=spawn(launcher.executable,['--background','--factory-startup','-t','1','--python-exit-code','1','--python',script],{cwd:root,env:{...process.env,SCENETOWEB_RADIAL_F32_DESTINATION:output,SCENETOWEB_F32_ORACLE_SOURCES:sources,SCENETOWEB_RADIAL_F32_CASES:cases},stdio:'inherit'});const timeout=setTimeout(()=>{child.kill('SIGTERM');setTimeout(()=>child.kill('SIGKILL'),400)},120000);child.on('error',reject);child.on('close',code=>{clearTimeout(timeout);resolve(code)})});assert.equal(result,0)
 const record=await archive(true),nativePythonProof=await validateNativeArchive(record,output,{expectedFinalSources:[],expectedScripts:[{path:script,invocations:1}],helperInputs:{helper:join(root,'scripts/lib/node-port-python.mjs'),bridge:join(root,'scripts/node-port-blender.mjs')}})
 const report=JSON.parse(await readFile(join(output,'report.json')));assert.equal(report.status,'CAPTURED_RADIAL_REGULAR_PYTHON_GPU_F32_RESEARCH');assert.equal(report.independentCalibration.wordMismatches,0);assert.equal(report.rows.length,440);assert.equal(report.runs.length,5);assert.equal(report.inputWordMismatches,report.rows.reduce((sum,row)=>sum+row.inputWordMismatches,0))
 await writeFile(join(output,'closed-research.json'),JSON.stringify({status:'CLOSED_RADIAL_REGULAR_F32_ORACLE_RESEARCH',qualificationCredit:0,milliseconds:Date.now()-start,nativePythonProof,report},null,2)+'\n')
}finally{try{if(!archived)await archive(false)}finally{await launcher.dispose()}}
