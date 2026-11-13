import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {readFile,readdir,lstat} from 'node:fs/promises'
import {basename,join,relative,resolve,sep} from 'node:path'
import {spawnSync} from 'node:child_process'

export const WATCHED_SOURCE_ROOTS=Object.freeze([
  'source/blender/nodes','source/blender/gpu','source/blender/compositor',
  'source/blender/blenlib','source/blender/blenkernel','source/blender/makesrna',
  'source/blender/makesdna','source/blender/imbuf','source/blender/draw','intern/cycles',
  'source/blender/python/gpu','build_files/cmake',
])
export const OPTIONAL_SOURCE_ROOTS=Object.freeze(['scripts/addons_core/io_scene_gltf2','release/datafiles/colormanagement'])
export function canonical(value){
  if(Array.isArray(value))return value.map(canonical)
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]))
  return value
}
export const digest=value=>createHash('sha256').update(typeof value==='string'||value instanceof Uint8Array?value:JSON.stringify(canonical(value))).digest('hex')
const safePath=value=>typeof value==='string'&&value.length>0&&!value.startsWith('/')&&!value.split('/').includes('..')&&!value.includes('\\')
const nativeId=value=>typeof value==='string'&&/^(?:ShaderNode|CompositorNode|FunctionNode|GeometryNode|Node)[A-Za-z0-9_]+$/.test(value)
const sourceScope=[...WATCHED_SOURCE_ROOTS,...OPTIONAL_SOURCE_ROOTS,'CMakeLists.txt']
const collectedSource=name=>/\.(?:cc|cpp|c|hh|hpp|h|glsl|osl|metal|inl|inc|cu|cuh|mm|py|ocio|cmake)$/.test(name)||basename(name)==='CMakeLists.txt'
function nativeIdentity(identity,revision){
  assert.ok(identity&&Array.isArray(identity.version)&&identity.version.length===3&&Array.from(identity.version).every(value=>Number.isInteger(value)&&value>=0),'Native catalog needs its actual version tuple')
  assert.match(identity.build??'',/^[a-f0-9]{7,40}$/,'Native catalog needs its actual build hash')
  assert.ok(revision.startsWith(identity.build),'Native catalog build does not match the source revision')
}

