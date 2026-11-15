/** Compositor DAG and declared payload facts, without compiling or decoding images. */
import assert from 'node:assert/strict'

export const COMPOSITOR_COST_MODEL = 'compositor-dag-structure-v1'
export const COMPOSITOR_COST_METRICS = Object.freeze([
  'operations', 'references', 'conversions', 'maximumDependencyDepth', 'maximumFanout',
  'reachableOperations', 'unusedOperations', 'imageDeclarations', 'declaredImageDecodedBytes',
  'imagePayloadCharacters', 'passDeclarations',
])
const bounds = Object.freeze({ operations: 2048, values: 65536, conversionDepth: 64, images: 2048, text: 64 * 1024 * 1024 })
const record = (value, label) => {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value)), label + ' must be a JSON record')
  assert.ok(Object.values(Object.getOwnPropertyDescriptors(value)).every(item => Object.hasOwn(item, 'value')), label + ' cannot contain accessors')
  return value
}
const count = (value, label) => { assert.ok(Number.isSafeInteger(value) && value >= 0, label + ' must be a nonnegative safe integer'); return value }
const text = (value, label) => { assert.ok(typeof value === 'string' && value.length > 0 && value.length <= 512, label + ' must be a bounded nonempty string'); return value }
const sum = (a, b) => count(a + b, 'Accumulated metric')
const denseArray = (value, maximum, label) => {
  assert.ok(Array.isArray(value) && value.length <= maximum, label + ' must be a bounded array')
  const result = []
  // Read declared JSON indices, never a caller-controlled Symbol.iterator.
  for (let index = 0; index < value.length; index++) {
    const item = Object.getOwnPropertyDescriptor(value, String(index))
    assert.ok(item && Object.hasOwn(item, 'value'), label + ' cannot contain holes or accessors')
    result.push(item.value)
  }
  return result
}

