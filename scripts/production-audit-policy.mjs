import { createHash } from 'node:crypto'

const REVIEWED_ADVISORY = Object.freeze({
  source: 1124066,
  name: 'sharp',
  severity: 'high',
  url: 'https://github.com/advisories/GHSA-f88m-g3jw-g9cj',
  range: '<0.35.0',
})

const REVIEWED_COUNTS = Object.freeze({
  info: 0,
  low: 0,
  moderate: 0,
  high: 3,
  critical: 0,
  total: 3,
})

const REVIEWED_CHAIN_FINGERPRINT =
  '191da92116d726780930ad4f31f049b6493a571ae656250b78785d5a84d11868'

function auditFailure(detail) {
  throw new Error(
    `Unreviewed production audit result: ${detail}. `
    + 'Do not release until the new result has been investigated and the policy deliberately updated.',
  )
}

function dependencyFailure(detail) {
  throw new Error(
    `The reviewed production dependency chain changed: ${detail}. `
    + 'Re-run the live audit and review the Sharp workaround before releasing.',
  )
}

function recordAt(value, path, fail) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${path} must be an object`)
  }
  return value
}

function assertExactCounts(actual, expected, fail) {
  const counts = recordAt(actual, 'metadata.vulnerabilities', fail)
  for (const [name, value] of Object.entries(expected)) {
    if (counts[name] !== value) {
      fail(`metadata.vulnerabilities.${name} was ${String(counts[name])}; expected ${value}`)
    }
  }
}

function assertStringVia(entry, expected, packageName) {
  if (
    !Array.isArray(entry.via)
    || entry.via.length !== 1
    || entry.via[0] !== expected
  ) {
    auditFailure(`${packageName}.via no longer identifies only ${expected}`)
  }
}

/**
 * Accept the one production advisory chain that has an upstream-documented,
 * behavior-tested loader workaround in Blendlink.
 *
 * This intentionally fails closed. Count-only allowlists are unsafe because a
 * new advisory can replace the reviewed one without changing the totals.
 */
export function verifyProductionAuditReport(report) {
  const root = recordAt(report, 'audit report', auditFailure)
  if (root.auditReportVersion !== 2) {
    auditFailure(`auditReportVersion was ${String(root.auditReportVersion)}; expected 2`)
  }

  const vulnerabilities = recordAt(
    root.vulnerabilities,
    'vulnerabilities',
    auditFailure,
  )
  const names = Object.keys(vulnerabilities).sort()

  if (names.length === 0) {
    assertExactCounts(root.metadata?.vulnerabilities, {
      info: 0,
      low: 0,
      moderate: 0,
      high: 0,
      critical: 0,
      total: 0,
    }, auditFailure)
    auditFailure(
      'npm omitted the reviewed Sharp advisory while the release policy still pins '
      + 'the vulnerable dependency snapshot',
    )
  }

  const expectedNames = [
    '@gltf-transform/functions',
    'ndarray-pixels',
    'sharp',
  ]
  if (
    names.length !== expectedNames.length
    || names.some((name, index) => name !== expectedNames[index])
  ) {
    auditFailure(`vulnerability packages were ${names.join(', ') || '(none)'}`)
  }
  assertExactCounts(root.metadata?.vulnerabilities, REVIEWED_COUNTS, auditFailure)

  const functionsEntry = recordAt(
    vulnerabilities['@gltf-transform/functions'],
    'vulnerabilities.@gltf-transform/functions',
    auditFailure,
  )
  if (functionsEntry.severity !== 'high' || functionsEntry.isDirect !== true) {
    auditFailure('@gltf-transform/functions severity/directness changed')
  }
  assertStringVia(functionsEntry, 'ndarray-pixels', '@gltf-transform/functions')

  const ndarrayEntry = recordAt(
    vulnerabilities['ndarray-pixels'],
    'vulnerabilities.ndarray-pixels',
    auditFailure,
  )
  if (ndarrayEntry.severity !== 'high' || ndarrayEntry.isDirect !== true) {
    auditFailure('ndarray-pixels severity/directness changed')
  }
  assertStringVia(ndarrayEntry, 'sharp', 'ndarray-pixels')

  const sharpEntry = recordAt(
    vulnerabilities.sharp,
    'vulnerabilities.sharp',
    auditFailure,
  )
  if (sharpEntry.severity !== 'high' || sharpEntry.isDirect !== true) {
    auditFailure('sharp severity/directness changed')
  }
  if (!Array.isArray(sharpEntry.via) || sharpEntry.via.length !== 1) {
    auditFailure('sharp.via no longer contains exactly one advisory')
  }
  const advisory = recordAt(sharpEntry.via[0], 'vulnerabilities.sharp.via[0]', auditFailure)
  for (const [field, expected] of Object.entries(REVIEWED_ADVISORY)) {
    if (advisory[field] !== expected) {
      auditFailure(
        `Sharp advisory ${field} was ${String(advisory[field])}; expected ${String(expected)}`,
      )
    }
  }

  return {
    status: 'reviewed-workaround',
    advisory: 'GHSA-f88m-g3jw-g9cj',
  }
}

function requireValue(actual, expected, label) {
  if (actual !== expected) {
    dependencyFailure(`${label} was ${String(actual)}; expected ${expected}`)
  }
}

function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize)
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    )
  }
  return value
}

function reviewedPackageRecord(packages, path) {
  return canonicalize(recordAt(packages[path], path, dependencyFailure))
}

export function fingerprintReviewedDependencyChain(lockfile) {
  const packages = recordAt(lockfile?.packages, 'package-lock packages', dependencyFailure)
  const workspace = recordAt(
    packages['packages/blendlink'],
    'packages/blendlink',
    dependencyFailure,
  )
  const sharpPackage = recordAt(
    packages['node_modules/sharp'],
    'node_modules/sharp',
    dependencyFailure,
  )
  const nativePackageNames = [
    ...Object.keys(recordAt(
      sharpPackage.optionalDependencies,
      'node_modules/sharp.optionalDependencies',
      dependencyFailure,
    )),
  ].sort()
  const sharpDependencyNames = [
    ...Object.keys(recordAt(
      sharpPackage.dependencies,
      'node_modules/sharp.dependencies',
      dependencyFailure,
    )),
  ].sort()
  const packageNames = [
    '@gltf-transform/functions',
    'ndarray-pixels',
    'sharp',
    ...sharpDependencyNames,
    ...nativePackageNames,
  ]
  const snapshot = canonicalize({
    workspaceDependencies: {
      '@gltf-transform/functions': workspace.dependencies?.['@gltf-transform/functions'],
      'ndarray-pixels': workspace.dependencies?.['ndarray-pixels'],
      sharp: workspace.dependencies?.sharp,
    },
    packages: Object.fromEntries(
      packageNames.map((name) => {
        const path = `node_modules/${name}`
        return [path, reviewedPackageRecord(packages, path)]
      }),
    ),
  })
  return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex')
}

/**
 * Pin the installed packages and edges to the graph examined with the advisory.
 * An upgrade is welcome, but it must produce a fresh audit rather than inheriting
 * an allow decision made for different bytes.
 */
export function verifyReviewedDependencyChain(lockfile) {
  const packages = recordAt(lockfile?.packages, 'package-lock packages', dependencyFailure)
  const workspace = recordAt(
    packages['packages/blendlink'],
    'packages/blendlink',
    dependencyFailure,
  )
  const functionsPackage = recordAt(
    packages['node_modules/@gltf-transform/functions'],
    'node_modules/@gltf-transform/functions',
    dependencyFailure,
  )
  const ndarrayPackage = recordAt(
    packages['node_modules/ndarray-pixels'],
    'node_modules/ndarray-pixels',
    dependencyFailure,
  )
  const sharpPackage = recordAt(
    packages['node_modules/sharp'],
    'node_modules/sharp',
    dependencyFailure,
  )

  requireValue(
    workspace.dependencies?.['@gltf-transform/functions'],
    '4.4.1',
    'Blendlink @gltf-transform/functions version',
  )
  requireValue(
    workspace.dependencies?.['ndarray-pixels'],
    '5.0.1',
    'Blendlink ndarray-pixels version',
  )
  requireValue(workspace.dependencies?.sharp, '0.34.5', 'Blendlink Sharp version')
  requireValue(functionsPackage.version, '4.4.1', '@gltf-transform/functions version')
  requireValue(
    functionsPackage.dependencies?.['ndarray-pixels'],
    '^5.0.1',
    '@gltf-transform/functions -> ndarray-pixels range',
  )
  requireValue(ndarrayPackage.version, '5.0.1', 'ndarray-pixels version')
  requireValue(
    ndarrayPackage.dependencies?.sharp,
    '^0.34.0',
    'ndarray-pixels -> Sharp range',
  )
  requireValue(sharpPackage.version, '0.34.5', 'Sharp version')
  const fingerprint = fingerprintReviewedDependencyChain(lockfile)
  requireValue(
    fingerprint,
    REVIEWED_CHAIN_FINGERPRINT,
    'reviewed Sharp chain content fingerprint',
  )

  return {
    functions: '4.4.1',
    ndarrayPixels: '5.0.1',
    sharp: '0.34.5',
    fingerprint,
  }
}
