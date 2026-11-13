import { Box3, BufferGeometry, FloatType, Sphere, Uint32BufferAttribute, Vector3, type Material, type Mesh, type Object3D } from 'three'
import { TslIrError } from './tslNodeRecipe.js'
import { validateGeometryContextMatrix } from './tslGeometryContext.js'
import { trackMaterialDrawCallback } from './tslMaterialDrawOrientation.js'

const fail=(message:string):never=>{throw new TslIrError('Camera Data '+message)}
const signature=(attribute:any):unknown[]=>attribute?[attribute,attribute.array,attribute.version,attribute.data,
  attribute.data?.array,attribute.data?.version,attribute.data?.stride,attribute.offset,attribute.count,
  attribute.itemSize,attribute.normalized,attribute.array?.length,attribute.array?.byteOffset,attribute.gpuType]:[]
const same=(a:unknown[],b:unknown[])=>a.length===b.length&&a.every((value,index)=>value===b[index])
const facts=new WeakMap<BufferGeometry,{position:unknown[];index:unknown[];box:Box3}>()

/** CPU preflight only. Render-time proof additionally requires the private
 * storage lease below, because public attributes do not reveal GPU history. */
export function cameraGeometryBounds(object:Object3D|null,basis:unknown,refresh=false):Box3 {
  const mesh=object as Mesh&{isSkinnedMesh?:boolean;isInstancedMesh?:boolean;isBatchedMesh?:boolean}
  if(!mesh?.isMesh||mesh.isSkinnedMesh||mesh.isInstancedMesh||mesh.isBatchedMesh||(mesh.geometry as BufferGeometry&{isInstancedBufferGeometry?:boolean}).isInstancedBufferGeometry||Object.keys(mesh.geometry.morphAttributes).length)
    return fail('needs triangle meshes without skin, morph or generated/GPU instances')
  validateGeometryContextMatrix(mesh,basis)
  const geometry=mesh.geometry,position=geometry.getAttribute('position'),index=geometry.index
  if(!position||position.itemSize!==3||position.normalized||!(position.array instanceof Float32Array)
    ||!Number.isInteger(position.count)||position.count<3||('gpuType'in position&&position.gpuType!==FloatType))
    return fail('needs actual unquantized Float32 triangle positions')
  const interleaved=(position as any).data,stride=interleaved?.stride??3,offset=(position as any).offset??0
  if(!Number.isInteger(stride)||stride<3||!Number.isInteger(offset)||offset<0||offset+3>stride
    ||position.array.length!==position.count*stride)
    return fail('position storage has no verified complete Float32 layout')
  if(index&&(index.itemSize!==1||index.normalized||![Uint8Array,Uint16Array,Uint32Array].some(type=>index.array instanceof type)
    ||!Number.isInteger(index.count)||index.count!==index.array.length))
    return fail('needs actual unsigned integer triangle indices')
  const currentPosition=signature(position),currentIndex=signature(index),previous=facts.get(geometry)
  if(!refresh&&previous&&same(previous.position,currentPosition)&&same(previous.index,currentIndex))return previous.box
  const count=index?.count??position.count
  if(count<3||count%3)return fail('requires triangle topology')
  const box=new Box3(),a=new Vector3(),b=new Vector3(),c=new Vector3(),face=new Vector3()
  for(let vertex=0;vertex<position.count;vertex++){
    a.fromBufferAttribute(position,vertex)
    if(a.toArray().some(value=>!Number.isFinite(value)))return fail('requires finite vertex positions')
    box.expandByPoint(a)
  }
  for(let start=0;start<count;start+=3){
    const vertices=[0,1,2].map(offset=>index?index.getX(start+offset):start+offset)
    if(vertices.some(value=>!Number.isInteger(value)||value<0||value>=position.count))return fail('has out-of-range triangle indices')
    a.fromBufferAttribute(position,vertices[0]);b.fromBufferAttribute(position,vertices[1]);c.fromBufferAttribute(position,vertices[2])
    if(face.subVectors(b,a).cross(c.sub(a)).length()<2e-12)return fail('refuses degenerate triangle positions')
  }
  facts.set(geometry,{position:currentPosition,index:currentIndex,box})
  return box
}

type GroupProof={index:number;start:number;count:number;materialIndex?:number}
type CopyRecord={source:BufferGeometry;disposed:boolean;lease:Lease}
type Lease={mesh:Mesh;renderer:unknown;copy:BufferGeometry;position:unknown[];index:unknown[];captured:WeakSet<BufferGeometry>;groups:WeakMap<object,GroupProof>;groupArray:BufferGeometry['groups'];groupObjects:BufferGeometry['groups'];
  firstUniform:boolean;failedUpload:boolean;validateOwner:()=>void}
const owned=new WeakMap<BufferGeometry,CopyRecord>()
function liveSource(source:BufferGeometry):BufferGeometry {
  let record=owned.get(source)
  while(record?.disposed){source=record.source;record=owned.get(source)}
  return source
}
function assertRanges(mesh:Mesh,captured:BufferGeometry,material:Material,group:any):void {
  const geometry=mesh.geometry,total=geometry.index?.count??geometry.getAttribute('position')?.count??0
  const range=(start:number,count:number)=>Number.isInteger(start)&&start>=0&&start%3===0
    &&(count===Infinity||Number.isInteger(count)&&count>=0&&count%3===0)&&start<=total
    &&(count===Infinity||start+count<=total)
  if(!range(geometry.drawRange.start,geometry.drawRange.count))return fail('draw/index ranges changed outside triangle boundaries; reinstall after geometry changes')
  if(Array.isArray(mesh.material)){
    const copy=owned.get(geometry),lease=copy&&!copy.disposed&&copy.lease.mesh===mesh?copy.lease:undefined
    const managedCapture=lease?.captured.has(captured)
    const proof=lease&&group?lease.groups.get(group):undefined
    const current=proof?geometry.groups[proof.index]:undefined
    const grouped=lease?proof&&geometry.groups===lease.groupArray&&geometry.groups.length===lease.groupObjects.length
      &&current===lease.groupObjects[proof.index]&&[current,group].every(value=>value.start===proof.start&&value.count===proof.count&&value.materialIndex===proof.materialIndex)
      :group&&geometry.groups.indexOf(group)>=0
    if(captured!==geometry&&!managedCapture||!group||mesh.material[group.materialIndex]!==material
      ||!range(group.start,group.count)||!grouped)
      return fail('material group/index ranges changed; reinstall after geometry changes')
  }else if(group)return fail('has an unverified material group binding')
}

