// Tooling preflight only. Numerical runners/readers share their already-pinned protocol module.
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import ts from 'typescript'

export const browserProofFamilies=Object.freeze({
 'compositor-white-noise-default-field':Object.freeze({schemaVersion:1,family:'compositor-white-noise-default-field',nativeStatus:'CAPTURED_COMPOSITOR_WHITE_NOISE_DEFAULT_FIELD',finalStatus:'PUBLISHED_COMPOSITOR_WHITE_NOISE_DEFAULT_FIELD',browserStatus:'PASSED_WHITE_NOISE_DEFAULT_FIELD_BUILT_PROOF'}),
 'compositor-wave-axis':Object.freeze({schemaVersion:1,family:'compositor-wave-axis',nativeStatus:'CAPTURED_COMPOSITOR_WAVE_AXIS',finalStatus:'PUBLISHED_COMPOSITOR_WAVE_AXIS',browserStatus:'PASSED_WAVE_AXIS_BUILT_PROOF'}),
 'compositor-white-noise':Object.freeze({schemaVersion:1,family:'compositor-white-noise',nativeStatus:'CAPTURED_COMPOSITOR_WHITE_NOISE',finalStatus:'PUBLISHED_COMPOSITOR_WHITE_NOISE',browserStatus:'PASSED_WHITE_NOISE_BUILT_PROOF'}),
 'vertex-color-alpha':Object.freeze({schemaVersion:1,family:'vertex-color-alpha',nativeStatus:'CAPTURED_VERTEX_COLOR_ALPHA',finalStatus:'PUBLISHED_VERTEX_COLOR_ALPHA',browserStatus:'PASSED_VERTEX_COLOR_ALPHA_BUILT_PROOF'}),
 'compositor-blackbody':Object.freeze({schemaVersion:1,family:'compositor-blackbody',nativeStatus:'CAPTURED_COMPOSITOR_BLACKBODY',finalStatus:'PUBLISHED_COMPOSITOR_BLACKBODY',browserStatus:'PASSED_COMPOSITOR_BLACKBODY_BUILT_PROOF'}),
 'compositor-image-coordinates':Object.freeze({schemaVersion:1,family:'pixel-int2',nativeStatus:'native-pixel-int2-qualified',finalStatus:'published-pixel-candidate',browserStatus:'PASSED_PIXEL_BUILT_PROOF'}),
 'compositor-float-coordinates':Object.freeze({schemaVersion:1,family:'float2-coordinates',nativeStatus:'native-float-coordinate-qualified',finalStatus:'published-float-coordinate-candidate',browserStatus:'PASSED_FLOAT_COORDINATE_BUILT_PROOF'}),
 // Historical Texture reports intentionally retain Float's status token. Family and census remain distinct.
 'compositor-texture-fields':Object.freeze({schemaVersion:1,family:'texture-fields',nativeStatus:'native-texture-fields-qualified',finalStatus:'published-texture-field-candidate',browserStatus:'PASSED_FLOAT_COORDINATE_BUILT_PROOF'}),
 'compositor-vector-math':Object.freeze({schemaVersion:1,family:'compositor-vector-math',nativeStatus:'native-vector-math-qualified',finalStatus:'published-vector-math-candidate',browserStatus:'PASSED_VECTOR_MATH_BUILT_PROOF'}),
 'compositor-static-euler':Object.freeze({schemaVersion:1,family:'compositor-static-euler',nativeStatus:'CAPTURED_COMPOSITOR_STATIC_EULER',finalStatus:'PUBLISHED_COMPOSITOR_STATIC_EULER',browserStatus:'PASSED_STATIC_EULER_BUILT_PROOF'}),
 'compositor-static-rotation':Object.freeze({schemaVersion:1,family:'compositor-static-rotation',nativeStatus:'CAPTURED_COMPOSITOR_STATIC_ROTATION',finalStatus:'PUBLISHED_COMPOSITOR_STATIC_ROTATION',browserStatus:'PASSED_STATIC_ROTATION_BUILT_PROOF'}),
 'compositor-static-matrix':Object.freeze({schemaVersion:1,family:'compositor-static-matrix',nativeStatus:'CAPTURED_COMPOSITOR_STATIC_MATRIX',finalStatus:'PUBLISHED_COMPOSITOR_STATIC_MATRIX',browserStatus:'PASSED_STATIC_MATRIX_BUILT_PROOF'}),
 'compositor-ellipse-mask':Object.freeze({schemaVersion:1,family:'compositor-ellipse-mask',nativeStatus:'CAPTURED_COMPOSITOR_ELLIPSE_MASK',finalStatus:'PUBLISHED_COMPOSITOR_ELLIPSE_MASK',browserStatus:'PASSED_ELLIPSE_MASK_BUILT_PROOF'}),
 'compositor-box-mask':Object.freeze({schemaVersion:1,family:'compositor-box-mask',nativeStatus:'CAPTURED_COMPOSITOR_BOX_MASK',finalStatus:'PUBLISHED_COMPOSITOR_BOX_MASK',browserStatus:'PASSED_BOX_MASK_BUILT_PROOF'}),
 'compositor-image-info':Object.freeze({schemaVersion:1,family:'image-info',nativeStatus:'native-image-info-qualified',finalStatus:'published-image-info-candidate',browserStatus:'PASSED_IMAGE_INFO_BUILT_PROOF'}),
 'radial-segment-width':Object.freeze({schemaVersion:1,family:'radial-segment-width',nativeStatus:'native-radial-width-qualified',finalStatus:'published-radial-width-candidate',browserStatus:'PASSED_RADIAL_WIDTH_BUILT_PROOF'}),
 'static-string-family':Object.freeze({schemaVersion:1,family:'static-strings',nativeStatus:'CAPTURED_STATIC_STRINGS',finalStatus:'PUBLISHED_STATIC_STRINGS',browserStatus:'PASSED_STATIC_STRINGS_BUILT_PROOF'}),
 'shader-static-repeat':Object.freeze({schemaVersion:1,family:'static-repeat',nativeStatus:'CAPTURED_STATIC_REPEAT',finalStatus:'PUBLISHED_STATIC_REPEAT',browserStatus:'PASSED_STATIC_REPEAT_BUILT_PROOF'}),
 'static-switch-family':Object.freeze({schemaVersion:1,family:'static-selection',nativeStatus:'CAPTURED_STATIC_SELECTION',finalStatus:'PUBLISHED_STATIC_SELECTION',browserStatus:'PASSED_STATIC_SELECTION_BUILT_PROOF'})
})

