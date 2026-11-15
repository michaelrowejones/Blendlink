/* SPDX-License-Identifier: MIT */
import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile,mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,dirname} from 'node:path'
import {createHash} from 'node:crypto'
import {assertPackagedInputs} from './inputs.mjs'
import {cases,expectedFrames,nativeFrames,assertSources,assertFinal,expectedFinalProvenance,assertSourcePolicy,assertProgram,assertBaseline,assertComparison,assertNative,exactMetric,displayMetric,statuses,refusalIds} from './protocol.mjs'
import {failurePacket} from './browser-contract.mjs'
import {displaceSourcesFixture,displaceFinalFixture,displaceNativeFixture,displaceSourceInputsFixture} from './schema-fixtures.mjs'
const pin='a'.repeat(64),word=n=>new Uint32Array(new Float32Array([n]).buffer)[0]
function program(definition=cases[0]){
 const source={id:'image',kind:'render-pass',type:'RGBA',source:{nodeType:'CompositorNodeRLayers',output:'Image'},inputs:{},properties:{},pass:{pass:'Image'}}
 const op={id:'displace',kind:'translate',type:'RGBA',source:{nodeType:'CompositorNodeDisplace',output:'Image'},inputs:{Image:{name:'Image',socketType:'RGBA',value:{kind:'ref',node:'image',type:'RGBA'}}},properties:{displace_model:'native-displace-single-domain-cpu-53-v1',displace_profile:'darwin-arm64-53-displace-single-cpu-v1',displace_words:[...definition.displacementWords],displace_source_kind:definition.source,image_interpolation:definition.interpolation,image_sampling_model:'modern-cpu-v1',displace_requested_precision:'FULL',evaluation_device:'CPU',displace_max_pixels:4194304,displace_image_words:null,displace_version:[5,3,0],displace_build:'02f0899d78e3',single_value_device:'CPU',image_domain_model:'native-translation-v2',displace_export_extent:[13,9],image_translation:definition.displacementWords.map(w=>new Float32Array(new Uint32Array([w]).buffer)[0])}}
 return{status:'extracted',ops:[source,op],passes:[source.pass],output:{kind:'ref',node:op.id,type:'RGBA'}}
}
function hostGeometryFixture(phase){return cases.map(row=>row.case).concat(phase==='compare'?['detached-cancellation']:[]).map((label,index)=>({case:label,geometryId:index+10,geometryUuid:'00000000-0000-4000-8000-'+String(index).padStart(12,'0'),sharedBaseline:1,warmedBaseline:2,registeredBeforeWarm:false,registeredAfterWarm:true,warmBeforeCalls:1,warmAfterCalls:1,cycles:Array.from({length:label==='detached-cancellation'?2:phase==='compare'?3:1},(_,cycle)=>({cycle,geometryId:index+10,geometries:2,geometryDisposals:0,materialDisposals:0,sameGeometry:true,registered:true})),geometryDisposals:1,materialDisposals:1,afterCallerCleanup:1,registeredAfterCleanup:false}))}
function baseline(profile='metal'){
 return{status:statuses.baseline,phase:'baseline',profile,apis:['webgpu','webgl2'].map(backend=>({backend,gpu:backend==='webgpu'?{api:'WebGPU',vendor:profile==='metal'?'Apple':'SwiftShader'}:{api:'WebGL2',renderer:profile==='metal'?'ANGLE Metal Apple':'ANGLE SwiftShader'},errors:[],pageErrors:[],httpErrors:[],uncaptured:[],hostGeometryControls:hostGeometryFixture('baseline'),rows:expectedFrames(profile,backend).map(frame=>({...frame,scenePassType:'HalfFloatType',scenePassSamples:0,sourcePreserved:true,installedProgramPreserved:true,baselineFile:'frames/'+frame.id+'.rgba32f',baselineSha256:pin,baselineWords:frame.width*frame.height*4,hostRestored:true,textureBaselineRestored:true}))}))}
}
function comparison(profile='metal'){
 const report=baseline(profile);report.status=statuses.browser;report.phase='compare'
 for(const api of report.apis){api.hostGeometryControls=hostGeometryFixture('compare');api.controls=[...refusalIds,'detached-dispose','cancel-before-ready'].map(id=>({case:id,passed:true,hostRestored:true,textureBaselineRestored:true,...id==='saved-original-dispose'?{ownedTextures:3,physicalDestroys:[1,1,1],error:'Displace renderer allocation epoch changed'}:refusalIds.includes(id)?{error:'Displace requires full-frame target',allocationPastPixelBudget:false,recovered:true,numericalCredit:0}:{}}));for(const row of api.rows){const words=row.width*row.height*4,exact={words,wordDifferences:0,examples:[],sha256:pin},display={words,wordDifferences:0,alphaWordDifferences:0,nonfiniteClassDifferences:0,maxClampedAbsoluteError:0,projectionContract:'existing-ocio-png-clamp01-3e-5',projectionAccepted:true,sha256:pin};Object.assign(row,{baselineStable:true,direct:exact,cycles:Array.from({length:3},(_,cycle)=>({cycle,commitDraws:0,installedDraws:4,repeatedDraws:4,probeDraws:cases.find(c=>c.case===row.case).source==='render-layer'?2:1,repeatedProbeDraws:cases.find(c=>c.case===row.case).source==='render-layer'?2:1,installedFrame:cycle*10+1,repeatedFrame:cycle*10+2,probeFrame:cycle*10+1,repeatedProbeFrame:cycle*10+2,preparationHostRestored:true,sourceMaterialsPreserved:true,textureBaselineRestored:true,installed:exact,repeated:exact,display,repeatedDisplay:display}))})}}
 return report
}
test('case census is an exact independent cross product plus genuine group/reroute/constants',()=>{
 assert.equal(cases.length,16)
 const expected=['nearest','bilinear'].flatMap(mode=>['origin','integer','fractional','ordinary','minimum','maximum'].map(setting=>mode+'-'+setting)).concat(['nearest-group','bilinear-reroute','nearest-rgb','bilinear-default'])
 assert.deepEqual(cases.map(row=>row.case),expected)
 assert.equal(new Set(cases.map(row=>row.case)).size,16)
 assert.equal(expectedFrames('metal','webgpu').length,40);assert.equal(nativeFrames().length,160)
 for(const definition of cases){assert.equal(definition.displacementWords.length,2);for(const frame of definition.frames)assert.ok(frame.width>=4&&frame.height>=4&&frame.width<=8192&&frame.height<=8192&&frame.width*frame.height<=4194304)}
 assert.equal(cases.find(row=>row.setting==='minimum').displacementWords[0],word(2**-16))
 assert.deepEqual(cases.find(row=>row.setting==='maximum').displacementWords,[word(8192),word(-8192)])
})
test('actual lexicographically serialized native program is checked semantically before export',()=>{
 const p=program(),serialized=JSON.stringify(p,(_key,value)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.entries(value).sort()):value)
 assertProgram(JSON.parse(serialized),cases[0])
 for(const mutate of[p=>p.ops[1].source.nodeType='CompositorNodeTranslate',p=>p.ops[1].properties.displace_words[0]=1,p=>p.ops[1].properties.displace_requested_precision='AUTO',p=>p.ops[1].inputs.Displacement={},p=>delete p.ops[1].inputs.Image,p=>p.output.node='image']){const q=program();mutate(q);assert.throws(()=>assertProgram(q,cases[0]))}
})
test('baseline protocol rejects missing/reordered frame IDs and hardware masquerading as software',()=>{
 assertBaseline(baseline(),'metal');assertBaseline(baseline('software'),'software')
 for(const mutate of[r=>r.apis[0].rows.pop(),r=>r.apis[0].rows.reverse(),r=>r.apis[0].rows[0].baselineWords--,r=>r.apis[0].rows[0].scenePassSamples=4,r=>r.apis[0].rows[0].baselineFile='other']){const q=baseline();mutate(q);assert.throws(()=>assertBaseline(q,'metal'))}
 const q=baseline('software');q.apis[1].gpu.renderer='ANGLE Google Intel';assert.throws(()=>assertBaseline(q,'software'))
})
test('installed protocol rejects duplicate cycles, wrong actual API, missing controls and truncated metrics',()=>{
 assertComparison(comparison(),'metal')
 for(const mutate of[r=>r.apis[0].rows[0].cycles[2].cycle=0,r=>r.apis[0].controls.pop(),r=>r.apis[0].rows[0].cycles[0].installed={words:4,wordDifferences:0,sha256:pin},r=>r.apis[0].rows[0].cycles[0].display.maxClampedAbsoluteError=3.1e-5,r=>r.apis[0].gpu.api='WebGL2',r=>r.apis[0].rows.reverse()]){const q=comparison();mutate(q);assert.throws(()=>assertComparison(q,'metal'))}
})
test('native references require exact frame columns and two actual CPU renders per frame',()=>{
 const report=displaceNativeFixture()
 assertNative(report)
 for(const mutate of[q=>q.rows.reverse(),q=>q.rows[0].extra=1,q=>q.rows[0].copyDifferences=1,q=>q.sourceImageProducerCredit=1,q=>q.nativeRenders=160]){const q=structuredClone(report);mutate(q);assert.throws(()=>assertNative(q))}
})
test('independent raw words retain sign, alpha, zero and display distinction',()=>{
 const a=new Uint32Array(new Float32Array([.25,.5,1,0]).buffer),b=a.slice();b[0]++
 assert.equal(exactMetric(a,b).wordDifferences,1);assert.equal(displayMetric(a,b).projectionAccepted,true)
 const zero=new Uint32Array([0,0x80000000,0,word(1)]),positive=new Uint32Array([0,0,0,word(1)])
 assert.equal(exactMetric(zero,positive).wordDifferences,1)
 const alpha=positive.slice();alpha[3]--;assert.equal(displayMetric(alpha,positive).projectionAccepted,false)
})
test('capture validates actual programs before exports and matrix preflight precedes native work',async()=>{
 const capture=await readFile(new URL('./capture.mjs',import.meta.url),'utf8'),matrix=await readFile(new URL('./matrix.mjs',import.meta.url),'utf8')
 assert.ok(capture.indexOf('for(const row of source.rows)assertProgram')<capture.indexOf("await run(process.execPath,['node_modules/vitest"))
 assert.ok(matrix.indexOf("await run(['--test'")<matrix.indexOf("await run(['experiments/compositor-displace-single/policy.mjs'"))
 assert.ok(capture.includes('createNodePortBlenderLauncher'));assert.ok(capture.includes('archiveNativeLauncher'));assert.ok(matrix.includes('600000'))
})
test('actual browser fixture uses public preparation and actual pipeline probes, never a replacement sampler',async()=>{
 const source=await readFile(new URL('./browser.js',import.meta.url),'utf8')
 assert.match(source,/startThreeCompiledScenePreparation/);assert.match(source,/prepared\.commit\(\)/);assert.match(source,/owner\.pipeline\.sourceCompositor\.node/)
 assert.match(source,/actualCreate\.apply\(this,args\)/);assert.match(source,/savedOriginalDispose\(\)/)
 assert.doesNotMatch(source,/prepareEllipseSceneDecoder|sceneFrame:|bilinearKernel|lerp\(/)
 const reference=await readFile(new URL('./reference.py',import.meta.url),'utf8')
 assert.match(reference,/tree\.nodes\.new\('CompositorNodeDisplace'\)/);assert.match(reference,/assert extraction==\('unsupported'/)
})

test('policy case contract rejects reordered or duplicated native IDs before source capture',async()=>{
 const report=JSON.parse(await readFile(new URL('./policy-schema.json',import.meta.url),'utf8'))
 assertSourcePolicy(report)
 for(const mutate of[r=>r.policy.positive.reverse(),r=>r.policy.refusals[1]=r.policy.refusals[0],r=>r.policy.nativeRenders=1]){const q=structuredClone(report);mutate(q);assert.throws(()=>assertSourcePolicy(q))}
})

test('saved-dispose checks three real texture handles at native destruction primitives',async()=>{
 const source=await readFile(new URL('./browser.js',import.meta.url),'utf8')
 assert.match(source,/owned.length!==3/);assert.match(source,/handle.destroy=\(\)=>\{counts\[index\]\+\+/);assert.match(source,/gl.deleteTexture=handle=>/)
 const q=comparison();q.apis[0].controls.find(control=>control.case==='saved-original-dispose').physicalDestroys=[1,0,1]
 assert.throws(()=>assertComparison(q,'metal'))
})

test('Final primary Python/addon provenance rejects missing, duplicate, stale and wrong artifact routes',()=>{
 const inputs=displaceSourceInputsFixture(),sources=displaceSourcesFixture(),final=displaceFinalFixture(sources,inputs);assertSources(sources);assertFinal(final,sources,inputs)
 for(const change of[f=>f.provenance.pop(),f=>f.provenance.push(f.provenance[0]),f=>f.provenance[0].sha256='c'.repeat(64),f=>f.provenance[0].artifact='packages/blendlink/dist/wrong.py']){const copy=structuredClone(final);change(copy);assert.throws(()=>assertFinal(copy,sources,inputs))}
 assert.throws(()=>expectedFinalProvenance({}))
 const sorted=expectedFinalProvenance({'packages/blendlink/blender/presentation_ui.py':pin,'packages/blendlink/blender/presentation.py':pin});assert.deepEqual(sorted.map(row=>row.source),['packages/blendlink/blender/presentation.py','packages/blendlink/blender/presentation_ui.py'])
})

test('failure diagnostic retains raw sign/NaN words and cannot qualify as browser evidence',()=>{
 const raw=new Uint32Array([0x80000000,0x7fc12345,0xff800000,word(1)]),packet=failurePacket(Error('numeric gate failed'),{phase:'compare',profile:'metal',backend:'webgpu'},{id:'owned',buffers:[{role:'installed-0',words:raw}]})
 assert.equal(packet.status,statuses.failed);assert.equal(packet.supportCredit,0);assert.deepEqual(packet.failureFrame.buffers[0].words,[...raw]);assert.throws(()=>assertComparison(packet,'metal'))
})
test('failure artifacts are saved before browser errors are rethrown and animation setup rejections propagate',async()=>{
 const host=await readFile(new URL('./run.mjs',import.meta.url),'utf8'),browser=await readFile(new URL('./browser.js',import.meta.url),'utf8')
 assert.ok(host.indexOf("join(destination,'failed-readbacks')")<host.indexOf('throw Error(result.error)'))
 assert.match(browser,/setAnimationLoop[\s\S]*\.catch\(reject\)/);assert.match(browser,/return failurePacket\(error/)
 assert.match(host,/channel:'chromium'/)
})

test('all raw/Final API packets require no uncaptured GPU errors and independently bind refusal results',()=>{
 for(const check of[assertBaseline,assertComparison])for(const change of[q=>delete q.apis[0].uncaptured,q=>q.apis[0].uncaptured.push('validation error')]){const q=check===assertBaseline?baseline():comparison();change(q);assert.throws(()=>check(q,'metal'))}
 for(const change of[q=>delete q.apis[0].controls[0].error,q=>q.apis[0].controls[0].allocationPastPixelBudget=true,q=>q.apis[0].controls[0].numericalCredit=1,q=>q.apis[0].controls.find(c=>c.case==='saved-original-dispose').error='other']){const q=comparison();change(q);assert.throws(()=>assertComparison(q,'metal'))}
})

test('stale actual packaged Python/addon bytes refuse before Final exports',async()=>{
 const root=await mkdtemp(join(tmpdir(),'scenetoweb-displace-provenance-')),bytes=Buffer.from('owned source bytes'),sha256=createHash('sha256').update(bytes).digest('hex'),rows=expectedFinalProvenance({'packages/blendlink/blender/policy.py':sha256,'packages/blender-addon/settings.json':sha256})
 try{for(const row of rows)for(const path of[row.source,row.artifact]){const file=join(root,path);await mkdir(dirname(file),{recursive:true});await writeFile(file,bytes)}await assertPackagedInputs(root,rows);await writeFile(join(root,rows[1].artifact),'stale copy');await assert.rejects(assertPackagedInputs(root,rows),/Packaged Python\/addon drift/)}finally{await rm(root,{recursive:true,force:true})}
 const source=await readFile(new URL('./export.test.ts',import.meta.url),'utf8');assert.ok(source.indexOf('await assertPackagedInputs')<source.indexOf('await syncAll'))
})

test('caller geometry is independently warmed, preserved through every install, then retired by the caller',()=>{
 for(const mutate of[r=>r.apis[0].hostGeometryControls.pop(),r=>r.apis[0].hostGeometryControls[0].warmedBaseline=1,r=>r.apis[0].hostGeometryControls[0].cycles[0].geometries++,r=>r.apis[0].hostGeometryControls[0].cycles[0].geometryDisposals=1,r=>r.apis[0].hostGeometryControls[0].cycles[0].sameGeometry=false,r=>r.apis[0].hostGeometryControls[0].registeredAfterCleanup=true,r=>r.apis[0].hostGeometryControls[0].afterCallerCleanup=2]){const q=comparison();mutate(q);assert.throws(()=>assertComparison(q,'metal'))}
})
test('caller warm-up uses its own public scene render, without a port output or cache mutation',async()=>{
 const text=await readFile(new URL('./browser.js',import.meta.url),'utf8'),begin=text.indexOf(' const makeHost=async'),end=text.indexOf(' const observeHostCycle',begin),warm=text.slice(begin,end)
 assert.match(warm,/renderer\.render\(scene,camera\)/);assert.match(warm,/mesh\.position\.x=1000/);assert.match(warm,/geometryDisposeListeners\.has\(geometry\)/)
 assert.doesNotMatch(warm,/buildSourceCompositor|sourceCompositor|fragmentNode|\.dispose\(|geometryDisposeListeners\.(?:set|delete|clear)\(/)
 assert.match(text,/record\.geometry\.dispose\(\);record\.material\.dispose\(\);assertBaseline\(\)/)
})

test('installed frame samples queue display and linear reads before any asynchronous map can advance NodeFrame',async()=>{
 const {sampleInstalledFrame}=await import('./same-frame.mjs');let id=7,draws=0,target='none',events=[];const settles=[]
 const sample=sampleInstalledFrame({frame:async callback=>{events.push('animation');callback();id++},render:()=>{events.push('installed');draws+=5;target='display'},read:()=>{const captured=target;events.push('read-'+captured);return new Promise(resolve=>settles.push(()=>resolve(captured)))},probe:()=>{events.push('probe');draws+=2;target='linear';return 2},frameId:()=>id,drawCalls:()=>draws})
 assert.deepEqual(events,['animation','installed','read-display','probe','read-linear']);assert.equal(settles.length,2)
 settles.forEach(settle=>settle());const row=await sample
 assert.deepEqual(row,{installedDraw:{frame:7,draws:5},probeDraws:2,probeFrame:7,display:'display',linear:'linear'})
 const browser=await readFile(new URL('./browser.js',import.meta.url),'utf8');assert.match(browser,/probe:\(\)=>probeNode\(owner\.pipeline\.sourceCompositor\.node\)/)
})

test('failure context bounds completed-frame payload while preserving exact current-frame words and prior measured digests',()=>{
 const raw=new Uint32Array([0x80000000,0x7fc12345,0xff800000,word(1)]),rows=[{id:'done',direct:{words:4,sha256:pin},cycles:[{installed:{words:4,sha256:pin}}],buffers:[{role:'direct',words:raw},{role:'installed-0',words:raw}]}],q=failurePacket(Error('four-word numeric failure'),{rows},{id:'current',buffers:[{role:'direct',words:raw}]})
 assert.equal(q.status,statuses.failed);assert.equal(q.supportCredit,0);assert.equal(q.rows[0].buffers,undefined);assert.deepEqual(q.rows[0].unarchivedReadbacks,[{role:'direct',wordCount:4,sha256:pin},{role:'installed-0',wordCount:4,sha256:pin}]);assert.deepEqual(q.failureFrame.buffers[0].words,[...raw]);assert.deepEqual(q.rows[0].direct,rows[0].direct);assert.equal(rows[0].buffers[0].words,raw);assert.throws(()=>assertComparison(q,'metal'))
})

test('raw streaming and its ownership tests stay before native capture and keep current-frame failure bytes',async()=>{
 const browser=await readFile(new URL('./browser.js',import.meta.url),'utf8'),run=await readFile(new URL('./run.mjs',import.meta.url),'utf8'),verify=await readFile(new URL('./verify.mjs',import.meta.url),'utf8'),matrix=await readFile(new URL('./matrix.mjs',import.meta.url),'utf8')
 assert.ok(browser.indexOf('if(metric.wordDifferences)')<browser.indexOf("role:'direct',words:got"));assert.ok(browser.indexOf('if(measured.installed.wordDifferences')<browser.indexOf("role:role+'-'+cycle,words"));assert.doesNotMatch(browser,/row\.buffers\.push|buffers:\[\{role:'direct',words:Array\.from/)
 assert.match(run,/readbackArchive\.assertRow\(row\)/);for(const text of[run,verify])assert.match(text,/'readback-transport.mjs'/)
 assert.ok(matrix.indexOf('readback-server.test.mjs')<matrix.indexOf("experiments/compositor-displace-single/policy.mjs"));assert.match(run,/failed-readbacks/)
})
