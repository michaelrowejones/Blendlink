import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { createNodePortBlenderLauncher } from '../../scripts/lib/node-port-python.mjs'
import { archiveNativeLauncher } from '../../scripts/lib/native-proof-archive.mjs'
import { executeNodePortCommand } from '../../scripts/lib/node-port-contract.mjs'
import { blend, sourceSha256, profiles, policies, images, frequencies, gates } from '../box-image-storage-stage/cases.mjs'

const [sourceArg, outArg, retainedArg, flag] = process.argv.slice(2)
assert.ok(sourceArg && outArg && retainedArg && flag === '--gpu-lease')
const source = resolve(sourceArg), out = resolve(outArg), retained = resolve(retainedArg)
await mkdir(out)
await writeFile(join(out, 'contract.json'), JSON.stringify({ blend, sourceSha256, profiles, policies, images, frequencies, gates }, null, 2) + '\n')
const root = resolve(import.meta.dirname, '../..')
const launcher = await createNodePortBlenderLauncher({ blender: '/Applications/Blender.app/Contents/MacOS/Blender', directory: join(out, 'active'), timeoutMs: 120000 })
let complete = false
try {
    const result = await executeNodePortCommand({ argv: [launcher.executable, '--background', '--factory-startup', '--disable-autoexec', '-t', '1', '--python-exit-code', '17', '--python', join(import.meta.dirname, 'capture.py'), '--', source, out, retained, ], cwd: root, timeoutMs: 120000, logPath: join(out, 'native.log') })
    assert.equal(result.exitCode, 0, 'Capture failed; inspect retained native.log'); assert.equal(result.timedOut, false)
    await launcher.finalize(); complete = true
    const native = JSON.parse(await readFile(join(out, 'native.json'))); console.log(JSON.stringify({ status: native.status, sourcePreserved: native.sourcePreserved, sourceSettings: native.sourceSettings, rows: native.rows.length }))
} finally {
    try { await writeFile(join(out, 'native-archive.json'), JSON.stringify({ complete, identity: launcher.identity, proof: await archiveNativeLauncher(launcher, out, complete) }, null, 2) + '\n') }
    finally { await launcher.dispose() }
}
