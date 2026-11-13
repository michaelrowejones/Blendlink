import assert from 'node:assert/strict'
import {execFileSync,spawnSync} from 'node:child_process'
import {mkdtemp,mkdir,readFile,readdir,rm,utimes,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {dirname,join,resolve} from 'node:path'
import test from 'node:test'
import {digest,diffBlenderSnapshots} from './lib/blender-node-changes.mjs'

const root=resolve(import.meta.dirname,'..'),cli=join(root,'scripts/node-ports.mjs'),audit=join(root,'scripts/audit-node-coverage.py')
const scaffold=(packet,output,queue=join(dirname(packet),'queue.json'))=>execFileSync(process.execPath,[cli,'scaffold','--work-item',packet,'--queue',queue,'--output',output],{encoding:'utf8',stdio:['ignore','pipe','pipe']})
function sourceSnapshot(changes={}){
 const payload={schemaVersion:1,collectorVersion:1,kind:'blendlink-blender-node-source-snapshot-v1',watchScope:['test'],sourceRevision:'a'.repeat(40),files:{},nodeSources:{},sourceDependencies:{},catalogIdentity:null,catalogNodes:null,...changes}
 return {...payload,inputDigest:digest(payload)}
}
async function packet(directory,domain){
 const file=join(directory,'work-item.json')
 const nativeNode='FunctionNodeFloatToInt',path='source/blender/nodes/function/nodes/node_fn_float_to_int.cc'
 const identity=domain?{version:[5,3,0],build:'a'.repeat(12)}:null
 const before=sourceSnapshot({catalogIdentity:identity,catalogNodes:domain?{}:null})
 const after=sourceSnapshot({catalogIdentity:identity,catalogNodes:domain?{[domain+':'+nativeNode]:{domain,nativeNode}}:null,files:{[path]:digest('new source')},nodeSources:{[nativeNode]:[path]}})
 const queue=diffBlenderSnapshots(before,after),item=queue.items.find(item=>item.nativeNode===nativeNode)
 await writeFile(join(directory,'queue.json'),JSON.stringify(queue))
 await writeFile(file,JSON.stringify({schemaVersion:1,queueDigest:queue.inputDigest,targetDigest:queue.targetDigest,item}))
 return file
}

test('focused catalog API preserves the full schema and attempts selected unknown IDs',()=>{
 execFileSync('python3',[join(root,'scripts/audit-node-coverage.test.py')],{encoding:'utf8'})
})
test('partial CLI cannot be used for full inventory, checks or baseline updates',()=>{
 for(const options of [[],['--self-test'],['--blender','not-a-binary'],['--catalog-output','unused.json','--check'],['--catalog-output','unused.json','--update-baseline']]){
  const result=spawnSync('python3',[audit,'--node','FunctionNodeFloatToInt',...options],{encoding:'utf8'})
  assert.equal(result.status,2);assert.match(result.stderr,/only available with --catalog-output.*partial schema/)
 }
 const invalid=spawnSync('python3',[audit,'--catalog-output','unused.json','--node','bad/path'],{encoding:'utf8'})
 assert.equal(invalid.status,2);assert.match(invalid.stderr,/native node identifiers/)
 const full=execFileSync('python3',[audit,'--self-test'],{encoding:'utf8'})
 assert.match(full,/BLENDLINK_NODE_COVERAGE_POLICY_PASSED/)
})
test('source-only scaffold leaves context pending and delegates both domains to the authoritative catalog',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'blendlink-node-scaffold-'))
 try{
  const file=await packet(directory),output=join(directory,'candidate')
  const receipt=JSON.parse(scaffold(file,output));assert.equal(receipt.productionCases,0)
  const candidate=JSON.parse(await readFile(join(output,'port-candidate.json'),'utf8'))
  assert.equal(candidate.domain,null);assert.equal(candidate.contextStatus,'pending-native-creation')
  assert.equal(candidate.lifecycle,'research');assert.equal(candidate.admission,'NOT_IMPLEMENTED');assert.equal(candidate.productionCases,0)
  assert.deepEqual(candidate.schemaProbe.contexts,['shader:root','shader:group','compositor:root','compositor:group'])
  const source=await readFile(join(output,'native-schema.py'),'utf8')
  assert.match(source,/audit\.native_catalog\(node_ids=\[node_id\]/)
  assert.match(source,/BLENDLINK_NODE_PORT_REPOSITORY/);assert.match(source,/productionCases.*== 0/)
  assert.doesNotMatch(source,/tree\.nodes\.new|ShaderNodeTree|CompositorNodeTree/)
  execFileSync('python3',['-c','import ast,sys; ast.parse(open(sys.argv[1]).read())',join(output,'native-schema.py')])
  const env={...process.env};delete env.BLENDLINK_NODE_PORT_REPOSITORY
  const missing=spawnSync('python3',[join(output,'native-schema.py')],{env,encoding:'utf8'})
  assert.notEqual(missing.status,0);assert.match(missing.stderr,/Set BLENDLINK_NODE_PORT_REPOSITORY/)
  assert.deepEqual((await readdir(output)).sort(),['cases.json','native-schema.py','port-candidate.json'])
  const cases=JSON.parse(await readFile(join(output,'cases.json'),'utf8'));assert.deepEqual(cases.admittedCases,[])
 }finally{await rm(directory,{recursive:true,force:true})}
})
test('scaffolding preserves existing work and refuses before writing any planned file',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'blendlink-node-scaffold-existing-'))
 try{
  const file=await packet(directory,'compositor'),output=join(directory,'candidate')
  await mkdir(output);await writeFile(join(output,'native-schema.py'),'artist-owned probe\n')
  assert.throws(()=>scaffold(file,output),/Refusing to overwrite existing scaffold file native-schema.py/)
  assert.deepEqual(await readdir(output),['native-schema.py'])
  assert.equal(await readFile(join(output,'native-schema.py'),'utf8'),'artist-owned probe\n')
  await rm(output,{recursive:true});scaffold(file,output)
  const original=await Promise.all((await readdir(output)).sort().map(async name=>[name,await readFile(join(output,name),'utf8')]))
  assert.throws(()=>scaffold(file,output),/Refusing to overwrite existing scaffold file/)
  for(const[name,bytes]of original)assert.equal(await readFile(join(output,name),'utf8'),bytes)
 }finally{await rm(directory,{recursive:true,force:true})}
})
test('generated probe enforces zero numerical credit and preserves existing schema receipts',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'blendlink-node-scaffold-protocol-'))
 try{
  const file=await packet(directory),output=join(directory,'candidate');scaffold(file,output)
  const repository=join(directory,'reviewed-repository'),script=join(repository,'scripts/audit-node-coverage.py')
  await mkdir(join(repository,'scripts'),{recursive:true});await mkdir(join(repository,'docs'))
  await writeFile(join(repository,'docs/node-capabilities.json'),JSON.stringify({nativeEnumerationBudgets:{'compositor:FunctionNodeFloatToInt':{states:17}}}))
  const helper=productionCases=>`def native_catalog(*, node_ids, enumeration_budgets):
    assert node_ids == ['FunctionNodeFloatToInt']
    assert enumeration_budgets == {'compositor:FunctionNodeFloatToInt': {'states': 17}}
    return {'selection': {'completeInventory': False, 'nodeIds': node_ids}, 'productionCases': ${productionCases},
        'needsOracle': True, 'blenderVersionTuple': [5, 3, 0], 'domains': {'shader': {'nodes': []}, 'compositor': {'nodes': []}}}
`
  await writeFile(script,helper(0))
  const pinnedTime=new Date('2020-01-01T00:00:00Z');await utimes(script,pinnedTime,pinnedTime)
  const receipt=join(directory,'schema.json'),env={...process.env,BLENDLINK_NODE_PORT_REPOSITORY:repository,BLENDLINK_NODE_PORT_SCHEMA_OUTPUT:receipt}
  execFileSync('python3',[join(output,'native-schema.py')],{env,stdio:['ignore','pipe','pipe']})
  const bytes=await readFile(receipt,'utf8'),captured=JSON.parse(bytes)
  assert.equal(captured.status,'native-creation-refused-needs-oracle');assert.equal(captured.productionCases,0)
  assert.deepEqual(captured.selection,{completeInventory:false,nodeIds:['FunctionNodeFloatToInt']})
  assert.deepEqual(captured.scaffold.actualDomains,[]);assert.equal(captured.scaffold.requestedDomain,null)
  const repeated=spawnSync('python3',[join(output,'native-schema.py')],{env,encoding:'utf8'})
  assert.notEqual(repeated.status,0);assert.match(repeated.stderr,/FileExistsError/)
  assert.equal(await readFile(receipt,'utf8'),bytes)
  await writeFile(script,helper(1))
  assert.equal(Buffer.byteLength(helper(0)),Buffer.byteLength(helper(1)))
  await utimes(script,pinnedTime,pinnedTime)
  const forged=spawnSync('python3',[join(output,'native-schema.py')],{env:{...env,BLENDLINK_NODE_PORT_SCHEMA_OUTPUT:join(directory,'forged.json')},encoding:'utf8'})
  assert.notEqual(forged.status,0);assert.match(forged.stderr,/AssertionError/)
  assert.equal((await readdir(directory)).includes('forged.json'),false)
 }finally{await rm(directory,{recursive:true,force:true})}
})

