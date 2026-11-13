import assert from 'node:assert/strict'
import {execFile,execFileSync,spawn} from 'node:child_process'
import {mkdtemp,mkdir,readFile,readdir,realpath,rm,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {promisify} from 'node:util'
import test from 'node:test'
import {createNodePortBlenderLauncher,prepareNodePortPython,requireNodePortPythonPlatform,runNodePortBlender} from './node-port-python.mjs'
const exec=promisify(execFile),supported=process.platform==='darwin'||process.platform==='linux'
const quote=value=>"'"+value.replaceAll("'","'\"'\"'")+"'"
async function waitFor(read,timeout=5000){
 const end=Date.now()+timeout
 while(Date.now()<end){try{const result=await read();if(result)return result}catch(error){if(error.code!=='ENOENT')throw error}await new Promise(done=>setTimeout(done,20))}
 throw new Error('Owned native process did not settle')
}
async function fixture(){
 const root=await mkdtemp(join(tmpdir(),"node-port-python 'quoted' ")),native=join(root,"actual Blender 'binary'"),program=join(root,'fake-native.mjs')
 await writeFile(program,`import {writeFileSync} from 'node:fs';\nconst args=process.argv.slice(2);\nif(process.env.NATIVE_CAPTURE)writeFileSync(process.env.NATIVE_CAPTURE,JSON.stringify({pid:process.pid,args}));\nif(args.includes('--version'))console.log('Blender 5.3.0');\nelse if(process.env.NATIVE_HANG){if(process.env.NATIVE_IGNORE_TERM)process.on('SIGTERM',()=>{});setInterval(()=>{},1000)}\nelse if(process.env.NATIVE_FAIL)process.exitCode=7;\n`)
 await writeFile(native,'#!/bin/sh\nexec '+quote(process.execPath)+' '+quote(program)+' "$@"\n',{mode:0o700})
 return{root,native}
}
async function cacheDirectories(directory){return(await readdir(directory)).filter(name=>name.startsWith('python-cache-'))}
async function receipts(launcher){return Promise.all((await readdir(join(launcher.directory,'invocations'))).map(async name=>JSON.parse(await readFile(join(launcher.directory,'invocations',name),'utf8'))))}
function alive(pid){try{process.kill(pid,0);return true}catch(error){if(error.code==='ESRCH')return false;throw error}}

test('only measured POSIX hosts are admitted',()=>{for(const platform of ['win32','freebsd'])assert.throws(()=>requireNodePortPythonPlatform(platform),/macOS\/Linux/)})
test('fresh prefixes preserve argv, quote Python paths and stop at script delimiter',{skip:!supported},async()=>{
 const {root}=await fixture()
 try{
  const args=['-b','artist scene.blend','--python-exit-code','1','--python','script with spaces.py','--','--python','artist arg']
  const first=await prepareNodePortPython({args,directory:root}),second=await prepareNodePortPython({args,directory:root})
  assert.notEqual(first.cacheDirectory,second.cacheDirectory)
  assert.deepEqual(first.args.slice(0,4),args.slice(0,4));assert.equal(first.args[4],'--python-expr')
  assert.deepEqual(first.args.slice(6),args.slice(4));assert.deepEqual(args,['-b','artist scene.blend','--python-exit-code','1','--python','script with spaces.py','--','--python','artist arg'])
  const evaluated=execFileSync('python3',['-c',first.args[5]+';import json;print(json.dumps([sys.pycache_prefix,sys.dont_write_bytecode]))'],{encoding:'utf8'})
  assert.deepEqual(JSON.parse(evaluated),[first.cacheDirectory,true])
  await first.dispose();await first.dispose();await second.dispose();assert.deepEqual(await cacheDirectories(root),[])
  for(const untouched of [['--version'],['-v'],['--','--python','x'],['--background','--version','--python','never.py']]){
   const prepared=await prepareNodePortPython({args:untouched,directory:root})
   assert.deepEqual(prepared.args,untouched);assert.equal(prepared.applied,false);assert.equal(prepared.cacheDirectory,null)
  }
  for(const action of ['-P','--python-expr','--python-text','--python-console']){
   const prepared=await prepareNodePortPython({args:[action,'value'],directory:root});assert.equal(prepared.args[2],action);await prepared.dispose()
  }
 }finally{await rm(root,{recursive:true,force:true})}
})
test('owned prefix cleanup covers success, failure, failed spawn, timeout and abort',{skip:!supported},async()=>{
 const {root,native}=await fixture(),capture=join(root,'captured.json')
 try{
  for(const extra of [{},{NATIVE_FAIL:'1'}]){
   const result=await runNodePortBlender({blender:native,args:['--python','proof.py'],directory:root,env:{...process.env,NATIVE_CAPTURE:capture,...extra},stdio:'ignore'})
   assert.equal(result.exitCode,extra.NATIVE_FAIL?7:0);assert.equal(result.cacheDisposed,true);assert.deepEqual(await cacheDirectories(root),[])
  }
  const missing=await runNodePortBlender({blender:join(root,'missing'),args:['--python','proof.py'],directory:root,stdio:'ignore'})
  assert.match(missing.error,/ENOENT/);assert.equal(missing.cacheDisposed,true);assert.deepEqual(await cacheDirectories(root),[])
  const timeout=await runNodePortBlender({blender:native,args:['--python','proof.py'],directory:root,timeoutMs:80,env:{...process.env,NATIVE_HANG:'1',NATIVE_IGNORE_TERM:'1'},stdio:'ignore'})
  assert.equal(timeout.timedOut,true);assert.equal(timeout.cacheDisposed,true);assert.deepEqual(await cacheDirectories(root),[])
  await rm(capture,{force:true});const controller=new AbortController()
  const pending=runNodePortBlender({blender:native,args:['--python','proof.py'],directory:root,signal:controller.signal,env:{...process.env,NATIVE_CAPTURE:capture,NATIVE_HANG:'1'},stdio:'ignore'})
  await waitFor(()=>readFile(capture));controller.abort();const aborted=await pending
  assert.equal(aborted.aborted,true);assert.equal(aborted.cacheDisposed,true);assert.deepEqual(await cacheDirectories(root),[])
 }finally{await rm(root,{recursive:true,force:true})}
})
test('launcher pins actual native/Node/runtime identities and forwards --version unchanged',{skip:!supported},async()=>{
 const {root,native}=await fixture(),capture=join(root,'captured.json')
 let launcher
 try{
  launcher=await createNodePortBlenderLauncher({blender:native,directory:root})
  assert.equal(launcher.identity.native.path,await realpath(native));assert.notEqual(launcher.identity.native.path,launcher.identity.launcher.path)
  for(const identity of [launcher.identity.native,launcher.identity.node,launcher.identity.launcher,launcher.identity.configuration,launcher.identity.helper,launcher.identity.bridge])assert.match(identity.sha256,/^[a-f0-9]{64}$/)
  const version=await exec(launcher.executable,['--version'],{env:{...process.env,NATIVE_CAPTURE:capture}})
  assert.equal(version.stdout,'Blender 5.3.0\n');assert.equal(version.stderr,'')
  assert.deepEqual(JSON.parse(await readFile(capture,'utf8')).args,['--version'])
  await exec(launcher.executable,['--python','proof.py','--','--python-expr','user data'],{env:{...process.env,NATIVE_CAPTURE:capture}})
  const actual=JSON.parse(await readFile(capture,'utf8')).args
  assert.equal(actual[0],'--python-expr');assert.deepEqual(actual.slice(2),['--python','proof.py','--','--python-expr','user data'])
  assert.deepEqual(await cacheDirectories(launcher.directory),[])
  const rows=await receipts(launcher);assert.equal(rows.length,2);assert.equal(rows[0].productionCases,0)
  await writeFile(native,'#!/bin/sh\nexit 0\n',{mode:0o700})
  await assert.rejects(exec(launcher.executable,['--python','proof.py']),/Pinned native launcher input changed/)
  assert.deepEqual(await cacheDirectories(launcher.directory),[])
  await launcher.dispose();await launcher.dispose();assert.equal((await readdir(root)).some(name=>name.startsWith('native-launcher-')),false)
 }finally{await launcher?.dispose();await rm(root,{recursive:true,force:true})}
})
for(const mode of ['SDK-single-PID-SIGKILL','parent-process-group-TERM'])test('launcher cleans Blender and prefix after '+mode,{skip:!supported},async()=>{
 const {root,native}=await fixture(),capture=join(root,'ready.json')
 let launcher,child,pid
 try{
  launcher=await createNodePortBlenderLauncher({blender:native,directory:root})
  child=spawn(launcher.executable,['--python','proof.py'],{env:{...process.env,NATIVE_CAPTURE:capture,NATIVE_HANG:'1',NATIVE_IGNORE_TERM:'1'},stdio:'ignore',detached:true})
  const exited=new Promise((resolve,reject)=>{child.once('close',resolve);child.once('error',reject)})
  pid=(await waitFor(async()=>JSON.parse(await readFile(capture,'utf8')))).pid
  const pgid=Number(execFileSync('ps',['-o','pgid=','-p',String(pid)],{encoding:'utf8'}).trim())
  assert.equal(pgid,child.pid,'Native must remain in the parent proof process group')
  if(mode==='SDK-single-PID-SIGKILL')child.kill('SIGKILL');else process.kill(-child.pid,'SIGTERM')
  await exited
  const row=await waitFor(async()=>{const rows=await receipts(launcher);return rows[0]})
  assert.equal(row.result.aborted,true);assert.equal(row.result.cacheDisposed,true)
  if(mode==='SDK-single-PID-SIGKILL')assert.equal(row.parentGone,true)
  await waitFor(()=>!alive(pid));assert.deepEqual(await cacheDirectories(launcher.directory),[])
 }finally{
  if(child?.pid){try{process.kill(-child.pid,'SIGKILL')}catch{}}
  await launcher?.dispose();await rm(root,{recursive:true,force:true})
 }
})
