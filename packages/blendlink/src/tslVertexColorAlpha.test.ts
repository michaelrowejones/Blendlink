import { describe, it, expect } from 'vitest'
import { BufferGeometry, Float32BufferAttribute, Mesh, InterleavedBuffer, InterleavedBufferAttribute, MeshStandardMaterial, Scene } from 'three'
import { vertexAlphaBinding, VERTEX_ALPHA_MODEL, VERTEX_ALPHA_PROFILE, vertexAlphaLayers, assertVertexAlphaOpacity, certifyVertexAlphaOpacity, matchVertexAlphaOpacity, VERTEX_ALPHA_OPACITY_MODEL } from './tslVertexColorAlpha.js'
import { buildTslScalarNode } from './tslNodeRecipe.js'
import { readFile } from 'node:fs/promises'
import {validateNodeRendererRequirement} from './materialProgramRendererRequirements.js'
import {installTslMaterials} from './tslMaterialRuntime.js'

const semantic = '_SCENETOWEB_VCOL_ALPHA_0123456789ABCDEF', name = semantic.toLowerCase()
const expression = { op: 'vertex_color_alpha', model: VERTEX_ALPHA_MODEL, sourceProfile: VERTEX_ALPHA_PROFILE, layer: 'Paint' }
const extras = () => ({vertexColorAlpha:{Paint:{model:VERTEX_ALPHA_MODEL,sourceProfile:VERTEX_ALPHA_PROFILE,semantic,attribute:name,sourceLayer:'Paint',domain:'CORNER',materials:['Artist']}}})
const mesh = () => new Mesh(new BufferGeometry().setAttribute('position', new Float32BufferAttribute([0,0,0,1,0,0,0,1,0],3))
  .setAttribute(name, new Float32BufferAttribute([0,.1,1/3],1)))

