// SPDX-License-Identifier: MIT
import * as T from 'three'
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js'
import {installThreeCompiledScene,installLoadedThreeCompiledScene,startThreeCompiledScenePreparation} from '/runtime.js'
const assert=(v,m)=>{if(!v)throw Error(m)}
window.run=async()=>{
 const nativeCreate=globalThis.createImageBitmap,nativeClose=ImageBitmap.prototype.close,records=[],results=[]
 let gate=null
 globalThis.createImageBitmap=async function(...args){
  const bitmap=await nativeCreate.apply(this,args),row={bitmap,closeCalls:0,initial:[bitmap.width,bitmap.height]};records.push(row)
  assert(bitmap instanceof ImageBitmap,'decoder did not return actual native ImageBitmap')
  Object.defineProperty(bitmap,'close',{value:function(){row.closeCalls++;return nativeClose.call(this)},configurable:true})
  if(gate){const held=gate;gate=null;held.created(row);await held.wait}
  return bitmap
 }
 const renderer=new T.WebGLRenderer({antialias:false});renderer.setSize(8,8)
 const gl=renderer.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info'),identity={vendor:gl.getParameter(ext.UNMASKED_VENDOR_WEBGL),renderer:gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)}
 assert(/Apple|Metal/.test(JSON.stringify(identity)),'unexpected actual GL backend '+JSON.stringify(identity))
 const descriptor=url=>({url,nodes:{},playback:{start:'manual',loop:'repeat',speed:1},look:{toneMapping:'application',exposure:0,background:'application'}})
 const options=(url='/packed.glb')=>({descriptor:descriptor(url),renderer,scene:new T.Scene(),prewarm:false,useAuthoringPreview:false})
 const texture=loaded=>{let map;loaded.scene.traverse(o=>{if(o.isMesh)map=o.material.map});assert(map?.isTexture,'loaded carrier texture absent');return map}
 const take=(start,closed)=>{
  const rows=records.slice(start);assert(rows.length===1,'expected exactly one native decode, got '+rows.length)
  for(const row of rows){assert(row.closeCalls===closed,'unexpected close count '+row.closeCalls);assert(row.bitmap.width===(closed?0:2),'unexpected native bitmap width');assert(row.bitmap.height===(closed?0:2),'unexpected native bitmap height')}
  return rows.map(row=>({nativeBitmap:true,initial:row.initial,closeCalls:row.closeCalls,final:[row.bitmap.width,row.bitmap.height]}))
 }
 const save=(name,start,closed,extra={})=>results.push({name,bitmaps:take(start,closed),...extra})
 const savedCache={enabled:T.Cache.enabled,files:T.Cache.files};T.Cache.enabled=false;T.Cache.files={}
 try{
  let start=records.length
  const prepared=await startThreeCompiledScenePreparation(options()).promise
  assert(prepared.state==='prepared','public prepare state');prepared.dispose();prepared.dispose();save('default-detached-dispose',start,1)
  for(let i=0;i<2;i++){
   start=records.length;const h=await installThreeCompiledScene(options()),map=texture(h.loaded),source=map.source;let disposed=0;map.addEventListener('dispose',()=>disposed++)
   h.dispose();h.dispose();assert(disposed===1,'texture disposal count');assert(source.data===null,'private source not cleared');save('default-load-reload-'+i,start,1,{textureDisposes:disposed,sourceCleared:true})
  }
  start=records.length
  let created,release;const createdPromise=new Promise(r=>created=r),wait=new Promise(r=>release=r);gate={created,wait}
  const task=startThreeCompiledScenePreparation(options()),settled=task.promise.then(()=>({success:true}),error=>({error:{name:error.name,message:error.message}}))
  await createdPromise;task.cancel();release();const cancelled=await settled;assert(cancelled.error?.name==='AbortError','public cancellation did not reject with AbortError');save('public-cancel-during-native-decode',start,1,cancelled)
  start=records.length
  let refusal;try{await installThreeCompiledScene({...options('/required.glb'),descriptor:{...descriptor('/required.glb'),materialPrograms:window.pointer}})}catch(error){refusal=error.message}
  assert(/Legacy WebGLRenderer cannot render.*Light Path shadow exclusion/.test(refusal),'wrong legacy refusal: '+refusal);save('public-fresh-legacy-refusal',start,1,{error:refusal})
  start=records.length
  const a=await installThreeCompiledScene({...options(),loader:new GLTFLoader()}),amap=texture(a.loaded),asource=amap.source;a.dispose();assert(asource.data===records[start].bitmap,'custom-loader borrowed source changed');save('custom-loader-borrowed',start,0,{sourcePreserved:true})
  start=records.length
  const graph=await new GLTFLoader().loadAsync('/packed.glb'),b=await installLoadedThreeCompiledScene(graph,options()),bmap=texture(graph),bsource=bmap.source;b.dispose();assert(bsource.data===records[start].bitmap,'preloaded borrowed source changed');save('preloaded-borrowed',start,0,{sourcePreserved:true})
  // Cache shares only the external/data URI image fixture; blob images are
  // excluded from Three r184 Cache. Clearing never transfers image ownership.
  T.Cache.enabled=true;start=records.length
  const c=await installThreeCompiledScene(options('/external.gltf')),d=await installThreeCompiledScene(options('/external.gltf')),cmap=texture(c.loaded),dmap=texture(d.loaded)
  assert(cmap.image===dmap.image,'cache did not share actual native bitmap');T.Cache.clear();T.Cache.enabled=false;c.dispose();d.dispose();assert(cmap.image===records[start].bitmap&&dmap.image===records[start].bitmap,'borrowed cache Source changed');save('cache-borrowed-after-clear',start,0,{sharedAcrossLoads:true,sourcePreserved:true})
  return {status:'NATIVE_BITMAP_LIFECYCLE_PASS_NOT_NODE_OR_SCENE_PARITY',identity,cases:results,observedDecodes:records.length,ownedNativeCloses:records.reduce((n,r)=>n+r.closeCalls,0)}
 }finally{
  gate=null;globalThis.createImageBitmap=nativeCreate;T.Cache.enabled=savedCache.enabled;T.Cache.files=savedCache.files
  // Test-owned borrowed images are released only after the observation gates.
  for(const row of records)if(row.bitmap.width)nativeClose.call(row.bitmap)
  renderer.dispose()
 }
}
