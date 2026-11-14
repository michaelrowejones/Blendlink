import assert from 'node:assert/strict'
import test from 'node:test'
import GLSLDecoder from 'three/addons/transpiler/GLSLDecoder.js'
import {inspectReturns,lowerExhaustiveTailReturns} from './ast-lowering.mjs'
const parse=text=>new GLSLDecoder().parse(text)
test('lowers exhaustive nested tail returns to one outer return',()=>{const ast=parse('float f(float a) { if(a>0.0) { if(a>1.0) {return 2.0;} else {return 1.0;} } else {return 0.0;} }');const rows=lowerExhaustiveTailReturns(ast);assert.equal(rows[0].tailLeaves,3);assert.deepEqual(inspectReturns(ast),[{name:'f',total:1,nested:0}])})
test('refuses non-tail early return',()=>{const ast=parse('float f(float a) { if(a>0.0) {return 2.0;} return 0.0;}');assert.throws(()=>lowerExhaustiveTailReturns(ast),/Non-tail/)})
test('refuses missing final else',()=>{const ast=parse('float f(float a) { if(a>0.0) {return 2.0;} }');assert.throws(()=>lowerExhaustiveTailReturns(ast),/no final else/)})
test('leaves direct return unchanged',()=>{const ast=parse('float f(float a) { return a; }');assert.deepEqual(lowerExhaustiveTailReturns(ast),[]);assert.deepEqual(inspectReturns(ast),[{name:'f',total:1,nested:0}])})
