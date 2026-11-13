import assert from 'node:assert/strict'
export function assertSqueezeBackend(row,requested){
 assert.ok(['webgpu','webgl2'].includes(requested))
 assert.equal(row.backend,requested,'A requested browser API cannot silently fall back')
 assert.equal(row.gpu?.api,requested==='webgpu'?'WebGPU':'WebGL2')
}
export function assertSqueezeApiSet(rows){
 assert.equal(rows.length,2);assert.deepEqual(rows.map(row=>row.backend).sort(),['webgl2','webgpu'])
 for(const row of rows)assertSqueezeBackend(row,row.backend)
}
export function assertSqueezeLinuxCanary({suite,references,reports}){
 assert.equal(suite.status,'passed','Source N/A cannot qualify the production canary')
 assert.equal(suite.productionCases,25)
 assert.deepEqual(references.version,[5,2,0]);assert.equal(references.build,'fbe6228777e7')
 assert.equal(references.backend.backend,'OPENGL')
 assert.equal(references.backend.renderer,'llvmpipe (LLVM 20.1.2, 256 bits)')
 assert.equal(references.sourcePreserved,true)
 assert.equal(references.cases.length,26)
 const ids=references.cases.map(row=>row.id).sort();assert.equal(new Set(ids).size,26)
 assert.equal(ids.filter(id=>id==='calibration').length,1)
 assert.deepEqual(Object.keys(reports).sort(),['final','raw'])
 for(const report of Object.values(reports)){
  assert.equal(report.status,'passed');assert.equal(report.built,true)
  assertSqueezeApiSet(report.rows)
  for(const row of report.rows){
   assert.match(JSON.stringify(row.gpu),/swiftshader/i)
   assert.deepEqual(row.failures,[]);assert.deepEqual(row.pageErrors,[])
   assert.deepEqual(row.rows.map(item=>item.id).sort(),ids)
   for(const item of row.rows){
    assert.equal(item.remainingTextures,0)
    assert.ok(Number.isFinite(item.max)&&item.max>=0&&item.max<=2e-5)
   }
  }
 }
}
export function assertSqueezeSourceNA(packet,fixtureSha256){
 assert.deepEqual(Object.keys(packet).sort(),['status','version','productionCases','reason','fixtureSha256','nativeResearchRetained'].sort())
 assert.equal(packet.status,'SOURCE_ATTESTATION_NA');assert.equal(packet.productionCases,0)
 assert.ok(Array.isArray(packet.version)&&packet.version.length===3&&[0,1,2].every(index=>Object.hasOwn(packet.version,index)&&typeof packet.version[index]==='number'&&Number.isInteger(packet.version[index]))&&['4.2.0','5.2.0','5.3.0'].includes(packet.version.join('.')))
 assert.equal(packet.fixtureSha256,fixtureSha256)
 assert.ok(['Squeeze Value source attestation is N/A','Squeeze Value has no verified live source profile','Squeeze Value requires actual native GPU backend attestation','Squeeze Value has no verified live source precision profile for actual GPU backend'].some(prefix=>packet.reason?.startsWith(prefix)))
 assert.equal(packet.nativeResearchRetained,'native_probe.py supports the actual native function independently')
}
