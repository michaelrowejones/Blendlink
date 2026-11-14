// One source-device capture and real saved Final publication, with fresh native Python caches.
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {cp,mkdir,readFile,writeFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {createNodePortBlenderLauncher} from '../../scripts/lib/node-port-python.mjs'
import {assertFinal,assertQualification} from './protocol.mjs'
import {hash} from '../../scripts/lib/runtime-provenance.mjs'
const root=resolve(import.meta.dirname,'../..'),device=process.argv[2],destination=resolve(process.argv[3]??join(root,'artifacts/verification-box-mask',String(device).toLowerCase()))
assert.equal(device,'CPU')
await mkdir(destination,{recursive:true})
const launcher=await createNodePortBlenderLauncher({blender:process.env.BLENDLINK_BLENDER??'/Applications/Blender.app/Contents/MacOS/Blender',directory:join(destination,'native-launchers')})
const env={...process.env,SCENETOWEB_BOX_MASK_DEVICE:device,SCENETOWEB_BOX_MASK_REFERENCES:destination,BLENDLINK_BOX_MASK_BUILT:'1',BLENDLINK_BLENDER:launcher.executable}
const run=(executable,args)=>new Promise((resolve,reject)=>{const child=spawn(executable,args,{cwd:root,env,stdio:'inherit'});const timer=setTimeout(()=>child.kill('SIGTERM'),240_000);child.on('error',error=>{clearTimeout(timer);reject(error)});child.on('close',code=>{clearTimeout(timer);code===0?resolve():reject(new Error('Proof command failed '+code))})})
try{
 await run(launcher.executable,['--background','--factory-startup','-t','1','--python-exit-code','1','--python',join(root,'packages/blender-addon/tests/compositor_box_mask_check.py')])
 const native=assertQualification(JSON.parse(await readFile(join(destination,'qualification.json'),'utf8')))
 await run(process.execPath,['node_modules/vitest/vitest.mjs','run','experiments/compositor-box-mask/export.test.ts'])
 assertFinal(JSON.parse(await readFile(join(destination,'final-proof.json'),'utf8')),native,{built:true,nativeSha256:hash(await readFile(join(destination,'qualification.json')))})
 const receipts=JSON.parse(await readFile(join(destination,'final-proof.json'),'utf8'))
 const {archiveNativeLauncher}=await import('../../scripts/lib/native-proof-archive.mjs')
 receipts.nativeArchive={identity:launcher.identity,proof:await archiveNativeLauncher(launcher,destination,true)}
 await writeFile(join(destination,'final-proof.json'),JSON.stringify(receipts,null,2)+'\n')
 console.log('SCENETOWEB_BOX_MASK_CAPTURE_PASSED '+JSON.stringify({device,native:native.cases.length,final:receipts.rows.length}))
}finally{await launcher.dispose()}
