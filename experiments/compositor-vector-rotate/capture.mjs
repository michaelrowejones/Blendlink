/* SPDX-License-Identifier: MIT */
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {mkdir,readFile,writeFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {createNodePortBlenderLauncher} from '../../scripts/lib/node-port-python.mjs'
import {archiveNativeLauncher} from '../../scripts/lib/native-proof-archive.mjs'
import {preflightBrowserProofContracts} from '../../scripts/lib/browser-proof-contract.mjs'
import {hash} from '../../scripts/lib/runtime-provenance.mjs'
import {assertPolicy,assertProgram,assertQualification,assertFinal,cases} from './protocol.mjs'
import {assertNativeBuffers} from './native-reader.mjs'
const root=resolve(import.meta.dirname,'../..'),destination=resolve(process.argv[3]),setupOnly=process.argv.includes('--source-only');assert.equal(process.argv[2],'CPU');assert.ok(process.argv[3])
await preflightBrowserProofContracts(root,['compositor-vector-rotate'])
await mkdir(resolve(destination,'..'),{recursive:true});await mkdir(destination)
const launcher=await createNodePortBlenderLauncher({blender:process.env.BLENDLINK_BLENDER??'/Applications/Blender.app/Contents/MacOS/Blender',directory:join(destination,'active'),timeoutMs:240000})
const env={...process.env,BLENDLINK_BLENDER:launcher.executable,BLENDLINK_VECTOR_ROTATE_BUILT:'1',SCENETOWEB_VECTOR_ROTATE_REFERENCES:destination}
const run=(command,args,label)=>new Promise((done,reject)=>{let output='';const child=spawn(command,args,{cwd:root,env,stdio:['ignore','pipe','pipe']}),timer=setTimeout(()=>child.kill('SIGTERM'),300000);const consume=bytes=>{output+=bytes;process.stdout.write(bytes);if(output.length>32*1024*1024)child.kill('SIGTERM')};child.stdout.on('data',consume);child.stderr.on('data',consume);child.once('error',reject);child.once('close',async code=>{clearTimeout(timer);await writeFile(join(destination,label+'.log'),output);code===0?done():reject(Error('Vector Rotate '+label+' failed '+code))})})
const native=(name,args=[])=>run(launcher.executable,['--background','--factory-startup','-t','1','--python-exit-code','1','--python',join(import.meta.dirname,name),'--',destination,...args],name.replace('.py','')+(args.length?'-setup':''))
let complete=false
try{
 await native('policy.py');assertPolicy(JSON.parse(await readFile(join(destination,'policy.json'))))
 await native('reference.py',['--source-only']);const source=JSON.parse(await readFile(join(destination,'source-check.json')));assert.equal(source.status,'CHECKED_VECTOR_ROTATE_SOURCE_SETUP');assert.equal(source.nativeRenders,0);assert.equal(source.gpuInitializations,0);assert.deepEqual(source.cases.map(row=>row.case),cases.map(row=>row.case))
 const {validateVectorRotateProgram}=await import(join(root,'packages/blendlink/dist/tslCompositorVectorRotate.js'))
 const programs=async rows=>{for(const row of rows){const bytes=await readFile(join(destination,row.programFile));assert.equal(hash(bytes),row.programSha256);const program=JSON.parse(bytes);assertProgram(program,row);validateVectorRotateProgram(program)}}
 await programs(source.cases)
 if(!setupOnly){
  await native('reference.py');const q=assertQualification(JSON.parse(await readFile(join(destination,'qualification.json'))));await programs(q.cases);await assertNativeBuffers(destination,q);assert.deepEqual(q.cases.map(r=>r.program),source.cases.map(r=>r.program))
  await run(process.execPath,['node_modules/vitest/vitest.mjs','run','experiments/compositor-vector-rotate/export.test.ts'],'Final')
  const final=JSON.parse(await readFile(join(destination,'final-proof.json')));assertFinal(final,q,{built:true,nativeSha256:hash(await readFile(join(destination,'qualification.json')))})
  await launcher.finalize();final.nativeArchive={identity:launcher.identity,proof:await archiveNativeLauncher(launcher,destination,true)};await writeFile(join(destination,'final-proof.json'),JSON.stringify(final,null,2)+'\n');complete=true
 }else{await launcher.finalize();await writeFile(join(destination,'source-native-archive.json'),JSON.stringify({identity:launcher.identity,proof:await archiveNativeLauncher(launcher,destination,true)},null,2)+'\n');complete=true}
}finally{try{if(!complete)await writeFile(join(destination,'failed-native-proof.json'),JSON.stringify({identity:launcher.identity,proof:await archiveNativeLauncher(launcher,destination,false)},null,2)+'\n')}finally{await launcher.dispose()}}
