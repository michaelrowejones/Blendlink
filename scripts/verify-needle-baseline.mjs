import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'

const repositoryRoot = resolve(import.meta.dirname, '..')
const manifestPath = join(repositoryRoot, 'docs', 'needle-baseline.json')
const researchPath = join(repositoryRoot, 'docs', 'research-needle-behavioral-baseline-2026.md')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const research = readFileSync(researchPath, 'utf8')

if (manifest.schemaVersion !== 1) {
  throw new Error(`Unsupported Needle baseline schema ${String(manifest.schemaVersion)}; expected 1`)
}

function resolveRoot(name) {
  const descriptor = manifest.roots[name]
  if (!descriptor) throw new Error(`Needle baseline references unknown root ${name}`)
  if (descriptor.environment && process.env[descriptor.environment]) {
    return resolve(process.env[descriptor.environment])
  }
  if (descriptor.relativeToRepository) {
    return resolve(repositoryRoot, descriptor.relativeToRepository)
  }
  if (descriptor.defaultAbsolute && isAbsolute(descriptor.defaultAbsolute)) {
    return resolve(descriptor.defaultAbsolute)
  }
  throw new Error(
    `Needle baseline root ${name} is unavailable; set ${descriptor.environment ?? 'its configured environment variable'}`,
  )
}

const roots = Object.fromEntries(
  Object.keys(manifest.roots).map((name) => [name, resolveRoot(name)]),
)
const filesById = new Map()
const failures = []
const integrationStatuses = new Set(['coherent', 'mixed-source'])
const cleanTreeResults = new Map()

function verifyCleanPackageTree(label, rootName) {
  if (typeof rootName !== 'string' || !roots[rootName]) {
    failures.push(`${label}.cleanTreeRoot must name a pinned dependency fixture`)
    return
  }
  if (cleanTreeResults.has(rootName)) {
    const failure = cleanTreeResults.get(rootName)
    if (failure) failures.push(`${label} shares a failing clean package tree: ${failure}`)
    return
  }
  const npmExecPath = process.env.npm_execpath
  const npmCommand = npmExecPath && existsSync(npmExecPath)
    ? { executable: process.execPath, args: [npmExecPath, 'ls', '--all', '--json'] }
    : process.platform === 'win32'
      ? {
          executable: process.env.ComSpec ?? 'cmd.exe',
          args: ['/d', '/s', '/c', 'npm.cmd', 'ls', '--all', '--json'],
        }
      : { executable: 'npm', args: ['ls', '--all', '--json'] }
  const tree = spawnSync(npmCommand.executable, npmCommand.args, {
    cwd: roots[rootName],
    encoding: 'utf8',
    timeout: 120_000,
    windowsHide: true,
  })
  let failure = null
  if (tree.error) {
    failure = `could not run npm ls --all: ${tree.error.message}`
  } else if (tree.status !== 0) {
    const output = `${tree.stdout ?? ''}\n${tree.stderr ?? ''}`.trim()
    failure =
      `failed npm ls --all (exit ${String(tree.status)}): ` +
      `${output.slice(-2000) || 'no npm output'}`
  }
  cleanTreeResults.set(rootName, failure)
  if (failure) failures.push(`${label} clean package tree ${failure}`)
}

if (!manifest.integration || !integrationStatuses.has(manifest.integration.status)) {
  failures.push(
    'integration.status must be "coherent" or "mixed-source"; source identity alone is not end-to-end stack evidence',
  )
} else {
  if (typeof manifest.integration.reason !== 'string'
      || manifest.integration.reason.trim().length < 40) {
    failures.push('integration.reason must explain the observed package-stack evidence')
  }
  if (typeof manifest.integration.endToEndEvidence !== 'string'
      || manifest.integration.endToEndEvidence.trim().length === 0) {
    failures.push('integration.endToEndEvidence must name the coherent-stack gate or pending evidence')
  }
  verifyCleanPackageTree('integration', manifest.integration.cleanTreeRoot)
  if (!research.includes(`integration=${manifest.integration.status}`)) {
    failures.push(
      `integration status ${manifest.integration.status} is absent from the Markdown review surface`,
    )
  }
}

