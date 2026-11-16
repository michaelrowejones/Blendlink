import assert from'node:assert/strict'
import test from'node:test'
import{nativeRows,windowQuadrants}from'./fixed-origin.mjs'
test('fixed API adapters retain asymmetric native quadrants and reject inverted origin',()=>{
 const width=8,height=6,mask=Buffer.alloc(width*height*16),field=Buffer.alloc(mask.length)
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){const p=(y*width+x)*16;for(let c=0;c<4;c++)mask.writeFloatLE(1,p+c*4);field.writeFloatLE((x+.5)/width,p);field.writeFloatLE((y+.5)/height,p+4);field.writeFloatLE(.125,p+8);field.writeFloatLE(1,p+12)}
 const topLeft=nativeRows(field,'webgpu',width,height)
 for(const[backend,input]of[['webgpu',topLeft],['webgl2',field]]){const fixed=nativeRows(input,backend,width,height);assert.deepEqual(fixed,field);const q=windowQuadrants(fixed,mask,width,height);assert.equal(q.disagreements,0);assert.equal(q.wrongOriginDisagreements,width*height)}
 assert.equal(windowQuadrants(topLeft,mask,width,height).disagreements,width*height)
 assert.throws(()=>nativeRows(field,'unknown',width,height))
})
