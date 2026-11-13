import assert from 'node:assert/strict'
import {readFile,writeFile,mkdir,readdir,lstat} from 'node:fs/promises'
import {resolve,join,dirname} from 'node:path'
import {snapshotBlenderSources,diffBlenderSnapshots,digest} from './lib/blender-node-changes.mjs'
import {readNodePortManifest} from './lib/node-port-contract.mjs'

const [command,...args]=process.argv.slice(2)
const options={}
for(let i=0;i<args.length;i+=2){assert.match(args[i],/^--[a-z-]+$/);assert.ok(args[i+1]&&!args[i+1].startsWith('--'),'Missing '+args[i]);assert.ok(!Object.hasOwn(options,args[i]),'Duplicate '+args[i]);options[args[i]]=args[i+1]}
const json=async path=>JSON.parse(await readFile(resolve(path),'utf8'))
async function write(path,value){await mkdir(dirname(resolve(path)),{recursive:true});await writeFile(resolve(path),JSON.stringify(value,null,2)+'\n')}
function allowed(names){for(const key of Object.keys(options))assert.ok(names.includes(key),'Unknown option '+key)}
function required(name){assert.ok(options[name],'Specify '+name);return options[name]}
async function ports(directory){
 const entries=await readdir(resolve(directory),{withFileTypes:true})
 const manifests=[]
 for(const file of entries.filter(entry=>entry.name.endsWith('.json')).sort((a,b)=>a.name.localeCompare(b.name))){
  assert.ok(file.isFile(),'Manifest must be a plain file')
  let manifest;try{manifest=await readNodePortManifest(resolve(directory,file.name))}catch(error){throw new Error('Invalid node-port manifest '+file.name,{cause:error})}
  assert.equal(file.name,manifest.id+'.json','Manifest filename must match its registered id')
  manifests.push(manifest)
 }
 assert.equal(new Set(manifests.map(port=>port.id)).size,manifests.length,'Duplicate manifest IDs');return manifests
}
function packetMarkdown(item,queue){
 return `# Blender node port work item\n\nStatus: needs review. Support promotion: disabled.\n\nNode: ${item.nativeNode??'unmapped shared dependency'}\nContext: ${item.domain??'requires actual native creation probe'}\nUpstream: ${queue.baselineRevision} → ${queue.targetRevision}\nQueue digest: ${queue.inputDigest}\n\nScaffolding requires the full queue JSON via \`scaffold --work-item <packet> --queue <queue.json> --output <new-directory>\`. Packet references alone do not verify queue membership.\n\n## Detected changes\n\n\`\`\`json\n${JSON.stringify(item.reasons,null,2)}\n\`\`\`\n\n## Work contract\n\n- Read the changed primary sources and resolved shared dependencies. Registration literals are discovery candidates; create the actual node in each target tree context.\n- Determine EEVEE shader versus native constant/MF execution. Test compositor CPU/GPU independently. Keep Cycles bake intent and engine-sensitive fallback explicit.\n- Define the literal/field/enum/boundary corpus with exact Float32 words. Keep undefined controls, failed baselines, carrier calibration and admitted cases distinct.\n- Check actual saved/reopened inputs and published payloads. Record storage, color processing and real backend/adapter identities.\n- Implement a bounded route with named refusals. Run the manifest's focused native/browser/Final/package/ownership checks; zero-case or N/A receipts cannot earn numeric qualification.\n- Update support metadata only after reviewed evidence. This generated packet makes no implementation or compatibility claim.\n`
}

