// SPDX-License-Identifier: MIT
// Independent raw native-field diagnostics. This never promotes frame support.
import assert from 'node:assert/strict'
import{readFile,writeFile}from'node:fs/promises'
import{resolve,join}from'node:path'
import{createHash}from'node:crypto'
import{validateNativeArchive}from'../../scripts/lib/native-proof-archive.mjs'
const directory=resolve(process.argv[2]),output=resolve(process.argv[3]),root=resolve(import.meta.dirname,'../..'),sha=b=>createHash('sha256').update(b).digest('hex')
const archive=await validateNativeArchive(JSON.parse(await readFile(join(directory,'native-archive.json'))),directory,{expectedFinalSources:[],expectedScripts:[{path:join(import.meta.dirname,'prepare.py'),invocations:1}],helperInputs:{helper:join(root,'scripts/lib/node-port-python.mjs'),bridge:join(root,'scripts/node-port-blender.mjs')}})
const capture=join(directory,'capture'),reportBytes=await readFile(join(capture,'report.json')),report=JSON.parse(reportBytes)
assert.equal(report.status,'CAPTURED_NATIVE_NORMALMAP_DIAGNOSTIC_NOT_QUALIFICATION');assert.equal(report.renderCalls,32);assert.equal(report.sourceSaveCalls,0);assert.equal(report.sourceUnchanged,true);assert.equal(report.originalMeshBytesUnchanged,true);assert.equal(report.producerSha256,sha(await readFile(join(capture,'producer.py'))));assert.equal(report.nativeFixtureSha256,sha(await readFile(join(import.meta.dirname,'native_fixture.py'))));assert.equal(report.contractSha256,sha(await readFile(join(import.meta.dirname,'contract.json'))))
const kinds=['mask','geometry-normal','window-xy','T','B','N','mixed-lengths','mixed-signed'],rows=[]
for(const entry of report.rows){const bytes=await readFile(join(capture,entry.file));assert.equal(sha(bytes),entry.sha256);const m=JSON.parse(bytes);assert.equal(m.frame.rows.length,8);assert.deepEqual(m.frame.gpu,{backend:'METAL',vendor:'Apple M5 Pro',renderer:'Metal API'});const fields={}
 for(const row of m.frame.rows){assert.ok(kinds.includes(row.kind));const raw=await readFile(join(capture,row.file));assert.equal(sha(raw),row.sha256);assert.equal(raw.length,128*128*16);fields[row.kind]=raw}
 assert.deepEqual(Object.keys(fields),kinds)
 const covered=[];let nonBinaryMask=0,alphaNonOne=0,windowExactXYDifferences=0,windowMaximumAbsoluteError=0,windowFlippedMaximumAbsoluteError=0,windowQuadrantDisagreements=0
 for(let p=0;p<16384;p++){const o=p*16,v=fields.mask.readFloatLE(o);if(v===1)covered.push(p);else if(v!==0)nonBinaryMask++;assert.equal(fields.mask.readFloatLE(o+4),v);assert.equal(fields.mask.readFloatLE(o+8),v);if(fields.mask.readFloatLE(o+12)!==1)alphaNonOne++}
 assert.ok(covered.length>100);assert.equal(nonBinaryMask,0);assert.equal(alphaNonOne,0)
 const metrics={};for(const kind of kinds){const raw=fields[kind];let nonfinite=0,vsN=0,coveredAlphaNonOne=0;for(let i=0;i<raw.length;i+=4)if(!Number.isFinite(raw.readFloatLE(i)))nonfinite++;for(const p of covered){for(let lane=0;lane<3;lane++)if(raw.readUInt32LE(p*16+lane*4)!==fields.N.readUInt32LE(p*16+lane*4))vsN++;if(raw.readFloatLE(p*16+12)!==1)coveredAlphaNonOne++}metrics[kind]={nonfinite,coveredWordDifferencesVsN:vsN,coveredAlphaNonOne}}
 assert.equal(metrics['geometry-normal'].coveredWordDifferencesVsN,0);assert.equal(metrics['mixed-signed'].nonfinite,0)
 for(const p of covered){const x=p%128,y=Math.floor(p/128);for(let lane=0;lane<2;lane++){const actual=fields['window-xy'].readFloatLE(p*16+lane*4),expected=((lane?y:x)+.5)/128;if(actual!==expected)windowExactXYDifferences++;if((actual<.5)!==(expected<.5))windowQuadrantDisagreements++;windowMaximumAbsoluteError=Math.max(windowMaximumAbsoluteError,Math.abs(actual-expected));if(lane)windowFlippedMaximumAbsoluteError=Math.max(windowFlippedMaximumAbsoluteError,Math.abs(actual-(1-expected)))}}
 const uniqueBoundaryRGB=m.name==='zero-uv-normal-parallel'?[...new Set(covered.map(p=>[0,1,2].map(c=>fields.B.readFloatLE(p*16+c*4)).join(',')))]:undefined
 rows.push({name:m.name,coveredPixels:covered.length,nonBinaryMask,fields:metrics,window:{exactHalfCenterXYDifferences:windowExactXYDifferences,quadrantDisagreements:windowQuadrantDisagreements,maximumAbsoluteError:windowMaximumAbsoluteError,flippedYMaximumAbsoluteError:windowFlippedMaximumAbsoluteError,exactHalfCenterGate:windowExactXYDifferences?'FAILED_RETAINED_NO_CORRECTION':'PASSED'},...(uniqueBoundaryRGB?{undefinedPureBBoundaryObservedRGB:uniqueBoundaryRGB}:{}),qualificationCredit:0})
}
const result={status:'NATIVE_METAL_FIELDS_OBSERVED_DIAGNOSTIC_ONLY',sourceCommit:"53fe9122936071d757ebd1323a13039c953fed5d",reportSha256:sha(reportBytes),nativeArchive:archive,renders:32,sourcePreserved:true,rows,supportCredit:0,limits:['No browser comparison yet.','Window ideal half-center exact gate fails; differences retained without fitted correction.','Pure-B zero combination stays unqualified even when native EXR encoding is finite.','Observer ORIGINAL base is derived; authored Plaster DISPLACED equivalence requires independently unlinked Displacement. No copied authored enum/original-scene credit.']}
await writeFile(output,JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(result))
