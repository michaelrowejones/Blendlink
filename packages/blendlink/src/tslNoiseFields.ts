/* SPDX-License-Identifier: Apache-2.0 */
import { evaluateStaticNoiseInput, foldStaticNoise4dColor } from './staticNoise4d.js'
import type { TslIrExpression } from './tslNodeRecipe.js'

export const NOISE_FIELD_PROFILE = 'finite-nearest-f32-v1'
export const NOISE_FIELD_PREPARATION_MESSAGE = 'Native nearest Noise field requires asynchronous prepareTslNoiseFields before building; installTslMaterials prepares it automatically'
const F = Math.fround
const expr = (value: unknown): TslIrExpression => value as TslIrExpression
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const ordinary = (value: number): boolean => finite(value) && (value === 0 || Math.abs(value) >= 2 ** -126)
const scalar = (value: unknown): value is TslIrExpression => !!value && typeof value === 'object'
  && expr(value).op === 'const_float' && Object.keys(value).every(key => key === 'op' || key === 'value') && finite(expr(value).value)
const keys = (value: object, allowed: readonly string[]): boolean => Object.keys(value).every(key => allowed.includes(key))
function fail(): never { throw new Error('Native nearest Noise field exceeds its verified source sampling, kernel or resource profile; use source baking') }
const abort = (signal?: AbortSignal): void => {
  if (!signal?.aborted) return
  const error = new Error('SceneToWeb Noise preparation aborted')
  error.name = 'AbortError'
  throw error
}

export interface NoiseFieldPreparationStatistics {
  fields: number
  tables: number
  texels: number
  bytes: number
  uniquePoints: number
  yields: number
  maximumSliceMilliseconds: number
  tableStatistics: ReadonlyArray<{pixels:number;uniquePoints:number;inputBytes:number;outputBytes:number}>
}
/** An attempt-owned CPU preparation. Dispose after synchronous graph building;
 * built DataTextures own their separate arrays. No process-global work cache. */
export interface PreparedTslNoiseFields {
  readonly statistics: Readonly<NoiseFieldPreparationStatistics>
  dispose(): void
}
export interface PrepareTslNoiseFieldsOptions {
  signal?: AbortSignal
  /** Default 4ms CPU slices. Smaller values trade throughput for responsiveness. */
  sliceMilliseconds?: number
  /** Application scheduler; must yield to another task, not only a microtask. */
  yieldControl?: () => Promise<void>
}
type PreparedField = {image:TslIrExpression;snapshot:TslIrExpression}
const prepared = new WeakMap<PreparedTslNoiseFields, Map<object, PreparedField>>()
function sourceChanged(): never { throw new Error('Native Noise field source changed during asynchronous preparation; retry with an immutable source document') }
function sameSource(value: unknown, snapshot: unknown): boolean {
  if (Object.is(value,snapshot)) return true
  if (!value || !snapshot || typeof value !== 'object' || typeof snapshot !== 'object'
    || Array.isArray(value) !== Array.isArray(snapshot)) return false
  if (Array.isArray(value) && Array.isArray(snapshot)) {
    if (value.length!==snapshot.length) return false
    for(let index=0;index<value.length;index++)if(!sameSource(value[index],snapshot[index]))return false
    return true
  }
  const source=value as Record<string,unknown>,expected=snapshot as Record<string,unknown>,names=Object.keys(expected)
  return Object.keys(source).length===names.length && names.every(name=>Object.hasOwn(source,name)&&sameSource(source[name],expected[name]))
}
/** Only handles issued by the asynchronous preparer can resolve a fresh op. */
export function preparedNoiseField(handle: PreparedTslNoiseFields | undefined, expression: TslIrExpression): TslIrExpression | undefined {
  const entry=handle && prepared.get(handle)?.get(expression)
  if (!entry) return undefined
  if (!sameSource(expression,entry.snapshot)) sourceChanged()
  return entry.image
}

type FieldIdentity = { pixels: Float32Array; signature: string; snapshot:TslIrExpression }
type FieldResult = FieldIdentity & { image: TslIrExpression; points: number }
/** Every costly phase yields, including coordinate certification, hashing and
 * interval proof. Kernel arithmetic is unchanged from the proven CPU folder. */
