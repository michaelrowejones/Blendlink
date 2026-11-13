// Serial native + actual-browser GPU queue; build once before starting this matrix.
import {spawn} from 'node:child_process'
import {join,resolve} from 'node:path'
const root=resolve(import.meta.dirname,'../..'),destination=resolve(process.argv[2]??join(root,'artifacts/verification-image-coordinates'))
const run=(args,env)=>new Promise((resolve,reject)=>{const child=spawn(process.execPath,args,{cwd:root,env,stdio:'inherit'});child.on('error',reject);child.on('close',code=>code===0?resolve():reject(new Error('Pixel matrix failed '+code)))})
for(const device of ['CPU','GPU']){
 const directory=join(destination,device.toLowerCase())
 await run(['experiments/compositor-image-coordinates/capture.mjs',device,directory],process.env)
 for(const profile of ['metal','software'])for(const final of [false,true]){
  const env={...process.env,BLENDLINK_IMAGE_COORDINATES_REFERENCES:directory,BLENDLINK_TEST_PROFILE:profile,BLENDLINK_TEST_CHROMIUM_ARGS:profile==='metal'?'[]':'["--use-angle=swiftshader","--use-webgpu-adapter=swiftshader"]'}
  if(profile==='metal')env.BLENDLINK_TEST_CHROMIUM_CHANNEL='chromium';else delete env.BLENDLINK_TEST_CHROMIUM_CHANNEL
  await run(['experiments/compositor-image-coordinates/run.mjs','--built',...(final?['--final']:[])],env)
 }
}
await run(['experiments/compositor-image-coordinates/verify.mjs',destination,join(destination,'qualified.json')],process.env)
