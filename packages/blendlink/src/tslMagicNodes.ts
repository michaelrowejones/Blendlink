/* SPDX-FileCopyrightText: 2011-2022 Blender Foundation
 * SPDX-FileCopyrightText: 2026 SceneToWeb contributors
 * SPDX-License-Identifier: Apache-2.0
 * Cascade adapted from Cycles kernel/svm/magic.h. Native EEVEE source audits
 * select the GLSL floor-mod stage or the no-mod material-MF stage separately.
 * See assets/blender-spectral-NOTICE.txt and LICENSES.md. */
import * as TSL from 'three/tsl'
import type { BuildTslOptions, TslExpression, TslIrExpression } from './tslNodeRecipe.js'
import { buildPortableSine, buildPortableCosine } from './tslPortableTrig.js'
import { buildNativeNoiseFma } from './tslNativeNoisePrecision.js'
import { validateMagicWithoutOwner } from './tslMagicBounds.js'
import { hasPortableNoiseConstantArithmetic } from './tslNoiseInputPrecision.js'
import { evaluateStaticNoiseInput } from './staticNoise4d.js'
type Node = any
const { Fn, bitcast, float, floor, select, uint, vec3 } = TSL as unknown as Record<
  'Fn' | 'bitcast' | 'float' | 'floor' | 'select' | 'uint' | 'vec3', (...args: Node[]) => Node>
