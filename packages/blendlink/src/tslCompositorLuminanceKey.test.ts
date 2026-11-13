import { describe, expect, it } from 'vitest'
import { float } from 'three/tsl'
import { buildSourceCompositor } from './tslSourceCompositor.js'
import type { SourceCompositorProgram } from './sourceDisplay.js'

function program(): SourceCompositorProgram {
  return { version: 1, status: 'extracted', passes: [], diagnostics: [], ops: [{
    id: 'key', kind: 'luminance-key', type: 'RGBA', source: { path: ['Compositor'],
      node: 'Artist Luminance Key', nodeType: 'CompositorNodeLumaMatte', output: 'Image' },
    properties: { luminance_key_model: 'native-luminance-key-v1', luminance_key_schema: 'linear-ramp',
      luminance_key_limits: [.25, .75] },
    inputs: { Image: { name: 'Image', socketType: 'RGBA', value: { kind: 'constant', type: 'RGBA', value: [2, -.5, .25, -.5] } } },
  }], output: { kind: 'ref', type: 'RGBA', node: 'key' } }
}

describe('luminance-key document admission', () => {
  it('accepts the two source schemas and both outputs without resource ownership', () => {
    for (const schema of ['linear-ramp', 'legacy-branch']) for (const output of ['Image', 'Matte']) {
      const document = program(), operation = document.ops[0]!
      operation.properties.luminance_key_schema = schema; operation.source.output = output
      operation.type = output === 'Image' ? 'RGBA' : 'VALUE'
      document.output!.type = operation.type
      const built = buildSourceCompositor(document, () => null)
      expect(built.node.isNode).toBe(true)
      expect(() => { built.dispose(); built.dispose() }).not.toThrow()
    }
  })

  it('rejects unknown models, narrow/undefined ramps and forged nonfinite thresholds at the artist node', () => {
    for (const properties of [
      { luminance_key_model: undefined }, { luminance_key_schema: 'future' },
      { luminance_key_limits: [.5, .5] }, { luminance_key_limits: [.5, .5 + 1/128] },
      { luminance_key_limits: [0, Infinity] }, { luminance_key_limits: [-1, 1] },
    ]) {
      const document = program(); Object.assign(document.ops[0]!.properties, properties)
      expect(() => buildSourceCompositor(document, () => null)).toThrow(/Artist Luminance Key.*native model/)
    }
  })
})

function cpuProgram(): SourceCompositorProgram {
  const document = program(), op = document.ops[0]!
  Object.assign(op.properties, { luminance_key_model: 'native-luminance-key-cpu-rne-v1',
    luminance_key_source_version: [5, 2, 0], evaluation_device: 'CPU', single_value_device: 'CPU',
    luminance_key_coefficients: [.2126, .7152, .0722].map(Math.fround),
    luminance_key_cpu_profile: { schemaVersion: 1, mode: 'gradual-rne', underflowWord: 0x00400000,
      denormalInputWord: 0x00800000, tieWords: [0x3f800000, 0x3f800002], sourcePlatform: 'darwin', sourceArchitecture: 'arm64' } })
  return document
}

