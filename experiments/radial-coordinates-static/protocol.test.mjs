import test from'node:test'
import assert from'node:assert/strict'
import{browserProofContract,expectedStaticCases,expectedFinalCases}from'./protocol.mjs'
test('closedstaticandFinalcensus',()=>{const cases=expectedStaticCases();assert.equal(cases.length,410);assert.equal(new Set(cases.map(row=>row.case)).size,410);assert.equal(expectedFinalCases().length,8);for(const row of cases)assert.equal(row.inputWords.slice(0,2).some(w=>w===0x80000000||0<(w&0x7fffffff)&&(w&0x7fffffff)<0x800000),false);assert.equal(browserProofContract.family,'radial-coordinates-static')})
