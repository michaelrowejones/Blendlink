import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { createThreeInteractionServices } from './threeInteractions.js'

describe('Three semantic interaction services', () => {
  it('shares one listener/raycast path and exposes app-owned accessible controls', () => {
    const listeners = new Map<string, EventListener>()
    const surface = {
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
      addEventListener: vi.fn((type: string, listener: EventListener) => listeners.set(type, listener)),
      removeEventListener: vi.fn((type: string) => listeners.delete(type)),
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
      hasPointerCapture: vi.fn(() => true),
    }
    const root = new THREE.Group()
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial())
    mesh.position.z = -2
    root.add(mesh)
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 10)
    root.updateMatrixWorld(true)
    camera.updateMatrixWorld(true)
    const services = createThreeInteractionServices({ root, camera, surface })
    const first = vi.fn()
    const second = vi.fn()
    const hover = vi.fn()
    const a = services.interaction.addTarget({ id: 'a', target: mesh, activate: first, hover })
    const b = services.interaction.addTarget({ id: 'b', target: mesh, activate: second })
    const control = services.accessibility.addControl({
      id: 'a', target: mesh, role: 'link', label: 'Open work', href: '/work',
      linkTarget: '_blank', activate: first,
    })

    expect(surface.addEventListener).not.toHaveBeenCalled()
    services.activate()
    services.activate()
    expect(surface.addEventListener).toHaveBeenCalledTimes(6)
    const pointer = (overrides: Record<string, unknown> = {}) => ({
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
      button: 0,
      clientX: 50,
      clientY: 50,
      ...overrides,
    }) as unknown as Event
    listeners.get('pointerdown')?.(pointer())
    listeners.get('pointerup')?.(pointer())
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)
    expect(surface.setPointerCapture).toHaveBeenCalledWith(1)

    listeners.get('pointerdown')?.(pointer())
    listeners.get('pointermove')?.(pointer({ clientX: 70, pointerType: 'touch' }))
    listeners.get('pointerup')?.(pointer({ clientX: 70, pointerType: 'touch' }))
    listeners.get('pointerdown')?.(pointer())
    listeners.get('pointercancel')?.(pointer())
    listeners.get('pointerdown')?.(pointer())
    listeners.get('lostpointercapture')?.(pointer())
    listeners.get('pointerup')?.(pointer())
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)
    expect(services.controls).toHaveLength(1)
    expect(services.controls[0]).toMatchObject({
      role: 'link', label: 'Open work', href: '/work', linkTarget: '_blank',
    })
    services.controls[0]!.setFocused(true)
    services.controls[0]!.setFocused(false)
    expect(hover.mock.calls).toEqual([[true], [false]])

    control.dispose()
    b.dispose()
    a.dispose()
    expect(surface.removeEventListener).toHaveBeenCalledTimes(6)
    services.dispose()
    mesh.geometry.dispose()
    mesh.material.dispose()
  })
})
