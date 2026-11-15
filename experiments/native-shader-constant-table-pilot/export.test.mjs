import test from 'node:test'
import assert from 'node:assert/strict'
import {buildTable,hash,requireProfile} from './export.mjs'
function packet(){
 const raw=Buffer.alloc(32),comparisons=[]
 for(let i=0;i<2;i++){for(let lane=0;lane<3;lane++){raw.writeFloatLE(100+i+lane,i*16+lane*4);comparisons.push({seed:i+3,lane,nativeOffsetWord:raw.readUInt32LE(i*16+lane*4)})}raw.writeFloatLE(1,i*16+12)}
 const library='1'.repeat(64),report={seeds:[3,4],lanes:[0,1,2],nativeVersion:[5,3,0],nativeBuild:'02f0899d78e3',backend:{backend:'METAL',vendor:'synthetic-test-only'},calibration:{wordMismatches:0},nativeLibrarySha256:library,rows:['literal','uniform'].map(source=>({source,stage:'offset',sha256:hash(raw)}))},reportBytes=Buffer.from(JSON.stringify(report))
 const closed={status:'CLOSED_NATIVE_NOISE_OFFSET_DIAGNOSTIC',pins:{report:{sha256:hash(reportBytes)},nativeLibrarySha256:library},comparisons,...Object.fromEntries(['literalUniformWordDifferences','hashSplitWordDifferences','uintRneWordDifferences','unitRneWordDifferences','nativeOffsetVsExplicitFmaDifferences'].map(k=>[k,0]))},closedBytes=Buffer.from(JSON.stringify(closed))
 return{closedBytes,expectedClosedSha256:hash(closedBytes),reportBytes,literalBytes:Buffer.from(raw),uniformBytes:Buffer.from(raw)}
}
test('source-static constants preserve every raw word without runtime math',()=>{
 const p=packet(),t=buildTable(p);assert.equal(t.perFragmentEvaluation,false);assert.equal(t.productionRuntimeChanges,false);for(let i=0;i<2;i++)for(let j=0;j<3;j++)assert.equal(t.table[i].words[j],p.literalBytes.readUInt32LE(i*16+j*4));requireProfile(t,structuredClone(t.profile));assert.throws(()=>requireProfile(t,{...t.profile,nativeBuild:'different'}))
})
test('authority, raw words, metadata and calibration mutations fail closed',()=>{
 let p=packet();p.literalBytes[0]^=1;assert.throws(()=>buildTable(p))
 p=packet();p.expectedClosedSha256='0'.repeat(64);assert.throws(()=>buildTable(p))
 p=packet();const c=JSON.parse(p.closedBytes);c.comparisons[0].nativeOffsetWord++;p.closedBytes=Buffer.from(JSON.stringify(c));p.expectedClosedSha256=hash(p.closedBytes);assert.throws(()=>buildTable(p))
 p=packet();const r=JSON.parse(p.reportBytes);r.calibration.wordMismatches=1;p.reportBytes=Buffer.from(JSON.stringify(r));assert.throws(()=>buildTable(p))
})
