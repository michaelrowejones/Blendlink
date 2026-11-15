/* SPDX-License-Identifier: MIT */
/** Fixture transport only. Comparison and same-frame capture happen first. */
export async function archiveDisplaceReadback(proof,{id,backend,role,words,sha256}){
 if(!(words instanceof Uint32Array)||typeof proof.readbackUrl!=='string'||typeof proof.readbackToken!=='string')throw Error('Displace readback transport requires actual Uint32 words and its owned endpoint')
 const url=new URL(proof.readbackUrl,globalThis.location?.href);url.search=new URLSearchParams({id,backend,role}).toString()
 const response=await fetch(url,{method:'POST',headers:{'content-type':'application/octet-stream','x-displace-token':proof.readbackToken,'x-displace-sha256':sha256},body:new Uint8Array(words.buffer,words.byteOffset,words.byteLength)})
 if(!response.ok)throw Error('Displace readback archive refused '+id+' / '+role+': '+await response.text())
 const row=await response.json(),expected={role,file:'readbacks/'+id+'.'+role+'.rgba32f',sha256,words:words.length}
 if(JSON.stringify(row)!==JSON.stringify(expected))throw Error('Displace readback archive returned different words/hash/ownership')
 return row
}
