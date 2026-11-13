// Bounded commands; qualification always owns fresh guarded native and Final calls.
import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {mkdir,writeFile,readFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {createNodePortBlenderLauncher} from '../../scripts/lib/node-port-python.mjs'
import {captureRuntimeTransaction} from '../../scripts/lib/runtime-transaction-snapshot.mjs'
import {archiveNativeLauncher} from '../../scripts/lib/native-proof-archive.mjs'
const root=resolve(import.meta.dirname,'../..'),args=process.argv.slice(2),output=resolve(process.env.SCENETOWEB_SWITCH_EVIDENCE??'artifacts/verification-switch-family'),blender=process.env.BLENDLINK_BLENDER??'/Applications/Blender.app/Contents/MacOS/Blender'
assert.ok(args.every(x=>['--built'].includes(x)));assert.ok(args.includes('--built'))
const preflight=await import('../../scripts/lib/browser-proof-contract.mjs')
await preflight.preflightBrowserProofContracts(root,['static-switch-family'])
const contracts=spawnSync(process.execPath,['--test','scripts/lib/browser-proof-contract.test.mjs'],{cwd:root,stdio:'inherit'});assert.equal(contracts.status,0,'Browser proof contract preflight failed')
await mkdir(output,{recursive:true});const steps=[];let runtimeTransaction
await assert.rejects(readFile(join(output,'native-python-proof.json')),{code:'ENOENT'},'Use a fresh guarded transaction')
const launcher=await createNodePortBlenderLauncher({blender,directory:join(output,'native-python-active'),identityPolicy:process.env.SCENETOWEB_NATIVE_IDENTITY_POLICY??'per-invocation-sha256-v1'});let archived=false
async function archive(complete){if(complete)await launcher.finalize();const proof=await archiveNativeLauncher(launcher,output,complete);await writeFile(join(output,'native-python-proof.json'),JSON.stringify({identity:launcher.identity,proof},null,2)+'\n');archived=true}
async function run(name,exe,argv,env={}){const start=performance.now(),r=spawnSync(exe,argv,{cwd:root,env:{...process.env,...(runtimeTransaction?{SCENETOWEB_RUNTIME_TRANSACTION:runtimeTransaction.path,SCENETOWEB_RUNTIME_TRANSACTION_SHA256:runtimeTransaction.sha256}:{}),...env},encoding:'utf8',maxBuffer:32*1024*1024,timeout:600000});await writeFile(join(output,name+'.log'),(r.stdout??'')+(r.stderr??'')+String(r.error??''));steps.push({name,milliseconds:Math.round(performance.now()-start),exitCode:r.status});assert.equal(r.status,0,name+' failed; inspect retained log');console.log(name+' passed')}
try{
 const start=performance.now();runtimeTransaction=await captureRuntimeTransaction({root,directory:join(output,'runtime-transaction'),label:'Static Switch transaction'});steps.push({name:'runtime-attestation',milliseconds:Math.round(performance.now()-start),exitCode:0})
 await run('protocol',process.execPath,['--test','experiments/static-switch-family/protocol.test.mjs'])
 await run('policy',launcher.executable,['--background','--factory-startup','--python-exit-code','1','--python','packages/blender-addon/tests/static_selection_check.py'])
 for(const context of ['shader','CPU','GPU']){
  const folder=join(output,context.toLowerCase()),env={SCENETOWEB_SWITCH_CONTEXT:context,SCENETOWEB_SWITCH_REFERENCES:folder,BLENDLINK_BLENDER:launcher.executable};await mkdir(folder,{recursive:true})
  {await assert.rejects(readFile(join(folder,'qualification.json')),{code:'ENOENT'},'Start native qualification in a fresh output directory');await run(context+'-native',launcher.executable,['--background','--factory-startup','--python-exit-code','1','--python','experiments/static-switch-family/reference.py'],env);await run(context+'-export',process.execPath,['node_modules/vitest/vitest.mjs','run','experiments/static-switch-family/export.test.ts'],env)}
  for(const profile of ['metal','software'])for(const final of [false,true])await run(context+'-'+profile+'-'+(final?'final':'raw'),process.execPath,['experiments/static-switch-family/run.mjs','--built',...(final?['--final']:[])],{...env,BLENDLINK_TEST_PROFILE:profile,BLENDLINK_TEST_CHROMIUM_CHANNEL:'chromium',BLENDLINK_TEST_CHROMIUM_ARGS:JSON.stringify(profile==='software'?['--use-angle=swiftshader','--use-webgpu-adapter=swiftshader']:[])})
 }
 await archive(true)
 await run('closed',process.execPath,['experiments/static-switch-family/verify.mjs'])
}finally{try{if(!archived)await archive(false)}finally{await launcher.dispose();await writeFile(join(output,'timings.json'),JSON.stringify({reuseNative:false,steps},null,2)+'\n')}}
