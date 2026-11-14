import test from 'node:test'
import assert from 'node:assert/strict'
import {axisWords,ExactAxisTable} from './axis-table.mjs'
test('axis table is O(W+H), <=64 KiB and exactly follows native rational words',()=>{
 for(const [width,height]of [[13,9],[9,13],[16,8],[8192,4],[4,8192]]){
  const data=axisWords(width,height),maximum=Math.max(width,height);assert.equal(data.byteLength,maximum*8);assert.ok(data.byteLength<=65536)
  for(const [row,size]of [[0,width],[1,height]])for(let i=0;i<size;i++)assert.equal(data[row*maximum+i],Math.fround(Math.fround(Math.fround(i+.5)-size/2)/maximum)*2)
 }
})
test('invalid extents and combined binding count refuse before allocation',()=>{
 for(const args of [[3,4],[4,8193],[4.5,8],[NaN,8]])assert.throws(()=>axisWords(...args),/Exact axis table/)
 for(const existingSamplers of [-1,8,NaN,1.5])assert.throws(()=>new ExactAxisTable({existingSamplers}),/sampler budget/)
 const table=new ExactAxisTable({existingSamplers:7});assert.equal(table.statistics.rebuilds,0);table.dispose();table.dispose();assert.equal(table.statistics.disposals,1);assert.throws(()=>table.node,/disposed/)
})
