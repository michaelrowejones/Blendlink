import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import ts from 'typescript'
import { captureRuntimeSnapshot } from './lib/runtime-provenance.mjs'

test('native proofs reject a stale nonentry module even with a fresh build timestamp', async () => {
  const root = await mkdtemp(join(tmpdir(), 'blendlink-runtime-proof-'))
  try {
    const source = join(root, 'packages/blendlink/src')
    const dist = join(root, 'packages/blendlink/dist')
    await mkdir(source, { recursive: true })
    await mkdir(join(root, 'packages/blendlink/scripts'), { recursive: true })
    await writeFile(join(root, 'packages/blendlink/scripts/copy-assets.mjs'), '// fixture build has no rewrites\n')
    const configuration = join(root, 'packages/blendlink/tsconfig.json')
    await writeFile(configuration, JSON.stringify({ compilerOptions: {
      target: 'ES2022', module: 'ESNext', outDir: './dist', rootDir: './src', sourceMap: true,
    }, include: ['src/**/*.ts'] }))
    await writeFile(join(source, 'dependency.ts'), 'export const enum Factor { Value = 7 }\n')
    await writeFile(join(source, 'entry.ts'), "import { Factor } from './dependency.js'\nexport const result = Factor.Value\n")
    const parsed = ts.parseJsonConfigFileContent(JSON.parse(await readFile(configuration, 'utf8')), ts.sys,
      join(root, 'packages/blendlink'))
    const emitted = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options }).emit()
    assert.equal(emitted.emitSkipped, false)
    const destination = join(root, 'snapshot')
    const { provenance } = await captureRuntimeSnapshot({ root, built: true, destination })
    assert.equal(provenance.modules.length, 2)
    assert.ok(provenance.modules.every(module => module.emitterMatchesSource && module.testedSnapshotSha256))
    assert.equal(provenance.snapshot.sourceMaps.length, 2)
    assert.equal(await readFile(join(destination, 'entry.js'), 'utf8'), await readFile(join(dist, 'entry.js'), 'utf8'))
    // Changing a dependency and touching the old JS defeated an entry-only
    // freshness check. Whole-program emission also catches inlined const enums.
    await writeFile(join(source, 'dependency.ts'), 'export const enum Factor { Value = 9 }\n')
    const future = new Date(Date.now() + 10_000)
    await utimes(join(dist, 'dependency.js'), future, future)
    await utimes(join(dist, 'entry.js'), future, future)
    await assert.rejects(captureRuntimeSnapshot({ root, built: true, destination }),
      /emitted JavaScript differs from current source/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
