// CPU-only, diagnostic proposal. Reads immutable failed inputs; never accepts a
// port, narrows profiles, changes strict gates, opens GPU or modifies old files.
import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {dirname,join,resolve} from 'node:path'
import {compare} from '../box-image-transport-prototype/compare.mjs'
import {lowerLeftRows} from '../box-image-storage-stage/orientation-check.mjs'
import {policy,floats,coverage,visualDiagnostic} from './visual-color-policy.mjs'
const sha=b=>createHash('sha256').update(b).digest('hex'),folder=import.meta.dirname
const readJson=async path=>JSON.parse(await readFile(path,'utf8'))
async function pinned(path,expected){const bytes=await readFile(path);assert.equal(sha(bytes),expected,'Input pin changed: '+path);return bytes}
async function run(){
 const proof=await readJson(join(folder,'installed-evidence-r3.json')),pins=proof.pins
 assert.equal(proof.status,'FRESH_SAVED_FINAL_INSTALLED_BOX_COLOR_STRICT_GATE_FAILED');assert.equal(proof.strictGate.violations,50);assert.equal(proof.strictGate.thresholdChanged,false)
 for(const p of Object.values(pins))await pinned(p.path,p.sha256)
 const browser=JSON.parse(await pinned(pins.browserReport.path,pins.browserReport.sha256)),native=JSON.parse(await pinned(pins.nativeReport.path,pins.nativeReport.sha256)),final=JSON.parse(await pinned(pins.final.path,pins.final.sha256)),nativeDir=dirname(pins.nativeReport.path),browserDir=dirname(pins.browserReport.path)
 assert.equal(browser.sourceCommit,proof.sourceCommit);assert.equal(browser.apis.length,4);assert.equal(native.rows.length,18);assert.equal(final.rows.length,3)
 for(const row of final.rows){const material=JSON.parse(await pinned(row.materialPath,row.materialSha256));assert.deepEqual(material,row.materialPrograms);for(const program of Object.values(material.materials)){assert.deepEqual(program.skipped??[],[]);for(const channel of['Base Color','Metallic','Roughness','Emission','Alpha'])assert.ok(program.channels[channel]?.tslIr);assert.deepEqual(program.channels.Alpha.tslIr.output,{op:'const_float',value:1})}}
 const nativeData=new Map();for(const row of native.rows){const b=await pinned(join(nativeDir,row.file),row.sha256);assert.equal(b.length,row.width*row.height*16);nativeData.set(row.case+'/'+row.kind+'/'+row.width,b)}
 const rows=[],raw=[],tuples=new Set();let rawRows=0
 for(const api of browser.apis){const tuple=api.profile+'/'+api.backend;assert.ok(!tuples.has(tuple));tuples.add(tuple);assert.equal(api.rows.length,51);const data=new Map();for(const row of api.rows){const b=await pinned(join(browserDir,row.file),row.sha256);assert.equal(b.length,row.width*row.height*16);data.set(row.id+'/'+row.kind+'/'+row.width,lowerLeftRows(b,api.backend,row.width,row.height));rawRows++}
  for(const id of['plane-1','source-Plane.021','source-Walls'])for(const[w,h]of[[64,4],[128,8]]){
   const mask=coverage(floats(nativeData.get(id+'/mask/'+w),w,h)),actualMask=coverage(floats(data.get(id+'/mask/'+w),w,h)),reference=floats(nativeData.get(id+'/color/'+w),w,h),actual=floats(data.get(id+'/color/'+w),w,h),visual=visualDiagnostic(reference,actual,mask,actualMask,w,h)
   const mapping=floats(nativeData.get(id+'/mapping/'+w),w,h),actualMapping=floats(data.get(id+'/mapping/'+w),w,h);let mappingWords=0,mappingViolations=0,mappingMaxAbs=0
   for(let p=0;p<mask.length;p++)if(mask[p]&&actualMask[p])for(let c=0;c<3;c++){const error=Math.abs(mapping[p*4+c]-actualMapping[p*4+c]);mappingWords++;mappingMaxAbs=Math.max(mappingMaxAbs,error);if(error>2**-10)mappingViolations++}
   rows.push({tuple,id,width:w,height:h,...visual,mappingSameValidCoverage:{bound:2**-10,words:mappingWords,violations:mappingViolations,maxAbs:mappingMaxAbs}})
   for(const kind of['mask','mapping','color','alpha'])raw.push({tuple,id,width:w,kind,...compare(data.get(id+'/'+kind+'/'+w),nativeData.get(id+'/'+(kind==='alpha'?'mask':kind)+'/'+w),['mask','alpha'].includes(kind)?0:2**-10)})
  }
 }
 assert.equal(rawRows,204);assert.equal(raw.length,96);assert.equal(raw.reduce((n,r)=>n+r.words,0),245760);assert.equal(raw.reduce((n,r)=>n+r.violations,0),50)
 // Separate, earlier signal-only negatives. Their captures are not installed
 // R3 or original-scene acceptance, and this does not extend them to SwiftShader.
 const old=await readJson(join(folder,'color-evidence-r1.json')),oldNative='/tmp/scenetoweb-box-color-native-r1',oldBrowser='/tmp/scenetoweb-box-color-browser-r1',n=JSON.parse(await pinned(join(oldNative,'native.json'),old.nativeSha256)),b=JSON.parse(await pinned(join(oldBrowser,'browser.json'),old.browserSha256)),negatives=[]
 for(const api of b.apis)for(const nr of n.rows.filter(r=>r.id.endsWith('-color'))){const id=nr.id.slice(0,-6),maskRow=n.rows.find(r=>r.id===id+'-mask'),actualMaskRow=api.materialColorRows.find(r=>r.id==='material-'+id+'-mask');assert.ok(maskRow&&actualMaskRow);const mask=coverage(floats(await pinned(join(oldNative,maskRow.file),maskRow.sha256),64,4)),actualMask=coverage(floats(lowerLeftRows(await pinned(join(oldBrowser,actualMaskRow.file),actualMaskRow.sha256),api.backend,64,4),64,4)),reference=floats(await pinned(join(oldNative,nr.file),nr.sha256),64,4)
  for(const kind of['unmapped','unmixed']){const row=api.materialColorRows.find(r=>r.id==='material-'+id+'-'+kind);assert.ok(row);const actual=floats(lowerLeftRows(await pinned(join(oldBrowser,row.file),row.sha256),api.backend,64,4),64,4),result=visualDiagnostic(reference,actual,mask,actualMask,64,4);negatives.push({dataset:'earlier-color-signal-only-not-installed-or-cross-gpu',backend:api.backend,id,negative:kind,...result})}
 }
 assert.equal(negatives.length,24)
 const result={status:'VISUAL_POLICY_V1_DIAGNOSTICS_ONLY_REQUIRES_REVIEW',supportCredit:0,materialCredit:0,sceneCredit:0,policy,policySourceSha256:sha(await readFile(join(folder,'visual-color-policy.mjs'))),readerSha256:sha(await readFile(import.meta.filename)),inputReceiptSha256:sha(await readFile(join(folder,'installed-evidence-r3.json'))),strictRetained:{words:245760,violations:50,unchanged:true,rawRows:204},summary:[...tuples].map(tuple=>{const r=rows.filter(x=>x.tuple===tuple);return{tuple,frames:r.length,proposalSatisfied:r.every(x=>x.proposalSatisfied),displayViolations:r.reduce((s,x)=>s+x.display.violations,0),maximumDisplayCodeDifference:Math.max(...r.map(x=>x.display.maxCodeDifference)),xorPixels:r.reduce((s,x)=>s+x.geometry.xorPixels,0),outlineOutsideOnePixel:r.reduce((s,x)=>s+x.geometry.outlineOutsideOnePixel,0),topologyOrEndpointFailures:r.filter(x=>!x.geometry.foreground.oneToOne||!x.geometry.holes.oneToOne||x.geometry.missingEndpoints>0).length,mappingSameCoverageViolations:r.reduce((s,x)=>s+x.mappingSameValidCoverage.violations,0)}}),prerequisites:{allFiveSourceChannelsAndOpaqueAlphaPinned:true,strictInputMipMathRequirementsUnchanged:true,resourceRepairGpuValidationStillPending:true,existingPhysicalLifecycleAndLowLevelStateProofsRemainRequired:true,range:'Unlit opaque LDR color field only; no BRDF, HDR, NormalMap, original camera or whole-scene claim'},negativeSummary:{dataset:'Earlier signal-only original-camera controls, not installed R3',rows:negatives.length,discriminating:negatives.filter(x=>!x.proposalSatisfied&&x.display.violations>0).length,wrongUvSyntheticOnly:true},rows,raw,negatives}
 return result
}
const output=process.argv[2];assert.ok(output,'Supply a new diagnostic JSON path');const result=await run();await writeFile(resolve(output),JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({status:result.status,strictRetained:result.strictRetained,summary:result.summary,negativeSummary:result.negativeSummary},null,2))
