import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,readFile,writeFile,rm,readdir,realpath} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {spawnSync} from 'node:child_process'
import {createNodePortBlenderLauncher} from './node-port-python.mjs'
import {archiveNativeLauncher,validateNativeArchive,assertGuardedNativeScript} from './native-proof-archive.mjs'
import {nodePortHash,nodePortFileIdentity} from './node-port-contract.mjs'
const root=resolve(import.meta.dirname,'../..')
test('script census parses actions only before the delimiter and refuses extra or substituted Python actions',()=>{
 const prefix='/owned/cache',guard='import sys; sys.pycache_prefix='+JSON.stringify(prefix)+'; sys.dont_write_bytecode=True'
 const args=['--background','--python-expr',guard,'--python','/reviewed/reference.py','--','--python-expr','opaque script argument']
 assert.equal(assertGuardedNativeScript(args,prefix),'/reviewed/reference.py')
 for(const bad of [[...args.slice(0,5),'--python-expr','unreviewed()'],['--python-expr',guard,'--python-text','text'],['--python','reference.py','--python-expr',guard],['--python-expr',guard,'--python','--']])assert.throws(()=>assertGuardedNativeScript(bad,prefix))
})
test('actual launcher policy uses a fresh prefix before native imports, archive survives disposal', {skip:!process.env.BLENDLINK_TEST_GUARDED_NATIVE},async()=>{
 const directory=await mkdtemp(join(tmpdir(),'switch-guard-')),launcher=await createNodePortBlenderLauncher({blender:process.env.BLENDLINK_TEST_GUARDED_NATIVE,directory:join(directory,'active')})
 try{
  const r=spawnSync(launcher.executable,['--background','--factory-startup','--python-exit-code','1','--python-expr',"import sys; assert sys.pycache_prefix and sys.dont_write_bytecode; print('FRESH_PREFIX_PASSED')"],{encoding:'utf8',timeout:120000,maxBuffer:4*1024*1024});assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/FRESH_PREFIX_PASSED/)
  const proof=await archiveNativeLauncher(launcher,directory,true);assert.equal(proof.pythonInvocations,1);assert.equal(proof.invocations[0].result.cacheDisposed,true);await launcher.dispose();assert.ok((await readdir(join(directory,'native-python-proof'))).includes('launcher.json'))
 }finally{await launcher.dispose();await rm(directory,{recursive:true,force:true})}
})
test('closed archive requires all Final sources, fresh prefixes, guarded references and untampered bytes',async()=>{
 const evidence=await mkdtemp(join(tmpdir(),'switch-archive-')),directory=join(evidence,'native-python-proof'),active=join(evidence,'deleted-active');await mkdir(join(directory,'invocations'),{recursive:true})
 const inputs={helper:join(root,'scripts/lib/node-port-python.mjs'),bridge:join(root,'scripts/node-port-blender.mjs')},native=await nodePortFileIdentity(process.execPath)
 try{
  for(const[name,file]of Object.entries({helper:'lib/node-port-python.mjs',bridge:'node-port-blender.mjs',launcher:'blender-proof'})){await mkdir(join(directory,file,'..'),{recursive:true});await writeFile(join(directory,file),name==='launcher'?'launcher':await readFile(inputs[name]))}
  const identity={kind:'blendlink-proof-native-python-v1',native,node:native};for(const[name,file]of Object.entries({helper:'lib/node-port-python.mjs',bridge:'node-port-blender.mjs',launcher:'blender-proof'})){const bytes=await readFile(join(directory,file));identity[name]={path:join(active,file),bytes:bytes.length,sha256:nodePortHash(bytes)}}
  const config={owned:active,kind:identity.kind,native,node:native,helper:identity.helper,bridge:identity.bridge};await writeFile(join(directory,'launcher.json'),JSON.stringify(config));identity.configuration={path:join(active,'launcher.json'),sha256:nodePortHash(await readFile(join(directory,'launcher.json')))}
  const blend=join(evidence,'authored.blend');await writeFile(blend,'saved scene');const source=await realpath(blend),expectedFinalSources=[source],options={expectedFinalSources,referenceScript:'native-reference.py',policyScript:'policy.py',helperInputs:inputs}
  const invocations=[]
  for(let index=0;index<5;index++){
   const prefix=join(active,'python-cache-'+index),script=index===0?'/dist/export_scene.py':index===1?'policy.py':'native-reference.py',args=['--background',...(index===0?[source]:[]),'--python-expr','import sys; sys.pycache_prefix='+JSON.stringify(prefix)+'; sys.dont_write_bytecode=True','--python',script]
   invocations.push({productionCases:0,kind:identity.kind,native,node:native,configSha256:identity.configuration.sha256,result:{args,pythonGuardApplied:true,cacheDirectory:prefix,cacheDisposed:true,error:null,exitCode:0,timedOut:false,aborted:false}})
  }
  async function record(){await rm(join(directory,'invocations'),{recursive:true,force:true});await mkdir(join(directory,'invocations'));for(const[index,row]of invocations.entries())await writeFile(join(directory,'invocations',index+'.json'),JSON.stringify(row));const files=[];async function walk(folder,prefix=''){for(const x of (await readdir(folder,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){const name=prefix+x.name,path=join(folder,x.name);if(x.isDirectory())await walk(path,name+'/');else{const bytes=await readFile(path);files.push({path:name,bytes:bytes.length,sha256:nodePortHash(bytes)})}}}await walk(directory);return{identity,proof:{directory,complete:true,numericalCredit:false,files,invocations:structuredClone(invocations),pythonInvocations:invocations.length,finalInvocations:1,finalSources:[source]}}}
  let good=await record();assert.equal((await validateNativeArchive(good,evidence,options)).uniqueCachePrefixes,5)
  await writeFile(join(directory,'blender-proof'),'tampered');await assert.rejects(validateNativeArchive(good,evidence,options),/files changed/);await writeFile(join(directory,'blender-proof'),'launcher')
  for(const mutate of [rows=>rows[2].result.cacheDirectory=rows[1].result.cacheDirectory,rows=>rows[2].result.pythonGuardApplied=false,rows=>rows[2].result.cacheDisposed=false,rows=>rows[2].result.args[3]='unguarded']){
   const original=structuredClone(invocations);mutate(invocations);await assert.rejects(validateNativeArchive(await record(),evidence,options));invocations.splice(0,invocations.length,...original)
  }
  good=await record();await assert.rejects(validateNativeArchive(good,evidence,{...options,expectedFinalSources:[]}))
  const census={...options,expectedScripts:[{path:'native-reference.py',invocations:3},{path:'policy.py',invocations:1}]}
  assert.equal((await validateNativeArchive(good,evidence,census)).pythonInvocations,5)
  for(const expectedScripts of [[],[{path:'native-reference.py',invocations:2}],[{path:'native-reference.py',invocations:3},{path:'native-reference.py',invocations:1}],[{path:'native-reference.py',invocations:0}],[{path:'native-reference.py',invocations:1,extra:true}],[{path:'/dist/export_scene.py',invocations:1}]])await assert.rejects(validateNativeArchive(good,evidence,{...options,expectedScripts}))
  for(const mutate of [rows=>rows[2].result.args[4]='unreviewed.py',rows=>rows[2].result.args.push('--python-expr','unreviewed()'),rows=>rows[2].result.args[3]='--python-expr']){
   const original=structuredClone(invocations);mutate(invocations);await assert.rejects(validateNativeArchive(await record(),evidence,census));invocations.splice(0,invocations.length,...original)
  }
  // A smaller family gets an exact census rather than padding its proof with
  // a redundant third reference run. Legacy callers still demand three.
  invocations.pop();good=await record();assert.equal((await validateNativeArchive(good,evidence,{...census,expectedScripts:[{path:'native-reference.py',invocations:2},{path:'policy.py',invocations:1}]})).pythonInvocations,4)
  await assert.rejects(validateNativeArchive(good,evidence,options))
  await writeFile(join(directory,'extra-file'),'addition');await assert.rejects(validateNativeArchive(good,evidence,census),/files changed/)
 }finally{await rm(evidence,{recursive:true,force:true})}
})
