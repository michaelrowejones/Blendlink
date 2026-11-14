import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {mkdir,readFile,writeFile,open} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {createHash} from 'node:crypto'
import {createNodePortBlenderLauncher} from '../../scripts/lib/node-port-python.mjs'
import {archiveNativeLauncher,validateNativeArchive} from '../../scripts/lib/native-proof-archive.mjs'
const root=resolve(import.meta.dirname,'../..'),output=resolve(process.argv[2]);await mkdir(resolve(output,'..'),{recursive:true});await mkdir(output)
const digest=async path=>createHash('sha256').update(await readFile(path)).digest('hex')
const scripts=['policy.py','capture.py'].map(name=>join(root,'experiments/compositor-static-matrix',name))
const sourcePaths=[...scripts,join(root,'experiments/compositor-static-matrix/pilot.mjs'),join(root,'experiments/compositor-static-matrix/sources.json')]
const sourceHashes=Object.fromEntries(await Promise.all(sourcePaths.map(async path=>[path,await digest(path)])))
const launcher=await createNodePortBlenderLauncher({blender:process.env.BLENDLINK_BLENDER??'/Applications/Blender.app/Contents/MacOS/Blender',directory:join(output,'native-active')});let archived=false
async function archive(complete){if(complete)await launcher.finalize();const proof=await archiveNativeLauncher(launcher,output,complete);const record={identity:launcher.identity,proof};await writeFile(join(output,'native-python-proof.json'),JSON.stringify(record,null,2)+'\n');archived=true;return record}
try{
 const start=Date.now()
 for(const[ordinal,script]of scripts.entries()){
  const log=await open(join(output,ordinal?'capture.log':'policy.log'),'wx')
  try{
   const result=await new Promise((resolve,reject)=>{const child=spawn(launcher.executable,['--background','--factory-startup','-t','1','--python-exit-code','1','--python',script],{cwd:root,env:{...process.env,SCENETOWEB_STATIC_MATRIX_POLICY:join(output,'policy.json'),SCENETOWEB_STATIC_MATRIX_CAPTURE:output},stdio:['ignore',log.fd,log.fd]});const timeout=setTimeout(()=>{child.kill('SIGTERM');setTimeout(()=>child.kill('SIGKILL'),400).unref()},120000);child.on('error',reject);child.on('close',code=>{clearTimeout(timeout);resolve(code)})});assert.equal(result,0,'Actual native pilot failed; preserve log and incomplete archive')
  }finally{await log.close()}
 }
 const record=await archive(true),nativePythonProof=await validateNativeArchive(record,output,{expectedFinalSources:[],expectedScripts:scripts.map(path=>({path,invocations:1})),helperInputs:{helper:join(root,'scripts/lib/node-port-python.mjs'),bridge:join(root,'scripts/node-port-blender.mjs')}})
 const policy=JSON.parse(await readFile(join(output,'policy.json'))),report=JSON.parse(await readFile(join(output,'report.json')))
 assert.equal(policy.status,'STATIC_MATRIX_SOURCE_POLICY_PASSED');assert.equal(policy.positives.length,8);assert.equal(policy.refusals.length,12);assert.equal(policy.schemas.length,6)
 assert.equal(report.status,'STATIC_MATRIX_CPU_COMPOSITOR_PILOT_PASSED');assert.equal(report.rows.length,12);assert.equal(report.endpointComparisons,32);assert.equal(report.rgbaWords,768);assert.equal(report.nativeRenders,12);assert.equal(report.wordDifferences,0)
 for(const[path,hash]of Object.entries(report.sourceHashes))assert.equal(await digest(join(root,path)),hash,'Native input changed: '+path)
 for(const[path,hash]of Object.entries(sourceHashes))assert.equal(await digest(path),hash,'Pilot input changed: '+path)
 for(const row of report.rows){assert.equal(row.wordDifferences,0);assert.deepEqual(row.privateMFWwords,row.expectedWords);assert.equal(await digest(join(output,row.program)),row.programSha256);assert.equal(await digest(join(output,row.pixelsFile)),row.pixelsSha256)}
 await writeFile(join(output,'closed-pilot.json'),JSON.stringify({status:'CLOSED_STATIC_MATRIX_CPU_COMPOSITOR_PILOT',qualificationCredit:0,milliseconds:Date.now()-start,sourceHashes,nativePythonProof,policy,report},null,2)+'\n')
 console.log('Closed CPU Matrix pilot: 12 renders, 32 endpoint comparisons, 768 exact RGBA words; no Final/browser credit.')
}finally{try{if(!archived)await archive(false)}finally{await launcher.dispose()}}
