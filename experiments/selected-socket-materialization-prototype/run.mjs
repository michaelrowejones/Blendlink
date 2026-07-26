// PROTOTYPE — one-command selected-socket Blender/glTF evidence runner.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const repository = path.resolve(here, '..', '..')
const blender = process.env.BLENDLINK_BLENDER_PATH
  ?? 'C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe'
const resultPath = path.join(here, 'output', 'result.json')

assert(existsSync(blender), `Blender executable is missing: ${blender}`)
rmSync(resultPath, { force: true })

const exitCode = await new Promise((resolve, reject) => {
  const child = spawn(blender, [
    '--background',
    '--factory-startup',
    '--python',
    path.join(here, 'run_blender.py'),
  ], {
    cwd: repository,
    stdio: 'inherit',
  })
  child.on('error', reject)
  child.on('close', resolve)
})

assert.equal(exitCode, 0, `Blender exited with code ${exitCode}`)
assert(existsSync(resultPath), 'Blender did not write output/result.json')

const evidence = JSON.parse(readFileSync(resultPath, 'utf8'))
for (const [name, passed] of Object.entries(evidence.checks ?? {})) {
  assert.equal(passed, true, `prototype check failed: ${name}`)
}

console.log(JSON.stringify({
  prototype: evidence.prototype,
  blenderVersion: evidence.blenderVersion,
  selectedField: evidence.selectedField,
  texture: evidence.texture,
  sourceRestored: evidence.checks.sourceRestored,
  stockGltf: evidence.checks.stockGltf,
  output: path.join(here, 'output'),
}, null, 2))
