// SPDX-License-Identifier: MIT
// Fixed-pixel diagnostic comparison; no fitting, alignment search or qualification.
import assert from 'node:assert/strict'
import{readFile,writeFile}from'node:fs/promises'
import{resolve,join}from'node:path'
import{createHash}from'node:crypto'
import{nativeRows,windowQuadrants}from'./fixed-origin.mjs'
const[nativeArg,browserArg,outputArg]=process.argv.slice(2),native=resolve(nativeArg,'capture'),browser=resolve(browserArg),sha=b=>createHash('sha256').update(b).digest('hex'),nrBytes=await readFile(join(native,'report.json')),nr=JSON.parse(nrBytes),br=JSON.parse(await readFile(join(browser,'browser.json')))
for(const[file,pin]of Object.entries(br.sourcePins))assert.equal(sha(await readFile(join(import.meta.dirname,file))),pin,'Frozen browser source changed: '+file);assert.equal(sha(await readFile(join(browser,'producer.mjs'))),br.producerSha256);
assert.equal(br.nativeReportSha256,sha(nrBytes));assert.equal(br.status,'CAPTURED_METAL_2API_FRAME_DIAGNOSTIC_NOT_QUALIFICATION');assert.equal(br.apis.length,2)
const rows=[]
for(const api of br.apis){assert.deepEqual(api.errors,[]);assert.deepEqual(api.pageErrors,[]);assert.match(JSON.stringify(api.gpu),/Apple|Metal|apple|metal/);assert.equal(api.rows.length,33)
 const calibration=api.rows.find(r=>r.kind==='storage-calibration'),cbytes=await readFile(join(browser,calibration.file));assert.equal(sha(cbytes),calibration.sha256);const expected=Buffer.from(new Float32Array([.125,.375,.625,1]).buffer);for(let i=0;i<cbytes.length;i++)assert.equal(cbytes[i],expected[i%16])
 for(const entry of nr.rows){const metadataBytes=await readFile(join(native,entry.file));assert.equal(sha(metadataBytes),entry.sha256);const m=JSON.parse(metadataBytes),nativeFields={},browserFields={},glbPins={};for(const ex of m.exports){const raw=await readFile(join(native,ex.file));assert.equal(sha(raw),ex.sha256);glbPins[ex.file]=ex.sha256}
  for(const row of m.frame.rows){const b=await readFile(join(native,row.file));assert.equal(sha(b),row.sha256);nativeFields[row.kind]=b}
  const browserRows=api.rows.filter(r=>r.name===m.name);assert.equal(browserRows.length,8)
  for(const row of browserRows){for(const[name,pin]of Object.entries(m.attributes))assert.equal(row.attributeHashes[name].sourceLoopOrder,pin.sha256);const b=await readFile(join(browser,row.file));assert.equal(sha(b),row.sha256);browserFields[row.kind]=nativeRows(b,api.backend)}
  let maskWords=0,sharedPixels=0,windowQuadrantErrors=0,windowWrongOriginQuadrants=0
  for(let p=0;p<16384;p++){for(let c=0;c<4;c++)if(nativeFields.mask.readUInt32LE(p*16+c*4)!==browserFields.mask.readUInt32LE(p*16+c*4))maskWords++;const covered=browserFields.mask.readFloatLE(p*16)===1;if(covered&&nativeFields.mask.readFloatLE(p*16)===1)sharedPixels++}
  const quadrantMetrics=windowQuadrants(browserFields['window-xy'],browserFields.mask);windowQuadrantErrors=quadrantMetrics.disagreements;windowWrongOriginQuadrants=quadrantMetrics.wrongOriginDisagreements
  assert.equal(windowQuadrantErrors,0,'Independent fixed-origin quadrant calibration failed');assert.ok(windowWrongOriginQuadrants>100,'Wrong-origin negative did not discriminate')
  const fields={};for(const kind of Object.keys(nativeFields)){const a=nativeFields[kind],b=browserFields[kind];let words=0,violations=0,max=0,sharedViolations=0,sharedMax=0,nonfinite=0,nonfiniteClassMismatches=0,alphaWordDifferences=0,nonfiniteClasses={};for(let i=0;i<a.length;i+=4){const av=a.readFloatLE(i),bv=b.readFloatLE(i);if(a.readUInt32LE(i)!==b.readUInt32LE(i))words++;if(i%16===12&&a.readUInt32LE(i)!==b.readUInt32LE(i))alphaWordDifferences++;if(!Number.isFinite(av)||!Number.isFinite(bv)){nonfinite++;const cls=v=>Number.isNaN(v)?'NaN':v===Infinity?'+Inf':v===-Infinity?'-Inf':'finite';const label=cls(av)+'->'+cls(bv);nonfiniteClasses[label]=(nonfiniteClasses[label]??0)+1;if(cls(av)!==cls(bv))nonfiniteClassMismatches++;continue}const d=Math.abs(av-bv);max=Math.max(max,d);if(d>2**-10)violations++;const p=Math.floor(i/16);if(nativeFields.mask.readFloatLE(p*16)===1&&browserFields.mask.readFloatLE(p*16)===1){sharedMax=Math.max(sharedMax,d);if(d>2**-10)sharedViolations++}}
   fields[kind]={wordDifferences:words,maxAbsoluteError:max,absoluteGateViolations:violations,sharedCoveredMaxAbsoluteError:sharedMax,sharedCoveredViolations:sharedViolations,nonfiniteWords:nonfinite,nonfiniteClasses,nonfiniteClassMismatches,alphaWordDifferences,diagnosticGate:kind==='B'&&m.name!=='seam'?'UNQUALIFIED_PURE_B_BOUNDARY':maskWords?'FAILED_EXACT_MASK':nonfinite?'REFUSED_NONFINITE_POSITIVE':violations||alphaWordDifferences?'FAILED_FIXED_FIELD_GATE':'PASSED_FINITE_DIAGNOSTIC_ONLY',gateScope:kind==='B'&&m.name!=='seam'?'PARALLEL_PURE_B_BOUNDARY_DIAGNOSTIC_NO_POSITIVE_CREDIT':'unchanged 2^-10 diagnostic bound; any mask failure remains separate'}
  }
  rows.push({backend:api.backend,name:m.name,glbPins,maskWordDifferences:maskWords,sharedCoveredPixels:sharedPixels,windowQuadrantDisagreements:windowQuadrantErrors,wrongOriginNegativeDisagreements:windowWrongOriginQuadrants,fields,qualificationCredit:0})
 }
}
const result={status:'FIXED_PIXEL_FRAME_DIAGNOSTICS_COMPARED_NOT_QUALIFICATION',supportCredit:0,originPolicy:'WebGL2 raw bottom-left; WebGPU fixed whole-row reverse from top-left to native bottom-left. Independent asymmetric Window XY quadrants required; no fitted offset or flips.',rows,limits:['Shared-coverage metrics are diagnostic; mask failures remain failures.','Parallel/zero pure B remains unqualified regardless of finite carrier pixels.','No source guard or tolerance change and no original scene/image composition support.']}
await writeFile(resolve(outputArg),JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(result))
