import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {execFileSync} from 'node:child_process'
import GLSLDecoder from 'three/addons/transpiler/GLSLDecoder.js'
import TSLEncoder from 'three/addons/transpiler/TSLEncoder.js'
import {assertGlslSourceCensus,nativeGlslCensus,GLSL_CENSUS_LIMITS,GlslSourceCensusError} from './glsl-source-census.mjs'
const decode=source=>new GLSLDecoder().parse(source)
const fn=(ast,name)=>ast.body.find(node=>node.isFunctionDeclaration&&node.name===name)
const source=`/* fake function: float lost(float x) { } */
const float PI=3.14;
float one(const in float value) { return value; }
vec2 overload(vec2 value) { return value; }
float overload(float value) { return value; }
void output_pair(in vec2 pair, out float first, inout float second) { first=pair.x; second+=pair.y; }
float summed(float value) { float sum=0.; for(int i=0;i<8;i++){if(i==3)continue;sum+=value;}return sum; }
`
test('independent lexer matches actual decoder definitions, overloads, globals and exact qualifiers without mutation',()=>{
 const native=nativeGlslCensus(source);assert.equal(native.functions.length,5)
 const ast=decode(source),encoder=new TSLEncoder(),before=encoder.emit(ast)
 const fresh=decode(source),snapshot=JSON.stringify(fresh,(key,value)=>['parent','linker'].includes(key)?undefined:value),report=assertGlslSourceCensus(source,fresh);assert.equal(JSON.stringify(fresh,(key,value)=>['parent','linker'].includes(key)?undefined:value),snapshot);const after=new TSLEncoder().emit(fresh)
 assert.equal(before,after);assert.equal(report.nativeFunctionCount,5);assert.equal(report.globalDeclarations,1);assert.equal(report.numericalCredit,0);assert.ok(Object.isFrozen(report))
 assert.equal(report.sourceSha256,createHash('sha256').update(source).digest('hex'))
})
test('missing, extra, duplicated, changed or reordered signatures fail before emission',()=>{
 for(const mutate of[
  ast=>ast.body.pop(),
  ast=>ast.body.push(decode('float unexpected(float x){return x;}').body[0]),
  ast=>ast.body.push(ast.body[1]),
  ast=>fn(ast,'one').type='int',
  ast=>fn(ast,'one').name='renamed',
  ast=>fn(ast,'one').params[0].type='vec3',
  ast=>fn(ast,'one').params[0].name='renamed',
  ast=>fn(ast,'one').params[0].immutable=false,
  ast=>fn(ast,'output_pair').params[1].qualifier=null,
  ast=>fn(ast,'output_pair').params[2].qualifier='in',
  ast=>ast.body.reverse(),
 ]){const ast=decode(source);mutate(ast);assert.throws(()=>assertGlslSourceCensus(source,ast),GlslSourceCensusError)}
})
test('unexpected top-level source expressions and AST executable nodes fail',()=>{
 for(const text of['float(1.);','foo();','a = 1.;','if(true){}',';'])assert.throws(()=>nativeGlslCensus(text),/GLSL source census/)
 const ast=decode(source);ast.body.push(decode('float f(){return 1.;}').body[0].body[0]);assert.throws(()=>assertGlslSourceCensus(source,ast),/top-level executable/)
 const globals=decode(source);globals.body.find(node=>node.isVariableDeclaration).name='changed';assert.throws(()=>assertGlslSourceCensus(source,globals),/declarations differ/)
})
test('native duplicate function identities cannot hide behind return or qualifier differences',()=>{
 for(const text of['float f(float x){return x;} float f(float y){return y;}','float f(float x){return x;} int f(float x){return 1;}','float f(in float x){return x;} float f(out float x){return x;}'])assert.throws(()=>nativeGlslCensus(text),/duplicate function/)
})
test('explicit preprocessed grammar and source work limits refuse without recursion',()=>{
 for(const text of['#define X 1\nfloat f(){return 1.;}','/* unfinished','float f(){','float f(){return 1.;}}','float f(float x[2]){return x[0];}','float f(highp float x){return x;}','float f(float);','struct X {float a;};','const float a[2]=float[2](1.,2.);'])assert.throws(()=>nativeGlslCensus(text),/GLSL source census/)
 assert.throws(()=>nativeGlslCensus(' '.repeat(GLSL_CENSUS_LIMITS.sourceBytes+1)),/byte limit/)
 assert.throws(()=>nativeGlslCensus('void f(){'+'('.repeat(GLSL_CENSUS_LIMITS.nesting+1)+')'.repeat(GLSL_CENSUS_LIMITS.nesting+1)+';}'),/nesting limit/)
 assert.throws(()=>nativeGlslCensus(Array.from({length:257},(_,i)=>`float f${i}(){return 0.;}`).join('\n')),/function limit/)
 const ast=decode('float a;');ast.body[0].next=ast.body[0];assert.throws(()=>assertGlslSourceCensus('float a;',ast),/cyclic/)
})
test('gate preserves accepted TSLEncoder bytes including mutable-local materialization',()=>{
 const prepared='float square(float x){return x*x;} vec2 accumulate(vec2 p){vec2 sum=vec2(0.);for(int j=-1;j<=1;j++){for(int i=0;i<8;i++){if(i==2)continue;sum+=p;}}return sum;}'
 const compile=checked=>{const ast=decode(prepared);if(checked)assertGlslSourceCensus(prepared,ast);const visited=new Set();const walk=value=>{if(!value||typeof value!=='object'||visited.has(value))return;visited.add(value);if(value.isVariableDeclaration)value.needsToVar=true;for(const child of Object.values(value))if(Array.isArray(child))child.forEach(walk);else walk(child)};walk(ast);return new TSLEncoder().emit(ast)}
 assert.equal(compile(true),compile(false))
})
const pinnedRadial=process.env.SCENETOWEB_RADIAL_GLSL_SOURCE
test('optional pinned Radial source has byte-identical generated output with the gate',{skip:!pinnedRadial},async()=>{
 const raw=await readFile(pinnedRadial);assert.equal(createHash('sha256').update(raw).digest('hex'),'adab763a5772baca55f40e9ad0aa0cc1942b8bee87f898fe3e4aaa0601ebeeb3')
 const header=raw.toString().match(/^\/\* SPDX-FileCopyrightText:[\s\S]*?\*\//)[0]
 const prepared=header+'\nfloat square(float x) { return x*x; }\n'+execFileSync('/usr/bin/clang',['-E','-P','-x','c','-'],{input:raw,encoding:'utf8'}).replace(/\bfloat2\b/g,'vec2').replace(/\bfloat4\b/g,'vec4').replace(/\batan2\b/g,'atan').replace(/\bM_PI\b/g,'3.14159265358979323846').replace(/\bM_TAU\b/g,'6.28318530717958647692')
 const compile=checked=>{const ast=decode(prepared);if(checked)assertGlslSourceCensus(prepared,ast);const visited=new Set();const walk=value=>{if(!value||typeof value!=='object'||visited.has(value))return;visited.add(value);if(value.isVariableDeclaration)value.needsToVar=true;for(const child of Object.values(value))if(Array.isArray(child))child.forEach(walk);else walk(child)};walk(ast);return new TSLEncoder().emit(ast)}
 assert.equal(compile(true),compile(false))
})
const pinnedGabor=process.env.SCENETOWEB_GABOR_GLSL_SOURCE
test('optional pinned Gabor cache diagnoses ten native functions versus nine decoded; no port credit',{skip:!pinnedGabor},async()=>{
 const raw=await readFile(pinnedGabor);assert.equal(createHash('sha256').update(raw).digest('hex'),'81c48ae370663566bc3a3196c078b37ef67256cec8e227ebbaf5ec7e47dd25fc')
 const prepared=raw.toString().replace(/^#.*$/gm,'').replace(/\bfloat([234])\b/g,'vec$1').replace(/float &([a-z_]+)/g,'out float $1').replace(/\bIMPULSES_COUNT\b/g,'8').replace(/\bSHD_GABOR_TYPE_2D\b/g,'0.0').replace(/\bSHD_GABOR_TYPE_3D\b/g,'1.0').replace(/\bM_PI\b/g,'3.14159265358979323846').replace(/\bM_SQRT2\b/g,'1.4142135623730950488').replace(/(\d+\.\d+)f\b/g,'$1')
 // The old adapter retained BSL [[node]]. Independent GLSL-only lexing must
 // reject it. The explicit annotation-only ABI adaptation reveals ten native
 // signatures, while the old decoder input silently retained only nine.
 assert.equal((prepared.match(/\[\[node\]\]/g)??[]).length,1)
 const explicitAbi=prepared.replace('[[node]]',''),native=nativeGlslCensus(explicitAbi),oldAst=decode(prepared)
 assert.equal(native.functions.length,10);assert.equal(oldAst.body.filter(node=>node.isFunctionDeclaration).length,9)
 assert.throws(()=>nativeGlslCensus(prepared),/attributes.*ABI adaptation/)
 assert.throws(()=>assertGlslSourceCensus(explicitAbi,oldAst),error=>error instanceof GlslSourceCensusError&&error.details.nativeFunctionCount===10&&error.details.decodedFunctionCount===9)
 const report=assertGlslSourceCensus(explicitAbi,decode(explicitAbi));assert.equal(report.nativeFunctionCount,10)
 console.log('GLSL_CENSUS_GABOR_RESEARCH_REFUSED '+JSON.stringify({oldAdapterExpectedFunctions:10,oldAdapterDecodedFunctions:9,explicitAnnotationAbiFunctionCensus:10,numericalCredit:0}))
})
