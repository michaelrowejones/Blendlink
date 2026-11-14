/* SPDX-License-Identifier: MIT */
/** Owned O(W+H) native Uniform coordinates, shared by a compositor build. */
import {vec3} from 'three/tsl'
import {OwnedCompositorRowTable,validateCompositorRowExtent} from './tslCompositorRowTable.js'
import type {TslEffectNode} from './tslPostEffects.js'
const refuse=(message:string):never=>{throw Error('White Noise exact axes: '+message)}
/** All half-integers are exact; scaling by two commutes with normal F32 rounding. */
export function compositorUniformAxes(width:number,height:number):Float32Array{
 validateCompositorRowExtent(width,height,refuse);const maximum=Math.max(width,height),data=new Float32Array(maximum*2)
 for(let i=0;i<width;i++)data[i]=Math.fround((2*i+1-width)/maximum)
 for(let i=0;i<height;i++)data[maximum+i]=Math.fround((2*i+1-height)/maximum)
 return data
}
const owners=new WeakSet<object>()
export const isCompositorExactAxes=(value:unknown):value is CompositorExactAxes=>!!value&&typeof value==='object'&&owners.has(value as object)
export class CompositorExactAxes {
 #table:OwnedCompositorRowTable;#node:TslEffectNode;#dead=false
 constructor(){
  this.#table=new OwnedCompositorRowTable(2,compositorUniformAxes,{label:'White Noise exact axes',name:'SceneToWeb exact compositor Uniform axes'})
  this.#node=this.#table.guard(vec3(this.#table.sample('X',0),this.#table.sample('Y',1),0).toVar())
  owners.add(this)
 }
 get node():TslEffectNode{if(this.#dead)refuse('pipeline resources were disposed');return this.#node}
 validate(renderer:any):void{this.#table.validate(renderer)}
 dispose():void{if(this.#dead)return;this.#dead=true;this.#table.dispose()}
}
