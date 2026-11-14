import {expect,it,vi} from 'vitest'
import {OwnedCompositorRowTable} from './tslCompositorRowTable.js'
const textureOf=(node:any):any=>{const all=new Set<any>();node.traverse((n:any)=>{if(n.isTextureNode)all.add(n.value)});expect(all.size).toBe(1);return [...all][0]}
function host(){const state={width:13,height:9},target:any={width:13,height:9,viewport:{x:0,y:0,z:13,w:9},scissorTest:false},renderer:any={isWebGPURenderer:true,backend:{isWebGPUBackend:true,device:{}},_textures:{data:new WeakMap()},getDrawingBufferSize:(v:any)=>v.set(state.width,state.height),getRenderTarget:()=>target}
 return{renderer,resize(w:number,h:number){state.width=w;state.height=h;target.width=w;target.height=h;target.viewport.z=w;target.viewport.w=h}}
}
it('one-row and two-row builders retain a valid allocation until a fully validated replacement exists',()=>{
 for(const rows of[1,2]){
  let bad=false;const build=vi.fn((w:number,h:number)=>{const data=new Float32Array(Math.max(w,h)*rows);data.fill(bad?NaN:.25);return data}),table=new OwnedCompositorRowTable(rows,build,{label:'Test rows',name:'Owned test'}),node=table.guard(table.sample('X',0).toVar()),texture=textureOf(node),frame=host()
  table.validate(frame.renderer);const first=texture.image.data,version=texture.version
  for(let i=0;i<3;i++)table.validate(frame.renderer);expect(build).toHaveBeenCalledTimes(1);expect(texture.image.height).toBe(rows)
  frame.resize(3,9);expect(()=>table.validate(frame.renderer)).toThrow(/physical extents/);expect(build).toHaveBeenCalledTimes(1)
  frame.resize(9,13);bad=true;expect(()=>table.validate(frame.renderer)).toThrow(/nonnormal/);expect(texture.image.data).toBe(first);expect(texture.version).toBe(version)
  bad=false;table.validate(frame.renderer);expect(texture.image.data).not.toBe(first);expect(texture.version).toBe(version+1);expect(texture.image.width).toBe(13)
  table.dispose();table.dispose();expect(()=>table.sample('X',0)).toThrow(/disposed/)
 }
})
it('internal row plans cannot smuggle wrong dimensions, shared buffers or nonnormal words',()=>{
 for(const build of[()=>new Float32Array(1),()=>new Float32Array(new SharedArrayBuffer(13*4)),()=>new Float32Array(13).fill(-0),()=>new Float32Array(13).fill(2**-149)]){
  const table=new OwnedCompositorRowTable(1,build,{label:'Test rows',name:'Owned test'});expect(()=>table.validate(host().renderer)).toThrow(/storage|nonnormal/);table.dispose()
 }
 expect(()=>new OwnedCompositorRowTable(9,()=>new Float32Array(),{label:'Test rows',name:'Owned test'})).toThrow(/one to eight/)
 const table=new OwnedCompositorRowTable(1,()=>new Float32Array(13),{label:'Test rows',name:'Owned test'});expect(()=>table.sample('X',1)).toThrow(/selector/);table.dispose()
})