const rn = (value: Node): Node => {
  const bits = bitcast(value, 'uint').toVar()
  return bitcast(select(bits.equal(uint(0x7fc00000)), uint(0), bits), 'float').toVar()
}
const sine = (value: Node): Node => rn(buildPortableSine(value))
const cosine = (value: Node): Node => rn(buildPortableCosine(value))
function scalarShape(expression: TslIrExpression | undefined, depth=0, budget={count:0}): boolean {
  if (!expression || depth>32 || ++budget.count>256) return false
  const child=(key:string):boolean=>scalarShape(expression[key] as TslIrExpression,depth+1,budget)
  switch(expression.op) {
    case 'const_float': case 'separate': case 'rgb_to_bw': case 'math_modulo_native': return true
    case 'clamp01':return child('input')
    case 'clamp_minmax':return ['value','min','max'].every(child)
    case 'math':return child('a') && ['b','c'].filter(key=>key in expression).every(child)
    case 'noise': case 'noise_fractal': case 'noise_normalized': case 'noise_varying': case 'noise_varying_native': case 'tex_white_noise': return expression.output!=='color'
    case 'tex_image':case 'texture_ref':return expression.output==='alpha'
    case 'tex_checker':case 'tex_magic_native':return expression.output==='fac'
    default:return false
  }
}
export function magicControlRange(expression:TslIrExpression):[number,number]|undefined {
  const known=evaluateStaticNoiseInput(expression,{exactArithmetic:true})
  if(typeof known==='number')return [known,known]
  if(!scalarShape(expression))return undefined
  if(expression.op==='clamp01')return [0,1]
  if(expression.op==='clamp_minmax') {
    const low=evaluateStaticNoiseInput(expression.min as TslIrExpression,{exactArithmetic:true})
    const high=evaluateStaticNoiseInput(expression.max as TslIrExpression,{exactArithmetic:true})
    if(typeof low==='number' && typeof high==='number' && low<=high)return [low,high]
  }
  return undefined
}
export function buildTslMagicNode(expression: TslIrExpression,
  build: (expression: TslIrExpression) => TslExpression, fail: (message: string) => never, options: BuildTslOptions = {}): TslExpression {
  const {model,sourceEngine,evaluationModel,nativeGpuBackend,nativeVersion,depth,output}=expression
  if (model !== 'eevee-magic-f32-v1' || sourceEngine !== 'EEVEE'
    || !['shader','mf'].includes(String(evaluationModel)) || !['color','fac'].includes(String(output))
    || typeof depth !== 'number' || !Number.isInteger(depth) || depth < 0 || depth > 10)
    return fail('Magic Texture needs its native EEVEE model, depth 0..10 and Color/Factor output')
  // Early v1 documents did not carry a version. Preserve them, but never
  // ignore an explicit claim to a source version/stage we have not measured.
  if(nativeVersion!==undefined&&(!Array.isArray(nativeVersion)||nativeVersion.length!==3
    ||!nativeVersion.every(value=>typeof value==='number'&&Number.isInteger(value))
    ||!['4.2.0','5.2.0','5.3.0'].includes(nativeVersion.join('.'))))
    return fail('Magic Texture has no qualified precision model for this explicit native source version')
  if(Array.isArray(nativeVersion)&&nativeVersion[0]===4&&evaluationModel==='mf')
    return fail('Magic Texture Blender 4.2.0 requires shader evaluation; its material MF stage is unqualified')
  const child = (key: string): TslIrExpression => {
    const value = expression[key]
    if (!value || typeof value !== 'object' || typeof (value as TslIrExpression).op !== 'string') return fail('Magic Texture needs an expression for ' + key)
    return value as TslIrExpression
  }
  for (const [key,limit] of [['scale',8],['distortion',1]] as const) {
    const range=magicControlRange(child(key))
    if(!range || range.some(value=>Math.abs(value)>limit))return fail('Magic Texture '+key+' requires exact static controls or an authored scalar Clamp within magnitude '+limit)
    if(key==='distortion' && !(range[0]===0 && range[1]===0) && !(range[0]>=.25 || range[0]>=-.5 && range[1]<=-.25))
      return fail('Magic Texture nonzero Distortion must stay in [.25,1] or [-.5,-.25]; use source baking outside the verified band')
  }
  if(!['METAL','OPENGL'].includes(String(nativeGpuBackend)))return fail('Magic Texture source GPU backend has no verified live precision model')
  if(['vector','scale','distortion'].some(key=>!hasPortableNoiseConstantArithmetic(child(key))))return fail('Magic Texture inputs require portable exact constant arithmetic islands; use literal/exact plumbing or source baking')
  if (evaluationModel === 'mf') {
    if(['scale','distortion'].some(key=>typeof evaluateStaticNoiseInput(child(key),{exactArithmetic:true})!=='number'))return fail('Magic Texture MF controls require independently exact static Float32 arithmetic')
    const value = evaluateStaticNoiseInput(child('vector'), { exactArithmetic: true })
    if (!Array.isArray(value) || value.length!==3 || ![0,1,2].every(i=>typeof value[i]==='number' && Number.isFinite(value[i]) && Math.abs(value[i])<=16)) return fail('Magic Texture MF coordinates require exact static Float32 vectors within magnitude 16')
  }
  if (!validateMagicWithoutOwner(expression,options)) {
    if (!options.validateMagicCoordinates) return fail('Magic Texture field coordinates require an actual mesh-bound coordinate validator')
    options.validateMagicCoordinates(expression)
  }
  let imageInputs=false
  const checkImages=(value:unknown,depth=0):void=>{
    if(depth>64)return fail('Magic Texture image inputs exceed their validation budget')
    if(Array.isArray(value)){for(const child of value)checkImages(child,depth+1);return}
    if(!value||typeof value!=='object')return
    const node=value as TslIrExpression
    if(['texture_ref','tex_image_native'].includes(node.op))return fail('Magic Texture image inputs require qualified opaque embedded nearest float data')
    if(node.op==='tex_image'){
      imageInputs=true
      const pixels=node.pixels
      if(node.sourceEngine!=='EEVEE'||node.nativeGpuBackend!==nativeGpuBackend||node.sourceImageStorage!=='rgba32f'||node.sourceImageUploadRounding!=='none'||node.interpolation!=='Closest'||!Array.isArray(pixels)||pixels.length<4||pixels.length%4||pixels.length>128*128*4)
        return fail('Magic Texture image inputs require qualified opaque embedded nearest float data')
      for(let i=0;i<pixels.length;i++)if(typeof pixels[i]!=='number'||!Number.isFinite(pixels[i])||Math.fround(pixels[i])!==pixels[i]||i%4===3&&pixels[i]!==1)return fail('Magic Texture image inputs require actual finite opaque Float32 pixels')
    }
    for(const[key,child]of Object.entries(node))if(!['pixels','values'].includes(key))checkImages(child,depth+1)
  }
  for(const key of ['vector','scale','distortion'])checkImages(expression[key])
  if(imageInputs&&(expression.sourceSamples!=='native-float-data-v1'||!Array.isArray(expression.sourceColorSpaces)||expression.sourceColorSpaces.length<1||!expression.sourceColorSpaces.every(value=>value==='Non-Color'||value==='Raw')))
    return fail('Magic Texture image inputs require their explicit native float-data source certificate')
  // Build IR children while the caller's texture/UV/object options are active;
  // TSL invokes Fn bodies later during shader generation.
  const vector = build(child('vector')), scale = build(child('scale')), distortion = build(child('distortion'))
  const result = Fn(() => {
    const scaled = vec3(rn(vector.x.mul(scale)),rn(vector.y.mul(scale)),rn(vector.z.mul(scale))).toVar()
    const modulo = (value: Node): Node => {
      const period = float(Math.fround(2*Math.PI)), quotient = floor(rn(value.div(period))).toVar()
      return nativeGpuBackend === 'METAL' ? buildNativeNoiseFma(quotient.negate(),period,value) : rn(value.sub(rn(quotient.mul(period))))
    }
    const p = evaluationModel === 'mf' ? scaled : vec3(modulo(scaled.x),modulo(scaled.y),modulo(scaled.z)).toVar()
    let x = sine(rn(rn(rn(p.x.add(p.y)).add(p.z)).mul(5)))
    let y = cosine(rn(rn(rn(p.x.negate().add(p.y)).sub(p.z)).mul(5)))
    let z = cosine(rn(rn(rn(p.x.negate().sub(p.y)).add(p.z)).mul(5))).negate()
    if (depth > 0) {
      x=rn(x.mul(distortion)); y=rn(y.mul(distortion)); z=rn(z.mul(distortion))
      y=rn(cosine(rn(rn(x.sub(y)).add(z))).negate().mul(distortion))
    }
    if (depth > 1) x=rn(cosine(rn(rn(x.sub(y)).sub(z))).mul(distortion))
    if (depth > 2) z=rn(sine(rn(rn(x.negate().sub(y)).sub(z))).mul(distortion))
    if (depth > 3) x=rn(cosine(rn(rn(x.negate().add(y)).sub(z))).negate().mul(distortion))
    if (depth > 4) y=rn(sine(rn(rn(x.negate().add(y)).add(z))).negate().mul(distortion))
    if (depth > 5) y=rn(cosine(rn(rn(x.negate().add(y)).add(z))).negate().mul(distortion))
    if (depth > 6) x=rn(cosine(rn(rn(x.add(y)).add(z))).mul(distortion))
    if (depth > 7) z=rn(sine(rn(rn(x.add(y)).sub(z))).mul(distortion))
    if (depth > 8) x=rn(cosine(rn(rn(x.negate().sub(y)).add(z))).negate().mul(distortion))
    if (depth > 9) y=rn(sine(rn(rn(x.sub(y)).add(z))).negate().mul(distortion))
    const divisor=rn(distortion.mul(2)), safe=select(distortion.equal(0),1,divisor)
    const shrink=(v:Node):Node=>select(distortion.equal(0),v,rn(v.div(safe)))
    const color=vec3(rn(float(.5).sub(shrink(x))),rn(float(.5).sub(shrink(y))),rn(float(.5).sub(shrink(z)))).toVar()
    return output==='fac' ? rn(rn(rn(color.x.add(color.y)).add(color.z)).mul(Math.fround(1/3))) : color
  })()
  return result as TslExpression
}
