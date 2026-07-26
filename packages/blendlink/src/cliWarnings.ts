import type { CompiledSceneAudit } from './compiledSceneAudit.js'

const LOADER_RENAME = /^node "(.+)" loads as "(.+)" in three\.js \(loader-sanitized\) — the typed map uses the loaded name\.$/
const INLINE_RENAME_LIMIT = 3
const MATERIAL_WARNING = /^material '(.+)': (Needs Bake|Approximated) — (.+)$/
const INLINE_MATERIAL_LIMIT = 3

interface LoaderRename {
  authored: string
  loaded: string
}

function loaderRename(warning: string): LoaderRename | null {
  const match = LOADER_RENAME.exec(warning)
  return match ? { authored: match[1]!, loaded: match[2]! } : null
}

interface MaterialWarning {
  material: string
  status: string
  detail: string
}

function materialWarning(warning: string): MaterialWarning | null {
  const match = MATERIAL_WARNING.exec(warning)
  return match ? { material: match[1]!, status: match[2]!, detail: match[3]! } : null
}

function summarizeMaterialWarnings(warnings: readonly string[]): string[] {
  const groups = new Map<string, MaterialWarning[]>()
  for (const warning of warnings) {
    const parsed = materialWarning(warning)
    if (!parsed) continue
    const key = `${parsed.status}\u0000${parsed.detail}`
    const group = groups.get(key) ?? []
    group.push(parsed)
    groups.set(key, group)
  }
  const emitted = new Set<string>()
  const output: string[] = []
  for (const warning of warnings) {
    const parsed = materialWarning(warning)
    if (!parsed) {
      output.push(warning)
      continue
    }
    const key = `${parsed.status}\u0000${parsed.detail}`
    const group = groups.get(key)!
    if (group.length <= INLINE_MATERIAL_LIMIT) {
      output.push(warning)
      continue
    }
    if (emitted.has(key)) continue
    emitted.add(key)
    const examples = group.slice(0, INLINE_MATERIAL_LIMIT)
      .map((entry) => JSON.stringify(entry.material))
      .join(', ')
    output.push(
      `${group.length} materials: ${parsed.status} — ${parsed.detail}`,
      `Material examples: ${examples} (+${group.length - INLINE_MATERIAL_LIMIT} more). ` +
        'Full material evidence: generated scene manifest → sceneDiagnostics.materials.records.',
    )
  }
  return output
}

/** Format verbose compiler diagnostics for the human CLI only.
 *
 * The generated manifest remains the machine-readable source of truth. Keep
 * every distinct warning verbatim, but collapse large loader-rename lists so
 * material, lighting, and deployment problems stay visible to artists.
 */
export function formatHumanWarnings(warnings: readonly string[]): string[] {
  const materialSummaries = summarizeMaterialWarnings(warnings)
  const renames = materialSummaries.flatMap((warning) => {
    const rename = loaderRename(warning)
    return rename ? [rename] : []
  })
  if (renames.length <= INLINE_RENAME_LIMIT) return materialSummaries

  const sampleRenames = renames.slice(0, INLINE_RENAME_LIMIT)
  const sample = sampleRenames
    .map(({ authored, loaded }) => `${JSON.stringify(authored)} → ${JSON.stringify(loaded)}`)
    .join(', ')
  const remaining = renames.length - sampleRenames.length
  const formatted: string[] = []
  let summaryWritten = false
  for (const warning of materialSummaries) {
    if (loaderRename(warning)) {
      if (!summaryWritten) {
        formatted.push(
          `${renames.length} node names were adjusted by Three.js while loading; ` +
            'generated typed bindings already use the adjusted names.',
          `Name examples: ${sample} (+${remaining} more). ` +
            'Full list: generated scene manifest → vocabulary.warnings.',
        )
        summaryWritten = true
      }
      continue
    }
    formatted.push(warning)
  }
  return formatted
}

type MaterialAdvisoryAudit = Pick<
  CompiledSceneAudit,
  'materialPortability' | 'materialBindings' | 'materialPayloadCollapse'
>

/** Explain material portability without turning every Needs Bake material into
 * a release failure. Complete payload collapse remains the separate hard gate. */
export function formatMaterialPortabilityAdvisory(audit: MaterialAdvisoryAudit): string[] {
  const coverage = audit.materialPortability
  if (!coverage.diagnosticsPresent || coverage.needsBakeRenderedTriangles === 0) return []
  const share = coverage.totalRenderedTriangles > 0
    ? coverage.needsBakeRenderedTriangles / coverage.totalRenderedTriangles * 100
    : 0
  const noPayloadTriangles = coverage.needsBakeRenderedTriangles
    - coverage.needsBakeMeaningfulPayloadTriangles
  const top = audit.materialBindings
    .filter((binding) => binding.renderedTriangles > 0
      && binding.diagnostic?.status === 'needsBake')
    .sort((left, right) => right.renderedTriangles - left.renderedTriangles
      || left.name.localeCompare(right.name))
    .slice(0, 3)
  const lines = [
    `Visual parity review: ${coverage.needsBakeUsedMaterials}/${coverage.usedMaterials} used materials ` +
      `covering ${share.toFixed(1)}% (${coverage.needsBakeRenderedTriangles.toLocaleString('en-US')} tris) ` +
      `are Needs Bake; ${noPayloadTriangles.toLocaleString('en-US')} tris have no meaningful glTF material payload.`,
  ]
  if (top.length > 0) {
    lines.push(`Prioritize: ${top.map((binding) =>
      `${binding.name} (${binding.renderedTriangles.toLocaleString('en-US')} tris)`).join(', ')}.`)
  }
  if (coverage.diagnosedUsedMaterials < coverage.usedMaterials) {
    lines.push(
      `${coverage.diagnosedUsedMaterials}/${coverage.usedMaterials} used materials matched source diagnostics; ` +
      'inspect unmatched exported names before drawing a complete portability conclusion.',
    )
  }
  if (coverage.cyclesAppearanceBlockedUsedMaterials > 0) {
    lines.push(
      `${coverage.cyclesAppearanceBlockedUsedMaterials} matched used material(s) are blocked from the current ` +
      'Cycles Appearance bake; use a proven EEVEE materialization route, portable Principled inputs, or an application adapter.',
    )
  } else {
    lines.push(
      'No matched used material is marked blocked from the current Cycles Appearance bake; ' +
      'bake/materialize or simplify it, then compare the browser result with an authored reference.',
    )
  }
  if (!audit.materialPayloadCollapse.detected) {
    lines.push('The artifact is not completely collapsed, so this advisory does not fail the build.')
  }
  return lines
}

export function performanceResultFails(result: {
  report?: { passesBuildBudgets: boolean }
  audit?: Pick<CompiledSceneAudit, 'materialPayloadCollapse'>
  applicationMaterialAdapter?: string
}): boolean {
  return !result.report
    || !result.report.passesBuildBudgets
    || (result.audit?.materialPayloadCollapse.detected === true
      && !result.applicationMaterialAdapter)
}
