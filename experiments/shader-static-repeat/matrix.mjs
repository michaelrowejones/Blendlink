import{spawn}from'node:child_process'
import{mkdir}from'node:fs/promises'
import{captureRuntimeTransaction}from'../../scripts/lib/runtime-transaction-snapshot.mjs'
import{join,resolve}from'node:path'
const root=resolve(import.meta.dirname,'../..'),destination=resolve(process.argv[2]??join(root,'artifacts/verification-static-repeat'))
const run=(args,env=process.env)=>new Promise((resolve,reject)=>{const child=spawn(process.execPath,args,{cwd:root,env,stdio:'inherit'});child.on('error',reject);child.on('close',code=>code===0?resolve():reject(new Error('Repeat matrix failed '+code)))})
const preflight=await import('../../scripts/lib/browser-proof-contract.mjs')
await preflight.preflightBrowserProofContracts(root,['shader-static-repeat'])
await run(['--test','scripts/lib/browser-proof-contract.test.mjs'])
await run(['--test','experiments/shader-static-repeat/protocol.test.mjs'])
await mkdir(destination,{recursive:true})
const transaction=await captureRuntimeTransaction({root,directory:join(destination,'runtime-transaction'),label:'Static Repeat matrix'})
const transactionEnv={...process.env,SCENETOWEB_RUNTIME_TRANSACTION:transaction.path,SCENETOWEB_RUNTIME_TRANSACTION_SHA256:transaction.sha256}
await run(['experiments/shader-static-repeat/capture.mjs',destination])
for(const profile of['metal','software'])for(const final of[false,true]){
 const env={...transactionEnv,SCENETOWEB_REPEAT_REFERENCES:destination,BLENDLINK_TEST_PROFILE:profile,BLENDLINK_TEST_CHROMIUM_ARGS:profile==='metal'?'[]':'["--use-angle=swiftshader","--use-webgpu-adapter=swiftshader"]'}
 if(profile==='metal')env.BLENDLINK_TEST_CHROMIUM_CHANNEL='chromium';else delete env.BLENDLINK_TEST_CHROMIUM_CHANNEL
 await run(['experiments/shader-static-repeat/run.mjs','--built',...(final?['--final']:[])],env)
}
await run(['experiments/shader-static-repeat/verify.mjs',destination,join(destination,'qualified.json')],transactionEnv)
