import assert from'node:assert/strict';
import{readFile,writeFile,realpath,lstat}from'node:fs/promises';
import{join,resolve,sep,dirname}from'node:path';
import{createHash}from'node:crypto';
const hash=b=>createHash('sha256').update(b).digest('hex');
const[gArg,bArg,nArg,outArg]=process.argv.slice(2);assert.ok(outArg);
const gRaw=await readFile(join(gArg,'generation.json')),generation=JSON.parse(gRaw);assert.equal(generation.status,'STATIC_NOISE_COLOR_LIBRARY_GENERATED');assert.equal(generation.helperCallSubstitutions,2);assert.equal(generation.genericBodiesChanged,false);
for(const[path,pin]of Object.entries(generation.sourcePins))assert.equal(hash(await readFile(path)),pin,path);
const moduleRaw=await readFile(join(gArg,'module.json'));assert.equal(hash(moduleRaw),generation.moduleSha256);
const proofRaw=await readFile(join(gArg,'source-clone-proof.json'));assert.equal(hash(proofRaw),generation.cloneProofSha256);const proof=JSON.parse(proofRaw);assert.equal(proof.genericPrefixByteIdentical,true);
assert.deepEqual(proof.helper.substitutedCalls.map(c=>({seed:c.seed,words:c.words})),generation.nativeOffsetWords.map(r=>({seed:r.seed,words:r.words})));assert.equal(proof.helper.editedSpans,3);assert.equal(proof.entry.editedSpans,2);
const originalGenerationPath=generation.commands[0].command[4],originalGenerationRaw=await readFile(originalGenerationPath);assert.equal(hash(originalGenerationRaw),generation.originalGenerationSha256);
const originalDir=dirname(originalGenerationPath),originalLibrary=await readFile(join(originalDir,'canonical-library.glsl'));assert.equal(hash(originalLibrary),generation.originalLibrarySha256);
const originalAbi=await readFile(join(originalDir,'canonical-abi.glsl'),'utf8');
const once=(source,needle,replacement)=>{assert.equal(source.split(needle).length-1,1,'Expected exactly one scoped source occurrence');return source.replace(needle,replacement);};
for(const original of[proof.helper.original,proof.entry.original])assert.equal(originalLibrary.toString().split(original).length-1,1);
let expectedHelper=once(proof.helper.original,'void '+proof.helper.originalFunction+'(','void '+proof.helper.derivedFunction+'(');
for(const call of proof.helper.substitutedCalls){assert.equal(call.originalCall,'random_offsetTfloat3(seed_base + '+(call.seed===3?'0.0f':'1.0f')+')');expectedHelper=once(expectedHelper,call.originalCall,'uintBitsToFloat(uvec3('+call.words.map(w=>w+'u').join(',')+'))');}
let expectedEntry=once(proof.entry.original,'void '+proof.entry.originalFunction+'(','void '+proof.entry.derivedFunction+'(');expectedEntry=once(expectedEntry,proof.helper.originalFunction+'(',proof.helper.derivedFunction+'(');
const derived=await readFile(join(gArg,'derived-clones.glsl'),'utf8');assert.equal(derived,'\n'+expectedHelper+'\n'+expectedEntry+'\n');
const assembled=await readFile(join(gArg,'static-color.frag'));const expectedPrefix=Buffer.concat([Buffer.from('#version 450\n'),originalLibrary,Buffer.from(derived)]);assert.deepEqual(assembled.subarray(0,expectedPrefix.length),expectedPrefix);
assert.equal(originalAbi.split(proof.originalWrapper).length-1,1);
const root=await realpath(bArg),nativeRoot=await realpath(nArg),bRaw=await readFile(join(root,'report.json')),report=JSON.parse(bRaw),nRaw=await readFile(join(nativeRoot,'report.json')),native=JSON.parse(nRaw);
assert.equal(report.status,'STATIC_NOISE_COLOR_CAPTURE_COMPLETE');assert.equal(report.profile,'metal');assert.equal(report.generationSha256,hash(gRaw));assert.equal(report.modulesSha256,generation.moduleSha256);
for(const[path,pin]of Object.entries(report.pins))assert.equal(hash(await readFile(path)),pin,path);
assert.equal(native.status,'CAPTURED_NATIVE_PRE_NAGA_KERNEL_F32');assert.equal(native.canonicalLibrarySha256,generation.tableProfile.nativeLibrarySha256);assert.equal(native.generationSha256,generation.originalGenerationSha256);assert.equal(native.build,generation.tableProfile.nativeBuild);assert.equal(native.backend.backend,'METAL');
assert.equal(native.consumedTargetWgsl,false);assert.equal(native.consumedTargetEsGlsl,false);assert.equal(native.originalBodiesChanged,false);
const owned=async(dir,file,pin)=>{const path=resolve(dir,file);assert.ok(path.startsWith(dir+sep));assert.ok((await lstat(path)).isFile());assert.equal(await realpath(path),path);const b=await readFile(path);assert.equal(hash(b),pin);return b;};
const words=raw=>{assert.equal(raw.length,1024);return[...new Uint32Array(raw.buffer,raw.byteOffset,256)];};
const cases=['noise-fbm3-default','noise-twice','noise-to-voronoi-first'],source={};
for(const id of['input',...cases]){const rows=native.runs.filter(r=>r.case===id);assert.equal(rows.length,1);source[id]=words(await owned(nativeRoot,rows[0].rawFile,rows[0].rawSha256));await owned(nativeRoot,rows[0].shaderFile,rows[0].shaderSha256);}
const scratch=new ArrayBuffer(4),u=new Uint32Array(scratch),f=new Float32Array(scratch),number=w=>{u[0]=w;return f[0];};
const result={schemaVersion:1,status:'STATIC_COLOR_NATIVE_COMPARISON_PASSED',supportCredit:0,FinalCredit:0,productionAdmission:false,profileScope:'Metal WebGPU and WebGL2;64 fixed inputs',gate:{maximumAbsoluteError:2**-20,maximumUlps:8,bothRequired:true},generationSha256:hash(gRaw),browserReportSha256:hash(bRaw),nativeReportSha256:hash(nRaw),tableAuthoritySha256:generation.tableAuthoritySha256,helperCallSubstitutions:2,genericPrefixByteIdentical:true,draws:0,inputWords:0,primaryWords:0,wordDifferences:0,contractViolations:0,maximumAbs:0,maximumUlps:0,apis:[]};
assert.deepEqual(report.rows.map(r=>r.backend),['webgpu','webgl2']);
for(const api of report.rows){
 assert.equal(api.status,'STATIC_NOISE_COLOR_CAPTURED');assert.deepEqual(api.errors,[]);assert.deepEqual(api.pageErrors,[]);assert.equal(api.remainingTextures,0);assert.match(JSON.stringify(api.gpu),/apple|metal/i);assert.doesNotMatch(JSON.stringify(api.gpu),/swiftshader/i);
 assert.deepEqual(api.rows.map(r=>r.case),['input',...cases]);
 const samples={};for(const row of api.rows){
  assert.equal(row.status,'compiled-and-drawn');assert.equal(row.remainingTextures,1);
  samples[row.case]=words(await owned(root,row.wordsArchive.file,row.wordsArchive.sha256));
  for(const field of['fragmentShader','vertexShader'])await owned(root,row[field+'Archive'].file,row[field+'Archive'].sha256);
  if(row.case!=='input'){
   assert.equal(row.metadata.model,generation.staticModel);assert.deepEqual(row.metadata.sourcePrecisionProfile,generation.tableProfile);assert.equal(row.metadata.tableAuthoritySha256,generation.tableAuthoritySha256);
   assert.equal(row.metadata.resourceSignature.kernelTextures,0);assert.equal(row.metadata.resourceSignature.kernelRenderPasses,0);
   const expectedNames=row.case==='noise-to-voronoi-first'?['bridge_noise_static','bridge_voronoi_first']:['bridge_noise_static'];assert.deepEqual(Object.keys(row.wrapperDefinitionCounts).sort(),expectedNames);assert.ok(Object.values(row.wrapperDefinitionCounts).every(x=>x===1));
  }
  result.draws++;
 }
 const same=(a,b)=>a.every((w,i)=>w===b[i]);const normal=same(samples.input.slice(0,4),source.input.slice(0,4)),flip=same(samples.input.slice(0,4),source.input.slice(224,228));assert.notEqual(normal,flip);
 const observation={backend:api.backend,gpu:api.gpu,flip,rows:[],maximumShaderBytes:Math.max(...api.rows.map(r=>r.fragmentBytes))};
 for(const id of['input',...cases]){
  const actual=[];for(let y=0;y<8;y++)actual.push(...samples[id].slice((flip?7-y:y)*32,(flip?8-y:y+1)*32));
  if(id==='input'){assert.deepEqual(actual,source.input);result.inputWords+=256;continue;}
  const expected=source[id],row={case:id,words:256,wordDifferences:0,contractViolations:0,maxAbs:0,maxUlps:0,laneDifferences:[0,0,0,0]};
  for(let i=0;i<256;i++){
   const a=number(actual[i]),e=number(expected[i]);assert.ok(Number.isFinite(a)&&Number.isFinite(e)&&a>=0&&e>=0);
   const abs=Math.abs(a-e),ulps=Math.abs(actual[i]-expected[i]);row.maxAbs=Math.max(row.maxAbs,abs);row.maxUlps=Math.max(row.maxUlps,ulps);
   if(actual[i]!==expected[i]){row.wordDifferences++;row.laneDifferences[i%4]++;}
   if(abs>result.gate.maximumAbsoluteError||ulps>result.gate.maximumUlps)row.contractViolations++;
  }
  result.primaryWords+=256;result.wordDifferences+=row.wordDifferences;result.contractViolations+=row.contractViolations;result.maximumAbs=Math.max(result.maximumAbs,row.maxAbs);result.maximumUlps=Math.max(result.maximumUlps,row.maxUlps);observation.rows.push(row);
 }
 result.apis.push(observation);
}
assert.equal(result.draws,8);assert.equal(result.inputWords,512);assert.equal(result.primaryWords,1536);
if(result.contractViolations)result.status='STATIC_COLOR_NATIVE_COMPARISON_FAILED_ZERO_CREDIT';
await writeFile(outArg,JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({status:result.status,words:result.primaryWords,differences:result.wordDifferences,violations:result.contractViolations,maxAbs:result.maximumAbs,maxUlps:result.maximumUlps}));if(result.contractViolations)process.exitCode=1;
