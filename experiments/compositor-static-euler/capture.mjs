// One source-device capture and real saved Final publication, with fresh native Python caches.
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {mkdir,readFile,writeFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {createNodePortBlenderLauncher} from '../../scripts/lib/node-port-python.mjs'
import {assertFinal,assertQualification,assertPolicy} from './protocol.mjs'
import {hash} from '../../scripts/lib/runtime-provenance.mjs'
const root=resolve(import.meta.dirname,'../..'),device=process.argv[2],destination=resolve(process.argv[3]??join(root,'artifacts/verification-static-euler',String(device).toLowerCase()))
assert.equal(device,'CPU')
await mkdir(resolve(destination,'..'),{recursive:true});await mkdir(destination)
const launcher=await createNodePortBlenderLauncher({blender:process.env.BLENDLINK_BLENDER??'/Applications/Blender.app/Contents/MacOS/Blender',directory:join(destination,'native-launchers')})
const env={...process.env,SCENETOWEB_STATIC_EULER_POLICY:join(destination,'policy.json'),SCENETOWEB_STATIC_EULER_DEVICE:device,SCENETOWEB_STATIC_EULER_REFERENCES:destination,BLENDLINK_STATIC_EULER_BUILT:'1',BLENDLINK_BLENDER:launcher.executable}
const run=(executable,args)=>new Promise((resolve,reject)=>{const child=spawn(executable,args,{cwd:root,env,stdio:'inherit'});const timer=setTimeout(()=>{child.kill('SIGTERM');setTimeout(()=>child.kill('SIGKILL'),400).unref()},240_000);child.on('error',error=>{clearTimeout(timer);reject(error)});child.on('close',code=>{clearTimeout(timer);code===0?resolve():reject(new Error('Proof command failed '+code))})})
let archived=false
try{
 await run(launcher.executable,['--background','--factory-startup','-t','1','--python-exit-code','1','--python',join(root,'experiments/compositor-static-euler/policy.py')])
 assertPolicy(JSON.parse(await readFile(join(destination,'policy.json'),'utf8')))
 await run(launcher.executable,['--background','--factory-startup','-t','1','--python-exit-code','1','--python',join(root,'experiments/compositor-static-euler/reference.py')])
 const native=assertQualification(JSON.parse(await readFile(join(destination,'qualification.json'),'utf8')))
 await run(process.execPath,['node_modules/vitest/vitest.mjs','run','experiments/compositor-static-euler/export.test.ts'])
 assertFinal(JSON.parse(await readFile(join(destination,'final-proof.json'),'utf8')),native,{built:true,nativeSha256:hash(await readFile(join(destination,'qualification.json')))})
 const receipts=JSON.parse(await readFile(join(destination,'final-proof.json'),'utf8'))
 const {archiveNativeLauncher}=await import('../../scripts/lib/native-proof-archive.mjs')
 await launcher.finalize();receipts.nativeArchive={identity:launcher.identity,proof:await archiveNativeLauncher(launcher,destination,true)};archived=true
 await writeFile(join(destination,'final-proof.json'),JSON.stringify(receipts,null,2)+'\n')
 console.log('SCENETOWEB_STATIC_EULER_CAPTURE_PASSED '+JSON.stringify({device,native:native.cases.length,final:receipts.rows.length}))
}finally{try{if(!archived){const{archiveNativeLauncher}=await import('../../scripts/lib/native-proof-archive.mjs');await writeFile(join(destination,'failed-native-proof.json'),JSON.stringify({identity:launcher.identity,proof:await archiveNativeLauncher(launcher,destination,false)},null,2)+'\n')}}finally{await launcher.dispose()}}
