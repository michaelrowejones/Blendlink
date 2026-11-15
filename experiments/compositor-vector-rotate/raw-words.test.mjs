/* SPDX-License-Identifier: MIT */
import assert from 'node:assert/strict'
import test from 'node:test'
import {takeRawWords} from './raw-words.mjs'
test('normal frame serialization retains the exact numeric comparison count',()=>{
 const sample={frame:0,words:4,wordDifferences:0,rawWords:[0,1,0x80000000,0xffffffff]}
 assert.deepEqual(takeRawWords(sample),[0,1,0x80000000,0xffffffff]);assert.deepEqual(sample,{frame:0,words:4,wordDifferences:0})
})
test('failure capture removes only the raw array and preserves comparison diagnostics',()=>{
 const sample={label:'failure',words:[1,2],wordDifferences:1,first:{index:0}}
 assert.deepEqual(takeRawWords(sample),[1,2]);assert.deepEqual(sample,{label:'failure',wordDifferences:1,first:{index:0}})
})
test('missing or malformed arrays cannot silently masquerade as a sample',()=>{
 assert.equal(takeRawWords({words:4}),undefined)
 for(const rawWords of[[NaN],[-1],[0x100000000],[1.5],new Array(1)])assert.throws(()=>takeRawWords({words:1,rawWords}),/invalid/)
})
