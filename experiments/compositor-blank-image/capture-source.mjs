/* SPDX-License-Identifier: MIT */
/** Actual source-only fixture preflight. No render, saved export or GPU credit. */
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {readFile,writeFile,mkdir,realpath} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {createNodePortBlenderLauncher} from '../../scripts/lib/node-port-python.mjs'
import {archiveNativeLauncher,validateNativeArchive} from '../../scripts/lib/native-proof-archive.mjs'
import {hash} from '../../scripts/lib/runtime-provenance.mjs'
import {cases,assertProgram} from './protocol.mjs'
const root=await realpath(resolve(import.meta.dirname,'../..'));assert.ok(process.argv[2]);await mkdir(resolve(process.argv[2]));const out=await realpath(resolve(process.argv[2])),script=join(root,'experiments/compositor-blank-image/reference.py'),launcher=await createNodePortBlenderLauncher({blender:process.env.BLENDLINK_BLENDER??'/Applications/Blender.app/Contents/MacOS/Blender',directory:join(out,'active'),timeoutMs:120000})
let complete=false,log=''
try{await new Promise((done,reject)=>{const child=spawn(launcher.executable,['--background','--factory-startup','-t','1','--python-exit-code','1','--python',script],{cwd:root,env:{...process.env,SCENETOWEB_BLANK_IMAGE_REFERENCES:out,SCENETOWEB_BLANK_IMAGE_SOURCE_ONLY:'1'},stdio:['ignore','pipe','pipe']}),timer=setTimeout(()=>child.kill('SIGTERM'),120000);const consume=data=>{log+=data;if(log.length>8*1024*1024)child.kill('SIGTERM')};child.stdout.on('data',consume);child.stderr.on('data',consume);child.once('error',reject);child.once('close',code=>{clearTimeout(timer);code===0?done():reject(Error('Blank source setup failed '+code))})})
 const q=JSON.parse(await readFile(join(out,'source-check.json')));assert.equal(q.status,'CHECKED_BLANK_IMAGE_SOURCE_SETUP');assert.equal(q.nativeRenders,0);assert.equal(q.gpuInitializations,0);assert.deepEqual(q.cases.map(r=>r.case),cases.map(r=>r.case));for(const row of q.cases){const bytes=await readFile(join(out,row.programFile));assert.equal(hash(bytes),row.programSha256);assertProgram(JSON.parse(bytes),row)}for(const[file,sha]of Object.entries(q.sourceHashes))assert.equal(hash(await readFile(join(root,file))),sha);await launcher.finalize();complete=true
}finally{try{await writeFile(join(out,'native.log'),log);await writeFile(join(out,'native-archive.json'),JSON.stringify({identity:launcher.identity,proof:await archiveNativeLauncher(launcher,out,complete)},null,2)+'\n')}finally{await launcher.dispose()}}
const archive=await validateNativeArchive(JSON.parse(await readFile(join(out,'native-archive.json'))),out,{expectedFinalSources:[],expectedScripts:[{path:script,invocations:1}],helperInputs:{helper:join(root,'scripts/lib/node-port-python.mjs'),bridge:join(root,'scripts/node-port-blender.mjs')}})
const closed={status:'CLOSED_BLANK_IMAGE_SOURCE_SETUP',supportCredit:0,finalCredit:0,nativeRenders:0,gpuInitializations:0,cases:cases.length,sourceReportSha256:hash(await readFile(join(out,'source-check.json'))),nativeArchiveSha256:hash(await readFile(join(out,'native-archive.json'))),runnerSha256:hash(await readFile(import.meta.filename)),archive};await writeFile(join(out,'source-closed.json'),JSON.stringify(closed,null,2)+'\n');console.log(closed.status,cases.length)