test('scaffold requires the full queue and exact canonical item membership before writing',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'blendlink-node-queue-link-'))
 try{
  const file=await packet(directory),queueFile=join(directory,'queue.json')
  const original=JSON.parse(await readFile(file,'utf8')),queue=JSON.parse(await readFile(queueFile,'utf8'))
  const missing=spawnSync(process.execPath,[cli,'scaffold','--work-item',file,'--output',join(directory,'missing-queue')],{encoding:'utf8'})
  assert.notEqual(missing.status,0);assert.match(missing.stderr,/Specify --queue/)
  const mutations=[
   value=>value.item.nativeNode='ShaderNodeSqueeze',
   value=>value.item.domain='shader',
   value=>value.item.id='different-item-id',
   value=>value.item.status='qualified',
   value=>value.item.reasons=[],
   value=>value.targetDigest='1'.repeat(64),
   value=>value.queueDigest='2'.repeat(64),
  ]
  for(const[index,mutate]of mutations.entries()){
   const changed=structuredClone(original);mutate(changed);await writeFile(file,JSON.stringify(changed))
   const output=join(directory,'altered-'+index)
   assert.throws(()=>scaffold(file,output),/Packet (?:item|target|does not reference)/)
   await assert.rejects(readdir(output),{code:'ENOENT'})
  }
  await writeFile(file,JSON.stringify(original))
  const stale={...queue,targetDigest:'3'.repeat(64)};await writeFile(queueFile,JSON.stringify(stale))
  assert.throws(()=>scaffold(file,join(directory,'stale-queue')),/Work queue digest is stale/)
  for(const [key,value,expected]of [['kind','other-queue',/Unknown work queue kind/],['schemaVersion',2,/Unknown work queue schema/],['targetDigest',null,/actual target snapshot digest/]]){
   const payload={...queue,[key]:value};delete payload.inputDigest
   await writeFile(queueFile,JSON.stringify({...payload,inputDigest:digest(payload)}))
   assert.throws(()=>scaffold(file,join(directory,'invalid-queue-'+key)),expected)
  }
  await writeFile(queueFile,JSON.stringify(queue))
  const reordered={...original,item:Object.fromEntries(Object.entries(original.item).reverse())}
  await writeFile(file,JSON.stringify(reordered))
  const valid=JSON.parse(scaffold(file,join(directory,'canonical-item')))
  assert.equal(valid.nativeNode,'FunctionNodeFloatToInt');assert.equal(valid.productionCases,0)
 }finally{await rm(directory,{recursive:true,force:true})}
})

