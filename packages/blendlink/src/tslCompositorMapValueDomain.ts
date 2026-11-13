import type { CompositorValue, SourceCompositorOperation } from './sourceDisplay.js'

type Range = [number, number, boolean]
export interface MapValueDomain { kind: 'fixed' | 'bounded-field'; input: number[]; sum: number[]; product: number[]; output: number[] }
export const MAP_VALUE_DOMAIN_MODEL = 'finite-normal-or-zero-v1'

/** Closed executable grammar; annotation alone cannot certify a field. */
export function certifyMapValueDomain(incoming: CompositorValue, operations: readonly SourceCompositorOperation[],
  controls: unknown, useMin: unknown, useMax: unknown, device: unknown): MapValueDomain | null {
  const byId = new Map(operations.map(op => [op.id, op])), f = Math.fround
  let remaining = 256
  const normal = (n: number): boolean => Number.isFinite(n) && (n === 0 || Math.abs(n) >= 2 ** -126)
  const interval = (r: readonly (number | boolean)[]): boolean => Number.isFinite(r[0] as number) && Number.isFinite(r[1] as number)
    && (r[0] === 0 && r[1] === 0 || (r[0] as number) >= 2 ** -120 || (r[1] as number) <= -(2 ** -120))
  const point = (v: unknown): Range | null => typeof v === 'number' && Number.isFinite(v) ? [f(v), f(v), true] : null
  function scalar(v: CompositorValue | undefined): Range | null {
    if (--remaining < 0 || !v) return null
    if (v.kind === 'constant' && v.type === 'VALUE') return point(v.value)
    if (v.kind === 'convert' && v.type === 'VALUE') {
      if (v.fromType === 'VALUE') return scalar(v.input)
      if (v.fromType !== 'RGBA' && v.fromType !== 'VECTOR') return null
      const channels = components(v.input)
      if (!channels) return null
      const [a, b, c] = channels as [Range, Range, Range]
      const first = [f(a[0] + b[0]), f(a[1] + b[1])], second = [f(first[0]! + c[0]), f(first[1]! + c[1])]
      const fixed = channels.every(r => r[2])
      if (fixed ? !channels.every(r => normal(r[0])) || !normal(first[0]!) || !normal(second[0]!)
        : !channels.every(interval) || !interval(first) || !interval(second)) return null
      const bounds = second.map(n => device === 'CPU' ? f(n / 3) : f(n * f(1 / 3)))
      if (fixed ? !normal(bounds[0]!) : !interval(bounds)) return null
      return [bounds[0]!, bounds[1]!, fixed]
    }
    if (v.kind !== 'ref' || v.type !== 'VALUE') return null
    const op = byId.get(v.node ?? '')
    if (!op || op.type !== 'VALUE') return null
    if (op.kind === 'value' && op.type === 'VALUE') return point(op.value)
    if (op.kind === 'map-value') {
      if (op.properties.evaluation_device !== device) return null
      const proof = mapping(op.inputs.Value?.value, op.properties.map_value_controls,
        op.properties.map_value_use_min, op.properties.map_value_use_max)
      return proof ? [proof.output[0]!, proof.output[1]!, proof.kind === 'fixed'] : null
    }
    if (op.kind !== 'math' || !['MINIMUM', 'MAXIMUM'].includes(String(op.properties.operation))) return null
    const left = scalar(op.inputs.Value?.value), right = scalar(op.inputs.Value_001?.value)
    if (!left && !right) return null
    const a = left ?? [-Infinity, Infinity, false], b = right ?? [-Infinity, Infinity, false]
    const select = op.properties.operation === 'MINIMUM' ? Math.min : Math.max
    let low = select(a[0] as number, b[0] as number), high = select(a[1] as number, b[1] as number)
    if (op.properties.use_clamp === true) { low = Math.min(Math.max(low, 0), 1); high = Math.min(Math.max(high, 0), 1) }
    return [low, high, !!a[2] && !!b[2]]
  }
  function components(v: CompositorValue | undefined): Range[] | null {
    if (--remaining < 0 || !v) return null
    if (v.kind === 'constant' && (v.type === 'RGBA' || v.type === 'VECTOR')) {
      if (!Array.isArray(v.value) || v.value.length !== (v.type === 'RGBA' ? 4 : 3)) return null
      const parts = v.value.slice(0, 3).map(point)
      return parts.every(Boolean) ? parts as Range[] : null
    }
    if (v.kind === 'convert') {
      if (v.fromType === 'VALUE') { const part = scalar(v.input); return part ? [part, part, part] : null }
      if (v.fromType === 'RGBA' || v.fromType === 'VECTOR') return components(v.input)
    }
    if (v.kind !== 'ref') return null
    const op = byId.get(v.node ?? '')
    if (op?.kind === 'rgb') return components({ kind: 'constant', type: 'RGBA', value: op.value })
    if (op?.kind === 'combine-color' && op.properties.mode === 'RGB') {
      const parts = ['Red', 'Green', 'Blue'].map(name => scalar(op.inputs[name]?.value))
      return parts.every(Boolean) ? parts as Range[] : null
    }
    return null
  }
  function mapping(v: CompositorValue | undefined, settings: unknown, minimum: unknown, maximum: unknown): MapValueDomain | null {
    if (!Array.isArray(settings) || settings.length !== 4 || typeof minimum !== 'boolean' || typeof maximum !== 'boolean') return null
    const [offset, size, low, high] = settings
    if (![offset, size].every(n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 1000)) return null
    const input = scalar(v)
    if (!input || !Number.isFinite(input[0]) || !Number.isFinite(input[1])) return null
    const added = [f(input[0] + offset), f(input[1] + offset)]
    const product = [f(added[0]! * size), f(added[1]! * size)].sort((a, b) => a - b)
    if (input[2]) {
      if (![input[0], added[0]!, product[0]!].every(normal)) return null
    } else {
      if (!interval(input) || ![...added, ...product].every(Number.isFinite)) return null
      // Cancellation near normal operands >=2^-50 leaves zero or a quantum
      // >=2^-77; |Size|>=2^-40 keeps a nonzero product above2^-117.
      const cancellation = Math.min(Math.abs(input[0]), Math.abs(input[1])) >= 2 ** -50 || Math.abs(offset) >= 2 ** -50
      if (!interval(added) && !cancellation) return null
      if (!interval(product) && !(cancellation && (size === 0 || Math.abs(size) >= 2 ** -40))) return null
    }
    let output = product
    for (const [active, limit, select] of [[minimum, low, Math.max], [maximum, high, Math.min]] as const) {
      if (active) { if (typeof limit !== 'number' || !normal(limit)) return null; output = output.map(n => select(n, limit)) }
    }
    return { kind: input[2] ? 'fixed' : 'bounded-field', input: input.slice(0, 2) as number[], sum: added, product, output }
  }
  const proof = mapping(incoming, controls, useMin, useMax)
  return remaining >= 0 ? proof : null
}
