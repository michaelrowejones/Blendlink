import assert from'node:assert/strict';
import{readFile,writeFile,realpath,lstat}from'node:fs/promises';
import{resolve,join,sep}from'node:path';
import{createHash}from'node:crypto';
const hash=b=>createHash('sha256').update(b).digest('hex');
const[gArg,nArg,mArg,sArg,outArg]=process.argv.slice(2);assert.ok(outArg);
const profiles=sArg==='-'?[[mArg,'metal']]:[[mArg,'metal'],[sArg,'software']];
const generation=JSON.parse(await readFile(join(gArg,'generation.json'))),original=await readFile(join(gArg,'original-generation.json'));
const nativeRoot=await realpath(nArg),nativeBytes=await readFile(join(nativeRoot,'report.json')),native=JSON.parse(nativeBytes);
const inputBytes=await readFile(new URL('./input.json',import.meta.url)),input=JSON.parse(inputBytes),inputWords=input.rows.flatMap(r=>r.words);
assert.equal(native.status,'CAPTURED_NATIVE_PRE_NAGA_KERNEL_F32');assert.equal(native.model,'Blender53-PythonGPU-original-lowered-GLSL-Metal-RGBA32F-v1');
assert.equal(native.build,'02f0899d78e3');assert.equal(native.backend.backend,'METAL');
assert.equal(native.consumedTargetWgsl,false);assert.equal(native.consumedTargetEsGlsl,false);assert.equal(native.originalBodiesChanged,false);
assert.equal(native.inputSha256,hash(inputBytes));assert.equal(native.generationSha256,hash(original));
assert.equal(native.canonicalLibrarySha256,generation.nativeMetalPreprocess.sha256);assert.equal(native.canonicalAbiSha256,generation.canonicalAbiSha256);
assert.deepEqual(native.generationSourcePins,JSON.parse(original).sourcePins);
for(const[path,pin]of Object.entries(native.generationSourcePins))assert.equal(hash(await readFile(path)),pin,path);
const owned=async(root,archive)=>{const p=resolve(root,archive.file);assert.ok(p.startsWith(root+sep));assert.ok((await lstat(p)).isFile());assert.equal(await realpath(p),p);const b=await readFile(p);assert.equal(hash(b),archive.sha256);return b;};
const expectedCases=['input','gradient-radial','noise-fbm3-default','voronoi-f1-3d-default','voronoi-f2-3d-default','noise-twice','noise-to-voronoi-first'];
assert.deepEqual(native.runs.map(r=>r.case),expectedCases);
const sourceWords={};
for(const row of native.runs){
 assert.equal(row.words,256);const raw=await owned(nativeRoot,{file:row.rawFile,sha256:row.rawSha256});assert.equal(raw.length,1024);sourceWords[row.case]=[...new Uint32Array(raw.buffer,raw.byteOffset,256)];
 await owned(nativeRoot,{file:row.shaderFile,sha256:row.shaderSha256});
 if(row.case!=='input')assert.ok(sourceWords[row.case].some(x=>x!==0),'Invalid all-zero native source result');
}
assert.deepEqual(sourceWords.input,inputWords);
const result={schemaVersion:1,status:'NATIVE_COMPILER_COMPARISON_PASSED',profileScope:profiles.map(p=>p[1]),supportCredit:0,FinalCredit:0,eeveeMaterialCredit:0,nativeModel:native.model,nativeReportSha256:hash(nativeBytes),inputSha256:hash(inputBytes),gate:{maximumAbsoluteError:2**-20,maximumUlps:8,bothRequired:true},profiles:[],comparedWords:0,wordDifferences:0,contractViolations:0,maxAbs:0,maxUlps:0,limits:['Direct Blender Python GPU Metal compilation differs from EEVEE material compilation; the independent EEVEE radial crosscheck is owned by a separate receipt.','No generic source-node/default/context admission or production support is granted.']};
const scratch=new ArrayBuffer(4),u=new Uint32Array(scratch),f=new Float32Array(scratch),number=w=>{u[0]=w;return f[0];};
for(const[dir,profile]of profiles){
 const root=await realpath(dir),reportBytes=await readFile(join(root,'report.json')),report=JSON.parse(reportBytes);assert.equal(report.status,'COMPOSABLE_COMPILER_CAPTURE_COMPLETE');assert.equal(report.profile,profile);
 const profileResult={profile,reportSha256:hash(reportBytes),apis:[]};
 for(const api of report.rows){
  const cases={};for(const row of api.rows){const raw=await owned(root,row.wordsArchive);assert.equal(raw.length,1024);cases[row.case]=[...new Uint32Array(raw.buffer,raw.byteOffset,256)];}
  const same=(a,b)=>a.every((w,i)=>w===b[i]);const bottom=same(cases.input.slice(0,4),inputWords.slice(0,4)),top=same(cases.input.slice(0,4),inputWords.slice(224,228));assert.notEqual(bottom,top);const flip=top;
  const apiResult={backend:api.backend,flip,rows:[]};
  for(const id of expectedCases){
   const actual=[];for(let y=0;y<8;y++)actual.push(...cases[id].slice((flip?7-y:y)*32,(flip?8-y:y+1)*32));
   if(id==='input'){assert.deepEqual(actual,inputWords);continue;}
   const expected=sourceWords[id],row={case:id,words:256,wordDifferences:0,contractViolations:0,maxAbs:0,maxUlps:0};
   for(let i=0;i<256;i++){
    const a=number(actual[i]),e=number(expected[i]);assert.ok(Number.isFinite(a)&&Number.isFinite(e));
    const abs=Math.abs(a-e),ulps=Math.abs(actual[i]-expected[i]);row.maxAbs=Math.max(row.maxAbs,abs);row.maxUlps=Math.max(row.maxUlps,ulps);
    if(actual[i]!==expected[i])row.wordDifferences++;
    if(abs>result.gate.maximumAbsoluteError||ulps>result.gate.maximumUlps)row.contractViolations++;
   }
   result.comparedWords+=row.words;result.wordDifferences+=row.wordDifferences;result.contractViolations+=row.contractViolations;result.maxAbs=Math.max(result.maxAbs,row.maxAbs);result.maxUlps=Math.max(result.maxUlps,row.maxUlps);apiResult.rows.push(row);
  }
  profileResult.apis.push(apiResult);
 }
 result.profiles.push(profileResult);
}
assert.equal(result.comparedWords,profiles.length*3072);
if(result.contractViolations)result.status='NATIVE_COMPILER_COMPARISON_FAILED_ZERO_CREDIT';
await writeFile(outArg,JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({status:result.status,comparedWords:result.comparedWords,wordDifferences:result.wordDifferences,contractViolations:result.contractViolations,maxAbs:result.maxAbs,maxUlps:result.maxUlps}));if(result.contractViolations)process.exitCode=1;
