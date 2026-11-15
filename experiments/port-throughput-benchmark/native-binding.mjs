import assert from'node:assert/strict'
import{readFile,realpath}from'node:fs/promises'
import{dirname,join}from'node:path'
import{createHash}from'node:crypto'
const hash=b=>createHash('sha256').update(b).digest('hex')
export async function bindNativeReference(config){
 assert.match(config.nativeClosedReceiptSha256??'',/^[a-f0-9]{64}$/);const bytes=await readFile(config.nativeClosedReceiptFile);assert.equal(hash(bytes),config.nativeClosedReceiptSha256,'Independent closed receipt drift');const closed=JSON.parse(bytes)
 assert.equal(closed.status,'CLOSED_NATIVE_REFERENCE_RESEARCH');assert.equal(closed.nativeBackend,'METAL');assert.deepEqual(closed.nativeVersion,[5,3,0]);assert.equal(closed.nativeBuild,'02f0899d78e3');assert.equal(closed.consumedTargetCompilerOutput,false);assert.equal(closed.remainingBodyTokensUnchanged,true);assert.equal(closed.calibration.wordMismatches,0)
 const files=[config.nativeClosedReceiptFile],direct=closed.reports.direct
 for(const report of Object.values(closed.reports)){assert.equal(hash(await readFile(report.path)),report.sha256);files.push(report.path)}
 const report=JSON.parse(await readFile(direct.path));assert.equal(report.status,'CAPTURED_NATIVE_PRE_NAGA_KERNEL_F32');assert.equal(report.model,'Blender53-PythonGPU-original-lowered-GLSL-Metal-RGBA32F-v1');assert.equal(report.originalBodiesChanged,false);assert.equal(report.calibration.wordMismatches,0);assert.equal(report.calibration.cases,5);assert.equal(report.backend.backend,'METAL')
 const base=dirname(await realpath(direct.path)),bindings={}
 for(const kind of['input',...config.kinds]){const row=report.runs.find(r=>r.case===kind);assert.ok(row,'Independent native kind absent');assert.equal(row.words,256);const expected=await realpath(join(base,row.rawFile)),actual=await realpath(kind==='input'?config.nativeInputFile:config.referenceFiles[kind]);assert.equal(actual,expected,'Native input/kind source substitution');const raw=await readFile(actual);assert.equal(raw.length,1024);assert.equal(hash(raw),row.rawSha256,'Native closed raw bytes drift');bindings[kind]={path:actual,sha256:row.rawSha256};files.push(actual);const shader=join(base,row.shaderFile);assert.equal(hash(await readFile(shader)),row.shaderSha256);files.push(shader)}
 return{closedSha256:config.nativeClosedReceiptSha256,directReportSha256:direct.sha256,bindings,files:[...new Set(files)]}
}
