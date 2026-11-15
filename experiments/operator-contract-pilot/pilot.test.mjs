import assert from'node:assert/strict'
import test from'node:test'
import{readFile,mkdtemp,writeFile,symlink,rm}from'node:fs/promises'
import{tmpdir}from'node:os'
import{join}from'node:path'
import{spawnSync}from'node:child_process'
import{decode,encode,caseCounts,descriptorSha256}from'./generated/contracts.ts'
import{replay,sha256}from'./transport.mjs'
const base=new URL('./',import.meta.url),manifest=JSON.parse(await readFile(new URL('fixtures/manifest.json',base))),rows=[]
for(const row of manifest.rows)rows.push({...row,program:JSON.parse(await readFile(new URL('fixtures/'+row.programFile.file,base)))})
const sample=(family,name)=>structuredClone(rows.find(r=>r.family===family&&r.case===name))
const mutations=[]
function mutate(family,name,label,change){const row=sample(family,name);change(row.program);mutations.push({family,case:label,program:row.program})}
for(const[family,name]of[['integer-vector3','int3-extremes'],['finite-image-info','blank-dimensions']]){
 mutate(family,name,'missing output',p=>delete p.output);mutate(family,name,'unknown root field',p=>p.forged=true);mutate(family,name,'wrong version',p=>p.version=2);mutate(family,name,'wrong engine',p=>p.engine='BLENDER_EEVEE_NEXT');mutate(family,name,'unknown op field',p=>p.ops[0].forged=1);mutate(family,name,'wrong source class',p=>p.ops[0].source.nodeType='ShaderNodeValue');mutate(family,name,'missing properties',p=>delete p.ops[0].properties);mutate(family,name,'unknown property',p=>p.ops[0].properties.forged=1);mutate(family,name,'GPU context',p=>p.ops[0].properties.evaluation_device='GPU');mutate(family,name,'unsupported output width',p=>p.output.type='INT_VECTOR4')
}
for(const[value,label]of[[[0,0],'narrow width'],[[0,0,0,0],'wide width'],[[2147483648,0,0],'overflow'],[[-2147483649,0,0],'underflow'],[[true,0,0],'bool'],[[.5,0,0],'fraction'],[[-0.0,0,0],'signed zero']])mutate('integer-vector3','int3-extremes',label,p=>p.ops[0].value=value)
mutate('finite-image-info','blank-dimensions','wrong input name',p=>p.ops[1].inputs.Image.name='Mask')
mutate('finite-image-info','blank-dimensions','unknown binding field',p=>p.ops[1].inputs.Image.forged=true)
mutate('finite-image-info','blank-dimensions','unsupported model',p=>p.ops[1].properties.image_info_model='render-layers')
mutate('finite-image-info','blank-dimensions','invalid size width',p=>p.ops[1].properties.image_info_finite_size=[5])
mutate('finite-image-info','png-dimensions','missing image record model',p=>delete Object.values(p.images)[0].model)
test('generated TS and Python codecs agree on all historical native programs and structural mutations',()=>{
 for(const row of rows){assert.equal(decode(row.family,row.program),row.program);assert.deepEqual(JSON.parse(encode(row.family,row.program)),row.program)}
 for(const row of mutations)assert.throws(()=>decode(row.family,row.program),undefined,row.family+'/'+row.case)
 // JSON.stringify would erase -0; retain it in the Python transport explicitly.
 const input=JSON.stringify([...rows,...mutations].map(({family,program})=>({family,program})))
 const payload=JSON.parse(input);payload[rows.length+mutations.findIndex(r=>r.case==='signed zero')].program.ops[0].value=['__NEGATIVE_ZERO__',0,0]
 const json=JSON.stringify(payload).replace('"__NEGATIVE_ZERO__"','-0.0')
 const result=spawnSync('python3',[new URL('python-check.py',base).pathname],{input:json,encoding:'utf8',env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}})
 assert.equal(result.status,0,result.stderr);const output=JSON.parse(result.stdout);assert.deepEqual(output.accepted,[...rows.map(()=>true),...mutations.map(()=>false)]);assert.deepEqual(output.counts,caseCounts)
})
test('case counts derive both complete/calibration-separated censuses',()=>{
 assert.deepEqual(Object.fromEntries(Object.entries(caseCounts).map(([k,v])=>[k,[v.nativeGraphs,v.productionNativeGraphs,v.savedFinalScenes,v.productionSavedFinalScenes,v.browserCaseRuns,v.productionBrowserCaseRuns,v.primaryWords,v.productionPrimaryWords,v.allReadWords,v.captures]])),{'integer-vector3':[16,15,8,7,96,88,24576,22528,57344,224],'finite-image-info':[21,20,8,7,116,108,29696,27648,67584,264]})
})
test('existing semantic program validators still accept the same exact fixtures',async()=>{
 const previous=process.env.SCENETOWEB_SWITCH_VARIANT
 try{for(const family of Object.keys(caseCounts)){process.env.SCENETOWEB_SWITCH_VARIANT=family;const protocol=await import('../static-switch-family/protocol.mjs?pilot='+family),fn=family==='integer-vector3'?protocol.assertIntegerVectorProgram:protocol.assertFiniteImageInfoProgram,plan=JSON.parse(await readFile(new URL('../../'+caseCounts[family].casePlan,base)));for(const row of rows.filter(r=>r.family===family))fn(row.program,plan.find(c=>c.case===row.case))}}finally{if(previous===undefined)delete process.env.SCENETOWEB_SWITCH_VARIANT;else process.env.SCENETOWEB_SWITCH_VARIANT=previous}
})
test('shared transport replays both families with exact native word comparison and no new credit',async()=>{
 const value=await replay();assert.equal(value.nativePrograms,37);assert.equal(value.nativeWords,9472);assert.equal(value.numericalCredit,0);assert.equal(value.supportPromotion,false)
})
test('shared transport rejects missing/duplicate cases, changed bytes and an independently wrong native word',async()=>{
 for(const change of[m=>m.rows.pop(),m=>m.rows[1]=m.rows[0]]){const m=structuredClone(manifest);change(m);await assert.rejects(replay({manifestOverride:m}))}
 await assert.rejects(replay({bytesOverride:(file,bytes)=>{if(file.endsWith('.rgba32f')){const b=Buffer.from(bytes);b[0]^=1;return b}return bytes}}),/Pinned artifact drift/)
 const m=structuredClone(manifest),row=m.rows[0],original=await readFile(new URL('fixtures/'+row.pixelFile.file,base)),bad=Buffer.from(original);bad.writeUInt32LE(bad.readUInt32LE(0)^1,0);row.pixelFile.sha256=sha256(bad)
 await assert.rejects(replay({manifestOverride:m,bytesOverride:(file,bytes)=>file===row.pixelFile.file?bad:bytes}),/Independent declared native word/)
})
test('transport refuses symlink escape; it does not bless externally substituted files',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'operator-contract-pilot-'))
 try{await writeFile(join(dir,'manifest.json'),JSON.stringify(manifest));await symlink(new URL('fixtures/integer-vector3/',base),join(dir,'integer-vector3'),'dir');await assert.rejects(replay({directory:dir}),/escaped/)}finally{await rm(dir,{recursive:true,force:true})}
})
test('structural contracts deliberately do not replace semantic typed-edge policy',async()=>{
 const row=sample('integer-vector3','int3-extremes');row.program.output.input.node='missing';decode(row.family,row.program)
 const previous=process.env.SCENETOWEB_SWITCH_VARIANT;process.env.SCENETOWEB_SWITCH_VARIANT='integer-vector3'
 try{const p=await import('../static-switch-family/protocol.mjs?pilot=semantic-limit'),plan=JSON.parse(await readFile(new URL('../../'+caseCounts[row.family].casePlan,base)));assert.throws(()=>p.assertIntegerVectorProgram(row.program,plan.find(c=>c.case===row.case)))}finally{if(previous===undefined)delete process.env.SCENETOWEB_SWITCH_VARIANT;else process.env.SCENETOWEB_SWITCH_VARIANT=previous}
})

