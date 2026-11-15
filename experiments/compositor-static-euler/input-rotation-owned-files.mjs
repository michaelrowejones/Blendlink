// Fixture-only ownership check. Source/runtime inputs intentionally use their own pins.
import assert from 'node:assert/strict'
import {lstat,realpath} from 'node:fs/promises'
import {isAbsolute,join,relative,resolve,sep} from 'node:path'
const inside=path=>path!==''&&path!=='..'&&!path.startsWith('..'+sep)&&!isAbsolute(path)
export async function ownedInputRotationFile(root,path,{within='cpu',expectedBytes}={}){
 const lexicalRoot=resolve(root),canonicalRoot=await realpath(lexicalRoot),requested=resolve(isAbsolute(path)?path:join(lexicalRoot,path))
 let local=relative(lexicalRoot,requested)
 // /tmp may canonically be /private/tmp. Accept that root spelling, never a
 // symlink introduced underneath the owned evidence root.
 if(!inside(local))local=relative(canonicalRoot,requested)
 assert.ok(inside(local),'Capture file escaped owned evidence')
 const scope=relative(lexicalRoot,resolve(lexicalRoot,within));assert.ok(inside(scope),'Invalid owned capture scope')
 assert.ok(local.startsWith(scope+sep),'Capture file escaped its native/Final scope')
 let current=canonicalRoot;const parts=local.split(sep);let stat
 for(const[index,part]of parts.entries()){
  current=join(current,part);stat=await lstat(current)
  assert.equal(stat.isSymbolicLink(),false,'Owned capture cannot be a symlink alias')
  assert.ok(index===parts.length-1?stat.isFile():stat.isDirectory(),'Owned capture must be a plain file beneath plain directories')
 }
 assert.equal(await realpath(current),current,'Owned capture path is not canonical')
 if(expectedBytes!==undefined)assert.equal(stat.size,expectedBytes,'Captured artifact byte count changed')
 assert.ok(stat.size>0,'Owned capture is empty')
 return current
}
