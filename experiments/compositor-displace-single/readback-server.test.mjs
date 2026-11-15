import test from'node:test'
import assert from'node:assert/strict'
import{createServer}from'node:http'
import{createHash}from'node:crypto'
import{mkdtemp,readFile,readdir,rm,writeFile}from'node:fs/promises'
import{tmpdir}from'node:os'
import{join}from'node:path'
import{createDisplaceReadbackArchive}from'./readback-server.mjs'
import{archiveDisplaceReadback}from'./readback-transport.mjs'
const hash=bytes=>createHash('sha256').update(bytes).digest('hex')
async function host(t,write){
 const root=await mkdtemp(join(tmpdir(),'displace-stream-')),directory=join(root,'readbacks'),owner=createDisplaceReadbackArchive({directory,profile:'metal',...(write?{write}:{})}),server=createServer((req,res)=>owner.middleware(req,res,()=>{res.statusCode=404;res.end()}));owner.setBackend('webgpu');await new Promise(done=>server.listen(0,'127.0.0.1',done));t.after(async()=>{await new Promise(done=>server.close(done));await rm(root,{recursive:true,force:true})})
 const url='http://127.0.0.1:'+server.address().port+owner.path,id='metal--webgpu--nearest-origin--13x9@1',words=new Uint32Array(13*9*4);words.set([0x80000000,0x7fc12345,0xff800000,0x3f800000]);const bytes=Buffer.from(words.buffer),pin=hash(bytes)
 const post=async({frame=id,role='direct',backend='webgpu',body=bytes,sha256=pin,token=owner.token,method='POST',extra=''}={})=>fetch(url+'?'+new URLSearchParams({id:frame,backend,role})+extra,{method,headers:{'content-type':'application/octet-stream','x-displace-token':token,'x-displace-sha256':sha256},...(method==='POST'?{body}:{})})
 return{root,directory,owner,url,id,words,bytes,pin,post}
}
test('actual binary transport archives exact sign/NaN bits and keeps all thirteen role descriptors in order',async t=>{
 const h=await host(t),readbacks=[]
 for(const role of['direct',...Array.from({length:3},(_,i)=>['installed','repeated','display','repeatedDisplay'].map(role=>role+'-'+i)).flat()]){const backing=new Uint32Array(h.words.length+2);backing[0]=0xdeadbeef;backing.set(h.words,1);backing[backing.length-1]=0xdeadbeef;readbacks.push(await archiveDisplaceReadback({readbackUrl:h.url,readbackToken:h.owner.token},{id:h.id,backend:'webgpu',role,words:backing.subarray(1,backing.length-1),sha256:h.pin}))}
 h.owner.assertRow({id:h.id,readbacks});assert.equal((await readdir(h.directory)).length,13);assert.deepEqual(await readFile(join(h.directory,h.id+'.direct.rgba32f')),h.bytes)
 assert.equal(JSON.stringify(readbacks).includes('2147483648'),false);assert.equal(h.words[0],0x80000000)
 const copy=structuredClone(readbacks);copy.reverse();assert.throws(()=>h.owner.assertRow({id:h.id,readbacks:copy}));assert.throws(()=>h.owner.assertRow({id:h.id,readbacks:readbacks.slice(1)}))
})
test('rejects wrong owner/frame/API/role/count/hash and duplicate files without overwriting actual bytes',async t=>{
 const h=await host(t)
 for(const patch of[{method:'GET'},{token:'foreign'},{frame:'../escape'},{frame:h.id.replace('13x9','12x9')},{backend:'webgl2'},{role:'installed-3'},{body:h.bytes.subarray(0,h.bytes.length-4)},{body:Buffer.concat([h.bytes,Buffer.alloc(4)])},{sha256:'0'.repeat(64)},{extra:'&id='+h.id}]){let response;try{response=await h.post(patch)}catch{continue}assert.equal(response.status,400)}
 const response=await h.post();assert.equal(response.status,200);assert.equal((await h.post()).status,400);assert.deepEqual(await readFile(join(h.directory,h.id+'.direct.rgba32f')),h.bytes)
 h.owner.setBackend('webgl2');assert.equal((await h.post({role:'installed-0'})).status,400)
})
test('failed disk writes never create a successful descriptor and cannot overwrite a retained partial artifact',async t=>{
 let first=true;const h=await host(t,async(path,bytes,options)=>{if(first){first=false;await writeFile(path,bytes.subarray(0,4),options);throw Error('Intentional partial disk failure')}return writeFile(path,bytes,options)})
 assert.equal((await h.post()).status,400);assert.throws(()=>h.owner.assertRow({id:h.id,readbacks:[]}));assert.equal((await h.post()).status,400);assert.deepEqual(await readFile(join(h.directory,h.id+'.direct.rgba32f')),h.bytes.subarray(0,4))
})
test('client refuses mismatched host metadata and actual hashes rather than inventing acceptance',async t=>{
 const h=await host(t);await assert.rejects(archiveDisplaceReadback({readbackUrl:h.url,readbackToken:h.owner.token},{id:h.id,backend:'webgpu',role:'direct',words:h.words,sha256:'a'.repeat(64)}),/archive refused/)
})

test('concurrent duplicate uploads have exactly one exclusive writer',async t=>{
 const h=await host(t),responses=await Promise.all(Array.from({length:8},()=>h.post()));assert.equal(responses.filter(r=>r.status===200).length,1);assert.equal(responses.filter(r=>r.status===400).length,7);assert.deepEqual(await readFile(join(h.directory,h.id+'.direct.rgba32f')),h.bytes)
})
test('client rejects a successful HTTP response with different ownership metadata',async()=>{
 const original=globalThis.fetch,words=new Uint32Array(4),pin='a'.repeat(64),base={role:'direct',file:'readbacks/frame.direct.rgba32f',sha256:pin,words:4}
 try{for(const patch of[{role:'installed-0'},{file:'readbacks/other.direct.rgba32f'},{sha256:'b'.repeat(64)},{words:3}]){globalThis.fetch=async()=>({ok:true,json:async()=>({...base,...patch})});await assert.rejects(archiveDisplaceReadback({readbackUrl:'http://127.0.0.1/read',readbackToken:'owned'},{id:'frame',backend:'webgpu',role:'direct',words,sha256:pin}),/different words\/hash\/ownership/)}}finally{globalThis.fetch=original}
})
