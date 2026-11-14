import { irInspectionChildren } from './tslIrInspection.js'

export interface NodeRendererProgramSelector { op: string; model: string }
export interface NodeRendererRequirement {
  schemaVersion: 1
  model: 'live-material-programs-v1'
  programs: readonly NodeRendererProgramSelector[]
}
export interface LegacySqueezeRendererRequirement { schemaVersion: 1; model: 'squeeze-native-v1' }
export type MaterialProgramRendererRequirement = NodeRendererRequirement | LegacySqueezeRendererRequirement

const SQUEEZE = { op: 'squeeze_native', model: 'eevee-squeeze-f32-v1' }
const MAGIC = { op: 'tex_magic_native', model: 'eevee-magic-f32-v1' }
const RADIAL_WIDTH = {op:'radial_segment_width',model:'regular-full-roundness-segment-width-v1'}
const REPEAT = {op:'repeat_static',model:'eevee-static-repeat-53-v1'}
const freshPrograms = [SQUEEZE, MAGIC, RADIAL_WIDTH, REPEAT]
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const key = (value: NodeRendererProgramSelector): string => JSON.stringify([value.op, value.model])

/** Only exact executable op/model matches grant a requirement. A mesh marker
 * alone cannot turn an unrelated portable program into a renderer dependency. */
export function matchingNodeRendererPrograms(value: unknown, selectors: readonly NodeRendererProgramSelector[]): NodeRendererProgramSelector[] {
  const matched = new Map<string, NodeRendererProgramSelector>()
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(visit); return }
    if (!record(value)) return
    for (const selector of selectors) if (value.op === selector.op && value.model === selector.model) matched.set(key(selector), selector)
    irInspectionChildren(value).forEach(visit)
  }
  visit(value)
  return [...matched.values()].sort((a, b) => key(a).localeCompare(key(b)))
}

export function nodeRendererProgramLabel(programs: readonly NodeRendererProgramSelector[]): string {
  return [...new Set(programs.map(program => program.op === SQUEEZE.op ? 'Squeeze Value'
    : program.op === MAGIC.op ? 'Magic Texture' : program.op === RADIAL_WIDTH.op ? 'Radial Tiling Segment Width' : program.op === REPEAT.op ? 'Repeat Zone' : 'live material program'))].join(' and ') || 'Live material program'
}

/** No Three import: ordinary unmarked portable scenes retain their no-fetch
 * and optional-peer paths. Old Squeeze declarations remain valid. */
export function validateNodeRendererRequirement(channels: unknown, declaration: unknown): {
  required: NodeRendererProgramSelector[]; issue?: string
} {
  const intrinsic = matchingNodeRendererPrograms(channels, freshPrograms)
  let declared: NodeRendererProgramSelector[] = []
  if (declaration !== undefined) {
    if (record(declaration) && declaration.schemaVersion === 1 && declaration.model === 'squeeze-native-v1') declared = [SQUEEZE]
    else if (record(declaration) && declaration.schemaVersion === 1 && declaration.model === 'live-material-programs-v1'
      && Object.keys(declaration).every(name => ['schemaVersion', 'model', 'programs'].includes(name))
      && Array.isArray(declaration.programs) && declaration.programs.length > 0 && declaration.programs.length <= 256
      && Array.from(declaration.programs).every(program => record(program) && Object.keys(program).length === 2
        && typeof program.op === 'string' && program.op.length > 0 && program.op.length <= 128
        && typeof program.model === 'string' && program.model.length > 0 && program.model.length <= 128)
      && new Set(declaration.programs.map(program => key(program as unknown as NodeRendererProgramSelector))).size === declaration.programs.length) {
      declared = declaration.programs as unknown as NodeRendererProgramSelector[]
    } else return { required: intrinsic, issue: 'Live material program has an unsupported or malformed exported node-renderer declaration on the actual primitive' }
  }
  const mismatchedModel = (value: unknown): boolean => {
    if (Array.isArray(value)) return value.some(mismatchedModel)
    if (!record(value)) return false
    return declared.some(program => program.op === value.op)
      && !declared.some(program => program.op === value.op && program.model === value.model)
      || irInspectionChildren(value).some(mismatchedModel)
  }
  if (mismatchedModel(channels)) return { required: intrinsic, issue: 'Live material program does not match its exported node-renderer declaration model on the actual primitive' }
  const missing = intrinsic.filter(program => !declared.some(item => key(item) === key(program)))
  if (missing.length) return { required: intrinsic, issue: `${nodeRendererProgramLabel(missing)} requires its exported node-renderer declaration on the actual primitive` }
  const matched = matchingNodeRendererPrograms(channels, declared)
  return { required: [...new Map([...intrinsic, ...matched].map(program => [key(program), program])).values()] }
}
