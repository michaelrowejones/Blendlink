import assert from'node:assert/strict'
const pin=value=>assert.match(value??'',/^[a-f0-9]{64}$/)
export function assertCarrierBrowserReport(report){
 assert.equal(report.status,'PASSED_CYCLES_NORMAL_CARRIER_BROWSER');assert.equal(report.provenance.mode,'built');assert.equal(report.provenance.snapshot.mode,'built');assert.ok(report.provenance.compilerAttestation.sourceFiles.length>0);assert.ok(report.provenance.compilerAttestation.operations.length>0)
 assert.deepEqual(Object.keys(report.provenance.fixturePins).sort(),['browser.js','index.html']);Object.values(report.provenance.fixturePins).forEach(pin);pin(report.provenance.runnerSha256);pin(report.provenance.protocolSha256)
 assert.ok(Array.isArray(report.provenance.snapshot.vendorFiles)&&report.provenance.snapshot.vendorFiles.length>0);assert.equal(report.closure.independentlyEmittedAtClose,true);pin(report.closure.runtimeFingerprint);pin(report.closure.archiveHelperSha256)
 assert.equal(report.missingAdapter.refused,true);assert.match(report.missingAdapter.error,/actual WebGPU adapter/)
 assert.deepEqual(report.sources.map(row=>row.coat),[false,true]);for(const row of report.sources){assert.ok(typeof row.captureDirectory==='string'&&row.captureDirectory.length>0);pin(row.captureManifestSha256);pin(row.nativeReportSha256);pin(row.glbSha256);pin(row.materialProgramSha256);assert.equal(row.texCoord,1);assert.deepEqual(Object.keys(row.normalHashes).sort(),row.coat?['Coat Normal','Normal']:['Normal']);Object.values(row.normalHashes).forEach(pin)}
 assert.deepEqual(report.rows.map(row=>row.backend).sort(),['webgl2','webgpu'])
 for(const api of report.rows){assert.equal(api.gpu.api,api.backend==='webgpu'?'WebGPU':'WebGL2');assert.deepEqual(api.errors,[]);assert.deepEqual(api.rows.map(row=>row.case),report.sources.map(row=>row.name))
  for(let index=0;index<api.rows.length;index++){const row=api.rows[index];assert.equal(row.sourceRestored,true);assert.equal(row.normalCarrierRetained,true);assert.ok(row.installed>0);assert.deepEqual(row.channels.map(channel=>channel.channel),report.sources[index].coat?['Normal','Coat Normal']:['Normal']);for(const channel of row.channels){assert.ok(channel.visiblePixels>=20);pin(channel.sha256)}if(report.sources[index].coat)assert.notEqual(row.channels[0].sha256,row.channels[1].sha256)}
 }
 return report
}
