/** Proof-only POSIX native launcher. Never delete or rewrite project Python caches. */
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {createHash,randomUUID} from 'node:crypto'
import {createReadStream} from 'node:fs'
import {chmod,mkdir,mkdtemp,readFile,readdir,realpath,rm,stat,writeFile} from 'node:fs/promises'
import {dirname,join,resolve,relative} from 'node:path'
import {fileURLToPath} from 'node:url'

const KIND='blendlink-proof-native-python-v1'
const IDENTITY_DEFAULT='per-invocation-sha256-v1',IDENTITY_TRANSACTION='transaction-metadata-v1'
const PYTHON_ACTIONS=new Set(['--python','-P','--python-expr','--python-text','--python-console'])
const sha=bytes=>createHash('sha256').update(bytes).digest('hex')
export function requireNodePortPythonPlatform(platform=process.platform){
  assert.ok(platform==='darwin'||platform==='linux','Proof-only native Python launcher supports macOS/Linux; other hosts require independent qualification')
}
function validArgs(args){assert.ok(Array.isArray(args)&&[...args].every(value=>typeof value==='string'&&!value.includes('\0')),'Native arguments must be strings without NUL')}
function shellQuote(value){return "'"+value.replaceAll("'","'\"'\"'")+"'"}
export async function nodePortPythonFileMetadata(path){
  const actual=await realpath(path),info=await stat(actual,{bigint:true})
  assert.ok(info.isFile(),'Native launcher inputs must be files')
  const fields=['dev','ino','size','mode','uid','gid','mtimeNs','ctimeNs','birthtimeNs']
  return{path:actual,...Object.fromEntries(fields.map(key=>[key,String(info[key])]))}
}
export async function nodePortPythonFileIdentity(path){
  const before=await nodePortPythonFileMetadata(path)
  const digest=createHash('sha256');for await(const bytes of createReadStream(before.path))digest.update(bytes)
  assert.deepEqual(await nodePortPythonFileMetadata(path),before,'Native launcher input changed during hashing: '+path)
  return{path:before.path,bytes:Number(before.size),sha256:digest.digest('hex')}
}
async function verifyMetadata(expected){const actual=await nodePortPythonFileMetadata(expected.path);assert.deepEqual(actual,expected,'Pinned transaction metadata changed: '+expected.path);return actual}
async function exists(path){try{await stat(path);return true}catch(error){if(error.code==='ENOENT')return false;throw error}}
async function invocationPins(directory){return Promise.all((await readdir(join(directory,'invocations'))).sort().map(async name=>{const bytes=await readFile(join(directory,'invocations',name));return{path:'invocations/'+name,bytes:bytes.length,sha256:sha(bytes)}}))}

async function verifyIdentity(expected){assert.deepEqual(await nodePortPythonFileIdentity(expected.path),expected,'Pinned native launcher input changed: '+expected.path)}

/** Prefix only actual Python actions before Blender's script-argument delimiter. */
export async function prepareNodePortPython({args,directory}){
  requireNodePortPythonPlatform();validArgs(args)
  const delimiter=args.indexOf('--'),end=delimiter<0?args.length:delimiter
  const action=args.findIndex((value,index)=>index<end&&PYTHON_ACTIONS.has(value))
  const version=args.findIndex((value,index)=>index<end&&(value==='--version'||value==='-v'))
  if(action<0||version>=0&&version<action)return{args:[...args],applied:false,cacheDirectory:null,dispose:async()=>{}}
  await mkdir(directory,{recursive:true})
  const cacheDirectory=await mkdtemp(join(resolve(directory),'python-cache-'))
  // A JSON string literal is also a Python string literal for these absolute paths.
  const expression='import sys; sys.pycache_prefix='+JSON.stringify(cacheDirectory)+'; sys.dont_write_bytecode=True'
  const guarded=[...args.slice(0,action),'--python-expr',expression,...args.slice(action)]
  let disposed=false
  return{args:guarded,applied:true,cacheDirectory,dispose:async()=>{if(!disposed){await rm(cacheDirectory,{recursive:true,force:true});disposed=true}}}
}

