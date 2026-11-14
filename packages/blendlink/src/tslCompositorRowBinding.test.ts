import {it,expect} from 'vitest'
import {DataTexture,FloatType,RedFormat} from 'three'
import {CompositorExactAxes} from './tslCompositorExactAxes.js'
it('refuses a foreign texture-node binding before a render can consume it',()=>{
 const axes=new CompositorExactAxes(),nodes:any[]=[];axes.node.traverse((n:any)=>{if(n.isTextureNode)nodes.push(n)})
 const borrowed=new DataTexture(new Float32Array([.75,.75]),1,2,RedFormat,FloatType)
 const target={width:13,height:9,viewport:{x:0,y:0,z:13,w:9},scissorTest:false},renderer:any={isWebGPURenderer:true,backend:{isWebGPUBackend:true,device:{}},_textures:{data:new WeakMap()},getDrawingBufferSize:(v:any)=>v.set(13,9),getRenderTarget:()=>target}
 try{
  expect(nodes.length).toBeGreaterThan(0);for(const node of nodes)node.value=borrowed
  expect(nodes.every(node=>node.value===borrowed)).toBe(true)
  expect(()=>axes.validate(renderer)).toThrow(/binding/)
 }finally{axes.dispose();borrowed.dispose()}
})
