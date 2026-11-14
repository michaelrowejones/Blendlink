// Build once at a shared frozen root before this serial actual-native/browser matrix.
import{spawn}from'node:child_process'
import{join,resolve}from'node:path'
import{preflightBrowserProofContracts}from'../../scripts/lib/browser-proof-contract.mjs'
const root=resolve(import.meta.dirname,'../..'),destination=resolve(process.argv[2]??join(root,'artifacts/verification-box-mask'))
await preflightBrowserProofContracts(root,['compositor-box-mask'])
const run=(args,env=process.env)=>new Promise((done,reject)=>{const child=spawn(process.execPath,args,{cwd:root,env,stdio:'inherit'}),timer=setTimeout(()=>child.kill('SIGTERM'),300_000);child.once('error',error=>{clearTimeout(timer);reject(error)});child.once('close',code=>{clearTimeout(timer);code===0?done():reject(Error('Box matrix command failed '+code))})})
await run(['--test','scripts/lib/browser-proof-contract.test.mjs','experiments/compositor-box-mask/protocol.test.mjs'])
const directory=join(destination,'cpu')
await run(['experiments/compositor-box-mask/capture.mjs','CPU',directory])
for(const profile of['metal','software'])for(const final of[false,true]){
 const env={...process.env,SCENETOWEB_BOX_MASK_REFERENCES:directory,BLENDLINK_TEST_PROFILE:profile,BLENDLINK_TEST_CHROMIUM_ARGS:profile==='metal'?'[]':'["--use-angle=swiftshader","--use-webgpu-adapter=swiftshader"]'}
 if(profile==='metal')env.BLENDLINK_TEST_CHROMIUM_CHANNEL='chromium';else delete env.BLENDLINK_TEST_CHROMIUM_CHANNEL
 await run(['experiments/compositor-box-mask/run.mjs','--built',...(final?['--final']:[])],env)
}
await run(['experiments/compositor-box-mask/verify.mjs',destination,join(destination,'qualified.json')])
