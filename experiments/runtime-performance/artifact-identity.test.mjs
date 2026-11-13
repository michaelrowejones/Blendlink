import assert from 'node:assert/strict'
import test from 'node:test'
import {linkedAssetRole,recordLinkedAsset} from './artifact-identity.mjs'
test('URI slots retain their binding even when the content hash set is unchanged',()=>{
 const roles=['a.png','b.png'].map(path=>linkedAssetRole('http://localhost/'+path,{artifacts:{},publicRoot:'/public'})),a=new Map(),b=new Map(),one={bytes:10,sha256:'one'},two={bytes:20,sha256:'two'}
 recordLinkedAsset(a,roles[0],one);recordLinkedAsset(a,roles[1],two);recordLinkedAsset(b,roles[0],two);recordLinkedAsset(b,roles[1],one);assert.notDeepEqual([...a],[...b]);assert.throws(()=>recordLinkedAsset(a,roles[0],two),/changed during/)
})
test('declared bytes are verified and paths outside the declared input graph refuse',()=>{
 const artifacts={glb:{path:'/public/scene.glb',bytes:10,sha256:'expected'}},map=new Map()
 assert.equal(linkedAssetRole('http://localhost/@fs/public/scene.glb',{artifacts,publicRoot:'/public'}),'declared:glb')
 assert.equal(linkedAssetRole('http://localhost/@fs/public/textures/a.png',{artifacts,publicRoot:'/public'}),'public:textures/a.png')
 assert.throws(()=>linkedAssetRole('http://localhost/@fs/other/a.png',{artifacts,publicRoot:'/public'}),/stable declared/)
 assert.throws(()=>recordLinkedAsset(map,'declared:glb',{bytes:10,sha256:'wrong'},artifacts.glb),/bytes changed/)
})
