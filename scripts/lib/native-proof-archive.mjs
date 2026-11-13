// Proof-only archive. Launcher receipts grant no numerical node credit.
import assert from 'node:assert/strict'
import {validateNodePortIdentityTransaction} from './node-port-python.mjs'
import {cp,readdir,realpath,readFile,stat} from 'node:fs/promises'
import {join,relative,sep} from 'node:path'
import {nodePortHash,nodePortFileIdentity} from './node-port-contract.mjs'
export async function archiveNativeLauncher(launcher, evidence, requireComplete) {
  const directory = join(evidence, 'native-python-proof'), active = await realpath(launcher.directory)
  await cp(active, directory, { recursive: true, errorOnExist: true, force: false })
  const files = []
  const visit = async (folder, prefix = '') => {
    for (const entry of (await readdir(folder, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      assert.ok(!entry.isSymbolicLink(), 'Native proof archive cannot follow a substituted link')
      const name = prefix + entry.name, path = join(folder, entry.name)
      if (entry.isDirectory()) await visit(path, name + '/')
      else files.push({ path: name, bytes: (await stat(path)).size, sha256: nodePortHash(await readFile(path)) })
    }
  }
  await visit(directory)
  for (const name of ['launcher', 'configuration', 'helper', 'bridge']) {
    const identity = launcher.identity[name], path = relative(active, identity.path)
    assert.ok(path !== '..' && !path.startsWith('..' + sep), 'Native proof identity escaped its owned directory')
    assert.equal(nodePortHash(await readFile(join(directory, path))), identity.sha256, 'Native proof snapshot changed: ' + name)
  }
  const invocations = []
  for (const file of files.filter(file => file.path.startsWith('invocations/'))) invocations.push(JSON.parse(await readFile(join(directory, file.path), 'utf8')))
  const prefixes = new Set(), finalSources = []; let pythonInvocations = 0, finalInvocations = 0
  for (const invocation of invocations) {
    assert.equal(invocation.productionCases, 0, 'Launcher receipts are not numerical qualification')
    assert.equal(invocation.kind, launcher.identity.kind)
    assert.deepEqual(invocation.native, launcher.identity.native); assert.deepEqual(invocation.node, launcher.identity.node)
    assert.equal(invocation.configSha256, launcher.identity.configuration.sha256)
    if (requireComplete) {
      assert.equal(invocation.error, undefined); assert.equal(invocation.result.error, null)
      assert.equal(invocation.result.timedOut, false); assert.equal(invocation.result.aborted, false)
      assert.equal(invocation.result.exitCode, 0); assert.equal(invocation.result.cacheDisposed, true)
    }
    if (!Array.isArray(invocation.result?.args)) continue
    const args = invocation.result.args, delimiter = args.indexOf('--'), end = delimiter < 0 ? args.length : delimiter
    const action = args.findIndex((arg, index) => index < end && ['--python', '-P', '--python-expr', '--python-text', '--python-console'].includes(arg))
    const version = args.findIndex((arg, index) => index < end && ['--version', '-v'].includes(arg))
    if (action < 0 || version >= 0 && version < action) { if (requireComplete) assert.equal(invocation.result.pythonGuardApplied, false); continue }
    pythonInvocations++
    const prefix = invocation.result.cacheDirectory
    if (requireComplete) {
      assert.ok(typeof prefix === 'string' && !prefixes.has(prefix), 'Each native Python invocation needs a fresh cache prefix')
      prefixes.add(prefix); assert.equal(invocation.result.pythonGuardApplied, true)
      assert.equal(args[action], '--python-expr')
      assert.equal(args[action + 1], 'import sys; sys.pycache_prefix=' + JSON.stringify(prefix) + '; sys.dont_write_bytecode=True')
    }
    if (args.some((arg, index) => index < end && arg === '--python' && args[index + 1]?.endsWith('/export_scene.py'))) {
      finalInvocations++
      const background = args.findIndex(arg => ['-b', '--background'].includes(arg)), source = args[background + 1]
      if (requireComplete) { assert.ok(background >= 0 && source?.endsWith('.blend')); finalSources.push(await realpath(source)) }
      else if (background >= 0 && source) finalSources.push(source)
    }
  }
  if (requireComplete) {
    assert.ok(pythonInvocations > 0, 'No guarded native Python execution was witnessed')
    assert.ok(!(await readdir(active)).some(name => name.startsWith('python-cache-')), 'Owned native cache prefix leaked')
    assert.deepEqual(await nodePortFileIdentity(launcher.identity.native.path), launcher.identity.native, 'Underlying native binary changed during proof')
  }
  const identityTransaction=requireComplete?await validateNodePortIdentityTransaction({identity:launcher.identity,config:JSON.parse(await readFile(join(directory,'launcher.json'))),directory}):null
  return { directory, files, invocations, pythonInvocations, finalInvocations, finalSources, numericalCredit: false, complete: requireComplete, ...(identityTransaction?{identityTransaction}:{}) }
}

/** Recheck the archived bytes and every guarded call without depending on deleted active paths. */
export async function validateNativeArchive(record,evidence,{expectedFinalSources,referenceScript,policyScript,helperInputs}){
 const{identity,proof}=record,directory=await realpath(join(evidence,'native-python-proof'))
 assert.equal(proof.complete,true);assert.equal(proof.numericalCredit,false);assert.equal(await realpath(proof.directory),directory)
 const files=[]
 async function visit(folder,prefix=''){for(const x of (await readdir(folder,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){assert.equal(x.isSymbolicLink(),false);const name=prefix+x.name,path=join(folder,x.name);if(x.isDirectory())await visit(path,name+'/');else files.push({path:name,bytes:(await stat(path)).size,sha256:nodePortHash(await readFile(path))})}}
 await visit(directory);assert.deepEqual(files,proof.files,'Archived native files changed')
 const config=JSON.parse(await readFile(join(directory,'launcher.json')))
 assert.equal(nodePortHash(await readFile(join(directory,'launcher.json'))),identity.configuration.sha256)
 assert.equal(config.kind,identity.kind);assert.deepEqual(config.native,identity.native);assert.deepEqual(config.node,identity.node)
 for(const name of ['launcher','configuration','helper','bridge']){
  const path=relative(config.owned,identity[name].path);assert.ok(path!=='..'&&!path.startsWith('..'+sep));assert.equal(nodePortHash(await readFile(join(directory,path))),identity[name].sha256)
 }
 for(const name of ['helper','bridge']){assert.deepEqual(config[name],identity[name]);assert.equal(nodePortHash(await readFile(helperInputs[name])),identity[name].sha256)}
 for(const key of ['native','node'])assert.deepEqual(await nodePortFileIdentity(identity[key].path),identity[key])
 const invocations=[];for(const file of files.filter(x=>x.path.startsWith('invocations/')))invocations.push(JSON.parse(await readFile(join(directory,file.path))))
 assert.deepEqual(invocations,proof.invocations)
 const identityTransaction=await validateNodePortIdentityTransaction({identity,config,directory});if(identityTransaction)assert.deepEqual(proof.identityTransaction,identityTransaction);else assert.equal(proof.identityTransaction,undefined)
 const prefixes=new Set(),sources=[],references=[],policies=[];let python=0
 for(const call of invocations){
  assert.equal(call.productionCases,0);assert.equal(call.kind,identity.kind);assert.equal(call.configSha256,identity.configuration.sha256);assert.deepEqual(call.native,identity.native);assert.deepEqual(call.node,identity.node);assert.equal(call.error,undefined)
  const r=call.result;assert.equal(r.error,null);assert.equal(r.exitCode,0);assert.equal(r.timedOut,false);assert.equal(r.aborted,false);assert.equal(r.cacheDisposed,true)
  const args=r.args,delimiter=args.indexOf('--'),end=delimiter<0?args.length:delimiter,action=args.findIndex((x,i)=>i<end&&['--python','-P','--python-expr','--python-text','--python-console'].includes(x)),version=args.findIndex((x,i)=>i<end&&['--version','-v'].includes(x))
  if(action<0||version>=0&&version<action){assert.equal(r.pythonGuardApplied,false);continue}
  python++;assert.equal(r.pythonGuardApplied,true);assert.ok(typeof r.cacheDirectory==='string'&&!prefixes.has(r.cacheDirectory));prefixes.add(r.cacheDirectory)
  assert.equal(args[action],'--python-expr');assert.equal(args[action+1],'import sys; sys.pycache_prefix='+JSON.stringify(r.cacheDirectory)+'; sys.dont_write_bytecode=True')
  const script=args.findIndex((x,i)=>i<end&&x==='--python'&&args[i+1]?.endsWith('/export_scene.py'))
  if(script>=0){const background=args.findIndex(x=>['-b','--background'].includes(x));assert.ok(background>=0);sources.push(await realpath(args[background+1]))}
  if(args.some((x,i)=>i<end&&x==='--python'&&args[i+1]===referenceScript))references.push(call)
  if(args.some((x,i)=>i<end&&x==='--python'&&args[i+1]===policyScript))policies.push(call)
 }
 assert.equal(python,proof.pythonInvocations);assert.equal(sources.length,proof.finalInvocations);assert.deepEqual([...sources].sort(),[...proof.finalSources].sort());assert.deepEqual([...sources].sort(),[...expectedFinalSources].sort());assert.equal(references.length,3);assert.equal(policies.length,1);assert.equal(python,expectedFinalSources.length+4)
 assert.ok(!files.some(x=>x.path.split('/').some(part=>part.startsWith('python-cache-'))));return{pythonInvocations:python,finalInvocations:sources.length,uniqueCachePrefixes:prefixes.size,numericalCredit:0,...(identityTransaction?{identityTransaction}:{})}
}
