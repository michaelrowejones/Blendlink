/* SPDX-License-Identifier: MIT */
// No-render readiness only. This is not a numerical qualification runner.
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {mkdir,readFile,readdir,realpath,writeFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {createHash} from 'node:crypto'
import {createNodePortBlenderLauncher} from '../../scripts/lib/node-port-python.mjs'
import {archiveNativeLauncher,validateNativeArchive} from '../../scripts/lib/native-proof-archive.mjs'
const root=await realpath(resolve(import.meta.dirname,'../..'))
const requested=resolve(process.argv[2]??join(root,'artifacts/verification-wave-axis-source-policy'))
await mkdir(resolve(requested,'..'),{recursive:true});await mkdir(requested)
const directory=await realpath(requested),script=join(root,'packages/blender-addon/tests/compositor_wave_axis_check.py')
const sha=bytes=>createHash('sha256').update(bytes).digest('hex')
async function sourcePins(){
 const pins={}
 async function visit(path){for(const entry of(await readdir(join(root,path),{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
  const name=path+'/'+entry.name
  if(entry.isDirectory()&&entry.name!=='__pycache__')await visit(name)
  else if(entry.isFile()&&/\.(py|json)$/.test(entry.name))pins[name]=sha(await readFile(join(root,name)))
 }}
 for(const path of['packages/blendlink/blender','packages/blender-addon'])await visit(path)
 for(const path of['experiments/compositor-wave-axis/policy.mjs','scripts/lib/node-port-python.mjs','scripts/lib/native-proof-archive.mjs','scripts/node-port-blender.mjs'])pins[path]=sha(await readFile(join(root,path)))
 return pins
}
const pins=await sourcePins(),launcher=await createNodePortBlenderLauncher({blender:process.env.BLENDLINK_BLENDER??'/Applications/Blender.app/Contents/MacOS/Blender',directory:join(directory,'active'),timeoutMs:120000})
let output=''
try{
 await new Promise((done,reject)=>{
  const child=spawn(launcher.executable,['--background','--factory-startup','-t','1','--python-exit-code','1','--python',script],{cwd:root,stdio:['ignore','pipe','pipe']})
  const consume=bytes=>{output+=bytes.toString();if(output.length>4*1024*1024){child.kill('SIGTERM');reject(Error('Wave source policy exceeded its output bound'))}}
  child.stdout.on('data',consume);child.stderr.on('data',consume)
  child.once('error',reject);child.once('close',code=>code===0?done():reject(Error('Wave source policy failed: '+code)))
 })
 const lines=output.split('\n').filter(line=>line.startsWith('SCENETOWEB_COMPOSITOR_WAVE_AXIS_POLICY_PASSED '))
 assert.equal(lines.length,1,'Missing or repeated Wave source policy sentinel')
 const policy=JSON.parse(lines[0].split(' ').slice(1).join(' '))
 assert.equal(policy.positive.length,18);assert.equal(policy.refusals.length,32)
 assert.equal(new Set([...policy.positive,...policy.refusals]).size,50)
 assert.equal(policy.nativeRenders,0);assert.equal(policy.gpuInitializations,0);assert.equal(policy.injectedReaderWordControls,3);assert.equal(policy.supportCredit,0)
 assert.deepEqual(await sourcePins(),pins,'Wave source policy inputs changed during execution')
 await launcher.finalize();const archive={identity:launcher.identity,proof:await archiveNativeLauncher(launcher,directory,true)}
 await validateNativeArchive(archive,directory,{expectedScripts:[{path:script,invocations:1}],expectedFinalSources:[],helperInputs:{helper:join(root,'scripts/lib/node-port-python.mjs'),bridge:join(root,'scripts/node-port-blender.mjs')}})
 await writeFile(join(directory,'archive.json'),JSON.stringify(archive,null,2)+'\n')
 await writeFile(join(directory,'policy.json'),JSON.stringify({schemaVersion:1,status:'PASSED_SOURCE_READINESS_ONLY',sourcePins:pins,policy,archiveSha256:sha(await readFile(join(directory,'archive.json'))),logSha256:sha(Buffer.from(output)),supportCredit:0},null,2)+'\n')
 console.log(JSON.stringify({directory,positives:18,refusals:32,nativeRenders:0,supportCredit:0}))
}finally{
 await writeFile(join(directory,'native.log'),output)
 await launcher.dispose()
}
