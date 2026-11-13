import { createHash } from 'node:crypto'

// Reviewed 2026-11-11: patched Sharp/libvips chain. There are no advisory
// exceptions. Pin the complete native payload snapshot as well as the versions.
const REVIEWED_CHAIN_FINGERPRINT =
  '60749f3030d3509ff3b303ff0419a93c2586440081524ef5f5e62b0b5fdca3b4'

function auditFailure(detail) {
  throw new Error(
    `Unreviewed production audit result: ${detail}. `
    + 'Do not release until the new result has been investigated and the policy deliberately updated.',
  )
}

function dependencyFailure(detail) {
  throw new Error(
    `The reviewed production dependency chain changed: ${detail}. `
    + 'Re-run the live audit and review the patched image dependency chain before releasing.',
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

/** Require a well-formed, empty production audit over the patched graph. */
export function verifyProductionAuditReport(report) {
  const root = recordAt(report, 'audit report', auditFailure)
  if (root.auditReportVersion !== 2) auditFailure('expected auditReportVersion 2')
  const vulnerabilities = recordAt(root.vulnerabilities, 'vulnerabilities', auditFailure)
  const names = Object.keys(vulnerabilities).sort()
  if (names.length) auditFailure(`vulnerability packages were ${names.join(', ')}`)
  assertExactCounts(root.metadata?.vulnerabilities, {
    info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0,
  }, auditFailure)
  return { status: 'clean' }
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
 * Pin the installed packages and native payloads to the reviewed patched graph.
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
    'SceneToWeb @gltf-transform/functions version',
  )
  requireValue(
    workspace.dependencies?.['ndarray-pixels'],
    '5.2.0',
    'SceneToWeb ndarray-pixels version',
  )
  requireValue(workspace.dependencies?.sharp, '0.35.5', 'SceneToWeb Sharp version')
  requireValue(functionsPackage.version, '4.4.1', '@gltf-transform/functions version')
  requireValue(
    functionsPackage.dependencies?.['ndarray-pixels'],
    '^5.0.1',
    '@gltf-transform/functions -> ndarray-pixels range',
  )
  requireValue(ndarrayPackage.version, '5.2.0', 'ndarray-pixels version')
  requireValue(
    ndarrayPackage.dependencies?.sharp,
    '^0.35.0',
    'ndarray-pixels -> Sharp range',
  )
  requireValue(sharpPackage.version, '0.35.5', 'Sharp version')
  const fingerprint = fingerprintReviewedDependencyChain(lockfile)
  requireValue(
    fingerprint,
    REVIEWED_CHAIN_FINGERPRINT,
    'reviewed Sharp chain content fingerprint',
  )

  return {
    functions: '4.4.1',
    ndarrayPixels: '5.2.0',
    sharp: '0.35.5',
    fingerprint,
  }
}