export function assertBrowserProofContract(contract,family){
 assert.ok(Object.hasOwn(browserProofFamilies,family),'Unknown browser proof family: '+family)
 assert.deepEqual(contract,browserProofFamilies[family],'Missing, extra or cross-family proof contract fields: '+family)
 assert.equal(Object.isFrozen(contract),true,'Proof contract must be immutable')
 return contract
}

function parse(source,label){
 const file=ts.createSourceFile(label,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS)
 assert.deepEqual(file.parseDiagnostics.map(row=>row.messageText),[],'Invalid proof source '+label)
 return file
}
const text=(node,file)=>node?.getText(file)
function nodes(file,predicate){const found=[];const visit=node=>{if(predicate(node))found.push(node);ts.forEachChild(node,visit)};visit(file);return found}
function hasProtocolImport(file,name){
 return file.statements.some(node=>ts.isImportDeclaration(node)&&node.moduleSpecifier.text==='./protocol.mjs'&&node.importClause?.namedBindings&&ts.isNamedImports(node.importClause.namedBindings)&&node.importClause.namedBindings.elements.some(item=>item.name.text===name&&!item.propertyName))
}
function contractStatusAssertions(file){
 return nodes(file,node=>ts.isCallExpression(node)&&text(node.expression,file)==='assert.equal'&&node.arguments.length>=2&&text(node.arguments[1],file)==='browserProofContract.browserStatus'&&['report.status','r.status'].includes(text(node.arguments[0],file)))
}
export function assertBrowserProofAssembly({family,contract,runner,reader,protocol}){
 assertBrowserProofContract(contract,family)
 const run=parse(runner,'run.mjs'),verify=parse(reader,'verify.mjs'),schema=parse(protocol,'protocol.mjs')
 assert.ok(hasProtocolImport(run,'browserProofContract'),'Runner must import its own pinned protocol contract')
 const assignments=nodes(run,node=>ts.isBinaryExpression(node)&&node.operatorToken.kind===ts.SyntaxKind.EqualsToken&&text(node.left,run)==='report.status')
 assert.equal(assignments.filter(node=>text(node.right,run)==='browserProofContract.browserStatus').length,1,'Runner must publish the shared pass token exactly once')
 assert.deepEqual(assignments.map(node=>ts.isStringLiteral(node.right)?node.right.text:text(node.right,run)).sort(),['failed','browserProofContract.browserStatus'].sort(),'Unexpected runner status assignment')
 if(family==='static-switch-family'){
  assert.ok(hasProtocolImport(verify,'assertBrowserReport'),'Switch reader must use its pinned browser validator')
  assert.ok(nodes(verify,node=>ts.isCallExpression(node)&&text(node.expression,verify)==='assertBrowserReport').length,'Switch reader must call its browser validator')
  assert.equal(contractStatusAssertions(schema).length,1,'Switch browser schema must consume its shared pass token')
 }else{
  assert.ok(hasProtocolImport(verify,'browserProofContract'),'Reader must import its own pinned protocol contract')
  assert.equal(contractStatusAssertions(verify).length,1,'Reader must accept the shared pass token exactly once')
 }
 // A comment or an unrelated import cannot satisfy these parsed checks.
 for(const file of [run,verify])assert.equal(nodes(file,node=>ts.isStringLiteral(node)&&/^PASSED_.*_BUILT_PROOF$/.test(node.text)).length,0,'Copied browser status literal outside protocol')
 for(const property of ['nativeStatus','finalStatus'])assert.ok(nodes(schema,node=>ts.isCallExpression(node)&&text(node.expression,schema)==='assert.equal'&&text(node.arguments[1],schema)==='browserProofContract.'+property).length,'Protocol must consume '+property)
 return {family:contract.family,schemaVersion:contract.schemaVersion,numericalCredit:0}
}

export async function preflightBrowserProofContracts(root,families=Object.keys(browserProofFamilies)){
 assert.ok(Array.isArray(families)&&families.length>0,'Select at least one proof family')
 const results=[]
 for(const family of families){
  assert.ok(Object.hasOwn(browserProofFamilies,family),'Unknown browser proof family: '+family)
  const folder=join(resolve(root),'experiments',family)
  const [{browserProofContract:contract},runner,reader,protocol]=await Promise.all([
   import(pathToFileURL(join(folder,'protocol.mjs')).href),
   readFile(join(folder,'run.mjs'),'utf8'),readFile(join(folder,'verify.mjs'),'utf8'),readFile(join(folder,'protocol.mjs'),'utf8')
  ])
  results.push(assertBrowserProofAssembly({family,contract,runner,reader,protocol}))
 }
 return {status:'PREFLIGHTED_BROWSER_PROOF_CONTRACTS',numericalCredit:0,families:results}
}
