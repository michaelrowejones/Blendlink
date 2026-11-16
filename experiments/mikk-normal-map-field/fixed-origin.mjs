// SPDX-License-Identifier: MIT
// API-defined row conversion only; no image-dependent alignment selection.
export function nativeRows(bytes,backend,width=128,height=128){
 if(!['webgpu','webgl2'].includes(backend)||bytes.byteLength!==width*height*16)throw Error('Unexpected fixed-origin field')
 if(backend==='webgl2')return bytes
 const out=Buffer.alloc(bytes.length),stride=width*16
 for(let y=0;y<height;y++)bytes.copy(out,y*stride,(height-1-y)*stride,(height-y)*stride)
 return out
}
export function windowQuadrants(bytes,mask,width=128,height=128){
 let disagreements=0,wrongOriginDisagreements=0
 for(let p=0;p<width*height;p++)if(mask.readFloatLE(p*16)===1){const x=p%width,y=Math.floor(p/width)
  for(let c=0;c<2;c++){const actual=bytes.readFloatLE(p*16+c*4),want=((c?y:x)+.5)/(c?height:width);if((actual<.5)!==(want<.5))disagreements++;if(c&&(actual<.5)!==((1-want)<.5))wrongOriginDisagreements++}
 }
 return{disagreements,wrongOriginDisagreements}
}
