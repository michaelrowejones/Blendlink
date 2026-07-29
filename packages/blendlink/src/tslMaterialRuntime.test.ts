import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import {
  installTslMaterials,
  type MaterialProgramsDocument,
} from './tslMaterialRuntime.js'

// Node-construction only, like tslNodeRecipe.test.ts: numeric fidelity is
// the differential harness's job; this pins the application seam — extras
// identity, per-channel hybrid application, reversibility, named skips.

function programs(
  materials: MaterialProgramsDocument['materials'],
): MaterialProgramsDocument {
  return { schemaVersion: 1, model: 'blendlink-material-programs-v1', materials }
}

const UV_X_DOCUMENT = {
  schemaVersion: 1 as const,
  model: 'blendlink-tsl-ir-v1' as const,
  output: { op: 'separate', channel: 'x', input: { op: 'uv' } },
}

function sceneWith(
  material: THREE.Material,
  extras?: Record<string, unknown>,
): { root: THREE.Group; mesh: THREE.Mesh } {
  const root = new THREE.Group()
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), material)
  if (extras) mesh.userData.blendlink_tsl_runtime = extras
  root.add(mesh)
  return { root, mesh }
}

const pointer = { url: 'https://scene.test/x.materials.json', bytes: 1, hash: 'x', materials: 1 }

