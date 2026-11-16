import { describe, expect, it, vi } from 'vitest'
import { buildMaterialProgram } from './tslMaterialProgram.js'
import { installProgramIntoMaterial, installTslMaterials } from './tslMaterialRuntime.js'
import { BufferGeometry, DataTexture, Float32BufferAttribute, Group, Mesh, MeshPhysicalMaterial, MeshStandardMaterial } from 'three'
import { MeshPhysicalNodeMaterial, MeshStandardNodeMaterial } from 'three/webgpu'
import { bool, vec4 } from 'three/tsl'
import { validateNodeRendererRequirement } from './materialProgramRendererRequirements.js'
const wrapper=(visibleAlpha=.25)=>({op:'shadow_exclusion_native',model:'eevee53-white-shadow-branch-v1',sourceProfile:'blender53-macos-metal-shadow-transparent-v1',visibleAlpha,input:{op:'const_float',value:visibleAlpha}})
const channel=(output:any)=>({tslIr:{schemaVersion:1 as const,model:'blendlink-tsl-ir-v1' as const,output}})
const complete=(visibleAlpha=.25)=>({'Base Color':channel({op:'const_vec3',value:[.3,.4,.5]}),Metallic:channel({op:'const_float',value:.2}),Roughness:channel({op:'const_float',value:.6}),Emission:channel({op:'const_vec3',value:[0,0,0]}),Alpha:channel(wrapper(visibleAlpha))})
describe('terminal white shadow branch',()=>{
  it.each([false,true])('owns complete RGB/Alpha despite carrier COLOR_0 and map alpha; physical=%s',physical=>{
    const source=physical?new MeshPhysicalMaterial():new MeshStandardMaterial()
    const map=new DataTexture(new Uint8Array([32,64,128,16]),1,1)
    source.vertexColors=true;source.map=map;source.alphaMap=map;source.opacity=.75
    Object.assign(source,{completeProgramColor:false}) // Public lookalikes cannot undo owned state.
    const geometry=new BufferGeometry().setAttribute('color',new Float32BufferAttribute([.125,.25,.5,.125],4))
    const p=buildMaterialProgram(complete(),{}),originalColor=vec4(.3,.4,.5,.125)
    // The public installer accepts RGBA color nodes too. Only RGB belongs to
    // that channel; the complete static program's explicit Alpha owns coverage.
    p.nodes.colorNode=originalColor
    const clone=installProgramIntoMaterial(source,p.nodes,p.materialState) as MeshStandardNodeMaterial&{completeProgramColor:boolean}
    expect(clone.completeProgramColor).toBe(true)
    expect(clone.type).toBe(physical?'SceneToWebOwnedVertexAlphaPhysicalV1':'SceneToWebOwnedVertexAlphaStandardV1')
    const key=clone.customProgramCacheKey(),prototype=physical?MeshPhysicalNodeMaterial.prototype:MeshStandardNodeMaterial.prototype
    for(const throws of [false,true]){
      const spy=vi.spyOn(prototype,'setupDiffuseColor').mockImplementation(function(){
        expect(this.vertexColors).toBe(false);expect(this.opacityNode).toBe(p.nodes.opacityNode)
        expect(this.map).toBe(map);expect(this.alphaMap).toBe(map);expect(this.colorNode).not.toBe(originalColor)
        const joined=(this.colorNode as any).node
        expect(joined.nodes).toHaveLength(2)
        expect(joined.nodes[0].components).toBe('xyz')
        const graph=new Set<any>(),visit=(node:any):void=>{if(graph.has(node))return;graph.add(node);for(const child of node.getChildren())visit(child)}
        visit(this.colorNode)
        expect(graph.has(originalColor)).toBe(true)
        // Only the owned color (plus width conversion/split/join) participates;
        // no vertex-color or material-map alpha multiply enters the graph.
        expect([...graph].some(node=>node.isOperatorNode||node.isAttributeNode||node.isTextureNode||node.isReferenceNode)).toBe(false)
        expect(joined.nodes[1].isConstNode).toBe(true);expect(joined.nodes[1].value).toBe(1)
        if(throws)throw Error('native diffuse setup failed')
      })
      try{
        const call=()=>clone.setupDiffuseColor({geometry} as Parameters<MeshStandardNodeMaterial['setupDiffuseColor']>[0])
        if(throws)expect(call).toThrow('native diffuse setup failed');else call()
        expect(spy).toHaveBeenCalledTimes(1)
        expect(clone.vertexColors).toBe(true);expect(clone.colorNode).toBe(originalColor)
        expect(clone.opacityNode).toBe(p.nodes.opacityNode);expect(clone.map).toBe(map);expect(clone.customProgramCacheKey()).toBe(key)
        expect(source.vertexColors).toBe(true);expect(source.opacity).toBe(.75);expect(source.map).toBe(map);expect(source.alphaMap).toBe(map)
        expect((source as any).completeProgramColor).toBe(false)
        expect((source as any).colorNode).toBeUndefined();expect(Array.from(map.image.data)).toEqual([32,64,128,16])
        expect(Array.from(geometry.getAttribute('color').array)).toEqual([.125,.25,.5,.125])
      }finally{spy.mockRestore()}
    }
    const copied=clone.clone() as typeof clone
    expect(copied.completeProgramColor).toBe(true);expect(copied.colorNode).toBe(originalColor);expect(copied.customProgramCacheKey()).toBe(key)
    copied.dispose();clone.dispose();source.dispose();geometry.dispose();map.dispose()
  })
  it.each([.25,Math.fround(.3),1])('owns visible material state for alpha %s without changing the stock carrier',alpha=>{
    const p=buildMaterialProgram(complete(alpha),{})
    expect(p.skipped).toEqual([]);expect(p.nodes.opacityNode).toBeTruthy();expect(p.nodes.maskShadowNode).toBeTruthy()
    expect(p.materialState).toEqual({model:'eevee53-static-shadow-alpha-v1',visibleAlpha:alpha})
    const original=new MeshStandardMaterial({transparent:alpha===1,depthWrite:alpha!==1,alphaTest:.4,alphaHash:true,alphaToCoverage:true,opacity:1})
    const sourceState=[original.transparent,original.depthWrite,original.alphaTest,original.alphaHash,original.alphaToCoverage,original.opacity],disposed=vi.fn();original.addEventListener('dispose',disposed)
    const clone=installProgramIntoMaterial(original,p.nodes,p.materialState)
    expect([clone.transparent,clone.depthWrite,clone.alphaTest,clone.alphaHash,clone.alphaToCoverage]).toEqual([alpha<1,alpha===1,0,false,false])
    expect(clone.opacityNode).toBe(p.nodes.opacityNode);expect(clone.maskShadowNode).toBe(p.nodes.maskShadowNode)
    expect((original as any).maskShadowNode).toBeUndefined();expect((original as any).opacityNode).toBeUndefined()
    const copied=clone.clone()
    expect([copied.transparent,copied.depthWrite,copied.alphaTest,copied.alphaHash,copied.alphaToCoverage]).toEqual([alpha<1,alpha===1,0,false,false])
    expect(copied.opacityNode).toBe(clone.opacityNode);expect(copied.maskShadowNode).toBe(clone.maskShadowNode);copied.dispose()
    clone.dispose();expect(disposed).not.toHaveBeenCalled()
    expect([original.transparent,original.depthWrite,original.alphaTest,original.alphaHash,original.alphaToCoverage,original.opacity]).toEqual(sourceState);original.dispose()
  })
  it.each([
    ()=>({Roughness:channel(wrapper())}),
    ()=>({...complete(),Alpha:channel({op:'math',operation:'ADD',a:wrapper(),b:{op:'const_float',value:0}})}),
    ()=>({...complete(),Alpha:channel({...wrapper(),sourceProfile:'cycles'})}),
    ()=>({...complete(),Alpha:channel({...wrapper(),extra:true})}),
    ()=>({...complete(),Alpha:channel({...wrapper(),input:{op:'not-supported'}})}),
    ()=>({...complete(),Alpha:channel({...wrapper(),input:{op:'const_float',value:.5}})}),
    ()=>({...complete(),Alpha:channel({...wrapper(),input:{op:'const_float',value:.25,extra:0}})}),
    ...[undefined,0,-1,1.1,.3,NaN,Infinity,'0.25'].map(visibleAlpha=>()=>({...complete(),Alpha:channel({...wrapper(),visibleAlpha})})),
  ])('refuses misplaced, forged or incomplete visible programs',make=>expect(()=>buildMaterialProgram(make(),{})).toThrow())
  it.each(['Base Color','Metallic','Roughness','Emission','Alpha'])('requires the complete %s surface node',name=>{
    const channels:Record<string,any>=complete();delete channels[name]
    if(name==='Alpha'){
      const p=buildMaterialProgram(channels,{});expect(p.materialState).toBeUndefined();expect(p.nodes.maskShadowNode).toBeUndefined()
      const built=buildMaterialProgram(complete(),{});delete built.nodes.opacityNode
      expect(()=>installProgramIntoMaterial(new MeshStandardMaterial(),built.nodes,built.materialState)).toThrow(/complete/)
    }else expect(()=>buildMaterialProgram(channels,{})).toThrow(/complete/)
  })
  it('refuses missing, mismatched or incomplete explicit render state before allocating a clone',()=>{
    const p=buildMaterialProgram(complete(),{}),source=new MeshStandardMaterial()
    expect(()=>installProgramIntoMaterial(source,p.nodes)).toThrow(/state/)
    for(const state of [{model:'other',visibleAlpha:.25},{model:'eevee53-static-shadow-alpha-v1',visibleAlpha:0},{...p.materialState,extra:true}])expect(()=>installProgramIntoMaterial(source,p.nodes,state as any)).toThrow(/state/)
    expect(()=>installProgramIntoMaterial(source,p.nodes,{...p.materialState!,visibleAlpha:.5})).toThrow(/match/)
    expect(()=>installProgramIntoMaterial(source,{...p.nodes,maskShadowNode:bool(true)},p.materialState)).toThrow(/match/)
    const unmasked={...p.nodes};delete unmasked.maskShadowNode
    expect(()=>installProgramIntoMaterial(source,unmasked,p.materialState)).toThrow(/mask/)
    expect(()=>buildMaterialProgram({...complete(),Extra:channel({op:'const_float',value:1})},{})).toThrow(/without skips/)
    expect(()=>buildMaterialProgram({...complete(),Roughness:channel({op:'not-supported'})},{})).toThrow(/without skips/)
    source.dispose()
  })
  it('requires an exporter declaration even when the visible carrier is portable',()=>{
    const channels=complete()
    expect(validateNodeRendererRequirement(channels,undefined).issue).toMatch(/requires its exported/)
    expect(validateNodeRendererRequirement(channels,{schemaVersion:1,model:'live-material-programs-v1',programs:[{op:'shadow_exclusion_native',model:'eevee53-white-shadow-branch-v1'}]}).issue).toBeUndefined()
  })
  it('installs explicit state, then restores source identity/callbacks on dispose and callback-install rollback',async()=>{
    const source=new MeshStandardMaterial({transparent:false,opacity:1}),mesh=new Mesh(undefined,source),root=new Group();root.add(mesh);source.userData.blendlink_source_material='Shadow'
    const before=vi.fn(),after=vi.fn();mesh.onBeforeShadow=before;mesh.onAfterShadow=after
    const options={root,descriptor:{materialPrograms:{url:'x',bytes:1,hash:'x',materials:1}},loadPrograms:async()=>({schemaVersion:1 as const,model:'blendlink-material-programs-v1' as const,materials:{Shadow:{channels:complete()}}})}
    const handle=await installTslMaterials(options),clone=mesh.material as MeshStandardMaterial
    expect(handle.applied).toBe(1);expect(clone).not.toBe(source);expect(clone.transparent).toBe(true);expect(clone.depthWrite).toBe(false);expect(source.transparent).toBe(false)
    expect(mesh.onBeforeShadow).not.toBe(before);handle.dispose();handle.dispose();expect(mesh.material).toBe(source);expect(mesh.onBeforeShadow).toBe(before);expect(mesh.onAfterShadow).toBe(after)
    await expect(installTslMaterials({...options,loadPrograms:async()=>({schemaVersion:1 as const,model:'blendlink-material-programs-v1' as const,materials:{Shadow:{channels:complete(),skipped:[{channel:'Coat Weight',reason:'unqualified'}]}}})})).rejects.toThrow(/source surface program without skips/)
    expect(mesh.material).toBe(source);expect(mesh.onBeforeShadow).toBe(before);expect(mesh.onAfterShadow).toBe(after)
    Object.defineProperty(mesh,'onAfterShadow',{configurable:true,get:()=>after,set:()=>{throw Error('app readonly after')}})
    await expect(installTslMaterials(options)).rejects.toThrow(/readonly after/)
    expect(mesh.material).toBe(source);expect(mesh.onBeforeShadow).toBe(before);expect(mesh.onAfterShadow).toBe(after);expect(source.transparent).toBe(false)
    source.dispose();mesh.geometry.dispose()
  })
})
