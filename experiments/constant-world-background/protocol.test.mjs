import ts from 'typescript'
import test from'node:test';import assert from'node:assert/strict';import{readFileSync}from'node:fs';import{cases,controlCases,sizes,plan,word,assertQualification,assertFinal,assertBrowser,browserProofContract}from'./protocol.mjs'
// The one authored constant shader is an independent renderer-cache warm-up,
// before the baseline. Actual World output must always use the default installer.
function assertIndependentWarmupOnly(browser){
 const file=ts.createSourceFile('browser.js',browser,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),assignments=[];let mentions=0
 const visit=node=>{
  if(ts.isIdentifier(node)&&node.text==='quadMaterial')mentions++
  if(ts.isBinaryExpression(node)&&node.operatorToken.kind===ts.SyntaxKind.EqualsToken&&ts.isPropertyAccessExpression(node.left)&&node.left.name.text==='fragmentNode')assignments.push(node)
  ts.forEachChild(node,visit)
 };visit(file)
 assert.equal(assignments.length,1,'Only the independent cache warm-up may author a fragment node')
 const node=assignments[0],call=node.right
 assert.ok(ts.isIdentifier(node.left.expression)&&node.left.expression.text==='quadMaterial')
 assert.ok(ts.isCallExpression(call)&&ts.isIdentifier(call.expression)&&call.expression.text==='vec4')
 assert.ok(call.arguments.every(arg=>ts.isNumericLiteral(arg)))
 assert.deepEqual(call.arguments.map(arg=>Number(arg.text)),[.125,.25,.5,1])
 const baseline=browser.indexOf('const baseline=outside()');assert.ok(baseline>node.end)
 const before=browser.slice(0,baseline);assert.match(before,/new QuadMesh\(quadMaterial\)\.render\(renderer\)/);assert.match(before,/quadMaterial\.dispose\(\)/)
 assert.equal(mentions,4,'Warm-up material cannot be reused by measured World cases')
}
const source=()=>({status:browserProofContract.nativeStatus,numericContract:plan.numericContract,iblCredit:0,wholeSceneLightingCredit:0,sourceProfile:{version:[5,3,0],build:'02f0899d78e3',host:'darwin-arm64',engine:'BLENDER_EEVEE',backend:'METAL',referenceStage:'native EEVEE half-film in EXR32'},cases:cases.map(spec=>{const color=spec.color.map(Math.fround),strength=Math.fround(spec.strength),radiance=color.map(v=>Math.fround(v*strength));return{...spec,sourceFile:spec.case+'.blend',sourceSha256:'a'.repeat(64),sourceRestored:true,sourceWords:[...spec.color,spec.strength].map(word),radiance,radianceWords:radiance.map(word),world:{color,strength,exact:true,source:'background',backgroundVisible:true},sourceRestored:true,frames:sizes.map(([width,height])=>({width,height,pixelFile:spec.case+'-'+width+'x'+height+'.rgba32f',exrFile:spec.case+'-'+width+'x'+height+'.exr',pixelSha256:'b'.repeat(64),exrSha256:'c'.repeat(64),maximumAbsoluteRGBFromSourceRadiance:0}))}}),controls:controlCases.map(spec=>({...spec,sourceFile:spec.case+'.blend',sourceSha256:'a'.repeat(64),sourceRestored:true,sourceWords:[...spec.color,spec.strength].map(word),world:{color:spec.color.map(Math.fround),strength:Math.fround(spec.strength),exact:true,source:'background',backgroundVisible:spec.controlKind!=='film-transparent'},frames:[]}))})
test('exact cross-language JSON source census, schemas/defaults and ownership controls',()=>{assertQualification(source());for(const mutate of[s=>s.cases.reverse(),s=>s.cases.pop(),s=>s.controls.reverse(),s=>s.cases[0].sourceWords[0]=0,s=>s.iblCredit=1]){const s=source();mutate(s);assert.throws(()=>assertQualification(s))}})
test('Final source+control publication order cannot silently drop a source',()=>{const s=source(),f={status:browserProofContract.finalStatus,exporter:'built',sourcePreserved:true,rows:[...s.cases,...s.controls].map(row=>({case:row.case,sourceSha256:row.sourceSha256,authoringWorld:row.world}))};assertFinal(f,s);f.rows.reverse();assert.throws(()=>assertFinal(f,s))})
test('browser reader rejects empty or reordered APIs and false software attestation',()=>{assert.throws(()=>assertBrowser({status:browserProofContract.browserStatus,built:true,profile:'metal',rows:[]}));assert.throws(()=>assertBrowser({status:browserProofContract.browserStatus,built:true,profile:'software',rows:[{backend:'webgl2'},{backend:'webgpu'}]}))})
test('scaffold uses actual generated descriptors and public default installer',()=>{const get=n=>readFileSync(new URL(n,import.meta.url),'utf8'),browser=get('browser.js'),matrix=get('matrix.mjs'),capture=get('capture.mjs');assert.match(browser,/installThreeCompiledScene\(/);assert.match(browser,/generated\[entry.moduleExport\]/);assertIndependentWarmupOnly(browser);assert.doesNotMatch(browser,/structuredClone\(original\)/);assert.match(browser,/source-opt-out.*useSourcePresentation:false/s);assert.ok(matrix.indexOf('protocol.test.mjs')<matrix.indexOf('capture.mjs'));assert.ok(capture.indexOf('assertQualification(')<capture.indexOf("await run(process.execPath"))})

test('actual native recipe preflight is mandatory before render/export transactions',()=>{const capture=readFileSync(new URL('capture.mjs',import.meta.url),'utf8'),reference=readFileSync(new URL('reference.py',import.meta.url),'utf8');assert.match(capture,/SCENETOWEB_WORLD_SETUP_ONLY:'1'/);assert.ok(capture.indexOf('CONSTANT_WORLD_SETUP_PASSED')<capture.indexOf("for(const script"));assert.ok(reference.indexOf('resolve_scene_recipe')<reference.indexOf('bpy.ops.render.render'));assert.match(reference,/'groundHeight':1/);assert.doesNotMatch(capture,/Vertex Alpha/)})

test('ownership fixture establishes clear alpha before installation, never impersonating a later app owner',()=>{const browser=readFileSync(new URL('browser.js',import.meta.url),'utf8'),controls=browser.slice(browser.indexOf("for(const kind of['website-background'"));assert.ok(controls.indexOf('renderer.setClearColor(0,0)')<controls.indexOf('installed=await installThreeCompiledScene'));assert.doesNotMatch(controls,/setRenderTarget\(target\);renderer.setClearColor/);assert.match(browser,/before.clearAlpha/);assert.match(controls,/propertiesRestored/);assert.match(controls,/textureSetRestored/)})

const pmrem=()=>({source:{width:64,height:32,bytes:32768,comparedWords:8192,wordDifferences:0,disposals:1},ready:{width:336,height:64,type:'HalfFloatType',format:'RGBAFormat',mapping:'CubeUVReflectionMapping',sharedDetachedLive:true,versionUnchanged:true},generatorDisposals:1,scratchTextures:2,scratchRemaining:0,targetDisposals:1})
const browser=()=>({status:browserProofContract.browserStatus,built:true,profile:'metal',rows:['webgpu','webgl2'].map(backend=>({backend,gpu:{api:backend==='webgpu'?'WebGPU':'WebGL2',description:'Apple Metal'},pageErrors:[],httpErrors:[],shaderErrors:[],uncaptured:[],sourceRadianceOnly:true,iblCredit:0,resourceAbi:'ready-owned-pmrem-color-v2',colorOwnership:[{case:'caller-color-replacement',identityPreserved:true,textureBaselineRestored:true}],intensityAudit:{comparedWords:1024,wordDifferences:0,observedColorIgnoresLaterIntensity:true,textureIntensityCounterfactualMaxAbs:.5,oldCubeIntensityEquivalenceCredit:0,callerColorPreserved:true,textureBaselineRestored:true},adoptions:['intensity','background'].map(caseName=>({case:caseName,preservedUntilCallerDispose:true,targetDisposals:1,textureBaselineRestored:true})),cases:cases.map(spec=>({case:spec.case,hostRestored:true,textureBaselineRestored:true,cycles:[0,1,2].map(cycle=>({cycle,installationDraws:8,preparationDraws:8,commitDraws:0,detachedRendererRestored:true,geometryCounts:{before:2,after:2},pmrem:pmrem(),createdTextures:[{role:'source-world',name:'SceneToWeb Preview World',width:64,height:32}],backgroundColor:{type:'Color',radianceWords:spec.color.map(Math.fround).map(v=>word(Math.fround(v*Math.fround(spec.strength)))),textureAllocations:0,geometryAllocations:0,backgroundNodeWrites:0,versionUnchanged:true},postprocessingOrder:['blender-display-transform'],frames:sizes.map(([width,height],i)=>({width,height,pixelRatio:i===1?2:1,linear:{words:width*height*4,violations:0,alphaDifferences:0,maxAbs:0,wordDifferences:0},final:{words:width*height*4,violations:0,alphaDifferences:0,maxAbs:0,wordDifferences:0},linearDraws:0,finalDraws:1}))}))})),controls:['website-background','source-opt-out','film-transparent'].map(caseName=>({case:caseName,words:1024,differences:0,sourceBackgroundOmitted:true}))}))})
test('ready shared PMREM rejects missing source/target/scratch closure and legacy resource ABI',()=>{
 assertBrowser(browser())
 for(const mutate of[
  r=>delete r.rows[0].resourceAbi,r=>r.rows[0].resourceAbi='legacy-equirect',
  r=>r.rows[0].intensityAudit.oldCubeIntensityEquivalenceCredit=1,
  r=>r.rows[0].intensityAudit.textureIntensityCounterfactualMaxAbs=0,
  r=>r.rows[0].colorOwnership[0].identityPreserved=false,
  r=>r.rows[0].cases[0].cycles[0].backgroundColor.radianceWords[0]=0,
  r=>r.rows[0].cases[0].cycles[0].frames[0].linearDraws=1,
  r=>r.rows[0].cases[0].cycles[0].frames[0].finalDraws=2,
  r=>r.rows[0].cases[0].cycles[0].backgroundColor.textureAllocations=1,
  r=>r.rows[0].cases[0].cycles[0].backgroundColor.geometryAllocations=1,
  r=>r.rows[0].cases[0].cycles[0].geometryCounts.after=3,
  r=>r.rows[0].cases[0].cycles[0].backgroundColor.backgroundNodeWrites=1,
  r=>r.rows[0].adoptions.pop(),r=>r.rows[0].adoptions[0].targetDisposals=0,
  r=>r.rows[0].cases[0].cycles[0].pmrem.source.comparedWords=0,
  r=>r.rows[0].cases[0].cycles[0].pmrem.source.wordDifferences=1,
  r=>r.rows[0].cases[0].cycles[0].pmrem.source.disposals=0,
  r=>r.rows[0].cases[0].cycles[0].pmrem.generatorDisposals=0,
  r=>r.rows[0].cases[0].cycles[0].pmrem.scratchTextures=0,
  r=>r.rows[0].cases[0].cycles[0].pmrem.scratchRemaining=1,
  r=>r.rows[0].cases[0].cycles[0].pmrem.targetDisposals=0,
  r=>r.rows[0].cases[0].cycles[0].pmrem.ready.sharedDetachedLive=false,
  r=>r.rows[0].cases[0].cycles[0].pmrem.ready.width=64,
  r=>r.rows[0].cases[0].cycles[0].preparationDraws=0,
  r=>r.rows[0].cases[0].cycles[0].commitDraws=1,
  r=>r.rows[0].cases[0].cycles[0].detachedRendererRestored=false,
  r=>r.rows[0].cases[0].cycles[0].installationDraws=1,
 ]){const report=browser();mutate(report);assert.throws(()=>assertBrowser(report))}
})
test('ready PMREM fixture forwards public generation and preparation without substituting output pixels',()=>{
 const browser=readFileSync(new URL('browser.js',import.meta.url),'utf8')
 assert.match(browser,/fromPmrem\.call\(this,source,destination\)/)
 assert.match(browser,/disposePmrem\.call\(this\)/)
 assert.match(browser,/compile\.apply\(this,args\)/)
 assert.match(browser,/startThreeCompiledScenePreparation\(/)
 assert.match(browser,/prepared\.commit\(\)/)
 assert.match(browser,/sourceWitness\(record,radiance\)/)
 assert.match(browser,/scratch\.some\(t=>live\.has\(t\)\)/)
 assert.doesNotMatch(browser,/sourceTexture\.image\.data/)
 assertIndependentWarmupOnly(browser)
})

test('host restoration includes the explicit background-node ownership slot',()=>{const browser=readFileSync(new URL('browser.js',import.meta.url),'utf8');assert.match(browser,/backgroundNode:scene\.backgroundNode/);assert.match(browser,/scene\.backgroundNode===before\.backgroundNode/)})

test('independent warm-up cannot substitute a native World output',()=>{
 const browser=readFileSync(new URL('browser.js',import.meta.url),'utf8');assertIndependentWarmupOnly(browser)
 for(const changed of[browser+'\nmaterial.fragmentNode=vec4(0,0,0,1)',browser.replace('vec4(.125,.25,.5,1)','vec4(proof.radiance)'),browser+'\nquadMaterial.dispose()',browser.replace('quadMaterial.fragmentNode=','material.fragmentNode=')])assert.throws(()=>assertIndependentWarmupOnly(changed))
})
