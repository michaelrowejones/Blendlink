import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { installThreeShadowCatcher } from './threeShadowCatcher.js'

function values(
  mode: 'mask' | 'additive' | 'occluder',
): Parameters<typeof installThreeShadowCatcher>[1] {
  return {
    mode, color: [0.1, 0.2, 0.3], opacity: 0.5, lightStrength: 6.6,
    includeDescendants: true,
  }
}

function shader(fragmentShader: string): THREE.WebGLProgramParametersWithUniforms {
  return {
    uniforms: {},
    vertexShader: '',
    fragmentShader,
  } as unknown as THREE.WebGLProgramParametersWithUniforms
}

describe('installThreeShadowCatcher', () => {
  it('supports authored descendant groups without taking raycast-layer ownership', () => {
    const target = new THREE.Group()
    target.name = 'Receiver Group'
    const firstMaterial = new THREE.MeshStandardMaterial()
    const secondMaterials = [
      new THREE.MeshStandardMaterial(),
      new THREE.MeshPhysicalMaterial(),
    ]
    const first = new THREE.Mesh(new THREE.BoxGeometry(), firstMaterial)
    const second = new THREE.Mesh(new THREE.BoxGeometry(), secondMaterials)
    first.receiveShadow = false
    second.receiveShadow = true
    first.renderOrder = 4
    second.renderOrder = 7
    first.layers.set(6)
    second.layers.set(9)
    const firstLayerMask = first.layers.mask
    const secondLayerMask = second.layers.mask
    target.add(first, second)

    const installed = installThreeShadowCatcher(target, values('mask'))
    expect(installed.meshes).toBe(2)
    expect(first.material).toBeInstanceOf(THREE.ShadowMaterial)
    expect(second.material).toHaveLength(2)
    expect((first.material as THREE.ShadowMaterial).color.toArray()).toEqual([0.1, 0.2, 0.3])
    expect((first.material as THREE.ShadowMaterial).opacity).toBe(0.5)
    expect(first.receiveShadow).toBe(true)
    expect(second.receiveShadow).toBe(true)
    expect(first.layers.mask).toBe(firstLayerMask)
    expect(second.layers.mask).toBe(secondLayerMask)

    const owned = [
      first.material as THREE.Material,
      ...(second.material as THREE.Material[]),
    ]
    const disposed = owned.map(() => vi.fn())
    owned.forEach((material, index) => material.addEventListener('dispose', disposed[index]!))
    const applicationMaterial = new THREE.MeshBasicMaterial()
    second.material = applicationMaterial
    second.receiveShadow = false
    second.renderOrder = 99

    installed.dispose()
    expect(first.material).toBe(firstMaterial)
    expect(first.receiveShadow).toBe(false)
    expect(first.renderOrder).toBe(4)
    expect(second.material).toBe(applicationMaterial)
    expect(second.receiveShadow).toBe(false)
    expect(second.renderOrder).toBe(99)
    expect(first.layers.mask).toBe(firstLayerMask)
    expect(second.layers.mask).toBe(secondLayerMask)
    expect(disposed.every((listener) => listener.mock.calls.length === 1)).toBe(true)
    expect(() => installed.dispose()).not.toThrow()
  })

  it('preserves the authored standard material in Additive mode and patches direct light loudly', () => {
    const source = new THREE.MeshStandardMaterial({
      color: 0x336699,
      roughness: 0.42,
      metalness: 0.17,
    })
    source.name = 'Authored Principled'
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(), source)
    const installed = installThreeShadowCatcher(mesh, values('additive'))
    const material = mesh.material as THREE.MeshStandardMaterial
    expect(material).not.toBe(source)
    expect(material.color.getHex()).toBe(source.color.getHex())
    expect(material.roughness).toBe(source.roughness)
    expect(material.metalness).toBe(source.metalness)
    expect(material.blending).toBe(THREE.AdditiveBlending)
    expect(material.depthWrite).toBe(false)

    const seam = 'vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;'
    const compiled = shader(`void main() { ${seam} }`)
    material.onBeforeCompile(compiled, {} as THREE.WebGLRenderer)
    expect(compiled.uniforms.blendlinkShadowStrength?.value).toBe(6.6)
    expect(compiled.fragmentShader).toContain('reflectedLight.directDiffuse')
    expect(compiled.fragmentShader).toContain('gl_FragColor = vec4')
    expect(compiled.fragmentShader).not.toContain('blendlinkShadowColor')
    expect(() => material.onBeforeCompile(
      shader('void main() {}'), {} as THREE.WebGLRenderer,
    )).toThrow(/supported lighting seam/)

    installed.dispose()
    expect(mesh.material).toBe(source)
  })

  it('refuses Additive on a material whose shader cannot supply direct lighting', () => {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial())
    expect(() => installThreeShadowCatcher(mesh, values('additive')))
      .toThrow(/Principled BSDF.*Mask\/Occluder/)
  })

  it('installs an invisible early depth occluder and restores every owned field', () => {
    const alphaMap = new THREE.Texture()
    const clippingPlane = new THREE.Plane(new THREE.Vector3(1, 0, 0), 0)
    const source = new THREE.MeshStandardMaterial({
      alphaMap, alphaTest: 0.37, clippingPlanes: [clippingPlane],
    })
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(), source)
    mesh.receiveShadow = true
    mesh.renderOrder = 23
    mesh.layers.set(11)
    const layerMask = mesh.layers.mask
    const installed = installThreeShadowCatcher(mesh, values('occluder'))
    const material = mesh.material as THREE.MeshBasicMaterial
    expect(material.colorWrite).toBe(false)
    expect(material.depthWrite).toBe(true)
    expect(material.stencilWrite).toBe(true)
    expect(material.alphaMap).toBe(alphaMap)
    expect(material.alphaTest).toBe(0.37)
    expect(material.clippingPlanes).toEqual([clippingPlane])
    expect(mesh.receiveShadow).toBe(false)
    expect(mesh.renderOrder).toBe(-100)
    expect(mesh.layers.mask).toBe(layerMask)

    installed.dispose()
    expect(mesh.material).toBe(source)
    expect(mesh.receiveShadow).toBe(true)
    expect(mesh.renderOrder).toBe(23)
    expect(mesh.layers.mask).toBe(layerMask)
  })

  it('rolls back earlier descendants and created GPU materials after a later mesh fails', () => {
    const target = new THREE.Group()
    const firstMaterial = new THREE.MeshStandardMaterial()
    const first = new THREE.Mesh(new THREE.PlaneGeometry(), firstMaterial)
    const broken = new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshStandardMaterial())
    ;(broken as THREE.Mesh & { material: undefined }).material = undefined
    target.add(first, broken)
    const dispose = vi.spyOn(THREE.Material.prototype, 'dispose')
    try {
      expect(() => installThreeShadowCatcher(target, values('mask')))
        .toThrow(/has no material slots/)
      expect(first.material).toBe(firstMaterial)
      expect(dispose).toHaveBeenCalled()
    } finally {
      dispose.mockRestore()
    }
  })

  it('keeps the newest overlapping install active and restores the authored baseline last', () => {
    const authored = new THREE.MeshStandardMaterial()
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(), authored)
    mesh.receiveShadow = false
    mesh.renderOrder = 12
    const first = installThreeShadowCatcher(mesh, values('mask'))
    const firstMaterial = mesh.material
    const second = installThreeShadowCatcher(mesh, values('occluder'))
    const secondMaterial = mesh.material

    first.dispose()
    expect(mesh.material).toBe(secondMaterial)
    expect(mesh.receiveShadow).toBe(false)
    expect(mesh.renderOrder).toBe(-100)
    second.dispose()
    expect(mesh.material).toBe(authored)
    expect(mesh.material).not.toBe(firstMaterial)
    expect(mesh.receiveShadow).toBe(false)
    expect(mesh.renderOrder).toBe(12)
  })

  it('preserves an application-owned material-array slot while restoring untouched slots', () => {
    const authored = [
      new THREE.MeshStandardMaterial(),
      new THREE.MeshStandardMaterial(),
    ]
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), authored)
    const installed = installThreeShadowCatcher(mesh, values('mask'))
    const replacements = mesh.material as THREE.Material[]
    const applicationMaterial = new THREE.MeshBasicMaterial()
    replacements[1] = applicationMaterial

    installed.dispose()
    expect(mesh.material).toBe(replacements)
    expect((mesh.material as THREE.Material[])[0]).toBe(authored[0])
    expect((mesh.material as THREE.Material[])[1]).toBe(applicationMaterial)
  })

  it('can scope a mesh receiver without replacing unrelated child meshes', () => {
    const parentMaterial = new THREE.MeshStandardMaterial()
    const childMaterial = new THREE.MeshStandardMaterial()
    const parent = new THREE.Mesh(new THREE.BoxGeometry(), parentMaterial)
    const child = new THREE.Mesh(new THREE.BoxGeometry(), childMaterial)
    parent.add(child)
    const scoped = { ...values('mask'), includeDescendants: false }
    const installed = installThreeShadowCatcher(parent, scoped)
    expect(installed.meshes).toBe(1)
    expect(parent.material).toBeInstanceOf(THREE.ShadowMaterial)
    expect(child.material).toBe(childMaterial)
    installed.dispose()
    expect(parent.material).toBe(parentMaterial)
  })

  it('creates and transactionally removes Needle-compatible geometry for an empty target', () => {
    const group = new THREE.Group()
    group.name = 'Empty Receiver'
    const installed = installThreeShadowCatcher(group, values('mask'))
    expect(installed.meshes).toBe(1)
    const generated = group.children[0] as THREE.Mesh
    expect(generated.name).toBe('Empty Receiver Shadow Catcher')
    expect(generated.userData.blendlink_generated_shadow_catcher).toBe(true)
    expect(generated.material).toBeInstanceOf(THREE.ShadowMaterial)
    installed.dispose()
    expect(group.children).toEqual([])
  })

  it('reference-counts a generated receiver across overlapping preview generations', () => {
    const target = new THREE.Group()
    const first = installThreeShadowCatcher(target, values('mask'))
    const generated = target.children[0]
    const second = installThreeShadowCatcher(target, values('occluder'))
    expect(target.children).toEqual([generated])
    first.dispose()
    expect(target.children).toEqual([generated])
    second.dispose()
    expect(target.children).toEqual([])
  })
})
