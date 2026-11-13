import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
const bytes = await readFile(new URL('./corpus.json', import.meta.url)), corpus = JSON.parse(bytes), receipt = JSON.parse(await readFile(new URL('./receipt.json', import.meta.url), 'utf8'))

test('real-scene corpus pins small official licensed assets without redistributing them', () => {
  assert.equal(corpus.assetsRedistributed, false); assert.equal(corpus.scenes.length, 3); assert.ok(corpus.scenes.reduce((sum, scene) => sum + scene.bytes, 0) < 13_000_000)
  for (const scene of corpus.scenes) { assert.equal(new URL(scene.url).origin, 'https://download.blender.org'); assert.match(scene.sha256, /^[a-f0-9]{64}$/); assert.equal(scene.license, 'CC0-1.0'); assert.ok(scene.licenseEvidence); assert.ok(!scene.fileName.includes('/')) }
  assert.equal(corpus.scenes.find(scene => scene.id === 'cube-diorama').extractedSha256, 'a9906942c7100612cdcbc086b31179c96d1125c034140b39a87b9fe9fe65ab7e')
  assert.equal(receipt.corpusSha256, createHash('sha256').update(bytes).digest('hex'))
})

test('source load failures, stock controls and actual Final refusals keep distinct proof roles', () => {
  assert.equal(receipt.legacyLoadFailures.length, 2); assert.ok(receipt.legacyLoadFailures.every(row => row.processExit === 1 && row.status === 'native-file-load-refused'))
  assert.equal(receipt.actualProductionFinal.observations.length, 3); assert.equal(receipt.actualProductionFinal.sdkSnapshotStable, true)
  for (const row of receipt.actualProductionFinal.observations) { assert.equal(row.exitCode, 1); assert.equal(row.publishedWebsite, false); assert.deepEqual(row.publicationFiles, []); assert.equal(row.status, 'production-refused-source-preserved'); assert.equal(row.sourceSha256Before, row.sourceSha256After); assert.equal(row.sourceSha256Before, row.copySha256After) }
  for (const row of receipt.nativeStockControls) { assert.equal(row.sourcePreserved, true); assert.match(row.stockArtifact.role, /stock exporter control/i) }
  for (const row of receipt.nativeRenders) { assert.equal(row.status, 'passed'); assert.equal(row.result.gpuProfile.backend, 'METAL'); assert.equal(row.result.gpuProfile.vendor, 'Apple M5 Pro'); assert.ok(row.result.pixels.maximum > row.result.pixels.minimum) }
})

test('compiler optimization receipts compare full plans and scoped untimed Python allocation', () => {
  const pair = receipt.pairedCompilerOptimization; assert.equal(pair.pairs.length, 5)
  for (const row of pair.pairs) {
    assert.deepEqual(row.sourceChanges, ['packages/blender-addon/procedural.py']); assert.equal(row.fullPlanJsonIdentical, true)
    assert.deepEqual(row.baseline.timings.map(item => item.fullPlanSha256), row.candidate.timings.map(item => item.fullPlanSha256))
    for (const variant of [row.baseline, row.candidate]) { assert.equal(variant.sourceStatePreserved, true); assert.equal(variant.sourceFilePreserved, true); assert.match(variant.warmTracemalloc.scope, /native Blender\/GPU memory is excluded/) }
  }
  const med = numbers => [...numbers].sort((a, b) => a - b).slice(2, 4).reduce((sum, value) => sum + value, 0) / 2
  assert.equal(pair.warmed53Summary.baselineSamplesMs.length, 6); assert.equal(pair.warmed53Summary.baselineMedianMs, med(pair.warmed53Summary.baselineSamplesMs)); assert.equal(pair.warmed53Summary.candidateMedianMs, med(pair.warmed53Summary.candidateSamplesMs))
})
