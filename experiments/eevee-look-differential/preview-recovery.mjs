import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { dirname, join, resolve } from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'

const execute = promisify(execFile)
const url = process.argv[2]
if (!url)
  throw new Error('Pass the URL of a running Preview Studio with a compiled disposable fixture.')
const npx =
  process.env.npm_execpath?.replace(/npm-cli\.js$/, 'npx-cli.js') ??
  join(dirname(process.execPath), 'node_modules/npm/bin/npx-cli.js')
const results = []
for (const backend of ['webgpu', 'webgl2']) {
  const session = `look-recovery-${process.pid}-${backend}`
  async function browser(...args) {
    const { stdout } = await execute(
      process.execPath,
      [npx, '--yes', 'agent-browser', '--session', session, '--json', ...args],
      { windowsHide: true, timeout: 30000, maxBuffer: 8 * 1024 * 1024 },
    )
    const result = JSON.parse(stdout)
    if (!result.success) throw new Error(result.error)
    return result.data
  }
  async function evaluated(script) {
    return (await browser('eval', script)).result
  }
  async function waitFor(generation, phase) {
    const until = Date.now() + 60000
    while (Date.now() < until) {
      const result = await evaluated(
        `(() => { const ack = window.__probe.acknowledgements.at(-1); return ack?.generation === 'look-regression-${generation}' && ack?.phase === '${phase}' ? { phase: ack.phase, canvases: document.querySelectorAll('canvas').length, active: !!document.querySelector('canvas.active') } : null })()`,
      )
      if (result) return result
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
    throw new Error(`${backend}: timed out waiting for ${generation} ${phase}`)
  }
  try {
    const target = new URL(url)
    if (backend === 'webgl2') target.searchParams.set('backend', 'webgl2')
    await browser(
      '--init-script',
      join(import.meta.dirname, 'preview-failure-init.js'),
      'open',
      target.href,
    )
    const initial = await waitFor(1, 'failed')
    assert.equal(initial.canvases, 0)
    await evaluated('window.__probe.failShaders = false; window.__probe.generation = 2')
    const recovered = await waitFor(2, 'ready')
    assert.equal(recovered.canvases, 1)
    await evaluated(
      'window.__retained = document.querySelector("canvas.active"); window.__probe.failShaders = true; window.__probe.generation = 3',
    )
    const failedCandidate = await waitFor(3, 'failed')
    assert.equal(failedCandidate.canvases, 1)
    assert.equal(
      await evaluated('window.__retained === document.querySelector("canvas.active")'),
      true,
    )
    await evaluated('window.__probe.failShaders = false; window.__probe.generation = 4')
    const corrected = await waitFor(4, 'ready')
    assert.equal(corrected.canvases, 1)
    assert.equal(
      await evaluated('window.__retained === document.querySelector("canvas.active")'),
      false,
    )
    await evaluated(
      backend === 'webgpu'
        ? 'window.__probe.devices.at(-1).destroy()'
        : 'document.querySelector("canvas.active").getContext("webgl2").getExtension("WEBGL_lose_context").loseContext()',
    )
    await waitFor(4, 'failed')
    await browser('click', '#retry-preview')
    const deviceRecovered = await waitFor(4, 'ready')
    assert.equal(deviceRecovered.canvases, 1)
    results.push({ backend, initial, recovered, failedCandidate, corrected, deviceRecovered })
    console.log(
      `${backend}: initial failure, retained view, shader recovery and device recovery passed`,
    )
  } finally {
    await browser('close').catch(() => {})
  }
}
const artifacts = resolve(import.meta.dirname, '../../artifacts/verification-look')
await mkdir(artifacts, { recursive: true })
// Keep only assertions and counts, never a local Preview acknowledgement token.
await writeFile(join(artifacts, 'preview-recovery-results.json'), JSON.stringify(results, null, 2))
