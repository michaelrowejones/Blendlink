import { describe, expect, it } from 'vitest'
import {
  BLENDLINK_THREE_R184_COMPILED_PROFILE,
  inspectGltfRuntimeCompatibility,
  THREE_NODE_MAX_SKIN_JOINTS,
  type GltfRuntimeCapabilityProfile,
} from './gltfRuntimeCompatibility.js'

const profile: GltfRuntimeCapabilityProfile = {
  id: 'test-three-r184',
  supportedRequiredExtensions: new Set(['KHR_materials_unlit']),
}

describe('glTF runtime compatibility', () => {
  it('accepts a known required KHR_materials_unlit extension', () => {
    const report = inspectGltfRuntimeCompatibility({
      asset: { version: '2.0' },
      extensionsUsed: ['KHR_materials_unlit'],
      extensionsRequired: ['KHR_materials_unlit'],
    }, profile)

    expect(report).toMatchObject({
      compatible: true,
      extensionsUsed: ['KHR_materials_unlit'],
      extensionsRequired: ['KHR_materials_unlit'],
      animationPointers: [],
      issues: [],
    })
  })

  it('observes an unknown optional extension without treating it as required', () => {
    const report = inspectGltfRuntimeCompatibility({
      asset: { version: '2.0' },
      extensionsUsed: ['VENDOR_optional_scene_feature'],
    }, profile)

    expect(report).toMatchObject({
      compatible: true,
      extensionsUsed: ['VENDOR_optional_scene_feature'],
      extensionsRequired: [],
      issues: [],
    })
  })

  it('reports an unsupported required extension with a stable remedy', () => {
    const report = inspectGltfRuntimeCompatibility({
      asset: { version: '2.0' },
      extensionsUsed: ['KHR_node_visibility'],
      extensionsRequired: ['KHR_node_visibility'],
    }, profile)

    expect(report.compatible).toBe(false)
    expect(report.issues).toEqual([expect.objectContaining({
      code: 'runtime.required-extension-unsupported',
      extension: 'KHR_node_visibility',
      location: '/extensionsRequired/0',
      summary: expect.stringContaining('KHR_node_visibility'),
      fix: expect.stringContaining('compatible runtime'),
    })])
  })

  it('reports an optional material animation pointer without losing core-track evidence', () => {
    const report = inspectGltfRuntimeCompatibility({
      asset: { version: '2.0' },
      extensionsUsed: ['KHR_animation_pointer'],
      animations: [{
        channels: [
          { sampler: 0, target: { node: 0, path: 'translation' } },
          {
            sampler: 1,
            target: {
              path: 'pointer',
              extensions: {
                KHR_animation_pointer: {
                  pointer: '/materials/0/pbrMetallicRoughness/baseColorFactor',
                },
              },
            },
          },
        ],
      }],
    }, profile)

    expect(report.animationPointers).toEqual([{
      animation: 0,
      channel: 1,
      pointer: '/materials/0/pbrMetallicRoughness/baseColorFactor',
      family: 'material',
    }])
    expect(report.issues).toEqual([expect.objectContaining({
      code: 'runtime.animation-pointer-unsupported',
      extension: 'KHR_animation_pointer',
      location: '/animations/0/channels/1/target/extensions/KHR_animation_pointer/pointer',
      pointer: '/materials/0/pbrMetallicRoughness/baseColorFactor',
    })])
  })

  it('distinguishes package-configured decoders from unsupported external ones', () => {
    const report = inspectGltfRuntimeCompatibility({
      asset: { version: '2.0' },
      extensionsUsed: [
        'KHR_texture_basisu',
        'EXT_meshopt_compression',
        'KHR_meshopt_compression',
        'KHR_draco_mesh_compression',
      ],
      extensionsRequired: [
        'KHR_texture_basisu',
        'EXT_meshopt_compression',
        'KHR_meshopt_compression',
        'KHR_draco_mesh_compression',
      ],
    }, BLENDLINK_THREE_R184_COMPILED_PROFILE)

    expect(report.issues.map((issue) => issue.extension)).toEqual([
      'KHR_meshopt_compression',
      'KHR_draco_mesh_compression',
    ])
  })

  it.each([
    {
      label: 'extensionsUsed is not an array',
      document: { asset: { version: '2.0' }, extensionsUsed: 'KHR_materials_unlit' },
      message: 'glTF /extensionsUsed must be an array of non-empty strings.',
    },
    {
      label: 'extensionsRequired contains an empty name',
      document: { asset: { version: '2.0' }, extensionsRequired: [''] },
      message: 'glTF /extensionsRequired must be an array of non-empty strings.',
    },
    {
      label: 'an animation channel target is not an object',
      document: {
        asset: { version: '2.0' },
        animations: [{ channels: [{ target: null }] }],
      },
      message: 'glTF /animations/0/channels/0/target must be an object.',
    },
    {
      label: 'animation target extensions are not an object',
      document: {
        asset: { version: '2.0' },
        animations: [{ channels: [{ target: { extensions: [] } }] }],
      },
      message: 'glTF /animations/0/channels/0/target/extensions must be an object.',
    },
    {
      label: 'the animation-pointer payload is not an object',
      document: {
        asset: { version: '2.0' },
        animations: [{
          channels: [{
            target: {
              path: 'pointer',
              extensions: { KHR_animation_pointer: null },
            },
          }],
        }],
      },
      message: 'glTF /animations/0/channels/0/target/extensions/KHR_animation_pointer/pointer must be a non-empty JSON pointer string.',
    },
    {
      label: 'an animation pointer is not an absolute JSON pointer',
      document: {
        asset: { version: '2.0' },
        animations: [{
          channels: [{
            target: {
              path: 'pointer',
              extensions: {
                KHR_animation_pointer: {
                  pointer: 'materials/0/pbrMetallicRoughness/baseColorFactor',
                },
              },
            },
          }],
        }],
      },
      message: 'glTF /animations/0/channels/0/target/extensions/KHR_animation_pointer/pointer must be a non-empty JSON pointer string.',
    },
    {
      label: 'an animation pointer target has the wrong path discriminator',
      document: {
        asset: { version: '2.0' },
        animations: [{
          channels: [{
            target: {
              path: 'translation',
              extensions: {
                KHR_animation_pointer: {
                  pointer: '/materials/0/pbrMetallicRoughness/baseColorFactor',
                },
              },
            },
          }],
        }],
      },
      message: 'glTF /animations/0/channels/0/target/extensions/KHR_animation_pointer requires target.path "pointer".',
    },
  ])('fails loudly when $label', ({ document, message }) => {
    expect(() => inspectGltfRuntimeCompatibility(document, profile)).toThrow(message)
  })

  /**
   * The joint ceiling belongs to the renderer, not to the artifact. three's
   * node-material renderers bind bone matrices as a uniform buffer that holds
   * exactly 1024; the classic WebGLRenderer uploads them through a texture and
   * has no limit at all. A profile that states no ceiling must therefore
   * accept a skin that would be unrenderable elsewhere - otherwise Blendlink
   * would refuse a scene that renders perfectly well.
   */
  describe('skin joint budget', () => {
    const rig = (joints: number, name = 'RIG'): Record<string, unknown> => ({
      asset: { version: '2.0' },
      skins: [{ name, joints: Array.from({ length: joints }, (_, index) => index) }],
    })

    it('reports joint counts even when no ceiling applies', () => {
      const report = inspectGltfRuntimeCompatibility(rig(1867), profile)
      expect(report.compatible).toBe(true)
      expect(report.skins).toEqual([
        { skin: 0, name: 'RIG', joints: 1867, boneMatrixBytes: 1867 * 64 },
      ])
    })

    it('refuses a skin past a stated ceiling and names both symptoms', () => {
      const report = inspectGltfRuntimeCompatibility(rig(1867), {
        ...profile,
        maxSkinJoints: THREE_NODE_MAX_SKIN_JOINTS,
      })
      expect(report.compatible).toBe(false)
      const issue = report.issues[0]
      expect(issue?.code).toBe('runtime.skin-joint-budget-exceeded')
      expect(issue?.location).toBe('/skins/0/joints')
      expect(issue?.skin?.joints).toBe(1867)
      expect(issue?.summary).toContain('65536')
      expect(issue?.fix).toContain('no pixels')
    })

    it('accepts exactly the ceiling', () => {
      const report = inspectGltfRuntimeCompatibility(
        rig(THREE_NODE_MAX_SKIN_JOINTS),
        { ...profile, maxSkinJoints: THREE_NODE_MAX_SKIN_JOINTS },
      )
      expect(report.compatible).toBe(true)
    })

    it('treats a malformed joint list as an inspection failure, never a pass', () => {
      expect(() => inspectGltfRuntimeCompatibility({
        asset: { version: '2.0' },
        skins: [{ name: 'RIG', joints: [] }],
      }, profile)).toThrow('/skins/0/joints must be a non-empty array')
    })

    it('refuses a nonsense ceiling rather than silently ignoring it', () => {
      expect(() => inspectGltfRuntimeCompatibility(rig(4), {
        ...profile,
        maxSkinJoints: 0,
      })).toThrow('maxSkinJoints must be a positive integer')
    })
  })
})
