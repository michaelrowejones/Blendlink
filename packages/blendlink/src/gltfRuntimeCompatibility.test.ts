import { describe, expect, it } from 'vitest'
import {
  BLENDLINK_THREE_R184_COMPILED_PROFILE,
  inspectGltfRuntimeCompatibility,
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
})
