/* SPDX-License-Identifier: MIT */
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {mkdir,readFile,readdir,writeFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {createNodePortBlenderLauncher} from '../../scripts/lib/node-port-python.mjs'
import {archiveNativeLauncher,validateNativeArchive} from '../../scripts/lib/native-proof-archive.mjs'
import {captureRuntimeProvenance,hash} from '../../scripts/lib/runtime-provenance.mjs'
const root=resolve(import.meta.dirname,'../..'),out=resolve(process.argv[2]);assert.ok(process.argv[2]);await mkdir(out)
const plan=JSON.parse(await readFile(join(import.meta.dirname,'cases.json')))
assert.equal(plan.cases.length,22);assert.equal(new Set(plan.cases.map(row=>row.case)).size,22)
const paths=['experiments/compositor-vector-rotate/pilot.py','experiments/compositor-vector-rotate/cases.json','experiments/compositor-vector-rotate/capture-pilot.mjs','packages/blender-addon/tests/compositor_reference.py']
for(const directory of['packages/blendlink/blender','packages/blender-addon'])for(const name of await readdir(join(root,directory)))if(/\.(py|json)$/.test(name))paths.push(directory+'/'+name)
const snapshot=()=>Promise.all(paths.sort().map(async file=>[file,hash(await readFile(join(root,file)))])).then(Object.fromEntries),pins=await snapshot()
await writeFile(join(out,'source-pins.json'),JSON.stringify(pins,null,2)+'\n')
const {provenance}=await captureRuntimeProvenance({root,built:true,label:'Vector Rotate source/native pilot'})
await writeFile(join(out,'runtime-provenance.json'),JSON.stringify(provenance,null,2)+'\n')
const {validateVectorRotateProgram}=await import(join(root,'packages/blendlink/dist/tslCompositorVectorRotate.js'))
const script=join(root,'experiments/compositor-vector-rotate/pilot.py'),launcher=await createNodePortBlenderLauncher({blender:'/Applications/Blender.app/Contents/MacOS/Blender',directory:join(out,'active'),timeoutMs:180000})
let complete=false
const run=async(sourceOnly)=>{
 let log=''
 try{await new Promise((done,reject)=>{
  const child=spawn(launcher.executable,['--background','--factory-startup','-t','1','--python-exit-code','1','--python',script,'--',out,...(sourceOnly?['--source-only']:[])],{cwd:root,stdio:['ignore','pipe','pipe']}),timer=setTimeout(()=>child.kill('SIGTERM'),180000)
  const consume=chunk=>{log+=chunk;if(log.length>8*1024*1024)child.kill('SIGTERM')};child.stdout.on('data',consume);child.stderr.on('data',consume)
  child.once('error',reject);child.once('close',code=>{clearTimeout(timer);code===0?done():reject(Error('Vector Rotate '+(sourceOnly?'source':'native')+' pilot failed '+code))})
 })}finally{await writeFile(join(out,sourceOnly?'source.log':'native.log'),log)}
}
try{
 await run(true)
 const source=JSON.parse(await readFile(join(out,'source.json')));assert.equal(source.status,'CAPTURED_VECTOR_ROTATE_SOURCE_PILOT');assert.equal(source.nativeRenders,0)
 assert.deepEqual(source.cases.map(row=>row.case),plan.cases.map(row=>row.case))
 for(const row of source.cases){const bytes=await readFile(join(out,row.program.file));assert.equal(hash(bytes),row.program.sha256);validateVectorRotateProgram(JSON.parse(bytes))}
 await run(false)
 const native=JSON.parse(await readFile(join(out,'native.json')));assert.equal(native.status,'CAPTURED_VECTOR_ROTATE_NATIVE_PILOT');assert.equal(native.gpuInitializations,0)
 assert.deepEqual(native.cases.map(row=>row.case),source.cases.map(row=>row.case));assert.deepEqual(native.cases.map(row=>row.program),source.cases.map(row=>row.program))
 assert.deepEqual(await snapshot(),pins)
 await launcher.finalize();complete=true
}finally{try{await writeFile(join(out,'native-archive.json'),JSON.stringify({identity:launcher.identity,proof:await archiveNativeLauncher(launcher,out,complete)},null,2)+'\n')}finally{await launcher.dispose()}}
const archive=await validateNativeArchive(JSON.parse(await readFile(join(out,'native-archive.json'))),out,{expectedScripts:[{path:script,invocations:2}],expectedFinalSources:[],helperInputs:{helper:join(root,'scripts/lib/node-port-python.mjs'),bridge:join(root,'scripts/node-port-blender.mjs')}})
await writeFile(join(out,'native-closed.json'),JSON.stringify({status:'CLOSED_RESEARCH_ONLY_VECTOR_ROTATE_NATIVE_PILOT',supportCredit:0,FinalCredit:0,nativeSha256:hash(await readFile(join(out,'native.json'))),archiveSha256:hash(await readFile(join(out,'native-archive.json'))),archive,sourcePins:pins},null,2)+'\n')
console.log('CLOSED_RESEARCH_ONLY_VECTOR_ROTATE_NATIVE_PILOT')
