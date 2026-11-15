// SPDX-License-Identifier: MIT
// Export source-static native observations once; never generate a per-fragment fix.
import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
import {dirname,join,resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import {createHash} from 'node:crypto'
export const hash=b=>createHash('sha256').update(b).digest('hex')
export function buildTable({closedBytes,expectedClosedSha256,reportBytes,literalBytes,uniformBytes}){
 assert.match(expectedClosedSha256,/^[a-f0-9]{64}$/);assert.equal(hash(closedBytes),expectedClosedSha256,'Closed native authority drift')
 const c=JSON.parse(closedBytes),r=JSON.parse(reportBytes)
 assert.equal(c.status,'CLOSED_NATIVE_NOISE_OFFSET_DIAGNOSTIC');assert.equal(hash(reportBytes),c.pins.report.sha256)
 for(const name of ['literalUniformWordDifferences','hashSplitWordDifferences','uintRneWordDifferences','unitRneWordDifferences','nativeOffsetVsExplicitFmaDifferences'])assert.equal(c[name],0)
 assert.deepEqual(r.seeds,[3,4]);assert.deepEqual(r.lanes,[0,1,2]);assert.deepEqual(r.nativeVersion,[5,3,0]);assert.equal(r.nativeBuild,'02f0899d78e3');assert.equal(r.backend.backend,'METAL');assert.equal(r.calibration.wordMismatches,0)
 assert.equal(r.nativeLibrarySha256,c.pins.nativeLibrarySha256)
 assert.equal(c.comparisons.length,6)
 const table=[]
 for(const[source,bytes]of [['literal',literalBytes],['uniform',uniformBytes]]){
  const rows=r.rows.filter(row=>row.source===source&&row.stage==='offset');assert.equal(rows.length,1);assert.equal(bytes.length,32);assert.equal(hash(bytes),rows[0].sha256)
 }
 assert.deepEqual(literalBytes,uniformBytes)
 for(let pixel=0;pixel<2;pixel++){
  assert.equal(literalBytes.readUInt32LE(pixel*16+12),0x3f800000)
  const words=[],values=[]
  for(let lane=0;lane<3;lane++){
   const rows=c.comparisons.filter(x=>x.seed===r.seeds[pixel]&&x.lane===lane);assert.equal(rows.length,1)
   const word=literalBytes.readUInt32LE(pixel*16+lane*4),value=literalBytes.readFloatLE(pixel*16+lane*4)
   assert.equal(word,rows[0].nativeOffsetWord);assert.ok(Number.isFinite(value)&&value>=100&&value<=200)
   words.push(word);values.push(value)
  }table.push({seed:r.seeds[pixel],words,values})
 }
 return{schemaVersion:1,kind:'research-native-shader-helper-constants',supportCredit:0,productionRuntimeChanges:false,perFragmentEvaluation:false,helper:'random_vec3_offset',profile:{nativeVersion:r.nativeVersion,nativeBuild:r.nativeBuild,backend:r.backend.backend,vendor:r.backend.vendor,nativeLibrarySha256:r.nativeLibrarySha256},closedSha256:expectedClosedSha256,reportSha256:hash(reportBytes),table,license:'Native Blender source-derived observations; preserve source GPL-2.0-or-later attribution when distributing derivatives',limits:'Only six captured components for seeds3/4 in this native profile. No shader rewrite or general constant-folder qualification.'}
}
export function requireProfile(table,profile){assert.deepEqual(profile,table.profile,'Rebuild native constants for a changed source/backend profile');return table.table}
export async function exportTable(closedPath,expectedClosedSha256){
 const closedBytes=await readFile(closedPath);assert.equal(hash(closedBytes),expectedClosedSha256,'Closed native authority drift')
 const closed=JSON.parse(closedBytes),reportBytes=await readFile(closed.pins.report.path),report=JSON.parse(reportBytes),root=dirname(closed.pins.report.path)
 const offset=source=>{const rows=report.rows.filter(r=>r.source===source&&r.stage==='offset');assert.equal(rows.length,1);assert.equal(rows[0].file,source+'-offset.rgba32f');return readFile(join(root,rows[0].file))}
 return buildTable({closedBytes,expectedClosedSha256,reportBytes,literalBytes:await offset('literal'),uniformBytes:await offset('uniform')})
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const [closed,sha,out,...extra]=process.argv.slice(2);assert.ok(out&&!extra.length,'Usage: export.mjs CLOSED_NATIVE_RECEIPT EXPECTED_SHA NEW_TABLE')
 const table=await exportTable(closed,sha);await writeFile(out,JSON.stringify(table,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({rows:table.table.length,components:6,perFragmentEvaluation:false,supportCredit:0}))
}
