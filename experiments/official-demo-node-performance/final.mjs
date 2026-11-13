// Actual standalone publication attempt. A refusal remains a recorded refusal.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { delimiter, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = resolve(fileURLToPath(new URL('../../', import.meta.url))), directory = fileURLToPath(new URL('./', import.meta.url))
const corpus = JSON.parse(await readFile(join(directory, 'corpus.json'), 'utf8')), args = process.argv.slice(2), options = {}
for (let index = 0; index < args.length; index += 2) { const key = args[index], value = args[index + 1]; assert.ok(['--blender', '--cli', '--output', '--sources', '--scene'].includes(key) && value && !value.startsWith('--') && !Object.hasOwn(options, key)); options[key] = value }
assert.ok(options['--blender'] && options['--cli'] && options['--output'], 'Use final.mjs --blender FILE --cli CAPTURED_DIST_CLI --output NEW_DIRECTORY [--sources DIR] [--scene ID]')
const sha = bytes => createHash('sha256').update(bytes).digest('hex'), cli = resolve(options['--cli']), output = resolve(options['--output']), sources = resolve(options['--sources'] ?? join(root, 'artifacts/verification-official-demo-performance/sources'))
const selected = corpus.scenes.filter(scene => !options['--scene'] || options['--scene'] === scene.id); assert.ok(selected.length)
await mkdir(output); await mkdir(join(output, 'copies'))
async function identity(path) { const records = []; async function visit(path) { for (const entry of (await readdir(path, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) { const file = join(path, entry.name); if (entry.isDirectory()) await visit(file); else { assert.ok(entry.isFile(), 'Captured SDK cannot contain symlinks'); records.push({ path: relative(dirname(cli), file), sha256: sha(await readFile(file)) }) } } }; await visit(path); return records }
const sdk = await identity(dirname(cli)), result = { schemaVersion: 1, kind: 'official-demo-actual-final-v1', nodeVersion: process.version, cli, sdkFiles: sdk, observations: [], startedAt: new Date().toISOString(), proofRole: 'Actual production standalone export, including its real conformance/refusal gates. No stock fallback is counted as publication.' }
for (const scene of selected) {
  const source = join(sources, scene.fileName), before = sha(await readFile(source)), expected = scene.extractedSha256 ?? scene.sha256; assert.equal(before, expected)
  const copy = join(output, 'copies', scene.fileName); await copyFile(source, copy)
  const destination = join(output, 'sites', scene.id), argv = [cli, 'export', '--blend', copy, '--out', destination], start = performance.now()
  const actual = spawnSync(process.execPath, argv, { encoding: 'utf8', timeout: 240_000, maxBuffer: 32 * 1024 * 1024, env: { ...process.env, PATH: dirname(process.execPath) + delimiter + process.env.PATH, BLENDLINK_BLENDER: resolve(options['--blender']), XDG_CACHE_HOME: join(output, 'private-cache') } })
  await writeFile(join(output, scene.id + '.stdout.log'), actual.stdout ?? ''); await writeFile(join(output, scene.id + '.stderr.log'), actual.stderr ?? '')
  const sourceAfter = sha(await readFile(source)), copyAfter = sha(await readFile(copy)); assert.equal(sourceAfter, expected); assert.equal(copyAfter, expected)
  let files = []; try { files = await readdir(destination) } catch (error) { if (error.code !== 'ENOENT') throw error }
  result.observations.push({ scene: scene.id, argv, elapsedMs: performance.now() - start, exitCode: actual.status, signal: actual.signal, processError: actual.error?.message, publishedWebsite: files.includes('index.html'), publicationFiles: files, sourceSha256Before: before, sourceSha256After: sourceAfter, copySha256After: copyAfter, status: actual.status === 0 && files.includes('index.html') ? 'published-awaiting-browser-proof' : actual.status === 1 && !files.length && /refused to publish|Website material compilation blocked|No authored camera|could not find.*camera/i.test(actual.stderr ?? '') ? 'production-refused-source-preserved' : 'unexpected-export-failure' })
  await writeFile(join(output, 'final-results.json'), JSON.stringify(result, null, 2) + '\n'); console.log(JSON.stringify(result.observations.at(-1)))
}
assert.deepEqual(await identity(dirname(cli)), sdk, 'Captured SDK changed during actual publication attempts'); result.sdkSnapshotStable = true; result.completedAt = new Date().toISOString(); await writeFile(join(output, 'final-results.json'), JSON.stringify(result, null, 2) + '\n')
process.exitCode = result.observations.some(row => row.status === 'unexpected-export-failure') ? 1 : 0
