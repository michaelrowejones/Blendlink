import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { foldStaticNoise4dColor } from '../../packages/blendlink/src/staticNoise4d.ts'

const directory = resolve(process.argv[2]!), output = resolve(process.argv[3]!), F = Math.fround
const manifest = JSON.parse(await readFile(join(directory, 'index.json'), 'utf8')), rows = []
const noises = (value: any): any[] => !value || typeof value !== 'object' ? []
  : [...(['noise_fractal', 'noise_normalized'].includes(value.op) ? [value] : []), ...Object.values(value).flatMap(noises)]
for (const cell of manifest.cases) {
  if (cell.kind !== 'noise' || cell.residual || cell.stage !== 'constant' || cell.dimensions !== '4D' || cell.output !== 'Color') continue
  const document = JSON.parse(await readFile(join(directory, 'ir', cell.id + '.json'), 'utf8'))
  const expression = noises(document)[0], value = foldStaticNoise4dColor(expression)
  const row: any = { id: cell.id, folded: !!value, perlinModel: expression.perlinModel, distortion: expression.distortion }
  if (value) {
    const binary = await readFile(join(directory, cell.id + '.f32'))
    const native = new Float32Array(binary.buffer.slice(binary.byteOffset, binary.byteOffset + binary.length))
    const expected = Array.from(native.subarray(0, 3)), actual = value.map(channel => F(F(channel * (cell.oracleScale ?? .0625)) + .5))
    const halfUlp = (x: number): number => Math.max(2 ** (Math.floor(Math.log2(Math.abs(x) || 2 ** -14)) - 10), 2 ** -24)
    const budgets = expected.map(channel => 2e-5 + (cell.engine === 'CYCLES' ? 0 : halfUlp(channel)))
    const errors = actual.map((channel, axis) => Math.abs(channel - expected[axis]!))
    Object.assign(row, { value, actual, expected, errors, budgets, ratio: Math.max(...errors.map((error, axis) => error / budgets[axis]!)) })
  }
  rows.push(row)
}
await mkdir(output, { recursive: true })
await writeFile(join(output, 'host-results.json'), JSON.stringify({ directory, blender: manifest.blender, rows }, null, 2))
console.log(JSON.stringify({ rows: rows.length, folded: rows.filter(row => row.folded).length, maxRatio: Math.max(...rows.filter(row => row.folded).map(row => row.ratio)),
  worst: rows.filter(row => row.folded).sort((a, b) => b.ratio - a.ratio).slice(0, 6) }, null, 2))
