import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {mkdir,readFile,writeFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {createHash} from 'node:crypto'
import {createNodePortBlenderLauncher} from '../../scripts/lib/node-port-python.mjs'
import {archiveNativeLauncher,validateNativeArchive} from '../../scripts/lib/native-proof-archive.mjs'
const root=resolve(import.meta.dirname,'../..'),output=resolve(process.argv[2]);await mkdir(resolve(output,'..'),{recursive:true});await mkdir(output)
const launcher=await createNodePortBlenderLauncher({blender:process.env.BLENDLINK_BLENDER??'/Applications/Blender.app/Contents/MacOS/Blender',directory:join(output,'native-active')});let archived=false
async function archive(complete){if(complete)await launcher.finalize();const proof=await archiveNativeLauncher(launcher,output,complete);const record={identity:launcher.identity,proof};await writeFile(join(output,'native-python-proof.json'),JSON.stringify(record,null,2)+'\n');archived=true;return record}
try{
 const script=join(root,'experiments/cpu-mf-attribute-oracle/probe.py'),start=Date.now()
 const result=await new Promise((resolve,reject)=>{const child=spawn(launcher.executable,['--background','--factory-startup','-t','1','--python-exit-code','1','--python',script],{cwd:root,env:{...process.env,SCENETOWEB_CPU_MF_ORACLE:output},stdio:'inherit'});const timeout=setTimeout(()=>{child.kill('SIGTERM');setTimeout(()=>child.kill('SIGKILL'),400)},120000);child.on('error',reject);child.on('close',code=>{clearTimeout(timeout);resolve(code)})});assert.equal(result,0)
 const record=await archive(true),nativePythonProof=await validateNativeArchive(record,output,{expectedFinalSources:[],expectedScripts:[{path:script,invocations:1}],helperInputs:{helper:join(root,'scripts/lib/node-port-python.mjs'),bridge:join(root,'scripts/node-port-blender.mjs')}})
 const report=JSON.parse(await readFile(join(output,'report.json')));assert.equal(report.status,'CPU_MF_ATTRIBUTE_PROTOTYPE_CALIBRATED');assert.equal(report.wordOrIntegerMismatches,0);assert.equal(report.sourceOwnershipRestored,true);assert.equal(report.renders,0);assert.equal(report.bakes,0);assert.equal(report.rows.length,25);assert.equal(report.refusals.length,6);assert.equal(report.rawCarrierCalibration.length,4)
 for(const[name,digest]of Object.entries(report.sourceHashes))assert.equal(createHash('sha256').update(await readFile(join(root,'experiments/cpu-mf-attribute-oracle',name))).digest('hex'),digest,'Native prototype source changed: '+name)
 await writeFile(join(output,'closed-research.json'),JSON.stringify({status:'CLOSED_CPU_MF_ATTRIBUTE_RESEARCH_PILOT',qualificationCredit:0,milliseconds:Date.now()-start,nativePythonProof,report},null,2)+'\n')
}finally{try{if(!archived)await archive(false)}finally{await launcher.dispose()}}
