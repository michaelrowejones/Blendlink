import { describe, expect, it } from 'vitest'
import { sumKnownGpuTextureBytes } from './typegen.js'

describe('typegen GPU texture evidence', () => {
  it('preserves known zero for an artifact with no textures', () => {
    expect(sumKnownGpuTextureBytes([])).toBe(0)
  })

  it('sums fully inspected textures', () => {
    expect(sumKnownGpuTextureBytes([{ gpuSize: 64 }, { gpuSize: 128 }])).toBe(192)
  })

  it('does not coerce an inspector null into a zero-byte allocation', () => {
    expect(sumKnownGpuTextureBytes([{ gpuSize: 64 }, { gpuSize: null }])).toBeUndefined()
  })
})
