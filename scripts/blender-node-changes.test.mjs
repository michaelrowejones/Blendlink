import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,rm,symlink} from 'node:fs/promises'
import {execFileSync} from 'node:child_process'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import test from 'node:test'
import {digest,diffBlenderSnapshots,snapshotBlenderSources,catalogNodes,matchesDependency,WATCHED_SOURCE_ROOTS,sourceDependencyGraph,legacyNodeSources} from './lib/blender-node-changes.mjs'

const source='source/blender/nodes/shader/nodes/node_shader_squeeze.cc'
const shader='source/blender/gpu/shaders/material/gpu_shader_material_squeeze.glsl'
const port={id:'squeeze',lifecycle:'production',domain:'shader',nativeNode:'ShaderNodeSqueeze',upstream:{direct:[source,shader],shared:['source/blender/nodes/shader/*.hh']}}
const catalog=()=>({schemaVersion:1,blenderBuildHash:'a'.repeat(12),blenderVersionTuple:[5,2,0],socketSchemas:{default:{inputs:[{identifier:'Value',type:'VALUE',default:0}],outputs:[{identifier:'Value',type:'VALUE'}]}},domains:{shader:{nodes:[{id:'ShaderNodeSqueeze',contexts:['root'],defaultSocketSchema:'default',contextSocketSchemas:{root:'default'},enums:{},enumStateExploration:{stateDigest:'state0',status:'complete'}}]},compositor:{nodes:[]}}})
const snapshot=(changes={})=>{const value={schemaVersion:1,collectorVersion:1,kind:'blendlink-blender-node-source-snapshot-v1',watchScope:['test'],sourceRevision:'a'.repeat(40),files:{[source]:'old',[shader]:'old'},nodeSources:{ShaderNodeSqueeze:[source]},sourceDependencies:{},catalogIdentity:{version:[5,2,0],build:'a'.repeat(12)},catalogNodes:catalogNodes(catalog()),...changes};return{...value,inputDigest:digest(value)}}

