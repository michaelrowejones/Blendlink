import { BufferGeometry, Float32BufferAttribute, Mesh, PerspectiveCamera } from 'three'
import { expect, it, vi } from 'vitest'
import {
  analyseBumpHeight,
  nativeBumpOffsetWidth,
  validateBumpHeightBinding,
  validateBumpHeightView,
} from './tslBumpHeight.js'
const scalar = (value: number) => ({ op: 'const_float', value })
const x = { op: 'separate', channel: 'x', input: { op: 'uv_active' } }
const y = { op: 'separate', channel: 'y', input: { op: 'uv_active' } }
const math = (operation: string, a: unknown, b: unknown) => ({ op: 'math', operation, a, b })

it('preserves the affine operation tree while deriving actual UV bounds', () => {
  const height = math(
    'ADD',
    math('SUBTRACT', math('MULTIPLY', x, scalar(0.25)), math('MULTIPLY', y, scalar(0.5))),
    scalar(0.3),
  )
  const before = JSON.stringify(height),
    result = analyseBumpHeight(height, [
      [0, 1],
      [0, 1],
    ])
  expect(result.coefficients).toEqual([0.25, -0.5, 0.3])
  expect(result.range[0]).toBeCloseTo(-0.2)
  expect(result.range[1]).toBeCloseTo(0.55)
  expect(result.uv).toEqual({ op: 'uv_active' })
  expect(JSON.stringify(height)).toBe(before)
  expect(analyseBumpHeight(scalar(0.3)).varying).toBe(false)
  for (const invalid of [
    math('MULTIPLY', x, y),
    math('SINE', x, scalar(0)),
    scalar(1000),
    math('ADD', x, { ...y, input: { op: 'uv', uvMap: 'Other' } }),
    math('ADD', scalar(0.2), scalar(0.3)),
  ])
    expect(() => analyseBumpHeight(invalid)).toThrow(/Bump Height/)
  expect(() =>
    analyseBumpHeight(height, [
      [-20, 20],
      [-20, 20],
    ]),
  ).toThrow(/range/)
})

it('reproduces C6g filter-width rounding, including exact Float32 decimal ties', () => {
  expect(nativeBumpOffsetWidth(Math.fround(0.1))).toBe(Math.fround(0.1))
  expect(nativeBumpOffsetWidth(1.015625)).toBe(Math.fround(1.01562))
  expect(nativeBumpOffsetWidth(0.1015625)).toBe(Math.fround(0.101562))
  expect(nativeBumpOffsetWidth(1.234375)).toBe(Math.fround(1.23438))
  expect(nativeBumpOffsetWidth(9.765625)).toBe(Math.fround(9.76562))
  for (const invalid of [NaN, Infinity, 0.001, 1000, 0.1234567])
    expect(() => nativeBumpOffsetWidth(invalid)).toThrow(/Float32/)
})

