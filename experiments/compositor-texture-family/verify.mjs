// Close the complete native -> saved Final -> built production renderer proof.
import assert from 'node:assert/strict'
import {readFile,writeFile,readdir} from 'node:fs/promises'
import {resolve,join,relative} from 'node:path'
import {hash} from '../../scripts/lib/runtime-provenance.mjs'
import {assertTextureQualification,assertTextureFinal} from './protocol.mjs'
const root=resolve(import.meta.dirname,'../..'),directory=resolve(process.argv[2]??join(root,'artifacts/verification-compositor-texture53')),output=resolve(process.argv[3]??join(directory,'texture-evidence.json'))
const read=async p=>JSON.parse(await readFile(p)),pin=async(p,digest)=>assert.equal(hash(await readFile(p)),digest,'Changed proof input '+p)
const nativeReceipts=[],receipts=[];let runs=0
const perNode={ShaderNodeTexGradient:{nativeGraphs:0,savedFinalScenes:0,browserCaseRuns:0},ShaderNodeTexChecker:{nativeGraphs:0,savedFinalScenes:0,browserCaseRuns:0}}
const nativeId=name=>name.startsWith('gradient-')?'ShaderNodeTexGradient':'ShaderNodeTexChecker'
for(const device of ['CPU','GPU']){
 const folder=join(directory,device.toLowerCase()),nativePath=join(folder,'qualification.json'),native=assertTextureQualification(await read(nativePath));assert.equal(native.device,device)
 const invocation=await read(join(folder,'native-invocation.json'));assert.equal(invocation.result.exitCode,0);assert.equal(invocation.result.pythonGuardApplied,true);assert.equal(invocation.result.cacheDisposed,true)
 for(const[path,digest]of Object.entries(native.sourceHashes))await pin(join(root,path),digest)
 for(const row of native.cases){perNode[nativeId(row.case)].nativeGraphs++;const program=await read(join(folder,row.programFile));assert.ok(program.ops.some(op=>op.kind===(row.case.startsWith('gradient-')?'gradient-texture':'checker-texture')));for(const key of ['pixel','program'])await pin(join(folder,row[key+'File']),row[key+'Sha256']);if(row.inputFile)await pin(join(folder,row.inputFile),row.inputSha256);if(row.sourceFile)await pin(join(folder,row.sourceFile),row.sourceSha256)}
 const finalPath=join(folder,'final-proof.json'),final=assertTextureFinal(await read(finalPath),native);assert.equal(final.nativeQualificationSha256,hash(await readFile(nativePath)))
 for(const entry of final.provenance){await pin(join(root,entry.source),entry.sha256);await pin(join(root,entry.artifact),entry.sha256)}
 for(const row of final.rows)perNode[nativeId(row.case)].savedFinalScenes++
 for(const row of final.rows)for(const key of ['manifest','glb','presentation'])await pin(row[key+'Path'],row[key+'Sha256'])
 const launcher=join(folder,'final-native-launcher'),invocations=await readdir(join(launcher,'invocations'));assert.ok(invocations.length>=12)
 for(const file of invocations){const packet=await read(join(launcher,'invocations',file));assert.equal(packet.result.exitCode,0);assert.equal(packet.result.pythonGuardApplied,packet.result.args.some(arg=>['--python','--python-expr','-P'].includes(arg)));assert.equal(packet.result.cacheDisposed,true)}
 nativeReceipts.push({device,graphs:native.cases.length,savedFinalScenes:final.rows.length,qualificationSha256:hash(await readFile(nativePath)),finalSha256:hash(await readFile(finalPath)),native:invocation.native,sourceHashes:native.sourceHashes})
 for(const profile of ['metal','software'])for(const phase of ['raw','final']){
  const path=join(folder,'browser-'+phase+'-'+profile,'report.json'),report=await read(path)
  assert.equal(report.status,'PASSED_TEXTURE_BUILT_PROOF');assert.equal(report.built,true);assert.equal(report.final,phase==='final');assert.equal(report.profile,profile);assert.equal(report.sourceDevice,device)
  assert.equal(report.provenance.nativeQualificationSha256,hash(await readFile(nativePath)));if(phase==='final')assert.equal(report.provenance.finalProofSha256,hash(await readFile(finalPath)))
  for(const[name,digest]of Object.entries(report.provenance.fixturePins))await pin(join(import.meta.dirname,name),digest)
  await pin(join(import.meta.dirname,'run.mjs'),report.provenance.runnerSha256);await pin(join(import.meta.dirname,'protocol.mjs'),report.provenance.protocolSha256)
  for(const module of report.provenance.modules){assert.equal(module.emitterMatchesSource,true);await pin(join(root,'packages/blendlink/src',module.name+'.ts'),module.sourceSha256);await pin(join(report.provenance.snapshot.directory,module.name+'.js'),module.testedSnapshotSha256)}
  assert.equal(report.missingAdapterControl.refused,true);assert.deepEqual(report.rows.map(row=>row.backend).sort(),['webgl2','webgpu'])
  const expected=(phase==='final'?final.rows:native.cases).map(row=>row.case).sort()
  for(const row of report.rows){assert.equal(row.gpu.api,row.backend==='webgpu'?'WebGPU':'WebGL2');assert.deepEqual(row.errors,[]);assert.deepEqual(row.pageErrors,[]);assert.deepEqual(row.rows.map(x=>x.case).sort(),expected);assert.equal(row.negatives.length,7)
   if(profile==='metal'){assert.match(JSON.stringify(row.gpu),/apple|metal/i);assert.doesNotMatch(JSON.stringify(row.gpu),/swiftshader/i)}else assert.match(JSON.stringify(row.gpu),/swiftshader/i)
   for(const result of row.rows){perNode[nativeId(result.case)].browserCaseRuns++;assert.equal(result.wordMismatches,0);assert.equal(result.portOwnedTextures,0);assert.equal(result.remainingRenderTargets,0);if(phase==='final'){assert.equal(result.pinRejected,true);assert.ok(result.meshCount>0);assert.equal(result.sourceMaterialsPreserved,true);assert.equal(result.baselineCacheRestored,true);assert.equal(result.lifecycleCycles,3);assert.equal(result.remainingTextures,result.baselineCache.length);assert.equal(result.baselineCache.length,1);assert.equal(result.baselineCache[0].name,'DFG_LUT')}}
   for(const refusal of row.negatives){assert.match(refusal.error,/Procedural Texture/);assert.equal(refusal.remainingTextures,0)}runs+=row.rows.length
  }
  receipts.push({path:relative(root,path),sha256:hash(await readFile(path)),device,profile,phase,browserVersion:report.browserVersion,apis:report.rows.map(row=>({backend:row.backend,gpu:row.gpu,cases:row.rows.length}))})
 }
}
assert.equal(runs,2208)
const result={status:'QUALIFIED_PARTIAL_COMPOSITOR_TEXTURE_FAMILY',nativeGraphs:524,savedFinalScenes:28,browserCaseRuns:runs,primaryFloat32Words:runs*8*8*4,wordMismatches:0,perNode,nativeReceipts,receipts,
 scope:'Blender5.3.0 build02f0899d78e3 macOSarm64 compositor. Gradient LINEAR bounded exact Float32 literal vectors without negative zero; QUADRATIC/DIAGONAL/EASING sixteenth-grid literals. Checker sixteenth-grid vectors within +/-16, fixed integerScale0..256 and finite bounded literalcolors. BothColor/Fac outputs. Default UniformImageCoordinates, all computed/image fields and Gradientradial/spheres remain unqualified.',
 rawArtifacts:{machineLocal:true,ignored:true,directory:'artifacts/verification-compositor-texture53'},
 verifiedInputs:Object.fromEntries(await Promise.all(['packages/blendlink/blender/compositor_procedural_texture.py','packages/blendlink/src/tslCompositorProceduralTexture.ts','packages/blender-addon/tests/compositor_texture_family_check.py','experiments/compositor-texture-family/protocol.mjs','experiments/compositor-texture-family/run.mjs','experiments/compositor-texture-family/browser.js','experiments/compositor-texture-family/export.test.ts','experiments/compositor-texture-family/verify.mjs'].map(async path=>[path,hash(await readFile(join(root,path)))]))),upstream:await read(join(import.meta.dirname,'sources.json'))}
await writeFile(output,JSON.stringify(result,null,2)+'\n');console.log('SCENETOWEB_TEXTURE_FAMILY_QUALIFIED '+JSON.stringify({nativeGraphs:524,savedFinalScenes:28,browserCaseRuns:runs,wordMismatches:0}))
