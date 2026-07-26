import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

import {
  verifyProductionAuditReport,
  verifyReviewedDependencyChain,
} from './production-audit-policy.mjs'

const npmExecPath = process.env.npm_execpath
if (!npmExecPath) {
  throw new Error(
    'The production audit verifier must be launched through `npm run audit:production` '
    + 'so it can invoke the same trusted npm installation.',
  )
}
const result = spawnSync(
  process.execPath,
  [npmExecPath, 'audit', '--omit=dev', '--json'],
  {
    cwd: new URL('..', import.meta.url),
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  },
)

if (result.error) {
  throw new Error(`Could not run npm audit: ${result.error.message}`)
}
if (result.signal) {
  throw new Error(`npm audit was terminated by ${result.signal}`)
}
if (result.status !== 0 && result.status !== 1) {
  throw new Error(
    `npm audit failed with exit ${String(result.status)}: ${result.stderr.trim() || '(no stderr)'}`,
  )
}

let report
try {
  report = JSON.parse(result.stdout)
} catch (error) {
  throw new Error(
    `npm audit did not return valid JSON: ${error instanceof Error ? error.message : String(error)}`,
  )
}

const lockfile = JSON.parse(
  readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'),
)
const graph = verifyReviewedDependencyChain(lockfile)
const policy = verifyProductionAuditReport(report)

if (policy.status === 'reviewed-workaround' && result.status !== 1) {
  throw new Error('npm audit unexpectedly returned success for the reviewed vulnerable graph')
}

console.log(
  'BLENDLINK_PRODUCTION_AUDIT_VERIFIED',
  policy.status,
  policy.advisory ?? 'no-advisories',
  `functions=${graph.functions}`,
  `ndarray-pixels=${graph.ndarrayPixels}`,
  `sharp=${graph.sharp}`,
)
