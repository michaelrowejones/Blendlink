import test from'node:test'
import assert from'node:assert/strict'
import{expectedOriginCases,words}from'./protocol.mjs'
test('sixoriginconditionsretainexactrawandpositivecarrierwords',()=>{const cases=expectedOriginCases();assert.equal(cases.length,6);assert.equal(new Set(cases.map(row=>row.case)).size,6);for(const row of cases){assert.deepEqual(words(row.rawTuple),row.normalize?[1056964608,0,0,1065353216]:[0,3212836864,0,1065353216]);assert.deepEqual(words(row.carrierTuple),row.normalize?[1056964608,1065353216,0,1065353216]:[0,0,0,1065353216])}})