for (const entry of manifest.files) {
  if (filesById.has(entry.id)) failures.push(`duplicate file id ${entry.id}`)
  filesById.set(entry.id, entry)
  const root = roots[entry.root]
  if (!root) {
    failures.push(`${entry.id}: unknown root ${entry.root}`)
    continue
  }
  const absolute = resolve(root, ...entry.path.split('/'))
  const relativeGuard = resolve(root)
  if (absolute !== relativeGuard && !absolute.startsWith(`${relativeGuard}\\`) && !absolute.startsWith(`${relativeGuard}/`)) {
    failures.push(`${entry.id}: path escapes root: ${entry.path}`)
    continue
  }
  if (!existsSync(absolute)) {
    failures.push(`${entry.id}: missing ${absolute}`)
    continue
  }
  const digest = createHash('sha256').update(readFileSync(absolute)).digest('hex')
  if (digest !== entry.sha256) {
    failures.push(`${entry.id}: expected ${entry.sha256}, received ${digest} (${absolute})`)
  }
  if (!research.includes(entry.sha256)) {
    failures.push(`${entry.id}: digest is absent from the Markdown review surface`)
  }
}

function readPinnedJson(id) {
  const entry = filesById.get(id)
  if (!entry) {
    failures.push(`pinned JSON comparison references unknown file id ${id}`)
    return null
  }
  const root = roots[entry.root]
  if (!root) return null
  const absolute = resolve(root, ...entry.path.split('/'))
  if (!existsSync(absolute)) return null
  try {
    return JSON.parse(readFileSync(absolute, 'utf8'))
  } catch (error) {
    failures.push(`${id}: could not parse pinned JSON: ${error instanceof Error ? error.message : String(error)}`)
    return null
  }
}

const namedIntegrations = manifest.namedIntegrations ?? []
if (!Array.isArray(namedIntegrations)) {
  failures.push('namedIntegrations must be an array when present')
} else {
  const integrationIds = new Set()
  for (const integration of namedIntegrations) {
    if (!integration || typeof integration !== 'object') {
      failures.push('namedIntegrations contains a non-object entry')
      continue
    }
    const label = `named integration ${String(integration.id ?? '<missing>')}`
    if (typeof integration.id !== 'string'
        || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(integration.id)) {
      failures.push(`${label}.id must be a stable lowercase kebab-case identifier`)
      continue
    }
    if (integrationIds.has(integration.id)) {
      failures.push(`duplicate named integration id ${integration.id}`)
      continue
    }
    integrationIds.add(integration.id)
    if (!integrationStatuses.has(integration.status)) {
      failures.push(`${label}.status must be "coherent" or "mixed-source"`)
    }
    for (const field of ['scope', 'reason']) {
      if (typeof integration[field] !== 'string'
          || integration[field].trim().length < 40) {
        failures.push(`${label}.${field} must explain its narrowly bounded evidence`)
      }
    }
    if (typeof integration.endToEndEvidence !== 'string'
        || integration.endToEndEvidence.trim().length === 0) {
      failures.push(`${label}.endToEndEvidence must name its browser gate`)
    }
    if (!Array.isArray(integration.limitations)
        || integration.limitations.length === 0
        || integration.limitations.some(
          (limitation) => typeof limitation !== 'string' || limitation.trim().length === 0,
        )) {
      failures.push(`${label}.limitations must contain at least one explicit limitation`)
    }
    verifyCleanPackageTree(label, integration.cleanTreeRoot)

    if (!Array.isArray(integration.evidenceFileIds)
        || integration.evidenceFileIds.length === 0) {
      failures.push(`${label}.evidenceFileIds must name pinned integration evidence`)
    } else {
      const evidenceIds = new Set()
      for (const fileId of integration.evidenceFileIds) {
        if (typeof fileId !== 'string' || !filesById.has(fileId)) {
          failures.push(`${label} references unknown evidence file ${String(fileId)}`)
        } else if (evidenceIds.has(fileId)) {
          failures.push(`${label} repeats evidence file ${fileId}`)
        }
        evidenceIds.add(fileId)
      }
      if (!evidenceIds.has(integration.browserEvidenceFileId)) {
        failures.push(`${label}.browserEvidenceFileId must also appear in evidenceFileIds`)
      }
    }

    if (typeof integration.browserEvidenceFileId !== 'string') {
      failures.push(`${label}.browserEvidenceFileId must name passed browser evidence JSON`)
    } else {
      const browserEvidence = readPinnedJson(integration.browserEvidenceFileId)
      if (browserEvidence && browserEvidence.passed !== true) {
        failures.push(
          `${label} browser evidence ${integration.browserEvidenceFileId} is not passed=true`,
        )
      }
    }
    if (!research.includes(`integration:${integration.id}=${integration.status}`)) {
      failures.push(
        `${label} status is absent from the Markdown review surface`,
      )
    }
  }
}

