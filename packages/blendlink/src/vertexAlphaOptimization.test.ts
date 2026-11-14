import {describe,it,expect}from'vitest'
import {Document,NodeIO}from'@gltf-transform/core'
import {ALL_EXTENSIONS}from'@gltf-transform/extensions'
import {MeshoptDecoder}from'meshoptimizer'
import {mkdtempSync,writeFileSync,rmSync}from'node:fs'
import {join}from'node:path'
import {tmpdir}from'node:os'
import {captureVertexAlphaOptimization}from'./vertexAlphaOptimization.js'
import {optimizeMeshopt}from'./optimizer.js'

const semantic='_SCENETOWEB_VCOL_ALPHA_0123456789ABCDEF'
function fixture(){
  const doc=new Document(),buffer=doc.createBuffer(),scene=doc.createScene('Artist Scene')
  const accessor=(type:'SCALAR'|'VEC2'|'VEC3',values:number[])=>doc.createAccessor().setType(type).setArray(new Float32Array(values)).setBuffer(buffer)
  const position=accessor('VEC3',[-1,-1,0,1,-1,0,1,1,0,-1,-1,0,1,1,0,-1,1,0])
  const alpha=accessor('SCALAR',[0,.1,1/3,.25,.8,1])
  const mesh=doc.createMesh('Alpha mesh').setExtras({blendlink_tsl_runtime:{schemaVersion:1,vertexColorAlpha:{Paint:{
    model:'eevee53-float-color-alpha-scalar-v1',sourceProfile:'blender53-eevee-metal-float-color-alpha-v1',
    semantic,attribute:semantic.toLowerCase(),sourceLayer:'Paint',domain:'CORNER',materials:['Alpha A','Alpha B']}}}})
  for(let i=0;i<2;i++){
    const material=doc.createMaterial('Carrier '+i).setExtras({blendlink_source_material:i?'Alpha B':'Alpha A',blendlink_material_variant:'v'+i})
    const indices=doc.createAccessor().setType('SCALAR').setArray(new Uint16Array(i?[3,4,5]:[0,1,2])).setBuffer(buffer)
    mesh.addPrimitive(doc.createPrimitive().setAttribute('POSITION',position).setAttribute(semantic,alpha).setMaterial(material).setIndices(indices))
  }
  scene.addChild(doc.createNode('Artist Alpha owner').setMesh(mesh))
  const other=doc.createMesh('Unrelated mesh').addPrimitive(doc.createPrimitive()
    .setAttribute('POSITION',accessor('VEC3',[.12345,0,0,1.25,0,0,0,1.7,0]))
    .setAttribute('NORMAL',accessor('VEC3',[.57735,.57735,.57735,.57735,.57735,.57735,.57735,.57735,.57735]))
    .setAttribute('COLOR_0',accessor('VEC3',[.1,.2,.3,.4,.5,.6,.7,.8,.9]))
    .setAttribute('TEXCOORD_0',accessor('VEC2',[.12345,.23456,.34567,.45678,.56789,.67891]))
    .setAttribute('_UNRELATED',accessor('SCALAR',[.1,.2,.3])))
  scene.addChild(doc.createNode('Unrelated owner').setMesh(other))
  return{doc,scene,mesh,other,position,alpha,buffer}
}

describe('bounded raw Alpha preservation through default optimization',()=>{
  it('keeps exact per-owner/material corner associations while ordinary other attributes still quantize',async()=>{
    const {doc}=fixture(),before=captureVertexAlphaOptimization(doc)!
    const directory=mkdtempSync(join(tmpdir(),'scenetoweb-alpha-opt-')),path=join(directory,'scene.glb')
    try{
      const io=new NodeIO().registerExtensions(ALL_EXTENSIONS)
      writeFileSync(path,await io.writeBinary(doc))
      const report=await optimizeMeshopt(path)
      expect(report.passes?.skipped).toContainEqual(expect.stringMatching(/asset-wide.*Vertex Color Alpha/))
      await MeshoptDecoder.ready
      const after=await new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder}).read(path)
      expect(captureVertexAlphaOptimization(after)!.associations).toEqual(before.associations)
      const other=after.getRoot().listMeshes().find(mesh=>mesh.getName()==='Unrelated mesh')!.listPrimitives()[0]!
      // Explicit initial fallback protects POSITION across this bounded asset,
      // while COLOR/NORMAL/generic attribute policy remains unchanged.
      expect(other.getAttribute('POSITION')!.getComponentType()).toBe(5126)
      expect(other.getAttribute('TEXCOORD_0')!.getComponentType()).toBe(5126)
      for(const key of ['NORMAL','COLOR_0','_UNRELATED'])expect(other.getAttribute(key)!.getComponentType()).not.toBe(5126)
    }finally{rmSync(directory,{recursive:true,force:true})}
  })
  it('checks associations against primitive material, topology, alpha and actual source owner',()=>{
    for(const mutate of [
      (f:ReturnType<typeof fixture>)=>{f.alpha.getArray()![1]=.2},
      (f:ReturnType<typeof fixture>)=>{f.position.getArray()![0]=-.5},
      (f:ReturnType<typeof fixture>)=>{f.mesh.listPrimitives()[0]!.getIndices()!.setArray(new Uint16Array([0,2,1]))},
      (f:ReturnType<typeof fixture>)=>{f.scene.listChildren()[0]!.setName('Other owner')},
    ]){const f=fixture(),before=captureVertexAlphaOptimization(f.doc)!.associations;mutate(f);expect(captureVertexAlphaOptimization(f.doc)!.associations).not.toEqual(before)}
  })
  it('refuses forged metadata, normalized/integer scalar and missing actual carrier',()=>{
    for(const mutate of [
      (f:ReturnType<typeof fixture>)=>{f.alpha.setArray(new Uint16Array([0,1,2,3,4,5])).setNormalized(true)},
      (f:ReturnType<typeof fixture>)=>{f.mesh.listPrimitives()[0]!.setAttribute(semantic,null)},
      (f:ReturnType<typeof fixture>)=>{f.mesh.listPrimitives()[0]!.getMaterial()!.setExtras({blendlink_source_material:'Other'})},
    ]){const f=fixture();mutate(f);expect(()=>captureVertexAlphaOptimization(f.doc)).toThrow(/Vertex Color Alpha optimization/)}
  })
  it('counts unique actual position accessors, not owners, and refuses an oversized fallback asset',()=>{
    const f=fixture();f.scene.addChild(f.doc.createNode('Shared Alpha owner').setMesh(f.mesh))
    expect(captureVertexAlphaOptimization(f.doc)!.positionVertices).toBe(9)
    f.other.listPrimitives()[0]!.getAttribute('POSITION')!.setArray(new Float32Array(999995*3))
    expect(()=>captureVertexAlphaOptimization(f.doc)).toThrow(/1,000,000 unique position vertices/)
  })
  it('adds no field protection to an ordinary unmarked asset',()=>{
    const f=fixture();f.mesh.setExtras({})
    expect(captureVertexAlphaOptimization(f.doc)).toBeNull()
  })
})
