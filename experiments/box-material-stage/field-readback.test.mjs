import assert from'node:assert/strict'
import{test}from'node:test'
import{fieldReadback}from'./field-readback.mjs'
const w=16,h=8,rgba=fn=>{const b=Buffer.alloc(w*h*16);for(let y=0;y<h;y++)for(let x=0;x<w;x++)for(let c=0;c<4;c++)b.writeFloatLE(fn(x,y,c),(y*w+x)*16+c*4);return b},covered=(x,y)=>x>=2&&x<12&&y>=1&&y<6&&!(x>=8&&y>=4),native={mask:rgba((x,y,c)=>c===3?1:Number(covered(x,y))),color:rgba((x,y,c)=>c===3?1:covered(x,y)?(x+c+y*2)/64:0),mapping:rgba((x,y,c)=>c===3?1:covered(x,y)?.5+(x+c+y*2)/128:0)}
// Independent literal row inversion for fixture construction, not the production
// adapter. Both data and coverage are asymmetric and coordinates nonconstant.
const reverse=b=>{const out=Buffer.alloc(b.length);for(let y=0;y<h;y++)b.copy(out,y*w*16,(h-y-1)*w*16,(h-y)*w*16);return out}
const read=async(backend,bytes)=>fieldReadback({backend,rows:Object.keys(native).map(kind=>({id:'asymmetric',kind,width:w,height:h})),readRow:async row=>bytes[row.kind]})
for(const backend of['webgpu','webgl2'])test('actual visual+Mapping entry uses canonical fields once on '+backend,async()=>{const raw=Object.fromEntries(Object.entries(native).map(([k,b])=>[k,backend==='webgpu'?reverse(b):b])),reader=await read(backend,raw),result=reader.observe('asymmetric',w,h,native);assert.equal(reader.origin,'lower-left');assert.deepEqual(reader.field('asymmetric','color',w),native.color);assert.equal(result.geometry.xorPixels,0);assert.equal(result.display.violations,0);assert.equal(result.mappingSameValidCoverage.violations,0);assert.equal(result.mappingSameValidCoverage.maxAbs,0);assert.equal(result.proposalSatisfied,true);assert.throws(()=>reader.supporting('asymmetric','color',w),/Raw numeric field access is forbidden/)})
test('missing WebGPU adapter and extra/double inversion are discriminating through actual observation entry',async()=>{
 for(const[backend,raw]of[['webgpu',native],['webgl2',Object.fromEntries(Object.entries(native).map(([k,b])=>[k,reverse(b)]))],['webgpu',Object.fromEntries(Object.entries(native).map(([k,b])=>[k,reverse(reverse(b))]))]]){const result=(await read(backend,raw)).observe('asymmetric',w,h,native);assert.ok(result.geometry.xorPixels>0);assert.ok(result.display.violations>0);assert.ok(result.mappingSameValidCoverage.violations>0);assert.equal(result.proposalSatisfied,false)}
})
