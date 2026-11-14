/* SPDX-License-Identifier: MIT */
import assert from 'node:assert/strict'
import{readFile,writeFile}from'node:fs/promises'
import{resolve,join}from'node:path'
import{createHash}from'node:crypto'
const directory=resolve(process.argv[2]),native=JSON.parse(await readFile(join(directory,'report.json')))
const f=Math.fround,buffer=new ArrayBuffer(4),view=new DataView(buffer)
const word=n=>{view.setFloat32(0,n,true);return view.getUint32(0,true)},value=n=>{view.setUint32(0,n,true);return view.getFloat32(0,true)}
export function waveAxisFactor(coordinate,scale,phase,profile){
 const p=f(f(f(coordinate*scale)+f(.000001))*f(.999999))
 const n=f(f(p*20)+phase)
 if(profile==='SIN')return f(f(.5)+f(f(.5)*f(Math.sin(f(n-Math.PI/2)))))
 const cycles=f(n/(Math.PI*2))
 return profile==='SAW'?f(cycles-Math.floor(cycles)):f(Math.abs(f(cycles-Math.floor(f(cycles+f(.5)))))*2)
}
const sinAbsoluteMax=2**-20
if(native.plan){assert.equal(native.plan.gates.SIN.absoluteMax,sinAbsoluteMax);assert.deepEqual(native.rows.map(row=>row.case),native.plan.cases.map(row=>row.case));for(const[row,index]of native.rows.map((row,index)=>[row,index]))assert.deepEqual(row.parameterWords,native.plan.cases[index].parameterWords)}
let differences=0,words=0,maximumAbsolute=0,contractViolations=0,endpointControls=0;const failures=[],violations=[]
for(const row of native.rows){
 const bytes=await readFile(join(directory,row.nativeFile));assert.equal(createHash('sha256').update(bytes).digest('hex'),row.nativeSha256)
 const data=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),maximum=Math.max(row.width,row.height),dimension=row.axis==='X'?row.width:row.height,scale=value(row.parameterWords[0]),phase=value(row.parameterWords[1])
 const factors=Float32Array.from({length:dimension},(_,i)=>waveAxisFactor(f((2*i+1-dimension)/maximum),scale,phase,row.profile))
 let rowDifferences=0
 for(let index=0;index<bytes.byteLength;index+=16)assert.ok(data.getUint32(index,true)===data.getUint32(index+4,true)&&data.getUint32(index,true)===data.getUint32(index+8,true),row.case+' native gray channels differ')
 for(let y=0;y<row.height;y++)for(let x=0;x<row.width;x++)for(let c=0;c<4;c++){
  const index=((y*row.width+x)*4+c)*4,actual=data.getUint32(index,true),expected=word(c===3?1:factors[row.axis==='X'?x:y]);words++
  const actualNumber=value(actual),expectedNumber=value(expected)
  let bad=false
  if(row.profile==='SIN'&&c!==3){if(actualNumber===0||actualNumber===1){endpointControls++;if(actual!==expected)bad=true}
   if(!Number.isFinite(expectedNumber)||expectedNumber<0||expectedNumber>1||!Number.isFinite(actualNumber)||actualNumber<0||actualNumber>1||Math.abs(actualNumber-expectedNumber)>sinAbsoluteMax)bad=true
  }else if(actual!==expected)bad=true
  if(bad){contractViolations++;if(violations.length<20)violations.push({case:row.case,x,y,channel:c,profile:row.profile,parameterWords:row.parameterWords,expectedWord:expected,actualWord:actual,expected:expectedNumber,actual:actualNumber})}
  if(actual!==expected){differences++;rowDifferences++;maximumAbsolute=Math.max(maximumAbsolute,Math.abs(value(actual)-value(expected)));if(failures.length<20)failures.push({case:row.case,x,y,channel:c,expectedWord:expected,actualWord:actual,expected:value(expected),actual:value(actual)})}
 }
 row.comparedWords=bytes.length/4;row.wordDifferences=rowDifferences
}
const result={schemaVersion:1,status:contractViolations?'RESEARCH_WAVE_AXIS_COUNTEREXAMPLE':differences?'RESEARCH_WAVE_AXIS_BOUNDED':'RESEARCH_WAVE_AXIS_EXACT',supportCredit:0,cases:native.rows.length,words,differences,maximumAbsolute,contractViolations,endpointControls,sinContract:{absoluteMax:sinAbsoluteMax,nativeZeroOneExact:true,alphaAndGrayExact:true},failures,violations,nativeReportSha256:createHash('sha256').update(await readFile(join(directory,'report.json'))).digest('hex'),rows:native.rows.map(row=>({case:row.case,comparedWords:row.comparedWords,wordDifferences:row.wordDifferences})),shaderOrSavedFinalCredit:0}
await writeFile(join(directory,'comparison.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({...result,rows:undefined}));if(contractViolations)process.exitCode=1
