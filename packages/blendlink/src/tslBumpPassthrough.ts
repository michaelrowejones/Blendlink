import { TslIrError, type TslIrExpression } from './tslNodeRecipe.js'

/** Only Blender's unlinked-Height branch: linked vectors retain their length. */
export function nativeBumpInput(expression: TslIrExpression): TslIrExpression {
  if (
    expression.model !== 'eevee-no-height-v1' ||
    expression.sourceEngine !== 'EEVEE' ||
    !expression.input ||
    typeof expression.input !== 'object' ||
    Array.isArray(expression.input)
  )
    throw new TslIrError('Bump passthrough requires the verified EEVEE no-height model')
  return expression.input as TslIrExpression
}

export function isNativeUnitNormal(expression: TslIrExpression): boolean {
  if (['normal_map_native', 'tangent_native', 'normal_map_tangent_native', 'bump_height_native'].includes(expression.op))
    return true
  if (expression.op === 'geometry_context') return expression.output === 'normal'
  return (
    expression.op === 'bump_passthrough_native' && isNativeUnitNormal(nativeBumpInput(expression))
  )
}
