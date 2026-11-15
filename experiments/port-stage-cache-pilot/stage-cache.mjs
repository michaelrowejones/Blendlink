import assert from 'node:assert/strict'
import {createHash,randomUUID} from 'node:crypto'
import {lstat,mkdir,mkdtemp,readFile,readdir,realpath,rename,rm,writeFile} from 'node:fs/promises'
import {join,resolve,sep} from 'node:path'
export const hash=bytes=>createHash('sha256').update(bytes).digest('hex')
const keys=(value,names)=>assert.deepEqual(Object.keys(value).sort(),[...names].sort(),'Unknown or missing stage schema fields')
const stable=value=>JSON.stringify(value,(_,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a<b?-1:a>b?1:0)):item)
export function nativeReferenceKey(input){
 keys(input,['schemaVersion','stage','family','native','upstream','settings','sourcePins','cases','referenceContract'])
 assert.equal(input.schemaVersion,1);assert.equal(input.stage,'native-reference');assert.equal(input.family,'compositor-integer-vector3')
 assert.equal(input.native.version,'5.3.0');assert.equal(input.native.build,'02f0899d78e3');assert.match(input.native.sha256,/^[a-f0-9]{64}$/);assert.ok(Number.isSafeInteger(input.native.bytes)&&input.native.bytes>0)
 assert.equal(input.upstream.revision,'02f0899d78e374b63e7181d9061e1f7ab03419cc');assert.ok(Array.isArray(input.upstream.sources)&&input.upstream.sources.length>0)
 assert.equal(input.settings.context,'CPU');assert.ok(Array.isArray(input.sourcePins)&&input.sourcePins.length>0);assert.ok(Array.isArray(input.cases)&&input.cases.length>0)
 for(const row of [...input.sourcePins,...input.upstream.sources]){assert.equal(typeof row.path,'string');assert.match(row.sha256,/^[a-f0-9]{64}$/)}
 assert.equal(new Set(input.sourcePins.map(row=>row.path)).size,input.sourcePins.length);assert.equal(new Set(input.cases.map(row=>row.case)).size,input.cases.length)
 return hash(stable(input))
}
export async function plainFile(root,name){
 assert.equal(typeof name,'string');assert.ok(name&&!name.includes('\\')&&!name.startsWith('/')&&name.split('/').every(x=>x&&x!=='.'&&x!=='..'),'Unsafe owned stage path')
 const owner=await realpath(root);let current=owner
 for(const part of name.split('/')){current=join(current,part);assert.equal((await lstat(current)).isSymbolicLink(),false,'Stage paths cannot contain symlinks')}
 const info=await lstat(current);assert.ok(info.isFile(),'Stage artifact is not a plain file');assert.equal(await realpath(current),current);assert.ok(current.startsWith(owner+sep));return current
}
async function inventory(root,prefix=''){
 const rows=[]
 for(const x of(await readdir(join(root,prefix),{withFileTypes:true})).sort((a,b)=>a.name<b.name?-1:1)){
  assert.equal(x.isSymbolicLink(),false,'Stage cache cannot contain symlinks');const name=prefix+x.name
  if(x.isDirectory())rows.push(...await inventory(root,name+'/'));else{assert.ok(x.isFile(),'Unexpected stage entry');rows.push(name)}
 }return rows
}
export function acceptancePlan({nativeKey,runtimeKey}){
 assert.match(nativeKey,/^[a-f0-9]{64}$/);assert.match(runtimeKey,/^[a-f0-9]{64}$/)
 return{stage:'final-acceptance',reuse:false,status:'requires-fresh-public-install-and-independent-reader',nativeReferenceKey:nativeKey,runtimeKey,runNonce:randomUUID(),required:['current-source-admission','actual-saved-Final-public-install','shared-installed-canary','all-required-browser-gates','independent-reader'],numericalCredit:0}
}
export async function loadNativeStage(cache,input){
 const key=nativeReferenceKey(input),folder=join(resolve(cache),key)
 try{await lstat(folder)}catch(error){if(error.code==='ENOENT')return{status:'miss',key,numericalCredit:0};throw error}
 assert.equal((await lstat(folder)).isSymbolicLink(),false,'Stage directory cannot be a symlink')
 const manifest=JSON.parse(await readFile(await plainFile(folder,'stage.json'),'utf8'));keys(manifest,['schemaVersion','stage','key','inputs','artifacts','numericalCredit'])
 assert.equal(manifest.schemaVersion,1);assert.equal(manifest.stage,'native-reference');assert.equal(manifest.key,key);assert.equal(manifest.numericalCredit,0);assert.equal(stable(manifest.inputs),stable(input),'Cache dependency mismatch')
 assert.ok(Array.isArray(manifest.artifacts)&&manifest.artifacts.length>0);assert.equal(new Set(manifest.artifacts.map(row=>row.path)).size,manifest.artifacts.length)
 for(const row of manifest.artifacts){keys(row,['path','bytes','sha256']);assert.match(row.sha256,/^[a-f0-9]{64}$/);const bytes=await readFile(await plainFile(folder,row.path));assert.equal(bytes.length,row.bytes,'Cached byte count changed');assert.equal(hash(bytes),row.sha256,'Cached stage bytes changed')}
 assert.deepEqual((await inventory(folder)).sort(),['stage.json',...manifest.artifacts.map(row=>row.path)].sort(),'Cache artifact census changed')
 return{status:'hit',key,folder,manifest,numericalCredit:0}
}
export async function storeNativeStage(cache,input,{owner,artifacts}){
 const key=nativeReferenceKey(input);assert.ok(Array.isArray(artifacts)&&artifacts.length>0);assert.equal(new Set(artifacts.map(row=>row.path)).size,artifacts.length)
 await mkdir(cache,{recursive:true});const cached=await loadNativeStage(cache,input);if(cached.status==='hit')return cached
 const temporary=await mkdtemp(join(resolve(cache),'.incoming-'))
 try{
  const copied=[]
  for(const row of artifacts){keys(row,['path','bytes','sha256']);assert.notEqual(row.path,'stage.json');const bytes=await readFile(await plainFile(owner,row.path));assert.equal(bytes.length,row.bytes);assert.equal(hash(bytes),row.sha256,'Retained source artifact changed before storage');const target=join(temporary,row.path);await mkdir(resolve(target,'..'),{recursive:true});await writeFile(target,bytes,{flag:'wx'});copied.push({...row})}
  const manifest={schemaVersion:1,stage:'native-reference',key,inputs:input,artifacts:copied,numericalCredit:0};await writeFile(join(temporary,'stage.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'})
  try{await rename(temporary,join(resolve(cache),key))}catch(error){if(!['EEXIST','ENOTEMPTY'].includes(error.code))throw error}
 }finally{await rm(temporary,{recursive:true,force:true})}
 return loadNativeStage(cache,input)
}
