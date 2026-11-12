import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { inspectCompiledSceneConformance } from './compiledSceneConformance.js'
import { validatedBaseColorProgramMaterials } from './compiledMaterialPrograms.js'
import type { SceneManifest } from './typegen.js'

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
