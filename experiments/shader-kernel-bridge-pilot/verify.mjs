import assert from 'node:assert/strict';
import {readFile,writeFile,realpath,lstat}from'node:fs/promises';
import{resolve,join,sep}from'node:path';
import{createHash}from'node:crypto';
import{expected,number,word}from'./oracle.mjs';
const [generatedArg,metalArg,softwareArg,outArg]=process.argv.slice(2);assert.ok(outArg);
const hash=raw=>createHash('sha256').update(raw).digest('hex');
const generated=await realpath(generatedArg),generationRaw=await readFile(join(generated,'generation.json')),generation=JSON.parse(generationRaw);
assert.equal(generation.status,'CANONICAL_LOWERING_AND_NAGA_VALIDATION_PASSED');
assert.equal(hash(await readFile(join(generated,'modules.json'))),generation.modulesSha256);
for(const[path,sha]of Object.entries(generation.sources))assert.equal(hash(await readFile(path)),sha,path);
const contract=JSON.parse(await readFile(new URL('./contract.json',import.meta.url),'utf8'));
const result={schemaVersion:1,status:'RESEARCH_GATES_PASSED',supportCredit:0,nativeBlenderParityCredit:0,finalExports:0,generationSha256:hash(generationRaw),profiles:[],words:0,calibrationExactMismatches:0,analyticExactMismatches:0,analyticFloatViolations:0,translationWordDifferences:0,maximumAbsoluteError:0,maximumUlps:0,limits:contract};
for(const [directory,profile]of [[metalArg,'metal'],[softwareArg,'software']]){
 const root=await realpath(directory),raw=await readFile(join(root,'report.json')),report=JSON.parse(raw);
 assert.equal(report.status,'COMPILER_THREE_CAPTURE_COMPLETE');assert.equal(report.profile,profile);assert.deepEqual(report.contract,contract);
 assert.equal(report.modulesSha256,generation.modulesSha256);assert.equal(report.generationSha256,hash(generationRaw));
 for(const[path,sha]of Object.entries(report.pins))assert.equal(hash(await readFile(path)),sha,path);
 assert.deepEqual(report.rows.map(r=>r.backend),contract.apis);
 const profileResult={profile,reportSha256:hash(raw),apis:[],translationWordDifferences:0};
 const arrays=[];
 for(const api of report.rows){
  assert.equal(api.status,'COMPILED_AND_DRAWN');assert.deepEqual(api.errors,[]);assert.deepEqual(api.pageErrors,[]);
  if(profile==='metal'){assert.match(JSON.stringify(api.gpu),/apple|metal/i);assert.doesNotMatch(JSON.stringify(api.gpu),/swiftshader/i);}else assert.match(JSON.stringify(api.gpu),/swiftshader/i);
  assert.deepEqual(api.rows.map(r=>r.case),contract.caseIds);
  const samples=[];
  for(const row of api.rows){
   assert.equal(row.status,'compiled-and-drawn');assert.equal(row.remainingTextures,0);assert.equal(row.remainingRenderTargets,0);
   assert.ok(row.compileMs>=0&&row.compileMs<=contract.limits.maximumCompileMsPerCase);
   for(const field of ['vertexShader','fragmentShader','words']){
    const a=row[field+'Archive'],path=resolve(root,a.file);assert.ok(path.startsWith(root+sep));assert.ok((await lstat(path)).isFile());assert.equal(await realpath(path),path);
    const bytes=await readFile(path);assert.equal(bytes.length,a.bytes);assert.equal(hash(bytes),a.sha256);
    if(field==='fragmentShader')assert.equal(bytes.length,row.fragmentBytes);
    if(field==='words'){assert.equal(bytes.length,1024);samples.push([...new Uint32Array(bytes.buffer,bytes.byteOffset,256)]);}
   }
  }
  const control=samples[0],grid=samples[1],flip=number(control[1])>0;
  // Preserve the exact calibration gate. A failed calibration still permits
  // diagnostic evaluation against captured inputs, but grants no numerical credit.
  // Determine physical row orientation only from a known independent UV control.
  let calibrationExactMismatches=0;
  for(let y=0;y<8;y++)for(let x=0;x<8;x++){
   const yy=flip?7-y:y,u=(x+.5)/8,v=(yy+.5)/8,i=(y*8+x)*4;
   for(const [got,want]of [[control.slice(i,i+4),[u*4-2,v*4-2,u+v-1,u*2-.75].map(word)],[grid.slice(i,i+4),[x-4,yy-4,0,u*2-.75].map(word)]])for(let c=0;c<4;c++)if(got[c]!==want[c])calibrationExactMismatches++;
  }
  result.calibrationExactMismatches+=calibrationExactMismatches;
  const summary={backend:api.backend,gpu:api.gpu,flip,calibrationExactMismatches,analyticOutputsAreDiagnosticOnly:calibrationExactMismatches!==0,rows:[],maximumShaderBytes:Math.max(...api.rows.map(r=>r.fragmentBytes))};
  for(let k=2;k<samples.length;k++){
   const id=contract.caseIds[k],discrete=id.startsWith('checker')||id==='hash-words',row={case:id,words:256,wordDifferences:0,violations:0,maxAbs:0,maxUlps:0};
   for(let i=0;i<256;i+=4){
    const input=(id==='checker-grid-boundaries'?grid:control).slice(i,i+4).map(number),want=expected(id,input).map(word);
    for(let c=0;c<4;c++){
     const actualWord=samples[k][i+c],e=number(want[c]),a=number(actualWord),abs=Math.abs(a-e),ulps=Math.abs(actualWord-want[c]);
     assert.ok(Number.isFinite(a)&&Number.isFinite(e));row.maxAbs=Math.max(row.maxAbs,abs);row.maxUlps=Math.max(row.maxUlps,ulps);
     if(actualWord!==want[c])row.wordDifferences++;
     if(discrete?actualWord!==want[c]:abs>contract.analyticFloatGate.maximumAbsoluteError||ulps>contract.analyticFloatGate.maximumUlps)row.violations++;
    }
   }
   result.words+=row.words;result.maximumAbsoluteError=Math.max(result.maximumAbsoluteError,row.maxAbs);result.maximumUlps=Math.max(result.maximumUlps,row.maxUlps);
   result[discrete?'analyticExactMismatches':'analyticFloatViolations']+=row.violations;summary.rows.push(row);
  }
  const canonical=samples.map(a=>{const copy=[];for(let y=0;y<8;y++)copy.push(...a.slice((flip?7-y:y)*32,(flip?8-y:y+1)*32));return copy;});arrays.push(canonical);
  summary.compileMs=api.rows.reduce((s,r)=>s+r.compileMs,0);summary.drawSubmissionMs=api.rows.reduce((s,r)=>s+r.drawSubmissionMs,0);summary.readbackMs=api.rows.reduce((s,r)=>s+r.readbackMs,0);profileResult.apis.push(summary);
 }
 for(let k=2;k<contract.caseIds.length;k++)for(let i=0;i<256;i++)if(arrays[0][k][i]!==arrays[1][k][i])profileResult.translationWordDifferences++;
 result.translationWordDifferences+=profileResult.translationWordDifferences;result.profiles.push(profileResult);
}
if(result.calibrationExactMismatches||result.analyticExactMismatches||result.analyticFloatViolations)result.status='RESEARCH_GATES_FAILED_ZERO_CREDIT';
await writeFile(resolve(outArg),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({status:result.status,words:result.words,calibrationExactMismatches:result.calibrationExactMismatches,analyticExactMismatches:result.analyticExactMismatches,analyticFloatViolations:result.analyticFloatViolations,translationWordDifferences:result.translationWordDifferences,maximumAbsoluteError:result.maximumAbsoluteError,maximumUlps:result.maximumUlps}));
if(result.status!=='RESEARCH_GATES_PASSED')process.exitCode=1;
