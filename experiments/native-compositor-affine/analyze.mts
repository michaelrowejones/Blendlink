import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { IDENTITY_COMPOSITOR_AFFINE, multiplyCompositorAffine, compositorAffineSamplingMatrix, compositorAffinePoint, realizeCompositorAffineDomain,
  type CompositorAffineMatrix } from '../../packages/blendlink/src/tslCompositorAffineMath.ts'

const folder = resolve(process.argv[2]!), F = Math.fround, add = (a: number, b: number) => F(a + b), mul = (a: number, b: number) => F(a * b)
const rows = JSON.parse(await readFile(join(folder, 'index.json'), 'utf8')), reports = []
function sample(input: number[], width: number, height: number, x: number, y: number, nearest: boolean): number[] {
  if (nearest) {
    const ix = Math.floor(mul(x, width)), iy = Math.floor(mul(y, height))
    return ix < 0 || iy < 0 || ix >= width || iy >= height ? [0, 0, 0, 0] : input.slice((iy * width + ix) * 4, (iy * width + ix) * 4 + 4)
  }
  x = F(mul(x, width) - .5); y = F(mul(y, height) - .5)
  const ix = Math.floor(x), iy = Math.floor(y), jx = Math.floor(add(x, 1)), jy = Math.floor(add(y, 1)), u = F(x - ix), v = F(y - iy)
  const a = mul(F(1 - u), F(1 - v)), b = mul(u, F(1 - v)), c = mul(F(1 - u), v), d = mul(u, v)
  const value = (x: number, y: number, component: number) => x < 0 || y < 0 || x >= width || y >= height ? 0 : input[(y * width + x) * 4 + component]!
  return [0, 1, 2, 3].map(component => add(add(mul(a, value(ix, iy, component)), mul(b, value(jx, iy, component))),
    add(mul(c, value(ix, jy, component)), mul(d, value(jx, jy, component)))))
}
for (const row of rows) {
  const test = JSON.parse(await readFile(join(folder, row.case + '.json'), 'utf8'))
  if (!test.finite || test.consumer === 'blur') continue
  let matrix = IDENTITY_COMPOSITOR_AFFINE
  for (const definition of test.definitions) matrix = multiplyCompositorAffine(definition.matrix, matrix)
  const nearest = test.definitions.at(-1)?.interpolation === 'Nearest'
  const identity = matrix.every((value: number, index: number) => Math.abs(value - IDENTITY_COMPOSITOR_AFFINE[index]!) <= 1e-5)
  const domain = { dataSize: [test.width, test.height] as const, displaySize: [test.width, test.height] as const, dataOffset: [0, 0] as const, matrix }
  let input = test.input, width = test.width, height = test.height, sourceDomain = domain
  if (test.consumer === 'exposure') {
    const realized = realizeCompositorAffineDomain(domain, false), first = compositorAffineSamplingMatrix(domain, realized, nearest)
    const data = [], gain = F(2 ** .25)
    for (let y = 0; y < realized.dataSize[1]; y++) for (let x = 0; x < realized.dataSize[0]; x++) {
      const coordinate = compositorAffinePoint(first, x, y), value = sample(input, width, height, ...coordinate, nearest)
      data.push(mul(value[0]!, gain), mul(value[1]!, gain), mul(value[2]!, gain), value[3]!)
    }
    input = data; width = realized.dataSize[0]; height = realized.dataSize[1]; sourceDomain = realized
  }
  const transform = compositorAffineSamplingMatrix(sourceDomain, { ...domain, matrix: IDENTITY_COMPOSITOR_AFFINE }, nearest)
  let max = 0, bad = 0, worst
  for (let y = 0; y < test.height; y++) for (let x = 0; x < test.width; x++) {
    const coordinate = compositorAffinePoint(transform, x, y)
    const values = identity && test.consumer !== 'exposure' ? test.input.slice((y * test.width + x) * 4, (y * test.width + x) * 4 + 4) : sample(input, width, height, ...coordinate, nearest)
    for (let component = 0; component < 4; component++) {
      const expected = test.expected[(y * test.width + x) * 4 + component], error = Math.abs(values[component]! - expected)
      if (error > 0) bad++
      if (error > max) { max = error; worst = { x, y, component, coordinate, actual: values[component], expected } }
    }
  }
  reports.push({ case: test.case, max, bad, worst, matrix, transform, realized: realizeCompositorAffineDomain(domain, false) })
}
reports.sort((a, b) => b.max - a.max)
await writeFile(join(folder, 'host-analysis.json'), JSON.stringify(reports, null, 2))
console.log(JSON.stringify({ rows: reports.length, exact: reports.filter(row => row.max === 0).length, max: Math.max(...reports.map(row => row.max)), worst: reports.slice(0, 8) }, null, 2))