test('diff validates registry manifests and refuses missing registries instead of dropping production selections',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'blendlink-node-registry-'))
 try{
  const before=sourceSnapshot(),after=sourceSnapshot({files:{'source/blender/blenlib/unknown-helper.cc':digest('changed shared implementation')}})
  const beforeFile=join(directory,'before.json'),afterFile=join(directory,'after.json')
  await writeFile(beforeFile,JSON.stringify(before));await writeFile(afterFile,JSON.stringify(after))
  const registry=join(directory,'ports'),output=join(directory,'queue.json')
  const run=(path,{cwd=root,explicit=true}={})=>spawnSync(process.execPath,[cli,'diff','--before',beforeFile,'--after',afterFile,
   ...(explicit?['--ports-dir',path]:[]),'--output',output],{cwd,encoding:'utf8'})
  const missing=run(registry);assert.notEqual(missing.status,0);assert.match(missing.stderr,/ENOENT/)
  const defaultMissing=run(undefined,{cwd:directory,explicit:false});assert.notEqual(defaultMissing.status,0);assert.match(defaultMissing.stderr,/ENOENT/)
  await assert.rejects(readFile(output),{code:'ENOENT'})
  await mkdir(registry)
  const empty=run(registry);assert.equal(empty.status,0);assert.deepEqual(JSON.parse(empty.stdout).affectedManifestIds,[])
  const manifest=JSON.parse(await readFile(join(root,'node-ports/squeeze.json'),'utf8'))
  await writeFile(join(registry,'squeeze.json'),JSON.stringify(manifest))
  const valid=run(registry);assert.equal(valid.status,0);assert.deepEqual(JSON.parse(valid.stdout).affectedManifestIds,['squeeze'])
  await rm(output)
  await writeFile(join(registry,'squeeze.json'),JSON.stringify({...manifest,lifecycle:'prodution'}))
  const typo=run(registry);assert.notEqual(typo.status,0);assert.match(typo.stderr,/Invalid node-port manifest squeeze.json/)
  await assert.rejects(readFile(output),{code:'ENOENT'})
  await rm(join(registry,'squeeze.json'));await writeFile(join(registry,'other.json'),JSON.stringify(manifest))
  const mismatch=run(registry);assert.notEqual(mismatch.status,0);assert.match(mismatch.stderr,/filename must match its registered id/)
  await assert.rejects(readFile(output),{code:'ENOENT'})
 }finally{await rm(directory,{recursive:true,force:true})}
})
