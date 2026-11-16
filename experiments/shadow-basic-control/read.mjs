// SPDX-License-Identifier: MIT
// Independent replay of immutable upstream-control readbacks; no browser/GPU.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
export async function readControl(directory){
 const sha=b=>createHash('sha256').update(b).digest('hex'),r=JSON.parse(await readFile(join(directory,'report.json')));
 assert.equal(r.supportCredit,0);assert.equal(r.producerSha256,sha(await readFile(join(directory,'producer.mjs'))));assert.deepEqual(r.errors,[]);assert.equal(r.rows.length,4);
 const diff=(a,b)=>{let n=0,max=0;for(let i=0;i<a.length;i+=4){if(a.readUInt32LE(i)!==b.readUInt32LE(i))n++;max=Math.max(max,Math.abs(a.readFloatLE(i)-b.readFloatLE(i)));}return{differentWords:n,maxAbs:max}};
 const keys=new Set();for(const row of r.rows){
  const key=row.backend+'/'+row.kind;assert.ok(!keys.has(key));keys.add(key);assert.ok(['webgpu','webgl2'].includes(row.backend));assert.ok(['basic','stock-glb'].includes(row.kind));assert.match(JSON.stringify(row.gpu),/Apple|Metal|apple/);assert.deepEqual(row.errors,[]);
  const fields={};for(const name of ['opaque','clear','repeat']){const f=row.fields[name],b=await readFile(join(directory,f.file));assert.equal(b.length,128*128*16);assert.equal(sha(b),f.sha256);fields[name]=b;}
  const delta=diff(fields.opaque,fields.clear),repeat=diff(fields.repeat,fields.opaque);assert.deepEqual(delta,row.opaqueVsClear);assert.deepEqual(repeat,row.repeatVsOpaque);assert.ok(delta.differentWords>100,key);assert.equal(repeat.differentWords,0,key);
 }
 assert.equal(r.status,'BASIC_AND_STOCK_GLB_SHADOW_CONTROLS_PASS');return{status:r.status,supportCredit:0,tuples:4,words:4*3*128*128*4};
}
if(process.argv[1]&&resolve(process.argv[1])===import.meta.filename)console.log(JSON.stringify(await readControl(resolve(process.argv[2]))));
