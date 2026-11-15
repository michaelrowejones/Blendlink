/* SPDX-License-Identifier: MIT */
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {readFile,writeFile,mkdir,realpath} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {createNodePortBlenderLauncher} from '../../scripts/lib/node-port-python.mjs'
import {archiveNativeLauncher} from '../../scripts/lib/native-proof-archive.mjs'
import {assertSources,assertBaseline,assertNative,assertProgram,archiveDirectory,statuses} from './protocol.mjs'
import {nativeInputs} from './inputs.mjs'
const root=resolve(import.meta.dirname,'../..'),stage=process.argv[2],requested=resolve(process.argv[3])
assert.ok(['sources','references'].includes(stage))
if(stage==='sources'){await mkdir(resolve(requested,'..'),{recursive:true});await mkdir(requested)}
const out=await realpath(requested)
if(stage==='references'){
 const baselines=JSON.parse(await readFile(join(out,'baselines.json')));assert.equal(baselines.status,statuses.allBaselines)
 assert.deepEqual(baselines.profiles.map(report=>report.profile),['metal','software']);for(const report of baselines.profiles)assertBaseline(report,report.profile)
}
const inputs=await nativeInputs(root)
await writeFile(join(out,stage+'-source-inputs.json'),JSON.stringify(inputs,null,2)+'\n')
const archive=archiveDirectory(out,stage);await mkdir(archive)
const launcher=await createNodePortBlenderLauncher({blender:process.env.BLENDLINK_BLENDER??'/Applications/Blender.app/Contents/MacOS/Blender',directory:join(out,stage+'-active'),timeoutMs:300000})
let complete=false,log=''
const run=(command,args)=>new Promise((done,reject)=>{
 const child=spawn(command,args,{cwd:root,env:{...process.env,SCENETOWEB_DISPLACE_REFERENCES:out,BLENDLINK_BLENDER:launcher.executable},stdio:['ignore','pipe','pipe']})
 const timer=setTimeout(()=>child.kill('SIGTERM'),300000)
 const consume=bytes=>{process.stdout.write(bytes);log+=bytes.toString();if(log.length>32*1024*1024)child.kill('SIGTERM')}
 child.stdout.on('data',consume);child.stderr.on('data',consume);child.once('error',reject)
 child.once('close',code=>{clearTimeout(timer);code===0?done():reject(Error('Displace '+stage+' capture failed '+code))})
})
try{
 await run(launcher.executable,['--background','--factory-startup','-t','1','--python-exit-code','1','--python',join(import.meta.dirname,stage==='sources'?'source.py':'reference.py'),'--',out])
 if(stage==='sources'){
  const source=assertSources(JSON.parse(await readFile(join(out,'sources.json'))))
  // Validate every actual serialized native program before any Final export.
  for(const row of source.rows)assertProgram(JSON.parse(await readFile(join(out,row.programFile))),row)
  await run(process.execPath,['node_modules/vitest/vitest.mjs','run','experiments/compositor-displace-single/export.test.ts'])
 }else assertNative(JSON.parse(await readFile(join(out,'native.json'))))
 assert.deepEqual(await nativeInputs(root),inputs,'Displace native inputs changed during capture')
 await launcher.finalize();complete=true
}finally{
 try{await writeFile(join(out,stage+'-native.log'),log);await writeFile(join(out,stage+'-native-archive.json'),JSON.stringify({identity:launcher.identity,proof:await archiveNativeLauncher(launcher,archive,complete)},null,2)+'\n')}
 finally{await launcher.dispose()}
}
console.log('CAPTURED_DISPLACE_STAGE '+stage+' '+out)
