// SPDX-License-Identifier: MIT
// Independent actual GLB accessor reader; no Blender or GPU.
import assert from 'node:assert/strict'
import{readFile,writeFile}from'node:fs/promises'
import{resolve,join}from'node:path'
import{createHash}from'node:crypto'
import{validateNativeArchive}from'../../scripts/lib/native-proof-archive.mjs'
const directory=resolve(process.argv[2]),output=resolve(process.argv[3]),sha=b=>createHash('sha256').update(b).digest('hex')
const root=resolve(import.meta.dirname,'../..'),outer=resolve(directory,'..')
const nativeArchive=await validateNativeArchive(JSON.parse(await readFile(join(outer,'native-archive.json'))),outer,{expectedFinalSources:[],expectedScripts:[{path:join(import.meta.dirname,'probe.py'),invocations:1}],helperInputs:{helper:join(root,'scripts/lib/node-port-python.mjs'),bridge:join(root,'scripts/node-port-blender.mjs')}})
const report=JSON.parse(await readFile(join(directory,'report.json')))
assert.equal(report.supportCredit,0);assert.equal(report.renderCalls,0);assert.equal(report.sourceSaveCalls,0);assert.equal(report.sourceUnchanged,true);assert.equal(report.originalMeshBytesUnchanged,true);assert.deepEqual(report.nativeVersion,[5,3,0]);assert.deepEqual(report.gltfExporterVersion,[5,3,43]);assert.equal(report.producerSha256,sha(await readFile(join(directory,'producer.py'))))
function accessor(d,bin,index){const a=d.accessors[index],v=d.bufferViews[a.bufferView],width={SCALAR:1,VEC2:2,VEC3:3,VEC4:4}[a.type],item={5121:1,5123:2,5125:4,5126:4}[a.componentType];assert.ok(width&&item);assert.ok(!a.normalized&&!a.sparse);const packed=width*item,stride=v.byteStride??packed,start=(v.byteOffset??0)+(a.byteOffset??0);assert.ok(stride>=packed);const raw=Buffer.alloc(a.count*packed);for(let i=0;i<a.count;i++)bin.copy(raw,i*packed,start+i*stride,start+i*stride+packed);return{...a,width,raw}}
const key=t=>{const[a,b,c]=t;return[[a,b,c],[b,c,a],[c,a,b]].map(x=>x.join(',')).sort()[0]},canon=ts=>ts.map(key).sort()
const rows=[]
for(const caseRow of report.rows){const metadataBytes=await readFile(join(directory,caseRow.file));assert.equal(sha(metadataBytes),caseRow.sha256);const m=JSON.parse(metadataBytes);assert.equal(m.privateInputPreserved,true)
 const expected={};for(const[name,pin]of Object.entries(m.attributes)){const b=await readFile(join(directory,pin.file));assert.equal(sha(b),pin.sha256);expected[name]=b}
 for(const ex of m.exports){const bytes=await readFile(join(directory,ex.file));assert.equal(sha(bytes),ex.sha256);assert.equal(bytes.readUInt32LE(0),0x46546c67);const jl=bytes.readUInt32LE(12),d=JSON.parse(bytes.subarray(20,20+jl));assert.equal(bytes.readUInt32LE(24+jl),0x004e4942);const bin=bytes.subarray(28+jl);assert.equal(d.meshes.length,1,'Only the private selected active-scene mesh may export');assert.equal(d.meshes[0].primitives.length,1);const p=d.meshes[0].primitives[0],attrs={};for(const[name,type]of Object.entries(m.attributes)){assert.ok(Object.hasOwn(p.attributes,name),name);const a=accessor(d,bin,p.attributes[name]);assert.equal(a.componentType,5126);assert.equal(a.type,type.type);attrs[name]=a}
  const count=attrs._STW_CORNER.count;for(const a of Object.values(attrs))assert.equal(a.count,count)
  const ids=Array.from({length:count},(_,i)=>attrs._STW_CORNER.raw.readFloatLE(i*4));assert.ok(ids.every(i=>Number.isInteger(i)&&i>=0&&i<m.loops));assert.equal(new Set(ids).size,m.loops);assert.equal(count,m.loops,'Unique loop payload must prevent corner welding')
  let words=0,packedNormals=0
  for(const[name,a]of Object.entries(attrs))for(const[index,loop]of ids.entries())for(let lane=0;lane<a.width;lane++){const sourceOffset=(loop*a.width+lane)*4,targetOffset=(index*a.width+lane)*4;assert.equal(a.raw.readUInt32LE(targetOffset),expected[name].readUInt32LE(sourceOffset),name+' raw Float32 word');assert.ok(Number.isFinite(a.raw.readFloatLE(targetOffset)));words++}
  const snorm=x=>Math.trunc(Math.fround(x*511));for(const[index,loop]of ids.entries())for(let lane=0;lane<3;lane++){assert.equal(snorm(attrs._STW_FRAME_N.raw.readFloatLE((index*3+lane)*4)),snorm(expected._STW_FRAME_N.readFloatLE((loop*3+lane)*4)));packedNormals++}
  const indices=accessor(d,bin,p.indices);assert.equal(indices.type,'SCALAR');const get={5121:'readUInt8',5123:'readUInt16LE',5125:'readUInt32LE'}[indices.componentType],size={5121:1,5123:2,5125:4}[indices.componentType];assert.ok(get);const tri=[];for(let i=0;i<indices.count;i+=3)tri.push([0,1,2].map(j=>ids[indices.raw[get]((i+j)*size)]));assert.deepEqual(canon(tri),canon(m.triangles),'Oriented original loop-triangle multiset changed')
  const positions=accessor(d,bin,p.attributes.POSITION);assert.equal(positions.componentType,5126);assert.equal(positions.count,count);let signedZeroPositionWordDifferences=0
  for(const[index,loop]of ids.entries()){const v=m.positions[m.cornerVertices[loop]],expectedPosition=ex.yup?[v[0],v[2],-v[1]]:v;for(let lane=0;lane<3;lane++){const actual=positions.raw.readFloatLE((index*3+lane)*4),expected=Math.fround(expectedPosition[lane]);assert.ok(actual===expected,'Unexpected position basis');if(!Object.is(actual,expected))signedZeroPositionWordDifferences++}}
  rows.push({name:m.name,yup:ex.yup,vertices:count,sourceVertices:m.vertices,corners:m.loops,triangles:tri.length,ngons:m.ngons,customRawFloat32WordsExact:words,customSnorm10NormalComponentsExact:packedNormals,customVectorConvention:'raw Blender XYZ unchanged under export_yup',positionsConvention:ex.yup?'x,z,-y':'x,y,z',signedZeroPositionWordDifferences,builtinNormalPresent:Object.hasOwn(p.attributes,'NORMAL'),builtinTangentPresent:Object.hasOwn(p.attributes,'TANGENT')})
 }
}
const result={status:'CPU_CORNER_ATTRIBUTE_TRANSPORT_CLOSED_NOT_NATIVE_FRAME_OR_RENDER_QUALIFICATION',supportCredit:0,rows,sourceUnchanged:true,originalMeshBytesUnchanged:true,renderCalls:0,sourceSaveCalls:0,nativeArchive}
await writeFile(output,JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(result))
