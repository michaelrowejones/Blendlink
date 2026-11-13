import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { it, expect } from 'vitest'
import { resolveConfig } from '../../packages/blendlink/src/config.js'
import { parseManifest } from '../../packages/blendlink/src/typegen.js'
import { auditCompiledSceneArtifact } from '../../packages/blendlink/src/compiledSceneAudit.js'
import { readMaterialProgramImageBytes } from '../../packages/blendlink/src/compiledMaterialPrograms.js'
import { readGlbJson } from '../../packages/blendlink/src/gltfRuntimeCompatibility.js'

it('publishes all two-image material channels and shared exact image companions through Final', async () => {
  const built=process.env.BLENDLINK_MULTI_IMAGE_BUILT==='1'
  const {syncAll,verifyAll,publishedAssetPath}=await import(built?'../../packages/blendlink/dist/sync.js':'../../packages/blendlink/src/sync.js')
  const root = resolve(process.env.BLENDLINK_MULTI_IMAGE_NATIVE ?? 'artifacts/verification-multi-image/native53')
  const source = resolve(root, 'Two Native Images.blend')
  const before = createHash('sha256').update(readFileSync(source)).digest('hex')
  const config = resolveConfig({ blenderPath: process.env.BLENDLINK_MULTI_IMAGE_BLENDER ?? '/Applications/Blender.app/Contents/MacOS/Blender',
    outDir: 'public/models', genDir: 'src/generated', scenes: [{ file: source, name: 'multiImage' }] }, root)
  const outcomes = await syncAll(config, { force: true })
  const scene = config.scenes[0]
  const manifest = parseManifest(readFileSync(scene.manifestPath, 'utf8'))!
  expect(manifest.materialPrograms).toBeTruthy()
  const programsPath = publishedAssetPath(scene, manifest.materialPrograms!.url, manifest)!
  const programsBytes = readFileSync(programsPath)
  const programs = JSON.parse(programsBytes.toString())
  expect(Object.keys(programs.materials)).toHaveLength(11)
  expect(Object.keys(programs.images)).toHaveLength(2)
  for (const [material, expected] of Object.entries(JSON.parse(readFileSync(resolve(root, 'native-reference.json'), 'utf8')).expected) as any) {
    const names = new Set<string>()
    const collect = (value: any): void => { if (!value || typeof value !== 'object') return; if (value.op === 'texture_ref') names.add(value.ref.image); Object.values(value).forEach(collect) }
    collect(programs.materials[material].channels[expected.channel])
    expect([...names].sort()).toEqual([...expected.externalImages].sort())
  }
  const images = readMaterialProgramImageBytes(programsBytes, programsPath)
  expect(images.size).toBe(2)
  for (const [name, metadata] of Object.entries(programs.images) as any) {
    expect(images.get(metadata.file)).toEqual(readFileSync(resolve(root, name + '.png')))
  }
  const glbBytes = readFileSync(scene.glbPath)
  const gltf = readGlbJson(glbBytes, 'multi-image Final proof') as any
  const audit = await auditCompiledSceneArtifact({ manifest, glbBytes, materialProgramsBytes: programsBytes,
    materialProgramImageBytes: images })
  expect(audit.conformance.issues).toEqual([])
  const issues = await verifyAll(config)
  expect(issues.filter(issue => issue.severity !== 'warning')).toEqual([])
  const after = createHash('sha256').update(readFileSync(source)).digest('hex')
  expect(after).toBe(before)
  writeFileSync(resolve(root, 'final-report.json'), JSON.stringify({ exporter:built?'built':'source',outcomes, sourceUnchanged: before === after,
    glbPath: scene.glbPath, manifestPath: scene.manifestPath, programsPath,
    sourceMaterialNames: gltf.materials.map((material: any) => material.extras?.blendlink_source_material).filter(Boolean),
    imageNames: Object.keys(programs.images), imageFiles: [...images.keys()],
    conformance: audit.conformance, verifyIssues: issues }, null, 2))
}, 180_000)
