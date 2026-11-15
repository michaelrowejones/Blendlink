import assert from'node:assert/strict';
import{readFile,writeFile,realpath,lstat}from'node:fs/promises';
import{join,resolve,sep}from'node:path';
import{createHash}from'node:crypto';
import{hashWords,word}from'../shader-kernel-bridge-pilot/oracle.mjs';
const[nArg,bArg,outArg]=process.argv.slice(2);assert.ok(outArg);const hash=b=>createHash('sha256').update(b).digest('hex');
const nativeRoot=await realpath(nArg),browserRoot=await realpath(bArg),nRaw=await readFile(join(nativeRoot,'report.json')),bRaw=await readFile(join(browserRoot,'report.json')),native=JSON.parse(nRaw),browser=JSON.parse(bRaw);
const owned=async(root,file,sha)=>{const p=resolve(root,file);assert.ok(p.startsWith(root+sep));assert.equal(await realpath(p),p);assert.ok((await lstat(p)).isFile());const b=await readFile(p);assert.equal(hash(b),sha);return b;};
const words=b=>{assert.equal(b.length,32);return[...new Uint32Array(b.buffer,b.byteOffset,8)];};
const expected={};for(const seed of[3,4])expected[seed]=[0,1,2].map(lane=>{
 const integer=hashWords([word(seed),word(lane)]),unit=Math.fround(Math.fround(integer)/2**32),separate=Math.fround(100+Math.fround(unit*100)),fused=Math.fround(100+unit*100);
 // Binary64 represents these six products/sums exactly before the final f32
 // rounding: at most 31 product significand bits, bounded positive exponents.
 return{lane,integer,uintFloat:word(Math.fround(integer)),unit:word(unit),separate:word(separate),fused:word(fused)};
});
assert.deepEqual(native.seeds,[3,4]);assert.deepEqual(native.extent,[2,1]);assert.equal(native.draws,19);
assert.equal(native.status,'CAPTURED_NATIVE_NOISE_OFFSET_DIAGNOSTIC');assert.equal(native.nativeBuild,'02f0899d78e3');assert.deepEqual(native.nativeVersion,[5,3,0]);assert.equal(native.backend.backend,'METAL');
assert.deepEqual(native.rows.map(r=>r.source+'/'+r.stage),['literal','uniform'].flatMap(m=>['seed-control','hash-low','hash-high','uint-float','unit','offset','fma'].map(p=>m+'/'+p)));
for(const[path,pin]of Object.entries(native.generationSourcePins))assert.equal(hash(await readFile(path)),pin,path);
assert.equal(browser.status,'OFFSET_DIAGNOSTIC_CAPTURE_COMPLETE');assert.equal(browser.profile,'metal');
for(const[path,pin]of Object.entries(browser.pins))assert.equal(hash(await readFile(path)),pin,path);
const n={};
for(const row of native.rows){n[row.source+'-'+row.stage]=words(await owned(nativeRoot,row.file,row.sha256));await owned(nativeRoot,row.shader,row.shaderSha256);}
const result={schemaVersion:1,status:'EXACT_STAGE_DIAGNOSTIC_RECORDED',supportCredit:0,FinalCredit:0,nativeReportSha256:hash(nRaw),browserReportSha256:hash(bRaw),expected,sourceControlsExact:true,validatedFmaInputs:6,sourceHypothesis:'Target literal constant evaluation uses separate rounding; native and target uniform evaluation contract multiply-add.',profiles:[],native:[],browserDraws:0,archivedBrowserWords:0};
for(const mode of['literal','uniform']){
 assert.deepEqual(n[mode+'-seed-control'],[3,0,0,1,4,0,0,1].map(word));
 for(let s=0;s<2;s++)for(let lane=0;lane<3;lane++){
  const e=expected[s+3][lane],i=s*4+lane;
  assert.equal(n[mode+'-hash-low'][i],word(e.integer&65535));assert.equal(n[mode+'-hash-high'][i],word(e.integer>>>16));
  assert.equal(n[mode+'-uint-float'][i],e.uintFloat);assert.equal(n[mode+'-unit'][i],e.unit);
  assert.equal(n[mode+'-fma'][i],e.fused);
 }
 result.native.push({mode,offsetWords:n[mode+'-offset'],fmaWords:n[mode+'-fma'],allOffsetEqualsFma:n[mode+'-offset'].every((w,i)=>w===n[mode+'-fma'][i])});
}
const planes=['seed','hash-low','hash-high','uint-float','unit','offset','fma','unit-rne','fma-rne','separate'];
assert.deepEqual(browser.rows.map(r=>r.backend),['webgpu','webgl2']);
for(const api of browser.rows){
 assert.equal(api.status,'OFFSET_STAGES_CAPTURED');assert.deepEqual(api.errors,[]);assert.deepEqual(api.pageErrors,[]);assert.match(JSON.stringify(api.gpu),/apple|metal/i);assert.doesNotMatch(JSON.stringify(api.gpu),/swiftshader/i);
 assert.deepEqual(api.rows.map(r=>r.mode+'/'+r.plane),['literal','uniform'].flatMap(m=>planes.map(p=>m+'/'+p)));
 const captures={};for(const row of api.rows){
  assert.equal(row.status,'captured');assert.equal(row.remainingTextures,0);
  captures[row.mode+'-'+row.plane]=words(await owned(browserRoot,row.wordsArchive.file,row.wordsArchive.sha256));
  for(const f of['fragmentShader','vertexShader'])await owned(browserRoot,row[f+'Archive'].file,row[f+'Archive'].sha256);
  result.browserDraws++;result.archivedBrowserWords+=8;
 }
 const observation={backend:api.backend,gpu:api.gpu,modes:[]};
 for(const mode of['literal','uniform']){
  assert.deepEqual(captures[mode+'-seed'],[3,0,0,1,4,0,0,1].map(word));
  for(let s=0;s<2;s++)for(let lane=0;lane<3;lane++){
   const e=expected[s+3][lane],i=s*4+lane;
   assert.equal(captures[mode+'-hash-low'][i],word(e.integer&65535));assert.equal(captures[mode+'-hash-high'][i],word(e.integer>>>16));
   assert.equal(captures[mode+'-uint-float'][i],e.uintFloat);assert.equal(captures[mode+'-unit'][i],e.unit);assert.equal(captures[mode+'-unit-rne'][i],e.unit);
   assert.equal(captures[mode+'-fma'][i],e.fused);assert.equal(captures[mode+'-fma-rne'][i],e.fused);assert.equal(captures[mode+'-separate'][i],e.separate);
  }
  const observed=captures[mode+'-offset'][2],e=expected[3][2];
  observation.modes.push({mode,seed3z:{native:n[mode+'-offset'][2],targetOriginal:observed,fmaHelper:captures[mode+'-fma'][2],stagedHelper:captures[mode+'-separate'][2],classification:observed===e.fused?'fused':observed===e.separate?'separate':'other'},offsetWords:captures[mode+'-offset']});
 }
 result.profiles.push(observation);
}
assert.equal(result.browserDraws,40);assert.equal(result.archivedBrowserWords,320);
result.hypothesisConfirmed=result.native.every(r=>r.allOffsetEqualsFma)&&result.profiles.every(p=>p.modes[0].seed3z.classification==='separate'&&p.modes[1].seed3z.classification==='fused');
result.limits=['The FMA helper is witnessed at these six fixed inputs only; this does not qualify a generic new FMA operand range.','Diagnostic programs can alter optimizer choices; these are separate observable stages, not register instrumentation inside original Noise.','No production kernel body, source input or numerical gate changed.'];
await writeFile(outArg,JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({status:result.status,hypothesisConfirmed:result.hypothesisConfirmed,browserDraws:result.browserDraws,words:result.archivedBrowserWords}));