const field = () => ({
  op: 'bump_height_native',
  model: 'eevee-affine-uv-v1',
  sourceEngine: 'EEVEE',
  sourceVersion: '5.3',
  sourceGpuBackend: 'METAL',
  normal: {
    op: 'geometry_context',
    output: 'normal',
    sourceEngine: 'EEVEE',
    model: 'primary-triangles-v1',
    normalStorage: 'SNORM10',
  },
  position: {
    op: 'geometry_context',
    output: 'position',
    sourceEngine: 'EEVEE',
    model: 'primary-triangles-v1',
  },
  height: math(
    'ADD',
    math('MULTIPLY', x, scalar(Math.fround(0.001))),
    math('MULTIPLY', y, scalar(Math.fround(-0.0007))),
  ),
  strength: 1,
  distance: 1,
  filterWidth: 1,
  offsetWidth: 1,
  invert: false,
})
const options = {
  objectSpace: { basis: 'blender-z-up' as const },
  uvSpace: 'blender' as const,
  activeUvChannel: 0,
}
function surface() {
  const geometry = new BufferGeometry()
    .setAttribute(
      'position',
      new Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3),
    )
    .setAttribute('normal', new Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3))
    .setAttribute('uv', new Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2))
    .setIndex([0, 1, 2, 0, 2, 3])
  const mesh = new Mesh(geometry),
    camera = new PerspectiveCamera(45, 2, 0.001, 1000)
  camera.position.z = 25
  camera.updateMatrixWorld(true)
  mesh.updateMatrixWorld(true)
  return { mesh, camera }
}
it('binds actual UV/normal/topology data and invalidates cached proofs when attributes change', () => {
  const { mesh } = surface(),
    expression = field()
  expect(validateBumpHeightBinding([expression], mesh, options)).toHaveLength(1)
  mesh.geometry.getAttribute('uv').setX(0, 3)
  mesh.geometry.getAttribute('uv').needsUpdate = true
  expect(() => validateBumpHeightBinding([expression], mesh, options)).toThrow(/UVs/)
  mesh.geometry.getAttribute('uv').setX(0, 0)
  mesh.geometry.getAttribute('uv').needsUpdate = true
  expect(validateBumpHeightBinding([expression], mesh, options)).toHaveLength(1)
  mesh.geometry.getAttribute('normal').setXYZ(0, 0.01, 0, Math.sqrt(1 - 0.01 ** 2))
  mesh.geometry.getAttribute('normal').needsUpdate = true
  expect(() => validateBumpHeightBinding([expression], mesh, options)).toThrow(/flat normals/)
  const second = surface().mesh
  expect(validateBumpHeightBinding([expression], second, options)).toHaveLength(1)
})
it('uses actual world slope and view precision, admitting small legacy Distance1 without broad Distance1 claims', () => {
  const { mesh, camera } = surface(),
    expression = field()
  expect(() =>
    validateBumpHeightView(expression, mesh, camera, { width: 1024, height: 512 }, options),
  ).not.toThrow()
  const steep = { ...expression, height: math('MULTIPLY', x, scalar(1)) }
  expect(() => validateBumpHeightBinding([steep], mesh, options)).toThrow(/effective world slope/)
  const biased = { ...expression, height: math('ADD', expression.height, scalar(1)) }
  camera.position.z = 1
  camera.updateMatrixWorld(true)
  expect(() =>
    validateBumpHeightView(biased, mesh, camera, { width: 1024, height: 512 }, options),
  ).toThrow(/view precision/)
  expect(() =>
    validateBumpHeightBinding(
      [{ ...expression, filterWidth: Math.fround(0.001), offsetWidth: Math.fround(0.001) }],
      mesh,
      options,
    ),
  ).toThrow(/Filter Width/)
  expect(() =>
    validateBumpHeightBinding([{ ...expression, sourceGpuBackend: 'OPENGL' }], mesh, options),
  ).toThrow(/source profile/)
})

it('reuses immutable mesh facts across alternating owners and still checks each owner transform', () => {
  const expression = field(),
    a = surface().mesh,
    b = surface().mesh
  validateBumpHeightBinding([expression], a, options)
  validateBumpHeightBinding([expression], b, options)
  const reads = vi.spyOn(a.geometry.getAttribute('position'), 'getX')
  validateBumpHeightBinding([expression], a, options)
  expect(reads).not.toHaveBeenCalled()
  a.position.x = 100
  a.updateMatrixWorld(true)
  expect(() => validateBumpHeightBinding([expression], a, options)).toThrow(/world magnitude/)
  reads.mockRestore()
})

it('does not confuse a slightly oversized smooth normal with a geometric flat normal', () => {
  const { mesh } = surface(),
    normal = mesh.geometry.getAttribute('normal')
  // The primary geometry contract tolerates small Float32 length residuals;
  // Height still tests the direction, rather than accepting raw dot>=1.
  normal.setXYZ(0, 0.01, 0, 1)
  normal.needsUpdate = true
  expect(() => validateBumpHeightBinding([field()], mesh, options)).toThrow(/flat normals/)
})

it('keeps a nondegenerate Float32 derivative frame even for literal zero-slope Height', () => {
  const { mesh, camera } = surface(),
    expression = { ...field(), height: scalar(Math.fround(0.3)) }
  mesh.position.x = 20
  mesh.updateMatrixWorld(true)
  camera.position.set(20, 0, 1)
  camera.updateMatrixWorld(true)
  expect(() =>
    validateBumpHeightView(expression, mesh, camera, { width: 1024, height: 512 }, options),
  ).toThrow(/view precision/)
  camera.position.z = 25
  camera.updateMatrixWorld(true)
  expect(() =>
    validateBumpHeightView(expression, mesh, camera, { width: 1024, height: 512 }, options),
  ).not.toThrow()
})
