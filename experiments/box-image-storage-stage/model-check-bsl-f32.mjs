// SPDX-License-Identifier: GPL-3.0-or-later
import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { readRgb8Png, mipChain, bilinear, f, decode } from './mip-model-bsl-f32.mjs'
import { compare } from '../box-image-transport-prototype/compare.mjs'
export async function evaluateMipModels(directory){
const n=JSON.parse(await readFile(join(directory,'native.json'))),rows=[],fetchBaseAlias=[]
for(const image of n.images){
 const bytes=await readFile(join(directory,image.file));if(createHash('sha256').update(bytes).digest('hex')!==image.sha256)throw Error('Image changed')
 const source=readRgb8Png(bytes),srgb=image.colorSpace==='sRGB'
 for(const nr of n.lodRows.filter(r=>r.image===image.name&&r.kind==='fetch')){
  const size=1024>>nr.level,values=Float32Array.from(Array.from({length:64},(_,i)=>{
   const u=f(f(f(i)*f(.137))+f(.1875))%1,x=Math.floor(f(u*size)),y=Math.floor(f(.37109375*size))
   return [0,1,2,3].map(c=>{const v=f(source.pixels[(y*1024+x)*4+c]/255);return srgb&&c!==3?decode(v):v})
  }).flat()),expected=await readFile(join(directory,nr.file))
  fetchBaseAlias.push({image:image.name,level:nr.level,...compare(Buffer.from(values.buffer),expected,2**-10)})
 }
 for(const model of ['stored-box','native-paired-shared-srgb']){
  const levels=mipChain(source,srgb,model==='native-paired-shared-srgb')
  for(const nr of n.lodRows.filter(r=>r.image===image.name&&r.kind==='linear')){
   const values=Float32Array.from(Array.from({length:64},(_,i)=>bilinear(levels[nr.level],f(f(f(i)*f(.137))+f(.1875))%1,.37109375)).flat())
   const expected=await readFile(join(directory,nr.file));if(createHash('sha256').update(expected).digest('hex')!==nr.sha256)throw Error('Raw changed')
   rows.push({image:image.name,model,level:nr.level,...compare(Buffer.from(values.buffer),expected,2**-10)})
  }
 }
}
const pins={}
for(const name of ['model-check-bsl-f32.mjs','mip-model-bsl-f32.mjs','mip-model-unorm-store.mjs'])pins[name]=createHash('sha256').update(await readFile(new URL(name,import.meta.url))).digest('hex')
return {status:'CPU_BSL_FLOAT32_TRANSFER_RESEARCH_ZERO_SUPPORT_CREDIT',supportCredit:0,pins,rows,fetchBaseAlias}
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(import.meta.filename)){
 const result=await evaluateMipModels(resolve(process.argv[2]));await writeFile(resolve(process.argv[3]),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({rows:result.rows.length,fetchBaseAliasViolations:result.fetchBaseAlias.reduce((s,r)=>s+r.violations,0)}))
}