test('generated contracts are deterministic and detect descriptor/case-plan drift',async()=>{
 assert.equal(descriptorSha256,sha256(await readFile(new URL('descriptor.mjs',base))))
 for(const c of Object.values(caseCounts)){const bytes=await readFile(new URL('../../'+c.casePlan,base));assert.equal(sha256(bytes),c.casePlanSha256);const changed=JSON.parse(bytes);changed.pop();assert.notEqual(sha256(JSON.stringify(changed)),c.casePlanSha256);assert.notEqual(changed.length,c.nativeGraphs)}
 const names=['contracts.ts','contracts.py','counts.json'],before=await Promise.all(names.map(n=>readFile(new URL('generated/'+n,base),'utf8')))
 const child=spawnSync(process.execPath,[new URL('generate.mjs',base).pathname],{encoding:'utf8'});assert.equal(child.status,0,child.stderr)
 assert.deepEqual(await Promise.all(names.map(n=>readFile(new URL('generated/'+n,base),'utf8'))),before)
})

test('shared transport retains independent family edge policy after structural decoding',async()=>{
 const m=structuredClone(manifest),row=m.rows.find(r=>r.family==='integer-vector3'&&r.case==='int3-extremes'),program=sample(row.family,row.case).program;program.output.input.node='missing';const bytes=Buffer.from(JSON.stringify(program));row.programFile.sha256=sha256(bytes)
 await assert.rejects(replay({manifestOverride:m,bytesOverride:(file,original)=>file===row.programFile.file?bytes:original}))
})
