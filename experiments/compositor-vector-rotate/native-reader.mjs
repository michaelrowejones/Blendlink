/* SPDX-License-Identifier: MIT */
import assert from 'node:assert/strict'
import {readFile,realpath,lstat} from 'node:fs/promises'
import {join,resolve,sep} from 'node:path'
import {hash} from '../../scripts/lib/runtime-provenance.mjs'
import {assertProgram,cases} from './protocol.mjs'
export async function assertNativeBuffers(directory,native){
const bytes=async(folder,pin)=>{const path=resolve(folder,pin.file??pin.rawFile),base=await realpath(folder),actual=await realpath(path);assert.ok(actual.startsWith(base+sep));assert.equal((await lstat(path)).isSymbolicLink(),false);const data=await readFile(path);assert.equal(hash(data),pin.sha256??pin.rawSha256);if(pin.bytes!==undefined)assert.equal(data.length,pin.bytes);return data}
const words=buffer=>Array.from({length:buffer.length/4},(_,i)=>buffer.readUInt32LE(i*4))
const equalWords=(actual,expected)=>{assert.equal(actual.length,expected.length);for(let i=0;i<actual.length;i++)assert.equal(actual[i],expected[i],'Raw word '+i)}
const rotate=(value,bits)=>((value<<bits)|(value>>>(32-bits)))>>>0
function hash32(...items){
 let a=(0xdeadbeef+(items.length<<2)+13)>>>0,b=a,c=a;a=(a+items[0])>>>0;if(items.length>1)b=(b+items[1])>>>0
 c=((c^b)-rotate(b,14))>>>0;a=((a^c)-rotate(c,11))>>>0;b=((b^a)-rotate(a,25))>>>0;c=((c^b)-rotate(b,16))>>>0;a=((a^c)-rotate(c,4))>>>0;b=((b^a)-rotate(a,14))>>>0;return((c^b)-rotate(b,24))>>>0
}
const hashWord=value=>hash32(hash32(value),0),expected=new Map(),pixelExpected=new Map()
let nativeWords=0,preStoreWords=0
for(const row of native.cases){
 const spec=cases.find(candidate=>candidate.case===row.case);for(const key of Object.keys(spec))assert.deepEqual(row[key],spec[key])
 const program=await bytes(directory,row.program);assertProgram(JSON.parse(program),row)
 const raw=await bytes(directory,row.pixels),values=words(raw);assert.equal(raw.length,row.width*row.height*16)
 const low=await bytes(directory,row.preStoreLow),high=await bytes(directory,row.preStoreHigh),hashes=words(await bytes(directory,row.preStoreHashes));assert.equal(low.length,raw.length);assert.equal(high.length,raw.length);assert.equal(hashes.length,row.width*row.height*3)
 for(let pixel=0;pixel<row.width*row.height;pixel++)for(let lane=0;lane<4;lane++){
  const index=pixel*4+lane,bits=values[index],magnitude=bits&0x7fffffff;assert.ok(bits!==0x80000000&&(magnitude===0||magnitude>=0x00800000&&magnitude<0x7f800000))
  if(lane===3){assert.equal(bits,0x3f800000);assert.equal(low.readUInt32LE(index*4),0x3f800000);assert.equal(high.readUInt32LE(index*4),0x3f800000);continue}
  const lo=low.readFloatLE(index*4),hi=high.readFloatLE(index*4);assert.ok(Number.isInteger(lo)&&lo>=0&&lo<65536&&Number.isInteger(hi)&&hi>=-32768&&hi<32768)
  const actual=((hi&65535)*65536+lo)>>>0;assert.equal(actual,hashes[pixel*3+lane]);assert.equal(actual,hashWord(bits));preStoreWords++
 }
 const control=native.pixelControls.find(c=>c.width===row.width&&c.height===row.height);assert.ok(control);assert.equal(row.inputFile,control.file);assert.equal(row.inputSha256,control.sha256);assert.equal(row.programFile,row.program.file);assert.equal(row.programSha256,row.program.sha256);assert.equal(row.pixelFile,row.pixels.file);assert.equal(row.pixelSha256,row.pixels.sha256);expected.set(row.case,values);nativeWords+=values.length
}
for(const row of native.pixelControls){const raw=await bytes(directory,row),values=words(raw);assert.equal(raw.length,row.width*row.height*16);for(let y=0;y<row.height;y++)for(let x=0;x<row.width;x++){const offset=(y*row.width+x)*16;assert.equal(raw.readFloatLE(offset),x);assert.equal(raw.readFloatLE(offset+4),row.nativeDomainFlipY?row.height-1-y:y);assert.equal(raw.readFloatLE(offset+8),0);assert.equal(raw.readFloatLE(offset+12),1)}pixelExpected.set(row.width+'x'+row.height,values)}
assert.equal(native.nativeRenders,native.cases.length*3+native.pixelControls.length);assert.equal(preStoreWords,native.preStoreComponentWords);return{nativeWords,preStoreWords,expected,pixelExpected}

}

export function assertCalibrationBuffers(row,copy,pixel,expected){
 assert.equal(copy.length,row.width*row.height*16);assert.equal(pixel.length,copy.length);assert.equal(expected.length,copy.length)
 const equal=flip=>{for(let y=0;y<row.height;y++)for(let x=0;x<row.width;x++)for(let lane=0;lane<4;lane++)if(copy.readUInt32LE(((y*row.width+x)*4+lane)*4)!==expected.readUInt32LE((((flip?row.height-1-y:y)*row.width+x)*4+lane)*4))return false;return true}
 const forward=equal(false),reverse=equal(true);assert.notEqual(forward,reverse,'Independent copy orientation must be unique');assert.equal(row.readbackFlipY,reverse)
 for(let y=0;y<row.height;y++)for(let x=0;x<row.width;x++)for(let lane=0;lane<4;lane++)assert.equal(pixel.readUInt32LE(((y*row.width+x)*4+lane)*4),expected.readUInt32LE((((reverse?row.height-1-y:y)*row.width+x)*4+lane)*4),'Independent screenCoordinate differs from native Pixel')
 return{readbackFlipY:reverse,words:pixel.length/4}
}
