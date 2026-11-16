import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { availableParallelism, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const vitest = join(dirname(require.resolve('vitest/package.json')), 'vitest.mjs')
const registryVariable = 'BLENDLINK_PUBLICATION_LEASE_REGISTRY'
const requested = process.argv.slice(2)
// Several suites start their own TypeScript/Node children. Unbounded file
// workers overcommit the host and can turn valid checks into timeout failures.
const workerLimit = requested.some(arg => ['--maxWorkers', '--max-workers'].includes(arg)
  || arg.startsWith('--maxWorkers=') || arg.startsWith('--max-workers='))
  ? [] : [`--maxWorkers=${Math.min(4, availableParallelism())}`]
const result = spawnSync(
  process.execPath,
  [vitest, 'run', '--passWithNoTests', ...workerLimit, ...requested],
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
