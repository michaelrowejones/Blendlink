import assert from 'node:assert/strict';
import {readFile,writeFile,lstat,realpath,readdir} from 'node:fs/promises';
import {resolve,join,basename} from 'node:path';
import {createHash} from 'node:crypto';
import {hashWords,word,number} from '../shader-kernel-bridge-pilot/oracle.mjs';
import {validateNativeArchive} from '../../scripts/lib/native-proof-archive.mjs';
const args=process.argv.slice(2);assert.equal(args.length,3,'Pass native-folder generation-folder fresh-close.json');
const [folderArg,generation,output]=args.map(p=>resolve(p)),folder=await realpath(folderArg),root=resolve(import.meta.dirname,'../..'),hash=b=>createHash('sha256').update(b).digest('hex');
async function owned(name){assert.equal(basename(name),name);const p=join(folder,name);assert.equal((await lstat(p)).isFile(),true);assert.equal(await realpath(p),p);return readFile(p)}
async function pin(p,h){const b=await readFile(p);assert.equal(hash(b),h,p);return b}
const reportBytes=await owned('report.json'),r=JSON.parse(reportBytes),g=JSON.parse(await pin(join(generation,'generation.json'),r.generationSha256));
assert.equal(r.status,'CAPTURED_NATIVE_NOISE_OFFSET_DIAGNOSTIC');assert.deepEqual(r.nativeVersion,[5,3,0]);assert.equal(r.nativeBuild,'02f0899d78e3');assert.equal(r.backend.backend,'METAL');assert.deepEqual(r.extent,[2,1]);assert.deepEqual(r.seeds,[3,4]);assert.deepEqual(r.lanes,[0,1,2]);assert.equal(r.draws,19);assert.equal(r.supportCredit,0);assert.equal(r.FinalCredit,0);assert.equal(r.cpuCompositorCredit,0);assert.equal(r.calibration.draws,5);assert.equal(r.calibration.words,40);assert.equal(r.calibration.wordMismatches,0);
for(const [p,h]of Object.entries(r.prototypePins))await pin(join(root,p),h);
for(const [p,h]of Object.entries(r.generationSourcePins))await pin(p,h);
assert.deepEqual(g.sourcePins,r.generationSourcePins);assert.deepEqual(g.nativeMetalPreprocess,r.nativeMetalPreprocess);assert.equal(r.nativeMetalPreprocess.guardBlocks,20);assert.equal(r.nativeMetalPreprocess.forwardDeclarationsRemoved,20);assert.equal(r.nativeMetalPreprocess.allBodyTokensUnchanged,true);
const library=await pin(join(generation,'canonical-metal-library.glsl'),r.nativeLibrarySha256),generic=await pin(join(generation,'canonical-library.glsl'),r.genericLibrarySha256),prototype=/\bfloat\s+Noise\w+_noise_fn\s*\([^{};]*\)\s*;/g;
assert.equal(generic.toString().match(prototype).length,20);assert.equal(generic.toString().replace(prototype,'').replace(/\s+/g,''),library.toString().replace(/\s+/g,''));
const stages=['seed-control','hash-low','hash-high','uint-float','unit','offset','fma'];assert.deepEqual(r.stages,stages.slice(1));assert.deepEqual(r.rows.map(x=>[x.source,x.stage]),['literal','uniform'].flatMap(s=>stages.map(t=>[s,t])));
const data=new Map();for(const row of r.rows){assert.equal(row.file,row.source+'-'+row.stage+'.rgba32f');assert.equal(row.shader,row.source+'-'+row.stage+'.glsl');assert.equal(row.words,8);const b=await owned(row.file),shader=await owned(row.shader);assert.equal(b.length,32);assert.equal(hash(b),row.sha256);assert.equal(hash(shader),row.shaderSha256);const words=Array.from({length:8},(_,i)=>b.readUInt32LE(4*i));assert.ok(words.every(w=>Number.isFinite(number(w))));assert.equal(words[3],word(1));assert.equal(words[7],word(1));data.set(row.source+'-'+row.stage,words)}
const actualRaw=(await readdir(folder)).filter(x=>x.endsWith('.rgba32f')).sort();assert.deepEqual(actualRaw,r.rows.map(x=>x.file).sort());
for(const stage of stages)assert.deepEqual(data.get('literal-'+stage),data.get('uniform-'+stage),'Literal/uniform divergence '+stage);
assert.deepEqual(data.get('literal-seed-control'),[3,0,0,1,4,0,0,1].map(word));
// Existing exhaustively proved u32 RN-even normalization law, evaluated independently of the GPU cast.
function rneUnit(u){const top=u===0?0:31-Math.clz32(u),shift=Math.max(top-23,0);let mant=Math.floor(u/2**shift);if(shift){const rem=u%2**shift,half=2**(shift-1);if(rem>half||(rem===half&&(mant&1)))mant++}return Math.fround(mant*2**(shift-32))}
const comparisons=[];
for(let pixel=0;pixel<2;pixel++)for(let lane=0;lane<3;lane++){
 const seed=pixel+3,i=pixel*4+lane,h=hashWords([word(seed),word(lane)]),low=number(data.get('literal-hash-low')[i]),high=number(data.get('literal-hash-high')[i]);assert.equal(low,h&65535);assert.equal(high,h>>>16);
 const nativeCast=data.get('literal-uint-float')[i],unit=rneUnit(h),nativeUnit=data.get('literal-unit')[i];assert.equal(nativeCast,word(h));assert.equal(nativeUnit,word(unit));
 const separateWord=word(Math.fround(unit*100)+100),fusedWord=word(unit*100+100),nativeOffset=data.get('literal-offset')[i],nativeFma=data.get('literal-fma')[i];assert.equal(nativeFma,fusedWord);assert.equal(nativeOffset,fusedWord);
 comparisons.push({seed,lane,hash:h,normalizedWord:nativeUnit,nativeUintFloatWord:nativeCast,separateWord,fusedWord,nativeOffsetWord:nativeOffset,nativeFmaWord:nativeFma,separateDiffers:nativeOffset!==separateWord});
}
assert.equal(comparisons.filter(x=>x.separateDiffers).length,1);assert.deepEqual(comparisons.find(x=>x.separateDiffers),{seed:3,lane:2,hash:4011860407,normalizedWord:1064247330,nativeUintFloatWord:1332682786,separateWord:1128360078,fusedWord:1128360077,nativeOffsetWord:1128360077,nativeFmaWord:1128360077,separateDiffers:true});
await validateNativeArchive(JSON.parse(await owned('native-archive.json')),folder,{expectedFinalSources:[],expectedScripts:[{path:join(import.meta.dirname,'capture.py'),invocations:1}],helperInputs:{helper:join(root,'scripts/lib/node-port-python.mjs'),bridge:join(root,'scripts/node-port-blender.mjs')}});
const receipt=JSON.parse(await owned('capture-receipt.json'));assert.equal(receipt.reportSha256,hash(reportBytes));
const helper=join(root,'experiments/shader-kernel-bridge-pilot/oracle.mjs');
const result={schemaVersion:1,status:'CLOSED_NATIVE_NOISE_OFFSET_DIAGNOSTIC',supportCredit:0,FinalCredit:0,draws:19,calibrationWords:40,stageWords:112,literalUniformWordDifferences:0,hashSplitWordDifferences:0,uintRneWordDifferences:0,unitRneWordDifferences:0,nativeOffsetVsExplicitFmaDifferences:0,nativeOffsetVsSeparateDifferences:1,comparisons,timing:{innerMilliseconds:r.milliseconds,guardedProcessMilliseconds:receipt.milliseconds},pins:{report:{path:join(folder,'report.json'),sha256:hash(reportBytes)},nativeLibrarySha256:r.nativeLibrarySha256,hashHostHelperSha256:hash(await readFile(helper)),verifierSha256:hash(await readFile(new URL(import.meta.url)))},limits:['Two seeds and six lanes only; not an exhaustive compiler arithmetic proof.','Native original source result matches fused arithmetic with literal AND uniform seeds; this excludes literal-only folding as the cause of the seed3.z witness.','This observes results, not emitted Metal ISA: contraction is the matching arithmetic model, not a claim about a specific hardware instruction.','Native PythonGPU Metal stage, not EEVEE material/film; no new port or numerical support credit.','Host fused control is exact for these bounded binary32 values: multiplication by100 and addition100 require fewer than53 significand bits.']};
await writeFile(output,JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(result));
