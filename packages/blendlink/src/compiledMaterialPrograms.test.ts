import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Document, NodeIO } from '@gltf-transform/core'
import sharp from 'sharp'
import { DataTexture, Group, Mesh } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { describe, expect, it } from 'vitest'
import { inspectCompiledSceneConformance } from './compiledSceneConformance.js'
import { readMaterialProgramImageBytes, validatedBaseColorProgramMaterials } from './compiledMaterialPrograms.js'
import { auditCompiledSceneArtifact } from './compiledSceneAudit.js'
import { installTslMaterials, objectAttributeResolver } from './tslMaterialRuntime.js'
import type { SceneManifest } from './typegen.js'
import type { MaterialProgramsDocument } from './materialProgramDocument.js'

const checker = {
  schemaVersion: 1, model: 'blendlink-tsl-ir-v1',
  output: {
    op: 'tex_checker', output: 'color',
    vector: { op: 'mapping', vectorType: 'POINT', input: { op: 'uv' },
      location: [0, 0, 0], rotation: [0.19, -0.27, 0.31], scale: [1, 1, 1] },
    scale: { op: 'const_float', value: 5 },
    color1: { op: 'const_vec3', value: [0.025, 0.16, 0.8] },
    color2: { op: 'const_vec3', value: [0.95, 0.45, 0.04] },
  },
}
function fixture() {
  return { materials: [{ name: 'Artist.BLENDLINK_TSL', extras: { blendlink_source_material: 'Artist' } }],
    meshes: [{ primitives: [{ material: 0, attributes: { POSITION: 0, TEXCOORD_0: 1 } }] }] }
}
function publication(channels: Record<string, unknown> = { 'Base Color': { tslIr: checker } }) {
  const bytes = new TextEncoder().encode(JSON.stringify({ schemaVersion: 1, model: 'blendlink-material-programs-v1',
    materials: { Artist: { channels } } }))
  const manifest = { materialPrograms: { url: '/scene.materials.json', bytes: bytes.length,
    hash: createHash('sha256').update(bytes).digest('hex').slice(0, 16), materials: 1 } } as Pick<SceneManifest, 'materialPrograms'>
  return { bytes, manifest }
}
async function inspect(gltf: Record<string, unknown>, published = publication()) {
  return inspectCompiledSceneConformance({ gltf,
    validatedBaseColorProgramMaterials: await validatedBaseColorProgramMaterials(gltf, published.manifest, published.bytes) })
}
const missing = 'conformance.base-color-carrier-missing'