/** Own one child and its fresh cache prefix until close, including failed spawn. */
export async function runNodePortBlender({blender,args,directory,timeoutMs=1_800_000,signal,cwd=process.cwd(),env=process.env,stdio='inherit'}){
  assert.ok(Number.isInteger(timeoutMs)&&timeoutMs>0&&timeoutMs<=1_800_000,'Native invocation timeout must be bounded')
  const prepared=await prepareNodePortPython({args,directory}),started=Date.now()
  const result={args:prepared.args,pythonGuardApplied:prepared.applied,cacheDirectory:prepared.cacheDirectory,
    exitCode:null,signal:null,timedOut:false,aborted:false,error:null}
  try{
    if(signal?.aborted){result.aborted=true;return result}
    await new Promise(done=>{
      let child,timer,killTimer,closed=false
      const finish=(code,exitSignal)=>{
        if(closed)return;closed=true;clearTimeout(timer);clearTimeout(killTimer)
        signal?.removeEventListener('abort',abort)
        result.exitCode=code;result.signal=exitSignal;done()
      }
      const terminate=()=>{
        if(!child?.pid)return
        child.kill('SIGTERM')
        killTimer??=setTimeout(()=>child.kill('SIGKILL'),400)
      }
      const abort=()=>{result.aborted=true;terminate()}
      try{
        // Inherit the caller's process group. Root group cancellation must also
        // reach Blender if the supervisor itself cannot run cleanup.
        child=spawn(blender,prepared.args,{cwd,env,stdio,shell:false,detached:false})
        child.once('error',error=>{result.error=error.message})
        child.once('close',finish)
        signal?.addEventListener('abort',abort,{once:true})
        if(signal?.aborted)abort()
        timer=setTimeout(()=>{result.timedOut=true;terminate()},timeoutMs)
      }catch(error){result.error=error.message;finish(null,null)}
    })
    return result
  }finally{await prepared.dispose();result.elapsedMs=Date.now()-started;result.cacheDisposed=true}
}