function* fieldWork(wrapper: TslIrExpression): Generator<void | FieldIdentity, FieldResult> {
  if (wrapper.profile !== NOISE_FIELD_PROFILE || wrapper.sourceSamples !== 'native-float-data-v1' || !['Non-Color','Raw'].includes(String(wrapper.sourceColorSpace))
    || !keys(wrapper, ['op', 'profile', 'sourceSamples', 'sourceColorSpace', 'kernel'])) fail()
  const ir = expr(wrapper.kernel)
  if (!ir || !['noise_fractal', 'noise_normalized'].includes(ir.op) || ir.dimensions !== 4 || ir.output !== 'color'
    || (ir.noiseType ?? 'FBM') !== 'FBM' || ir.evaluationModel !== 'shader'
    || !finite(ir.detail) || ir.detail < 4 || ir.detail > 6 || !finite(ir.roughness) || ir.roughness < 0 || ir.roughness > 1
    || !finite(ir.lacunarity ?? 2) || Math.abs((ir.lacunarity ?? 2) as number) > 2
    || !keys(ir, ['op','normalize','output','dimensions','detail','roughness','lacunarity','scale','noiseType',
      'evaluationModel','offsetModel','perlinModel','input','w','colorOffsets'])) fail()
  const image = expr(ir.input), w = expr(ir.w)
  const allowedImage = ['op','sourceEngine','sourceImageStorage','sourceImageUploadRounding','nativeGpuBackend',
    'width','height','pixels','interpolation','extension','output','projection','vector']
  if (!image || image.op !== 'tex_image' || image.sourceImageStorage !== 'rgba32f' || image.sourceImageUploadRounding !== 'none'
    || image.output !== 'color' || image.interpolation !== 'Closest' || image.extension !== 'REPEAT'
    || (image.projection ?? 'flat') !== 'flat' || !['CYCLES','EEVEE'].includes(String(image.sourceEngine))
    || image.sourceEngine === 'EEVEE' && !['METAL','OPENGL'].includes(String(image.nativeGpuBackend))
    || !keys(image, allowedImage)) fail()
  const uv = expr(image.vector)
  if (!uv || !['uv','uv_active'].includes(uv.op) || !keys(uv, ['op','channel']) || uv.channel !== undefined && uv.channel !== 0) fail()
  const { width, height } = image
  if (!finite(width) || !finite(height) || !Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1
    || width * height > 16384 || !Array.isArray(image.pixels) || image.pixels.length !== width * height * 4
    || !scalar(ir.scale) || ![40,80].includes(expr(ir.scale).value as number)) fail()
  const scale = expr(ir.scale).value as number
  const constantW = scalar(w) && Math.abs(w.value as number) <= 2 && F(w.value as number) === w.value
    && F((w.value as number) * scale) === (w.value as number) * scale
  const channel = expr(w?.a), other = expr(channel?.input)
  if (!constantW && !(w && w.op === 'math' && w.operation === 'MULTIPLY_ADD' && keys(w, ['op','operation','a','b','c'])
    && scalar(w.b) && expr(w.b).value === .5 && scalar(w.c) && expr(w.c).value === .125
    && channel?.op === 'separate' && channel.channel === 'y' && keys(channel, ['op','channel','input'])
    && other?.op === 'tex_image' && keys(other, allowedImage) && Array.isArray(other.pixels))) fail()
  const header = (value: TslIrExpression): string => JSON.stringify(Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'pixels')))
  if (!constantW && (header(other) !== header(image) || (other.pixels as unknown[]).length !== image.pixels.length)) fail()
  // Snapshot this immutable field's source before the first cooperative yield.
  const sourcePixels = image.pixels.slice() as number[]
  const otherPixels = constantW ? null : (other.pixels as number[]).slice()
  const kernel: TslIrExpression = { ...ir, scale:{...expr(ir.scale)} }, vector = { ...uv }
  const imageSnapshot = {...image,vector}, literalW = constantW ? w.value as number : null
  const offsets = ir.colorOffsets
  if (!Array.isArray(offsets) || offsets.length !== 2 || !offsets.every(offset => Array.isArray(offset) && offset.length === 4
    && offset.every(value => finite(value) && ordinary(value) && F(value) === value))) fail()
  const shifts = offsets.map(offset => [...offset]) as number[][]
  kernel.colorOffsets = shifts
  const snapshot: TslIrExpression = {...wrapper,kernel:{...kernel,input:{...imageSnapshot,pixels:sourcePixels},
    w:constantW ? {...w} : {...w,a:{...channel,input:{...other,vector:{...expr(other.vector)},pixels:sourcePixels}},
      b:{...expr(w.b)},c:{...expr(w.c)}}}}
  const points = new Float32Array(sourcePixels.length), bits = new Uint32Array(points.buffer)
  const low = [Infinity,Infinity,Infinity,Infinity], high = [-Infinity,-Infinity,-Infinity,-Infinity]
  for (let index = 0; index < sourcePixels.length; index += 4) {
    for (let axis = 0; axis < 4; axis++) {
      const value = sourcePixels[index + axis]!
      if (!finite(value) || F(value) !== value || Math.abs(value) > 2 || value !== 0 && Math.abs(value) < 2 ** -14
        || F(value * scale) !== value * scale || axis === 3 && value !== 1) fail()
      const spacing = value === 0 ? 1 : 2 ** (Math.floor(Math.log2(Math.abs(value))) - 10)
      if (value % spacing !== 0 || otherPixels && !Object.is(value, otherPixels[index + axis])) fail()
    }
    const value = constantW ? literalW! : evaluateStaticNoiseInput({ op:'math', operation:'MULTIPLY_ADD',
      a:{op:'const_float',value:sourcePixels[index + 1]},b:{op:'const_float',value:.5},c:{op:'const_float',value:.125} }, {exactArithmetic:true})
    if (typeof value !== 'number' || F(value * scale) !== value * scale) fail()
    points.set([sourcePixels[index]!,sourcePixels[index+1]!,sourcePixels[index+2]!,value],index)
    for (let axis = 0; axis < 4; axis++) {
      const scaled = F(points[index+axis]! * scale)
      low[axis] = Math.min(low[axis]!,scaled); high[axis] = Math.max(high[axis]!,scaled)
    }
    if ((index & 255) === 0) yield
  }
  const count = Math.floor(F(kernel.detail as number)), fraction = F(F(kernel.detail as number) - count), lacunarity = F((kernel.lacunarity ?? 2) as number)
  for (const offset of [[0,0,0,0],...shifts]) {
    const start = low.map((value,axis) => F(value + offset[axis]!)), end = high.map((value,axis) => F(value + offset[axis]!))
    let frequency = 1
    for (let index = 0; index <= count + (fraction !== 0 ? 1 : 0); index++) {
      for (let axis = 0; axis < 4; axis++) {
        const a = F(start[axis]! * frequency), b = F(end[axis]! * frequency)
        if (!ordinary(a) || !ordinary(b) || Math.max(Math.abs(a),Math.abs(b)) >= 90000) fail()
      }
      frequency = F(frequency * lacunarity)
    }
  }
  // Dedup requires exact source words plus all kernel/sampler parameters. The
  // hash is merely a bucket selector; word equality resolves any collision.
  const metadata = JSON.stringify({ ...kernel, input:header(imageSnapshot),w:constantW ? {op:'const_float',value:literalW} : 'same-image-y-half-plus-eighth',colorOffsets:shifts },
    (_key,value: unknown) => Object.is(value,-0) ? '__negative_zero__' : value)
  let hash = 2166136261
  for (let index=0;index<bits.length;index++) {
    hash = Math.imul(hash ^ bits[index]!,16777619)
    if ((index & 1023) === 0) yield
  }
  const signature = metadata + ':' + (hash >>> 0)
  yield {pixels:points,signature,snapshot}
  const output = new Array<number>(points.length), memo = new Map<string, readonly number[]>()
  for (let index = 0; index < points.length; index += 4) {
    const key = Array.from(bits.subarray(index,index+4)).join(',')
    let color = memo.get(key)
    if (!color) {
      color = foldStaticNoise4dColor({ ...kernel, input:{op:'const_vec3',value:Array.from(points.subarray(index,index+3))},
        w:{op:'const_float',value:points[index+3]} })
      if (!color) fail()
      memo.set(key,color)
    }
    output[index]=color[0]!;output[index+1]=color[1]!;output[index+2]=color[2]!;output[index+3]=1
    if ((index & 63) === 0) yield
  }
  return {image:{...imageSnapshot,pixels:output},points:memo.size,pixels:points,signature,snapshot}
}

