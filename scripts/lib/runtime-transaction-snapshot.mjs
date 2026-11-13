// An explicitly pinned, transaction-owned snapshot. No automatic persistent cache lookup.
import assert from 'node:assert/strict'
import {mkdir,readFile,readdir,realpath,writeFile,cp} from 'node:fs/promises'
import {join,resolve,relative} from 'node:path'
import {randomUUID} from 'node:crypto'
import {captureRuntimeSnapshot,hash} from './runtime-provenance.mjs'
import {validateCompilerTrace} from './runtime-compiler-trace.mjs'
async function tree(directory,predicate=()=>true){const rows=[];async function visit(path){for(const x of await readdir(path,{withFileTypes:true})){const p=join(path,x.name);assert.equal(x.isSymbolicLink(),false,'Runtime inventory cannot follow a symlink');if(x.isDirectory())await visit(p);else if(predicate(p))rows.push({name:relative(directory,p),sha256:hash(await readFile(p))})}}await visit(directory);return rows.sort((a,b)=>a.name.localeCompare(b.name))}
const inventories=async root=>({source:await tree(join(root,'packages/blendlink/src'),p=>p.endsWith('.ts')),dist:await tree(join(root,'packages/blendlink/dist'),p=>/\.(js|map)$/.test(p)||p.includes('/vendor/')),build:await tree(join(root,'packages/blendlink/scripts'))})
const fixedPaths=['package.json','package-lock.json','packages/blendlink/package.json','packages/blendlink/tsconfig.json','scripts/lib/runtime-provenance.mjs','scripts/lib/runtime-compiler-trace.mjs','scripts/lib/runtime-transaction-snapshot.mjs']
const fixedInputs=async root=>Object.fromEntries(await Promise.all(fixedPaths.map(async path=>[path,hash(await readFile(join(root,path)))])))
export async function captureRuntimeTransaction({root,directory,label='transaction runtime'}){
 root=await realpath(root);directory=resolve(directory);await mkdir(directory);directory=await realpath(directory) // Fresh ownership; never overwrite/reuse a prior transaction.
 const before={inventories:await inventories(root),fixed:await fixedInputs(root)}
 const{provenance}=await captureRuntimeSnapshot({root,built:true,destination:join(directory,'runtime'),label,compilerInputs:true})
 await cp(join(root,'packages/blendlink/dist/vendor'),join(directory,'runtime/vendor'),{recursive:true})
 provenance.snapshot.vendorFiles=(await tree(join(directory,'runtime/vendor'))).map(x=>({name:'vendor/'+x.name,sha256:x.sha256}))
 const record={schemaVersion:1,id:randomUUID(),root,directory,provenance,...before,snapshotInventory:await tree(join(directory,'runtime'))}
 const path=join(directory,'transaction.json'),contents=JSON.stringify(record,null,2)+'\n';await writeFile(path,contents)
 const result={path,sha256:hash(contents)};await loadRuntimeTransaction({root,...result});return result
}
export async function loadRuntimeTransaction({root,path,sha256}){
 assert.match(sha256??'',/^[a-f0-9]{64}$/,'Pass the parent-pinned transaction digest explicitly')
 root=await realpath(root);path=await realpath(path);const bytes=await readFile(path);assert.equal(hash(bytes),sha256,'Transaction manifest changed')
 const record=JSON.parse(bytes);assert.equal(record.schemaVersion,1);assert.equal(record.root,root);assert.equal(path,join(record.directory,'transaction.json'));assert.equal(await realpath(record.directory),record.directory)
 assert.equal(record.provenance.mode,'built');assert.equal(record.provenance.snapshot.directory,join(record.directory,'runtime'));assert.equal(record.provenance.snapshot.mode,'built')
 assert.deepEqual(await inventories(root),record.inventories,'Source/dist/build inventory drift');assert.deepEqual(await fixedInputs(root),record.fixed,'Build/attestation inputs changed')
 validateCompilerTrace(record.provenance.compilerAttestation)
 assert.deepEqual(await tree(join(record.directory,'runtime')),record.snapshotInventory,'Runtime snapshot drift')
 assert.deepEqual(record.provenance.snapshot.files.map(x=>x.name).sort(),record.provenance.modules.map(x=>x.name+'.js').sort())
 assert.deepEqual(record.inventories.source.filter(x=>!x.name.endsWith('.test.ts')&&!x.name.endsWith('.d.ts')).map(x=>x.name).sort(),record.provenance.modules.map(x=>x.name+'.ts').sort(),'Unattested production source module')
 assert.deepEqual(record.inventories.dist.filter(x=>x.name.endsWith('.js')&&!x.name.startsWith('vendor/')).map(x=>x.name).sort(),record.provenance.modules.map(x=>x.name+'.js').sort(),'Unattested emitted runtime module')
 for(const m of record.provenance.modules){assert.equal(m.emitterMatchesSource,true);const file=record.snapshotInventory.find(x=>x.name===m.name+'.js');assert.equal(file?.sha256,m.testedSnapshotSha256);assert.equal(record.provenance.snapshot.files.find(x=>x.name===file.name)?.sha256,file.sha256)}
 return{provenance:record.provenance,transaction:{path,sha256,id:record.id},record}
}
