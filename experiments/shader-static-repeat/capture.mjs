import assert from'node:assert/strict'
import{spawn}from'node:child_process'
import{mkdir,readFile,readdir,writeFile,cp}from'node:fs/promises'
import{join,resolve}from'node:path'
import{createNodePortBlenderLauncher}from'../../scripts/lib/node-port-python.mjs'
import{hash}from'../../scripts/lib/runtime-provenance.mjs'
import{assertQualification,assertFinal}from'./protocol.mjs'
const root=resolve(import.meta.dirname,'../..'),destination=resolve(process.argv[2]);await mkdir(destination,{recursive:true})
const launcher=await createNodePortBlenderLauncher({blender:process.env.BLENDLINK_BLENDER??'/Applications/Blender.app/Contents/MacOS/Blender',directory:join(destination,'native-launchers')})
const env={...process.env,SCENETOWEB_REPEAT_REFERENCES:destination,BLENDLINK_BLENDER:launcher.executable}
const run=(executable,args)=>new Promise((resolve,reject)=>{const child=spawn(executable,args,{cwd:root,env,stdio:'inherit'});child.on('error',reject);child.on('close',code=>code===0?resolve():reject(new Error('Repeat proof command failed '+code)))})
try{
 for(const file of['packages/blender-addon/tests/repeat_static_check.py','experiments/shader-static-repeat/reference.py'])await run(launcher.executable,['--background','--factory-startup','-t','1','--python-exit-code','1','--python',join(root,file)])
 const native=assertQualification(JSON.parse(await readFile(join(destination,'qualification.json'))))
 await run(process.execPath,['node_modules/vitest/vitest.mjs','run','experiments/shader-static-repeat/export.test.ts'])
 const final=assertFinal(JSON.parse(await readFile(join(destination,'final-proof.json'))),native,hash(await readFile(join(destination,'qualification.json'))))
 final.nativeLauncherIdentity=launcher.identity;final.nativeInvocationReceipts=[]
 for(const name of(await readdir(join(launcher.directory,'invocations'))).sort()){
  const receipt=JSON.parse(await readFile(join(launcher.directory,'invocations',name)));assert.equal(receipt.result.exitCode,0);assert.equal(receipt.result.cacheDisposed,true);final.nativeInvocationReceipts.push(receipt)
 }
 await cp(launcher.directory,join(destination,'native-launcher-archive'),{recursive:true});await writeFile(join(destination,'final-proof.json'),JSON.stringify(final,null,2)+'\n')
 console.log('SCENETOWEB_STATIC_REPEAT_CAPTURED '+JSON.stringify({native:native.cases.length,final:final.rows.length}))
}finally{await launcher.dispose()}
