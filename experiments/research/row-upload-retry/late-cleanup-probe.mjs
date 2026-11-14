/* SPDX-License-Identifier: MIT */
// Negative CPU-only ownership evidence against 0bd2e7e, before its follow-up.
import assert from 'node:assert/strict'
import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {createHash} from 'node:crypto'
import Textures from 'three/src/renderers/common/Textures.js'
import Info from 'three/src/renderers/common/Info.js'
import WebGPUTextureUtils from 'three/src/renderers/webgpu/utils/WebGPUTextureUtils.js'
import {OwnedCompositorRowTable} from '../../../packages/blendlink/src/tslCompositorRowTable.ts'
const root=resolve(import.meta.dirname,'../../..'),out=resolve(process.argv[2]),hash=bytes=>createHash('sha256').update(bytes).digest('hex')
function host(api){
 const data=new WeakMap(),handles=[],info=new Info();let fail=false,originalDeletes=0,replacementDeletes=0
 const gl={R32F:33326,RED:6403,FLOAT:5126,isContextLost:()=>false,deleteTexture(handle){originalDeletes++;handle.destroys++}}
 const replacement={...gl,deleteTexture(handle){replacementDeletes++;handle.destroys++}}
 const backend={isWebGPUBackend:api==='webgpu',isWebGLBackend:api==='webgl2',device:{},gl,has:t=>data.has(t),get(t){let p=data.get(t);if(!p){p={};data.set(t,p)}return p},delete:t=>data.delete(t),createTexture(t){const handle={width:t.image.width,height:t.image.height,format:'r32float',destroys:0,destroy(){this.destroys++}};handles.push(handle);Object.assign(this.get(t),api==='webgpu'?{texture:handle,textureDescriptorGPU:{format:'r32float'}}:{textureGPU:handle,glInternalFormat:33326,glFormat:6403,glType:5126});if(fail)throw Error('CONTROL partial allocation')},updateTexture(){},generateMipmaps(){throw Error('Unexpected mips')},destroyTexture(t,isDefault){if(api==='webgpu')new WebGPUTextureUtils(this).destroyTexture(t,isDefault);else{const p=data.get(t);if(!isDefault)this.gl.deleteTexture(p.textureGPU);this.delete(t)}}}
 const target={width:13,height:9,viewport:{x:0,y:0,z:13,w:9},scissorTest:false},renderer={isWebGPURenderer:true,backend,_textures:undefined,getDrawingBufferSize:v=>v.set(13,9),getRenderTarget:()=>target},manager=new Textures(renderer,backend,info);renderer._textures=manager
 const owner=new OwnedCompositorRowTable(2,()=>new Float32Array(26).fill(.25),{label:'Late cleanup research',name:'Owned late cleanup rows'}),all=[];owner.sample('X',0).traverse(n=>{if(n.isTextureNode)all.push(n.value)});assert.equal(new Set(all).size,1);const texture=all[0]
 return{owner,texture,backend,manager,info,handles,data,replacement,fail:()=>{fail=true},upload(){owner.validate(renderer);manager.updateTexture(texture)},counts:()=>({originalDeletes,replacementDeletes})}
}
const rows=[]
{
 const f=host('webgl2');f.fail();assert.throws(()=>f.upload(),/CONTROL/);f.manager.dispose();f.info.dispose();f.backend.gl=f.replacement;f.owner.dispose();rows.push({case:'late-partial-replaced-context',...f.counts(),destroys:f.handles.map(h=>h.destroys)})
}
for(const api of['webgpu','webgl2']){
 const f=host(api);f.upload();f.texture.addEventListener('dispose',()=>{f.manager.dispose();f.info.dispose()});f.owner.dispose();rows.push({case:api+'-post-native-manager-reset',destroys:f.handles.map(h=>h.destroys)})
}
{
 const f=host('webgpu');f.upload();const borrowed={destroys:0,destroy(){this.destroys++}};f.data.get(f.texture).msaaTexture=borrowed;f.owner.dispose();rows.push({case:'added-borrowed-msaa',destroys:f.handles.map(h=>h.destroys),borrowedDestroys:borrowed.destroys})
}
{
 const f=host('webgpu');f.upload();f.manager.data.get(f.texture).isDefaultTexture=true;f.owner.dispose();rows.push({case:'mutated-default-flag',destroys:f.handles.map(h=>h.destroys)})
}
assert.deepEqual(rows,[{case:'late-partial-replaced-context',originalDeletes:0,replacementDeletes:1,destroys:[1]},{case:'webgpu-post-native-manager-reset',destroys:[2]},{case:'webgl2-post-native-manager-reset',destroys:[2]},{case:'added-borrowed-msaa',destroys:[1],borrowedDestroys:1},{case:'mutated-default-flag',destroys:[0]}])
const files=['experiments/research/row-upload-retry/late-cleanup-probe.mjs','packages/blendlink/src/tslCompositorRowTable.ts','node_modules/three/src/renderers/common/Textures.js','node_modules/three/src/renderers/common/Info.js','node_modules/three/src/renderers/webgpu/utils/WebGPUTextureUtils.js']
const sourcePins=Object.fromEntries(await Promise.all(files.map(async file=>[file,hash(await readFile(join(root,file)))])))
await mkdir(out);await writeFile(join(out,'report.json'),JSON.stringify({status:'RESEARCH_CONFIRMED_ROW_CLEANUP_EDGE_FAILURES',supportCredit:0,gpuJobs:0,nativeJobs:0,sourceCommit:'0bd2e7e',model:'Actual row owner + Three Textures/Info/WebGPUTextureUtils, CPU handle counters',sourcePins,rows},null,2)+'\n');console.log('CONFIRMED_ROW_CLEANUP_EDGE_FAILURES',rows.length)
