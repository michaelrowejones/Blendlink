// PROTOTYPE — throwaway terminal shell for the EEVEE UV materializer question.
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { evaluatePrototype } from './verdict.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const resultPath = path.join(here, 'output', 'result.json')
const blender = process.env.BLENDER_BIN ?? 'C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe'
const nonInteractive = process.argv.includes('--run')

const state = {
  question: 'Is EEVEE UV-canvas rasterization a faithful, deterministic, useful material bake backend?',
  status: 'idle',
  blender,
  metrics: null,
  evaluation: null,
  error: null,
}

function render() {
  if (!nonInteractive) console.clear()
  console.log('\x1b[1mEEVEE UV materializer — PROTOTYPE\x1b[0m')
  console.log(`\x1b[1mquestion\x1b[0m: ${state.question}`)
  console.log(`\x1b[1mstatus\x1b[0m: ${state.status}`)
  console.log(`\x1b[2mblender\x1b[0m: ${state.blender}`)
  if (state.metrics) {
    console.log(`\x1b[1mrepeat pixel RMSE\x1b[0m: ${state.metrics.comparison.repeatRmse.toFixed(9)}`)
    console.log(`\x1b[1minterior RMSE\x1b[0m: ${state.metrics.comparison.interiorRmse.toFixed(6)}`)
    console.log(`\x1b[1mflat-region RMSE\x1b[0m: ${state.metrics.comparison.flatRegionRmse.toFixed(6)}`)
    console.log(`\x1b[1mEEVEE seconds\x1b[0m: ${state.metrics.eevee.secondsA.toFixed(3)} cold / ${state.metrics.eevee.secondsB.toFixed(3)} warm`)
    console.log(`\x1b[1mCycles seconds\x1b[0m: ${state.metrics.cycles.seconds.toFixed(3)}`)
    console.log(`\x1b[1mspeed ratio\x1b[0m: ${state.evaluation.speedRatio.toFixed(2)}x`)
    console.log(`\x1b[1mcoverage\x1b[0m: ${(state.metrics.eevee.coveredFraction * 100).toFixed(1)}%`)
    console.log(`\x1b[1mShader to RGB captured\x1b[0m: ${(state.metrics.shaderToRgb.coveredFraction * 100).toFixed(1)}%`)
    console.log(`\x1b[1mchecks\x1b[0m: ${JSON.stringify(state.evaluation.checks)}`)
    console.log(`\x1b[1mverdict\x1b[0m: ${state.evaluation.verdict}`)
    console.log(`\x1b[2moutput\x1b[0m: ${path.join(here, 'output')}`)
  }
  if (state.error) console.log(`\x1b[1merror\x1b[0m: ${state.error}`)
  if (!nonInteractive) console.log('\n\x1b[1m[r]\x1b[0m run experiment   \x1b[1m[q]\x1b[0m quit')
}

async function runExperiment() {
  if (!existsSync(blender)) {
    state.status = 'failed'
    state.error = `Blender not found: ${blender}`
    render()
    return false
  }
  state.status = 'running Blender fixture'
  state.error = null
  render()
  const code = await new Promise((resolve) => {
    const child = spawn(blender, [
      '--background', '--factory-startup', '--python', path.join(here, 'run_blender.py'),
    ], { cwd: path.resolve(here, '..', '..'), stdio: nonInteractive ? 'inherit' : ['ignore', 'pipe', 'pipe'] })
    let tail = ''
    child.stdout?.on('data', (chunk) => { tail = (tail + chunk).slice(-4000) })
    child.stderr?.on('data', (chunk) => { tail = (tail + chunk).slice(-4000) })
    child.on('close', (exitCode) => {
      if (exitCode !== 0) state.error = tail || `Blender exited ${exitCode}`
      resolve(exitCode)
    })
  })
  if (code !== 0 || !existsSync(resultPath)) {
    state.status = 'failed'
    state.error ??= 'Blender did not produce output/result.json'
    render()
    return false
  }
  state.metrics = JSON.parse(readFileSync(resultPath, 'utf8'))
  state.evaluation = evaluatePrototype(state.metrics)
  state.status = 'complete'
  render()
  return Object.values(state.evaluation.checks).every(Boolean)
}

if (nonInteractive) {
  render()
  process.exit((await runExperiment()) ? 0 : 1)
}

render()
process.stdin.setRawMode?.(true)
process.stdin.resume()
process.stdin.setEncoding('utf8')
process.stdin.on('data', async (key) => {
  if (key.toLowerCase() === 'q' || key === '\u0003') process.exit(0)
  if (key.toLowerCase() === 'r' && state.status !== 'running Blender fixture') await runExperiment()
})
