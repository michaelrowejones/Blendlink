import{describe,it,expect}from'vitest'
import{buildCompositorBoxMask,boxMaskIntervals,boxMaskValues,validateBoxMaskGraph,type BoxMaskSettings}from'./tslCompositorBoxMask.js'
import{buildSourceCompositor}from'./tslSourceCompositor.js'
import type{SourceCompositorOperation,SourceCompositorProgram}from'./sourceDisplay.js'
const s=():BoxMaskSettings=>({operation:'ADD',position:[.5,.5],size:[Math.fround(.2),Math.fround(.1)],mask:0,value:1})
const op=():SourceCompositorOperation=>({id:'box',kind:'box-mask',type:'VALUE',source:{path:['Scene'],node:'Artist Box',nodeType:'CompositorNodeBoxMask',output:'Mask'},inputs:{},properties:{box_mask_model:'cpu-f32-axis-integer-intervals-v1',box_mask_source_profile:'darwin-arm64-53-box-mask-cpu-v1',box_mask_native_version:[5,3,0],box_mask_reference_model:'full-frame-context-zero-offset-v1',box_mask_precision:'CPU_FLOAT32',box_mask_scalar_storage:'native-interface-copy-f32-v1',box_mask_literal_model:'zero-or-2^-16-bounded-f32-v1',box_mask_scalar_words:[0,1065353216,0],box_mask_requested_precision:'AUTO',evaluation_device:'CPU',single_value_device:'CPU',box_mask_export_extent:[13,9],box_mask_operation:'ADD',box_mask_position:s().position,box_mask_size:s().size,box_mask_mask:0,box_mask_value:1}})
const fail=(message:string):never=>{throw Error(message)}
describe('CPU Box Mask integer boundaries',()=>{
 it('retains strict edges and both adjacent representable size values',()=>{
  const a=s();a.size=[.5,.5];expect(boxMaskIntervals(5,5,a)).toEqual([2,2,2,2])
  a.size=[.5000000596046448,.5000000596046448];expect(boxMaskIntervals(5,5,a)).toEqual([1,3,1,3])
  a.size=[.4999999701976776,.4999999701976776];expect(boxMaskIntervals(5,5,a)).toEqual([2,2,2,2])
 })
 it('handles zero sizes, offscreen positions, aspect and thin extents without per-pixel storage',()=>{
  const a=s();a.size=[0,.5];expect(boxMaskIntervals(5,5,a)).toEqual([5,-1,2,2])
  a.position=[1.5,1.5];expect(boxMaskIntervals(13,9,a)).toEqual([13,-1,9,-1])
  expect(boxMaskIntervals(8192,2,s())).toHaveLength(4)
  for(const [w,h]of[[1,2],[2,1],[8193,2],[2.5,3]])expect(()=>boxMaskIntervals(w!,h!,s())).toThrow(/extents/)
 })
 it('preserves all four operation inside/outside values and negative output restrictions',()=>{
  const a=s();a.mask=.75;a.value=.5
  for(const [mode,expected]of[['ADD',[.75,.75]],['SUBTRACT',[.25,.75]],['MULTIPLY',[.375,0]],['NOT',[0,.75]]]as const){a.operation=mode;expect(boxMaskValues(a)).toEqual(expected)}
  a.mask=0;a.operation='NOT';expect(boxMaskValues(a)).toEqual([.5,0]);a.operation='MULTIPLY';a.mask=2**-100;a.value=2**-30;expect(()=>boxMaskValues(a)).toThrow(/subnormal/)
 })
 it('builds the production scalar-to-RGBA path as a field and disposes idempotently',()=>{
  const node=op(),program:SourceCompositorProgram={version:1,status:'extracted',ops:[node],passes:[],diagnostics:[],output:{kind:'convert',type:'RGBA',fromType:'VALUE',input:{kind:'ref',type:'VALUE',node:node.id}}}
  const built=buildSourceCompositor(program,()=>{throw Error('Box Mask has no image input')});expect(built.node.isNode).toBe(true);built.dispose();built.dispose()
 })
 it('commits resize bounds atomically, recovers from refusal, and snapshots static settings',()=>{
  const a=op(),node=buildCompositorBoxMask(a,[a],fail),uniforms=new Set<any>()
  node.traverse((child:any)=>{if(child.isUniformNode)uniforms.add(child)})
  const size=[...uniforms].find(n=>n.updateType==='render'),bounds=[...uniforms].find(n=>n.nodeType==='ivec4')
  expect(size).toBeDefined();expect(bounds).toBeDefined()
  let width=5,height=5,target:any={width,height}
  const frame={renderer:{getDrawingBufferSize:(value:any)=>value.set(width,height),getRenderTarget:()=>target}}
  size.update(frame);const oldSize=size.value.toArray(),oldBounds=bounds.value.toArray()
  width=1;target={width,height};expect(()=>size.update(frame)).toThrow(/physical/);expect(size.value.toArray()).toEqual(oldSize);expect(bounds.value.toArray()).toEqual(oldBounds)
  width=13;height=9;target={width,height};(a.properties.box_mask_position as number[])[0]=2
  size.update(frame);expect(size.value.toArray()).toEqual([13,9]);expect(bounds.value.toArray()).toEqual(boxMaskIntervals(13,9,s()))
  target={width:12,height:9};expect(()=>size.update(frame)).toThrow(/physical/);expect(size.value.toArray()).toEqual([13,9])
  target=null;size.update(frame);expect(bounds.value.toArray()).toEqual(boxMaskIntervals(13,9,s()))
 })
 it('refuses spoofed source stage, scalar storage, formats, topology and spatial domains',()=>{
  for(const change of[{evaluation_device:'GPU'},{box_mask_precision:'HALF'},{box_mask_scalar_storage:'unknown'},{box_mask_size:[2**-126,.5]},{box_mask_mask:-0},{box_mask_position:[0,2**-149]},{box_mask_export_extent:[1,4]}]){const a=op();Object.assign(a.properties,change);expect(()=>buildCompositorBoxMask(a,[a],fail)).toThrow(/Box Mask/)}
  const a=op();expect(()=>buildCompositorBoxMask(a,[a,a],fail)).toThrow(/Box Mask/)
  for(const kind of ['blur','flip'])expect(()=>validateBoxMaskGraph({ops:[a,{...a,kind}]}as SourceCompositorProgram,fail)).toThrow(/pointwise/)
 })
 it('owns an independent result guard for all-zero and constant selections',()=>{
  for(const [mask,value]of[[0,0],[1,.5]]){
   const a=op();a.properties.box_mask_mask=mask!;a.properties.box_mask_value=value!
   const bits=(n:number)=>{const view=new DataView(new ArrayBuffer(4));view.setFloat32(0,n,true);return view.getUint32(0,true)}
   a.properties.box_mask_scalar_words=[bits(mask!),bits(value!),0]
   const node=buildCompositorBoxMask(a,[a],fail)
   expect(node.isVarNode).toBe(true);expect(node.updateType).toBe('render')
   expect(()=>node.update({renderer:{getDrawingBufferSize:(v:any)=>v.set(1,9),getRenderTarget:()=>null}})).toThrow(/physical/)
   expect(()=>node.update({renderer:{getDrawingBufferSize:(v:any)=>v.set(13,9),getRenderTarget:()=>null}})).not.toThrow()
  }
 })
})
