/* SPDX-License-Identifier: MIT */
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {readFile,writeFile,mkdir,readdir,realpath} from 'node:fs/promises'
import {join,resolve,relative} from 'node:path'
import {createHash} from 'node:crypto'
import {createNodePortBlenderLauncher} from '../../scripts/lib/node-port-python.mjs'
import {archiveNativeLauncher,validateNativeArchive} from '../../scripts/lib/native-proof-archive.mjs'
const root=await realpath(resolve(import.meta.dirname,'../..')),requested=resolve(process.argv[2]);assert.ok(process.argv[2]);await mkdir(requested);const out=await realpath(requested),sha=bytes=>createHash('sha256').update(bytes).digest('hex'),script=join(root,'experiments/compositor-vector-rotate-unit-axis/research.py')
const paths=['packages/blendlink/src/tslNodeRecipe.ts','experiments/compositor-vector-rotate-research/probe.py','experiments/compositor-vector-rotate-unit-axis/research.mjs','experiments/compositor-vector-rotate-unit-axis/research.py','experiments/compositor-vector-rotate-research/sources.json','packages/blender-addon/tests/compositor_reference.py']
for(const folder of['packages/blendlink/blender','packages/blender-addon'])for(const name of await readdir(join(root,folder)))if(name.endsWith('.py')||name.endsWith('.json'))paths.push(folder+'/'+name)
const capture=()=>Promise.all(paths.sort().map(async file=>[file,sha(await readFile(join(root,file)))] )).then(Object.fromEntries),inputs=await capture();await writeFile(join(out,'source-pins.json'),JSON.stringify(inputs,null,2)+'\n')
const launcher=await createNodePortBlenderLauncher({blender:'/Applications/Blender.app/Contents/MacOS/Blender',directory:join(out,'active'),timeoutMs:120000});let complete=false,log=''
try{
 await new Promise((done,reject)=>{const child=spawn(launcher.executable,['--background','--factory-startup','-t','1','--python-exit-code','1','--python',script,'--',out],{cwd:root,stdio:['ignore','pipe','pipe']}),timer=setTimeout(()=>child.kill('SIGTERM'),120000);const consume=data=>{log+=data.toString();if(log.length>8*1024*1024)child.kill('SIGTERM')};child.stdout.on('data',consume);child.stderr.on('data',consume);child.once('error',reject);child.once('close',code=>{clearTimeout(timer);code===0?done():reject(Error('Vector Rotate no-render research failed '+code))})})
 assert.deepEqual(await capture(),inputs);await launcher.finalize();complete=true
}finally{try{await writeFile(join(out,'native.log'),log);await writeFile(join(out,'archive.json'),JSON.stringify({identity:launcher.identity,proof:await archiveNativeLauncher(launcher,out,complete)},null,2)+'\n')}finally{await launcher.dispose()}}
const report=JSON.parse(await readFile(join(out,'report.json')));assert.equal(report.status,'OBSERVED_SIGNED_UNIT_AXIS_VECTOR_ROTATE_CPU_MF');for(const key of['supportCredit','FinalCredit','browserCredit','nativeRenders','gpuInitializations','wordDifferences','hashDifferences'])assert.equal(report[key],0);assert.equal(report.controlKeys,72);assert.equal(report.geometryEvaluations,648);assert.equal(report.stagedComponentWords,648);assert.equal(report.sourceOwnershipRestored,true)
const archive=await validateNativeArchive(JSON.parse(await readFile(join(out,'archive.json'))),out,{expectedScripts:[{path:script,invocations:1}],expectedFinalSources:[],helperInputs:{helper:join(root,'scripts/lib/node-port-python.mjs'),bridge:join(root,'scripts/node-port-blender.mjs')}})

await writeFile(join(out,'closed.json'),JSON.stringify({status:'CLOSED_SIGNED_UNIT_AXIS_VECTOR_ROTATE_RESEARCH',supportCredit:0,reportSha256:sha(await readFile(join(out,'report.json'))),archiveSha256:sha(await readFile(join(out,'archive.json'))),archive,sourcePins:inputs},null,2)+'\n');console.log('CLOSED_SIGNED_UNIT_AXIS_VECTOR_ROTATE_RESEARCH '+relative(root,out))
