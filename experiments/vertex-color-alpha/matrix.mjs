import{spawn}from'node:child_process'
import{resolve,join}from'node:path'
import{preflightBrowserProofContracts}from'../../scripts/lib/browser-proof-contract.mjs'
process.env.SCENETOWEB_ALPHA_SOURCE=process.argv[3]??process.env.SCENETOWEB_ALPHA_SOURCE??'vertex'
const root=resolve(import.meta.dirname,'../..'),directory=resolve(process.argv[2])
await preflightBrowserProofContracts(root,['vertex-color-alpha'])
const run=(args,env=process.env)=>new Promise((done,reject)=>{
 const child=spawn(process.execPath,args,{cwd:root,env,stdio:'inherit'}),timer=setTimeout(()=>child.kill('SIGTERM'),300000)
 child.once('error',error=>{clearTimeout(timer);reject(error)});child.once('close',code=>{clearTimeout(timer);code===0?done():reject(Error('Vertex Alpha matrix failed '+code))})
})
await run(['--test','experiments/vertex-color-alpha/protocol.test.mjs','scripts/lib/browser-proof-contract.test.mjs'])
await run(['experiments/vertex-color-alpha/capture.mjs',directory])
for(const profile of['metal','software'])for(const final of[false,true]){
 const env={...process.env,BLENDLINK_TEST_PROFILE:profile,BLENDLINK_TEST_CHROMIUM_ARGS:profile==='metal'?'[]':'["--use-angle=swiftshader","--use-webgpu-adapter=swiftshader"]'}
 if(profile==='metal')env.BLENDLINK_TEST_CHROMIUM_CHANNEL='chromium';else delete env.BLENDLINK_TEST_CHROMIUM_CHANNEL
 await run(['experiments/vertex-color-alpha/run.mjs',directory,...(final?['--final']:[])],env)
}
await run(['experiments/vertex-color-alpha/verify.mjs',directory,join(directory,'qualified.json')])
