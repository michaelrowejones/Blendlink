import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { createNodePortBlenderLauncher } from '../../scripts/lib/node-port-python.mjs'
import { archiveNativeLauncher } from '../../scripts/lib/native-proof-archive.mjs'
import { executeNodePortCommand } from '../../scripts/lib/node-port-contract.mjs'
import { blend, gates, samplerCases, sourceSha256, weightCases } from './cases.mjs'

const [sourceArg, outArg, upstreamArg, flag] = process.argv.slice(2)
assert.ok(sourceArg && outArg && upstreamArg && ['--schema-only', '--gpu-lease'].includes(flag))
const source = resolve(sourceArg), out = resolve(outArg), upstream = resolve(upstreamArg)
await mkdir(out)
await writeFile(join(out, 'contract.json'), JSON.stringify({ blend, gates, samplerCases, sourceSha256, weightCases }, null, 2) + '\n')
const root = resolve(import.meta.dirname, '../..')
const launcher = await createNodePortBlenderLauncher({ blender: '/Applications/Blender.app/Contents/MacOS/Blender', directory: join(out, 'active'), timeoutMs: 120000 })
let complete = false
try {
  const result = await executeNodePortCommand({ argv: [launcher.executable, '--background', '--factory-startup', '--disable-autoexec', '-t', '1', '--python-exit-code', '17', '--python', join(import.meta.dirname, 'capture.py'), '--', source, out, upstream, ...(flag === '--schema-only' ? [flag] : [])], cwd: root, timeoutMs: 120000, logPath: join(out, 'native.log') })
  assert.equal(result.exitCode, 0, 'Capture failed; inspect retained native.log')
  assert.equal(result.timedOut, false)
  await launcher.finalize(); complete = true
  const native = JSON.parse(await readFile(join(out, 'native.json')))
  assert.equal(native.sourceSha256, sourceSha256)
  console.log(JSON.stringify({ status: native.status, sourcePreserved: native.sourcePreserved, images: native.images.map(i => ({ name: i.name, opaque: i.opaque, ranges: i.channelRanges })), rows: native.rows.length }))
} finally {
  try { await writeFile(join(out, 'native-archive.json'), JSON.stringify({ complete, identity: launcher.identity, proof: await archiveNativeLauncher(launcher, out, complete) }, null, 2) + '\n') }
  finally { await launcher.dispose() }
}
