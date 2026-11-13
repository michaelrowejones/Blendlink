import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { it, expect } from 'vitest'
import { resolveConfig } from '../../packages/blendlink/src/config.js'
import { parseManifest } from '../../packages/blendlink/src/typegen.js'

it('publishes exact packed-Image input bytes in the actual pinned Final presentation', async () => {
  const root = resolve(process.env.BLENDLINK_COMPOSITOR_IMAGE_FINAL!)
  const built = process.env.BLENDLINK_COMPOSITOR_IMAGE_BUILT === '1'
  const { syncAll, verifyAll, publishedAssetPath } = await import(built
    ? '../../packages/blendlink/dist/sync.js' : '../../packages/blendlink/src/sync.js')
  const { decodeStaticCompositorImage } = await import(built
    ? '../../packages/blendlink/dist/tslCompositorStaticImage.js' : '../../packages/blendlink/src/tslCompositorStaticImage.js')
  const source = resolve(root, 'Artist Image.blend'), hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
  const before = hash(readFileSync(source))
  const config = resolveConfig({ blenderPath: process.env.BLENDLINK_COMPOSITOR_IMAGE_BLENDER ?? '/Applications/Blender.app/Contents/MacOS/Blender',
    outDir: 'public/models', genDir: 'src/generated', scenes: [{ name: 'staticImage', file: source }] }, root)
  const outcomes = await syncAll(config, { force: true })
  const scene = config.scenes[0]!, manifest = parseManifest(readFileSync(scene.manifestPath, 'utf8'))!
  expect(manifest.sourcePresentation).toBeTruthy()
  const asset = manifest.sourcePresentation!, path = publishedAssetPath(scene, asset.url, manifest)!
  const bytes = readFileSync(path), presentation = JSON.parse(bytes.toString())
  expect(bytes.byteLength).toBe(asset.bytes); expect(hash(bytes).slice(0, 16)).toBe(asset.hash)
  expect(presentation.compositor.status).toBe('extracted')
  expect(Object.keys(presentation.compositor.images)).toHaveLength(1)
  const input = decodeStaticCompositorImage(Object.values(presentation.compositor.images)[0] as any)
  const reference = JSON.parse(readFileSync(resolve(root, 'native-reference.json'), 'utf8'))
  const maximum = Math.max(...input.map((value, index) => Math.abs(value - reference.nativeInput[index])))
  expect(maximum).toBeLessThanOrEqual(2e-5)
  const issues = await verifyAll(config)
  expect(issues.filter(issue => issue.severity !== 'warning')).toEqual([])
  expect(hash(readFileSync(source))).toBe(before)
  writeFileSync(resolve(root, 'final-report.json'), JSON.stringify({ exporter: built ? 'built' : 'source', outcomes,
    sourceUnchanged: true, sourceHash: before, manifestPath: scene.manifestPath, glbPath: scene.glbPath,
    presentationPath: path, presentationSha256: hash(bytes), maximumDecodedInputError: maximum, verifyIssues: issues }, null, 2))
}, 180_000)
