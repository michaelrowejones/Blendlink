import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { createThreeWebsiteSurfaces } from './threeWebsiteSurfaces.js'

function canvas(width = 64, height = 32): HTMLCanvasElement {
  return { width, height } as HTMLCanvasElement
}

function target(material: THREE.Material | THREE.Material[] = new THREE.MeshBasicMaterial({
  map: new THREE.Texture(),
})) {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(), material)
  mesh.name = 'Monitor Screen'
  return mesh
}

describe('Three Website Surfaces', () => {
  it('isolates shared materials, owns only its wrappers, and restores exactly', () => {
    const requestFrame = vi.fn()
    const fallback = new THREE.Texture()
    fallback.wrapS = THREE.RepeatWrapping
    fallback.wrapT = THREE.MirroredRepeatWrapping
    fallback.minFilter = THREE.LinearMipmapLinearFilter
    fallback.magFilter = THREE.NearestFilter
    fallback.generateMipmaps = false
    fallback.offset.set(0.25, 0.125)
    fallback.repeat.set(0.5, 0.75)
    const authored = new THREE.MeshBasicMaterial({ color: 0x5273a6, map: fallback })
    const screen = target(authored)
    const unrelated = target(authored)
    const surfaces = createThreeWebsiteSurfaces({ requestFrame })
    surfaces.register({
      componentId: 'surface-component', name: 'monitor-screen',
      target: screen, colorTreatment: 'display',
    })

    expect(screen.material).not.toBe(authored)
    expect(unrelated.material).toBe(authored)
    const owned = screen.material as THREE.MeshBasicMaterial
    expect(owned.map).toBe(fallback)
    expect(owned.color.equals(authored.color)).toBe(true)
    const disposeOwned = vi.spyOn(owned, 'dispose')
    const binding = surfaces.bindCanvas('monitor-screen', canvas())
    const texture = owned.map as THREE.CanvasTexture
    const disposeTexture = vi.spyOn(texture, 'dispose')
    expect(texture).toBeInstanceOf(THREE.CanvasTexture)
    expect(texture.flipY).toBe(false)
    expect(texture.colorSpace).toBe(THREE.SRGBColorSpace)
    expect(texture.minFilter).toBe(THREE.LinearFilter)
    expect(texture.magFilter).toBe(THREE.LinearFilter)
    expect(texture.generateMipmaps).toBe(false)
    expect(texture.wrapS).toBe(THREE.ClampToEdgeWrapping)
    expect(texture.wrapT).toBe(THREE.ClampToEdgeWrapping)
    expect(texture.offset.toArray()).toEqual([0, 0])
    expect(texture.repeat.toArray()).toEqual([1, 1])
    expect(owned.color.getHex()).toBe(0xffffff)
    expect(requestFrame).toHaveBeenCalledTimes(1)

    const version = texture.version
    binding.changed()
    expect(texture.version).toBe(version + 1)
    expect(requestFrame).toHaveBeenCalledTimes(2)
    binding.dispose()
    binding.dispose()
    expect(owned.map).toBe(fallback)
    expect(owned.color.equals(authored.color)).toBe(true)
    expect(fallback.offset.toArray()).toEqual([0.25, 0.125])
    expect(fallback.repeat.toArray()).toEqual([0.5, 0.75])
    expect(disposeTexture).toHaveBeenCalledOnce()
    expect(requestFrame).toHaveBeenCalledTimes(3)

    surfaces.dispose()
    surfaces.dispose()
    expect(screen.material).toBe(authored)
    expect(unrelated.material).toBe(authored)
    expect(disposeOwned).toHaveBeenCalledOnce()
    expect(() => binding.changed()).toThrow(/disposed/)
    expect(() => surfaces.bindCanvas('monitor-screen', canvas())).toThrow(/disposed/)
  })

  it('refuses ambiguous, UV-less, duplicate, zero-sized, and double-owned surfaces', () => {
    const surfaces = createThreeWebsiteSurfaces()
    const ambiguous = target([
      new THREE.MeshBasicMaterial(), new THREE.MeshBasicMaterial(),
    ])
    expect(() => surfaces.register({
      componentId: 'ambiguous', name: 'ambiguous', target: ambiguous,
      colorTreatment: 'surface',
    })).toThrow(/one material/)

    const noUv = target()
    noUv.geometry.deleteAttribute('uv')
    expect(() => surfaces.register({
      componentId: 'no-uv', name: 'no-uv', target: noUv,
      colorTreatment: 'surface',
    })).toThrow(/UV0/)

    const partialUv = target()
    partialUv.geometry.setAttribute('uv', new THREE.Float32BufferAttribute([
      0.2, 0.2, 0.8, 0.2, 0.2, 0.8, 0.8, 0.8,
    ], 2))
    expect(() => surfaces.register({
      componentId: 'partial-uv', name: 'partial-uv', target: partialUv,
      colorTreatment: 'surface',
    })).toThrow(/fill.*0-1/i)

    const zeroAreaUv = target()
    zeroAreaUv.geometry.setAttribute('uv', new THREE.Float32BufferAttribute([
      0, 0, 1, 1, 0.25, 0.25, 0.75, 0.75,
    ], 2))
    expect(() => surfaces.register({
      componentId: 'zero-area-uv', name: 'zero-area-uv', target: zeroAreaUv,
      colorTreatment: 'surface',
    })).toThrow(/no usable texture area/i)

    const nonfiniteUv = target()
    nonfiniteUv.geometry.getAttribute('uv').setXY(0, Number.NaN, 0)
    expect(() => surfaces.register({
      componentId: 'nonfinite-uv', name: 'nonfinite-uv', target: nonfiniteUv,
      colorTreatment: 'surface',
    })).toThrow(/finite/i)

    const screen = target()
    surfaces.register({
      componentId: 'valid', name: 'monitor-screen', target: screen,
      colorTreatment: 'surface',
    })
    expect(() => surfaces.register({
      componentId: 'duplicate', name: 'monitor-screen', target: target(),
      colorTreatment: 'surface',
    })).toThrow(/already registered/)
    expect(() => surfaces.bindCanvas('monitor-screen', canvas(0, 32))).toThrow(/positive/)
    const binding = surfaces.bindCanvas('monitor-screen', canvas())
    expect(() => surfaces.bindCanvas('monitor-screen', canvas())).toThrow(/already bound/)
    binding.dispose()
    expect(() => surfaces.bindCanvas('unknown', canvas())).toThrow(/Unknown Website Surface/)
    surfaces.dispose()
  })

  it('does not overwrite a later external material mutation during cleanup', () => {
    const screen = target()
    const authored = screen.material
    const surfaces = createThreeWebsiteSurfaces()
    surfaces.register({
      componentId: 'surface', name: 'monitor-screen', target: screen,
      colorTreatment: 'display',
    })
    const owned = screen.material as THREE.Material
    const disposeOwned = vi.spyOn(owned, 'dispose')
    const external = new THREE.MeshBasicMaterial()
    screen.material = external
    surfaces.dispose()
    expect(screen.material).toBe(external)
    expect(screen.material).not.toBe(authored)
    expect(disposeOwned).toHaveBeenCalledOnce()
  })

  it('recompiles a display material when a first canvas map is added and removed', () => {
    const screen = target(new THREE.MeshBasicMaterial({ color: 0x172033 }))
    const surfaces = createThreeWebsiteSurfaces()
    surfaces.register({
      componentId: 'surface', name: 'monitor-screen', target: screen,
      colorTreatment: 'display',
    })
    const owned = screen.material as THREE.MeshBasicMaterial
    expect(owned.map).toBeNull()

    const versionBeforeBind = owned.version
    const binding = surfaces.bindCanvas('monitor-screen', canvas())
    expect(owned.map).toBeInstanceOf(THREE.CanvasTexture)
    expect(owned.version).toBe(versionBeforeBind + 1)

    const versionBeforeDispose = owned.version
    binding.dispose()
    expect(owned.map).toBeNull()
    expect(owned.version).toBe(versionBeforeDispose + 1)
    surfaces.dispose()
  })

  it('keeps authored tint for Surface treatment while binding live pixels', () => {
    const authored = new THREE.MeshStandardMaterial({ color: 0x68451f })
    const screen = target(authored)
    const surfaces = createThreeWebsiteSurfaces()
    surfaces.register({
      componentId: 'surface', name: 'monitor-screen', target: screen,
      colorTreatment: 'surface',
    })
    const owned = screen.material as THREE.MeshStandardMaterial
    const color = owned.color.clone()
    const binding = surfaces.bindCanvas('monitor-screen', canvas())
    expect(owned.color.equals(color)).toBe(true)
    binding.dispose()
    expect(owned.color.equals(color)).toBe(true)
    surfaces.dispose()
  })
})
