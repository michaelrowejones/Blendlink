import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { expect, it } from 'vitest'
import { resolveConfig } from '../../packages/blendlink/src/config.js'

it('publishes actual constant sign-changing animation and native geometry programs', async () => {
  const directory = resolve(process.env.BLENDLINK_RENDERER_SIGN_NATIVE!)
  const reference = JSON.parse(readFileSync(join(directory, 'native-reference.json'), 'utf8'))
  const hash = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex')
  expect(reference.fixtureSha256).toBe(
    hash('packages/blender-addon/tests/renderer_sign_transition_check.py'),
  )
  const before = reference.sources.map((source: any) => hash(join(directory, source.file)))
  const { syncAll, verifyAll } = await import('../../packages/blendlink/dist/sync.js')
  const root = join(directory, 'compiled')
  mkdirSync(root, { recursive: true })
  const config = resolveConfig(
    {
      blenderPath: process.env.BLENDLINK_RENDERER_SIGN_BLENDER,
      outDir: 'public/models',
      genDir: 'src/generated',
      scenes: reference.sources.flatMap((source: any) =>
        [false, true].map((yup) => ({
          file: join(directory, source.file),
          name: source.name + (yup ? '_yup' : '_zup'),
          exporterOverrides: { export_yup: yup },
        })),
      ),
    },
    root,
  )
  const outcomes = await syncAll(config, { force: true })
  expect((await verifyAll(config)).filter((issue) => issue.severity !== 'warning')).toEqual([])
  expect(reference.sources.map((source: any) => hash(join(directory, source.file)))).toEqual(before)
  writeFileSync(
    join(root, 'proof.json'),
    JSON.stringify(
      {
        reference,
        sourceUnchanged: true,
        outcomes,
        scenes: config.scenes.map((scene) => ({
          name: scene.name,
          source: reference.sources.find(
            (source: any) => scene.blendPath === join(directory, source.file),
          ).name,
          basis: scene.name.endsWith('Yup') ? 'gltf-y-up' : 'blender-z-up',
          manifestUrl: '/src/generated/' + scene.name + '.manifest.json',
        })),
      },
      null,
      2,
    ),
  )
}, 180_000)
