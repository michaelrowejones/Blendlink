import type { TslIrExpression } from './tslNodeRecipe.js'
import { evaluateStaticNoiseInput } from './staticNoise4d.js'

export const NATIVE_MF_NOISE_INPUT_MESSAGE = 'Native normalized live Roughness nonzero Distortion requires exact MF coordinate inputs and portable constant arithmetic; use source baking'
export const NATIVE_SHADER_NOISE_INPUT_MESSAGE = 'Native normalized live Roughness nonzero Distortion requires portable constant arithmetic; use exact inputs or source baking'

const operands:Record<string,string[]>={
  math:['a','b','c'],vector_math:['a','b','c'],mapping:['input','location','rotation','scale'],
  vector_rotate:['input','center','axis','angle','rotation'],vector_scale:['input','scale'],
  combine:['x','y','z'],separate:['input'],clamp01:['input'],clamp_minmax:['value','min','max'],
  noise_normalized:['input','w','scale','roughnessNode'],noise_varying_native:['input','w','scale','roughnessNode'],
}
const arithmetic=new Set(['math','vector_math','mapping','vector_rotate','vector_scale'])
const transparent=new Set(['const_float','const_vec3',...Object.keys(operands)].filter(op=>!op.startsWith('noise_')))
function children(node:TslIrExpression):TslIrExpression[] {
  return (operands[node.op]??[]).map(key=>node[key]).filter(value=>value && typeof value==='object' && !Array.isArray(value) && 'op' in value) as TslIrExpression[]
}

/** The known constant island must agree under both source staging rules.
 * Noise/coordinates are opaque to this certificate, not proof annotations.
 * Inspect only executable operands so extra payload fields cannot hide an
 * unsafe closed expression behind a forged opaque child. */
export function hasPortableNoiseConstantArithmetic(expression:TslIrExpression):boolean {
  const opaque=(node:TslIrExpression,depth=0):boolean=>depth>32 || !transparent.has(node.op) || children(node).some(child=>opaque(child,depth+1))
  let count=0
  const visiting=new Set<object>()
  const visit=(node:TslIrExpression,depth:number):boolean=>{
    if(depth>32 || ++count>256 || visiting.has(node)) return false
    visiting.add(node)
    try {
      if(arithmetic.has(node.op)) {
        const exact=evaluateStaticNoiseInput(node,{exactArithmetic:true})
        const known=evaluateStaticNoiseInput(node)
        if(exact===undefined && (known!==undefined || !opaque(node))) return false
      }
      return children(node).every(child=>visit(child,depth+1))
    } finally { visiting.delete(node) }
  }
  return visit(expression,0)
}

export function hasExactMfNoiseCoordinates(expression:TslIrExpression):boolean {
  const input=evaluateStaticNoiseInput(expression.input as TslIrExpression,{exactArithmetic:true})
  if(expression.dimensions===1) return typeof input==='number'
  if(!Array.isArray(input) || input.length!==3) return false
  return expression.dimensions!==4 || typeof evaluateStaticNoiseInput(expression.w as TslIrExpression,{exactArithmetic:true})==='number'
}
