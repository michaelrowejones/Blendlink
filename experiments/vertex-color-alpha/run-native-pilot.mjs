import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {mkdir,open,readFile,writeFile} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {createHash} from 'node:crypto'
import {createNodePortBlenderLauncher} from '../../scripts/lib/node-port-python.mjs'
import {archiveNativeLauncher} from '../../scripts/lib/native-proof-archive.mjs'

const root=resolve(import.meta.dirname,'../..'),output=resolve(process.argv[2]),script=join(import.meta.dirname,'native_pilot.py')
const sha=bytes=>createHash('sha256').update(bytes).digest('hex'),sourceSha256=sha(await readFile(script))
await mkdir(output)
const launcher=await createNodePortBlenderLauncher({blender:'/Applications/Blender.app/Contents/MacOS/Blender',directory:join(output,'native-active')})
let archived=false
try{
  const log=await open(join(output,'native.log'),'wx')
  try{
    const code=await new Promise((done,reject)=>{
      const child=spawn(launcher.executable,['--background','--factory-startup','-t','1','--python-exit-code','1','--python',script],
        {cwd:root,env:{...process.env,SCENETOWEB_VERTEX_ALPHA_PILOT:output},stdio:['ignore',log.fd,log.fd]})
      const timeout=setTimeout(()=>{child.kill('SIGTERM');setTimeout(()=>child.kill('SIGKILL'),400).unref()},120000)
      child.once('error',reject);child.once('close',code=>{clearTimeout(timeout);done(code)})
    });assert.equal(code,0,'native pilot failed; retain native.log')
  }finally{await log.close()}
  await launcher.finalize();assert.equal(sha(await readFile(script)),sourceSha256)
  const packet={identity:launcher.identity,proof:await archiveNativeLauncher(launcher,output,true)};archived=true
  await writeFile(join(output,'native-python-proof.json'),JSON.stringify(packet,null,2)+'\n')
  await writeFile(join(output,'pilot-source.json'),JSON.stringify({script,sha256:sourceSha256,FinalCredit:0,browserCredit:0,portCredit:0},null,2)+'\n')
  const code=await new Promise((done,reject)=>{
    const child=spawn(process.execPath,[join(import.meta.dirname,'read-native-pilot.mjs'),output],{cwd:root,env:process.env,stdio:'inherit'})
    child.once('error',reject);child.once('close',done)
  });assert.equal(code,0,'independent native pilot reader failed')
}finally{try{if(!archived)await archiveNativeLauncher(launcher,output,false)}finally{await launcher.dispose()}}