function normalizedComponentCatalog(value, id) {
  if (!Array.isArray(value)) {
    failures.push(`${id}: expected a component metadata array`)
    return null
  }
  const seen = new Set()
  const normalized = []
  for (const component of value) {
    if (!component || typeof component !== 'object' || typeof component.name !== 'string') {
      failures.push(`${id}: component metadata contains a nameless/non-object entry`)
      return null
    }
    if (seen.has(component.name)) {
      failures.push(`${id}: duplicate component metadata name ${component.name}`)
      return null
    }
    seen.add(component.name)
    const children = Array.isArray(component.children) ? component.children : []
    normalized.push({
      name: component.name,
      file: component.file ?? null,
      kind: component.kind ?? null,
      inheritedFrom: component.inheritedFrom ?? null,
      categories: [...(component.categories ?? [])].sort(),
      groups: [...(component.groups ?? [])].sort(),
      flags: component.flags ?? null,
      children: children.map((child) => ({
        name: child?.name ?? null,
        kind: child?.kind ?? null,
        type: child?.type ?? null,
      })).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
    })
  }
  return normalized.sort((left, right) => left.name.localeCompare(right.name))
}

const addonComponentCatalog = normalizedComponentCatalog(
  readPinnedJson('addon-component-metadata'),
  'addon-component-metadata',
)
const engineComponentCatalog = normalizedComponentCatalog(
  readPinnedJson('engine-component-metadata'),
  'engine-component-metadata',
)
if (addonComponentCatalog && engineComponentCatalog
    && JSON.stringify(addonComponentCatalog) !== JSON.stringify(engineComponentCatalog)) {
  failures.push(
    'Needle add-on and engine component metadata differ after excluding documentation-only comments',
  )
}

for (const identity of manifest.identities) {
  const entry = filesById.get(identity.fileId)
  if (!entry) {
    failures.push(`${identity.name}: unknown identity file ${identity.fileId}`)
    continue
  }
  if (entry.path.endsWith('/package.json') || entry.path === 'package.json') {
    const packagePath = resolve(roots[entry.root], ...entry.path.split('/'))
    if (existsSync(packagePath)) {
      const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'))
      if (packageJson.version !== identity.version) {
        failures.push(
          `${identity.name}: expected version ${identity.version}, received ${String(packageJson.version)}`,
        )
      }
    }
  }
  if (!research.includes(identity.version)) {
    failures.push(`${identity.name}: version ${identity.version} is absent from the Markdown review surface`)
  }
}

if (failures.length) {
  throw new Error(
    `Needle behavioral baseline verification failed (${failures.length}):\n- ${failures.join('\n- ')}\n` +
      'Inspect the changed source, update the behavioral comparison and focused fixtures, then refresh hashes intentionally.',
  )
}

console.log(
  `BLENDLINK_NEEDLE_BASELINE_VERIFIED ${manifest.files.length} files, ` +
    `${manifest.identities.length} source version identities (${manifest.auditDate}) ` +
    `integration=${manifest.integration.status}` +
    (namedIntegrations.length
      ? ` named=${namedIntegrations.map(({ id, status }) => `${id}:${status}`).join(',')}`
      : ''),
)