describe('installTslMaterials', () => {
  it('is inert without a programs pointer', async () => {
    const installed = await installTslMaterials({
      root: new THREE.Group(),
      descriptor: {},
    })
    expect(installed.materials).toBe(0)
    expect(installed.applied).toBe(0)
  })

  it('applies IR channels by extras identity and restores on dispose', async () => {
    const material = new THREE.MeshStandardMaterial()
    material.userData.blendlink_source_material = 'Paint'
    const { root, mesh } = sceneWith(material)
    const installed = await installTslMaterials({
      root,
      descriptor: { materialPrograms: pointer },
      loadPrograms: async () => programs({
        Paint: {
          channels: {
            'Base Color': { tslIr: UV_X_DOCUMENT },
            Roughness: { tslIr: UV_X_DOCUMENT },
          },
        },
      }),
    })
    expect(installed.materials).toBe(1)
    expect(installed.applied).toBe(1)
    const applied = mesh.material as unknown as {
      colorNode: unknown
      roughnessNode: unknown
      metalnessNode: unknown
      fragmentNode: unknown
      vertexNode: unknown
      mrtNode: unknown
    }
    expect(mesh.material).not.toBe(material)
    expect(applied.colorNode).toBeTruthy()
    expect(applied.roughnessNode).toBeTruthy()
    // Metallic shipped no IR: its carrier (copied factor) stays untouched.
    expect(applied.metalnessNode ?? null).toBeNull()
    // NodeMaterial.copy from a plain shipped material turns null node-slot
    // defaults into undefined, and NodeMaterial.setup() distinguishes the
    // two (`fragmentNode === null` falls through; undefined crashes the
    // first shader build). The clone must restore exact nulls.
    expect(applied.fragmentNode).toBeNull()
    expect(applied.vertexNode).toBeNull()
    expect(applied.mrtNode).toBeNull()
    installed.dispose()
    expect(mesh.material).toBe(material)
  })

  it('shares one clone across meshes whose runtime extras agree', async () => {
    const material = new THREE.MeshStandardMaterial()
    material.userData.blendlink_source_material = 'Paint'
    const root = new THREE.Group()
    const first = new THREE.Mesh(new THREE.BoxGeometry(), material)
    const second = new THREE.Mesh(new THREE.BoxGeometry(), material)
    root.add(first, second)
    const installed = await installTslMaterials({
      root,
      descriptor: { materialPrograms: pointer },
      loadPrograms: async () => programs({
        Paint: { channels: { 'Base Color': { tslIr: UV_X_DOCUMENT } } },
      }),
    })
    expect(installed.applied).toBe(2)
    expect(first.material).toBe(second.material)
    installed.dispose()
  })

  it('resolves named UV maps through the stamped mesh extras', async () => {
    const material = new THREE.MeshStandardMaterial()
    material.userData.blendlink_source_material = 'Detail'
    const { root } = sceneWith(material, { uvChannels: { Detail: 1 } })
    const document = {
      ...UV_X_DOCUMENT,
      output: {
        op: 'separate',
        channel: 'x',
        input: { op: 'uv', uvMap: 'Detail' },
      },
    }
    const installed = await installTslMaterials({
      root,
      descriptor: { materialPrograms: pointer },
      loadPrograms: async () => programs({
        Detail: { channels: { 'Base Color': { tslIr: document } } },
      }),
    })
    expect(installed.applied).toBe(1)
    expect(installed.skipped).toEqual([])
    installed.dispose()
  })

  it('skips unresolvable channels by name and keeps the carrier', async () => {
    const material = new THREE.MeshStandardMaterial()
    material.userData.blendlink_source_material = 'Detail'
    // No extras: a named-UV program cannot resolve its channel map.
    const { root, mesh } = sceneWith(material)
    const document = {
      ...UV_X_DOCUMENT,
      output: { op: 'generated' },
    }
    const installed = await installTslMaterials({
      root,
      descriptor: { materialPrograms: pointer },
      loadPrograms: async () => programs({
        Detail: { channels: { 'Base Color': { tslIr: document } } },
      }),
    })
    expect(installed.applied).toBe(0)
    expect(mesh.material).toBe(material)
    expect(installed.skipped.some((item) =>
      item.channel === 'Base Color' && /generatedTexspace/.test(item.reason))).toBe(true)
    installed.dispose()
  })

  it('resolves texture_ref programs through the injected image decoder', async () => {
    const material = new THREE.MeshStandardMaterial()
    material.userData.blendlink_source_material = 'Paint'
    const { root, mesh } = sceneWith(material)
    const data = new Uint8Array(4 * 4 * 4).fill(255)
    const texture = new THREE.DataTexture(data, 4, 4)
    const loadProgramTexture = vi.fn(async () => texture)
    const installed = await installTslMaterials({
      root,
      descriptor: { materialPrograms: pointer },
      loadPrograms: async () => ({
        ...programs({
          Paint: {
            channels: {
              'Base Color': {
                tslIr: {
                  ...UV_X_DOCUMENT,
                  output: {
                    op: 'texture_ref',
                    ref: { image: 'stroke', interpolation: 'Linear', extension: 'REPEAT' },
                    image: { name: 'stroke', width: 2048, height: 2048, colorSpace: 'sRGB' },
                    interpolation: 'Linear',
                    extension: 'REPEAT',
                    output: 'color',
                    vector: { op: 'uv' },
                  },
                },
              },
            },
          },
        }),
        images: {
          stroke: {
            file: 'x.tex.stroke.png', bytes: 1, hash: 'y', mime: 'image/png',
            width: 2048, height: 2048, colorSpace: 'sRGB',
          },
        },
      }),
      loadProgramTexture,
    })
    expect(loadProgramTexture).toHaveBeenCalledOnce()
    expect(installed.applied).toBe(1)
    expect(installed.skipped).toEqual([])
    expect((mesh.material as unknown as { colorNode: unknown }).colorNode).toBeTruthy()
    installed.dispose()
  })

  it('skips texture_ref channels by name when the image is unpublished', async () => {
    const material = new THREE.MeshStandardMaterial()
    material.userData.blendlink_source_material = 'Paint'
    const { root, mesh } = sceneWith(material)
    const installed = await installTslMaterials({
      root,
      descriptor: { materialPrograms: pointer },
      loadPrograms: async () => programs({
        Paint: {
          channels: {
            'Base Color': {
              tslIr: {
                ...UV_X_DOCUMENT,
                output: {
                  op: 'texture_ref',
                  ref: { image: 'stroke' },
                  image: { name: 'stroke', width: 2048, height: 2048, colorSpace: 'sRGB' },
                  output: 'color',
                  vector: { op: 'uv' },
                },
              },
            },
          },
        },
      }),
    })
    expect(installed.applied).toBe(0)
    expect(mesh.material).toBe(material)
    expect(installed.skipped.some((item) =>
      /BuildTslOptions\.textures/.test(item.reason))).toBe(true)
    installed.dispose()
  })

  it('applies attribute_object programs through per-object uniforms', async () => {
    const material = new THREE.MeshStandardMaterial()
    material.userData.blendlink_source_material = 'Paint'
    const { root, mesh } = sceneWith(material)
    mesh.userData.tint = [0.8, 0.35, 0.1]
    const installed = await installTslMaterials({
      root,
      descriptor: { materialPrograms: pointer },
      loadPrograms: async () => programs({
        Paint: {
          channels: {
            'Base Color': {
              tslIr: {
                ...UV_X_DOCUMENT,
                output: { op: 'attribute_object', name: 'tint', output: 'color' },
              },
            },
          },
        },
      }),
    })
    expect(installed.applied).toBe(1)
    expect(installed.skipped).toEqual([])
    installed.dispose()
  })

  it('skips meshes that ship no per-object attribute by name', async () => {
    const material = new THREE.MeshStandardMaterial()
    material.userData.blendlink_source_material = 'Paint'
    const { root, mesh } = sceneWith(material)
    const installed = await installTslMaterials({
      root,
      descriptor: { materialPrograms: pointer },
      loadPrograms: async () => programs({
        Paint: {
          channels: {
            'Base Color': {
              tslIr: {
                ...UV_X_DOCUMENT,
                output: { op: 'attribute_object', name: 'tint', output: 'color' },
              },
            },
          },
        },
      }),
    })
    expect(installed.applied).toBe(0)
    expect(mesh.material).toBe(material)
    expect(installed.skipped.some((item) =>
      /per-object attribute tint/.test(item.reason))).toBe(true)
    installed.dispose()
  })

  it('keeps clones connected through trackMaterialClone and releases on dispose', async () => {
    const material = new THREE.MeshStandardMaterial()
    material.userData.blendlink_source_material = 'Paint'
    const { root } = sceneWith(material)
    const release = vi.fn()
    const trackMaterialClone = vi.fn(() => release)
    const installed = await installTslMaterials({
      root,
      descriptor: { materialPrograms: pointer },
      loadPrograms: async () => programs({
        Paint: { channels: { 'Base Color': { tslIr: UV_X_DOCUMENT } } },
      }),
      trackMaterialClone,
    })
    expect(trackMaterialClone).toHaveBeenCalledOnce()
    installed.dispose()
    expect(release).toHaveBeenCalledWith(false)
  })
})
