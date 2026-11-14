import{describe,it,expect,vi}from'vitest'
import{DataTexture,IntType,RGIntegerFormat,NearestFilter}from'three'
import{buildCompositorEllipseMask,ellipseMaskRows,ellipseMaskAxes,ellipseMaskMembership,ellipseMaskValues,validateEllipseMaskGraph,type EllipseMaskSettings}from'./tslCompositorEllipseMask.js'
import{buildSourceCompositor}from'./tslSourceCompositor.js'
import type{SourceCompositorOperation,SourceCompositorProgram}from'./sourceDisplay.js'
import{readFileSync}from'node:fs';import{join,resolve}from'node:path'
const settings=():EllipseMaskSettings=>({operation:'ADD',position:[.5,.5],size:[Math.fround(.2),Math.fround(.1)],mask:.25,value:.75})
const op=():SourceCompositorOperation=>({id:'ellipse',kind:'ellipse-mask',type:'VALUE',source:{path:['Scene'],node:'Artist Ellipse',nodeType:'CompositorNodeEllipseMask',output:'Mask'},inputs:{},properties:{ellipse_mask_model:'cpu-f32-row-integer-intervals-v1',ellipse_mask_source_profile:'darwin-arm64-53-ellipse-mask-cpu-v1',ellipse_mask_native_version:[5,3,0],ellipse_mask_reference_model:'full-frame-context-zero-offset-v1',ellipse_mask_precision:'CPU_FLOAT32',ellipse_mask_scalar_storage:'native-interface-copy-f32-v1',ellipse_mask_literal_model:'zero-or-2^-16-bounded-f32-v1',ellipse_mask_identity:false,ellipse_mask_boundary_model:'separate-fmul-fadd-fsqrt-v1',ellipse_mask_row_model:'rg32i-fixed-256x32-inclusive-v1',ellipse_mask_scalar_words:[1048576000,1061158912,0],ellipse_mask_requested_precision:'FULL',evaluation_device:'CPU',single_value_device:'CPU',ellipse_mask_export_extent:[13,9],ellipse_mask_operation:'ADD',ellipse_mask_position:settings().position,ellipse_mask_size:settings().size,ellipse_mask_mask:.25,ellipse_mask_value:.75}})
const program=(node=op()):SourceCompositorProgram=>({version:1,status:'extracted',ops:[node],passes:[],diagnostics:[],output:{kind:'convert',type:'RGBA',fromType:'VALUE',input:{kind:'ref',type:'VALUE',node:node.id}}})
const fail=(message:string):never=>{throw Error(message)}
const textures=(node:any)=>{const result=new Set<DataTexture>();node.traverse((n:any)=>{if(n.isTextureNode&&n.value?.isDataTexture)result.add(n.value)});return[...result]}
describe('CPU Ellipse Mask compact row transport',()=>{
 it('preserves strict boundaries, neighbor floats, aspect, and dense row membership',()=>{
  for(const[w,h]of[[5,5],[9,13],[14,10],[2,2]])for(const n of[.4999999701976776,.5,.5000000596046448]){const s={...settings(),size:[n,n]},rows=ellipseMaskRows(w!,h!,s),axes=ellipseMaskAxes(w!,h!,s);for(let y=0;y<h!;y++)for(let x=0;x<w!;x++)expect(x>=rows[2*y]!&&x<=rows[2*y+1]!).toBe(ellipseMaskMembership(axes.x[x]!,axes.y[y]!))}
  const s={...settings(),size:[.5,.5]};expect([...ellipseMaskRows(5,5,s)]).toEqual([5,-1,5,-1,2,2,5,-1,5,-1]);s.size=[.5000000596046448,.5000000596046448];expect([...ellipseMaskRows(5,5,s)]).toEqual([5,-1,2,2,1,3,2,2,5,-1])
 })
 it('keeps every native zero-Size operation as Mask identity',()=>{for(const operation of['ADD','SUBTRACT','MULTIPLY','NOT']as const)for(const size of[[0,.5],[.5,0],[0,0]]){const s={...settings(),operation,size};expect(ellipseMaskValues(s)).toEqual([s.mask,s.mask]);expect(ellipseMaskRows(5,5,s)).toHaveLength(0)}})
 it('loads RG32 signed integer rows with one lifetime texture and atomic recovery',()=>{
  const a=op(),resources:{dispose():void}[]=[],node=buildCompositorEllipseMask(a,[a],resources,fail),table=textures(node)[0]!,dispose=vi.spyOn(table,'dispose')
  expect(table.format).toBe(RGIntegerFormat);expect(table.type).toBe(IntType);expect(table.minFilter).toBe(NearestFilter);expect(table.image.width).toBe(256);expect(table.image.height).toBe(32)
  expect(table.image.data.byteLength).toBe(65536);let width=5,height=5,target:any={width,height};const frame={renderer:{getDrawingBufferSize:(v:any)=>v.set(width,height),getRenderTarget:()=>target}}
  node.update(frame);expect([...table.image.data.slice(0,height*2)]).toEqual([...ellipseMaskRows(width,height,settings())]);const old=table.image.data.slice(),version=table.version
  node.update(frame);expect(table.version).toBe(version)
  width=1;target={width,height};expect(()=>node.update(frame)).toThrow(/extents/);expect(table.version).toBe(version);expect(table.image.data).toEqual(old)
  width=13;height=9;target={width,height};(a.properties.ellipse_mask_position as number[])[0]=2;node.update(frame)
  expect(table.version).toBe(version+1);expect([...table.image.data.slice(0,height*2)]).toEqual([...ellipseMaskRows(width,height,settings())]);expect(textures(node)[0]).toBe(table)
  const next=table.image.data.slice(),nextVersion=table.version;target={width:12,height};expect(()=>node.update(frame)).toThrow(/physical/);expect(table.image.data).toEqual(next);expect(table.version).toBe(nextVersion)
  target=null;node.update(frame);expect(table.version).toBe(nextVersion);resources.forEach(r=>r.dispose());resources.forEach(r=>r.dispose());expect(dispose).toHaveBeenCalledTimes(1);expect(()=>node.update(frame)).toThrow(/disposed/)
 })
 it('configures result/size guards without overriding native texture-node updates',()=>{
  const a=op(),node=buildCompositorEllipseMask(a,[a],[],fail),nodes:any[]=[];node.traverse((n:any)=>nodes.push(n));const size=nodes.find(n=>n.isUniformNode&&n.nodeType==='ivec2'&&n.updateType==='render');expect(size).toBeDefined();expect(node.updateType).toBe('render');expect(()=>size.update({renderer:{getDrawingBufferSize:(v:any)=>v.set(1,9)}})).toThrow(/extents/)
 })
 it('avoids row resources for zero-Size/all-zero results while retaining invalid-extent guards',()=>{
  for(const properties of[{ellipse_mask_size:[0,.5],ellipse_mask_identity:true},{ellipse_mask_mask:0,ellipse_mask_value:0,ellipse_mask_scalar_words:[0,0,0]}]){const a=op();Object.assign(a.properties,properties);const resources:{dispose():void}[]=[],node=buildCompositorEllipseMask(a,[a],resources,fail);expect(textures(node)).toHaveLength(0);expect(node.updateType).toBe('render');expect(()=>node.update({renderer:{getDrawingBufferSize:(v:any)=>v.set(1,5)}})).toThrow(/extents/);resources.forEach(r=>r.dispose());expect(()=>node.update({renderer:{}})).toThrow(/disposed/)}
 })
 it('builds the actual compositor scalar conversion and owns cleanup on success/failure',()=>{
  const dispose=vi.spyOn(DataTexture.prototype,'dispose');try{const built=buildSourceCompositor(program(),()=>null);expect(built.node.isNode).toBe(true);built.dispose();built.dispose();expect(dispose).toHaveBeenCalledTimes(1);const p=program();p.output={kind:'ref',type:'RGBA',node:'missing'};expect(()=>buildSourceCompositor(p,()=>null)).toThrow();expect(dispose).toHaveBeenCalledTimes(2)}finally{dispose.mockRestore()}
 })
 it('refuses wrong source/storage/boundary models, raw words, domains and linked inputs',()=>{
  for(const change of[{ellipse_mask_identity:true},{evaluation_device:'GPU'},{ellipse_mask_source_profile:'unknown'},{ellipse_mask_precision:'HALF'},{ellipse_mask_boundary_model:'fused'},{ellipse_mask_row_model:'float-boundary'},{ellipse_mask_scalar_storage:'promoted'},{ellipse_mask_scalar_words:[0,0,0]},{ellipse_mask_position:[-0,.5]},{ellipse_mask_size:[.5,2**-17]},{ellipse_mask_export_extent:[1,4]}]){const a=op();Object.assign(a.properties,change);expect(()=>buildCompositorEllipseMask(a,[a],[],fail)).toThrow(/Ellipse Mask/)}
  const a=op();a.inputs.Mask={name:'Mask',socketType:'VALUE',value:{kind:'constant',type:'VALUE',value:0}};expect(()=>buildCompositorEllipseMask(a,[a],[],fail)).toThrow(/Ellipse Mask/)
  for(const kind of['blur','image-input','flip'])expect(()=>validateEllipseMaskGraph({...program(),ops:[op(),{...op(),id:'other',kind}]},fail)).toThrow(/pointwise/)
  const tooMany=Array.from({length:2},(_,i)=>({...op(),id:'ellipse-'+i}));expect(()=>validateEllipseMaskGraph({...program(),ops:tooMany},fail)).toThrow(/budget/)
 })
 it('keeps maximum row storage bounded and declines malformed extents/literals',()=>{expect(ellipseMaskRows(8192,8192,{...settings(),size:[1,1]}).byteLength).toBe(65536);for(const[w,h]of[[1,5],[5,1],[8193,5],[2.5,5]])expect(()=>ellipseMaskRows(w!,h!,settings())).toThrow(/extents/);expect(()=>ellipseMaskRows(5,5,{...settings(),position:[Math.PI,.5]})).toThrow(/literals/)})
 const archived=process.env.SCENETOWEB_ELLIPSE_CPU_REFERENCES
 it.skipIf(!archived)('cross-checks production row arithmetic against the archived prototype native outputs (not fresh qualification)',()=>{
  const root=resolve(archived!),native=JSON.parse(readFileSync(join(root,'native.json'),'utf8'));expect(native.status).toBe('ELLIPSE_NATIVE_CPU_RESEARCH_CAPTURED');expect(native.rows).toHaveLength(87)
  for(const c of native.rows){const rows=ellipseMaskRows(c.width,c.height,c.settings),values=ellipseMaskValues(c.settings),raw=readFileSync(join(root,c.file)),data=new Float32Array(raw.buffer,raw.byteOffset,raw.length/4);for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++){const v=!rows.length?c.settings.mask:(x>=rows[2*y]!&&x<=rows[2*y+1]!?values[0]:values[1]);for(let k=0;k<4;k++)expect(data[(y*c.width+x)*4+k]).toBe(k===3?1:v)}}
 })
})
