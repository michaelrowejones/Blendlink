// SPDX-License-Identifier: MIT
// Incremental generation plan only. Never substitutes for current numerical acceptance.
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {readFile,realpath,writeFile} from 'node:fs/promises'
import {join,resolve,basename} from 'node:path'
import {pathToFileURL} from 'node:url'
const hash=b=>createHash('sha256').update(b).digest('hex')
const stable=x=>JSON.stringify(x,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort()):v)
const pin=value=>assert.match(value,/^[a-f0-9]{64}$/)
export function validateSnapshot(s){
 assert.equal(s.schemaVersion,1);assert.equal(s.kind,'compiler-generation-inputs-only')
 assert.ok(Object.keys(s.global).length>0&&Object.keys(s.families).length>0)
 for(const bucket of [s.global,...Object.values(s.families)]){assert.ok(Object.keys(bucket).length>0);for(const[path,sha]of Object.entries(bucket)){assert.ok(path);pin(sha)}}
 return s
}
export function planUpdate(before,after){
 validateSnapshot(before);validateSnapshot(after)
 const delta=(a,b)=>[...new Set([...Object.keys(a),...Object.keys(b)])].filter(k=>a[k]!==b[k]).sort()
 const sharedChanges=delta(before.global,after.global),names=[...new Set([...Object.keys(before.families),...Object.keys(after.families)])].sort()
 return {schemaVersion:1,kind:'compiler-generation-plan',supportPromotion:false,numericalAcceptanceReusable:false,sharedChanges,
  families:names.map(name=>{
   const old=before.families[name],current=after.families[name]
   const changedInputs=delta(old??{},current??{})
   return {name,status:!current?'removed-needs-review':!old?'new-needs-review':sharedChanges.length||changedInputs.length?'regenerate-and-reverify':'generation-inputs-unchanged',changedInputs,
    generationKey:current?hash(stable({global:after.global,family:current})):null,
    freshNumericalVerificationRequired:!!current&&(sharedChanges.length>0||changedInputs.length>0||!old)}
  })}
}
export function generationProfile(g,directory){
 const prefixes=[directory,resolve(directory)].sort((a,b)=>b.length-a.length)
 const normalize=arg=>{assert.equal(typeof arg,'string');for(const prefix of prefixes)arg=arg.split(prefix).join('$OUTPUT');return arg}
 assert.ok(Array.isArray(g.commands)&&g.commands.length>0)
 const commands=g.commands.map(c=>{assert.equal(c.returncode,0);assert.ok(Array.isArray(c.command));return c.command.map(normalize)})
 return hash(stable({blenderCommit:g.blenderCommit,nagaVersion:g.nagaVersion,clangVersion:g.clangVersion,compatibilityMacros:g.compatibilityMacros,commands}))
}
export async function snapshotGeneration(directory,extraTools){
 const folder=await realpath(directory),g=JSON.parse(await readFile(join(folder,'generation.json')))
 assert.equal(g.status,'CANONICAL_LOWERING_AND_NAGA_VALIDATION_PASSED')
 assert.equal(hash(await readFile(join(folder,'modules.json'))),g.modulesSha256)
 assert.ok(extraTools&&Object.keys(extraTools).length>=2,'Explicit generator and clang binary pins required')
 const global={},families={},sourceKeys=Object.keys(g.sources),byName=new Map()
 for(const path of sourceKeys){const name=basename(path),matches=byName.get(name)??[];matches.push(path);byName.set(name,matches)}
 // Anything not proven family-local stays global. Conservative invalidation is safe.
 const familyPaths=new Set()
 for(const[name,module]of Object.entries(g.modules)){
  const inputs={}
  for(const dependency of module.dependencies){
   const matches=byName.get(dependency);assert.equal(matches?.length,1,'Ambiguous/unpinned compiler dependency: '+dependency)
   const paths=[matches[0]],depfile=await readFile(join(folder,dependency+'.d'),'utf8')
   const parts=depfile.split(' : ');assert.equal(parts.length,2,'Unsupported depfile grammar')
   for(const token of parts[1].trim().split(/\s+/).filter(Boolean)){assert.ok(Object.hasOwn(g.sources,token),'Unpinned transitive dependency: '+token);paths.push(token)}
   for(const path of paths){assert.equal(hash(await readFile(path)),g.sources[path],'Source drift: '+path);inputs[path]=g.sources[path];familyPaths.add(path)}
  }
  assert.ok(Object.keys(inputs).length);families[name]=inputs
 }
 for(const[path,sha]of Object.entries(g.sources)){assert.equal(hash(await readFile(path)),sha,'Source drift: '+path);if(!familyPaths.has(path))global[path]=sha}
 for(const[name,path]of Object.entries(extraTools)){assert.ok(['generator','clang'].includes(name));global['tool:'+name]=hash(await readFile(await realpath(path)))}
 for(const name of ['generator','clang'])assert.ok(global['tool:'+name])
 global['generation:profile']=generationProfile(g,directory)
 global['planner']=hash(await readFile(import.meta.filename))
 return validateSnapshot({schemaVersion:1,kind:'compiler-generation-inputs-only',global,families})
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const [generation,generator,clang,out,...extra]=process.argv.slice(2);assert.ok(out&&!extra.length,'Usage: plan.mjs GENERATION GENERATOR CLANG NEW_OUTPUT')
 const snapshot=await snapshotGeneration(generation,{generator,clang});await writeFile(out,JSON.stringify(snapshot,null,2)+'\n',{flag:'wx'})
 console.log(JSON.stringify({families:Object.keys(snapshot.families),sharedInputs:Object.keys(snapshot.global).length,supportPromotion:false}))
}
