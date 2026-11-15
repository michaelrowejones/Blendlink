/* SPDX-License-Identifier: MIT */
/** Explicit serialized dependencies only; never traverse arbitrary TSL graphs. */
import type {SourceCompositorOperation,CompositorValue} from './sourceDisplay.js'
import type {TslEffectNode} from './tslPostEffects.js'
import {RendererUtils} from 'three/webgpu'
export function updateCompositorPassProducers(nodes:readonly TslEffectNode[],frame:TslEffectNode):void{
 const passes=new Set<TslEffectNode>()
 for(const node of nodes){const pass=node?.isPassNode?node:node?.isPassTextureNode?node.passNode:null;if(node?.isPassTextureNode&&!pass)throw Error('Compositor producer requires its actual FRAME PassNode');if(pass){if(pass.isPassNode!==true||pass.getUpdateBeforeType?.()!=='frame')throw Error('Compositor producer requires its actual FRAME PassNode');passes.add(pass)}}
 if(passes.size&&typeof frame.updateBeforeNode!=='function')throw Error('Compositor producer requires the actual NodeFrame dependency scheduler')
 for(const pass of passes){
  // r184 PassNode has no error-path finally. Save without resetting: the
  // producer must see caller state, including its clear alpha and draw hook.
  const renderer=frame.renderer,scene=pass.scene,camera=pass.camera
  const state=RendererUtils.saveRendererState(renderer,undefined as never)
  const temporary={transparent:renderer.transparent,opaque:renderer.opaque,contextNode:renderer.contextNode,name:scene.name,overrideMaterial:scene.overrideMaterial,mask:camera.layers.mask}
  try{frame.updateBeforeNode(pass)}catch(error){
   RendererUtils.restoreRendererState(renderer,state)
   renderer.transparent=temporary.transparent;renderer.opaque=temporary.opaque;renderer.contextNode=temporary.contextNode
   scene.name=temporary.name;scene.overrideMaterial=temporary.overrideMaterial;camera.layers.mask=temporary.mask
   throw error
  }
 }
}
/** Once-per-build IR provenance. Topological source refs are already required
 * by the emitter. Conversions carry ancestry without activating image domains. */
export function compositorProducerLookup(ops:readonly SourceCompositorOperation[],resolved:ReadonlyMap<string,TslEffectNode>,fail:(message:string)=>never):(value:CompositorValue)=>TslEffectNode[]{
 const ancestry=new Map<string,readonly string[]>();let visits=0
 const refs=(value:CompositorValue):readonly string[]=>{
  let current=value;const seen=new Set<CompositorValue>()
  while(current?.kind==='convert'){
   if(++visits>65536||seen.has(current)||!current.input)return fail('Compositor producer ancestry exceeds its bounded acyclic input budget')
   seen.add(current);current=current.input
  }
  if(++visits>65536)return fail('Compositor producer ancestry exceeds its bounded input budget')
  if(current?.kind==='ref'){const found=ancestry.get(current.node??'');if(!found)return fail('Compositor producer ancestry requires preceding source refs');return found}
  return []
 }
 for(const op of ops){if(ancestry.has(op.id))return fail('Compositor producer ancestry requires unique source IDs');ancestry.set(op.id,op.kind==='render-pass'?[op.id]:[...new Set(Object.values(op.inputs).flatMap(input=>refs(input.value)))])}
 return value=>refs(value).map(id=>{const node=resolved.get(id);if(!node)return fail('Compositor producer has no resolved runtime pass binding');return node})
}
