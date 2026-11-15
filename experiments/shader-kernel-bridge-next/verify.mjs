import assert from'node:assert/strict';
import{readFile,writeFile,realpath,lstat}from'node:fs/promises';
import{resolve,join,sep}from'node:path';
import{createHash}from'node:crypto';
const hash=b=>createHash('sha256').update(b).digest('hex');
const[gArg,mArg,sArg,outArg]=process.argv.slice(2);assert.ok(outArg);
const profiles=sArg==='-'?[[mArg,'metal']]:[[mArg,'metal'],[sArg,'software']];
const generated=await realpath(gArg),generationBytes=await readFile(join(generated,'generation.json')),generation=JSON.parse(generationBytes);
assert.equal(generation.status,'COMBINED_LIBRARY_GENERATED');assert.equal(generation.sharedHashCopies,1);assert.equal(generation.functionNamesUnique,true);
for(const[path,pin]of Object.entries(generation.sourcePins))assert.equal(hash(await readFile(path)),pin,path);
for(const[file,key]of [['canonical-library.glsl','canonicalLibrarySha256'],['canonical-abi.glsl','canonicalAbiSha256'],['module.json','moduleSha256']])assert.equal(hash(await readFile(join(generated,file))),generation[key]);
const inputBytes=await readFile(new URL('./input.json',import.meta.url)),input=JSON.parse(inputBytes);
const expectedCases=['input','gradient-radial','checker','white-three','noise-fbm3-default','voronoi-f1-3d-default','voronoi-f2-3d-default','noise-to-voronoi-first','noise-twice'];
const expectedWrappers={'gradient-radial':['bridge_gradient'],checker:['bridge_checker'],'white-three':['bridge_white'],'noise-fbm3-default':['bridge_noise'],'voronoi-f1-3d-default':['bridge_voronoi_first'],'voronoi-f2-3d-default':['bridge_voronoi_second'],'noise-to-voronoi-first':['bridge_noise','bridge_voronoi_first'],'noise-twice':['bridge_noise']};
const result={schemaVersion:1,status:'COMPOSABLE_COMPILER_CLOSED',profileScope:profiles.map(p=>p[1]),supportCredit:0,nativeBlenderParityCredit:0,finalExports:0,generationSha256:hash(generationBytes),inputSha256:hash(inputBytes),profiles:[],draws:0,inputWords:0,primaryWords:0,crossLanguageWordDifferences:0};
for(const[dir,profile]of profiles){
 const root=await realpath(dir),raw=await readFile(join(root,'report.json')),report=JSON.parse(raw);
 assert.equal(report.status,'COMPOSABLE_COMPILER_CAPTURE_COMPLETE');assert.equal(report.profile,profile);assert.equal(report.inputSha256,hash(inputBytes));assert.equal(report.modulesSha256,generation.moduleSha256);assert.equal(report.generationSha256,hash(generationBytes));
 for(const[path,pin]of Object.entries(report.pins))assert.equal(hash(await readFile(path)),pin,path);
 assert.deepEqual(report.rows.map(r=>r.backend),['webgpu','webgl2']);
 const summary={profile,reportSha256:hash(raw),apis:[],crossLanguageWordDifferences:0},arrays=[];
 for(const api of report.rows){
  assert.equal(api.status,'COMPOSABLE_COMPILER_CAPTURED');assert.deepEqual(api.errors,[]);assert.deepEqual(api.pageErrors,[]);assert.equal(api.remainingTextures,0);
  if(profile==='metal'){assert.match(JSON.stringify(api.gpu),/apple|metal/i);assert.doesNotMatch(JSON.stringify(api.gpu),/swiftshader/i);}else assert.match(JSON.stringify(api.gpu),/swiftshader/i);
  assert.deepEqual(api.rows.map(r=>r.case),expectedCases);
  const cases={};let flip;
  for(const row of api.rows){
   assert.equal(row.status,'compiled-and-drawn');assert.ok(row.compileMs>=0&&row.compileMs<=20000);assert.equal(row.remainingTextures,1);
   const shaderArchive=row.fragmentShaderArchive;
   let fragment;
   for(const field of ['words','vertexShader','fragmentShader']){
    const a=row[field+'Archive'],p=resolve(root,a.file);assert.ok(p.startsWith(root+sep));assert.ok((await lstat(p)).isFile());assert.equal(await realpath(p),p);
    const bytes=await readFile(p);assert.equal(bytes.length,a.bytes);assert.equal(hash(bytes),a.sha256);
    if(field==='words'){assert.equal(bytes.length,1024);cases[row.case]=[...new Uint32Array(bytes.buffer,bytes.byteOffset,256)];}
    if(field==='fragmentShader'){assert.equal(bytes.length,row.fragmentBytes);assert.ok(bytes.length<=262144);fragment=bytes.toString();}
   }
   if(row.case==='input'){
    const first=cases.input.slice(0,4),same=(a,b)=>a.every((w,i)=>w===b[i]);
    const bottom=same(first,input.rows[0].words),top=same(first,input.rows[56].words);assert.notEqual(bottom,top,'Input orientation must be independently unique');flip=top;
    for(let y=0;y<8;y++)for(let x=0;x<8;x++)assert.deepEqual(cases.input.slice((y*8+x)*4,(y*8+x+1)*4),input.rows[(flip?7-y:y)*8+x].words);
    result.inputWords+=256;
   }else{
    assert.deepEqual(Object.keys(row.wrapperDefinitionCounts).sort(),expectedWrappers[row.case].sort());assert.ok(Object.values(row.wrapperDefinitionCounts).every(n=>n===1));
    assert.equal(row.metadata.resourceSignature.kernelTextures,0);assert.equal(row.metadata.resourceSignature.kernelRenderPasses,0);
    assert.ok(/^[a-f0-9]{64}$/.test(row.metadata.kernelSourceSha256));
    if(row.case==='noise-twice'||row.case==='noise-to-voronoi-first'){
     assert.equal(row.metadata.composed,true);
     // The same public wrapper must be called, not copied under a new name.
     const pattern=api.backend==='webgpu'?/\bbridge_noise\s*\(/g:/\bbridge_noise\s*\(/g;
     assert.ok([...fragment.matchAll(pattern)].length>=(row.case==='noise-twice'?3:2));
    }
    result.primaryWords+=256;
   }
   result.draws++;
  }
  const canonical=Object.fromEntries(Object.entries(cases).map(([id,words])=>{const ordered=[];for(let y=0;y<8;y++)ordered.push(...words.slice((flip?7-y:y)*32,(flip?8-y:y+1)*32));return[id,ordered];}));arrays.push(canonical);
  summary.apis.push({backend:api.backend,gpu:api.gpu,flip,maximumShaderBytes:Math.max(...api.rows.map(r=>r.fragmentBytes)),compileMs:api.rows.reduce((s,r)=>s+r.compileMs,0),cases:api.rows.length});
 }
 for(const id of expectedCases.slice(1))for(let i=0;i<256;i++)if(arrays[0][id][i]!==arrays[1][id][i])summary.crossLanguageWordDifferences++;
 result.crossLanguageWordDifferences+=summary.crossLanguageWordDifferences;result.profiles.push(summary);
}
assert.equal(result.draws,profiles.length*18);assert.equal(result.primaryWords,profiles.length*4096);assert.equal(result.inputWords,profiles.length*512);
// Cross-language numerical differences are retained rather than repaired. Native
// compiler/material comparisons live in a separately source-pinned reader.
if(result.crossLanguageWordDifferences)result.status='COMPOSABLE_CAPTURE_WITH_NUMERICAL_DIFFERENCES';
await writeFile(outArg,JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(result));
