import type { CompositorValue, SourceCompositorOperation } from './sourceDisplay.js'

/** Certify the executable RGB shape. Declared ref.type or a 'gray' annotation
 * cannot turn an arbitrary colored expression into a replicated scalar. */
export function compositorGrayscale(value: CompositorValue, operations: readonly SourceCompositorOperation[]): boolean {
  const byId = new Map(operations.map(op => [op.id, op]))
  let remaining = 256
  const literal = (v: CompositorValue | undefined): number | null => {
    if (v?.kind === 'ref') {
      const op = byId.get(v.node ?? '')
      if (op?.kind !== 'value') return null
      v = { kind: 'constant', type: op.type, value: op.value }
    }
    if (v?.kind !== 'constant' || v.type !== 'VALUE' || typeof v.value !== 'number' || !Number.isFinite(Math.fround(v.value))) return null
    return Math.fround(v.value)
  }
  const same = (a: CompositorValue | undefined, b: CompositorValue | undefined, depth = 0): boolean => {
    const left = literal(a), right = literal(b)
    if (left !== null && right !== null) return left === right
    if (!a || !b || depth > 32 || a.kind !== b.kind) return false
    if (a.kind === 'ref') return a.node === b.node
    if (a.type !== b.type) return false
    if (a.kind === 'constant') return Array.isArray(a.value) && Array.isArray(b.value)
      ? a.value.length === b.value.length && a.value.every((n, i) => n === (b.value as unknown[])[i]) : a.value === b.value
    return a.kind === 'convert' && a.fromType === b.fromType && same(a.input, b.input, depth + 1)
  }
  const walk = (v: CompositorValue | undefined, scalar = false, depth = 0): boolean => {
    if (--remaining < 0 || depth > 32 || !v || typeof v !== 'object') return false
    if (v.kind === 'constant') {
      if (scalar) return v.type === 'VALUE' && typeof v.value === 'number' && Number.isFinite(v.value)
      return v.type === 'RGBA' && Array.isArray(v.value) && v.value.length === 4 &&
        [0, 1, 2, 3].every(i => typeof (v.value as number[])[i] === 'number' && Number.isFinite((v.value as number[])[i])) &&
        v.value[0] === v.value[1] && v.value[0] === v.value[2]
    }
    if (v.kind === 'convert') {
      if (scalar && v.type === 'VALUE') {
        if (v.fromType === 'RGBA' || v.fromType === 'VECTOR') return !!v.input // Runtime scalar dot product.
        return v.fromType === 'VALUE' && walk(v.input, true, depth + 1)
      }
      if (!scalar && v.type === 'RGBA') {
        if (v.fromType === 'VALUE') return walk(v.input, true, depth + 1)
        return v.fromType === 'RGBA' && walk(v.input, false, depth + 1)
      }
      return false
    }
    if (v.kind !== 'ref' || !v.node) return false
    const op = byId.get(v.node)
    if (!op) return false
    if (scalar) {
      if (op.kind === 'value') return walk({ kind: 'constant', type: op.type, value: op.value }, true, depth + 1)
      if (op.kind === 'rgb-to-bw' || op.kind === 'separate-color') return true
      if (op.kind === 'math') return Object.keys(op.inputs).length > 0 && Object.values(op.inputs).every(input => walk(input.value, true, depth + 1))
      return false
    }
    if (op.kind === 'value' || op.kind === 'rgb') return walk({ kind: 'constant', type: op.type, value: op.value }, false, depth + 1)
    if (op.kind === 'combine-color' && op.properties.mode === 'RGB') {
      const channels = ['Red', 'Green', 'Blue'].map(name => op.inputs[name]?.value)
      return channels.every(channel => walk(channel, true, depth + 1)) && same(channels[0], channels[1]) && same(channels[0], channels[2])
    }
    return false
  }
  return walk(value)
}
