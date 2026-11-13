import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { officialBytes } from '../../scripts/lib/blender-build-discovery.mjs'
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const manifest = JSON.parse(await readFile(new URL('./corpus.json', import.meta.url), 'utf8'))
const args = process.argv.slice(2)
assert.ok(args.length === 0 || args.length === 2 && args[0] === '--directory' && args[1] && !args[1].startsWith('--'), 'Use acquire.mjs [--directory PATH]')
const directory = resolve(args[1] ?? 'artifacts/verification-official-demo-performance/sources'); await mkdir(directory, { recursive: true })
const receipts = []
for (const scene of manifest.scenes) {
  const archive = join(directory, scene.url.split('/').at(-1)); let bytes, cacheHit = false
  try { bytes = await readFile(archive); cacheHit = true } catch (error) { if (error.code !== 'ENOENT') throw error }
  if (!bytes) { bytes = (await officialBytes(scene.url, { purpose: 'archive', maximumBytes: scene.bytes, timeoutMs: 120_000 })).bytes; assert.equal(bytes.length, scene.bytes); assert.equal(sha(bytes), scene.sha256); await writeFile(archive, bytes, { flag: 'wx', mode: 0o444 }) }
  assert.equal(bytes.length, scene.bytes); assert.equal(sha(bytes), scene.sha256, 'Cached source changed: ' + scene.id)
  const path = join(directory, scene.fileName)
  if (scene.archiveEntry) {
    // Read only the exact pinned member. No extraction paths or other archive entries.
    const extracted = execFileSync('python3', ['-c', 'import sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); info=z.getinfo(sys.argv[2]); assert info.file_size==int(sys.argv[3]); sys.stdout.buffer.write(z.read(info))', archive, scene.archiveEntry, String(scene.extractedBytes)], { maxBuffer: scene.extractedBytes + 1 })
    assert.equal(sha(extracted), scene.extractedSha256)
    let previous; try { previous = await readFile(path) } catch (error) { if (error.code !== 'ENOENT') throw error }
    if (previous) assert.equal(sha(previous), scene.extractedSha256); else await writeFile(path, extracted, { flag: 'wx', mode: 0o444 })
  }
  receipts.push({ id: scene.id, path, sourceSha256: sha(await readFile(path)), archiveSha256: scene.sha256, archiveCacheHit: cacheHit, license: scene.license, source: scene.url, numericalQualification: false })
}
console.log(JSON.stringify({ schemaVersion: 1, kind: 'official-demo-acquisition-v1', assetsRedistributed: false, scenes: receipts }, null, 2))
