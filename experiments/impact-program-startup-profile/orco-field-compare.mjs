import assert from'node:assert/strict'
import{readFile,writeFile}from'node:fs/promises'
import{resolve,join}from'node:path'
import{createHash}from'node:crypto'
import{compare}from'../box-image-transport-prototype/compare.mjs'
import{lowerLeftRows}from'../box-image-storage-stage/orientation-check.mjs'
import{validateNativeArchive}from'../../scripts/lib/native-proof-archive.mjs'
const sha=b=>createHash('sha256').update(b).digest('hex')
export async function closeOrcoField(nativeDir,browserDir){
 const native=JSON.parse(await readFile(join(nativeDir,'native.json'))),browser=JSON.parse(await readFile(join(browserDir,'browser.json'))),root=resolve(import.meta.dirname,'../..')
 assert.equal(native.status,'NATIVE_EEVEE_ORCO_FIELD_RESEARCH_ZERO_CREDIT');assert.equal(native.sourcePreserved,true);assert.equal(native.fieldGate,2**-10);assert.equal(native.maskGate,0)
 assert.equal(native.captureSha256,sha(await readFile(join(import.meta.dirname,'orco-field-native.py'))));assert.equal(browser.nativeSha256,sha(await readFile(join(nativeDir,'native.json'))));assert.equal(browser.status,'BROWSER_ORCO_FIELD_RESEARCH_ZERO_CREDIT');assert.deepEqual(browser.errors,[])
 for(const[name,key]of[['orco-field-browser.js','browserSourceSha256'],['orco-attribute.mjs','attributeSourceSha256']])assert.equal(sha(await readFile(join(import.meta.dirname,name))),browser[key])
 await validateNativeArchive(JSON.parse(await readFile(join(nativeDir,'native-archive.json'))),nativeDir,{expectedFinalSources:[],expectedScripts:[{path:join(import.meta.dirname,'orco-field-native.py'),invocations:1}],helperInputs:{helper:join(root,'scripts/lib/node-port-python.mjs'),bridge:join(root,'scripts/node-port-blender.mjs')}})
 for(const item of native.cases){const r=native.renderSnapshots[item.id];assert.equal(r.depsgraphMode,'RENDER');assert.deepEqual(r.position,item.position);assert.deepEqual(r.index,item.index);assert.deepEqual(r.normal,item.normal);assert.deepEqual(r.originalTexspace,item.texspace)}
 const rows=[]
 for(const api of browser.apis){assert.deepEqual(api.errors,[]);for(const row of api.rows){const reference=native.rows.find(r=>r.case===row.case&&r.kind===(row.kind==='wrong-bbox'?'generated':row.kind));assert.ok(reference);const raw=await readFile(join(browserDir,row.file)),expected=await readFile(join(nativeDir,reference.file));assert.equal(sha(raw),row.sha256);assert.equal(sha(expected),reference.sha256);rows.push({api:api.backend,case:row.case,basis:row.basis,kind:row.kind,...compare(lowerLeftRows(raw,api.backend,64,64),expected,row.kind==='mask'?0:native.fieldGate)})}}
 const positives=rows.filter(r=>r.kind!=='wrong-bbox'),negatives=rows.filter(r=>r.kind==='wrong-bbox'),totals=['mask','position','generated'].map(kind=>{const r=positives.filter(r=>r.kind===kind);return{kind,words:r.reduce((s,v)=>s+v.words,0),violations:r.reduce((s,v)=>s+v.violations,0),maxAbs:Math.max(...r.map(v=>v.maxAbs))}})
 const passed=positives.every(r=>r.violations===0)&&negatives.every(r=>r.violations>0)
 return{status:passed?'ORCO_EMISSION_FIELD_CONTROLS_PASSED_NOT_SCENE_QUALIFIED':'ORCO_EMISSION_FIELD_CONTROLS_FAILED',supportCredit:0,sceneAcceptance:false,passed,nativeSha256:browser.nativeSha256,browserSha256:sha(await readFile(join(browserDir,'browser.json'))),totals,rows}
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(import.meta.filename)){const r=await closeOrcoField(resolve(process.argv[2]),resolve(process.argv[3]));await writeFile(resolve(process.argv[4]),JSON.stringify(r,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({status:r.status,totals:r.totals,negative:r.rows.filter(x=>x.kind==='wrong-bbox').map(x=>x.violations)}))}
