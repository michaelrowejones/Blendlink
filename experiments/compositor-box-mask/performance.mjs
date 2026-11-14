// Host extent-classification cost only. This is not a GPU or frame-rate benchmark.
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { cpus, platform, arch } from 'node:os'
import { resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { captureRuntimeProvenance, hash } from '../../scripts/lib/runtime-provenance.mjs'

const root = resolve(import.meta.dirname, '../..')
const output = process.argv[2]
assert.ok(output, 'Usage: node experiments/compositor-box-mask/performance.mjs OUTPUT.json')
const { provenance } = await captureRuntimeProvenance({ root, built: true, label: 'Box Mask host performance' })
const { boxMaskIntervals } = await import('../../packages/blendlink/dist/tslCompositorBoxMask.js')
const settings = { operation: 'ADD', position: [.5, .5], size: [Math.fround(.2), Math.fround(.1)], mask: 0, value: 1 }
const percentile = (values, fraction) => values[Math.ceil(values.length * fraction) - 1]
const rows = []
for (const [width, height] of [[13, 9], [1920, 1080], [3840, 2160], [8192, 8192], [8192, 2]]) {
  const start = performance.now()
  const expected = boxMaskIntervals(width, height, settings)
  const firstCallMs = performance.now() - start
  // Warm the implementation separately from the retained timing samples.
  for (let index = 0; index < 20; index++) boxMaskIntervals(width, height, settings)
  const times = []
  for (let index = 0; index < 100; index++) {
    const before = performance.now()
    const actual = boxMaskIntervals(width, height, settings)
    times.push(performance.now() - before)
    assert.deepEqual(actual, expected)
  }
  times.sort((a, b) => a - b)
  rows.push({ width, height, axisSamplesPerReclassification: width + height,
    rectangleIntegers: expected, firstCallMs, samples: times.length,
    minMs: times[0], medianMs: percentile(times, .5), p95Ms: percentile(times, .95),
    maxMs: times.at(-1) })
}
const receipt = {
  schemaVersion: 1, status: 'MEASURED_BOX_MASK_HOST_CLASSIFIER',
  scope: 'One static Box Mask; host extent reclassification only, outside browser rendering. Existing extent-cache hits do not call this classifier.',
  measuredAt: new Date().toISOString(), host: { platform: platform(), arch: arch(), cpu: cpus()[0]?.model, node: process.version },
  scriptSha256: hash(await readFile(import.meta.filename)), provenance, rows,
  limits: ['Not a measured browser main-thread cost, frame rate, GPU cost, native Blender speedup, or whole-scene performance result.',
    'Each first call is the first call at that extent in this process, not an independent cold-process sample.',
    'No runtime resources or 2D mask image are allocated by the host interval classifier.']
}
await writeFile(resolve(output), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' })
console.log(JSON.stringify({ status: receipt.status, rows }))
