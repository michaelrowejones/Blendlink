/* SPDX-License-Identifier: MIT */
import * as TSL from 'three/tsl'
import type { CompositorValue, SourceCompositorOperation } from './sourceDisplay.js'
import type { TslEffectNode } from './tslPostEffects.js'

const {bitcast,float,max,min,textureSize,uint}=TSL as unknown as Record<'bitcast'|'float'|'max'|'min'|'textureSize'|'uint',(...args:TslEffectNode[])=>TslEffectNode>
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value)
const validNumber=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value)&&Math.fround(value)===value
  &&!Object.is(value,-0)&&Math.abs(value)<=65536&&(value===0||Math.abs(value)>=2**-126)

/** Domain-only dependency; scalar output retains native single-value evaluation. */
export function buildCompositorRelativeToPixel(op:SourceCompositorOperation,operations:readonly SourceCompositorOperation[],
  resolve:(value:CompositorValue)=>TslEffectNode,fail:(message:string)=>never):TslEffectNode {
  const p=op.properties,reference=p?.relative_to_pixel_image
  if(!record(p)||op.kind!=='relative-to-pixel'||op.type!=='VALUE'||op.source.nodeType!=='CompositorNodeRelativeToPixel'
    ||op.source.output!=='Float Value'||p.relative_to_pixel_model!=='scalar-render-size-f32-v1'
    ||p.relative_to_pixel_reference_model!=='untransformed-render-layer-v1'
    ||p.relative_to_pixel_source_profile!=='darwin-arm64-53-f32-v1'
    ||!Array.isArray(p.relative_to_pixel_native_version)||JSON.stringify(p.relative_to_pixel_native_version)!=='[5,3,0]'
    ||!['X','Y','Greater','Smaller'].includes(String(p.reference_dimension))
    ||!['CPU','GPU'].includes(String(p.evaluation_device))||p.single_value_device!=='CPU'
    ||!record(reference)||reference.kind!=='ref'||reference.type!=='RGBA'||typeof reference.node!=='string'
    ||!record(op.inputs)||Object.keys(op.inputs).join()!=='Value'||op.inputs.Value?.socketType!=='VALUE')
    return fail('Relative To Pixel requires its measured scalar/reference schema and native profile')
  const index=operations.indexOf(op)
  if(index<0||operations.length>2048)return fail('Relative To Pixel requires a bounded topological graph')
  const prefix=operations.slice(0,index),ids=prefix.map(item=>item.id)
  if(new Set([...ids,op.id]).size!==index+1)return fail('Relative To Pixel requires unique prior operation identities')
  const image=prefix.find(item=>item.id===reference.node)
  if(image?.kind!=='render-pass'||image.type!=='RGBA'||image.source.nodeType!=='CompositorNodeRLayers'
    ||image.source.output!=='Image'||image.pass?.pass!=='Image')
    return fail('Relative To Pixel requires a direct verified Render Layers Image reference')
  const incoming=op.inputs.Value.value
  let number:unknown
  if(incoming.kind==='constant'&&incoming.type==='VALUE')number=incoming.value
  else if(incoming.kind==='ref'&&incoming.type==='VALUE'){
    const source=prefix.find(item=>item.id===incoming.node)
    if(source?.kind==='value'&&source.type==='VALUE'&&Object.keys(source.inputs).length===0
      &&['ShaderNodeValue','CompositorNodeValue'].includes(source.source.nodeType)&&source.source.output==='Value')number=source.value
  }
  if(!validNumber(number))return fail('Relative To Pixel requires a normal-or-positive-zero exact Float32 literal/Value/group input (negative zero remains unqualified) with magnitude <=65536')
  const dimensions=textureSize(resolve(reference as unknown as CompositorValue),0),x=float(dimensions.x),y=float(dimensions.y)
  const size=p.reference_dimension==='X'?x:p.reference_dimension==='Y'?y:p.reference_dimension==='Greater'?max(x,y):min(x,y)
  const buffer=new ArrayBuffer(4),view=new DataView(buffer);view.setFloat32(0,number,true)
  return bitcast(uint(view.getUint32(0,true)),'float').mul(size)
}
