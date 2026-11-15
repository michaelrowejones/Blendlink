import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { geometryFrame } from './geometry-inputs.mjs'

const root = resolve(import.meta.dirname, '../..'), source = resolve(process.argv[2]), out = resolve(process.argv[3])
const { validateGeometryContextBinding, validateGeometryContextCamera } = await import(pathToFileURL(join(root, 'packages/blendlink/dist/tslGeometryContext.js')))
const inputs = JSON.parse(await readFile(join(source, 'geometry-inputs.json'))), results = []
for (const input of inputs.cases) {
    const frame = geometryFrame(input)
    try {
        validateGeometryContextBinding(new Set(['object-normal']), frame.mesh, input.basis)
        validateGeometryContextCamera(frame.camera)
        results.push({ id: input.id, status: 'passed', vertices: frame.mesh.geometry.getAttribute('position').count, indices: input.index.length, basis: input.basis })
    } catch (error) { results.push({ id: input.id, status: 'refused', reason: String(error) }) }
    finally { frame.dispose() }
}
await writeFile(out, JSON.stringify({ status: results.every(r => r.status === 'passed') ? 'CPU_GEOMETRY_PREFLIGHT_PASSED' : 'CPU_GEOMETRY_PREFLIGHT_REFUSED', gpuCalls: 0, supportCredit: 0, results }, null, 2) + '\n')
assert.ok(results.every(r => r.status === 'passed'), 'Actual source geometry refused: inspect saved preflight')
console.log(JSON.stringify(results))