describe('validated live Base Color carrier evidence', () => {
  it('prepares a fresh finite Noise program through the actual builder before granting Ready evidence', async () => {
    const output={op:'noise_field_nearest',profile:'finite-nearest-f32-v1',sourceSamples:'native-float-data-v1',sourceColorSpace:'Non-Color',kernel:{op:'noise_fractal',dimensions:4,output:'color',
      detail:6,roughness:1,lacunarity:1,evaluationModel:'shader',scale:{op:'const_float',value:40},w:{op:'const_float',value:.375},
      colorOffsets:[[112.125,119.25,126.5,145.75],[142.5,128.25,166.125,103.75]],input:{op:'tex_image',sourceEngine:'EEVEE',
        nativeGpuBackend:'METAL',sourceImageStorage:'rgba32f',sourceImageUploadRounding:'none',output:'color',
        interpolation:'Closest',extension:'REPEAT',width:1,height:1,pixels:[.51171875,.5,.25,1],vector:{op:'uv'}}}}
    const published=publication({'Base Color':{tslIr:{...checker,output}}})
    expect((await inspect(fixture(),published)).issues).toEqual([])
    const cancelled=new AbortController();cancelled.abort()
    await expect(validatedBaseColorProgramMaterials(fixture(),published.manifest,published.bytes,undefined,undefined,{signal:cancelled.signal})).rejects.toMatchObject({name:'AbortError'})
    const large=structuredClone(output)
    large.kernel.input.width=4096
    large.kernel.input.pixels=Array.from({length:4096},(_,index)=>{
      const bits=0x400+index,value=2**(((bits>>>10)&31)-15)*(1+(bits&1023)/1024)
      return[value,.5,.25,1]
    }).flat()
    const pending=publication({'Base Color':{tslIr:{...checker,output:large}}}),controller=new AbortController()
    const audit=validatedBaseColorProgramMaterials(fixture(),pending.manifest,pending.bytes,undefined,undefined,{signal:controller.signal})
    const refused=expect(audit).rejects.toMatchObject({name:'AbortError'})
    setTimeout(()=>controller.abort(),2);await refused
    const broken=structuredClone(output);broken.profile='unverified'
    await expect(inspect(fixture(),publication({'Base Color':{tslIr:{...checker,output:broken}}}))).rejects.toThrow(/verified source/)
  })
  it('accepts an actual shipped Mapping/Checker program on its exact GLB binding', async () => {
    expect((await inspect(fixture())).issues).toEqual([])
  })
  it('does not trust a source/class marker without actual sidecar bytes', async () => {
    const gltf = fixture()
    const accepted = await validatedBaseColorProgramMaterials(gltf, publication().manifest)
    expect(accepted.size).toBe(0)
    expect(inspectCompiledSceneConformance({ gltf, validatedBaseColorProgramMaterials: accepted }).issues.map(issue => issue.code)).toContain(missing)
  })
  it('requires the exact source material identity, not a TSL material name', async () => {
    const gltf = fixture()
    gltf.materials[0].extras.blendlink_source_material = 'Unrelated'
    expect((await inspect(gltf)).issues.map(issue => issue.code)).toContain(missing)
  })
  it('validates fresh Squeeze Roughness on a portable color and every actual marked binding',async()=>{
    const output={op:'squeeze_native',model:'eevee-squeeze-f32-v1',sourceEngine:'EEVEE',sourceProfile:'darwin-arm64-metal-v1',nativeVersion:[5,2,0],nativeGpuBackend:'METAL',inputModel:'opaque-nearest-f32-data-or-literal-v1',value:{op:'const_float',value:1},width:{op:'const_float',value:1},center:{op:'const_float',value:0}}
    const gltf:any=fixture();gltf.materials[0].pbrMetallicRoughness={baseColorFactor:[.125,.25,.5,1]}
    gltf.meshes[0].extras={blendlink_tsl_runtime:{schemaVersion:1,requiresNodeRenderer:{schemaVersion:1,model:'squeeze-native-v1'}}}
    const publish=(expression:unknown)=>publication({Roughness:{tslIr:{...checker,output:expression}}})
    expect((await inspect(gltf,publish(output))).issues).toEqual([])
    for(const patch of [{nativeGpuBackend:'OPENGL'},{value:{op:'const_float',value:16},width:{op:'const_float',value:16}},{value:{op:'attribute_object',name:'unbound',output:'fac'}}])
      await expect(inspect(gltf,publish({...output,...patch}))).rejects.toThrow(/Compiled live material program/)
    const image={op:'tex_image',sourceEngine:'EEVEE',nativeGpuBackend:'METAL',sourceImageStorage:'rgba32f',sourceImageUploadRounding:'none',width:1,height:1,pixels:[.25,.5,.125,1],interpolation:'Closest',extension:'REPEAT',output:'color',vector:{op:'const_vec3',value:[.25,.75,0]}}
    const imageOutput={...output,value:{op:'separate',channel:'x',input:image}}
    expect((await inspect(gltf,publish(imageOutput))).issues).toEqual([])
    image.pixels[0]=32;await expect(inspect(gltf,publish(imageOutput))).rejects.toThrow(/Squeeze Value/)
    delete gltf.meshes[0].extras;await expect(inspect(gltf,publish(output))).rejects.toThrow(/exported node-renderer declaration/)
    gltf.meshes[0].extras={blendlink_tsl_runtime:{schemaVersion:1,requiresNodeRenderer:{schemaVersion:1,model:'squeeze-native-v1'}}}
    gltf.materials[0].extensions={KHR_materials_unlit:{}};await expect(inspect(gltf,publish(output))).rejects.toThrow(/lit material carrier/)
  })
  it('does not accept a material program that only supplies Roughness', async () => {
    expect((await inspect(fixture(), publication({ Roughness: { tslIr: checker } }))).issues.map(issue => issue.code)).toContain(missing)
  })
  it('preserves the blocker when the actual runtime refuses the Base Color IR', async () => {
    expect((await inspect(fixture(), publication({ 'Base Color': { tslIr: { ...checker, output: { op: 'unknown-future-op' } } } }))).issues.map(issue => issue.code)).toContain(missing)
  })
  it('does not exempt Base Color when another channel can skip the whole material', async () => {
    const published = publication({ 'Base Color': { tslIr: checker }, Roughness: { tslIr: {
      ...checker, output: { op: 'attribute_object', name: 'missing-object-property', output: 'fac' },
    } } })
    expect((await inspect(fixture(), published)).issues.map(issue => issue.code)).toContain(missing)
  })
  it.each([false, true])('requires verified global image loading before exemption: images=%s', async hasImage => {
    const published = publication()
    const document = JSON.parse(new TextDecoder().decode(published.bytes))
    document.images = hasImage ? { unrelated: { file: 'unverified.png', bytes: 4, hash: 'x', mime: 'image/png',
      width: 1, height: 1, colorSpace: 'sRGB' } } : {}
    published.bytes = new TextEncoder().encode(JSON.stringify(document))
    published.manifest.materialPrograms!.bytes = published.bytes.length
    published.manifest.materialPrograms!.hash = createHash('sha256').update(published.bytes).digest('hex').slice(0, 16)
    const issues = (await inspect(fixture(), published)).issues.map(issue => issue.code)
    if (hasImage) expect(issues).toContain(missing)
    else expect(issues).not.toContain(missing)
  })
  it('requires the inputs on every primitive bound to the program', async () => {
    const gltf = fixture()
    gltf.meshes[0].primitives.push({ material: 0, attributes: { POSITION: 2 } } as typeof gltf.meshes[0]['primitives'][0])
    expect((await inspect(gltf)).issues.map(issue => issue.code)).toContain(missing)
  })
  it('does not exempt an unlit carrier the node-material installer skips', async () => {
    const gltf = fixture()
    Object.assign(gltf.materials[0], { extensions: { KHR_materials_unlit: {} } })
    expect((await inspect(gltf)).issues.map(issue => issue.code)).toContain(missing)
  })
  it('leaves unrelated UV conformance failures blocking', async () => {
    const gltf = fixture()
    Object.assign(gltf.materials[0], { normalTexture: { index: 0, texCoord: 5 } })
    const issues = (await inspect(gltf)).issues.map(issue => issue.code)
    expect(issues).toContain('conformance.texcoord-out-of-range')
    expect(issues).not.toContain(missing)
  })
  it.each(['hash', 'bytes'] as const)('requires the shipped sidecar %s pin', async field => {
    const published = publication()
    if (field === 'hash') published.manifest.materialPrograms!.hash = '0000000000000000'
    else published.manifest.materialPrograms!.bytes++
    await expect(inspect(fixture(), published)).rejects.toThrow(/byte\/hash pin/)
  })
  it('requires the material program schema even when its bytes are pinned', async () => {
    const bytes = new TextEncoder().encode(JSON.stringify({ schemaVersion: 2, model: 'unrelated', materials: {} }))
    const published = publication()
    published.bytes = bytes
    published.manifest.materialPrograms!.bytes = bytes.length
    published.manifest.materialPrograms!.hash = createHash('sha256').update(bytes).digest('hex').slice(0, 16)
    await expect(inspect(fixture(), published)).rejects.toThrow(/schema\/model/)
  })
})

