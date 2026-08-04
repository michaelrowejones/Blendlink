import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The pinned web runtime's hard ceilings, authored once as data beside the
 * Blender addon and read here so the compiled-artifact gate and the Blender
 * preflight cannot disagree. `web_runtime_limits.py` validates the same file
 * with the same rules; a headless check asserts both readings match, which is
 * the only thing that keeps two languages honest about one number.
 *
 * These are not budgets or recommendations. Crossing one of them produces a
 * black character or an invisible mesh with no runtime error at all, which is
 * why each record carries the symptom and the artist action rather than only
 * the number.
 */
export interface WebRuntimeLimit {
  id: string
  measure: string
  maximum: number
  summary: string
  symptom: string
  action: string
  evidence: string[]
}

export interface WebRuntimeLimitRegistry {
  schemaVersion: 1
  policy: string
  runtime: string
  limits: WebRuntimeLimit[]
}

const here = dirname(fileURLToPath(import.meta.url))

function registryPath(): string {
  const candidates = [
    // Packaged: copy-assets ships the addon beside the compiled JS.
    join(here, 'addon', 'web_runtime_limits.json'),
    // Workspace: running from source.
    join(here, '..', '..', 'blender-addon', 'web_runtime_limits.json'),
  ]
  const found = candidates.find((candidate) => existsSync(candidate))
  if (!found) {
    throw new Error(
      'Blendlink cannot read its web runtime limits. Looked in: ' +
        candidates.join(', ') +
        '. This file carries the ceilings that make skinning and UV binding ' +
        'refusals possible; without it Blendlink would publish scenes it ' +
        'knows cannot render.',
    )
  }
  return found
}

function validate(data: unknown): WebRuntimeLimitRegistry {
  const registry = data as WebRuntimeLimitRegistry
  if (!registry || typeof registry !== 'object' || registry.schemaVersion !== 1) {
    throw new Error('web runtime limit registry schemaVersion must be 1')
  }
  if (!Array.isArray(registry.limits) || registry.limits.length === 0) {
    throw new Error('web runtime limit registry limits must be a nonempty array')
  }
  const seen = new Set<string>()
  for (const [index, limit] of registry.limits.entries()) {
    if (!limit || typeof limit.id !== 'string' || !limit.id.trim()) {
      throw new Error(`limits[${index}].id must be non-empty text`)
    }
    if (seen.has(limit.id)) {
      throw new Error(`duplicate web runtime limit id ${limit.id}`)
    }
    seen.add(limit.id)
    if (!Number.isInteger(limit.maximum) || limit.maximum <= 0) {
      throw new Error(`limits[${index}].maximum must be a positive integer`)
    }
    for (const field of ['measure', 'summary', 'symptom', 'action'] as const) {
      if (typeof limit[field] !== 'string' || !limit[field].trim()) {
        throw new Error(`limits[${index}].${field} must be non-empty text`)
      }
    }
    if (!Array.isArray(limit.evidence) || limit.evidence.length === 0) {
      throw new Error(
        `limits[${index}].evidence must be a nonempty array; a ceiling ` +
          'without evidence is a guess',
      )
    }
  }
  return registry
}

let cache: WebRuntimeLimitRegistry | undefined

export function webRuntimeLimits(): WebRuntimeLimitRegistry {
  if (!cache) {
    cache = validate(JSON.parse(readFileSync(registryPath(), 'utf8')))
  }
  return cache
}

export function webRuntimeLimit(id: string): WebRuntimeLimit {
  const registry = webRuntimeLimits()
  const found = registry.limits.find((limit) => limit.id === id)
  if (!found) {
    throw new Error(
      `unknown web runtime limit ${id}; the registry declares ` +
        registry.limits.map((limit) => limit.id).sort().join(', '),
    )
  }
  return found
}

/** The artist-facing sentence pair every refusal on this limit reuses. */
export function webRuntimeLimitConsequence(id: string): string {
  const limit = webRuntimeLimit(id)
  return `${limit.symptom} ${limit.action}`
}
