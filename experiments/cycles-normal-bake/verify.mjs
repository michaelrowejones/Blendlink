// Independent archival closure only. No Blender, browser, render or GPU jobs.
import assert from 'node:assert/strict'
import {readFile,writeFile,realpath} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {spawnSync} from 'node:child_process'
import {captureRuntimeProvenance,hash} from '../../scripts/lib/runtime-provenance.mjs'
import {assertBuiltRuntimeArchive} from '../../scripts/lib/runtime-proof-archive.mjs'
import {assertCaptureManifest,assertNativeCapture} from './archive.mjs'
import {assertCarrierBrowserReport} from './protocol.mjs'
const root=resolve(import.meta.dirname,'../..'),args=process.argv.slice(2)
assert.ok(args.length===4||args.length===5,'Pass wood,coat,Metal browser,SwiftShader browser directories, then optional receipt path')
const [wood,coat,metal,software]=await Promise.all(args.slice(0,4).map(path=>realpath(resolve(path))))
const output=resolve(args[4]??join(root,'experiments/cycles-normal-bake/evidence.json'))
const natives=[]
for(const directory of[wood,coat])natives.push(await assertNativeCapture(root,directory))
assert.deepEqual(natives.map(value=>value.report.normalChannels),[['Normal'],['Normal','Coat Normal']]);assert.equal(new Set(natives.map(value=>value.prefix)).size,2)
const python=process.env.BLENDLINK_TEST_PYTHON??'/Applications/Blender.app/Contents/Resources/5.3/python/bin/python3.13',pixelChecks=[]
const decoderPath=join(import.meta.dirname,'validate_pixels.py'),decoderSha256=hash(await readFile(decoderPath))
for(const directory of[wood,coat]){const result=spawnSync(python,[decoderPath,directory],{cwd:root,encoding:'utf8',timeout:60000,maxBuffer:8*1024*1024});assert.equal(result.status,0,String(result.stderr));const row=JSON.parse(result.stdout.trim());assert.equal(row.status,'VERIFIED_NATIVE_NORMAL_PNG_ARCHIVE');assert.equal(row.liveNodeCredit,0);pixelChecks.push(row)}
assert.equal(hash(await readFile(decoderPath)),decoderSha256)
const {provenance:current}=await captureRuntimeProvenance({root,built:true,compilerInputs:true,label:'Independent normal carrier closed reader'})
const browsers=[]
for(const [directory,profile]of[[metal,'metal'],[software,'software']]){
 const bytes=await readFile(join(directory,'report.json')),report=assertCarrierBrowserReport(JSON.parse(bytes))
 assert.deepEqual(report.provenance.compilerAttestation,current.compilerAttestation,'Current independent compiler closure differs')
 assert.equal(report.provenance.runnerSha256,hash(await readFile(join(import.meta.dirname,'browser.mjs'))));assert.equal(report.provenance.protocolSha256,hash(await readFile(join(import.meta.dirname,'protocol.mjs'))))
 const runtimeFingerprint=await assertBuiltRuntimeArchive({root,current,provenance:report.provenance,runtimeDirectory:join(directory,'runtime'),fixtureDirectory:join(directory,'fixture'),fixtureSourceDirectory:import.meta.dirname})
 assert.equal(report.closure.runtimeFingerprint,runtimeFingerprint);assert.equal(report.closure.archiveHelperSha256,hash(await readFile(join(root,'scripts/lib/runtime-proof-archive.mjs'))))
 for(let index=0;index<2;index++){
  const source=report.sources[index],native=natives[index],folder=index?coat:wood
  assert.equal(await realpath(source.captureDirectory),folder);await assertCaptureManifest(folder,source.captureManifestSha256)
  assert.equal(source.captureManifestSha256,native.capture.sha256);assert.equal(source.nativeReportSha256,native.capture.manifest.report.sha256);assert.equal(source.glbSha256,native.capture.manifest.glb.sha256);assert.equal(source.materialProgramSha256,native.capture.manifest.programs.sha256)
  assert.equal(source.glbUrl,'/@fs'+join(folder,'material.glb'));assert.equal(source.materialPrograms.url,'/@fs'+join(folder,'material.glb.materials.json'));assert.equal(source.materialPrograms.hash,source.materialProgramSha256.slice(0,16));assert.equal(source.materialPrograms.bytes,native.capture.manifest.programs.bytes)
  assert.deepEqual(source.normalHashes,Object.fromEntries(native.report.rows.map(row=>[row.channel.includes('Coat Normal')?'Coat Normal':'Normal',row.sha256])))
 }
 for(const api of report.rows){if(profile==='metal'){assert.match(JSON.stringify(api.gpu),/apple|metal/i);assert.doesNotMatch(JSON.stringify(api.gpu),/swiftshader/i)}else assert.match(JSON.stringify(api.gpu),/swiftshader/i)}
 browsers.push({profile,reportDirectory:directory,reportSha256:hash(bytes),runtimeFingerprint,rows:report.rows})
}
assert.equal(browsers[0].runtimeFingerprint,browsers[1].runtimeFingerprint)
for(let index=0;index<2;index++)await assertNativeCapture(root,index?coat:wood)
for(const row of browsers)assert.equal(hash(await readFile(join(row.reportDirectory,'report.json'))),row.reportSha256,'Browser report changed during independent closure')
assert.equal(hash(await readFile(decoderPath)),decoderSha256)
const result={status:'VERIFIED_BOUNDED_CYCLES_NORMAL_CARRIERS',liveNodeCredit:0,wholeSceneFinalAccepted:false,ownedMaterialExports:2,normalFieldChannels:3,normalBakeCalls:natives.reduce((sum,value)=>sum+value.report.normalBakes,0),uniquePythonPrefixes:2,browserCaseRuns:8,directionDiagnosticFrames:12,scope:'Actual owned Cube wood material and explicit active-coat derivative. Native surface/PNG/basis/carrier + companion-IR loading only; no whole-material lighting/filtering/LOD parity or full original Cube acceptance. Floor remains a named resource refusal.',native:natives.map(value=>({manifestSha256:value.capture.sha256,glb:value.capture.manifest.glb,sourceHash:value.report.sourceHash,rows:value.report.rows,stateRestored:value.report.stateRestored})),pixelChecks,browsers,closure:{independentlyEmittedAtClose:true,runtimeFingerprint:browsers[0].runtimeFingerprint,decoderSha256,verifierSha256:hash(await readFile(import.meta.filename)),archiveHelperSha256:hash(await readFile(join(import.meta.dirname,'archive.mjs')))}}
await writeFile(output,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({status:result.status,liveNodeCredit:0,ownedMaterialExports:2,browserCaseRuns:8}))