async function realPublication(values: unknown[] = [[0.8, 0.35, 0.1], 0.6], primitives = 1, ownerVersion?: number) {
  const document = new Document()
  const buffer = document.createBuffer()
  const material = document.createMaterial('Artist.BLENDLINK_TSL').setExtras({ blendlink_source_material: 'Artist' })
  const position = document.createAccessor().setType('VEC3').setBuffer(buffer)
    .setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]))
  const uv = document.createAccessor().setType('VEC2').setBuffer(buffer)
    .setArray(new Float32Array([0, 0, 1, 0, 0, 1]))
  const mesh = document.createMesh('Artist geometry')
  for (let i = 0; i < primitives; i++) mesh.addPrimitive(document.createPrimitive().setMaterial(material)
    .setAttribute('POSITION', position).setAttribute('TEXCOORD_0', uv))
  const scene = document.createScene('Published scene')
  document.getRoot().setDefaultScene(scene)
  values.forEach((tint, i) => scene.addChild(document.createNode(`Artist object ${i}`).setMesh(mesh)
    .setExtras({ ...(tint === undefined ? {} : { tint }), ...(ownerVersion === undefined ? {} : {
      blendlink_tsl_object: { schemaVersion: ownerVersion, objectName: `Artist object ${i}` },
    }) })))
  const glbBytes = await new NodeIO().writeBinary(document)
  const imageBytes = await sharp({ create: { width: 129, height: 129, channels: 4,
    background: { r: 200, g: 100, b: 25, alpha: 0.75 } } }).png().toBuffer()
  const image = { file: 'scene.tex.ink.png', bytes: imageBytes.length,
    hash: createHash('sha256').update(imageBytes).digest('hex').slice(0, 16),
    mime: 'image/png', width: 129, height: 129, colorSpace: 'sRGB' }
  const sidecar = { schemaVersion: 1, model: 'blendlink-material-programs-v1', images: { ink: image },
    materials: { Artist: { channels: { 'Base Color': { tslIr: { schemaVersion: 1, model: 'blendlink-tsl-ir-v1', output: {
      op: 'mix_color', blendType: 'MULTIPLY', clampFactor: true, clampResult: false,
      factor: { op: 'const_float', value: 1 },
      a: { op: 'texture_ref', ref: { image: 'ink', interpolation: 'Linear', extension: 'REPEAT' },
        image: { name: 'ink', width: 129, height: 129, colorSpace: 'sRGB' }, output: 'color', vector: { op: 'uv' } },
      b: { op: 'attribute_object', name: 'tint', output: 'color' },
    } } } } } } }
  const fixture = { glbBytes, sidecar, imageBytes, bytes: new Uint8Array(), manifest: {} as SceneManifest }
  repin(fixture)
  return fixture
}

