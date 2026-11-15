/* SPDX-License-Identifier: MIT */
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {mkdir,readFile,realpath,writeFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {createHash} from 'node:crypto'
import {createNodePortBlenderLauncher} from '../../scripts/lib/node-port-python.mjs'
import {archiveNativeLauncher,validateNativeArchive} from '../../scripts/lib/native-proof-archive.mjs'
const root=await realpath(resolve(import.meta.dirname,'../..')),requested=resolve(process.argv[2]??join(root,'artifacts/verification-displace-cpu-feasibility'))
await mkdir(resolve(requested,'..'),{recursive:true});await mkdir(requested);const directory=await realpath(requested),script=join(import.meta.dirname,'cpu-feasibility.py'),sha=bytes=>createHash('sha256').update(bytes).digest('hex')
const launcher=await createNodePortBlenderLauncher({blender:process.env.BLENDLINK_BLENDER??'/Applications/Blender.app/Contents/MacOS/Blender',directory:join(directory,'active'),timeoutMs:240000});let output='',archived=false
try{
 await new Promise((done,reject)=>{const child=spawn(launcher.executable,['--background','--factory-startup','-t','1','--python-exit-code','1','--python',script],{cwd:root,env:{...process.env,SCENETOWEB_DISPLACE_CPU_OUTPUT:directory},stdio:['ignore','pipe','pipe']});const consume=bytes=>{output+=bytes.toString();if(output.length>32*1024*1024){child.kill('SIGTERM');reject(Error('Displace CPU log exceeded bound'))}};child.stdout.on('data',consume);child.stderr.on('data',consume);child.once('error',reject);child.once('close',code=>code===0?done():reject(Error('Displace CPU feasibility failed '+code)))})
 const report=JSON.parse(await readFile(join(directory,'report.json'))),plan=JSON.parse(await readFile(join(import.meta.dirname,'cpu-plan.json')))
 assert.equal(report.status,'RESEARCH_EXACT_DISPLACE_TRANSLATE_CPU_BRANCH');assert.deepEqual(report.plan,plan);assert.deepEqual(report.rows.map(({outputs,wordDifferences,comparedWords,sourceExtractionStatus,sourceConsumerCredit,...row})=>row),plan.cases)
 assert.equal(report.nativeRenders,2*plan.cases.length);assert.equal(report.gpuInitializationCalls,0);assert.equal(report.gpuInitGuardProved,true);for(const key of['supportCredit','sourceConsumerCredit','savedFinalCredit','browserCredit'])assert.equal(report[key],0)
 let words=0
 for(const row of report.rows){assert.equal(row.sourceExtractionStatus,'unsupported');assert.equal(row.sourceConsumerCredit,0);assert.equal(row.wordDifferences,0);const arrays={}
  for(const kind of['displace','translate']){const data=row.outputs[kind];assert.equal(data.path,row.case+'-'+kind+'.rgba32f');const bytes=await readFile(join(directory,data.path));assert.equal(sha(bytes),data.sha256);assert.equal(bytes.length,row.width*row.height*16);assert.equal(data.bytes,bytes.length);arrays[kind]=bytes}
  assert.deepEqual(arrays.displace,arrays.translate);assert.equal(row.comparedWords,arrays.displace.length/4);words+=row.comparedWords
  if(row.setting==='maximum')assert.deepEqual(arrays.displace,Buffer.alloc(arrays.displace.length))
  if(row.setting==='origin')for(let y=0;y<row.height;y++)for(let x=0;x<row.width;x++)for(const[channel,value]of [[0,(x%5)/4],[1,(y%5)/4],[2,((x+3*y)%9)/8],[3,1]]){const expected=Buffer.alloc(4);expected.writeFloatLE(value);assert.equal(arrays.displace.readUInt32LE(((y*row.width+x)*4+channel)*4),expected.readUInt32LE())}
 }
 assert.equal(words,report.comparedWords);assert.equal(report.wordDifferences,0);for(const[path,pin]of Object.entries(report.sourceHashes))assert.equal(sha(await readFile(join(root,path))),pin)
 await launcher.finalize();const archive={identity:launcher.identity,proof:await archiveNativeLauncher(launcher,directory,true)};await validateNativeArchive(archive,directory,{expectedScripts:[{path:script,invocations:1}],expectedFinalSources:[],helperInputs:{helper:join(root,'scripts/lib/node-port-python.mjs'),bridge:join(root,'scripts/node-port-blender.mjs')}});await writeFile(join(directory,'archive.json'),JSON.stringify(archive,null,2)+'\n');archived=true
 await writeFile(join(directory,'closed.json'),JSON.stringify({status:'RESEARCH_CLOSED_DISPLACE_CPU_BRANCH',supportCredit:0,sourceConsumerCredit:0,cases:report.rows.length,nativeRenders:report.nativeRenders,words,wordDifferences:0,reportSha256:sha(await readFile(join(directory,'report.json'))),archiveSha256:sha(await readFile(join(directory,'archive.json')))},null,2)+'\n');console.log(JSON.stringify({cases:report.rows.length,nativeRenders:report.nativeRenders,words,wordDifferences:0,supportCredit:0}))
}finally{try{await writeFile(join(directory,'native.log'),output);if(!archived)await writeFile(join(directory,'failed-native-archive.json'),JSON.stringify({identity:launcher.identity,proof:await archiveNativeLauncher(launcher,directory,false)},null,2)+'\n')}finally{await launcher.dispose()}}
