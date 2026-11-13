import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve, join } from 'node:path'
import { foldStaticNoise4dColor } from '../../packages/blendlink/src/staticNoise4d.ts'

const [before, after, output] = process.argv.slice(2).map(value => resolve(value))
const sha = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
const a = JSON.parse(await readFile(join(before!, 'report.json'), 'utf8'))
const b = JSON.parse(await readFile(join(after!, 'report.json'), 'utf8'))
for (const report of [a, b]) assert.ok(report.finished && report.completedAllCases && !report.failures.length && !report.executionFailures.length)
const index = await readFile(join(before!, 'reference/index.json'))
assert.equal(sha(index), sha(await readFile(join(after!, 'reference/index.json'))))
const manifest = JSON.parse(index.toString()), cells = new Map(manifest.cases.map((cell: any) => [cell.id, cell]))
const noise = (value: any): any[] => !value || typeof value !== 'object' ? []
  : [...(['noise_fractal', 'noise_normalized'].includes(value.op) ? [value] : []), ...Object.values(value).flatMap(noise)]
const rows = []
for (const row of b.rows) {
  const previous = a.rows.find((item: any) => item.backend === row.backend && item.id === row.id)
  assert.ok(previous)
  const cell: any = cells.get(row.id)
  const ir = await readFile(join(after!, 'reference/ir', row.id + '.json'))
  assert.equal(sha(ir), sha(await readFile(join(before!, 'reference/ir', row.id + '.json'))))
  const expected = await readFile(join(after!, 'reference', row.id + '.f32'))
  assert.equal(sha(expected), sha(await readFile(join(before!, 'reference', row.id + '.f32'))))
  const eligible = noise(JSON.parse(ir.toString())).some(expression => foldStaticNoise4dColor(expression) !== undefined)
  if (eligible) assert.ok(cell.kind === 'noise' && cell.stage === 'constant' && cell.dimensions === '4D'
    && cell.output === 'Color' && !(cell.Distortion ?? 0), 'A dynamic/native-unqualified case was unexpectedly folded')
  const left = await readFile(join(before!, previous.actualFile)), right = await readFile(join(after!, row.actualFile))
  assert.equal(left.length, right.length)
  let mismatches = 0
  for (let index = 0; index < left.length; index += 4) if (left.readUInt32LE(index) !== right.readUInt32LE(index)) mismatches++
  if (!eligible) assert.equal(mismatches, 0, row.backend + '/' + row.id)
  rows.push({ id: row.id, backend: row.backend, eligible, words: left.length / 4, mismatches,
    beforeSha256: sha(left), afterSha256: sha(right) })
}
const result = { before, after, nativeReferenceIndexSha256: sha(index), beforeProvenance: a.provenance, afterProvenance: b.provenance,
  rows, unchangedReadbacks: rows.filter(row => !row.eligible).length,
  unchangedWords: rows.filter(row => !row.eligible).reduce((sum, row) => sum + row.words, 0),
  foldedReadbacks: rows.filter(row => row.eligible).length }
await mkdir(output!, { recursive: true })
await writeFile(join(output!, 'unchanged-results.json'), JSON.stringify(result, null, 2))
console.log('BLENDLINK_STATIC_NOISE_UNCHANGED_PASSED', JSON.stringify({ unchangedReadbacks: result.unchangedReadbacks,
  unchangedWords: result.unchangedWords, foldedReadbacks: result.foldedReadbacks }))
