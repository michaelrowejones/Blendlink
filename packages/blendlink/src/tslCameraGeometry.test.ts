import { BufferGeometry, Float32BufferAttribute, InterleavedBuffer, InterleavedBufferAttribute, Mesh, MeshStandardMaterial, PerspectiveCamera, Scene, Uint16BufferAttribute } from 'three'
import { describe, expect, it, vi } from 'vitest'
import { trackCameraDataGeometry, validateOwnedCameraDataGeometry } from './tslCameraGeometry.js'
import { validateCameraDataBinding } from './tslCameraData.js'
import { installTslMaterials } from './tslMaterialRuntime.js'

const positions=()=>new Float32Array([0,0,0,1,0,0,0,1,0])
function geometry(){return new BufferGeometry().setAttribute('position',new Float32BufferAttribute(positions(),3)).setIndex(new Uint16BufferAttribute([0,1,2],1))}
const document={schemaVersion:1,model:'blendlink-tsl-ir-v1',output:{op:'camera_data_native',model:'eevee-primary-camera-v1',sourceEngine:'EEVEE',sourceVersion:[5,3,0],output:'view-vector',camera:{op:'geometry_context',model:'primary-triangles-v1',sourceEngine:'EEVEE',output:'camera'}}}
const programs={schemaVersion:1,model:'blendlink-material-programs-v1',materials:{Camera:{channels:{'Base Color':{tslIr:document}}}}}
const descriptor={materialPrograms:{url:'/camera.materials.json',bytes:1,hash:'0'.repeat(16)}}
const renderer={backend:{isWebGPUBackend:false}}
const camera=new PerspectiveCamera();camera.position.z=20
function subject(shared=geometry()){
  const material=new MeshStandardMaterial();material.userData.blendlink_source_material='Camera'
  const mesh=new Mesh(shared,material);mesh.userData.blendlink_tsl_runtime={schemaVersion:1,objectSpace:'blender-z-up',geometryContext:['camera']}
  const root=new Scene();root.add(mesh)
  return{root,mesh,material,source:shared}
}
async function install(root:Scene){return installTslMaterials({root,descriptor,loadPrograms:async()=>programs as never})}
function draw(mesh:Mesh,driver=renderer,slot=0){
  const capturedGeometry=mesh.geometry,material=Array.isArray(mesh.material)?mesh.material[slot]:mesh.material
  mesh.onBeforeRender(driver as never,new Scene(),camera,capturedGeometry,material,null as never)
  return mesh.geometry
}

describe('Camera Data owns actual first-upload geometry',()=>{
  it('rejects same-array CPU edits made after install without needsUpdate on the actual first draw',async()=>{
    const {root,mesh,source}=subject(),installed=await install(root),position=source.getAttribute('position')
    const version=(position as Float32BufferAttribute).version
    position.array[0]=80
    expect((position as Float32BufferAttribute).version).toBe(version)
    expect(()=>draw(mesh)).toThrow(/Camera Data.*world mesh bounds/)
    installed.dispose();expect(mesh.geometry).toBe(source)
  })
  it('rejects pre-first-upload array replacement and degenerate index edits despite old preflight caches',async()=>{
    for(const mode of ['array','index']){
      const {root,mesh,source}=subject(),installed=await install(root)
      if(mode==='array')source.getAttribute('position').array=new Float32Array([80,0,0,1,0,0,0,1,0])
      else source.index!.array[1]=0
      expect(()=>draw(mesh)).toThrow(mode==='array'?/world mesh bounds/:/degenerate/)
      installed.dispose();expect(mesh.geometry).toBe(source)
    }
  })
  it('uses current geometry after the previous callback, not the renderer argument captured before it',async()=>{
    const {root,mesh,source}=subject(),replacement=geometry(),previous=vi.fn(()=>{mesh.geometry=replacement})
    mesh.onBeforeRender=previous
    const installed=await install(root)
    replacement.getAttribute('position').array[0]=80
    expect(()=>draw(mesh)).toThrow(/world mesh bounds/)
    expect(previous).toHaveBeenCalledTimes(1)
    expect(mesh.geometry).toBe(replacement)
    expect(source.getAttribute('position').array[0]).toBe(0)
    installed.dispose();expect(mesh.geometry).toBe(replacement);expect(mesh.onBeforeRender).toBe(previous)
  })
})

