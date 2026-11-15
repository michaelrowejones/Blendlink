import assert from'node:assert/strict'
import{randomUUID,createHash}from'node:crypto'
import{mkdir,writeFile}from'node:fs/promises'
import{join}from'node:path'
export function createReadbackArchive({directory,scenarios}){
 const token=randomUUID(),expected=new Map(),saved=new Map(),pending=new Set();let activeBackend
 for(const backend of['webgpu','webgl2'])for(const[i,s]of scenarios.entries())for(const mode of['hand-tsl','native-generated'])expected.set(backend+'-'+i+'-'+mode+'-full.u32',{backend,bytes:s.width*s.height*16})
 const middleware=async(req,res,next)=>{
  const url=new URL(req.url,'http://127.0.0.1');if(url.pathname!=='/__benchmark_readback')return next()
  let name
  try{
   assert.equal(req.method,'POST');assert.equal(req.headers['x-benchmark-token'],token);assert.deepEqual([...url.searchParams.keys()],['file']);name=url.searchParams.get('file');const spec=expected.get(name);assert.ok(spec);assert.equal(spec.backend,activeBackend);assert.ok(!saved.has(name)&&!pending.has(name),'Duplicate full readback');pending.add(name)
   const pin=req.headers['x-benchmark-sha256'];assert.match(pin??'',/^[a-f0-9]{64}$/);const chunks=[];let size=0
   for await(const chunk of req){size+=chunk.length;assert.ok(size<=spec.bytes);chunks.push(chunk)}assert.equal(size,spec.bytes);const bytes=Buffer.concat(chunks),sha256=createHash('sha256').update(bytes).digest('hex');assert.equal(sha256,pin)
   await mkdir(directory,{recursive:true});await writeFile(join(directory,name),bytes,{flag:'wx'});const row={file:'readbacks/'+name,bytes:size,sha256};saved.set(name,row);res.setHeader('content-type','application/json');res.end(JSON.stringify(row))
  }catch(e){res.statusCode=400;res.end(String(e))}finally{if(name)pending.delete(name)}
 }
 return{token,path:'/__benchmark_readback',middleware,setBackend(b){assert.ok(['webgpu','webgl2'].includes(b));activeBackend=b},assertRecord(record){assert.deepEqual(record,saved.get(record.file.replace(/^readbacks\//,'')))},assertComplete(){assert.equal(saved.size,expected.size);assert.equal(pending.size,0)}}
}
