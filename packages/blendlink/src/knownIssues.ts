import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  compareBlenderVersions,
  parseBlenderVersion,
  type BlenderVersion,
} from './blenderCompatibility.js'

export type KnownIssueSeverity = 'warning' | 'block'

export interface BlenderKnownIssue {
  id: string
  summary: string
  action: string
  severity: KnownIssueSeverity
  minInclusive: string
  maxExclusive: string
  evidence: string[]
}

export interface BlenderKnownIssueRegistry {
  schemaVersion: 1
  policy: string
  issues: BlenderKnownIssue[]
}

const BLENDER_EVIDENCE_HOSTS = new Set([
  'docs.blender.org',
  'developer.blender.org',
  'projects.blender.org',
])

function isPrimaryEvidence(url: URL): boolean {
  return BLENDER_EVIDENCE_HOSTS.has(url.hostname) || (
    url.hostname === 'github.com' &&
    url.pathname.startsWith('/KhronosGroup/glTF-Blender-IO/')
  )
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} must be non-empty text`)
  return value.trim()
}

/** Validate the checked-in registry as product data, not executable code. */
export function parseBlenderKnownIssueRegistry(input: unknown): BlenderKnownIssueRegistry {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('known-issue registry must be an object')
  }
  const root = input as Record<string, unknown>
  if (root.schemaVersion !== 1) {
    throw new Error(`known-issue registry schemaVersion ${String(root.schemaVersion)} is unsupported (expected 1)`)
  }
  if (!Array.isArray(root.issues)) throw new Error('known-issue registry issues must be an array')
  const ids = new Set<string>()
  const issues = root.issues.map((candidate, index) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      throw new Error(`issues[${index}] must be an object`)
    }
    const item = candidate as Record<string, unknown>
    const id = text(item.id, `issues[${index}].id`)
    if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) throw new Error(`issues[${index}].id must be a lowercase slug`)
    if (ids.has(id)) throw new Error(`duplicate known-issue id ${id}`)
    ids.add(id)
    const severity = item.severity
    if (severity !== 'warning' && severity !== 'block') {
      throw new Error(`issues[${index}].severity must be warning or block`)
    }
    const minInclusive = text(item.minInclusive, `issues[${index}].minInclusive`)
    const minimum = parseBlenderVersion(minInclusive, `issues[${index}].minInclusive`)
    const maxExclusive = text(item.maxExclusive, `issues[${index}].maxExclusive`)
    if (compareBlenderVersions(
      parseBlenderVersion(maxExclusive, `issues[${index}].maxExclusive`),
      minimum,
    ) <= 0) {
      throw new Error(`issues[${index}].maxExclusive must be newer than minInclusive`)
    }
    if (!Array.isArray(item.evidence) || item.evidence.length === 0) {
      throw new Error(`issues[${index}].evidence needs at least one primary-source URL`)
    }
    const evidence = item.evidence.map((source, sourceIndex) => {
      const value = text(source, `issues[${index}].evidence[${sourceIndex}]`)
      let url: URL
      try {
        url = new URL(value)
      } catch {
        throw new Error(`issues[${index}].evidence[${sourceIndex}] is not a URL`)
      }
      if (url.protocol !== 'https:' || !isPrimaryEvidence(url)) {
        throw new Error(
          `issues[${index}].evidence[${sourceIndex}] must be an HTTPS Blender/Khronos primary source`,
        )
      }
      return value
    })
    return {
      id,
      summary: text(item.summary, `issues[${index}].summary`),
      action: text(item.action, `issues[${index}].action`),
      severity,
      minInclusive,
      maxExclusive,
      evidence,
    } satisfies BlenderKnownIssue
  })
  return {
    schemaVersion: 1,
    policy: text(root.policy, 'known-issue registry policy'),
    issues,
  }
}

function registryPath(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  const candidates = [
    join(here, 'addon', 'blender_known_issues.json'),
    join(here, '..', '..', 'blender-addon', 'blender_known_issues.json'),
  ]
  const path = candidates.find(existsSync)
  if (!path) {
    throw new Error(
      `bundled Blender known-issue registry is missing (checked ${candidates.join(', ')})`,
    )
  }
  return path
}

export function loadBlenderKnownIssueRegistry(): BlenderKnownIssueRegistry {
  const path = registryPath()
  try {
    return parseBlenderKnownIssueRegistry(JSON.parse(readFileSync(path, 'utf8')))
  } catch (error) {
    throw new Error(
      `${path}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

export function matchingBlenderKnownIssues(
  blenderVersion: BlenderVersion,
  registry = loadBlenderKnownIssueRegistry(),
): BlenderKnownIssue[] {
  return registry.issues.filter((issue) => {
    if (compareBlenderVersions(
      blenderVersion,
      parseBlenderVersion(issue.minInclusive, `${issue.id}.minInclusive`),
    ) < 0) return false
    return compareBlenderVersions(
      blenderVersion,
      parseBlenderVersion(issue.maxExclusive, `${issue.id}.maxExclusive`),
    ) < 0
  })
}
