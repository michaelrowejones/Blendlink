import { expect, it } from 'vitest'
import { nativeBumpInput, isNativeUnitNormal } from './tslBumpPassthrough.js'
import { buildTslColorNode, type TslIrExpression } from './tslNodeRecipe.js'

const wrap = (input: TslIrExpression): TslIrExpression => ({
  op: 'bump_passthrough_native',
  model: 'eevee-no-height-v1',
  sourceEngine: 'EEVEE',
  input,
})

it('copies finite zero and nonunit vector data without normalizing it', () => {
  for (const value of [
    [0, 0, 0],
    [0.2, -0.7, 3],
  ]) {
    const input = { op: 'const_vec3', value }
    expect(nativeBumpInput(wrap(input))).toBe(input)
    expect(
      buildTslColorNode({ schemaVersion: 1, model: 'blendlink-tsl-ir-v1', output: wrap(input) }),
    ).toBeTruthy()
    expect(isNativeUnitNormal(wrap(input))).toBe(false)
  }
})

it('requires a proven unit source for a Normal-slot conversion, not a claimed passthrough marker', () => {
  const unit = { op: 'geometry_context', output: 'normal' }
  expect(isNativeUnitNormal(wrap(wrap(unit)))).toBe(true)
  expect(isNativeUnitNormal(wrap({ op: 'geometry_context', output: 'position' }))).toBe(false)
  for (const fields of [{ model: 'future' }, { sourceEngine: 'CYCLES' }, { input: null }])
    expect(() => nativeBumpInput({ ...wrap(unit), ...fields })).toThrow(/verified EEVEE no-height/)
  expect(() =>
    buildTslColorNode({
      schemaVersion: 1,
      model: 'blendlink-tsl-ir-v1',
      output: {
        op: 'normal_view_native',
        input: wrap({ op: 'const_vec3', value: [0, 0, 0] }),
      },
    }),
  ).toThrow(/verified unit-normal/)
})
