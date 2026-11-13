// One source-device capture and real saved Final publication, with fresh native Python caches.
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {cp,mkdir,readFile,writeFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {createNodePortBlenderLauncher} from '../../scripts/lib/node-port-python.mjs'
import {assertRelativeFinal,assertRelativeQualification} from './protocol.mjs'
import {hash} from '../../scripts/lib/runtime-provenance.mjs'
const root=resolve(import.meta.dirname,'../..'),device=process.argv[2],destination=resolve(process.argv[3]??join(root,'artifacts/verification-relative-to-pixel',String(device).toLowerCase()))
assert.ok(['CPU','GPU'].includes(device))
await mkdir(destination,{recursive:true})
const launcher=await createNodePortBlenderLauncher({blender:process.env.BLENDLINK_BLENDER??'/Applications/Blender.app/Contents/MacOS/Blender',directory:join(destination,'native-launchers')})
const env={...process.env,BLENDLINK_RELATIVE_TO_PIXEL_DEVICE:device,BLENDLINK_RELATIVE_TO_PIXEL_REFERENCES:destination,BLENDLINK_RELATIVE_TO_PIXEL_BUILT:'1',BLENDLINK_BLENDER:launcher.executable}
const run=(executable,args)=>new Promise((resolve,reject)=>{const child=spawn(executable,args,{cwd:root,env,stdio:'inherit'});child.on('error',reject);child.on('close',code=>code===0?resolve():reject(new Error('Proof command failed '+code)))})
try{
 await run(launcher.executable,['--background','--factory-startup','-t','1','--python-exit-code','1','--python',join(root,'packages/blender-addon/tests/compositor_relative_to_pixel_check.py')])
 const native=assertRelativeQualification(JSON.parse(await readFile(join(destination,'qualification.json'),'utf8')))
 await run(process.execPath,['node_modules/vitest/vitest.mjs','run','experiments/compositor-relative-to-pixel/export.test.ts'])
 assertRelativeFinal(JSON.parse(await readFile(join(destination,'final-proof.json'),'utf8')),native,{built:true,nativeSha256:hash(await readFile(join(destination,'qualification.json')))})
 const receipts=JSON.parse(await readFile(join(destination,'final-proof.json'),'utf8'))
 receipts.nativeLauncherIdentity=launcher.identity
 receipts.nativeInvocationReceipts=[]
 const {readdir}=await import('node:fs/promises')
 for(const file of (await readdir(join(launcher.directory,'invocations'))).sort()){
  const receipt=JSON.parse(await readFile(join(launcher.directory,'invocations',file),'utf8'))
  assert.equal(receipt.result.error,null);assert.equal(receipt.result.timedOut,false);assert.equal(receipt.result.aborted,false);assert.equal(receipt.result.exitCode,0);assert.equal(receipt.result.cacheDisposed,true)
  receipts.nativeInvocationReceipts.push(receipt)
 }
 assert.ok(receipts.nativeInvocationReceipts.some(receipt=>receipt.result.pythonGuardApplied))
 await writeFile(join(destination,'final-proof.json'),JSON.stringify(receipts,null,2)+'\n')
 console.log('SCENETOWEB_RELATIVE_CAPTURE_PASSED '+JSON.stringify({device,native:native.cases.length,final:receipts.rows.length}))
}finally{await launcher.dispose()}
