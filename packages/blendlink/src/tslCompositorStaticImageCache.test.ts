import { describe, expect, it, vi } from 'vitest'
import { cacheStaticCompositorRtt } from './tslCompositorStaticImageDomain.js'
import { staticImageCacheEligible } from './tslCompositorStaticImage.js'
import type { SourceCompositorProgram } from './sourceDisplay.js'

describe('deterministic native Image RTT cache', () => {
  it('requires an Image-only known pointwise graph, leaving scene and future operations uncached', () => {
    const program = { passes: [], ops: [{ kind: 'image-input' }, { kind: 'invert' }] } as unknown as SourceCompositorProgram
    expect(staticImageCacheEligible(program)).toBe(true)
    for (const kind of ['render-pass', 'image-affine', 'translate', 'blur', 'glare', 'filter', 'flip', 'future-clock']) {
      expect(staticImageCacheEligible({ ...program, ops: [...program.ops, { kind } as any] })).toBe(false)
    }
    expect(staticImageCacheEligible({ ...program, passes: [{} as any] })).toBe(false)
    expect(staticImageCacheEligible({ ...program, ops: [{ kind: 'rgb' } as any] })).toBe(false)
  })

  it('draws each renderer once, invalidates the restored context only, and removes owned listeners on disposal', () => {
    const a = { domElement: new EventTarget() }, b = { domElement: new EventTarget() }
    const draws: object[] = [], resources: { dispose(): void }[] = []
    const remove = vi.spyOn(a.domElement, 'removeEventListener')
    const image = { autoUpdate: true, textureNeedsUpdate: true, updateBefore({ renderer }: any) {
      if (!this.textureNeedsUpdate && !this.autoUpdate) return
      this.textureNeedsUpdate = false; draws.push(renderer)
    } }
    cacheStaticCompositorRtt(image, resources)
    image.updateBefore({ renderer: a }); image.updateBefore({ renderer: a })
    image.updateBefore({ renderer: b }); image.updateBefore({ renderer: b })
    expect(draws).toEqual([a, b]); expect(image.autoUpdate).toBe(false)
    a.domElement.dispatchEvent(new Event('webglcontextrestored'))
    image.updateBefore({ renderer: b }); image.updateBefore({ renderer: a }); image.updateBefore({ renderer: a })
    expect(draws).toEqual([a, b, a])
    resources[0]!.dispose(); resources[0]!.dispose()
    expect(remove).toHaveBeenCalledTimes(1)
    expect(() => image.updateBefore({ renderer: a })).toThrow(/disposed/)
  })

  it('retries a failed first draw rather than treating an empty target as cached', () => {
    let fail = true, draws = 0
    const image = { autoUpdate: true, textureNeedsUpdate: true, updateBefore() {
      if (!this.textureNeedsUpdate && !this.autoUpdate) return
      this.textureNeedsUpdate = false
      if (fail) throw new Error('Context not ready')
      draws++
    } }
    const resources: { dispose(): void }[] = [], frame = { renderer: {} }
    cacheStaticCompositorRtt(image, resources)
    expect(() => image.updateBefore(frame)).toThrow(/Context not ready/)
    fail = false; image.updateBefore(frame); image.updateBefore(frame)
    expect(draws).toBe(1); resources[0]!.dispose()
  })
})