/** A proof-scoped executable also catches Blender calls nested inside SDK sync. */
export async function createNodePortBlenderLauncher({blender,directory,timeoutMs=1_800_000,identityPolicy=IDENTITY_DEFAULT}){
  requireNodePortPythonPlatform()
  assert.ok([IDENTITY_DEFAULT,IDENTITY_TRANSACTION].includes(identityPolicy),'Unknown native identity policy')
  assert.ok(Number.isInteger(timeoutMs)&&timeoutMs>0&&timeoutMs<=1_800_000,'Native invocation timeout must be bounded')
  await mkdir(directory,{recursive:true})
  // Identity paths are canonical. Use the same namespace in the config and
  // supervisor before writing any owned files (including symlinked parents).
  const owned=await realpath(await mkdtemp(join(resolve(directory),'native-launcher-')))
  try{
    const native=await nodePortPythonFileIdentity(blender),node=await nodePortPythonFileIdentity(process.execPath)
    const helperSource=fileURLToPath(import.meta.url),bridgeSource=resolve(dirname(helperSource),'../node-port-blender.mjs')
    const helperBytes=await readFile(helperSource),bridgeBytes=await readFile(bridgeSource)
    await mkdir(join(owned,'lib'));await mkdir(join(owned,'invocations'))
    const helper=join(owned,'lib/node-port-python.mjs'),bridge=join(owned,'node-port-blender.mjs')
    await writeFile(helper,helperBytes,{flag:'wx'});await writeFile(bridge,bridgeBytes,{flag:'wx'})
    assert.equal(sha(await readFile(helperSource)),sha(helperBytes),'Helper changed during capture')
    assert.equal(sha(await readFile(bridgeSource)),sha(bridgeBytes),'Bridge changed during capture')
    const transaction=identityPolicy===IDENTITY_TRANSACTION?{policy:IDENTITY_TRANSACTION,epoch:randomUUID(),creatorPID:process.pid,metadata:{native:await nodePortPythonFileMetadata(native.path),node:await nodePortPythonFileMetadata(node.path)}}:undefined
    const config={schemaVersion:1,kind:KIND,owned,native,node,timeoutMs,identityPolicy,transaction,
      helper:await nodePortPythonFileIdentity(helper),bridge:await nodePortPythonFileIdentity(bridge)}
    const configPath=join(owned,'launcher.json'),configBytes=Buffer.from(JSON.stringify(config,null,2)+'\n')
    await writeFile(configPath,configBytes,{flag:'wx'})
    const executable=join(owned,'blender-proof')
    // Keep the shell as a supervisor: SDK sync kills this single PID with
    // SIGKILL on inactivity. The bridge notices its owner shell disappearing.
    const source=`#!/bin/sh\nrunner_pid=''\nterminate() {\n  if [ -n "$runner_pid" ]; then\n    kill -TERM "$runner_pid" 2>/dev/null\n    wait "$runner_pid"\n  fi\n  exit "$1"\n}\ntrap 'terminate 143' TERM HUP\ntrap 'terminate 130' INT\n${shellQuote(node.path)} ${shellQuote(bridge)} --config ${shellQuote(configPath)} --config-sha256 ${shellQuote(sha(configBytes))} --owner "$$" -- "$@" &\nrunner_pid=$!\nwait "$runner_pid"\nstatus=$?\nexit "$status"\n`
    await writeFile(executable,source,{flag:'wx',mode:0o700})
    for(const path of [helper,bridge,configPath])await chmod(path,0o400)
    const identity={kind:KIND,platform:process.platform,native,node,...(transaction?{transaction:{...transaction,requiresFinalization:true,finalization:null,limit:'Serial owned transaction only. Fresh byte hashes at capture/finalize; nanosecond inode/ctime/mtime metadata per invocation. Metadata-preserving privileged/filesystem attacks are outside this profile.'}}:{}),
      launcher:await nodePortPythonFileIdentity(executable),configuration:await nodePortPythonFileIdentity(configPath),
      helper:config.helper,bridge:config.bridge,
      cachePolicy:'Fresh per-invocation prefix before Python actions; no project/user cache deletion or numerical proof reuse',
      limit:'Subsequent imports only. Call dispose after owned commands stop. Whole-job SIGKILL may leave empty owned directories; it cannot run JavaScript cleanup.'}
    let disposed=false,finalized=null
    const finalize=async()=>{
      assert.ok(!disposed,'Cannot finalize a disposed launcher')
      if(!transaction)return null
      const lock=join(owned,'identity-invocation.lock');await mkdir(lock)
      try{
        for(const expected of Object.values(transaction.metadata))await verifyMetadata(expected)
        const pins=await invocationPins(owned)
        if(finalized){assert.equal(sha(await readFile(finalized.path)),finalized.sha256);const receipt=JSON.parse(await readFile(finalized.path));assert.deepEqual(pins,receipt.invocations,'Invocations changed after finalization');return finalized}
        for(const pin of pins){const row=JSON.parse(await readFile(join(owned,pin.path)));assert.equal(row.error,undefined);assert.equal(row.result?.exitCode,0);assert.equal(row.result?.timedOut,false);assert.equal(row.result?.aborted,false);assert.equal(row.result?.error,null);assert.equal(row.result?.cacheDisposed,true);assert.equal(row.identityAttestation?.policy,IDENTITY_TRANSACTION);assert.equal(row.identityAttestation?.epoch,transaction.epoch);assert.deepEqual(row.identityAttestation?.before,transaction.metadata);assert.deepEqual(row.identityAttestation?.after,transaction.metadata)}
        const end={native:await nodePortPythonFileIdentity(native.path),node:await nodePortPythonFileIdentity(node.path)};assert.deepEqual(end,{native,node},'Transaction end bytes differ from start')
        for(const expected of [identity.helper,identity.bridge,identity.configuration,identity.launcher])await verifyIdentity(expected)
        const metadata={native:await verifyMetadata(transaction.metadata.native),node:await verifyMetadata(transaction.metadata.node)}
        const receipt={schemaVersion:1,kind:'blendlink-proof-identity-transaction-v1',policy:IDENTITY_TRANSACTION,epoch:transaction.epoch,creatorPID:transaction.creatorPID,numericalCredit:0,start:{native,node},end,metadataStart:transaction.metadata,metadataEnd:metadata,invocations:pins}
        const path=join(owned,'identity-finalization.json'),bytes=Buffer.from(JSON.stringify(receipt,null,2)+'\n');await writeFile(path,bytes,{flag:'wx'});finalized={path,bytes:bytes.length,sha256:sha(bytes)};identity.transaction.finalization=finalized;return finalized
      }finally{await rm(lock,{recursive:true,force:true})}
    }
    return{executable,identity,directory:owned,finalize,dispose:async()=>{if(!disposed){await rm(owned,{recursive:true,force:true});disposed=true}}}
  }catch(error){await rm(owned,{recursive:true,force:true});throw error}
}

