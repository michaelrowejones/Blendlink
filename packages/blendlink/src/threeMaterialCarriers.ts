import * as THREE from 'three'

const STATIC_SHADE_FLOOR_RULE = 'blendlink.lit.selected-field-static-shade-floor'

export interface ThreeStaticShadeFloorTextureReport {
  materials: number
  alreadyShared: number
  normalized: number
  dispose(): void
}

interface InstalledTextureShare {
  material: THREE.MeshStandardMaterial
  shared: THREE.Texture
  originalEmissive: THREE.Texture
}

function materialList(object: THREE.Object3D): THREE.Material[] {
  const candidate = object as THREE.Object3D & {
    material?: THREE.Material | THREE.Material[]
  }
  if (!candidate.material) return []
  return Array.isArray(candidate.material)
    ? candidate.material
    : [candidate.material]
}

function sameNumbers(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length
    && left.every((value, index) => Object.is(value, right[index]))
}

function compatibleTextureUse(left: THREE.Texture, right: THREE.Texture): boolean {
  return left.source === right.source
    && left.mapping === right.mapping
    && left.channel === right.channel
    && left.wrapS === right.wrapS
    && left.wrapT === right.wrapT
    && left.magFilter === right.magFilter
    && left.minFilter === right.minFilter
    && left.anisotropy === right.anisotropy
    && left.format === right.format
    && left.internalFormat === right.internalFormat
    && left.type === right.type
    && left.colorSpace === right.colorSpace
    && left.flipY === right.flipY
    && left.generateMipmaps === right.generateMipmaps
    && left.premultiplyAlpha === right.premultiplyAlpha
    && left.unpackAlignment === right.unpackAlignment
    && left.matrixAutoUpdate === right.matrixAutoUpdate
    && left.rotation === right.rotation
    && sameNumbers(left.offset.toArray(), right.offset.toArray())
    && sameNumbers(left.repeat.toArray(), right.repeat.toArray())
    && sameNumbers(left.center.toArray(), right.center.toArray())
    && sameNumbers(left.matrix.elements, right.matrix.elements)
}

/**
 * Rejoin GLTFLoader's per-TextureInfo clones for Blendlink's proved stock
 * Base Color/Emission carrier. GLTFLoader clones a glTF Texture independently
 * for each nonzero texCoord slot, even when both slots reference one index.
 *
 * The mutation is conditional and reversible for cache-owning applications.
 * It runs before Blendlink's prewarm/first render, so the redundant clone is
 * never intentionally uploaded by the package.
 */
export function installThreeStaticShadeFloorTextureSharing(
  root: THREE.Object3D,
): ThreeStaticShadeFloorTextureReport {
  const seen = new Set<THREE.Material>()
  const installed: InstalledTextureShare[] = []
  let materials = 0
  let alreadyShared = 0
  let disposed = false

  const rollback = (): void => {
    for (const item of installed.slice().reverse()) {
      if (item.material.emissiveMap === item.shared) {
        item.material.emissiveMap = item.originalEmissive
        item.material.needsUpdate = true
      }
    }
  }

  try {
    root.traverse((object) => {
      for (const untyped of materialList(object)) {
        if (seen.has(untyped)) continue
        seen.add(untyped)
        if (untyped.userData?.blendlink_material_rule !== STATIC_SHADE_FLOOR_RULE) {
          continue
        }
        materials += 1
        const material = untyped as THREE.MeshStandardMaterial
        if (material.isMeshStandardMaterial !== true
            || !material.map || !material.emissiveMap) {
          throw new Error(
            `Blendlink static shade-floor material "${material.name || '(unnamed)'}" ` +
            'did not load as MeshStandardMaterial with Base Color and Emission textures.',
          )
        }
        if (material.map === material.emissiveMap) {
          alreadyShared += 1
          continue
        }
        if (!compatibleTextureUse(material.map, material.emissiveMap)) {
          throw new Error(
            `Blendlink static shade-floor material "${material.name || '(unnamed)'}" ` +
            'loaded Base Color and Emission with different image, UV, sampler, or transform ' +
            'contracts; refusing to merge them.',
          )
        }
        const originalEmissive = material.emissiveMap
        installed.push({
          material,
          shared: material.map,
          originalEmissive,
        })
        material.emissiveMap = material.map
        material.needsUpdate = true
      }
    })
  } catch (error) {
    rollback()
    throw error
  }

  return {
    materials,
    alreadyShared,
    normalized: installed.length,
    dispose() {
      if (disposed) return
      disposed = true
      rollback()
    },
  }
}
