import test from 'node:test'
import assert from 'node:assert/strict'
import {expectedCases,assertVectorMathQualification,modes,routes,expectedRefusals} from './protocol.mjs'
const valid=()=>({status:'native-vector-math-qualified',version:[5,3,0],build:'02f0899d78e3',device:'CPU',width:8,height:8,cases:expectedCases().map(name=>({case:name,mode:name.startsWith('add-')?'ADD':modes.find(mode=>name.startsWith(mode.toLowerCase()+'-')),route:routes.find(route=>name==='add-'+route)??'default',programSha256:'a'.repeat(64),pixelSha256:'b'.repeat(64),...((name.endsWith('-0')||routes.some(route=>name==='add-'+route))?{sourceFile:name+'.blend',sourceSha256:'c'.repeat(64)}:{})})),refusals:expectedRefusals.map(kind=>({kind,diagnostics:[{message:'refused',code:kind==='animated-input'?'animated-tree':'unsupported-vector-math'}]}))})
test('fixed native mode/route/output census rejects omissions, duplicates and forged identities',()=>{
 assert.equal(assertVectorMathQualification(valid()).cases.length,204)
 for(const mutate of [x=>x.cases.pop(),x=>x.cases.push(x.cases[0]),x=>x.cases[0].mode='NORMALIZE',x=>x.cases[0].pixelSha256='unknown',x=>x.refusals.pop(),x=>x.device='other',x=>x.version=[5,2,0]]){const x=valid();mutate(x);assert.throws(()=>assertVectorMathQualification(x))}
})
