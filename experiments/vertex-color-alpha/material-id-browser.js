// Diagnostic only. Caller supplies the same actual renderer, target, loaded
// scene and authored camera. Restore every material even after draw failure.
import{NodeMaterial}from'three/webgpu'
import{vec4}from'three/tsl'

export async function captureAlphaMaterialIDs(renderer,target,scene,camera){
 const records=[],owned=[]
 scene.traverse(mesh=>{
  if(!mesh.isMesh)return
  let owner=mesh,shared=false
  while(owner){if(owner.name.includes('Shared'))shared=true;owner=owner.parent}
  const materials=Array.isArray(mesh.material)?mesh.material:[mesh.material]
  const replacements=materials.map(source=>{
   const name=source.userData.blendlink_source_material
   if(!['Artist Vertex Alpha 0','Artist Vertex Alpha 1'].includes(name))throw Error('Unexpected diagnostic material owner '+name)
   const material=new NodeMaterial();material.side=source.side
   material.fragmentNode=vec4(shared?.5:.25,name.endsWith(' 0')?.25:.5,0,1)
   owned.push(material);return material
  })
  records.push({mesh,original:mesh.material,replacement:Array.isArray(mesh.material)?replacements:replacements[0]})
 })
 try{
  for(const row of records)row.mesh.material=row.replacement
  renderer.setRenderTarget(target);renderer.render(scene,camera)
  const values=await renderer.readRenderTargetPixelsAsync(target,0,0,target.width,target.height)
  if(!(values instanceof Float32Array))throw Error('Material ID control requires actual Float32 readback')
  return{width:target.width,height:target.height,pixels:values,portCredit:0,qualificationCredit:0}
 }finally{
  for(const row of records)row.mesh.material=row.original
  for(const material of owned)material.dispose()
 }
}
