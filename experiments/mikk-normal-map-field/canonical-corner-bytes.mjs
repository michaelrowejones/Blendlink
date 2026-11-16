// SPDX-License-Identifier: MIT
// Validation only: do not reorder geometry or shader inputs.
export function canonicalCornerBytes(attribute,cornerIds,cornerCount){
 if(!(attribute.array instanceof Float32Array)||attribute.normalized||!Number.isInteger(attribute.itemSize)||attribute.itemSize<1||attribute.count!==cornerCount||cornerIds.length!==cornerCount)throw Error('Invalid raw corner attribute shape')
 const seen=new Set(),source=new Uint32Array(attribute.array.buffer,attribute.array.byteOffset,attribute.array.byteLength/4),output=new Uint32Array(source.length)
 for(let vertex=0;vertex<cornerCount;vertex++){
  const loop=cornerIds[vertex];if(!Number.isInteger(loop)||loop<0||loop>=cornerCount||seen.has(loop))throw Error('Invalid or repeated original corner identity');seen.add(loop)
  for(let lane=0;lane<attribute.itemSize;lane++)output[loop*attribute.itemSize+lane]=source[vertex*attribute.itemSize+lane]
 }
 return new Uint8Array(output.buffer)
}
