import { describe, expect, it } from 'vitest'
import {
  COMPILED_SCENE_CONFORMANCE_CODES,
  inspectCompiledSceneConformance,
} from './compiledSceneConformance.js'

/**
 * Each case here is a defect that reached a browser and produced no error:
 * an invisible character, a white surface, a rig that drew nothing. The
 * artifact is the last place any of them can be caught, so the checks are
 * written against hand-built glTF JSON rather than against the compiler that
 * happens to produce it today.
 */
function gltf(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    asset: { version: '2.0' },
    materials: [],
    meshes: [],
    ...overrides,
  }
}

const OPAQUE_RED = {
  name: 'Painted',
  pbrMetallicRoughness: { baseColorFactor: [0.8, 0.1, 0.1, 1] },
}

describe('compiled scene conformance', () => {
  it('passes an ordinary artifact and records that every check ran', () => {
    const report = inspectCompiledSceneConformance({
      gltf: gltf({
        materials: [OPAQUE_RED],
        meshes: [{
          name: 'Crate',
          primitives: [{ material: 0, attributes: { POSITION: 0, TEXCOORD_0: 1 } }],
        }],
      }),
    })
    expect(report.conformant).toBe(true)
    expect(report.issues).toEqual([])
    // An empty issue list must never be confusable with a check that did not run.
    expect(report.checked['conformance.base-color-carrier-missing']).toBe(1)
  })

  it('refuses a material sampling a UV set the loader cannot bind', () => {
    const report = inspectCompiledSceneConformance({
      gltf: gltf({
        materials: [{
          name: 'Denim',
          pbrMetallicRoughness: {
            baseColorTexture: { index: 0, texCoord: 5 },
          },
        }],
        meshes: [{
          name: 'GEO-ellie_body',
          primitives: [{
            material: 0,
            attributes: { POSITION: 0, TEXCOORD_0: 1, TEXCOORD_5: 2 },
          }],
        }],
      }),
    })
    const issue = report.issues.find(
      (entry) => entry.code === 'conformance.texcoord-out-of-range',
    )
    expect(issue).toBeDefined()
    // Even with the attribute present the runtime cannot reach it, so the
    // check must not be satisfied by the geometry carrying TEXCOORD_5.
    expect(issue?.subject).toBe('Denim')
    expect(issue?.affects).toEqual(['GEO-ellie_body'])
    expect(issue?.fix).toContain('disappears')
  })

  it('finds a texCoord the runtime binds but the geometry does not carry', () => {
    const report = inspectCompiledSceneConformance({
      gltf: gltf({
        materials: [{
          name: 'Trim',
          pbrMetallicRoughness: { baseColorTexture: { index: 0, texCoord: 2 } },
        }],
        meshes: [{
          name: 'Boots',
          primitives: [{ material: 0, attributes: { POSITION: 0, TEXCOORD_0: 1 } }],
        }],
      }),
    })
    const issue = report.issues.find(
      (entry) => entry.code === 'conformance.texcoord-accessor-missing',
    )
    expect(issue?.subject).toBe('Trim')
    expect(issue?.summary).toContain('TEXCOORD_2')
  })

  it('finds texture references inside material extensions', () => {
    // The walk is generic precisely so a new extension cannot slip past it.
    const report = inspectCompiledSceneConformance({
      gltf: gltf({
        materials: [{
          name: 'Glass',
          pbrMetallicRoughness: { baseColorFactor: [0.5, 0.5, 0.5, 1] },
          extensions: {
            KHR_materials_transmission: {
              transmissionTexture: { index: 0, texCoord: 6 },
            },
          },
        }],
        meshes: [{
          name: 'Pane',
          primitives: [{ material: 0, attributes: { POSITION: 0, TEXCOORD_0: 1 } }],
        }],
      }),
    })
    expect(report.issues.map((entry) => entry.code))
      .toContain('conformance.texcoord-out-of-range')
  })

  it('refuses a material that decides no colour at all', () => {
    const report = inspectCompiledSceneConformance({
      gltf: gltf({
        materials: [{ name: 'eyes', pbrMetallicRoughness: { roughnessFactor: 0.4 } }],
        meshes: [{
          name: 'Eyes',
          primitives: [{ material: 0, attributes: { POSITION: 0 } }],
        }],
      }),
    })
    const issue = report.issues.find(
      (entry) => entry.code === 'conformance.base-color-carrier-missing',
    )
    expect(issue?.subject).toBe('eyes')
    expect(issue?.summary).toContain('neither a base-colour texture nor a base-colour factor')
  })

  it('treats an explicit all-white factor as no carrier, because it renders the same', () => {
    const report = inspectCompiledSceneConformance({
      gltf: gltf({
        materials: [{ name: 'gums', pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1] } }],
        meshes: [{ name: 'Gums', primitives: [{ material: 0, attributes: { POSITION: 0 } }] }],
      }),
    })
    expect(report.issues.map((entry) => entry.code))
      .toContain('conformance.base-color-carrier-missing')
  })

  it('accepts vertex colours as a carrier', () => {
    const report = inspectCompiledSceneConformance({
      gltf: gltf({
        materials: [{ name: 'Painted', pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1] } }],
        meshes: [{
          name: 'Wall',
          primitives: [{ material: 0, attributes: { POSITION: 0, COLOR_0: 1 } }],
        }],
      }),
    })
    expect(report.issues).toEqual([])
  })

  it('does not fault a material bound only by unreachable primitives', () => {
    const report = inspectCompiledSceneConformance({
      gltf: gltf({
        materials: [{ name: 'unused', pbrMetallicRoughness: { roughnessFactor: 0.4 } }],
        meshes: [{ name: 'Hidden', primitives: [{ material: 0, attributes: { POSITION: 0 } }] }],
      }),
      materialRenderedTriangles: [0],
    })
    expect(report.issues).toEqual([])
  })

  it('names primitives left on the stand-in for Blender\'s default material', () => {
    const report = inspectCompiledSceneConformance({
      gltf: gltf({
        materials: [{
          name: 'Blendlink Blender Default',
          pbrMetallicRoughness: { baseColorFactor: [0.8, 0.8, 0.8, 1] },
          extras: { blendlink_generated: 'blender-default-material' },
        }],
        meshes: [{
          name: 'hair.scalp',
          primitives: [{ material: 0, attributes: { POSITION: 0 } }],
        }],
      }),
    })
    const issue = report.issues.find(
      (entry) => entry.code === 'conformance.blender-default-material-bound',
    )
    expect(issue?.affects).toEqual(['hair.scalp'])
  })

  it('refuses a skin past the uniform-buffer joint ceiling', () => {
    const report = inspectCompiledSceneConformance({
      gltf: gltf({
        skins: [
          { name: 'RIG-Ellie', joints: Array.from({ length: 1867 }, (_, i) => i) },
          { name: 'RIG-Prop', joints: [0, 1, 2] },
        ],
      }),
    })
    const issue = report.issues.find(
      (entry) => entry.code === 'conformance.skin-joint-budget-exceeded',
    )
    expect(issue?.subject).toBe('RIG-Ellie')
    expect(issue?.summary).toContain('1867')
    expect(issue?.fix).toContain('classic WebGLRenderer still renders it')
    expect(report.checked['conformance.skin-joint-budget-exceeded']).toBe(2)
  })

  it('accepts exactly the measured ceiling', () => {
    const report = inspectCompiledSceneConformance({
      gltf: gltf({
        skins: [{ name: 'RIG', joints: Array.from({ length: 1024 }, (_, i) => i) }],
      }),
    })
    expect(report.conformant).toBe(true)
  })

  it('keeps the declared code list and the codes it can emit in step', () => {
    const emitted = new Set(Object.keys(
      inspectCompiledSceneConformance({ gltf: gltf({}) }).checked,
    ))
    expect([...emitted].sort()).toEqual([...COMPILED_SCENE_CONFORMANCE_CODES].sort())
  })
})
