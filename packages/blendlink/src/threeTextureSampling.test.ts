import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  installThreeTextureSampling,
  type ThreeTextureSamplingRenderer,
} from './threeTextureSampling.js'

function rendererWithMaxAnisotropy(maximum: number): ThreeTextureSamplingRenderer {
  return {
    capabilities: {
      getMaxAnisotropy: () => maximum,
    },
  }
}

describe('three texture sampling', () => {
  it('raises owned mipmapped material textures to the renderer maximum and restores them', () => {
    const mipmapped = new THREE.Texture()
    mipmapped.minFilter = THREE.LinearMipmapLinearFilter
    const nonMipmapped = new THREE.Texture()
    nonMipmapped.minFilter = THREE.LinearFilter

    const material = new THREE.MeshStandardMaterial({ map: mipmapped })
    material.emissiveMap = nonMipmapped
    const root = new THREE.Group()
    root.add(
      new THREE.Mesh(new THREE.PlaneGeometry(), material),
      new THREE.Mesh(new THREE.PlaneGeometry(), material),
    )

    const sampling = installThreeTextureSampling(
      root,
      rendererWithMaxAnisotropy(16),
      'renderer-max',
    )

    expect(sampling.report).toEqual({
      policy: 'renderer-max',
      requestedAnisotropy: 16,
      appliedAnisotropy: 16,
      materialTextures: 2,
      eligibleTextures: 1,
      changedTextures: 1,
    })
    expect(mipmapped.anisotropy).toBe(16)
    expect(mipmapped.version).toBe(1)
    expect(nonMipmapped.anisotropy).toBe(1)
    expect(nonMipmapped.version).toBe(0)

    sampling.dispose()

    expect(mipmapped.anisotropy).toBe(1)
    expect(mipmapped.version).toBe(2)
    sampling.dispose()
    expect(mipmapped.version).toBe(2)
  })

  it('coordinates explicit leases on a shared cached texture without restoring too early', () => {
    const texture = new THREE.Texture()
    const material = new THREE.MeshStandardMaterial({ map: texture })
    const root = new THREE.Mesh(new THREE.PlaneGeometry(), material)

    const quality = installThreeTextureSampling(
      root,
      rendererWithMaxAnisotropy(16),
      'renderer-max',
    )
    const balanced = installThreeTextureSampling(
      root,
      rendererWithMaxAnisotropy(16),
      4,
    )

    expect(texture.anisotropy).toBe(16)

    quality.dispose()
    expect(texture.anisotropy).toBe(4)

    balanced.dispose()
    expect(texture.anisotropy).toBe(1)
  })

  it('does not restore over an application change made during an explicit cache lease', () => {
    const texture = new THREE.Texture()
    const root = new THREE.Mesh(
      new THREE.PlaneGeometry(),
      new THREE.MeshStandardMaterial({ map: texture }),
    )
    const sampling = installThreeTextureSampling(
      root,
      rendererWithMaxAnisotropy(16),
      'renderer-max',
    )

    texture.anisotropy = 8
    texture.needsUpdate = true
    sampling.dispose()

    expect(texture.anisotropy).toBe(8)
  })

  it('keeps authored sampling completely untouched', () => {
    const texture = new THREE.Texture()
    const root = new THREE.Mesh(
      new THREE.PlaneGeometry(),
      new THREE.MeshStandardMaterial({ map: texture }),
    )

    const sampling = installThreeTextureSampling(
      root,
      rendererWithMaxAnisotropy(16),
      'authored',
    )

    expect(sampling.report).toMatchObject({
      policy: 'authored',
      requestedAnisotropy: null,
      appliedAnisotropy: null,
      changedTextures: 0,
    })
    expect(texture.anisotropy).toBe(1)
    expect(texture.version).toBe(0)
    sampling.dispose()
    expect(texture.version).toBe(0)
  })
})