describe('raw Vertex Color Alpha primitive binding', () => {
  it('rejects unsafe opacity before mutating any material or draw callback', async () => {
    const root=new Scene(),first=mesh(),bad=mesh()
    first.material=new MeshStandardMaterial();bad.material=new MeshStandardMaterial({vertexColors:true})
    first.material.userData.blendlink_source_material='Ordinary'
    bad.material.userData.blendlink_source_material='Artist'
    bad.geometry.setAttribute('color',new Float32BufferAttribute([1,1,1,.1,1,1,1,.1,1,1,1,.1],4))
    root.add(first,bad)
    const originals=[first.material,bad.material],callbacks=[first.onBeforeRender,bad.onBeforeRender]
    await expect(installTslMaterials({root,descriptor:{materialPrograms:{url:'/fixture.materials.json',hash:'0'.repeat(16),bytes:1}},
      loadPrograms:async()=>({schemaVersion:1,model:'blendlink-material-programs-v1',materials:{
        Ordinary:{channels:{Roughness:{tslIr:{schemaVersion:1,model:'blendlink-tsl-ir-v1',output:{op:'const',value:.5}}}}},
        Artist:{channels:{Alpha:{tslIr:{schemaVersion:1,model:'blendlink-tsl-ir-v1',output:expression}}}},
      }})})).rejects.toThrow(/multiply opacity twice/)
    expect([first.material,bad.material]).toEqual(originals)
    expect([first.onBeforeRender,bad.onBeforeRender]).toEqual(callbacks)
    for(const object of[first,bad]){object.geometry.dispose();(object.material as MeshStandardMaterial).dispose()}
  })
  it('requires matching source-owned markers plus real scalar storage, never a payload bypass', () => {
    const object=mesh(),other=mesh();object.material=new MeshStandardMaterial({vertexColors:true})
    object.geometry.setAttribute('color',new Float32BufferAttribute([1,1,1,.1,1,1,1,.1,1,1,1,.1],4))
    const channels={Alpha:{tslIr:{output:expression}}},marker={schemaVersion:1 as const,model:VERTEX_ALPHA_OPACITY_MODEL,sourceProfile:VERTEX_ALPHA_PROFILE,material:'Artist',alphaLayers:['Paint'],completeColor:false}
    const tagged={...extras(),vertexColorAlphaOpacityOwners:{Artist:marker}}
    expect(()=>assertVertexAlphaOpacity(object,channels,object.material,marker)).toThrow(/multiply opacity twice/)
    for(const mutation of[{model:'unknown'},{material:'Other'},{alphaLayers:[]},{completeColor:true},{extra:1}])
      expect(()=>matchVertexAlphaOpacity(channels,tagged,'Artist',{...marker,...mutation})).toThrow(/matching source-derived/)
    expect(()=>matchVertexAlphaOpacity(channels,extras(),'Artist',marker)).toThrow(/matching source-derived/)
    const certificate=certifyVertexAlphaOpacity(object,channels,tagged,'Artist',marker)!
    expect(()=>assertVertexAlphaOpacity(object,channels,object.material,certificate)).not.toThrow()
    other.material=new MeshStandardMaterial({vertexColors:true});other.geometry.setAttribute('color',object.geometry.getAttribute('color').clone())
    expect(()=>assertVertexAlphaOpacity(other,channels,other.material,certificate)).toThrow(/multiply opacity twice/)
    object.geometry.getAttribute(name).setX(0,-0)
    expect(()=>certifyVertexAlphaOpacity(object,channels,tagged,'Artist',marker)).toThrow(/normal Float32/)
    object.geometry.dispose();other.geometry.dispose()
  })
  it('rejects forged ownership on a later mesh before any texture work or source material swap',async()=>{
    const root=new Scene(),first=mesh(),bad=mesh();first.material=new MeshStandardMaterial();bad.material=new MeshStandardMaterial()
    for(const object of[first,bad]){object.material.userData.blendlink_source_material='Artist';object.userData.blendlink_tsl_runtime=extras();root.add(object)}
    const marker={schemaVersion:1 as const,model:VERTEX_ALPHA_OPACITY_MODEL,sourceProfile:VERTEX_ALPHA_PROFILE,material:'Artist',alphaLayers:['Paint'],completeColor:false}
    first.userData.blendlink_tsl_runtime.vertexColorAlphaOpacityOwners={Artist:marker}
    bad.userData.blendlink_tsl_runtime.vertexColorAlphaOpacityOwners={Artist:{...marker,completeColor:true}}
    const originals=[first.material,bad.material],callbacks=[first.onBeforeRender,bad.onBeforeRender]
    await expect(installTslMaterials({root,descriptor:{materialPrograms:{url:'/fixture.json',hash:'0'.repeat(16),bytes:1}},loadPrograms:async()=>({schemaVersion:1,model:'blendlink-material-programs-v1',materials:{Artist:{vertexAlphaOpacity:marker,channels:{Alpha:{tslIr:{schemaVersion:1,model:'blendlink-tsl-ir-v1',output:expression}}}}}})})).rejects.toThrow(/matching source-derived/)
    expect([first.material,bad.material]).toEqual(originals);expect([first.onBeforeRender,bad.onBeforeRender]).toEqual(callbacks)
    for(const object of[first,bad]){object.geometry.dispose();object.material.dispose()}
  })
  it.skipIf(!process.env.SCENETOWEB_VERTEX_ALPHA_GLBS)('binds both actual shared-owner/material-split exported GLBs through GLTFLoader', async () => {
    const {GLTFLoader}=await import('three/examples/jsm/loaders/GLTFLoader.js')
    for(let repeat=0;repeat<2;repeat++){
      const bytes=await readFile(`${process.env.SCENETOWEB_VERTEX_ALPHA_GLBS}/source-${repeat}.glb`)
      const loaded=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'https://scenetoweb.invalid/')
      let count=0
      loaded.scene.traverse(object=>{
        if(!(object instanceof Mesh))return
        const material=Array.isArray(object.material)?object.material[0]!:object.material
        const source=material.userData.blendlink_source_material as string
        const layer=source==='Artist alpha 0'?'':'Render Paint'
        const binding=vertexAlphaBinding(object,{...expression,layer},object.userData.blendlink_tsl_runtime,source)
        expect(binding.options.vertexColorAlpha!(layer)).toMatch(/^_scenetoweb_vcol_alpha_/)
        binding.validate();count++
        object.geometry.dispose();material.dispose()
      })
      expect(count).toBe(4)
    }
  })
  it('refuses only new opacity plus actual RGBA vertexColors, preserving Alpha-only and other channels', () => {
    const object=mesh(),material=Array.isArray(object.material)?object.material[0]!:object.material
    ;(material as typeof material & {vertexColors:boolean}).vertexColors=true
    expect(()=>assertVertexAlphaOpacity(object,{Alpha:{tslIr:{output:expression}}},material)).not.toThrow()
    object.geometry.setAttribute('color',new Float32BufferAttribute([.2,.3,.4,.1,.2,.3,.4,.1,.2,.3,.4,.1],4))
    expect(()=>assertVertexAlphaOpacity(object,{Alpha:{tslIr:{output:expression}}},material)).toThrow(/multiply opacity twice/)
    const unit=new Float32BufferAttribute([1,1,1,1,1,1,1,1,1,1,1,1],4)
    object.geometry.setAttribute('color',unit)
    expect(()=>assertVertexAlphaOpacity(object,{Alpha:{tslIr:{output:expression}}},material)).not.toThrow()
    const binding=vertexAlphaBinding(object,{Alpha:{tslIr:{output:expression}}},extras(),'Artist')
    unit.needsUpdate=true
    expect(binding.validate).toThrow(/COLOR_0 changed/)
    expect(()=>assertVertexAlphaOpacity(object,{Emission:{tslIr:{output:expression}}},material)).not.toThrow()
    expect(()=>assertVertexAlphaOpacity(object,{Alpha:{tslIr:{output:{op:'const',value:.1}}}},material)).not.toThrow()
    object.geometry.dispose()
  })
  it('requires its declared node renderer even in a non-Base-Color channel', () => {
    const channels={Roughness:{tslIr:{output:expression}}}
    expect(validateNodeRendererRequirement(channels,undefined).issue).toMatch(/Vertex Color Alpha/)
    expect(validateNodeRendererRequirement(channels,{schemaVersion:1,model:'live-material-programs-v1',programs:[{op:expression.op,model:expression.model}]}).issue).toBeUndefined()
  })
  it('requires an actual raw scalar and authorizes only the named layer', () => {
    const object = mesh(), binding = vertexAlphaBinding(object,expression,extras(),'Artist')
    expect(binding.options.vertexColorAlpha!('Paint')).toBe(name)
    expect(() => binding.options.vertexColorAlpha!('Other')).toThrow(/no actual primitive binding/)
    expect(() => vertexAlphaBinding(object,expression,extras(),'Other')).toThrow(/material binding/)
    expect(() => buildTslScalarNode({schemaVersion:1,model:'blendlink-tsl-ir-v1',output:expression})).toThrow(/actual qualified/)
    object.geometry.dispose()
  })
  it('admits an actual interleaved Float32 scalar without reading adjacent color lanes', () => {
    const object=mesh(), data=new InterleavedBuffer(new Float32Array([.8,0,.7,.1,.6,1/3]),2)
    object.geometry.setAttribute(name,new InterleavedBufferAttribute(data,1,1,false))
    expect(vertexAlphaBinding(object,expression,extras(),'Artist').options.vertexColorAlpha!('Paint')).toBe(name)
    object.geometry.dispose()
  })
  it.each([-0, 2**-149, -1, 2, NaN, Infinity])('refuses raw value %s', value => {
    const object=mesh();object.geometry.getAttribute(name).setX(1,value)
    expect(()=>vertexAlphaBinding(object,expression,extras(),'Artist')).toThrow(/normal Float32/)
    object.geometry.dispose()
  })
  it('refuses wrong width, normalization, count, type and a missing physical attribute', () => {
    for(const mutate of [
      (o:Mesh)=>o.geometry.setAttribute(name,new Float32BufferAttribute([0,0,0,0,0,0],2)),
      (o:Mesh)=>{o.geometry.getAttribute(name).normalized=true},
      (o:Mesh)=>o.geometry.setAttribute(name,new Float32BufferAttribute([0,1],1)),
      (o:Mesh)=>o.geometry.deleteAttribute(name),
    ]){const object=mesh();mutate(object);expect(()=>vertexAlphaBinding(object,expression,extras(),'Artist')).toThrow(/SCALAR/);object.geometry.dispose()}
  })
  it('refuses changed loaded attribute identity, array allocation and upload version', () => {
    for(const mutate of [
      (o:Mesh)=>o.geometry.setAttribute(name,new Float32BufferAttribute([0,.1,1/3],1)),
      (o:Mesh)=>{o.geometry.getAttribute(name).needsUpdate=true},
      (o:Mesh)=>{o.geometry.getAttribute(name).array=new Float32Array([0,.1,1/3])},
    ]){const object=mesh(),binding=vertexAlphaBinding(object,expression,extras(),'Artist');mutate(object);expect(binding.validate).toThrow(/changed after binding/);object.geometry.dispose()}
  })
  it('preserves large existing embedded image programs without visiting pixel data', () => {
    expect(vertexAlphaLayers({op:'tex_image',pixels:new Array(100000).fill(0),vector:{op:'uv'}}).size).toBe(0)
    const samples = Array.from({length:32768},()=>[0,.5,1])
    expect(vertexAlphaLayers({op:'curve_native',samples}).size).toBe(0)
    expect(vertexAlphaLayers({op:'noise_field_nearest',samples}).size).toBe(0)
    expect(vertexAlphaLayers({body:expression,annotations:new Array(10000).fill(expression)}).size).toBe(1)
  })
  it('refuses changes to attested triangle positions, topology, draw range and groups', () => {
    for(const mutate of [
      (o:Mesh)=>o.geometry.setIndex([0,2,1]),
      (o:Mesh)=>{o.geometry.getAttribute('position').setX(0,10);o.geometry.getAttribute('position').needsUpdate=true},
      (o:Mesh)=>o.geometry.setDrawRange(0,0),
      (o:Mesh)=>o.geometry.addGroup(0,3,1),
    ]){const object=mesh(),binding=vertexAlphaBinding(object,expression,extras(),'Artist');mutate(object);expect(binding.validate).toThrow(/primitive geometry changed/);object.geometry.dispose()}
  })
  it('refuses malformed models and bounds distinct layer traversal', () => {
    expect(()=>vertexAlphaLayers({...expression,model:'other'})).toThrow(/model/)
    expect(()=>vertexAlphaLayers({...expression,sourceProfile:'native-openGL-unqualified'})).toThrow(/model/)
    expect(()=>buildTslScalarNode({schemaVersion:1,model:'blendlink-tsl-ir-v1',output:{...expression,sourceProfile:'other'}},
      {vertexColorAlpha:()=>name})).toThrow(/actual qualified/)
    expect(()=>vertexAlphaLayers(Array.from({length:5},(_,i)=>({...expression,layer:String(i)})))).toThrow(/layer budget/)
  })
})
