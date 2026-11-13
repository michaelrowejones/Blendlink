// Strict closed reader for built browser archives. The caller derives current
// provenance independently once, then shares it across one frozen proof matrix.
import assert from 'node:assert/strict'
import {readFile,readdir,realpath,lstat} from 'node:fs/promises'
import {join,relative} from 'node:path'
import {hash,normalizeEmit} from './runtime-provenance.mjs'
const names=records=>records.map(record=>record.name).sort()
const canonical=records=>[...records].sort((a,b)=>a.name.localeCompare(b.name))
const pin=async(file,expected)=>assert.equal(hash(await readFile(file)),expected,'Archived proof bytes changed: '+file)
async function inventory(directory,prefix=''){
 let entries
 try{entries=await readdir(directory,{withFileTypes:true})}catch(error){if(error.code==='ENOENT'&&!prefix)return[];throw error}
 const files=[]
 for(const entry of entries){
  assert.equal(entry.isSymbolicLink(),false,'Proof archive must not contain symbolic links: '+join(directory,entry.name))
  const name=prefix+entry.name,file=join(directory,entry.name)
  if(entry.isDirectory())files.push(...await inventory(file,name+'/'))
  else{assert.equal(entry.isFile(),true,'Unsupported proof archive entry: '+file);files.push({name,sha256:hash(await readFile(file))})}
 }
 return canonical(files)
}
export async function assertBuiltRuntimeArchive({root,current,provenance,runtimeDirectory,fixtureDirectory,fixtureSourceDirectory,fixtureNames=['browser.js','index.html']}){
 assert.ok(current.modules.length>0,'An independently captured current runtime is required')
 assert.equal(current.mode,'built');assert.equal(provenance.mode,'built');assert.equal(provenance.snapshot.mode,'built')
 assert.equal(provenance.typescript,current.typescript);assert.equal(provenance.copyAssetsSha256,current.copyAssetsSha256)
 assert.deepEqual(provenance.postEmitRules,current.postEmitRules)
 for(const directory of [runtimeDirectory,fixtureDirectory])assert.equal((await lstat(directory)).isSymbolicLink(),false,'Owned archive directories must not be symbolic links')
 assert.equal(await realpath(provenance.snapshot.directory),await realpath(runtimeDirectory),'Snapshot runtime directory is not the expected owned archive')
 const currentNames=names(current.modules)
 assert.equal(new Set(currentNames).size,currentNames.length)
 assert.deepEqual(names(provenance.modules),currentNames,'Receipt module census differs from current independent production emission')
 assert.deepEqual(names(provenance.snapshot.files),currentNames.map(name=>name+'.js').sort(),'Snapshot manifest module census is incomplete or duplicated')
 const expectedFiles=[],expectedMaps=[]
 for(const now of current.modules){
  const module=provenance.modules.find(record=>record.name===now.name)
  for(const key of ['sourceSha256','expectedEmitterSha256','emitterSha256','postEmitTransform'])assert.deepEqual(module[key],now[key],'Current independent emission differs: '+now.name+' '+key)
  assert.equal(now.emitterMatchesSource,true);assert.equal(module.emitterMatchesSource,true)
  await pin(join(root,'packages/blendlink/src',now.name+'.ts'),now.sourceSha256)
  const name=now.name+'.js',dist=await readFile(join(root,'packages/blendlink/dist',name)),rawSha256=hash(dist)
  assert.equal(hash(normalizeEmit(dist.toString('utf8'))),now.expectedEmitterSha256,'Current built emission drifted after independent capture: '+name)
  assert.equal(module.testedSnapshotSha256,rawSha256,'Snapshot raw JavaScript differs from current dist: '+name)
  assert.equal(provenance.snapshot.files.find(record=>record.name===name).sha256,rawSha256)
  expectedFiles.push({name,sha256:rawSha256})
  const mapName=name+'.map'
  try{expectedMaps.push({name:mapName,sha256:hash(await readFile(join(root,'packages/blendlink/dist',mapName)))})}catch(error){if(error.code!=='ENOENT')throw error}
 }
 assert.deepEqual(canonical(provenance.snapshot.sourceMaps),canonical(expectedMaps),'Source-map archive census/hash differs from current dist')
 const vendor=(await inventory(join(root,'packages/blendlink/dist/vendor'))).map(record=>({name:'vendor/'+record.name,sha256:record.sha256}))
 assert.deepEqual(canonical(provenance.snapshot.vendorFiles),canonical(vendor),'Vendor archive census/hash differs from current dist')
 assert.deepEqual(await inventory(runtimeDirectory),canonical([...expectedFiles,...expectedMaps,...vendor]),'Actual runtime archive inventory/hash differs from the closed manifest/current dist')
 assert.deepEqual(Object.keys(provenance.fixturePins).sort(),[...fixtureNames].sort(),'Fixture manifest census differs from expected browser files')
 const expectedFixtures=[]
 for(const name of fixtureNames){assert.equal(relative('.',name),name);assert.ok(!name.includes('..')&&!name.includes('/')&&!name.includes('\\'),'Fixture file names must be direct children');await pin(join(fixtureSourceDirectory,name),provenance.fixturePins[name]);expectedFixtures.push({name,sha256:provenance.fixturePins[name]})}
 assert.deepEqual(await inventory(fixtureDirectory),canonical(expectedFixtures),'Actual fixture archive inventory/hash differs from current pinned fixture')
 return hash(JSON.stringify(current.modules.map(module=>({name:module.name,source:module.sourceSha256,built:module.emitterSha256}))))
}
