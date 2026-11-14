// Proof-only archive. Launcher receipts grant no numerical node credit.
import assert from 'node:assert/strict'
import {validateNodePortIdentityTransaction} from './node-port-python.mjs'
import {cp,readdir,realpath,readFile,stat} from 'node:fs/promises'
import {join,relative,sep} from 'node:path'
import {nodePortHash,nodePortFileIdentity} from './node-port-contract.mjs'

/** One guarded prefix followed by one reviewed script; script arguments are opaque. */
export function assertGuardedNativeScript(args,prefix){
 assert.ok(Array.isArray(args)&&args.every(arg=>typeof arg==='string'))
 assert.ok(typeof prefix==='string'&&prefix.length>0,'Native Python needs an owned cache prefix')
 const delimiter=args.indexOf('--'),end=delimiter<0?args.length:delimiter
 const actions=args.flatMap((arg,index)=>index<end&&['--python','-P','--python-expr','--python-text','--python-console'].includes(arg)?[{arg,index}]:[])
 assert.equal(actions.length,2,'Native census requires one guarded prefix and one Python script per invocation')
 assert.equal(actions[0].arg,'--python-expr')
 assert.equal(args[actions[0].index+1],'import sys; sys.pycache_prefix='+JSON.stringify(prefix)+'; sys.dont_write_bytecode=True')
 assert.ok(['--python','-P'].includes(actions[1].arg),'Native census cannot substitute an expression or text block for a reviewed script')
 const path=args[actions[1].index+1]
 assert.ok(typeof path==='string'&&path.length>0&&actions[1].index+1<end,'Native census script path is missing')
 return path
}
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
export async function validateNativeArchive(record,evidence,{expectedFinalSources,referenceScript,policyScript,helperInputs,expectedScripts}){
 // New families declare their complete non-Final Python census. Keep the
 // historical three-reference/one-policy contract for retained readers.
 const scriptCounts=expectedScripts===undefined?null:new Map()
 if(scriptCounts){
  assert.ok(Array.isArray(expectedScripts)&&expectedScripts.length>0,'Native script census must be a nonempty array')
  for(const row of expectedScripts){
   assert.deepEqual(Object.keys(row).sort(),['invocations','path'])
   assert.ok(typeof row.path==='string'&&row.path.length>0&&!scriptCounts.has(row.path),'Native script census needs unique script paths')
   assert.ok(Number.isSafeInteger(row.invocations)&&row.invocations>0,'Native script census counts must be positive safe integers')
   assert.ok(!row.path.endsWith('/export_scene.py'),'Final scripts are counted by their saved source census')
   scriptCounts.set(row.path,{expected:row.invocations,actual:0})
  }
 }
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
  if(scriptCounts){
   const path=assertGuardedNativeScript(args,r.cacheDirectory)
   if(!path.endsWith('/export_scene.py')){
    const count=scriptCounts.get(path);assert.ok(count,'Unexpected native Python script: '+path);count.actual++
   }
  }
  const script=args.findIndex((x,i)=>i<end&&x==='--python'&&args[i+1]?.endsWith('/export_scene.py'))
  if(script>=0){const background=args.findIndex(x=>['-b','--background'].includes(x));assert.ok(background>=0);sources.push(await realpath(args[background+1]))}
  if(args.some((x,i)=>i<end&&x==='--python'&&args[i+1]===referenceScript))references.push(call)
  if(args.some((x,i)=>i<end&&x==='--python'&&args[i+1]===policyScript))policies.push(call)
 }
 assert.equal(python,proof.pythonInvocations);assert.equal(sources.length,proof.finalInvocations);assert.deepEqual([...sources].sort(),[...proof.finalSources].sort());assert.deepEqual([...sources].sort(),[...expectedFinalSources].sort())
 if(scriptCounts){
  for(const[path,count]of scriptCounts)assert.equal(count.actual,count.expected,'Native script invocation census differs: '+path)
  assert.equal(python,expectedFinalSources.length+[...scriptCounts.values()].reduce((sum,count)=>sum+count.expected,0))
 }else{assert.equal(references.length,3);assert.equal(policies.length,1);assert.equal(python,expectedFinalSources.length+4)}
 assert.ok(!files.some(x=>x.path.split('/').some(part=>part.startsWith('python-cache-'))));return{pythonInvocations:python,finalInvocations:sources.length,uniqueCachePrefixes:prefixes.size,numericalCredit:0,...(identityTransaction?{identityTransaction}:{})}
}
