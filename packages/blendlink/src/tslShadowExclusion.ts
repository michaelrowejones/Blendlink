import { irInspectionChildren } from './tslIrInspection.js'

export const SHADOW_EXCLUSION = { op: 'shadow_exclusion_native', model: 'eevee53-white-shadow-branch-v1' } as const
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
export function shadowExclusionInput(value: Record<string, unknown>, fail: (message: string) => never): unknown {
  if (Object.keys(value).sort().join(',') !== 'input,model,op,sourceProfile,visibleAlpha'
      || value.model !== SHADOW_EXCLUSION.model || value.sourceProfile !== 'blender53-macos-metal-shadow-transparent-v1'
      || typeof value.visibleAlpha !== 'number' || !Number.isFinite(value.visibleAlpha)
      || value.visibleAlpha <= 0 || value.visibleAlpha > 1 || Math.fround(value.visibleAlpha) !== value.visibleAlpha
      || !record(value.input) || Object.keys(value.input).sort().join(',') !== 'op,value'
      || value.input.op !== 'const_float' || value.input.value !== value.visibleAlpha)
    return fail('Shadow exclusion requires the pinned EEVEE white-transparent shadow-branch model')
  return value.input
}

/** Require the complete Alpha root; a discarded/nested field cannot alter shadows. */
export function hasShadowExclusion(channels: unknown, fail: (message: string) => never): boolean {
  let count = 0
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(visit); return }
    if (!record(value)) return
    if (value.op === SHADOW_EXCLUSION.op) { shadowExclusionInput(value, fail); count++ }
    irInspectionChildren(value).forEach(visit)
  }
  visit(channels)
  if (!count) return false
  const alpha = record(channels) && record(channels.Alpha) && record(channels.Alpha.tslIr) ? channels.Alpha.tslIr.output : null
  if (count !== 1 || !record(alpha) || alpha.op !== SHADOW_EXCLUSION.op)
    return fail('Shadow exclusion must occur once at the complete Alpha program root')
  return true
}

export interface ShadowMaterialState {
  model: 'eevee53-static-shadow-alpha-v1'
  visibleAlpha: number
}

export function validateShadowMaterialState(value: unknown, fail: (message: string) => never): ShadowMaterialState {
  if (!record(value) || Object.keys(value).sort().join(',') !== 'model,visibleAlpha'
      || value.model !== 'eevee53-static-shadow-alpha-v1'
      || typeof value.visibleAlpha !== 'number' || !Number.isFinite(value.visibleAlpha)
      || value.visibleAlpha <= 0 || value.visibleAlpha > 1 || Math.fround(value.visibleAlpha) !== value.visibleAlpha)
    return fail('Shadow material state requires the finite EEVEE static visible Alpha model in (0, 1]')
  return { model: value.model, visibleAlpha: value.visibleAlpha }
}

export function shadowMaterialState(channels: unknown, fail: (message: string) => never): ShadowMaterialState | undefined {
  if (!hasShadowExclusion(channels, fail)) return undefined
  const alpha = (channels as Record<string, { tslIr: { output: Record<string, unknown> } }>).Alpha.tslIr.output
  return validateShadowMaterialState({ model: 'eevee53-static-shadow-alpha-v1', visibleAlpha: alpha.visibleAlpha }, fail)
}

/** A shadow override may not inherit any of these surface channels from the
 * stock carrier: Blender's exporter can omit the authored visible Alpha. */
export function validateShadowMaterialNodes(nodes: Record<string, unknown>, state: unknown, fail: (message: string) => never): ShadowMaterialState | undefined {
  if (state === undefined && nodes.maskShadowNode == null) return undefined
  const validated = validateShadowMaterialState(state, fail)
  if (nodes.maskShadowNode == null
      || ['colorNode', 'metalnessNode', 'roughnessNode', 'emissiveNode', 'opacityNode'].some(slot => !record(nodes[slot]) || nodes[slot].isNode !== true))
    return fail('Shadow material state requires its mask and complete Base Color, Metallic, Roughness, Emission and Alpha nodes')
  // r184's public float()/bool() factories wrap constants in one intent VarNode.
  // Accept that exact constant shape as well as a direct ConstNode; arbitrary
  // scalar graphs cannot establish this static render-state contract.
  const constant = (node: unknown): unknown => record(node) && node.isVarNode === true && node.intent === true
    ? node.node : node
  const alpha = constant(nodes.opacityNode), mask = constant(nodes.maskShadowNode)
  if (!record(alpha) || alpha.isConstNode !== true || alpha.nodeType !== 'float' || alpha.value !== validated.visibleAlpha
      || !record(mask) || mask.isConstNode !== true || (mask.nodeType !== 'bool' && mask.nodeType !== null) || mask.value !== false)
    return fail('Shadow material state must match its constant visible Alpha and false shadow mask nodes')
  return validated
}