export function legacyNodeSources(texts){
  const definitions=new Map(),result={},families={sh:'ShaderNode',cmp:'CompositorNode',fn:'FunctionNode',geo:'GeometryNode'}
  for(const text of Object.values(texts))for(const match of text.matchAll(/^\s*DefNode\s*\(\s*([A-Za-z_]\w*)\s*,\s*([^,]+)\s*,\s*[^,]+,\s*"[^"]*"\s*,\s*([A-Za-z_]\w*)\s*,/gm)){
    const id=match[1]+match[3];if(nativeId(id))definitions.set(match[1]+':'+match[2].trim(),id)
  }
  for(const [path,text] of Object.entries(texts))if(path.startsWith('source/blender/nodes/'))for(const match of text.matchAll(/\b(sh|cmp|fn|geo)_node_type_base\s*\(\s*&\w+\s*,\s*([A-Z][A-Z0-9_]*)\s*,/g)){
    const id=definitions.get(families[match[1]]+':'+match[2]);if(id){const paths=result[id]??[];if(!paths.includes(path))paths.push(path);result[id]=paths}
  }
  return result
}

export function sourceDependencyGraph(texts){
  const paths=Object.keys(texts),dependencies={},shaderSymbols={},byBasename=new Map()
  for(const path of paths){const name=path.slice(path.lastIndexOf('/')+1),values=byBasename.get(name)??[];values.push(path);byBasename.set(name,values)}
  for(const [path,text] of Object.entries(texts))if(path.endsWith('.glsl')||path.endsWith('.bsl.hh'))for(const match of text.matchAll(/\b(?:void|float|vec[234]|ivec[234]|mat[234]|bool|int|uint)\s+([A-Za-z_]\w*)\s*\(/g)){
    const found=shaderSymbols[match[1]]??[];if(!found.includes(path))found.push(path);shaderSymbols[match[1]]=found
  }
  for(const [path,text] of Object.entries(texts)){
    const deps=new Set(),directory=path.slice(0,path.lastIndexOf('/')+1)
    const includes=[...text.matchAll(/^\s*#\s*include\s*"([^"]+)"/gm)].map(match=>match[1])
    includes.push(...[...text.matchAll(/#pragma\s+BLENDER_REQUIRE\(([^)]+)\)/g)].map(match=>match[1]))
    for(const include of includes){
      if(Object.hasOwn(texts,directory+include))deps.add(directory+include)
      else for(const candidate of byBasename.get(include.slice(include.lastIndexOf('/')+1))??[])if(candidate===include||candidate.endsWith('/'+include))deps.add(candidate)
    }
    // Symbol candidates cover literal GPU_stack_link names and dynamic
    // get-name tables. They are dependency edges, never semantic proofs.
    if(path.startsWith('source/blender/nodes/'))for(const match of text.matchAll(/"([A-Za-z_]\w*)"/g))for(const candidate of shaderSymbols[match[1]]??[])deps.add(candidate)
    deps.delete(path);if(deps.size)dependencies[path]=[...deps].sort()
  }
  return dependencies
}

function dependencyClosure(paths,graph){
  const result=new Set(paths),pending=[...paths]
  while(pending.length){const path=pending.pop();for(const dependency of graph[path]??[])if(!result.has(dependency)){result.add(dependency);pending.push(dependency)}}
  return result
}

export function catalogNodes(catalog){
  if(!catalog)return null
  assert.equal(catalog.schemaVersion,1,'Unknown native catalog schema')
  assert.notEqual(catalog.selection?.completeInventory,false,'Focused node discovery is not a complete native catalog')
  assert.ok(catalog.domains&&catalog.socketSchemas,'Native catalog must contain actual domains and socket schemas')
  assert.deepEqual(Object.keys(catalog.domains).sort(),['compositor','shader'],'A complete native catalog must contain both observed domains')
  const nodes={}
  for(const [domain,group] of Object.entries(catalog.domains)){
    assert.ok(['shader','compositor'].includes(domain));assert.ok(Array.isArray(group.nodes))
    for(const node of group.nodes){
      assert.ok(nativeId(node.id),'Invalid native node identifier')
      const key=domain+':'+node.id;assert.ok(!Object.hasOwn(nodes,key),'Duplicate native catalog node '+key)
      const schemas={}
      for(const id of new Set([node.defaultSocketSchema,...Object.values(node.contextSocketSchemas??{}),...(node.enumStateExploration?.representativeStates??[]).map(state=>state.socketSchema)].filter(Boolean))){
        assert.ok(Object.hasOwn(catalog.socketSchemas,id),'Catalog socket schema is missing: '+id);schemas[id]=catalog.socketSchemas[id]
      }
      nodes[key]={domain,nativeNode:node.id,contexts:node.contexts,enums:node.enums,booleanDefaults:node.booleanDefaults,
        structuralDefaults:node.structuralDefaults,schemas,defaultSocketSchema:node.defaultSocketSchema,
        contextSocketSchemas:node.contextSocketSchemas,enumStateDigest:node.enumStateExploration?.stateDigest,
        enumStateStatus:node.enumStateExploration?.status,renderPassSocketVariants:node.renderPassSocketVariants??{}}
    }
  }
  return nodes
}

export async function snapshotBlenderSources({sourceDirectory,catalog,revision}){
  const root=resolve(sourceDirectory),files={},nodeSources={},texts={}
  const git=args=>{
    const result=spawnSync('git',['-C',root,...args],{encoding:'utf8',timeout:30000,maxBuffer:32*1024*1024})
    assert.equal(result.status,0,'Source directory needs a readable Git checkout: '+(result.error?.message??result.stderr??''));return result.stdout
  }
  const actualRevision=git(['rev-parse','HEAD']).trim()
  if(revision!==undefined)assert.equal(revision,actualRevision,'Explicit source revision does not match the actual checkout HEAD')
  revision=actualRevision
  assert.match(revision,/^[a-f0-9]{40}$/,'Use a resolved full upstream source commit')
  if(catalog)nativeIdentity({version:catalog.blenderVersionTuple,build:catalog.blenderBuildHash},revision)
  const assertClean=()=>{
    assert.equal(git(['rev-parse','HEAD']).trim(),revision,'Source checkout HEAD changed during capture')
    // Official source-only checkouts may retain LFS pointers without git-lfs.
    // Do not invoke external LFS filters to validate raw source identity.
    assert.equal(git(['-c','filter.lfs.process=','-c','filter.lfs.clean=','-c','filter.lfs.smudge=','-c','filter.lfs.required=false',
      'status','--porcelain=v1','--untracked-files=all','--',...sourceScope]).trim(),'','Watched source must be clean before it can carry an official native build identity')
  }
  assertClean()
  const tracked=new Map(git(['ls-tree','-r','-z',revision,'--',...sourceScope]).split('\0').filter(Boolean).flatMap(entry=>{
    const match=entry.match(/^\d+ blob ([a-f0-9]{40})\t([\s\S]+)$/);return match?[[match[2],match[1]]]:[]
  }))
  const committed=(name,bytes)=>{
    assert.ok(tracked.has(name),'Source snapshot cannot label an untracked/ignored input as committed: '+name)
    // Git's stat cache/assume-unchanged flags must not attest different bytes.
    const blob=createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex')
    assert.equal(blob,tracked.get(name),'Captured source bytes differ from the actual committed Git blob: '+name)
    files[name]=digest(bytes)
  }
  async function visit(directory){
    for(const entry of (await readdir(directory,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
      const path=join(directory,entry.name)
      if(entry.isSymbolicLink())throw new Error('Source watch does not follow symbolic links: '+path)
      if(entry.isDirectory()){await visit(path);continue}
      if(!entry.isFile()||!collectedSource(entry.name))continue
      const name=relative(root,path).split(sep).join('/'),bytes=await readFile(path)
      committed(name,bytes)
      texts[name]=bytes.toString('utf8')
      if(name.startsWith('source/blender/nodes/')){
        // A source literal is a discovery candidate. Actual native creation
        // remains authoritative; this parser never promotes node support.
        for(const match of bytes.toString('utf8').matchAll(/"((?:ShaderNode|CompositorNode|FunctionNode|GeometryNode|Node)[A-Z][A-Za-z0-9_]*)"/g)){
          const paths=nodeSources[match[1]]??[];if(!paths.includes(name))paths.push(name);nodeSources[match[1]]=paths
        }
      }
    }
  }
  for(const prefix of WATCHED_SOURCE_ROOTS){
    const directory=join(root,prefix)
    try{assert.ok((await lstat(directory)).isDirectory());await visit(directory)}catch(error){if(error.code==='ENOENT')throw new Error('Required source root is absent: '+prefix);throw error}
  }
  for(const prefix of OPTIONAL_SOURCE_ROOTS){try{assert.ok(!(await lstat(join(root,prefix))).isSymbolicLink(),'Source watch does not follow symbolic links');await visit(join(root,prefix))}catch(error){if(error.code!=='ENOENT')throw error}}
  assert.ok(!(await lstat(join(root,'CMakeLists.txt'))).isSymbolicLink(),'Source watch does not follow symbolic links')
  committed('CMakeLists.txt',await readFile(join(root,'CMakeLists.txt')))
  assert.deepEqual(Object.keys(files).sort(),[...tracked.keys()].filter(collectedSource).sort(),'Source checkout omits a committed watched input')
  assertClean()
  for(const [id,paths] of Object.entries(legacyNodeSources(texts)))nodeSources[id]=[...new Set([...(nodeSources[id]??[]),...paths])].sort()
  const snapshot={schemaVersion:1,collectorVersion:1,kind:'blendlink-blender-node-source-snapshot-v1',sourceRevision:revision,
    watchScope:[...WATCHED_SOURCE_ROOTS,...OPTIONAL_SOURCE_ROOTS,'CMakeLists.txt'],files,nodeSources,sourceDependencies:sourceDependencyGraph(texts),
    catalogIdentity:catalog?{version:catalog.blenderVersionTuple,build:catalog.blenderBuildHash}:null,catalogNodes:catalogNodes(catalog)}
  return {...snapshot,inputDigest:digest(snapshot)}
}

export function matchesDependency(path,pattern){
  assert.ok(safePath(pattern),'Dependency must be a repository-relative path')
  assert.ok(!/[{}[\]?]/.test(pattern),'Use exact paths, * or ** in upstream dependencies')
  const expression=pattern.split('**').map(part=>part.split('*').map(piece=>piece.replace(/[.+^$()|]/g,'\\$&')).join('[^/]*')).join('.*')
  return new RegExp('^'+expression+'$').test(path)
}

export function diffBlenderSnapshots(before,after,ports=[]){
  for(const snapshot of [before,after]){
    assert.equal(snapshot.schemaVersion,1);assert.equal(snapshot.kind,'blendlink-blender-node-source-snapshot-v1')
    assert.equal(snapshot.collectorVersion,1,'Unknown source collector version')
    const {inputDigest,...payload}=snapshot;assert.equal(inputDigest,digest(payload),'Source snapshot digest is stale')
    assert.match(snapshot.sourceRevision,/^[a-f0-9]{40}$/,'Unknown source revision')
    if(snapshot.catalogNodes!==null){nativeIdentity(snapshot.catalogIdentity,snapshot.sourceRevision)}
    else assert.equal(snapshot.catalogIdentity,null,'Source-only snapshots cannot retain a claimed native catalog identity')
  }
  assert.deepEqual(before.watchScope,after.watchScope,'Collector watch scope changed; regenerate the baseline explicitly')
  const changedFiles=[...new Set([...Object.keys(before.files),...Object.keys(after.files)])].sort().filter(path=>before.files[path]!==after.files[path])
  const items=new Map(),affected=new Set(),unmapped=[],outsideContexts=[]
  const add=(key,fields,reason)=>{const item=items.get(key)??{id:digest(key).slice(0,16),...fields,reasons:[],status:'needs-review',supportPromotion:false};item.reasons.push(reason);items.set(key,item)}
  const nativeBefore=before.catalogNodes??{},nativeAfter=after.catalogNodes??{}
  const compareNative=Boolean(before.catalogNodes&&after.catalogNodes)
  for(const key of compareNative?[...new Set([...Object.keys(nativeBefore),...Object.keys(nativeAfter)])].sort():[]){
    const old=nativeBefore[key],current=nativeAfter[key]
    if(digest(old??null)===digest(current??null))continue
    const node=current??old,kind=!old?'native-node-added':!current?'native-node-removed':'native-schema-changed'
    add(key,{domain:node.domain,nativeNode:node.nativeNode,priority:kind==='native-node-added'?'new-node':'regression'}, {kind,before:old??null,after:current??null})
  }
  const nativeBuildChanged=Boolean(before.catalogIdentity&&after.catalogIdentity&&digest(before.catalogIdentity)!==digest(after.catalogIdentity))
  const sourceRevisionChanged=before.sourceRevision!==after.sourceRevision
  if(sourceRevisionChanged&&!compareNative)add('native-build-validation',{priority:'native-validation'}, {kind:'native-catalog-required',sourceRevision:after.sourceRevision,reason:'A new upstream revision needs an actual native build/catalog even when watched bytes are unchanged'})
  for(const port of ports){
    assert.ok(typeof port.id==='string'&&nativeId(port.nativeNode)&&['shader','compositor'].includes(port.domain))
    const dependencies=[...(port.upstream?.direct??[]),...(port.upstream?.shared??[])]
    assert.ok(dependencies.length,'Port has no declared upstream dependencies: '+port.id)
    const direct=[...new Set([...Object.keys(before.files),...Object.keys(after.files)])].filter(path=>dependencies.some(pattern=>matchesDependency(path,pattern)))
    const graph=Object.fromEntries([...new Set([...Object.keys(before.sourceDependencies??{}),...Object.keys(after.sourceDependencies??{})])]
      .map(path=>[path,[...new Set([...(before.sourceDependencies?.[path]??[]),...(after.sourceDependencies?.[path]??[])])]]))
    const resolved=dependencyClosure(direct,graph)
    const touched=changedFiles.filter(path=>resolved.has(path))
    const key=port.domain+':'+port.nativeNode
    if(touched.length||items.has(key)||nativeBuildChanged||sourceRevisionChanged&&port.lifecycle==='production'){
      affected.add(port.id)
      add(key,{domain:port.domain,nativeNode:port.nativeNode,priority:'regression'}, {kind:'registered-port-requalification',manifestId:port.id,files:touched,nativeBuildChanged,sourceRevisionChanged})
    }
  }
  for(const path of changedFiles){
    const ids=[...new Set([...Object.entries(before.nodeSources),...Object.entries(after.nodeSources)].filter(([,paths])=>paths.includes(path)).map(([id])=>id))]
    if(ids.length)for(const id of ids){
      const keyCandidates=[...new Set([...items.keys(),...Object.keys(nativeBefore),...Object.keys(nativeAfter)])].filter(key=>key.endsWith(':'+id))
      if(compareNative&&!keyCandidates.length&&!ports.some(port=>port.nativeNode===id)){
        outsideContexts.push({nativeNode:id,path,reason:'No successful creation in either observed shader/compositor catalog'});continue
      }
      const keys=keyCandidates.length?keyCandidates:['source:'+id]
      for(const key of keys)add(key,{nativeNode:id,...(key.startsWith('source:')?{}:{domain:key.split(':')[0]}),priority:'source-review'}, {kind:'node-source-changed',path,discovery:'source-literal-candidate; native creation required'})
    }
    else if(!ports.some(port=>[...(port.upstream?.direct??[]),...(port.upstream?.shared??[])].some(pattern=>matchesDependency(path,pattern))))unmapped.push(path)
  }
  if(unmapped.length){
    add('shared-source-review',{priority:'shared-review'}, {kind:'unmapped-source-changes',files:unmapped})
    // Missing dependency knowledge cannot silently exclude a production port.
    for(const port of ports)if(port.lifecycle==='production'){affected.add(port.id);add(port.domain+':'+port.nativeNode,{domain:port.domain,nativeNode:port.nativeNode,priority:'regression'}, {kind:'unmapped-shared-impact',manifestId:port.id,files:unmapped})}
  }
  const queue={schemaVersion:1,kind:'blendlink-node-port-workqueue-v1',baselineDigest:before.inputDigest,targetDigest:after.inputDigest,
    baselineRevision:before.sourceRevision,targetRevision:after.sourceRevision,changedFiles,affectedManifestIds:[...affected].sort(),sourceCandidatesOutsideObservedContexts:outsideContexts,
    fullIntegrationRequired:changedFiles.length>0||nativeBuildChanged||sourceRevisionChanged,nativeCatalogCompared:compareNative,requiresNativeCatalog:!compareNative,items:[...items.values()].sort((a,b)=>a.id.localeCompare(b.id))}
  return {...queue,inputDigest:digest(queue)}
}
