import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {AnimationMixer,LoopOnce,Matrix4} from 'three'
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js'

globalThis.ProgressEvent??=class ProgressEvent{constructor(type,init={}){this.type=type;Object.assign(this,init)}}
const root=resolve(process.argv[2]??'artifacts/verification-vector-transform/camera53')
const native=JSON.parse(await readFile(join(root,'native-camera-worlds.json'),'utf8'))
const C=new Matrix4().makeRotationX(-Math.PI/2)
let maximum=0
for(const yup of [true,false]){
  const bytes=await readFile(join(root,yup?'camera-yup.glb':'camera-zup.glb'))
  const jsonOffset=20,jsonLength=bytes.readUInt32LE(12)
  const document=JSON.parse(bytes.subarray(jsonOffset,jsonOffset+jsonLength).toString().trim())
  const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.length),'')
  const mixer=new AnimationMixer(gltf.scene)
  for(const clip of gltf.animations){const action=mixer.clipAction(clip);action.setLoop(LoopOnce,1);action.clampWhenFinished=true;action.play()}
  const first=Math.min(...gltf.animations.flatMap(clip=>clip.tracks.map(track=>track.times[0])))
  for(const frame of [1,3]){
    mixer.setTime(first+(frame-1)/24);gltf.scene.updateMatrixWorld(true)
    for(const row of native.rows.filter(row=>row.yup===yup&&row.frame===frame)){
      const nodeIndex=document.nodes.findIndex(node=>node.name===row.node)
      assert.ok(nodeIndex>=0)
      const object=await gltf.parser.getDependency('node',nodeIndex)
      const world=new Matrix4().set(...row.native.flat())
      const expected=yup?C.clone().multiply(world):world
      if(yup&&!document.nodes[nodeIndex].camera&&document.nodes[nodeIndex].camera!==0)expected.multiply(C.clone().transpose())
      const error=Math.max(...object.matrixWorld.elements.map((value,index)=>Math.abs(value-expected.elements[index])))
      maximum=Math.max(maximum,error)
      assert.ok(error<8e-6,JSON.stringify({version:native.blender,yup,frame,node:row.node,error}))
    }
  }
}
console.log('BLENDLINK_GLTF_CAMERA_WORLDS_PASSED '+JSON.stringify({blender:native.blender,maximum,cases:native.rows.length}))
