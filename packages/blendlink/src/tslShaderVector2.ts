import { Fn, vec3 } from 'three/tsl'
import type { TslIrExpression } from './tslNodeRecipe.js'

export const SHADER_VECTOR2_MODEL = 'blender53-shader-float2-padded-v1'
/** Native shader float2 is represented as vec3(x,y,0). No arithmetic/cast mean. */
export function buildNativeVector2(
  expression: TslIrExpression,
  build: (input: TslIrExpression) => any,
  fail: (reason: string) => never,
): any {
  if (expression.op !== 'native_vector2' || expression.model !== SHADER_VECTOR2_MODEL
    || Object.keys(expression).some(key => !['op', 'model', 'input'].includes(key))
    || !expression.input || typeof expression.input !== 'object' || Array.isArray(expression.input)
    || typeof (expression.input as TslIrExpression).op !== 'string')
    return fail('Native shader float2 requires its pinned padded-vector model and one input')
  const input = build(expression.input as TslIrExpression)
  // Ask the real shader builder before swizzling. Three broadcasts scalar
  // swizzles, which would silently admit a refused native float->float2 cast.
  return Fn((builder) => {
    const type = input.getNodeType(builder)
    if (type !== 'vec3' && type !== 'vec4')
      return fail(`Native shader float2 needs vector/color child; ${String(type)} scalar/INT/BOOLEAN casts remain unqualified`)
    return vec3(input.x, input.y, 0)
  })()
}
