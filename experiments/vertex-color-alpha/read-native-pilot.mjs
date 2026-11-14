import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {resolve,join} from 'node:path'
import {validateNativeArchive} from '../../scripts/lib/native-proof-archive.mjs'

const root=resolve(import.meta.dirname,'../..'),directory=resolve(process.argv[2]),size=64,gate=2**-10
const sha=bytes=>createHash('sha256').update(bytes).digest('hex')
const source=JSON.parse(await readFile(join(directory,'pilot-source.json')))
assert.equal(sha(await readFile(join(import.meta.dirname,'native_pilot.py'))),source.sha256)
const packet=JSON.parse(await readFile(join(directory,'native-python-proof.json')))
const nativePythonProof=await validateNativeArchive(packet,directory,{expectedFinalSources:[],expectedScripts:[{path:source.script,invocations:1}],
  helperInputs:{helper:join(root,'scripts/lib/node-port-python.mjs'),bridge:join(root,'scripts/node-port-blender.mjs')}})
const report=JSON.parse(await readFile(join(directory,'native-material-pilot.json')))
assert.equal(report.status,'VERTEX_ALPHA_NATIVE_MATERIAL_PILOT_CAPTURED')
assert.deepEqual(report.calibration.nativeVersion,[5,3,0]);assert.equal(report.calibration.nativeBuild,'02f0899d78e3')
assert.equal(report.calibration.nativeBackend,'METAL');assert.equal(report.calibration.samples,1)
assert.equal(report.calibration.filterSize,1.5);assert.equal(report.calibration.cameraAdjusted,false)
assert.deepEqual(report.calibration.camera,{type:'ORTHO',scale:2,position:[0,0,2],rotation:[0,0,0],shiftX:0,shiftY:0})
const files=new Map(),load=async name=>{const bytes=await readFile(join(directory,name));files.set(name,{bytes:bytes.length,sha256:sha(bytes)});return bytes}
const floats=bytes=>{assert.equal(bytes.byteLength,size*size*4*4);return Array.from({length:size*size*4},(_,i)=>bytes.readFloatLE(i*4))}
const ramp=floats(await load('geometry-ramp.rgba32f'));await load('geometry-ramp.exr')
for(let y=0;y<size;y++)for(let x=0;x<size;x++)
  assert.deepEqual(ramp.slice(4*(y*size+x),4*(y*size+x)+4),[(x+.5)/size,(y+.5)/size,.5,1])
const cases=[['zero','POINT',[0,0,0,0]],['tenth','POINT',[.1,.1,.1,.1]],['third','POINT',[1/3,1/3,1/3,1/3]],
  ['one','POINT',[1,1,1,1]],['point-nonuniform','POINT',[0,.1,1/3,1]],['corner-seam','CORNER',[0,.1,1/3,.25,.8,1]]]
const word=value=>{const bytes=Buffer.alloc(4);bytes.writeFloatLE(value);return bytes.readUInt32LE()}
const bary=(p,a,b,c)=>{
  const denominator=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1])
  const u=((b[1]-c[1])*(p[0]-c[0])+(c[0]-b[0])*(p[1]-c[1]))/denominator
  const v=((c[1]-a[1])*(p[0]-c[0])+(a[0]-c[0])*(p[1]-c[1]))/denominator
  return[u,v,1-u-v]
}
assert.deepEqual(report.captures.map(row=>row.case),cases.map(row=>row[0]))
const rows=[]
for(const[name,domain,input]of cases){
  const alpha=input.map(Math.fround),native=report.captures.find(row=>row.case===name)
  assert.equal(native.domain,domain);assert.deepEqual(native.alphaInputWords,input.map(word));assert.equal(native.predeclaredAbsGate,gate)
  const pixels=floats(await load(name+'.rgba32f'));await load(name+'.exr');await load(name+'.blend')
  let maxAbs=0,seamMax=0,edgeMax=0,seamPixels=0,edgePixels=0,violations=0,alphaOneDiff=0
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const point=[-1+(x+.5)*2/size,-1+(y+.5)*2/size]
    let weights=bary(point,[-2,-2.125],[2,-2],[2,2]),values=alpha.slice(0,3)
    if(Math.min(...weights)<0){weights=bary(point,[-2,-2.125],[2,2],[-2,2]);values=domain==='CORNER'?alpha.slice(3):[alpha[0],alpha[2],alpha[3]]}
    const expected=weights.reduce((sum,w,lane)=>sum+w*values[lane],0)
    const actual=pixels.slice(4*(y*size+x),4*(y*size+x)+4)
    assert.ok(actual.every(Number.isFinite))
    const diff=Math.max(...actual.slice(0,3).map(value=>Math.abs(value-expected)))
    maxAbs=Math.max(maxAbs,diff);if(diff>gate)violations++;if(actual[3]!==1)alphaOneDiff++
    if(Math.abs(point[1]-(33/32*point[0]-1/16))<=4/size){seamPixels++;seamMax=Math.max(seamMax,diff)}
    if(x<2||y<2||x>=size-2||y>=size-2){edgePixels++;edgeMax=Math.max(edgeMax,diff)}
  }
  assert.equal(violations,0);assert.equal(alphaOneDiff,0)
  for(const[a,b]of [[native.maxAbsVsIndependentBarycentrics,maxAbs],[native.seamBandMaxAbs,seamMax],[native.edgeBandMaxAbs,edgeMax]])
    assert.ok(Math.abs(a-b)<1e-15,'independent reader/report arithmetic disagreed')
  assert.equal(native.seamBandPixels,seamPixels);assert.equal(native.edgeBandPixels,edgePixels)
  rows.push({case:name,domain,alphaInputWords:input.map(word),pixels:size*size,allPixelMaxAbs:maxAbs,
    seamBandPixels:seamPixels,seamBandMaxAbs:seamMax,edgeBandPixels:edgePixels,edgeBandMaxAbs:edgeMax,violations,alphaOneDiff})
}
const receipt={status:'CLOSED_NATIVE_VERTEX_ALPHA_INTERPOLATION_RESEARCH',portCredit:0,FinalCredit:0,browserCredit:0,
  sourceStage:'actual EEVEE material Color Attribute Alpha into Emission, native half film; independent analytical geometry reference',
  implementationCredit:'none: this capture does not execute the SceneToWeb Alpha transport or browser shader',
  sourceSha256:source.sha256,readerSha256:sha(await readFile(new URL(import.meta.url))),nativePythonProof,
  calibration:report.calibration,predeclaredContract:{rgbAbsoluteMax:gate,alphaOneExact:true,allPixels:true,sourceOutputRepair:false},
  nativeCases:rows.length,materialPixels:rows.length*size*size,materialWords:rows.length*size*size*4,
  maximumAbs:Math.max(...rows.map(row=>row.allPixelMaxAbs)),rows,artifacts:Object.fromEntries(files)}
await writeFile(join(directory,'closed-native-research.json'),JSON.stringify(receipt,null,2)+'\n')
console.log(JSON.stringify({status:receipt.status,cases:rows.length,pixels:receipt.materialPixels,maxAbs:receipt.maximumAbs,gate,credit:0}))
