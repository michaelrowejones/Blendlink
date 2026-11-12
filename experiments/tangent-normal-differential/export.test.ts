import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { expect, it } from 'vitest'
import { resolveConfig } from '../../packages/blendlink/src/config.js'
import { parseManifest } from '../../packages/blendlink/src/typegen.js'
import { readGlbJson } from '../../packages/blendlink/src/gltfRuntimeCompatibility.js'

it('publishes actual tangent normal programs, exact Mikk frames and animated shared owners', async () => {
  const native = resolve(
    process.env.BLENDLINK_TANGENT_NORMAL_NATIVE ?? 'artifacts/verification-tangent-normal/native53',
  )
  const references = JSON.parse(readFileSync(join(native, 'native-reference.json'), 'utf8'))
  const built = process.env.BLENDLINK_TANGENT_NORMAL_BUILT === '1'
  const { syncAll, verifyAll } = await import(
    built ? '../../packages/blendlink/dist/sync.js' : '../../packages/blendlink/src/sync.js'
  )
  const root = join(native, 'compiled')
  mkdirSync(root, { recursive: true })
  const hash = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex')
  expect(
    references.fixtureSha256,
    'Regenerate native geometry references after fixture edits',
  ).toBe(hash('packages/blender-addon/tests/tangent_normal_check.py'))
  const pythonSources = [
    'packages/blender-addon/geometry_ir.py',
    'packages/blender-addon/normal_ir.py',
    'packages/blender-addon/tangent_ir.py',
    'packages/blender-addon/normal_input_bounds.py',
    'packages/blender-addon/normal_map_tangent_ir.py',
    'packages/blender-addon/material_compiler.py',
    'packages/blender-addon/tsl_ir.py',
    'packages/blendlink/blender/geometry_export.py',
    'packages/blendlink/blender/tangent_export.py',
    'packages/blendlink/blender/export_scene.py',
  ]
  const pythonProvenance = pythonSources.map((source) => {
    const artifact = 'packages/blendlink/dist/blender/' + source.split('/').at(-1)
    const sha256 = hash(source)
    if (built)
      expect(hash(artifact), `Rebuild before Final: ${source} differs from shipped Python`).toBe(
        sha256,
      )
    return { source, artifact: built ? artifact : source, sha256 }
  })
  const before = references.sources.map((source: any) => hash(join(native, source.file)))
  const config = resolveConfig(
    {
      blenderPath:
        process.env.BLENDLINK_TANGENT_NORMAL_BLENDER ??
        '/Applications/Blender.app/Contents/MacOS/Blender',
      outDir: 'public/models',
      genDir: 'src/generated',
      scenes: references.sources.flatMap((source: any) =>
        [true, false].map((yup) => ({
          file: join(native, source.file),
          name: source.name + (yup ? '_yup' : '_zup'),
          exporterOverrides: { export_yup: yup },
        })),
      ),
    },
    root,
  )
  let outcomes
  try {
    outcomes = await syncAll(config, { force: true })
  } catch (error) {
    console.error((error as any).detail ?? error)
    throw error
  }
  const scenes = config.scenes.map((scene) => {
    const gltf = readGlbJson(readFileSync(scene.glbPath), 'Normal node Final') as any
    const meshes = gltf.meshes.filter(
      (mesh: any) => mesh.extras?.blendlink_tsl_runtime?.geometryContext?.length,
    )
    expect(meshes).toHaveLength(1)
    for (const primitive of meshes[0].primitives) {
      const position = gltf.accessors[primitive.attributes.POSITION],
        normal = gltf.accessors[primitive.attributes.NORMAL]
      expect(position.componentType).toBe(5126)
      expect(normal.componentType).toBe(5126)
    }
    const rawYup = scene.name.toLowerCase().endsWith('yup'),
      source = references.sources.find((item: any) => scene.blendPath === join(native, item.file))
    const manifest = parseManifest(readFileSync(scene.manifestPath, 'utf8'))!
    expect(manifest.materialPrograms).toBeTruthy()
    return {
      name: scene.name,
      source: source.name,
      manifestUrl: '/src/generated/' + scene.name + '.manifest.json',
      basis: rawYup ? 'gltf-y-up' : 'blender-z-up',
    }
  })
  expect((await verifyAll(config)).filter((issue) => issue.severity !== 'warning')).toEqual([])
  expect(references.sources.map((source: any) => hash(join(native, source.file)))).toEqual(before)
  writeFileSync(
    join(root, 'proof.json'),
    JSON.stringify(
      {
        nativeVersion: references.blender,
        exporter: built ? 'built' : 'source',
        pythonProvenance,
        nativeReferenceSha256: hash(join(native, 'native-reference.json')),
        sourceUnchanged: true,
        outcomes,
        scenes,
        references,
      },
      null,
      2,
    ),
  )
}, 360_000)