/** CLI bridge entry; only the generated POSIX supervisor calls this. */
export async function runNodePortBlenderBridge(argv){
  requireNodePortPythonPlatform()
  assert.equal(argv[0],'--config');assert.equal(argv[2],'--config-sha256');assert.equal(argv[4],'--owner');assert.equal(argv[6],'--')
  const bytes=await readFile(argv[1]);assert.equal(sha(bytes),argv[3],'Pinned launcher configuration changed')
  const config=JSON.parse(bytes);assert.equal(config.schemaVersion,1);assert.equal(config.kind,KIND)
  const owner=Number(argv[5]);assert.ok(Number.isInteger(owner)&&owner>1,'Supervisor PID required')
  const controller=new AbortController(),started=Date.now(),began=performance.now(),id=randomUUID(),timings={}
  let parentGone=false,result,error,identityAttestation,transactionLock=false
  const stop=()=>controller.abort()
  const checkParent=()=>{if(process.ppid!==owner){parentGone=true;stop();return}try{process.kill(owner,0);if(config.transaction)process.kill(config.transaction.creatorPID,0)}catch(failure){if(failure.code==='ESRCH'){parentGone=true;stop()}}}
  const watch=setInterval(checkParent,50);checkParent()
  for(const name of ['SIGTERM','SIGINT','SIGHUP'])process.on(name,stop)
  try{
    assert.equal(await realpath(process.execPath),config.node.path,'Launcher must use the pinned Node executable')
    assert.equal(await realpath(fileURLToPath(import.meta.url)),config.helper.path)
    const preIdentity=performance.now()
    const optimized=config.identityPolicy===IDENTITY_TRANSACTION
    if(optimized){
      assert.equal(config.transaction.policy,IDENTITY_TRANSACTION)
      await mkdir(join(config.owned,'identity-invocation.lock'));transactionLock=true
      assert.equal(await exists(join(config.owned,'identity-finalization.json')),false,'Native identity transaction is already finalized')
      identityAttestation={policy:IDENTITY_TRANSACTION,epoch:config.transaction.epoch,before:{native:await verifyMetadata(config.transaction.metadata.native),node:await verifyMetadata(config.transaction.metadata.node)}}
      for(const identity of [config.helper,config.bridge])await verifyIdentity(identity)
    }else{assert.ok(!config.identityPolicy||config.identityPolicy===IDENTITY_DEFAULT);for(const identity of [config.native,config.node,config.helper,config.bridge])await verifyIdentity(identity)}
    timings.preIdentityMs=performance.now()-preIdentity
    result=await runNodePortBlender({blender:config.native.path,args:argv.slice(7),directory:config.owned,
      timeoutMs:config.timeoutMs,signal:controller.signal})
    const postIdentity=performance.now()
    if(optimized){identityAttestation.after={native:await verifyMetadata(config.transaction.metadata.native),node:await verifyMetadata(config.transaction.metadata.node)};for(const identity of [config.helper,config.bridge])await verifyIdentity(identity)}
    else if(!result.aborted&&!result.timedOut&&!result.error)await verifyIdentity(config.native)
    timings.postIdentityMs=performance.now()-postIdentity
  }catch(failure){error={message:failure.message,stack:failure.stack}}
  finally{
    clearInterval(watch);for(const name of ['SIGTERM','SIGINT','SIGHUP'])process.off(name,stop)
    timings.bridgeBeforeReceiptMs=performance.now()-began
    await writeFile(join(config.owned,'invocations',id+'.json'),JSON.stringify({schemaVersion:1,kind:KIND,
      productionCases:0,started,owner,parentGone,native:config.native,node:config.node,
      configSha256:sha(bytes),identityAttestation,timings,result,error},null,2)+'\n',{flag:'wx'})
    if(transactionLock)await rm(join(config.owned,'identity-invocation.lock'),{recursive:true,force:true})
  }
  if(error){console.error('BLENDLINK_PROOF_NATIVE_LAUNCH_FAILED '+error.message);return 1}
  return result.timedOut?124:result.aborted?143:result.error?1:result.exitCode??(result.signal==='SIGINT'?130:143)
}

