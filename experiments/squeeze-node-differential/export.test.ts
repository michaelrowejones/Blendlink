import {createHash} from 'node:crypto'
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs'
import {join,resolve} from 'node:path'
import {expect,it} from 'vitest'
import {resolveConfig} from '../../packages/blendlink/src/config.js'
import {parseManifest} from '../../packages/blendlink/src/typegen.js'
import {readGlbJson} from '../../packages/blendlink/src/gltfRuntimeCompatibility.js'
import {auditCompiledSceneArtifact} from '../../packages/blendlink/src/compiledSceneAudit.js'
import {validatedBaseColorProgramMaterials} from '../../packages/blendlink/src/compiledMaterialPrograms.js'
const hash=(data:Uint8Array)=>createHash('sha256').update(data).digest('hex')
it('publishes actual automatic Squeeze and embedded image bindings with exact Final pins',async()=>{
 const native=resolve(process.env.BLENDLINK_SQUEEZE_REFERENCES!),references=JSON.parse(readFileSync(join(native,'references.json'),'utf8')),root=join(native,'compiled')
 const built=process.env.BLENDLINK_SQUEEZE_BUILT==='1'
 const {syncAll,verifyAll}=await import(built?'../../packages/blendlink/dist/sync.js':'../../packages/blendlink/src/sync.js')
 mkdirSync(root,{recursive:true})
 const pythonSources=['packages/blender-addon/squeeze_ir.py','packages/blender-addon/tsl_ir.py','packages/blender-addon/shader_domains.py','packages/blender-addon/engine_fallback.py','packages/blender-addon/material_compiler.py','packages/blendlink/blender/export_scene.py']
 const pythonProvenance=pythonSources.map(source=>{const artifact='packages/blendlink/dist/blender/'+source.split('/').at(-1),sha256=hash(readFileSync(source));if(built)expect(hash(readFileSync(artifact)),source).toBe(sha256);return{source,artifact:built?artifact:source,sha256}})
 for(const entry of references.cases)expect(hash(readFileSync(join(native,entry.file)))).toBe(entry.sourceSha256)
 const config=resolveConfig({blenderPath:process.env.BLENDLINK_BLENDER??'/Applications/Blender.app/Contents/MacOS/Blender',outDir:'public/models',genDir:'src/generated',scenes:references.cases.map((entry:any,index:number)=>({name:'squeeze'+index,file:join(native,entry.file)}))},root)
 try{await syncAll(config,{force:true})}catch(error){console.error((error as any).detail??error);throw error}
 const cases=[]
 for(const[ index,scene]of config.scenes.entries()){
  const entry=references.cases[index],glb=readFileSync(scene.glbPath),gltf=readGlbJson(glb,'actual Final Squeeze') as any
  const manifestBytes=readFileSync(scene.manifestPath),manifest=parseManifest(manifestBytes.toString())!
  expect(manifest.materialPrograms,entry.id).toBeTruthy()
  const programsBytes=readFileSync(join(root,'public',manifest.materialPrograms!.url.replace(/^\//,''))),programs=JSON.parse(programsBytes.toString())
  const material=programs.materials[entry.material];expect(material,entry.material).toBeTruthy()
  const ir=material.channels[entry.channel??'Base Color'].tslIr
  if(entry.id!=='calibration')expect(JSON.stringify(ir)).toContain('squeeze_native')
  const images:any[]=[]
  const visit=(value:any):void=>{if(!value||typeof value!=='object')return;if(value.op==='texture_ref')throw new Error('Unqualified external image shortcut');if(value.op==='tex_image')images.push(value);for(const[key,child]of Object.entries(value))if(key!=='pixels')visit(child)}
  visit(ir)
  for(const image of images){
   expect(image.sourceImageStorage).toBe('rgba32f');expect(image.interpolation).toBe('Closest')
   const bytes=Buffer.alloc(image.pixels.length*4);image.pixels.forEach((value:number,index:number)=>bytes.writeFloatLE(value,index*4))
   expect(hash(bytes)).toBe(references.imagePixelsSha256)
  }
  if(entry.id.startsWith('stress-'))expect(images).toHaveLength(0)
  else if(!['default','positive','negative','reversed','zero-width','roughness-only'].includes(entry.id))expect(images.length).toBeGreaterThan(0)
  if(entry.channel==='Roughness'){
   const bound=gltf.materials.find((value:any)=>value.extras?.blendlink_source_material===entry.material)
   expect(bound.pbrMetallicRoughness.baseColorFactor).toEqual([.125,.25,.5,1])
   expect(bound.pbrMetallicRoughness.roughnessFactor??1).toBe(1)
   const patches:Record<string,unknown>[]=[{nativeGpuBackend:'VULKAN'}]
   if(ir.output.sourceProfile==='linux-x86_64-llvmpipe20-opengl-v1')patches.push(
    {sourceBuildHash:'unmeasured-build'},{nativeGpuRenderer:'unmeasured OpenGL driver'},
    {sourceBuildHash:undefined},{nativeGpuRenderer:undefined},
   )
   for(const patch of patches){
    const forged=JSON.parse(programsBytes.toString())
    Object.assign(forged.materials[entry.material].channels.Roughness.tslIr.output,patch)
    const bytes=Buffer.from(JSON.stringify(forged)),pointer={materialPrograms:{...manifest.materialPrograms!,bytes:bytes.length,hash:hash(bytes).slice(0,16)}}
    await expect(validatedBaseColorProgramMaterials(gltf,pointer,bytes)).rejects.toThrow(/Squeeze Value/)
   }
   const unmarked=structuredClone(gltf)
   for(const mesh of unmarked.meshes??[])if(mesh.extras?.blendlink_tsl_runtime)delete mesh.extras.blendlink_tsl_runtime.requiresNodeRenderer
   await expect(validatedBaseColorProgramMaterials(unmarked,manifest,programsBytes)).rejects.toThrow(/exported node-renderer declaration/)
  }
  const bindings=gltf.materials.filter((value:any)=>value.extras?.blendlink_source_material===entry.material);expect(bindings).toHaveLength(1)
  const audit=await auditCompiledSceneArtifact({manifest,glbBytes:glb,materialProgramsBytes:programsBytes})
  expect(audit.conformance.issues).toEqual([])
  expect(hash(readFileSync(join(native,entry.file)))).toBe(entry.sourceSha256)
  cases.push({id:entry.id,sourceSha256:entry.sourceSha256,manifestUrl:'/@fs'+scene.manifestPath,manifestSha256:hash(manifestBytes),glbSha256:hash(glb),programSha256:hash(programsBytes),embeddedImageExpressions:images.length})
 }
 expect((await verifyAll(config)).filter(issue=>issue.severity!=='warning')).toEqual([])
 writeFileSync(join(native,'final-proof.json'),JSON.stringify({exporter:built?'built':'source',sourcePreserved:true,nativeReferenceSha256:hash(readFileSync(join(native,'references.json'))),pythonProvenance,cases},null,2))
},240_000)
