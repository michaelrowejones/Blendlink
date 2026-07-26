import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { installThreeStaticShadeFloorTextureSharing } from './threeMaterialCarriers.js'

const RULE = 'blendlink.lit.selected-field-static-shade-floor'

function fixture() {
  const base = new THREE.Texture({ fixture: true })
  base.channel = 1
  base.colorSpace = THREE.SRGBColorSpace
  base.wrapS = THREE.ClampToEdgeWrapping
  base.wrapT = THREE.ClampToEdgeWrapping
  const emissive = base.clone()
  const material = new THREE.MeshStandardMaterial({
    map: base,
    emissiveMap: emissive,
  })
  material.name = 'Factorized fixture'
  material.userData.blendlink_material_rule = RULE
  const root = new THREE.Group()
  root.add(new THREE.Mesh(new THREE.BufferGeometry(), material))
  return { root, material, base, emissive }
}

describe('static shade-floor Three texture ownership', () => {
  it('rejoins equivalent GLTFLoader TextureInfo clones and restores cache-owned state', () => {
    const { root, material, base, emissive } = fixture()
    expect(base).not.toBe(emissive)
    expect(base.source).toBe(emissive.source)

    const installed = installThreeStaticShadeFloorTextureSharing(root)
    expect(installed).toMatchObject({
      materials: 1,
      alreadyShared: 0,
      normalized: 1,
    })
    expect(material.map).toBe(base)
    expect(material.emissiveMap).toBe(base)

    installed.dispose()
    expect(material.map).toBe(base)
    expect(material.emissiveMap).toBe(emissive)
  })

  it('accepts an already-shared texture and does not overwrite application changes', () => {
    const first = fixture()
    first.material.emissiveMap = first.base
    const already = installThreeStaticShadeFloorTextureSharing(first.root)
    expect(already).toMatchObject({
      materials: 1,
      alreadyShared: 1,
      normalized: 0,
    })
    already.dispose()
    expect(first.material.emissiveMap).toBe(first.base)

    const second = fixture()
    const installed = installThreeStaticShadeFloorTextureSharing(second.root)
    const application = new THREE.Texture()
    second.material.emissiveMap = application
    installed.dispose()
    expect(second.material.emissiveMap).toBe(application)
  })

  it('refuses mismatched UV/sampler contracts atomically', () => {
    const { root, material, emissive } = fixture()
    emissive.wrapS = THREE.RepeatWrapping
    expect(() => installThreeStaticShadeFloorTextureSharing(root))
      .toThrow(/different image, UV, sampler, or transform contracts/)
    expect(material.emissiveMap).toBe(emissive)
  })
})