describe('fresh CPU luminance arithmetic admission', () => {
  it('accepts the default, nonbinary, reversed and tiny positive CPU ramps', () => {
    for (const limits of [[0, 1], [.1, .2], [.75, .25], [2 ** -100, .125]]) for (const output of ['Image', 'Matte']) {
      const document = cpuProgram(), op = document.ops[0]!
      op.properties.luminance_key_limits = limits; op.source.output = output
      op.type = output === 'Matte' ? 'VALUE' : 'RGBA'; document.output!.type = op.type
      const built = buildSourceCompositor(document, () => null)
      expect(built.node.isNode).toBe(true); built.dispose()
    }
  })

  it('rechecks source version, actual evaluator, coefficients and Color shapes', () => {
    for (const mutate of [
      (p: SourceCompositorProgram) => { p.ops[0]!.properties.luminance_key_source_version = [5, 2, 1] },
      (p: SourceCompositorProgram) => { p.ops[0]!.properties.luminance_key_source_version = [5, 3, 0] },
      (p: SourceCompositorProgram) => { p.ops[0]!.properties.luminance_key_coefficients = [.3, .6, .1] },
      (p: SourceCompositorProgram) => { p.ops[0]!.properties.luminance_key_coefficients = new Array(3) },
      (p: SourceCompositorProgram) => { p.luminance = [.3, .6, .1] },
      (p: SourceCompositorProgram) => { p.ops[0]!.properties.evaluation_device = 'future' },
      (p: SourceCompositorProgram) => { Object.assign(p.ops[0]!.properties, { evaluation_device: 'GPU', single_value_device: 'GPU' }) },
      (p: SourceCompositorProgram) => { Object.assign(p.ops[0]!.properties, { evaluation_device: 'GPU', luminance_key_source_version: [4, 2, 0] }) },
      (p: SourceCompositorProgram) => { p.ops[0]!.properties.luminance_key_source_version = [4, 2, 0] },
      (p: SourceCompositorProgram) => { p.ops[0]!.properties.luminance_key_cpu_profile = undefined },
      (p: SourceCompositorProgram) => { Object.assign(p.ops[0]!.properties.luminance_key_cpu_profile as object, { underflowWord: 0 }) },
      (p: SourceCompositorProgram) => { Object.assign(p.ops[0]!.properties.luminance_key_cpu_profile as object, { tieWords: [0x3f800000, 0x3f800001] }) },
      (p: SourceCompositorProgram) => { Object.assign(p.ops[0]!.properties.luminance_key_cpu_profile as object, { mode: 'future' }) },
      (p: SourceCompositorProgram) => { Object.assign(p.ops[0]!.properties.luminance_key_cpu_profile as object, { sourcePlatform: 'win32' }) },
      (p: SourceCompositorProgram) => { Object.assign(p.ops[0]!.properties.luminance_key_cpu_profile as object, { sourceArchitecture: 'x86_64' }) },
      (p: SourceCompositorProgram) => { p.ops[0]!.inputs.Image!.value.type = 'VALUE' },
      (p: SourceCompositorProgram) => { p.ops[0]!.type = 'VALUE' },
    ]) {
      const document = cpuProgram(); mutate(document)
      expect(() => buildSourceCompositor(document, () => null)).toThrow(/Artist Luminance Key/)
    }
  })

  it('does not let a sparse threshold array reach deferred shader compilation', () => {
    const document = cpuProgram(); document.ops[0]!.properties.luminance_key_limits = new Array(2)
    expect(() => buildSourceCompositor(document, () => null)).toThrow(/native model/)
  })

  it('accepts the measured modern FTZ/DAZ profile only with its matching source version', () => {
    const document = cpuProgram(), properties = document.ops[0]!.properties
    properties.luminance_key_source_version = [5, 3, 0]
    Object.assign(properties.luminance_key_cpu_profile as object, { mode: 'ftz-daz-rne', underflowWord: 0, denormalInputWord: 0 })
    const built = buildSourceCompositor(document, () => null)
    expect(built.node.isNode).toBe(true); built.dispose()
  })

  it('does not confuse fixed field bounds with an actual GPU single value', () => {
    const document = cpuProgram(), key = document.ops[0]!
    key.properties.evaluation_device = 'GPU'
    document.ops.unshift({ id: 'field', kind: 'render-pass', type: 'VALUE', source: { path: [], node: 'Field threshold', nodeType: 'CompositorNodeRLayers', output: 'Depth' }, inputs: {}, properties: {}, pass: { scene: 'Scene', viewLayer: 'ViewLayer', pass: 'Depth', name: 'Depth', type: 'VALUE', engine: 'BLENDER_EEVEE', aov: null } })
    key.inputs.Minimum = { name: 'Minimum', socketType: 'VALUE', value: { kind: 'ref', type: 'VALUE', node: 'field' } }
    expect(() => buildSourceCompositor(document, () => float(1) as never)).toThrow(/actual CPU evaluator/)
    key.properties.luminance_key_model = 'native-luminance-key-v1'
    const built = buildSourceCompositor(document, () => float(1) as never)
    expect(built.node.isNode).toBe(true); built.dispose()
  })

  it('retains ordinary legacy reversed ramps through the original model', () => {
    const document = program(), op = document.ops[0]!
    Object.assign(op.properties, { luminance_key_schema: 'legacy-branch', luminance_key_limits: [.75, .25],
      luminance_key_precision: 'legacy-unqualified-cpu-v1' })
    const built = buildSourceCompositor(document, () => null)
    expect(built.node.isNode).toBe(true); built.dispose()
  })

  it('accepts a modern GPU single value only through its actual CPU fold', () => {
    const document = cpuProgram(); document.ops[0]!.properties.evaluation_device = 'GPU'
    const built = buildSourceCompositor(document, () => null)
    expect(built.node.isNode).toBe(true); built.dispose()
  })
})

function linuxCpuProgram(): SourceCompositorProgram {
  const document=cpuProgram(),properties=document.ops[0]!.properties
  Object.assign(properties.luminance_key_cpu_profile as object,{sourcePlatform:'linux',sourceArchitecture:'x86_64'})
  properties.luminance_key_source_build='fbe6228777e7'
  return document
}

describe('Linux52 CPU luminance admission candidate',()=>{
  it('admits only the measured binary and gradual Rec709 certificate through the real production builder',()=>{
    const built=buildSourceCompositor(linuxCpuProgram(),()=>null)
    expect(built.node.isNode).toBe(true);built.dispose()
  })

  it('refuses other Linux versions, builds, architectures, modes and Windows profiles independently',()=>{
    for(const mutate of [
      (p: SourceCompositorProgram)=>{p.ops[0]!.properties.luminance_key_source_build=undefined},
      (p: SourceCompositorProgram)=>{p.ops[0]!.properties.luminance_key_source_build='000000000000'},
      (p: SourceCompositorProgram)=>{p.ops[0]!.properties.luminance_key_source_version=[4,2,0];p.ops[0]!.properties.luminance_key_schema='legacy-branch'},
      (p: SourceCompositorProgram)=>{p.ops[0]!.properties.luminance_key_source_version=[5,3,0];Object.assign(p.ops[0]!.properties.luminance_key_cpu_profile as object,{mode:'ftz-daz-rne',underflowWord:0,denormalInputWord:0})},
      (p: SourceCompositorProgram)=>{p.ops[0]!.properties.luminance_key_source_version=[5,2,1]},
      (p: SourceCompositorProgram)=>{Object.assign(p.ops[0]!.properties.luminance_key_cpu_profile as object,{sourceArchitecture:'aarch64'})},
      (p: SourceCompositorProgram)=>{Object.assign(p.ops[0]!.properties.luminance_key_cpu_profile as object,{sourceArchitecture:'AMD64'})},
      (p: SourceCompositorProgram)=>{Object.assign(p.ops[0]!.properties.luminance_key_cpu_profile as object,{mode:'ftz-daz-rne',underflowWord:0,denormalInputWord:0})},
      (p: SourceCompositorProgram)=>{Object.assign(p.ops[0]!.properties.luminance_key_cpu_profile as object,{sourcePlatform:'win32',sourceArchitecture:'AMD64'})},
    ]){
      const document=linuxCpuProgram();mutate(document)
      expect(()=>buildSourceCompositor(document,()=>null)).toThrow(/Artist Luminance Key/)
    }
  })
})
