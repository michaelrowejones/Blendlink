import {expect,it,vi} from 'vitest'
import {pass as renderPass,vec4} from 'three/tsl'
import {Scene,PerspectiveCamera} from 'three'
import {buildSourceCompositor} from './tslSourceCompositor.js'
import {translatedImageOrigin,validateCompositorExtent} from './tslCompositorImageDomain.js'
import {DISPLACE_SINGLE_MODEL as model,DISPLACE_SINGLE_PROFILE as profile,DISPLACE_MAX_PIXELS as cap,validateDisplaceProgram} from './tslCompositorDisplace.js'
const fail=(message:string):never=>{throw Error(message)}
const word=(n:number)=>new Uint32Array(new Float32Array([n]).buffer)[0]
const pass={scene:'Scene',viewLayer:'ViewLayer',pass:'Image',name:'Image',type:'RGBA'}
const op=(x=.25,y=-.5):any=>({id:'displace',kind:'translate',type:'RGBA',source:{path:['Compositor'],node:'Artist Displace',nodeType:'CompositorNodeDisplace',output:'Image'},properties:{evaluation_device:'CPU',single_value_device:'CPU',image_domain_model:'native-translation-v2',image_translation:[x,y],image_interpolation:'Bilinear',image_sampling_model:'modern-cpu-v1',displace_model:model,displace_profile:profile,displace_version:[5,3,0],displace_build:'02f0899d78e3',displace_words:[word(x),word(y)],displace_source_kind:'render-layer',displace_image_words:null,displace_export_extent:[13,9],displace_requested_precision:'FULL',displace_max_pixels:cap},inputs:{Image:{name:'Image',socketType:'RGBA',value:{kind:'ref',type:'RGBA',node:'image'}}}})
const program=():any=>({version:1,status:'extracted',ops:[{id:'image',kind:'render-pass',type:'RGBA',source:{path:['Compositor'],node:'Render Layers',nodeType:'CompositorNodeRLayers',output:'Image'},properties:{},inputs:{},pass},op()],passes:[pass],diagnostics:[],output:{kind:'ref',type:'RGBA',node:'displace'}})
it('retains the actual Displace class/model while reusing deferred domain composition',()=>{
 const p=program();expect(validateDisplaceProgram(p,fail)).toBe(true)
 const root={node:vec4(1)},before={x:0,y:0,roots:[root]},after=translatedImageOrigin(p.ops[1],before,fail)!
 expect(after).toEqual({x:.25,y:-.5,roots:[root],sampling:{model:'modern-cpu-v1',interpolation:'Bilinear'},maxPixels:cap});expect(before).toEqual({x:0,y:0,roots:[root]})
 const built=buildSourceCompositor(p,()=>vec4(1));expect(built.node.isNode).toBe(true);built.dispose();built.dispose()
})
it('preserves the genuine native single-RGBA copy without creating a resampling texture',()=>{
 const p=program(),color=[.125,.25,.5,1];p.ops=[op(8192,-8192)];p.ops[0].inputs.Image.value={kind:'constant',type:'RGBA',value:color};Object.assign(p.ops[0].properties,{displace_source_kind:'constant-rgba',displace_image_words:color.map(word)})
 expect(validateDisplaceProgram(p,fail)).toBe(true);const resolve=vi.fn(),built=buildSourceCompositor(p,resolve),textures:any[]=[];built.node.traverse((node:any)=>{if(node.isTextureNode)textures.push(node)});expect(textures).toHaveLength(0);expect(resolve).not.toHaveBeenCalled();built.dispose()
})
it('rejects unqualified schemas, branch claims and float2 words before resolving or allocating Image',()=>{
 for(const mutate of[(p:any)=>p.ops[1].source.nodeType='CompositorNodeTranslate',(p:any)=>delete p.ops[1].properties.displace_model,(p:any)=>p.ops[1].properties.displace_fake=true,(p:any)=>p.ops[1].properties.evaluation_device='GPU',(p:any)=>p.ops[1].properties.image_sampling_model='modern-metal-v1',(p:any)=>p.ops[1].properties.image_translation=[-0,0],(p:any)=>p.ops[1].properties.image_translation=[2**-17,0],(p:any)=>p.ops[1].properties.displace_words[0]++,(p:any)=>p.ops[1].properties.displace_export_extent=[8192,8192],(p:any)=>p.ops[1].inputs.Displacement={value:{kind:'constant',type:'VECTOR',value:[0,0,0]}},(p:any)=>p.ops[1].inputs.Image.value={kind:'convert',fromType:'RGBA',type:'RGBA',input:p.ops[1].inputs.Image.value},(p:any)=>p.output={kind:'ref',type:'RGBA',node:'image'},(p:any)=>p.ops[0].source.output='Normal',(p:any)=>p.ops[0].id=p.ops[1].id]){
  const p=program(),resolve=vi.fn();mutate(p);expect(()=>buildSourceCompositor(p,resolve)).toThrow(/Displace/);expect(resolve).not.toHaveBeenCalled()
 }
})
it('refuses field realization before querying roots or growing an RTT, and recovers at valid bounds',()=>{
 const extent=vi.fn(()=>[13,9] as const),origin=translatedImageOrigin(op(),{x:0,y:0,roots:[{node:vec4(1),extent}]},fail)!
 expect(()=>validateCompositorExtent(origin,{},8192,8192,fail)).toThrow(/pixel budget/);expect(extent).not.toHaveBeenCalled()
 const field={...origin,roots:[]};for(const[w,h]of[[3,9],[8193,4],[2049,2048]])expect(()=>validateCompositorExtent(field,{},w!,h!,fail)).toThrow(/pixel budget/)
 expect(()=>validateCompositorExtent(field,{},2048,2048,fail)).not.toThrow()
})