it('copies the earlier callback geometry into independent storage and restores it on disposal',async()=>{
  const {root,mesh,source}=subject(),replacement=geometry(),sourceBytes=Array.from(replacement.getAttribute('position').array)
  const previous=vi.fn(()=>{mesh.geometry=replacement});mesh.onBeforeRender=previous
  const originalDispose=vi.fn();replacement.addEventListener('dispose',originalDispose)
  const installed=await install(root),copy=draw(mesh)
  expect(copy).not.toBe(source);expect(copy).not.toBe(replacement)
  expect(copy.getAttribute('position')).not.toBe(replacement.getAttribute('position'))
  expect(copy.getAttribute('position').array.buffer).not.toBe(replacement.getAttribute('position').array.buffer)
  expect(copy.index!.array.buffer).not.toBe(replacement.index!.array.buffer)
  const release=vi.fn();copy.addEventListener('dispose',release)
  installed.dispose();installed.dispose()
  expect(release).toHaveBeenCalledTimes(1);expect(originalDispose).not.toHaveBeenCalled()
  expect(mesh.geometry).toBe(replacement);expect(mesh.onBeforeRender).toBe(previous)
  expect(Array.from(replacement.getAttribute('position').array)).toEqual(sourceBytes)
})

it('keeps warm draws O(1), replaces versioned copies once, and refuses unversioned array or later geometry replacement',async()=>{
  const {root,mesh,source}=subject(),installed=await install(root),copy=draw(mesh)
  const attribute=copy.getAttribute('position'),read=vi.spyOn(attribute,'getX'),dispose=vi.fn();copy.addEventListener('dispose',dispose)
  for(let repeat=0;repeat<5;repeat++)draw(mesh)
  expect(read).not.toHaveBeenCalled();expect(mesh.geometry).toBe(copy)
  attribute.array[0]=.25;attribute.needsUpdate=true
  const next=draw(mesh);expect(next).not.toBe(copy);expect(dispose).toHaveBeenCalledTimes(1)
  expect(next.getAttribute('position').getX(0)).toBe(.25)
  expect(source.getAttribute('position').getX(0)).toBe(0)
  const oldArray=next.getAttribute('position').array
  next.getAttribute('position').array=new Float32Array(oldArray)
  expect(()=>draw(mesh)).toThrow(/needsUpdate/)
  next.getAttribute('position').array=oldArray
  const other=geometry();mesh.geometry=other
  expect(()=>draw(mesh)).toThrow(/reinstall after geometry replacement/)
  installed.dispose();expect(mesh.geometry).toBe(other)
})

it('keeps shared-owner copies separate across material slots and rejects another renderer',async()=>{
  const {root,mesh,source}=subject(),other=new Mesh(source,(mesh.material as MeshStandardMaterial).clone())
  other.userData=structuredClone(mesh.userData);root.add(other)
  source.addGroup(0,3,0);source.addGroup(0,3,1)
  const second=(mesh.material as MeshStandardMaterial).clone();mesh.material=[mesh.material as MeshStandardMaterial,second]
  const installed=await install(root)
  const material=mesh.material[0],group=source.groups[0]
  mesh.onBeforeRender(renderer as never,root,camera,source,material,group)
  const owned=mesh.geometry
  draw(other)
  expect(other.geometry).not.toBe(owned);expect(other.geometry).not.toBe(source)
  const reads=vi.spyOn(owned.getAttribute('position'),'getX'),groupScan=vi.spyOn(owned.groups,'some')
  mesh.onBeforeRender(renderer as never,root,camera,source,mesh.material[1],source.groups[1])
  expect(mesh.geometry).toBe(owned);expect(reads).not.toHaveBeenCalled();expect(groupScan).not.toHaveBeenCalled()
  expect(()=>mesh.onBeforeRender({} as never,root,camera,owned,material,group)).toThrow(/one renderer/)
  installed.dispose();expect(mesh.geometry).toBe(source);expect(other.geometry).toBe(source)
})

