// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2021 NVIDIA Corporation
// SPDX-FileCopyrightText: 2026 Blender Foundation
// Separate source Float32 SharedSRGB operations from Metal's typed sRGB IO.
// Math.pow and typed conversions remain CPU hypotheses, not native GPU proofs.
import assert from 'node:assert/strict'
import {readRgb8Png, bilinear, roundEven, f, decode, encode} from './mip-model-unorm-store.mjs'
export {readRgb8Png, bilinear, roundEven, f, decode, encode}
const thresholdDecode=f(.04045),thresholdEncode=f(.0031308)
const a=f(.055),b=f(1.055),gamma=f(2.4),linearScale=f(12.92)
export const bslDecode=x=>x<thresholdDecode?(x<0?0:f(x*f(1/linearScale))):f(f(f(x+a)*f(1/b))**gamma)
export const bslEncode=x=>x<thresholdEncode?(x<0?0:f(x*linearScale)):f(f(b*f(x**f(1/gamma)))-a)
export const byte=x=>Math.max(0,Math.min(255,roundEven(x*255)))
const norm=x=>f(byte(x)/255)
// Pinned Metal enables direct SRGB image writes: native texture IO performs
// the transfer, not Constants.is_srgb_texture's BSL conversion branch.
const typedStore=(x,srgb)=>srgb?decode(norm(encode(x))):norm(x)
const sharedStore=(x,alpha)=>alpha?norm(x):bslDecode(norm(bslEncode(x)))
export function mipChain(image,srgb,sharedSrgb){
 assert.equal(image.width,image.height);assert.equal(image.width&(image.width-1),0)
 let linear=Float32Array.from(image.pixels,(v,i)=>srgb&&i%4!==3?decode(f(v/255)):f(v/255)),size=image.width
 const levels=[{size,linear}]
 for(let level=1;size>1;level++){
  const nextSize=size>>1,exact=new Float32Array(nextSize*nextSize*4),stored=new Float32Array(exact.length)
  for(let y=0;y<nextSize;y++)for(let x=0;x<nextSize;x++)for(let c=0;c<4;c++){
   const at=(xx,yy)=>linear[(yy*size+xx)*4+c]
   const value=f(.5*f(f(.5*f(at(x*2,y*2)+at(x*2,y*2+1)))+f(.5*f(at(x*2+1,y*2)+at(x*2+1,y*2+1)))))
   const index=(y*nextSize+x)*4+c;exact[index]=value;stored[index]=typedStore(value,srgb&&c!==3)
  }
  levels.push({size:nextSize,linear:stored})
  linear=sharedSrgb&&level%2===1?Float32Array.from(exact,(v,i)=>sharedStore(v,i%4===3)):stored
  size=nextSize
 }
 return levels
}
