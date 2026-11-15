/* SPDX-License-Identifier: MIT */
import assert from'node:assert/strict'
import{randomUUID,createHash}from'node:crypto'
import{mkdir,writeFile}from'node:fs/promises'
import{join}from'node:path'
import{cases}from'./protocol.mjs'
export const displaceReadbackRoles=['direct',...Array.from({length:3},(_,i)=>['installed','repeated','display','repeatedDisplay'].map(role=>role+'-'+i)).flat()]
export function createDisplaceReadbackArchive({directory,profile,write=writeFile}){
 assert.ok(['metal','software'].includes(profile));const token=randomUUID(),expected=new Map(),saved=new Map();let activeBackend
 for(const backend of['webgpu','webgl2'])for(const row of cases)for(const frame of row.frames){const id=[profile,backend,row.case,frame.width+'x'+frame.height+'@'+frame.pixelRatio].join('--');for(const role of displaceReadbackRoles)expected.set(id+'.'+role+'.rgba32f',{id,backend,role,words:frame.width*frame.height*4})}
 const middleware=async(req,res,next)=>{
  const url=new URL(req.url,'http://127.0.0.1');if(url.pathname!=='/__displace_readback')return next()
  try{
   assert.equal(req.method,'POST','Readback method');assert.equal(req.headers['x-displace-token'],token,'Readback owner token')
   assert.deepEqual([...url.searchParams.keys()].sort(),['backend','id','role']);const id=url.searchParams.get('id'),backend=url.searchParams.get('backend'),role=url.searchParams.get('role'),name=id+'.'+role+'.rgba32f',spec=expected.get(name)
   assert.ok(spec,'Unknown readback frame/role');assert.equal(backend,spec.backend);assert.equal(backend,activeBackend,'Readback actual API owner');assert.ok(!saved.has(name),'Duplicate readback')
   const pin=req.headers['x-displace-sha256'];assert.match(pin??'',/^[a-f0-9]{64}$/,'Readback hash')
   const chunks=[];let size=0;for await(const bytes of req){size+=bytes.length;assert.ok(size<=spec.words*4,'Readback byte count exceeded');chunks.push(bytes)}assert.equal(size,spec.words*4,'Readback byte count')
   const bytes=Buffer.concat(chunks),sha256=createHash('sha256').update(bytes).digest('hex');assert.equal(sha256,pin,'Readback raw bytes/hash mismatch')
   await mkdir(directory,{recursive:true});await write(join(directory,name),bytes,{flag:'wx'})
   const row={role,file:'readbacks/'+name,sha256,words:spec.words};saved.set(name,row);res.statusCode=200;res.setHeader('content-type','application/json');res.end(JSON.stringify(row))
  }catch(error){res.statusCode=400;res.end('Displace readback archive: '+String(error))}
 }
 return{token,path:'/__displace_readback',middleware,setBackend(backend){assert.ok(['webgpu','webgl2'].includes(backend));activeBackend=backend},assertRow(row){const expectedRows=displaceReadbackRoles.map(role=>{const record=saved.get(row.id+'.'+role+'.rgba32f');assert.ok(record,'Missing archived readback '+row.id+' / '+role);return record});assert.deepEqual(row.readbacks,expectedRows)}}
}
