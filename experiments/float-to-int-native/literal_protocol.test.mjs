import assert from 'node:assert/strict'
import {test} from 'node:test'
import {assertLiteralFinal,assertLiteralQualification,assertLiteralBrowserReport,literalSourceFiles} from './literal_protocol.mjs'

const digest='a'.repeat(64)
const qualification=()=>({status:'CAPTURED_LITERAL_PRODUCTION_CANDIDATE',version:[5,3,0],build:'02f0899d78e3',device:'CPU',sourceEvaluator:'CPU-MF including GPU single values',width:8,height:8,sourcePreserved:true,copiedNamespace:true,sourceHashes:Object.fromEntries(literalSourceFiles.map(file=>[file,digest])),cases:['round','floor','ceiling','truncate'].flatMap(mode=>[...Array.from({length:34},(_,index)=>mode+'-literal-'+(index===0?'3f000000':index.toString(16).padStart(8,'0'))),...['linked','group','instances','integer-consumer','compare-consumer'].map(suffix=>mode+'-'+suffix)].map(name=>({case:name,programFile:name+'.program.json',programSha256:digest,pixelFile:name+'.rgba32f',pixelSha256:digest,sourcePreserved:true,...(/-literal-3f000000$|-group$|-instances$|-integer-consumer$/.test(name)?{sourceFile:name+'.blend',sourceSha256:digest}: {})})))})
test('requires the complete current native source, cases and saved-source receipt',()=>{
 const actual=qualification();assertLiteralQualification(actual)
 for(const mutate of [packet=>packet.cases=[],packet=>packet.cases.pop(),packet=>packet.cases[1]=packet.cases[0],packet=>packet.device='UNKNOWN',packet=>packet.build='unmeasured',packet=>packet.sourceHashes={},packet=>packet.sourcePreserved=false,packet=>packet.copiedNamespace=false,packet=>packet.status='NATIVE_NODE_UNAVAILABLE',packet=>delete packet.cases[0].sourceFile]){
  const forged=structuredClone(actual);mutate(forged);assert.throws(()=>assertLiteralQualification(forged))
 }
})
test('requires all actual saved scenes and the exact native receipt for Final proof',()=>{
 const native=qualification(),final={status:'published-literal-candidate',exporter:'built',sourcePreserved:true,nativeQualificationSha256:digest,provenance:['compositor_graph.py','compositor_float_to_int.py','source_presentation.py','export_scene.py'].map(name=>({source:'packages/blendlink/blender/'+name,artifact:'packages/blendlink/dist/blender/'+name,sha256:digest})),rows:native.cases.filter(row=>row.sourceFile).map(row=>({case:row.case,sourceFile:row.sourceFile,sourceSha256:row.sourceSha256,manifestSha256:digest,glbSha256:digest,presentationSha256:digest}))}
 assertLiteralFinal(final,native,{built:true,nativeSha256:digest})
 for(const mutate of [packet=>packet.rows=[],packet=>packet.rows[1]=packet.rows[0],packet=>packet.nativeQualificationSha256='b'.repeat(64),packet=>packet.exporter='source',packet=>packet.provenance=[],packet=>packet.rows[0].glbSha256='']){
  const forged=structuredClone(final);mutate(forged);assert.throws(()=>assertLiteralFinal(forged,native,{built:true,nativeSha256:digest}))
 }
})


test('browser qualification requires every actual API, case, refusal and ownership result',()=>{
 const cases=['one','two'],names=['model','version','source-profile','evaluator','subnormal','nonfinite','f64','magnitude','color-conversion','depth']
 const actual={status:'PASSED_LITERAL_BUILT_PROOF',built:true,final:true,profile:'metal',sourceDevice:'CPU',missingAdapterControl:{refused:true},rows:['webgpu','webgl2'].map(backend=>({backend,gpu:{api:backend==='webgpu'?'WebGPU':'WebGL2',renderer:'Apple Metal'},errors:[],pageErrors:[],rows:cases.map(name=>({case:name,wordMismatches:0,remainingTextures:0,pinRejected:true,meshCount:1,pipeline:'blender-compositor',sourceMaterialsPreserved:true})),negatives:names.map(kind=>({kind,error:'Float to Integer refused',remainingTextures:0}))}))}
 const options={device:'CPU',profile:'metal',final:true,cases}
 assert.equal(assertLiteralBrowserReport(actual,options),4)
 for(const mutate of [packet=>packet.rows.pop(),packet=>packet.rows[1]=packet.rows[0],packet=>packet.sourceDevice='GPU',packet=>packet.built=false,packet=>packet.final=false,packet=>packet.missingAdapterControl.refused=false,packet=>packet.rows[0].gpu.api='WebGL2',packet=>packet.rows[0].gpu.renderer='SwiftShader',packet=>packet.rows[0].rows.pop(),packet=>packet.rows[0].rows[1]=packet.rows[0].rows[0],packet=>packet.rows[0].rows[0].wordMismatches=1,packet=>packet.rows[0].rows[0].remainingTextures=1,packet=>packet.rows[0].rows[0].pinRejected=false,packet=>packet.rows[0].rows[0].meshCount=0,packet=>packet.rows[0].negatives.pop(),packet=>packet.rows[0].negatives[1]=packet.rows[0].negatives[0],packet=>packet.rows[0].pageErrors=['failure']]){
  const forged=structuredClone(actual);mutate(forged);assert.throws(()=>assertLiteralBrowserReport(forged,options))
 }
})
