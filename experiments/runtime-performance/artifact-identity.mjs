import {relative,resolve,sep,isAbsolute} from 'node:path'
import assert from 'node:assert/strict'
const inside=(root,path)=>{const name=relative(root,path);return name!=='..'&&!name.startsWith('..'+sep)&&!isAbsolute(name)?name.split(sep).join('/'):null}
export function linkedAssetRole(url,{artifacts,publicRoot}){
 const pathname=decodeURIComponent(new URL(url).pathname)
 if(!pathname.startsWith('/@fs/'))return 'public:'+pathname.replace(/^\//,'')
 const path=resolve(pathname.slice(4))
 for(const[role,item]of Object.entries(artifacts))if(item.path&&resolve(item.path)===path)return 'declared:'+role
 const name=publicRoot?inside(publicRoot,path):null
 assert.notEqual(name,null,'Linked asset has no stable declared/public resource identity: '+pathname)
 return 'public:'+name
}
export function recordLinkedAsset(map,role,identity,declared){
 if(declared){assert.equal(identity.bytes,declared.bytes,'Served declared artifact byte count changed');assert.equal(identity.sha256,declared.sha256,'Served declared artifact bytes changed')}
 if(map.has(role))assert.deepEqual(map.get(role),identity,'Linked resource changed during benchmark: '+role)
 map.set(role,identity)
}