it('rejects stale groups from an earlier callback and restores retry acquisition after partial failure',async()=>{
  const {root,mesh,source}=subject(),replacement=geometry(),previous=vi.fn(()=>{mesh.geometry=replacement})
  source.addGroup(0,3,0);replacement.addGroup(0,3,0)
  mesh.material=[mesh.material as MeshStandardMaterial];mesh.onBeforeRender=previous
  const installed=await install(root)
  expect(()=>mesh.onBeforeRender(renderer as never,root,camera,source,mesh.material[0],source.groups[0])).toThrow(/group\/index ranges changed/)
  installed.dispose();expect(mesh.geometry).toBe(replacement);expect(mesh.onBeforeRender).toBe(previous)
  mesh.material=mesh.material[0];mesh.onBeforeRender=()=>{}
  const retry=await install(root);replacement.getAttribute('position').array[0]=80
  expect(()=>draw(mesh)).toThrow(/world mesh bounds/)
  expect(mesh.geometry).toBe(replacement)
  replacement.getAttribute('position').array[0]=0
  expect(draw(mesh)).not.toBe(replacement)
  retry.dispose();expect(mesh.geometry).toBe(replacement)
})

it('requires owned storage in the low-level draw path and refreshes CPU data after earlier callbacks',async()=>{
  const {root,mesh,source}=subject()
  expect(()=>validateOwnedCameraDataGeometry(mesh,renderer,'blender-z-up')).toThrow(/use installTslMaterials/)
  const installed=await install(root),first=draw(mesh)
  // Simulate a callback outside the managed chain changing first-upload data.
  first.getAttribute('position').array[0]=80
  expect(()=>validateOwnedCameraDataGeometry(mesh,renderer,'blender-z-up')).toThrow(/world mesh bounds/)
  first.getAttribute('position').array[0]=0
  const repaired=draw(mesh)
  expect(repaired).not.toBe(first)
  expect(()=>validateOwnedCameraDataGeometry(mesh,renderer,'blender-z-up')).not.toThrow()
  const read=vi.spyOn(repaired.getAttribute('position'),'getX')
  for(let repeat=0;repeat<4;repeat++){draw(mesh);validateOwnedCameraDataGeometry(mesh,renderer,'blender-z-up')}
  expect(read).not.toHaveBeenCalled()
  installed.dispose();expect(mesh.geometry).toBe(source)
})

it('releases overlapping managed geometry leases out of order without restoring a disposed copy',()=>{
  const {mesh,source}=subject(),materials=new Set([mesh.material as MeshStandardMaterial]),previous=vi.fn()
  mesh.onBeforeRender=previous
  const first=trackCameraDataGeometry(mesh,materials,'blender-z-up',()=>validateCameraDataBinding(mesh,'blender-z-up'))
  const a=draw(mesh),second=trackCameraDataGeometry(mesh,materials,'blender-z-up',()=>validateCameraDataBinding(mesh,'blender-z-up'))
  const b=draw(mesh);expect(b).not.toBe(a)
  draw(mesh)
  first();expect(mesh.geometry).toBe(b)
  draw(mesh)
  second();expect(mesh.geometry).toBe(source);expect(mesh.onBeforeRender).toBe(previous)
})

it('refreshes interleaved position storage on first draw and versioned edits',async()=>{
  const source=new BufferGeometry(),data=new InterleavedBuffer(new Float32Array([99,0,0,0,99,1,0,0,99,0,1,0]),4)
  source.setAttribute('position',new InterleavedBufferAttribute(data,3,1))
  const {root,mesh}=subject(source),installed=await install(root)
  data.array[1]=80
  expect(()=>draw(mesh)).toThrow(/world mesh bounds/)
  data.array[1]=0
  const first=draw(mesh),position=first.getAttribute('position')
  expect(position.array.buffer).not.toBe(data.array.buffer)
  position.setX(0,.25);position.needsUpdate=true
  const next=draw(mesh)
  expect(next).not.toBe(first);expect(next.getAttribute('position').getX(0)).toBe(.25)
  installed.dispose();expect(mesh.geometry).toBe(source);expect(data.array[1]).toBe(0)
})