export function inspectCompositorCost(input, { limits = null, profile = null, pixelDigestElements = 0 } = {}) {
  record(input, 'Input')
  assert.ok(profile === null || typeof profile === 'string', 'Profile is only a declared label')
  assert.equal(pixelDigestElements, 0, 'Compositor image payloads are not decoded; pixel digests are material-only')
  const wrapper = input.model === 'blendlink-source-presentation-v1'
  if (wrapper) assert.equal(input.schemaVersion, 1, 'Unknown source presentation version')
  const program = record(wrapper ? input.compositor : input, 'Compositor program')
  assert.equal(program.version, 1, 'Unknown compositor version')
  assert.equal(program.status, 'extracted', 'Only an extracted compositor graph can be analyzed')
  const ops = denseArray(program.ops, bounds.operations, 'Operations'), passes = denseArray(program.passes, bounds.operations, 'Pass declarations')
  const metrics = Object.fromEntries(COMPOSITOR_COST_METRICS.map(name => [name, 0]))
  metrics.operations = ops.length; metrics.passDeclarations = passes.length
  const byId = new Map(), dependency = new Map(), depths = new Map(), fanout = new Map(), kinds = new Map(), classes = new Map()
  let visitedValues = 0
  const value = (item, preceding, references, depth = 0, ancestors = new Set()) => {
    assert.ok(++visitedValues <= bounds.values && depth <= bounds.conversionDepth, 'Typed value traversal exceeds bounded work')
    record(item, 'Typed value'); assert.ok(!ancestors.has(item), 'Typed value contains a cycle')
    text(item.type, 'Value type'); ancestors.add(item)
    try {
      if (item.kind === 'ref') {
        const id = text(item.node, 'Referenced operation')
        assert.ok(preceding.has(id), 'Reference must name a preceding operation: ' + id)
        metrics.references++; references.add(id); fanout.set(id, (fanout.get(id) ?? 0) + 1)
      } else if (item.kind === 'convert') {
        metrics.conversions++; text(item.fromType, 'Conversion source type')
        value(item.input, preceding, references, depth + 1, ancestors)
      } else assert.equal(item.kind, 'constant', 'Unknown typed value kind')
    } finally { ancestors.delete(item) }
  }
  for (const op of ops) {
    record(op, 'Operation'); const id = text(op.id, 'Operation ID'), kind = text(op.kind, 'Operation kind')
    assert.ok(!byId.has(id), 'Duplicate operation ID: ' + id); text(op.type, 'Operation type')
    record(op.source, 'Source'); const nodeType = text(op.source.nodeType, 'Native class')
    const inputs = record(op.inputs, 'Operation inputs'), references = new Set()
    assert.ok(Object.keys(inputs).length <= 256, 'Operation input count exceeds structural bound')
    for (const incoming of Object.values(inputs)) { record(incoming, 'Input binding'); value(incoming.value, byId, references) }
    dependency.set(id, references)
    depths.set(id, 1 + Math.max(0, ...[...references].map(ref => depths.get(ref))))
    metrics.maximumDependencyDepth = Math.max(metrics.maximumDependencyDepth, depths.get(id))
    kinds.set(kind, (kinds.get(kind) ?? 0) + 1); classes.set(nodeType, (classes.get(nodeType) ?? 0) + 1)
    byId.set(id, op)
  }
  const roots = new Set(); value(program.output, byId, roots)
  const reachable = new Set(), pending = [...roots]
  while (pending.length) { const id = pending.pop(); if (reachable.has(id)) continue; reachable.add(id); pending.push(...dependency.get(id)) }
  metrics.reachableOperations = reachable.size; metrics.unusedOperations = metrics.operations - reachable.size
  metrics.maximumFanout = Math.max(0, ...fanout.values())
  const images = record(program.images ?? {}, 'Image declarations'), imageRows = []
  assert.ok(Object.keys(images).length <= bounds.images, 'Image declaration count exceeds analysis bound')
  for (const [id, image] of Object.entries(images)) {
    record(image, 'Image'); text(id, 'Image ID')
    const width = count(image.width, 'Image width'), height = count(image.height, 'Image height')
    assert.ok(width > 0 && height > 0 && Number.isSafeInteger(width * height * 16), 'Image extent product is invalid')
    assert.equal(image.model, 'native-cpu-static-image-v1', 'Unknown image declaration model')
    assert.equal(image.encoding, 'zlib-le-rgba32f', 'Unknown image encoding declaration')
    assert.equal(image.decodedBytes, width * height * 16, 'Declared Float32 RGBA bytes do not match dimensions')
    assert.ok(typeof image.data === 'string' && image.data.length <= bounds.text, 'Encoded image text exceeds analysis bound')
    metrics.imageDeclarations++; metrics.declaredImageDecodedBytes = sum(metrics.declaredImageDecodedBytes, image.decodedBytes)
    metrics.imagePayloadCharacters = sum(metrics.imagePayloadCharacters, image.data.length)
    imageRows.push({ id, width, height, declaredDecodedBytes: image.decodedBytes, payloadCharacters: image.data.length })
  }
  if (limits) {
    record(limits, 'Limits'); assert.equal(limits.schemaVersion, 1); assert.equal(limits.model, 'compositor-structural-limits-v1')
    assert.deepEqual(Object.keys(limits).sort(), ['maximum', 'model', 'schemaVersion'])
    record(limits.maximum, 'Maximum limits'); assert.ok(Object.keys(limits.maximum).length > 0)
    for (const [key, maximum] of Object.entries(limits.maximum)) { assert.ok(COMPOSITOR_COST_METRICS.includes(key), 'Unknown compositor structural metric: ' + key); count(maximum, key) }
  }
  const violations = limits ? Object.entries(limits.maximum).filter(([key, maximum]) => metrics[key] > maximum)
    .map(([metric, maximum]) => ({ metric, maximum, actual: metrics[metric] })) : []
  const sorted = rows => Object.fromEntries([...rows].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))
  return { schemaVersion: 1, kind: 'blendlink-compositor-static-cost-v1', model: COMPOSITOR_COST_MODEL,
    status: violations.length ? 'structural-budget-exceeded' : 'analyzed', productionCases: 0, performanceQualified: false,
    scope: { input: wrapper ? 'source-presentation' : 'compositor-program', analyzed: 'compositor-only', displayAnalyzed: false },
    input: { source: 'object-only', bytes: null, sha256: null }, profile: { label: profile, observed: false }, metrics,
    operations: sorted(kinds), nativeClasses: sorted(classes), images: imageRows.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    sharedReferences: [...fanout].filter(([, uses]) => uses > 1).map(([id, uses]) => ({ id, uses })).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    unusedOperationIds: [...byId.keys()].filter(id => !reachable.has(id)).sort(),
    structuralGate: { status: limits ? violations.length ? 'exceeded' : 'within-structural-limits' : 'not-configured', limits: limits ? structuredClone(limits) : null, violations },
    work: { typedValues: visitedValues, bounds },
    runtimeCost: { instructions: null, physicalTextureSamples: null, renderPasses: null, gpuMemoryBytes: null, timings: null,
      semanticValidation: false, note: 'Graph references do not prove runtime sharing. Images are declared storage, not decoded, hash-validated, deduplicated or measured GPU residency. Pass declarations are not draw counts. Node/profile support and shader lowering are not validated.' } }
}