function repin(fixture: Awaited<ReturnType<typeof realPublication>>) {
  fixture.bytes = new TextEncoder().encode(JSON.stringify(fixture.sidecar))
  fixture.manifest = { generator: 'scenetoweb', schemaVersion: 3, url: '/scene.glb',
    hash: createHash('sha256').update(fixture.glbBytes).digest('hex').slice(0, 16),
    stats: { bytes: fixture.glbBytes.length, triangles: 2, meshes: 1, texturesBytes: 0 },
    materialPrograms: { url: '/scene.materials.json', materials: 1, bytes: fixture.bytes.length,
      hash: createHash('sha256').update(fixture.bytes).digest('hex').slice(0, 16) },
  } as unknown as SceneManifest
}

async function auditReal(fixture: Awaited<ReturnType<typeof realPublication>>, payload = fixture.imageBytes) {
  return auditCompiledSceneArtifact({ manifest: fixture.manifest, glbBytes: fixture.glbBytes,
    materialProgramsBytes: fixture.bytes, materialProgramImageBytes: new Map([[fixture.sidecar.images.ink.file, payload]]) })
}

describe('exact external image and per-object program evidence', () => {
  it('requires complete generic Magic channel evidence on every bound primitive, even with portable Base Color',async()=>{
    const fixture=await realPublication([[.8,.35,.1]])
    const io=new NodeIO(),document=await io.readBinary(fixture.glbBytes),mesh=document.getRoot().listMeshes()[0]!
    document.getRoot().listMaterials()[0]!.setBaseColorFactor([.125,.25,.5,1])
    const selector={op:'tex_magic_native',model:'eevee-magic-f32-v1'}
    const declaration={schemaVersion:1,model:'live-material-programs-v1',programs:[selector]}
    const magic={...selector,sourceEngine:'EEVEE',nativeGpuBackend:'METAL',evaluationModel:'shader',depth:2,output:'fac',
      vector:{op:'uv'},scale:{op:'const_float',value:1},distortion:{op:'const_float',value:1}}
    Object.assign(fixture.sidecar.materials.Artist,{channels:{Roughness:{tslIr:{schemaVersion:1,model:'blendlink-tsl-ir-v1',output:magic}}}})
    mesh.setExtras({blendlink_tsl_runtime:{schemaVersion:1,requiresNodeRenderer:declaration}})
    fixture.glbBytes=await io.writeBinary(document);repin(fixture)
    await expect(auditCompiledSceneArtifact({manifest:fixture.manifest,glbBytes:fixture.glbBytes,
      materialProgramsBytes:fixture.bytes})).rejects.toThrow(/Magic Texture.*companion image/)
    expect((await auditReal(fixture)).conformance.issues).toEqual([])
    for(const marker of [undefined,null,{...declaration,schemaVersion:2},{...declaration,model:'future'},
      {...declaration,programs:[{...selector,model:'unmatched-model'}]}]){
      mesh.setExtras({blendlink_tsl_runtime:{schemaVersion:1,...(marker===undefined?{}:{requiresNodeRenderer:marker})}})
      fixture.glbBytes=await io.writeBinary(document);repin(fixture)
      await expect(auditReal(fixture)).rejects.toThrow(/node-renderer declaration/)
    }
    // One valid owner cannot certify another actual binding to the material.
    mesh.setExtras({blendlink_tsl_runtime:{schemaVersion:1,requiresNodeRenderer:declaration}})
    const second=document.createMesh('Unmarked binding').addPrimitive(document.createPrimitive()
      .setMaterial(document.getRoot().listMaterials()[0]!).setAttribute('POSITION',mesh.listPrimitives()[0]!.getAttribute('POSITION')!)
      .setAttribute('TEXCOORD_0',mesh.listPrimitives()[0]!.getAttribute('TEXCOORD_0')!))
    document.getRoot().getDefaultScene()!.addChild(document.createNode('Second owner').setMesh(second))
    fixture.glbBytes=await io.writeBinary(document);repin(fixture)
    await expect(auditReal(fixture)).rejects.toThrow(/Magic Texture requires its exported node-renderer declaration/)
  })

  it('uses the actual channel builder for generic declarations instead of approving an unknown opcode',async()=>{
    const fixture=await realPublication([[.8,.35,.1]])
    const io=new NodeIO(),document=await io.readBinary(fixture.glbBytes)
    document.getRoot().listMaterials()[0]!.setBaseColorFactor([.125,.25,.5,1])
    const selector={op:'unsupported_renderer_probe',model:'test-only-v1'}
    document.getRoot().listMeshes()[0]!.setExtras({blendlink_tsl_runtime:{schemaVersion:1,
      requiresNodeRenderer:{schemaVersion:1,model:'live-material-programs-v1',programs:[selector]}}})
    Object.assign(fixture.sidecar.materials.Artist,{channels:{Roughness:{tslIr:{schemaVersion:1,model:'blendlink-tsl-ir-v1',output:selector}}}})
    fixture.glbBytes=await io.writeBinary(document);repin(fixture)
    await expect(auditReal(fixture)).rejects.toThrow(/Native material channel Roughness.*unsupported_renderer_probe/)
  })

  it('cannot skip a matched Squeeze Roughness audit when optional companion bytes are omitted',async()=>{
    const fixture=await realPublication([[.8,.35,.1]])
    const io=new NodeIO(),document=await io.readBinary(fixture.glbBytes)
    document.getRoot().listMaterials()[0]!.setBaseColorFactor([.125,.25,.5,1])
    document.getRoot().listMeshes()[0]!.setExtras({blendlink_tsl_runtime:{schemaVersion:1,
      requiresNodeRenderer:{schemaVersion:1,model:'squeeze-native-v1'}}})
    const output={op:'squeeze_native',model:'eevee-squeeze-f32-v1',sourceEngine:'EEVEE',
      sourceProfile:'darwin-arm64-metal-v1',nativeVersion:[5,2,0],nativeGpuBackend:'METAL',
      inputModel:'opaque-nearest-f32-data-or-literal-v1',value:{op:'const_float',value:1},
      width:{op:'const_float',value:1},center:{op:'const_float',value:0}}
    Object.assign(fixture.sidecar.materials.Artist,{channels:{Roughness:{tslIr:{
      schemaVersion:1,model:'blendlink-tsl-ir-v1',output}}}})
    fixture.glbBytes=await io.writeBinary(document);repin(fixture)
    const missingCompanions=()=>auditCompiledSceneArtifact({manifest:fixture.manifest,
      glbBytes:fixture.glbBytes,materialProgramsBytes:fixture.bytes})
    await expect(missingCompanions()).rejects.toThrow(/Squeeze Value.*companion image/)
    // A complete, pinned PNG must still reach the actual channel builder.
    expect((await auditReal(fixture)).conformance.issues).toEqual([])
    output.nativeGpuBackend='OPENGL';repin(fixture)
    await expect(missingCompanions()).rejects.toThrow(/Squeeze Value.*companion image/)
    await expect(auditReal(fixture)).rejects.toThrow(/Squeeze Value requires its verified EEVEE/)
    output.nativeGpuBackend='METAL'
    document.getRoot().listMeshes()[0]!.setExtras({})
    fixture.glbBytes=await io.writeBinary(document);repin(fixture)
    await expect(auditReal(fixture)).rejects.toThrow(/exported node-renderer declaration/)
  })

  it('keeps old portable image programs and unbound Squeeze programs on their existing missing-companion path',async()=>{
    const fixture=await realPublication([[.8,.35,.1]])
    const io=new NodeIO(),document=await io.readBinary(fixture.glbBytes)
    document.getRoot().listMaterials()[0]!.setBaseColorFactor([.125,.25,.5,1])
    fixture.glbBytes=await io.writeBinary(document);repin(fixture)
    const missingCompanions=()=>auditCompiledSceneArtifact({manifest:fixture.manifest,
      glbBytes:fixture.glbBytes,materialProgramsBytes:fixture.bytes})
    expect((await missingCompanions()).conformance.issues).toEqual([])
    Object.assign(fixture.sidecar.materials,{Unused:{channels:{Roughness:{tslIr:{
      schemaVersion:1,model:'blendlink-tsl-ir-v1',output:{op:'squeeze_native',model:'eevee-squeeze-f32-v1'}}}}}})
    document.createMaterial('Unused Squeeze').setExtras({blendlink_source_material:'Unused'})
    fixture.glbBytes=await io.writeBinary(document)
    repin(fixture)
    fixture.manifest.materialPrograms!.materials=2
    expect((await missingCompanions()).conformance.issues).toEqual([])
    expect((await auditReal(fixture)).conformance.issues).toEqual([])
  })

  it('certifies fresh Magic against decoded positions and UVs without requiring a normal attribute',async()=>{
    const fixture=await realPublication([[.8,.35,.1]])
    const io=new NodeIO(),document=await io.readBinary(fixture.glbBytes)
    document.getRoot().listMeshes()[0]!.setExtras({blendlink_tsl_runtime:{objectSpace:'gltf-y-up',texspace:{location:[0,0,0],size:[1,1,1]},
      requiresNodeRenderer:{schemaVersion:1,model:'live-material-programs-v1',programs:[{op:'tex_magic_native',model:'eevee-magic-f32-v1'}]}}})
    const magic={op:'tex_magic_native',model:'eevee-magic-f32-v1',sourceEngine:'EEVEE',nativeGpuBackend:'METAL',evaluationModel:'shader',depth:2,output:'color',
      vector:{op:'generated'},scale:{op:'const_float',value:5},distortion:{op:'const_float',value:1}}
    fixture.sidecar.materials.Artist.channels['Base Color'].tslIr.output=magic as any
    fixture.glbBytes=await io.writeBinary(document);repin(fixture)
    expect((await auditReal(fixture)).conformance.issues).toEqual([])
    magic.vector={op:'uv'};repin(fixture)
    expect((await auditReal(fixture)).conformance.issues).toEqual([])
    // A forged range tag cannot replace evidence from actual GLB texels.
    Object.assign(magic.vector,{range:[0,1]})
    document.getRoot().listMeshes()[0]!.listPrimitives()[0]!.getAttribute('TEXCOORD_0')!.setArray(new Float32Array([100,0,1,0,0,1]))
    fixture.glbBytes=await io.writeBinary(document);repin(fixture)
    expect((await auditReal(fixture)).conformance.issues.map(issue=>issue.code)).toContain(missing)
    // Existing portable color must not hide an invalid other live channel.
    document.getRoot().listMaterials()[0]!.setBaseColorFactor([.2,.3,.4,1])
    fixture.glbBytes=await io.writeBinary(document);repin(fixture)
    await expect(auditReal(fixture)).rejects.toThrow(/Magic Texture scaled coordinates/)
  })
  it('audits real shared-mesh GLB nodes, pinned PNG bytes, and the same production resolvers used by the installer', async () => {
    const fixture = await realPublication()
    expect((await auditReal(fixture)).conformance.issues).toEqual([])
    const loaded = await new GLTFLoader().parseAsync(fixture.glbBytes.slice().buffer, '')
    const meshes: Mesh[] = []
    loaded.scene.traverse(object => { if ((object as Mesh).isMesh) meshes.push(object as Mesh) })
    expect(meshes.map(mesh => mesh.userData.tint)).toEqual([[0.8, 0.35, 0.1], 0.6])
    const resolver = objectAttributeResolver()
    const uniform = resolver('tint') as unknown as { update(frame: unknown): void; value: { toArray(): number[] } }
    uniform.update({ object: meshes[0] })
    expect(uniform.value.toArray()).toEqual([0.8, 0.35, 0.1])
    uniform.update({ object: meshes[1] })
    expect(uniform.value.toArray()).toEqual([0.6, 0.6, 0.6])
    const decoded = await sharp(fixture.imageBytes).ensureAlpha().raw().toBuffer()
    const installed = await installTslMaterials({ root: loaded.scene,
      descriptor: { materialPrograms: fixture.manifest.materialPrograms },
      loadPrograms: async () => fixture.sidecar as unknown as MaterialProgramsDocument,
      loadProgramTexture: async () => new DataTexture(decoded, 129, 129),
    })
    expect(installed.applied).toBe(2)
    expect(installed.skipped).toEqual([])
    installed.dispose()
  })

  it.each([undefined, '0.4', [1, 2], [1, null, 3]])('keeps Final blocked when one rendered object has missing/malformed data: %j', async value => {
    const fixture = await realPublication([[1, 0.5, 0.25], value])
    expect((await auditReal(fixture)).conformance.issues.map(issue => issue.code)).toContain(missing)
    const loaded = await new GLTFLoader().parseAsync(fixture.glbBytes.slice().buffer, '')
    const decoded = await sharp(fixture.imageBytes).ensureAlpha().raw().toBuffer()
    const installed = await installTslMaterials({ root: loaded.scene,
      descriptor: { materialPrograms: fixture.manifest.materialPrograms },
      loadPrograms: async () => fixture.sidecar as unknown as MaterialProgramsDocument,
      loadProgramTexture: async () => new DataTexture(decoded, 129, 129),
    })
    expect(installed.applied).toBe(1)
    expect(installed.skipped.some(skip => /per-object attribute/.test(skip.reason))).toBe(true)
    installed.dispose()
  })

  it('does not invent inherited node properties for multi-primitive GLTFLoader child meshes', async () => {
    const fixture = await realPublication([[0.8, 0.35, 0.1]], 2)
    const loaded = await new GLTFLoader().parseAsync(fixture.glbBytes.slice().buffer, '')
    const tints: unknown[] = []
    loaded.scene.traverse(object => { if ((object as Mesh).isMesh) tints.push(object.userData.tint) })
    expect(tints).toEqual([undefined, undefined])
    expect((await auditReal(fixture)).conformance.issues.map(issue => issue.code)).toContain(missing)
    const application = new Group()
    application.userData = { tint: [1, 0, 0], blendlink_tsl_object: { schemaVersion: 1, objectName: 'Unrelated application ancestor' } }
    application.add(loaded.scene)
    const decoded = await sharp(fixture.imageBytes).ensureAlpha().raw().toBuffer()
    const installed = await installTslMaterials({ root: application,
      descriptor: { materialPrograms: fixture.manifest.materialPrograms },
      loadPrograms: async () => fixture.sidecar as unknown as MaterialProgramsDocument,
      loadProgramTexture: async () => new DataTexture(decoded, 129, 129),
    })
    expect(installed.applied).toBe(0)
    expect(installed.skipped.some(skip => /per-object attribute/.test(skip.reason))).toBe(true)
    installed.dispose()
  })

  it('resolves marked multi-primitive owners independently, including live mutation of actual installed uniforms', async () => {
    const fixture = await realPublication([[0.8, 0.35, 0.1], [0.1, 0.6, 0.9]], 2, 1)
    expect((await auditReal(fixture)).conformance.issues).toEqual([])
    const loaded = await new GLTFLoader().parseAsync(fixture.glbBytes.slice().buffer, '')
    const owners = loaded.scene.children
    const meshes = owners.flatMap(owner => owner.children) as Mesh[]
    expect(meshes).toHaveLength(4)
    expect(meshes[0].geometry).toBe(meshes[2].geometry)
    const decoded = await sharp(fixture.imageBytes).ensureAlpha().raw().toBuffer()
    const installed = await installTslMaterials({ root: loaded.scene,
      descriptor: { materialPrograms: fixture.manifest.materialPrograms },
      loadPrograms: async () => fixture.sidecar as unknown as MaterialProgramsDocument,
      loadProgramTexture: async () => new DataTexture(decoded, 129, 129),
    })
    expect(installed.applied).toBe(4)
    expect(installed.skipped).toEqual([])
    expect(meshes[0].material).toBe(meshes[1].material)
    expect(meshes[2].material).toBe(meshes[3].material)
    expect(meshes[0].material).not.toBe(meshes[2].material)
    type Uniform = { update(frame: unknown): void; value: { toArray(): number[] } }
    const uniforms = (mesh: Mesh): Uniform[] => {
      const found: Uniform[] = []
      const material = mesh.material as unknown as { colorNode: { traverse(callback: (node: Record<string, unknown>) => void): void } }
      material.colorNode.traverse(node => {
        if (node.isUniformNode && node.updateType === 'object') found.push(node as unknown as Uniform)
      })
      return found
    }
    const [a] = uniforms(meshes[0]), [b] = uniforms(meshes[2])
    expect(a).toBeTruthy()
    expect(b).toBeTruthy()
    expect(a).not.toBe(b)
    a.update({ object: meshes[0] }); b.update({ object: meshes[2] })
    expect(a.value.toArray()).toEqual([0.8, 0.35, 0.1])
    expect(b.value.toArray()).toEqual([0.1, 0.6, 0.9])
    owners[0].userData.tint = [0.25, 0.5, 0.75]
    a.update({ object: meshes[1] }); b.update({ object: meshes[3] })
    expect(a.value.toArray()).toEqual([0.25, 0.5, 0.75])
    expect(b.value.toArray()).toEqual([0.1, 0.6, 0.9])
    owners[0].userData.tint = 'invalid live mutation'
    expect(() => a.update({ object: meshes[0] })).toThrow(/finite scalar or RGB\/vector/)
    b.update({ object: meshes[2] })
    expect(b.value.toArray()).toEqual([0.1, 0.6, 0.9])
    installed.dispose()
  })

  it('refuses unknown ownership marker versions instead of inheriting their properties', async () => {
    const fixture = await realPublication([[0.8, 0.35, 0.1]], 2, 2)
    expect((await auditReal(fixture)).conformance.issues.map(issue => issue.code)).toContain(missing)
  })

  it('checks required per-object properties in other channels before exempting Base Color', async () => {
    const fixture = await realPublication()
    Object.assign(fixture.sidecar.materials.Artist.channels, { Roughness: { tslIr: {
      ...checker, output: { op: 'attribute_object', name: 'absent-roughness', output: 'fac' },
    } } })
    repin(fixture)
    expect((await auditReal(fixture)).conformance.issues.map(issue => issue.code)).toContain(missing)
  })

  it('requires image payload evidence even with a correctly pinned sidecar', async () => {
    const fixture = await realPublication()
    const audit = await auditCompiledSceneArtifact({ manifest: fixture.manifest,
      glbBytes: fixture.glbBytes, materialProgramsBytes: fixture.bytes })
    expect(audit.conformance.issues.map(issue => issue.code)).toContain(missing)
  })

  it.each(['tamper', 'missing'])('rejects %s image bytes', async kind => {
    const fixture = await realPublication()
    const imageBytes = kind === 'missing' ? new Map<string, Uint8Array>()
      : new Map([[fixture.sidecar.images.ink.file, new Uint8Array(fixture.imageBytes.length).fill(1)]])
    await expect(auditCompiledSceneArtifact({ manifest: fixture.manifest, glbBytes: fixture.glbBytes,
      materialProgramsBytes: fixture.bytes, materialProgramImageBytes: imageBytes })).rejects.toThrow(/image.*byte\/hash pin/)
  })

  it.each(['width', 'height', 'mime', 'colorSpace'])('checks decoded image %s even when the sidecar is re-pinned', async field => {
    const fixture = await realPublication()
    Object.assign(fixture.sidecar.images.ink, { [field]: field === 'mime' ? 'image/jpeg' : field === 'colorSpace' ? 'unknown-space' : 128 })
    repin(fixture)
    await expect(auditReal(fixture)).rejects.toThrow(/format\/dimensions\/color-space metadata/)
  })

  it('refuses a texture_ref whose metadata disagrees with its verified source bytes', async () => {
    const fixture = await realPublication()
    fixture.sidecar.materials.Artist.channels['Base Color'].tslIr.output.a.image.width = 128
    repin(fixture)
    expect((await auditReal(fixture)).conformance.issues.map(issue => issue.code)).toContain(missing)
  })

  it('refuses unsupported external Cubic sampling instead of approving a linear substitution', async () => {
    const fixture = await realPublication()
    fixture.sidecar.materials.Artist.channels['Base Color'].tslIr.output.a.ref.interpolation = 'Cubic'
    repin(fixture)
    expect((await auditReal(fixture)).conformance.issues.map(issue => issue.code)).toContain(missing)
  })

  it('reads exact published companions by basename and rejects a different URL/path contract', async () => {
    const fixture = await realPublication()
    const directory = mkdtempSync(join(tmpdir(), 'blendlink-program-images-'))
    try {
      const path = join(directory, 'scene.materials.json')
      writeFileSync(path, fixture.bytes)
      writeFileSync(join(directory, fixture.sidecar.images.ink.file), fixture.imageBytes)
      expect([...readMaterialProgramImageBytes(fixture.bytes, path).values()]).toEqual([fixture.imageBytes])
      fixture.sidecar.images.ink.file = '../outside.png'
      repin(fixture)
      expect(() => readMaterialProgramImageBytes(fixture.bytes, path)).toThrow(/basename beside/)
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })
})
