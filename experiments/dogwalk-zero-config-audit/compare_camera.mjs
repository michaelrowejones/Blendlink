import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname)
const output = resolve(root, 'output')
const source = JSON.parse(
  await readFile(resolve(output, 'source-camera-evidence.json'), 'utf8'),
)
const browser = JSON.parse(
  await readFile(
    resolve(output, 'current-pose-with-animations-browser-evidence.json'),
    'utf8',
  ),
)

const blenderWorld = source.camera.worldMatrixRowsBlender
const basis = [
  [1, 0, 0, 0],
  [0, 0, 1, 0],
  [0, -1, 0, 0],
  [0, 0, 0, 1],
]
const multiply = (left, right) =>
  left.map((row) =>
    right[0].map((_, column) =>
      row.reduce(
        (sum, value, index) => sum + value * right[index][column],
        0,
      ),
    ),
  )
const fromColumnMajor = (values) =>
  Array.from({ length: 4 }, (_, row) =>
    Array.from({ length: 4 }, (_, column) => values[column * 4 + row]),
  )
const expectedWorld = multiply(basis, blenderWorld)
const browserWorld = fromColumnMajor(
  browser.result.cameraWorldMatrixColumnMajor,
)
const browserProjection = fromColumnMajor(
  browser.result.cameraProjectionMatrixColumnMajor,
)
const maxDifference = (left, right) =>
  Math.max(
    ...left.flatMap((row, rowIndex) =>
      row.map(
        (value, columnIndex) =>
          Math.abs(value - right[rowIndex][columnIndex]),
      ),
    ),
  )
const report = {
  schemaVersion: 1,
  classification:
    'research-only exact evaluated Blender versus stock glTF/Three camera differential',
  convention:
    'row-major matrices in this report; expected glTF world = Blender-to-glTF Y-up basis multiplied by evaluated Blender world',
  frame: source.frame,
  sourceWorldRowsBlender: blenderWorld,
  expectedWorldRowsGltf: expectedWorld,
  browserWorldRowsGltf: browserWorld,
  sourceProjectionRows: source.camera.projectionMatrixRows,
  browserProjectionRows: browserProjection,
  maximumAbsoluteDifference: {
    world: maxDifference(expectedWorld, browserWorld),
    projection: maxDifference(
      source.camera.projectionMatrixRows,
      browserProjection,
    ),
  },
  sourceEvidence: 'output/source-camera-evidence.json',
  browserEvidence:
    'output/current-pose-with-animations-browser-evidence.json',
}
await writeFile(
  resolve(output, 'camera-matrix-differential.json'),
  `${JSON.stringify(report, null, 2)}\n`,
  'utf8',
)
console.log(JSON.stringify(report, null, 2))
