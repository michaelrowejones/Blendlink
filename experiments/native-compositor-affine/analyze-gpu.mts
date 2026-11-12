import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { IDENTITY_COMPOSITOR_AFFINE, multiplyCompositorAffine, compositorAffineSamplingMatrix,
  type CompositorAffineMatrix } from '../../packages/blendlink/src/tslCompositorAffineMath.ts'
import { compositorFma32 as fma } from '../../packages/blendlink/src/tslCompositorFma.ts'

const folder = resolve(process.argv[2]!), F = Math.fround
const rows = JSON.parse(await readFile(join(folder, 'index.json'), 'utf8'))
export const candidates = [
  (a: number, x: number, b: number, y: number, c: number) => F(F(F(a * x) + F(b * y)) + c),
  (a: number, x: number, b: number, y: number, c: number) => fma(a, x, fma(b, y, c)),
  (a: number, x: number, b: number, y: number, c: number) => fma(b, y, fma(a, x, c)),
  (a: number, x: number, b: number, y: number, c: number) => F(fma(a, x, F(b * y)) + c),
  (a: number, x: number, b: number, y: number, c: number) => F(fma(b, y, F(a * x)) + c),
  (a: number, x: number, b: number, y: number, c: number) => fma(a, x, F(F(b * y) + c)),
  (a: number, x: number, b: number, y: number, c: number) => fma(b, y, F(F(a * x) + c)),
  (a: number, x: number, b: number, y: number, c: number) => F(a * x + b * y + c),
]
const data = []
for (const row of rows) {
  const test = JSON.parse(await readFile(join(folder, row.case + '.json'), 'utf8'))
  if (!test.finite || ['exposure', 'blur'].includes(test.consumer)) continue
  let matrix = IDENTITY_COMPOSITOR_AFFINE
  for (const definition of test.definitions) matrix = multiplyCompositorAffine(definition.matrix, matrix)
  const nearest = test.definitions.at(-1)?.interpolation === 'Nearest'
  const identity = matrix.every((value: number, index: number) => Math.abs(value - IDENTITY_COMPOSITOR_AFFINE[index]!) <= 1e-5)
  const domain = { dataSize: [test.width, test.height] as const, displaySize: [test.width, test.height] as const, dataOffset: [0, 0] as const, matrix }
  const transform = compositorAffineSamplingMatrix(domain, { ...domain, matrix: IDENTITY_COMPOSITOR_AFFINE }, nearest)
  data.push({ ...test, transform, nearest, identity })
}
let seed = 713917
const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return F(seed / 2 ** 32) }
const controls = Array.from({ length: 24 }, (_, index) => ({ case: 'independent-matrix-' + index,
  width: 127, height: 23, matrix: [F(random() * .2 - .1), F(random() * .2 - .1), F(random() * 2 - 1),
    F(random() * .2 - .1), F(random() * .2 - .1), F(random() * 2 - 1), 0, 0, 1] }))
const stickyControls = []
for (const sign of [-1, 1]) for (const tailSign of [-1, 1]) for (const base of [1 + 2 ** -23, 8394069 / 2 ** 25])
  stickyControls.push({ case: `sticky-${sign}-${tailSign}-${base}`, width: 4, height: 4,
    matrix: [F(sign * base), 0, F(tailSign * 2 ** -50), 0, .25, 0, 0, 0, 1] })
controls.push(...stickyControls)
// Independent full bound canaries exercise zero/subpixel coefficients and both
// long image axes; these are not generated from the production matrix builder.
for (const [width, height] of [[8192, 1], [1, 8192], [8191, 1], [1, 8191], [257, 255]]) {
  for (const [index, matrix] of [[1 / width, 0, .5 / width, 0, 1 / height, .5 / height, 0, 0, 1],
    [.2501627504825592, 0, 2 ** -50, 0, -.2501627504825592, -(2 ** -50), 0, 0, 1],
    [-1 / width, 1 / height, 1, .125, -.25, 8192, 0, 0, 1],
    [64, -64, 2 ** -50, -64, 64, -(2 ** -50), 0, 0, 1]].entries())
    controls.push({ case: `wide-boundary-${width}-${height}-${index}`, width, height, matrix: matrix.map(F) })
}
await writeFile(join(folder, 'coordinate-input.json'), JSON.stringify([
  ...data.map(test => ({ case: test.case, width: test.width, height: test.height, matrix: test.transform })), ...controls]))
const reports = []
for (const [candidate, point] of candidates.entries()) {
  let max = 0, squares = 0, bad = 0, worst
  for (const test of data) {
    const { width, height, transform: m, input, nearest } = test
    const load = (x: number, y: number, component: number) => x < 0 || y < 0 || x >= width || y >= height ? 0 : input[(y * width + x) * 4 + component]!
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      let px = F(point(m[0], x, m[1], y, m[2]) * width), py = F(point(m[3], x, m[4], y, m[5]) * height)
      if (!nearest) { px = Math.floor(px * 256 + .5) / 256 - .5; py = Math.floor(py * 256 + .5) / 256 - .5 }
      const ix = Math.floor(px), iy = Math.floor(py), u = px - ix, v = py - iy
      for (let c = 0; c < 4; c++) {
        const actual = test.identity ? input[(y * width + x) * 4 + c] : nearest ? load(ix, iy, c) :
          F(load(ix, iy, c) * (1 - u) * (1 - v) + load(ix + 1, iy, c) * u * (1 - v) + load(ix, iy + 1, c) * (1 - u) * v + load(ix + 1, iy + 1, c) * u * v)
        const expected = test.expected[(y * width + x) * 4 + c], error = Math.abs(actual - expected)
        squares += error * error
        if (error > 0) bad++
        if (error > max) { max = error; worst = { case: test.case, x, y, c, actual, expected } }
      }
    }
  }
  reports.push({ candidate, max, squares, bad, worst })
}
reports.sort((a, b) => a.squares - b.squares)
console.log(JSON.stringify({ rows: data.length, ranking: reports }, null, 2))
await writeFile(join(folder, 'host-gpu-analysis.json'), JSON.stringify(reports, null, 2))

if (process.argv[3]) {
  const controls = JSON.parse(await readFile(resolve(process.argv[3]), 'utf8'))
  // Public native Matrix and browser uniforms both upload Float32 values.
  for (const row of controls.rows) row.matrix = row.matrix.map(F)
  const results = []
  for (const [candidate, point] of candidates.entries()) {
    let bad = 0, max = 0, worst
    for (const row of controls.rows) for (let y = 0; y < row.height; y++) for (let x = 0; x < row.width; x++) for (const axis of [0, 1]) {
      const m = row.matrix, offset = axis * 3, actual = point(m[offset], x, m[offset + 1], y, m[offset + 2])
      const expected = row.expected[(y * row.width + x) * 4 + axis], error = Math.abs(actual - expected)
      if (error > 0) bad++
      if (error > max) { max = error; worst = { case: row.case, x, y, axis, actual, expected } }
    }
    results.push({ candidate, bad, max, worst })
  }
  results.sort((a, b) => a.bad - b.bad)
  await writeFile(join(folder, 'compute-coordinate-analysis.json'), JSON.stringify(results, null, 2))
  console.log('RAW_COORDINATE_CLASSIFICATION', JSON.stringify(results, null, 2))
}
