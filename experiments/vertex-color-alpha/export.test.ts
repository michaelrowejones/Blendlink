import {createHash}from'node:crypto'
import{mkdirSync,readFileSync,writeFileSync}from'node:fs'
import{join,resolve}from'node:path'
import{it,expect}from'vitest'
import{NodeIO}from'@gltf-transform/core'
import{ALL_EXTENSIONS}from'@gltf-transform/extensions'
import{MeshoptDecoder}from'meshoptimizer'
import{resolveConfig}from'../../packages/blendlink/src/config.js'
import{parseManifest}from'../../packages/blendlink/src/typegen.js'
import{captureVertexAlphaOptimization}from'../../packages/blendlink/src/vertexAlphaOptimization.js'
import{assertQualification,browserProofContract,assertAlphaSourcePrograms}from'./protocol.mjs'
const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex')
it('publishes untouched source fields with default packaged Final optimization',async()=>{
 const directory=resolve(process.env.SCENETOWEB_VERTEX_ALPHA_REFERENCES!),native=assertQualification(JSON.parse(readFileSync(join(directory,'qualification.json'),'utf8')))
 const root=join(directory,'compiled');mkdirSync(root,{recursive:true})
 const{syncAll,verifyAll,publishedAssetPath}=await import('../../packages/blendlink/dist/sync.js')
 const config=resolveConfig({blenderPath:process.env.BLENDLINK_BLENDER!,outDir:'public/models',genDir:'src/generated',
  scenes:native.cases.map((row:any)=>({name:'vertex-alpha-'+row.case,file:join(directory,row.sourceFile),automaticMaterials:true}))},root)
 const provenance=['packages/blender-addon/material_compiler.py','packages/blender-addon/vertex_color_alpha.py','packages/blender-addon/tsl_ir.py',
  'packages/blendlink/blender/export_scene.py'].flatMap(source=>{
   const artifact=source.startsWith('packages/blender-addon/')?source.replace('packages/blender-addon/','packages/blendlink/dist/addon/'):source.replace('/blender/','/dist/blender/')
   expect(readFileSync(artifact),source).toEqual(readFileSync(source));const rows=[{source,artifact,sha256:hash(readFileSync(source))}];
   if(source.startsWith('packages/blender-addon/')){const flat=source.replace('packages/blender-addon/','packages/blendlink/dist/blender/');expect(readFileSync(flat)).toEqual(readFileSync(source));rows.push({source,artifact:flat,sha256:hash(readFileSync(source))})}
   return rows
  })
 try{await syncAll(config,{force:true})}catch(error){console.error((error as any).detail??error);throw error}
 await MeshoptDecoder.ready
 const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder}),rows=[]
 for(const[index,scene]of config.scenes.entries()){
  const source=native.cases[index],manifestBytes=readFileSync(scene.manifestPath),manifest=parseManifest(manifestBytes.toString())!
  expect(manifest.materialPrograms).toBeTruthy();expect(manifest.optimization?.passes?.skipped).toContainEqual(expect.stringMatching(/asset-wide.*Vertex Color Alpha/))
  const materialPath=publishedAssetPath(scene,manifest.materialPrograms!.url,manifest)!,materialBytes=readFileSync(materialPath)
  const actual=JSON.parse(materialBytes.toString()),raw=JSON.parse(readFileSync(join(directory,source.rawProgramFile),'utf8'));assertAlphaSourcePrograms(raw,source);assertAlphaSourcePrograms(actual,source)
  expect(actual.materials).toEqual(raw.materials)
  const before=captureVertexAlphaOptimization(await io.read(join(directory,source.rawGlbFile)))!
  const after=captureVertexAlphaOptimization(await io.read(scene.glbPath))!
  const authored=(rows:any[])=>rows.map(({mesh,variant,...association})=>association)
  expect(authored(after.associations)).toEqual(authored(before.associations));expect(after.semantics).toEqual(before.semantics)
  expect(hash(readFileSync(join(directory,source.sourceFile)))).toBe(source.sourceSha256)
  rows.push({case:source.case,sourceFile:source.sourceFile,sourceSha256:source.sourceSha256,
   manifestPath:scene.manifestPath,manifestSha256:hash(manifestBytes),glbPath:scene.glbPath,glbSha256:hash(readFileSync(scene.glbPath)),
   materialPath,materialSha256:hash(materialBytes),materialPointer:manifest.materialPrograms,
   exactScalarAfterDefaultOptimization:true,optimizedAssociationDigest:hash(Buffer.from(JSON.stringify(after.associations)))})
 }
 expect((await verifyAll(config)).filter(issue=>issue.severity!=='warning')).toEqual([])
 writeFileSync(join(directory,'final-proof.json'),JSON.stringify({status:browserProofContract.finalStatus,exporter:'built',sourcePreserved:true,
  nativeQualificationSha256:hash(readFileSync(join(directory,'qualification.json'))),provenance,rows},null,2)+'\n')
},300000)
