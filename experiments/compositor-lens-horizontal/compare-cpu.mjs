/* SPDX-License-Identifier: MIT */
/** Native sampling research replay. This is not a browser/Final qualification. */
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { horizontalLensAxisMapping } from '../../packages/blendlink/dist/tslCompositorLensHorizontal.js'
const directory = resolve(process.argv[2]), destination = resolve(process.argv[3])
assert.ok(process.argv[2] && process.argv[3], 'Use compare-cpu.mjs EVIDENCE OUTPUT')
const report = JSON.parse(await readFile(join(directory, 'native.json')))
assert.equal(report.status, 'CAPTURED_LENS_HORIZONTAL_CPU_PILOT_ZERO_CREDIT')
assert.equal(report.supportCredit, 0); assert.equal(report.nativeRenders, 8)
const F = Math.fround, hash = bytes => createHash('sha256').update(bytes).digest('hex')
const rows = []; let differences = 0
for (const row of report.rows) {
  const bytes = await readFile(join(directory, row.folder, row.lens)); assert.equal(hash(bytes), row.lensSha256)
  const native = JSON.parse(bytes), { width, height } = row
  const input = new Float32Array(native.input), expected = new Uint32Array(new Float32Array(native.expected).buffer)
  const actual = new Float32Array(input.length), words = new Uint32Array(actual.buffer)
  const redX = horizontalLensAxisMapping(width, 1), blueX = horizontalLensAxisMapping(width, -1), ys = horizontalLensAxisMapping(height, 0)
  const load = (x, y, channel) => x < 0 || y < 0 || x >= width || y >= height ? 0 : input[(y * width + x) * 4 + channel]
  const sample = (xs, x, y, channel) => {
    const offset = x * 4, yo = y * 4, left = F(1 - xs[offset + 2]), bottom = F(1 - ys[yo + 2])
    const weights = [F(left * bottom), F(xs[offset + 2] * bottom), F(left * ys[yo + 2]), F(xs[offset + 2] * ys[yo + 2])]
    const values = [load(xs[offset], ys[yo], channel), load(xs[offset + 1], ys[yo], channel),
      load(xs[offset], ys[yo + 1], channel), load(xs[offset + 1], ys[yo + 1], channel)]
    const products = values.map((v, i) => F(v * weights[i]))
    return F(F(products[0] + products[1]) + F(products[2] + products[3]))
  }
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const index = (y * width + x) * 4
    actual[index] = sample(redX, x, y, 0); actual[index + 1] = input[index + 1]; actual[index + 2] = sample(blueX, x, y, 2)
    actual[index + 3] = F(F(F(sample(redX, x, y, 3) + input[index + 3]) + sample(blueX, x, y, 3)) / 3)
  }
  let wordDifferences = 0; const examples = []
  for (let i = 0; i < words.length; i++) if (words[i] !== expected[i]) {
    wordDifferences++; if (examples.length < 8) examples.push({ index: i, actual: actual[i], native: native.expected[i], actualWord: words[i], nativeWord: expected[i] })
  }
  differences += wordDifferences; rows.push({ width, height, words: words.length, wordDifferences, examples })
}
const result = { status: differences ? 'CPU_NATIVE_COMPARISON_FAILED_ZERO_CREDIT' : 'CPU_NATIVE_COMPARISON_PASSED_ZERO_CREDIT', rows,
  wordDifferences: differences, supportCredit: 0, savedFinalCredit: 0, browserCredit: 0 }
await writeFile(destination, JSON.stringify(result, null, 2) + '\n'); console.log(JSON.stringify(result))
if (differences) process.exitCode = 1
