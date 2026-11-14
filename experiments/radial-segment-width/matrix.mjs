// Serial native + actual-browser GPU queue; build once before starting this matrix.
import {spawn} from 'node:child_process'
import {mkdir} from 'node:fs/promises'
import {captureRuntimeTransaction} from '../../scripts/lib/runtime-transaction-snapshot.mjs'
import {join,resolve} from 'node:path'
const root=resolve(import.meta.dirname,'../..'),destination=resolve(process.argv[2]??join(root,'artifacts/verification-radial-segment-width'))
const preflight=await import('../../scripts/lib/browser-proof-contract.mjs')
await preflight.preflightBrowserProofContracts(root,['radial-segment-width'])
const run=(args,env)=>new Promise((resolve,reject)=>{const child=spawn(process.execPath,args,{cwd:root,env,stdio:'inherit'});child.on('error',reject);child.on('close',code=>code===0?resolve():reject(new Error('Radial Tiling Segment Width matrix failed '+code)))})
await run(['--test','scripts/lib/browser-proof-contract.test.mjs'],process.env)
await run(['--test','experiments/radial-segment-width/protocol.test.mjs'],process.env)
await mkdir(destination,{recursive:true})
const runtimeTransaction=await captureRuntimeTransaction({root,directory:join(destination,'runtime-transaction'),label:'radial-segment-width matrix'})
const transactionEnv={...process.env,SCENETOWEB_RUNTIME_TRANSACTION:runtimeTransaction.path,SCENETOWEB_RUNTIME_TRANSACTION_SHA256:runtimeTransaction.sha256}
for(const device of ['CPU','GPU']){
 const directory=join(destination,device.toLowerCase())
 await run(['experiments/radial-segment-width/capture.mjs',device,directory],process.env)
 for(const profile of ['metal','software'])for(const final of [false,true]){
  const env={...transactionEnv,SCENETOWEB_RADIAL_WIDTH_REFERENCES:directory,BLENDLINK_TEST_PROFILE:profile,BLENDLINK_TEST_CHROMIUM_ARGS:profile==='metal'?'[]':'["--use-angle=swiftshader","--use-webgpu-adapter=swiftshader"]'}
  if(profile==='metal')env.BLENDLINK_TEST_CHROMIUM_CHANNEL='chromium';else delete env.BLENDLINK_TEST_CHROMIUM_CHANNEL
  await run(['experiments/radial-segment-width/run.mjs','--built',...(final?['--final']:[])],env)
 }
}
await run(['experiments/radial-segment-width/verify.mjs',destination,join(destination,'qualified.json')],transactionEnv)