/** Acquire only after preceding object callbacks, before r184 constructs its
 * render object. Originals retain their arrays, GPU history and disposal. */
export function trackCameraDataGeometry(
  mesh:Mesh,materials:ReadonlySet<Material>,basis:unknown,validateOwner:()=>void,
):()=>void {
  let lease:Lease|undefined,source:BufferGeometry|undefined,disposed=false
  const captured=new WeakSet<BufferGeometry>(),groups=new WeakMap<object,GroupProof>()
  const acquire=(renderer:unknown):void=>{
    const current=mesh.geometry,copy=new BufferGeometry().copy(current)
    const entries=[...Object.entries(current.attributes),...(current.index?[['index',current.index] as const]:[])]
    if(entries.some(([name,attribute])=>{const cloned=name==='index'?copy.index:copy.getAttribute(name);return !cloned||cloned===attribute||cloned.array.buffer===attribute.array.buffer})){
      copy.dispose();return fail('cannot acquire independent private attribute storage; use ordinary Float32 geometry')
    }
    // The pinned WebGPU backend rewrites U8/U16 index arrays on first
    // upload. Canonical private U32 indices keep CPU/GPU storage identity fixed.
    if(copy.index&&!(copy.index.array instanceof Uint32Array))copy.setIndex(new Uint32BufferAttribute(copy.index.array,1))
    mesh.geometry=copy
    try{const box=cameraGeometryBounds(mesh,basis,true);validateOwner();copy.boundingBox=box.clone();copy.boundingSphere=box.getBoundingSphere(new Sphere())}
    catch(error){mesh.geometry=current;copy.dispose();throw error}
    const previous=lease
    source??=current
    captured.add(current);captured.add(copy)
    copy.groups.forEach((group,index)=>{const proof={index,start:group.start,count:group.count,materialIndex:group.materialIndex};groups.set(group,proof);groups.set(current.groups[index],proof)})
    lease={mesh,renderer,copy,captured,groups,groupArray:copy.groups,groupObjects:copy.groups.slice(),position:signature(copy.getAttribute('position')),index:signature(copy.index),
      firstUniform:true,failedUpload:false,validateOwner}
    owned.set(copy,{source,disposed:false,lease})
    if(previous){owned.get(previous.copy)!.disposed=true;previous.copy.dispose()}
  }
  const releaseCallback=trackMaterialDrawCallback(mesh,materials,function(...args){
    if(disposed)return
    assertRanges(mesh,args[3],args[4],args[5])
    if(!lease){acquire(args[0]);return}
    if(mesh.geometry!==lease.copy){
      let record=owned.get(mesh.geometry)
      while(record&&record.lease.mesh===mesh){if(record.source===lease.copy)return;record=owned.get(record.source)}
      return fail('requires its private owned geometry; reinstall after geometry replacement')
    }
    if(lease.renderer!==args[0])return fail('owned geometry is bound to one renderer; install a separate scene copy for another renderer')
    const position=signature(mesh.geometry.getAttribute('position')),index=signature(mesh.geometry.index)
    if(position[0]!==lease.position[0]||index[0]!==lease.index[0])return fail('requires reinstall after replacing position/index attributes')
    if(!same(position,lease.position)||!same(index,lease.index)){
      if(position[1]!==lease.position[1]&&position[2]===lease.position[2]&&position[5]===lease.position[5]
        ||index[1]!==lease.index[1]&&index[2]===lease.index[2])
        return fail('position/index array replacement needs needsUpdate or a fresh installation')
      acquire(args[0])
    }else if(lease.failedUpload)acquire(args[0])
    else validateOwner()
  })
  return()=>{
    if(disposed)return
    disposed=true;releaseCallback()
    if(lease){
      owned.get(lease.copy)!.disposed=true
      if(mesh.geometry===lease.copy)mesh.geometry=liveSource(source!)
      lease.copy.dispose()
    }
  }
}

/** The low-level builder cannot infer previous GPU contents from CPU arrays.
 * A matching installer-owned copy is mandatory, including its first draw. */
export function validateOwnedCameraDataGeometry(object:Object3D|null,renderer:unknown,basis:unknown):void {
  const mesh=object as Mesh,record=mesh?.isMesh?owned.get(mesh.geometry):undefined,lease=record?.lease
  if(!lease||record!.disposed||lease.mesh!==mesh||mesh.geometry!==lease.copy)
    return fail('rendering requires installer-owned position storage; use installTslMaterials')
  if(lease.renderer!==renderer)return fail('owned geometry is bound to one renderer; install a separate scene copy for another renderer')
  try{
    if(!same(signature(mesh.geometry.getAttribute('position')),lease.position)||!same(signature(mesh.geometry.index),lease.index))
      return fail('position/index storage changed after draw validation; edit it before the managed draw callback')
    if(lease.firstUniform){cameraGeometryBounds(mesh,basis,true);lease.validateOwner();lease.firstUniform=false}
  }catch(error){lease.failedUpload=true;throw error}
}