it('retains an actual caller target/viewport guard through a constant terminal expression',()=>{
 const built=buildSourceCompositor(program(),()=>vec4(1)),target:any={width:13,height:9,viewport:{x:0,y:0,z:13,w:9},scissorTest:false},renderer:any={isWebGPURenderer:true,backend:{isWebGPUBackend:true,device:{}},_textures:{data:new WeakMap()},getDrawingBufferSize:(v:any)=>v.set(13,9),getRenderTarget:()=>target}
 expect(()=>built.node.update({renderer})).not.toThrow();target.viewport.x=1;expect(()=>built.node.update({renderer})).toThrow(/Displace.*zero-origin/);target.viewport.x=0;expect(()=>built.node.update({renderer})).not.toThrow();target.width=12;expect(()=>built.node.update({renderer})).toThrow(/Displace/);built.dispose()
})

it('rejects saved-dispose manager resets while an external device stays alive',()=>{
 const built=buildSourceCompositor(program(),()=>vec4(1)),device={},manager={data:new WeakMap()},renderer:any={isWebGPURenderer:true,backend:{isWebGPUBackend:true,device},_textures:manager,getDrawingBufferSize:(v:any)=>v.set(13,9),getRenderTarget:()=>({width:13,height:9,viewport:{x:0,y:0,z:13,w:9},scissorTest:false}),dispose(){manager.data=new WeakMap()}}
 const saved=renderer.dispose.bind(renderer);expect(()=>built.node.update({renderer})).not.toThrow();saved();expect(renderer.backend.device).toBe(device);expect(()=>built.node.update({renderer})).toThrow(/Displace.*allocation epoch/);built.dispose()
})

it('copies only admitted Displace pass inputs by texel load while preserving the borrowed PassNode provenance',()=>{
 const source=renderPass(new Scene(),new PerspectiveCamera()),texture:any=source.getTextureNode(),dispose=vi.spyOn(source,'dispose'),clone=vi.spyOn(texture,'clone'),p=program(),before={sampler:texture.sampler,uv:texture.uvNode,reference:texture.referenceNode,value:texture.value},built=buildSourceCompositor(p,()=>texture)
 const copies=clone.mock.results.map(result=>result.value).filter(node=>node.isPassTextureNode&&node.sampler===false)
 expect(copies.length).toBeGreaterThan(0);expect(copies.every(node=>node!==texture&&node.passNode===source)).toBe(true)
 const passBuilt=buildSourceCompositor(p,()=>source);expect(clone.mock.results.some(result=>result.value.isPassTextureNode&&result.value.passNode===source&&result.value.sampler===false)).toBe(true)
 expect({sampler:texture.sampler,uv:texture.uvNode,reference:texture.referenceNode,value:texture.value}).toEqual(before)
 clone.mockClear();const old={...p,ops:[p.ops[0]],output:{kind:'ref',type:'RGBA',node:'image'}},legacy=buildSourceCompositor(old,()=>texture)
 expect(clone).not.toHaveBeenCalled();built.dispose();passBuilt.dispose();legacy.dispose();expect(dispose).not.toHaveBeenCalled();source.dispose()
})
