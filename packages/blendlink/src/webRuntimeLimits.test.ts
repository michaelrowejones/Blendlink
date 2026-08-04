import { describe, expect, it } from 'vitest'
import {
  webRuntimeLimit,
  webRuntimeLimitConsequence,
  webRuntimeLimits,
} from './webRuntimeLimits.js'
import {
  THREE_MAX_TEXTURE_COORDINATE_INDEX,
  THREE_NODE_MAX_SKIN_JOINTS,
} from './gltfRuntimeCompatibility.js'

/**
 * The registry is authored once and read by three parties in two languages:
 * this module, the constants compiled into the browser runtime, and
 * `web_runtime_limits.py` on the Blender side. Only the Python half can assert
 * itself against its own reader; this file closes the gap for the TypeScript
 * half, so a ceiling can never be raised in one language alone.
 */
describe('web runtime limits', () => {
  it('declares every limit with a symptom, an action, and evidence', () => {
    const registry = webRuntimeLimits()
    expect(registry.limits.length).toBeGreaterThan(0)
    for (const limit of registry.limits) {
      expect(limit.maximum).toBeGreaterThan(0)
      expect(limit.summary.length).toBeGreaterThan(20)
      expect(limit.symptom.length).toBeGreaterThan(20)
      expect(limit.action.length).toBeGreaterThan(20)
      expect(limit.evidence.length).toBeGreaterThan(0)
    }
  })

  it('agrees with the constants bundled into the browser runtime', () => {
    // These are duplicated on purpose: gltfRuntimeCompatibility ships to the
    // browser and must not import node:fs. This is what keeps them honest.
    expect(webRuntimeLimit('skin-joints').maximum).toBe(THREE_NODE_MAX_SKIN_JOINTS)
    expect(webRuntimeLimit('texture-coordinate-index').maximum)
      .toBe(THREE_MAX_TEXTURE_COORDINATE_INDEX)
  })

  it('derives the joint ceiling from the uniform buffer it comes from', () => {
    // 1024 is not a chosen number: it is 65536 bytes divided by one mat4.
    expect(webRuntimeLimit('skin-joints').maximum * 64).toBe(65536)
  })

  it('names the known ids when asked for one that does not exist', () => {
    expect(() => webRuntimeLimit('bone-texture')).toThrow(/skin-joints/)
  })

  it('offers one artist-facing consequence sentence per limit', () => {
    const consequence = webRuntimeLimitConsequence('skin-joints')
    expect(consequence).toContain('renders nothing')
    expect(consequence).toContain('deforming joints')
  })
})
