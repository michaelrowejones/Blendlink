import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { installThreeComponents } from './threeComponents.js'
import type { PortableComponentRecord } from './components.js'
import type { SceneBindings } from './runtime.js'

function record(
  type: string,
  values: PortableComponentRecord['values'] = {},
): PortableComponentRecord {
  return {
    id: `component-${type}`,
    type,
    schemaVersion: 1,
    enabled: true,
    target: { kind: 'object', objectId: 'target-id', objectName: 'Target' },
    values,
  }
}

function fixture() {
  const scene = new THREE.Scene()
  const root = new THREE.Group()
  scene.add(root)
  const target = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial())
  target.name = 'Target'
  target.userData.blendlink_id = 'target-id'
  root.add(target)
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100)
  camera.position.set(0, 0, 5)
  camera.lookAt(0, 0, 0)
  const listeners = new Map<string, Set<EventListener>>()
  const canvas = {
    clientWidth: 200,
    clientHeight: 200,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 200 }),
    addEventListener(type: string, listener: EventListener) {
      const entries = listeners.get(type) ?? new Set<EventListener>()
      entries.add(listener)
      listeners.set(type, entries)
    },
    removeEventListener(type: string, listener: EventListener) {
      listeners.get(type)?.delete(listener)
    },
  }
  const renderer = { domElement: canvas, render: vi.fn() } as unknown as THREE.WebGLRenderer
  const bindings: SceneBindings<THREE.Object3D> = {
    byId: { 'target-id': target },
    byName: { Target: target },
    object: () => target,
    dispose() {},
  }
  const dispatch = (type: string, clientX = 100, clientY = 100) => {
    for (const listener of listeners.get(type) ?? []) {
      listener({ clientX, clientY } as unknown as Event)
    }
  }
  const updateMatrices = () => {
    camera.updateMatrixWorld(true)
    scene.updateMatrixWorld(true)
  }
  updateMatrices()
  return { scene, root, target, camera, renderer, bindings, dispatch, updateMatrices }
}

describe('Three behavior acceptance regressions', () => {
  it('rejects a browser-parsed unsafe scheme even when ASCII whitespace precedes it', async () => {
    const f = fixture()
    await expect(installThreeComponents({
      ...f,
      components: [record('blendlink.open-url', {
        url: ' \t\r\njavascript:alert(1)',
        newTab: true,
      })],
    })).rejects.toThrow(/unsupported javascript/i)
  })

  it('does not activate a target hidden behind a nearer rendered object', async () => {
    const f = fixture()
    const occluder = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial())
    occluder.position.z = 2.5
    f.root.add(occluder)
    f.updateMatrices()
    const openUrl = vi.fn()
    const installed = await installThreeComponents({
      ...f,
      openUrl,
      components: [record('blendlink.open-url', { url: 'https://example.com/', newTab: true })],
    })

    f.dispatch('click')
    expect(openUrl).not.toHaveBeenCalled()
    installed.dispose()
  })

  it('keeps Start Hidden active until the final overlapping owner disposes', async () => {
    const f = fixture()
    const component = record('blendlink.hide-on-start')
    const first = await installThreeComponents({ ...f, components: [component] })
    const second = await installThreeComponents({ ...f, components: [component] })
    expect(f.target.visible).toBe(false)
    first.dispose()
    expect(f.target.visible).toBe(false)
    second.dispose()
    expect(f.target.visible).toBe(true)
  })

  it('keeps Look At active until the final overlapping owner disposes', async () => {
    const f = fixture()
    f.target.position.set(1, 0, 0)
    f.updateMatrices()
    const original = f.target.quaternion.clone()
    const component = record('blendlink.look-at')
    const first = await installThreeComponents({ ...f, components: [component] })
    const second = await installThreeComponents({ ...f, components: [component] })
    first.update(1 / 60)
    second.update(1 / 60)
    expect(f.target.quaternion.equals(original)).toBe(false)
    first.dispose()
    expect(f.target.quaternion.equals(original)).toBe(false)
    second.dispose()
    expect(f.target.quaternion.equals(original)).toBe(true)
  })

  it('restores authored materials after overlapping See Through owners dispose', async () => {
    const f = fixture()
    const authored = new THREE.MeshBasicMaterial({ opacity: 1 })
    const occluder = new THREE.Mesh(new THREE.BoxGeometry(), authored)
    occluder.position.z = 2.5
    f.root.add(occluder)
    f.updateMatrices()
    const component = record('blendlink.see-through', {
      fadeDistance: 0.5,
      minOpacity: 0.2,
      duration: 0,
    })
    const first = await installThreeComponents({ ...f, components: [component] })
    first.update(1 / 60)
    const second = await installThreeComponents({ ...f, components: [component] })
    second.update(1 / 60)

    expect(occluder.material).not.toBe(authored)
    first.dispose()
    expect(occluder.material).not.toBe(authored)
    second.dispose()
    expect(occluder.material).toBe(authored)
  })

  it('uncaches an AnimationMixer root when click-animation ownership ends', async () => {
    const f = fixture()
    const uncacheRoot = vi.spyOn(THREE.AnimationMixer.prototype, 'uncacheRoot')
    const clip = new THREE.AnimationClip('Move', 1, [
      new THREE.NumberKeyframeTrack('Target.position[x]', [0, 1], [0, 1]),
    ])
    try {
      const installed = await installThreeComponents({
        ...f,
        animations: [clip],
        components: [record('blendlink.play-animation-on-click', { clip: 'Move', loop: false })],
      })
      installed.dispose()
      expect(uncacheRoot).toHaveBeenCalledOnce()
    } finally {
      uncacheRoot.mockRestore()
    }
  })
})