/** Close an optional metadata profile from archived bytes; never reuse numerical results. */
export async function validateNodePortIdentityTransaction({identity,config,directory}){
  if(!identity.transaction){assert.ok(!config.transaction,'Transaction metadata must remain in launcher identity');return null}
  const transaction=identity.transaction,pin=transaction.finalization
  assert.equal(config.identityPolicy,IDENTITY_TRANSACTION);assert.equal(transaction.policy,IDENTITY_TRANSACTION)
  assert.equal(transaction.requiresFinalization,true);assert.ok(pin,'Transaction metadata needs final byte attestation')
  assert.deepEqual(config.transaction,{policy:transaction.policy,epoch:transaction.epoch,creatorPID:transaction.creatorPID,metadata:transaction.metadata})
  const path=relative(config.owned,pin.path);assert.equal(path,'identity-finalization.json')
  const bytes=await readFile(join(directory,path));assert.equal(bytes.length,pin.bytes);assert.equal(sha(bytes),pin.sha256)
  const receipt=JSON.parse(bytes);assert.equal(receipt.schemaVersion,1);assert.equal(receipt.kind,'blendlink-proof-identity-transaction-v1');assert.equal(receipt.policy,IDENTITY_TRANSACTION);assert.equal(receipt.epoch,transaction.epoch);assert.equal(receipt.creatorPID,transaction.creatorPID);assert.equal(receipt.numericalCredit,0)
  assert.deepEqual(receipt.start,{native:identity.native,node:identity.node});assert.deepEqual(receipt.end,receipt.start);assert.deepEqual(receipt.metadataStart,transaction.metadata);assert.deepEqual(receipt.metadataEnd,transaction.metadata)
  assert.deepEqual(await invocationPins(directory),receipt.invocations,'Sealed invocation list changed')
  for(const record of receipt.invocations){
    const row=JSON.parse(await readFile(join(directory,record.path)));assert.equal(row.error,undefined);assert.equal(row.configSha256,identity.configuration.sha256);assert.deepEqual(row.native,identity.native);assert.deepEqual(row.node,identity.node)
    assert.equal(row.identityAttestation?.policy,IDENTITY_TRANSACTION);assert.equal(row.identityAttestation?.epoch,transaction.epoch);assert.deepEqual(row.identityAttestation?.before,transaction.metadata);assert.deepEqual(row.identityAttestation?.after,transaction.metadata)
    assert.equal(row.result?.exitCode,0);assert.equal(row.result?.error,null);assert.equal(row.result?.aborted,false);assert.equal(row.result?.timedOut,false);assert.equal(row.result?.cacheDisposed,true)
  }
  for(const expected of [identity.native,identity.node])await verifyIdentity(expected)
  return{policy:IDENTITY_TRANSACTION,finalizationSha256:pin.sha256,sealedInvocations:receipt.invocations.length,byteHashesAtStartAndEnd:true,metadataChecksPerInvocation:true,numericalCredit:0}
}