/** Prepare fresh finite-nearest fields without altering their original IR.
 * Range/shape/binding validators still inspect the original kernel. Inputs
 * must remain immutable until graph construction; preparation owns snapshots.
 * Old opcodes are never specialized. A transaction owns at most 262144 texels
 * (4MiB table payload); duplicate programs share work within this call only. */
export async function prepareTslNoiseFields(source: unknown, options: PrepareTslNoiseFieldsOptions = {}): Promise<PreparedTslNoiseFields> {
  const slice = options.sliceMilliseconds ?? 4
  if (!finite(slice) || slice < .25 || slice > 8) throw new RangeError('Noise preparation slice must be .25..8 milliseconds')
  const yieldControl = options.yieldControl ?? (() => new Promise<void>(resolve => setTimeout(resolve,0)))
  const entries = new Map<object,PreparedField>()
  const tableStatistics: Array<{pixels:number;uniquePoints:number;inputBytes:number;outputBytes:number}> = []
  const statistics: NoiseFieldPreparationStatistics = {fields:0,tables:0,texels:0,bytes:0,uniquePoints:0,yields:0,maximumSliceMilliseconds:0,tableStatistics}
  const handle: PreparedTslNoiseFields = {statistics,dispose(){entries.clear()}}
  const seen = new Set<object>(), fields: TslIrExpression[] = []
  const visit = (value: unknown, depth = 0): void => {
    if (!value || typeof value !== 'object' || seen.has(value)) return
    if (depth > 64 || seen.size > 65536) throw new Error('Noise preparation document exceeds its traversal budget')
    seen.add(value)
    if (expr(value).op === 'noise_field_nearest') { fields.push(expr(value)); return }
    // Image arrays are data, not executable children. Never scan them as IR.
    if (expr(value).op === 'tex_image') { visit(expr(value).vector,depth+1);return }
    for (const child of Object.values(value)) visit(child,depth+1)
  }
  abort(options.signal);visit(source)
  let started = performance.now()
  const checkpoint = async (force = false): Promise<void> => {
    abort(options.signal)
    const elapsed = performance.now() - started
    if (!force && elapsed < slice) return
    statistics.maximumSliceMilliseconds = Math.max(statistics.maximumSliceMilliseconds,elapsed)
    statistics.yields++
    await new Promise<void>((resolve,reject) => {
      const signal = options.signal
      let settled = false
      const finish = (error?: unknown, failed = false): void => {
        if (settled) return
        settled=true;signal?.removeEventListener('abort',onAbort)
        if (failed) reject(error);else resolve()
      }
      const onAbort = (): void => { try { abort(signal) } catch (error) { finish(error,true) } }
      signal?.addEventListener('abort',onAbort,{once:true})
      if (signal?.aborted) { onAbort();return }
      try { Promise.resolve(yieldControl()).then(()=>finish(),error=>finish(error,true)) } catch (error) { finish(error,true) }
    })
    abort(options.signal);started=performance.now()
  }
  const cache: Array<{signature:string;points:Float32Array;image:TslIrExpression;snapshot:TslIrExpression}> = []
  try {
    for (const field of fields) {
      const work = fieldWork(field)
      let item = work.next(), reused = false
      await checkpoint(true)
      statistics.fields++
      while (!item.done) {
        const identity = item.value
        if (identity) {
          const words = new Uint32Array(identity.pixels.buffer)
          let old: typeof cache[number] | undefined
          for (const candidate of cache) {
            if (candidate.signature !== identity.signature || candidate.points.length !== identity.pixels.length) continue
            const previous = new Uint32Array(candidate.points.buffer)
            let equal = true
            for (let index=0;index<words.length;index++) {
              if (words[index] !== previous[index]) { equal=false;break }
              if ((index & 1023) === 0) await checkpoint()
            }
            if (equal) { old=candidate;break }
          }
          if (old) {
            if (!sameSource(field,identity.snapshot)) sourceChanged()
            // Equal immutable payloads share their witness array as well as
            // kernel work; per-wrapper metadata remains independently owned.
            const canonical=expr(expr(old.snapshot.kernel).input).pixels
            expr(expr(identity.snapshot.kernel).input).pixels=canonical
            const witnessW=expr(expr(identity.snapshot.kernel).w)
            if(witnessW.op==='math')expr(expr(witnessW.a).input).pixels=canonical
            entries.set(field,{image:old.image,snapshot:identity.snapshot})
            reused=true;work.return(undefined as never);break
          }
          if (statistics.texels + identity.pixels.length / 4 > 262144) fail()
        }
        await checkpoint();item=work.next()
      }
      if (!reused && item.done) {
        const result = item.value, texels = result.pixels.length / 4
        statistics.tables++;statistics.texels+=texels;statistics.bytes+=texels*16;statistics.uniquePoints+=result.points
        tableStatistics.push({pixels:texels,uniquePoints:result.points,inputBytes:texels*16,outputBytes:texels*16})
        if (!sameSource(field,result.snapshot)) sourceChanged()
        cache.push({signature:result.signature,points:result.pixels,image:result.image,snapshot:result.snapshot})
        entries.set(field,{image:result.image,snapshot:result.snapshot})
      }
      await checkpoint()
    }
    statistics.maximumSliceMilliseconds = Math.max(statistics.maximumSliceMilliseconds,performance.now()-started)
    // Last scheduler callbacks may have changed a previously completed field.
    // Lookup also validates the complete bounded snapshot, including pixels.
    for(const [field,entry]of entries) {
      const original=expr(field),snapshot=entry.snapshot
      if(original.op!==snapshot.op||original.profile!==snapshot.profile||original.sourceSamples!==snapshot.sourceSamples
        || original.sourceColorSpace!==snapshot.sourceColorSpace)sourceChanged()
    }
    abort(options.signal);seen.clear();fields.length=0;prepared.set(handle,entries)
    return handle
  } catch (error) { entries.clear();seen.clear();fields.length=0;cache.length=0;throw error }
}
