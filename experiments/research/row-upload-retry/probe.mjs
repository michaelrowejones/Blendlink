/* SPDX-License-Identifier: MIT */
// CPU-only: real Three Textures/Info and actual production row owner. Physical
// backend handles are explicit counters; no GPU renderer, browser, or native job.
import assert from 'node:assert/strict'
import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {createHash} from 'node:crypto'
import Textures from 'three/src/renderers/common/Textures.js'
import Info from 'three/src/renderers/common/Info.js'
import {OwnedCompositorRowTable} from '../../../packages/blendlink/src/tslCompositorRowTable.ts'
const root=resolve(import.meta.dirname,'../../..'),output=resolve(process.argv[2]??join(root,'artifacts/verification-row-upload-retry-r1'))
const sha=bytes=>createHash('sha256').update(bytes).digest('hex')
function fixture(api){
 const physical=new WeakMap(),handles=[],info=new Info(),state={width:13,height:9};let fail
 const gl={R32F:33326,RED:6403,FLOAT:5126,isContextLost:()=>false,deleteTexture:handle=>{handle.destroys++}}
 const backend={isWebGPUBackend:api==='webgpu',isWebGLBackend:api==='webgl2',device:{},gl,has:object=>physical.has(object),get(object){let value=physical.get(object);if(!value){value={};physical.set(object,value)}return value},delete:object=>physical.delete(object),createTexture(texture){
  const handle={width:texture.image.width,height:texture.image.height,format:'r32float',destroys:0,destroy(){this.destroys++}}
  handles.push(handle)
  Object.assign(this.get(texture),api==='webgpu'?{texture:handle,textureDescriptorGPU:{format:'r32float'}}:{textureGPU:handle,glInternalFormat:gl.R32F,glFormat:gl.RED,glType:gl.FLOAT})
  if(fail==='create')throw Error('Owned create allocated then threw before onUpdate')
 },updateTexture(){if(fail==='upload')throw Error('Owned upload threw before onUpdate')},generateMipmaps(){throw Error('Unexpected mips')},destroyTexture(texture){const record=physical.get(texture);if(api==='webgpu')record.texture.destroy();else gl.deleteTexture(record.textureGPU);physical.delete(texture)}}
 const target={width:13,height:9,viewport:{x:0,y:0,z:13,w:9},scissorTest:false}
 const renderer={isWebGPURenderer:true,backend,_textures:undefined,getDrawingBufferSize:value=>value.set(state.width,state.height),getRenderTarget:()=>target}
 const manager=new Textures(renderer,backend,info);renderer._textures=manager
 const owner=new OwnedCompositorRowTable(2,(w,h)=>new Float32Array(Math.max(w,h)*2).fill(.25),{label:'Research rows',name:'Owned retry research rows'})
 const all=[] // Retain the texture through an actual owned sample.
 const node=owner.sample('X',0);node.traverse(child=>{if(child.isTextureNode)all.push(child.value)});assert.equal(new Set(all).size,1);const texture=all[0]
 const upload=()=>{owner.validate(renderer);manager.updateTexture(texture)}
 return{owner,upload,handles,info,manager,texture,fail:value=>{fail=value}}
}
const rows=[]
for(const api of['webgpu','webgl2'])for(const mode of['none','create','upload'])for(const route of['dispose','retry']){
 const f=fixture(api);let error
 if(mode!=='none')f.fail(mode)
 try{f.upload()}catch(reason){error=String(reason)}
 assert.equal(!!error,mode!=='none')
 const afterFailure=f.handles.map(handle=>handle.destroys)
 if(route==='retry'){f.fail(undefined);f.upload()}
 f.owner.dispose();f.owner.dispose()
 const destroys=f.handles.map(handle=>handle.destroys),leaked=destroys.filter(count=>count===0).length
 rows.push({case:api+'-'+mode+'-'+route,api,mode,route,error:error??null,afterFailure,allocated:f.handles.length,destroys,leaked,textureCounter:f.info.memory.textures,renderTargetCounter:f.info.memory.renderTargets})
}
const controls=rows.filter(row=>row.mode==='none');assert.ok(controls.every(row=>row.allocated===1&&row.leaked===0&&row.destroys[0]===1&&row.textureCounter===0))
assert.ok(rows.filter(row=>row.mode==='create'&&row.route==='retry').every(row=>row.allocated===2&&JSON.stringify(row.destroys)==='[0,1]'))
assert.ok(rows.filter(row=>row.mode!=='none'&&row.route==='dispose').every(row=>row.allocated===1&&JSON.stringify(row.destroys)==='[0]'))
const paths=['experiments/research/row-upload-retry/probe.mjs','packages/blendlink/src/tslCompositorRowTable.ts','node_modules/three/src/renderers/common/Textures.js','node_modules/three/src/renderers/common/Info.js','node_modules/three/package.json']
const sourcePins=Object.fromEntries(await Promise.all(paths.map(async file=>[file,sha(await readFile(join(root,file)))])))
const report={schemaVersion:1,status:'RESEARCH_CONFIRMED_ROW_PRE_ONUPDATE_PARTIAL_LEAK',supportCredit:0,gpuJobs:0,nativeJobs:0,model:'Actual production OwnedCompositorRowTable + real Three Textures/Info + explicit CPU backend handle counters',sourcePins,rows,limits:['No real GPU allocation or rendering credit','No SDK edits; original backend exception retained','Callback-validation failures after onUpdate are a different already-tested path']}
await mkdir(output,{recursive:true});await writeFile(join(output,'report.json'),JSON.stringify(report,null,2)+'\n')
console.log(JSON.stringify({status:report.status,rows:rows.length,leakingCases:rows.filter(row=>row.leaked).map(row=>({case:row.case,destroys:row.destroys})),supportCredit:0},null,2))
