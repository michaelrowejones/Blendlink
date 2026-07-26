import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const vitest = require.resolve('vitest/vitest.mjs')
const registryVariable = 'BLENDLINK_PUBLICATION_LEASE_REGISTRY'
const result = spawnSync(
  process.execPath,
  [vitest, 'run', '--passWithNoTests', ...process.argv.slice(2)],
  {
    stdio: 'inherit',
    windowsHide: true,
    env: {
      ...process.env,
      [registryVariable]: process.env[registryVariable] ?? join(
        tmpdir(),
        `blendlink-vitest-publication-leases-${process.pid}`,
      ),
    },
  },
)

if (result.error) throw result.error
if (result.signal) {
  throw new Error(`Vitest stopped after receiving ${result.signal}.`)
}
process.exitCode = result.status ?? 1