test('unchanged snapshots create no work and stable digests ignore object ordering',()=>{
 const a=snapshot();const queue=diffBlenderSnapshots(a,structuredClone(a),[port])
 assert.deepEqual(queue.items,[]);assert.deepEqual(queue.affectedManifestIds,[]);assert.equal(queue.fullIntegrationRequired,false)
 assert.equal(digest({b:1,a:2}),digest({a:2,b:1}))
})
test('changed implementation requalifies a registered port even with identical RNA sockets',()=>{
 const before=snapshot(),after=snapshot({files:{...before.files,[shader]:'new'}})
 const queue=diffBlenderSnapshots(before,after,[port]);assert.deepEqual(queue.affectedManifestIds,['squeeze'])
 assert.equal(queue.items.length,1);assert.equal(queue.items[0].domain,'shader');assert.equal(queue.items[0].supportPromotion,false)
 assert.ok(queue.items[0].reasons.some(reason=>reason.kind==='registered-port-requalification'))
})
test('shared dependencies and unknown shared source changes cannot silently skip production ports',()=>{
 const before=snapshot(),path='source/blender/blenlib/intern/math_base.cc',after=snapshot({files:{...before.files,[path]:'new'}})
 const queue=diffBlenderSnapshots(before,after,[port]);assert.deepEqual(queue.affectedManifestIds,['squeeze'])
 assert.ok(queue.items.some(item=>item.reasons.some(reason=>reason.kind==='unmapped-shared-impact')))
 assert.equal(queue.fullIntegrationRequired,true)
 const known='source/blender/nodes/shader/node_shader_util.hh'
 assert.deepEqual(diffBlenderSnapshots(before,snapshot({files:{...before.files,[known]:'new'}}),[port]).affectedManifestIds,['squeeze'])
})
test('real node addition, removal, changed contexts and same-socket enum semantics generate separate work',()=>{
 const before=snapshot()
 for(const mutate of [
  c=>{c.domains.compositor.nodes.push({...c.domains.shader.nodes[0],id:'FunctionNodeFloatToInt'})},
  c=>{c.domains.shader.nodes=[]},
  c=>{c.domains.shader.nodes[0].contexts.push('group')},
  c=>{c.domains.shader.nodes[0].enumStateExploration.stateDigest='state1'},
  c=>{c.socketSchemas.default.inputs[0].default=1},
 ]){const c=catalog();mutate(c);const queue=diffBlenderSnapshots(before,snapshot({catalogNodes:catalogNodes(c)}),[port]);assert.ok(queue.items.length);assert.ok(queue.items.every(item=>item.status==='needs-review'&&!item.supportPromotion))}
})
test('new native build requires requalification without guessing equivalence from source or sockets',()=>{
 const queue=diffBlenderSnapshots(snapshot(),snapshot({sourceRevision:'b'.repeat(40),catalogIdentity:{version:[5,2,1],build:'b'.repeat(12)}}),[port])
 assert.deepEqual(queue.affectedManifestIds,['squeeze']);assert.equal(queue.fullIntegrationRequired,true)
})
test('a source-only new revision requires native capture and production requalification even with identical watched bytes',()=>{
 const queue=diffBlenderSnapshots(snapshot(),snapshot({sourceRevision:'b'.repeat(40),catalogNodes:null,catalogIdentity:null}),[port])
 assert.equal(queue.requiresNativeCatalog,true);assert.equal(queue.nativeCatalogCompared,false);assert.equal(queue.fullIntegrationRequired,true)
 assert.deepEqual(queue.affectedManifestIds,['squeeze'])
 assert.ok(queue.items.some(item=>item.reasons.some(reason=>reason.kind==='native-catalog-required')))
 assert.ok(queue.items.every(item=>item.reasons.every(reason=>reason.kind!=='native-node-removed')))
})
test('GPU symbols, quoted headers and legacy shader pragmas generate transitive dependency candidates',()=>{
 const header='source/blender/blenlib/BLI_math.hh',utility='source/blender/gpu/shaders/common.glsl'
 const graph=sourceDependencyGraph({[source]:'#include "BLI_math.hh"\nGPU_stack_link(mat,node,"squeeze",in,out);',[header]:'// math',[shader]:'#pragma BLENDER_REQUIRE(common.glsl)\nvoid squeeze(float x) {}',[utility]:'float helper(float x) {}'})
 assert.deepEqual(graph[source],[header,shader].sort());assert.deepEqual(graph[shader],[utility])
 const before=snapshot({files:{[source]:'old',[shader]:'old',[utility]:'old'},sourceDependencies:graph})
 const after=snapshot({files:{...before.files,[utility]:'new'},sourceDependencies:graph})
 assert.deepEqual(diffBlenderSnapshots(before,after,[port]).affectedManifestIds,['squeeze'])
 assert.throws(()=>diffBlenderSnapshots(before,snapshot({watchScope:['changed']}),[port]),/watch scope changed/)
})
test('source candidates retain actual catalog context and unknown nodes require native capture',()=>{
 const before=snapshot(),queue=diffBlenderSnapshots(before,snapshot({files:{...before.files,[source]:'new'}}),[])
 assert.equal(queue.items[0].domain,'shader')
 const path='source/blender/nodes/shader/nodes/node_shader_new.cc'
 const sourceOnly=diffBlenderSnapshots(before,snapshot({files:{...before.files,[path]:'new'},nodeSources:{...before.nodeSources,ShaderNodeNew:[path]},catalogNodes:null,catalogIdentity:null}),[])
 assert.equal(sourceOnly.requiresNativeCatalog,true);assert.ok(sourceOnly.items.some(item=>item.nativeNode==='ShaderNodeNew'&&item.domain===undefined))
 assert.equal(sourceOnly.nativeCatalogCompared,false);assert.ok(sourceOnly.items.every(item=>item.reasons.every(reason=>reason.kind!=='native-node-removed')))
 const geometry='source/blender/nodes/geometry/nodes/node_geo_extrude.cc'
 const out=diffBlenderSnapshots(before,snapshot({files:{...before.files,[geometry]:'new'},nodeSources:{...before.nodeSources,GeometryNodeExtrudeMesh:[geometry]}}),[])
 assert.deepEqual(out.items,[]);assert.equal(out.sourceCandidatesOutsideObservedContexts.length,1);assert.equal(out.fullIntegrationRequired,true)
})
test('tampered snapshots, missing native schemas and unsafe dependency paths refuse',()=>{
 const bad=snapshot();bad.files[source]='changed-without-pin';assert.throws(()=>diffBlenderSnapshots(snapshot(),bad,[port]),/digest is stale/)
 const c=catalog();delete c.socketSchemas.default;assert.throws(()=>catalogNodes(c),/schema is missing/)
 for(const pattern of ['../outside','/absolute','a\\b','a[bc]'])assert.throws(()=>matchesDependency(source,pattern))
 assert.equal(matchesDependency(shader,'source/blender/gpu/**'),true)
 assert.equal(matchesDependency(shader,'source/blender/gpu/*.glsl'),false)
 const partial=catalog();partial.selection={completeInventory:false,nodeIds:['ShaderNodeSqueeze']};assert.throws(()=>catalogNodes(partial),/not a complete/)
 for(const domain of ['shader','compositor']){const incomplete=catalog();delete incomplete.domains[domain];assert.throws(()=>catalogNodes(incomplete),/both observed domains/)}
 assert.throws(()=>diffBlenderSnapshots(snapshot(),snapshot({catalogIdentity:{version:[5,2,0],build:'b'.repeat(12)}}),[port]),/does not match/)
 assert.throws(()=>diffBlenderSnapshots(snapshot(),snapshot({catalogNodes:null}),[port]),/cannot retain/)
})
test('legacy DefNode resolves enum registration with its family rather than guessing a filename',()=>{
 const mapping='DefNode(ShaderNode, SH_NODE_SQUEEZE, 0, "SQUEEZE", Squeeze, "Squeeze Value", "")\nDefNode(CompositorNode, SH_NODE_SQUEEZE, 0, "OTHER", Other, "Other", "")'
 const other='source/blender/nodes/composite/nodes/other.cc'
 const found=legacyNodeSources({'source/blender/nodes/NOD_static_types.h':mapping,[source]:'sh_node_type_base(&ntype, SH_NODE_SQUEEZE, "Squeeze", NODE_CLASS_CONVERTER);',[other]:'cmp_node_type_base(&ntype, SH_NODE_SQUEEZE, "Other", NODE_CLASS_INPUT);'})
 assert.deepEqual(found.ShaderNodeSqueeze,[source]);assert.deepEqual(found.CompositorNodeOther,[other])
})
test('native snapshot reads actual source bytes, rejects incomplete checkouts, symlinks and mismatched builds',async()=>{
 const root=await mkdtemp(join(tmpdir(),'blendlink-upstream-node-test-'))
 const git=args=>execFileSync('git',['-C',root,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim()
 const commit=()=>{git(['add','.']);git(['-c','user.name=SceneToWeb test','-c','user.email=test@example.invalid','commit','--quiet','--allow-empty','-m','Source fixture']);return git(['rev-parse','HEAD'])}
 try{
  git(['init','--quiet']);commit()
  await assert.rejects(snapshotBlenderSources({sourceDirectory:root}),/Required source root/)
  for(const path of WATCHED_SOURCE_ROOTS)await mkdir(join(root,path),{recursive:true})
  await mkdir(join(root,'source/blender/nodes/shader/nodes'),{recursive:true})
  await writeFile(join(root,'CMakeLists.txt'),'project(test)')
  await writeFile(join(root,source),'sh_node_type_base(&ntype, "ShaderNodeSqueeze"_ustr);')
  const revision=commit(),native=catalog();native.blenderBuildHash=revision.slice(0,12)
  const first=await snapshotBlenderSources({sourceDirectory:root,revision,catalog:native})
  assert.deepEqual(first.nodeSources.ShaderNodeSqueeze,[source]);assert.equal(first.files[source],digest('sh_node_type_base(&ntype, "ShaderNodeSqueeze"_ustr);'))
  await assert.rejects(snapshotBlenderSources({sourceDirectory:root,revision:'b'.repeat(40),catalog:native}),/does not match the actual checkout HEAD/)
  await assert.rejects(snapshotBlenderSources({sourceDirectory:root,catalog:catalog()}),/does not match the source revision/)
  await writeFile(join(root,source),'// uncommitted bytes under a pinned native identity')
  await assert.rejects(snapshotBlenderSources({sourceDirectory:root,catalog:native}),/Watched source must be clean/)
  git(['restore','--',source])
  git(['update-index','--assume-unchanged','--',source])
  await writeFile(join(root,source),'sh_node_type_base(&ntype, "ShaderNodeSqueezf"_ustr);')
  await assert.rejects(snapshotBlenderSources({sourceDirectory:root,catalog:native}),/Captured source bytes differ/)
  git(['update-index','--no-assume-unchanged','--',source]);git(['restore','--',source])
  const untracked='source/blender/nodes/untracked.cc';await writeFile(join(root,untracked),'// untracked node')
  await assert.rejects(snapshotBlenderSources({sourceDirectory:root}),/Watched source must be clean/);await rm(join(root,untracked))
  await writeFile(join(root,'.gitignore'),'source/blender/nodes/ignored.cc\n');commit()
  await writeFile(join(root,'source/blender/nodes/ignored.cc'),'// ignored source is still read by the collector')
  await assert.rejects(snapshotBlenderSources({sourceDirectory:root}),/untracked\/ignored input/);await rm(join(root,'source/blender/nodes/ignored.cc'))
  await symlink(join(tmpdir(),'outside'),join(root,'source/blender/nodes/link'))
  commit();await assert.rejects(snapshotBlenderSources({sourceDirectory:root}),/symbolic links/)
 }finally{await rm(root,{recursive:true,force:true})}
})

test('dependency closure retains both revisions when a direct dependency is replaced',()=>{
 const old='source/blender/blenlib/old.hh',current='source/blender/blenlib/new.hh',nested='source/blender/blenlib/nested.hh'
 const files={...snapshot().files,[old]:'same',[current]:'same',[nested]:'same'}
 const other={...port,id:'other',nativeNode:'ShaderNodeOther',upstream:{direct:[old,current,nested],shared:[]}}
 const before=snapshot({files,sourceDependencies:{[source]:[old],[old]:[nested]}})
 for(const path of [current,nested]){
  const after=snapshot({files:{...files,[path]:'new'},sourceDependencies:{[source]:[current]}})
  const queue=diffBlenderSnapshots(before,after,[port,other]);assert.deepEqual(queue.affectedManifestIds,['other','squeeze'])
  const own=queue.items.find(item=>item.nativeNode==='ShaderNodeSqueeze')
  assert.ok(own.reasons.some(reason=>reason.kind==='registered-port-requalification'&&reason.files.includes(path)))
 }
})