if(command==='snapshot'){
 allowed(['--source-dir','--catalog','--output'])
 const value=await snapshotBlenderSources({sourceDirectory:required('--source-dir'),catalog:options['--catalog']?await json(options['--catalog']):undefined})
 await write(required('--output'),value)
 console.log(JSON.stringify({status:'captured',sourceRevision:value.sourceRevision,inputDigest:value.inputDigest,files:Object.keys(value.files).length,nativeCatalog:Boolean(value.catalogNodes)}))
}else if(command==='diff'){
 allowed(['--before','--after','--ports-dir','--output','--packet-dir'])
 const queue=diffBlenderSnapshots(await json(required('--before')),await json(required('--after')),await ports(options['--ports-dir']??'node-ports'))
 await write(required('--output'),queue)
 if(options['--packet-dir'])for(const item of queue.items){
  const directory=join(resolve(options['--packet-dir']),item.id);await mkdir(directory,{recursive:true})
  await write(join(directory,'work-item.json'),{schemaVersion:1,queueDigest:queue.inputDigest,targetDigest:queue.targetDigest,item})
  await writeFile(join(directory,'TASK.md'),packetMarkdown(item,queue))
 }
 console.log(JSON.stringify({status:'planned',workItems:queue.items.length,affectedManifestIds:queue.affectedManifestIds,fullIntegrationRequired:queue.fullIntegrationRequired,requiresNativeCatalog:queue.requiresNativeCatalog,inputDigest:queue.inputDigest}))
}else if(command==='scaffold'){
 allowed(['--work-item','--queue','--output'])
 const queue=await json(required('--queue')),packet=await json(required('--work-item')),item=packet.item
 assert.equal(queue.schemaVersion,1,'Unknown work queue schema');assert.equal(queue.kind,'blendlink-node-port-workqueue-v1','Unknown work queue kind')
 const {inputDigest,...queuePayload}=queue
 assert.equal(inputDigest,digest(queuePayload),'Work queue digest is stale')
 assert.match(queue.targetDigest??'',/^[a-f0-9]{64}$/,'Work queue needs its actual target snapshot digest')
 assert.match(queue.baselineDigest??'',/^[a-f0-9]{64}$/,'Work queue needs its actual baseline snapshot digest')
 assert.ok(Array.isArray(queue.items),'Work queue needs its actual item list')
 assert.equal(packet.queueDigest,inputDigest,'Packet does not reference this verified work queue')
 assert.equal(packet.targetDigest,queue.targetDigest,'Packet target does not match the verified queue target')
 assert.ok(item&&queue.items.some(candidate=>digest(candidate)===digest(item)),'Packet item is not a canonical member of the verified work queue')
 assert.equal(packet.schemaVersion,1);assert.ok(item&&/^(?:ShaderNode|CompositorNode|FunctionNode|GeometryNode|Node)[A-Za-z0-9_]+$/.test(item.nativeNode),'Select a node-specific work item')
 assert.ok(item.domain==null||['shader','compositor'].includes(item.domain),'Unknown node context; select shader/compositor or leave native context pending')
 const directory=resolve(required('--output'));await mkdir(directory,{recursive:true})
 // Exclusive creation preserves work in an existing scaffold.
 const files={
  'port-candidate.json':JSON.stringify({schemaVersion:1,lifecycle:'research',nativeNode:item.nativeNode,domain:item.domain??null,contextStatus:item.domain?'requires-native-confirmation':'pending-native-creation',queueDigest:packet.queueDigest,targetDigest:packet.targetDigest,admission:'NOT_IMPLEMENTED',productionCases:0,schemaProbe:{repositoryEnvironment:'BLENDLINK_NODE_PORT_REPOSITORY',outputEnvironment:'BLENDLINK_NODE_PORT_SCHEMA_OUTPUT',contexts:['shader:root','shader:group','compositor:root','compositor:group'],needsOracle:true},requiredProofs:['native-creation','source-evaluation-routing','exact-input-storage','native-oracle','actual-browser-apis','Final-publication','ownership-and-refusals']},null,2)+'\n',
  'cases.json':JSON.stringify({schemaVersion:1,kind:'candidate-case-plan-not-numerical-evidence',node:item.nativeNode,caseWords:['00000000','80000000','3f000000','bf000000','3f800000','bf800000','00800000','00000001','7f800000','7fc00000'],admittedCases:[],note:'Review domains and generate nextafter/enum/field controls for the actual node. No values are admitted automatically.'},null,2)+'\n',
  'native-schema.py':`# Generated discovery probe; numerical qualification remains zero.
import hashlib
import importlib.util
import json
import os
from pathlib import Path

node_id = ${JSON.stringify(item.nativeNode)}
requested_domain = ${item.domain?JSON.stringify(item.domain):'None'}
repository_value = os.environ.get('BLENDLINK_NODE_PORT_REPOSITORY')
if not repository_value:
    raise RuntimeError('Set BLENDLINK_NODE_PORT_REPOSITORY to the reviewed Blendlink checkout; run this probe in isolated factory Blender')
repository = Path(repository_value).resolve()
audit_path = repository / 'scripts/audit-node-coverage.py'
capabilities_path = repository / 'docs/node-capabilities.json'
spec = importlib.util.spec_from_file_location('blendlink_shared_node_catalog', audit_path)
audit = importlib.util.module_from_spec(spec)
audit_source = audit_path.read_bytes()
# Execute the pinned source bytes, not a timestamp/size-validated .pyc cache.
exec(compile(audit_source, str(audit_path), 'exec'), audit.__dict__)
capabilities_source = capabilities_path.read_bytes()
capabilities = json.loads(capabilities_source)
catalog = audit.native_catalog(node_ids=[node_id], enumeration_budgets=capabilities.get('nativeEnumerationBudgets', {}))
assert catalog['selection'] == {'completeInventory': False, 'nodeIds': [node_id]}
assert catalog['productionCases'] == 0 and catalog['needsOracle'] is True
available = [domain for domain, data in catalog['domains'].items() if data['nodes']]
catalog['status'] = 'schema-captured-needs-oracle' if available else 'native-creation-refused-needs-oracle'
catalog['scaffold'] = {'node': node_id, 'requestedDomain': requested_domain,
    'actualDomains': available, 'auditScriptSha256': hashlib.sha256(audit_source).hexdigest(),
    'capabilityMapSha256': hashlib.sha256(capabilities_source).hexdigest()}
output = Path(os.environ.get('BLENDLINK_NODE_PORT_SCHEMA_OUTPUT', Path(__file__).with_name('native-schema.json'))).resolve()
output.parent.mkdir(parents=True, exist_ok=True)
with output.open('x', encoding='utf8') as handle:
    handle.write(json.dumps(catalog, indent=2, sort_keys=True) + '\\n')
print('BLENDLINK_NODE_SCAFFOLD_SCHEMA', json.dumps({'status': catalog['status'], 'node': node_id,
    'version': catalog['blenderVersionTuple'], 'actualDomains': available,
    'completeInventory': False, 'productionCases': 0, 'needsOracle': True, 'output': str(output)}))
`,
 }
 for(const name of Object.keys(files)){
  try{await lstat(join(directory,name));throw new Error('Refusing to overwrite existing scaffold file '+name)}catch(error){if(error.code!=='ENOENT')throw error}
 }
 for(const [name,contents] of Object.entries(files))await writeFile(join(directory,name),contents,{flag:'wx'})
 console.log(JSON.stringify({status:'scaffolded-needs-implementation',nativeNode:item.nativeNode,files:Object.keys(files),productionCases:0,inputDigest:digest(packet)}))
}else{
 throw new Error('Use snapshot --source-dir DIR [--catalog JSON] --output JSON; diff --before JSON --after JSON [--ports-dir DIR] --output JSON [--packet-dir DIR]; scaffold --work-item JSON --queue JSON --output DIR')
}
