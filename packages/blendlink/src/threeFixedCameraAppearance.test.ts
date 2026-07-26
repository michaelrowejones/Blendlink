import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import {
  installThreeFixedCameraAppearance,
  type ThreeFixedCameraAppearanceContract,
} from './threeFixedCameraAppearance.js'

const SCENE_HASH = 'a'.repeat(64)
const SOURCE_HASH = 'b'.repeat(64)
const CAPTURE_HASH = 'c'.repeat(64)

function fixture() {
  const root = new THREE.Group()
  const receiver = new THREE.Group()
  receiver.userData.blendlink_id = 'receiver-stable-id'
  const geometry = new THREE.PlaneGeometry(4, 2)
  const source = new THREE.MeshStandardMaterial({ color: 0x4488aa })
  source.name = 'Authored procedural surface'
  source.userData.blendlink_source_material_id = 'material-stable-id'
  const surface = new THREE.Mesh(geometry, source)
  receiver.add(surface)
  root.add(receiver)

  const foregroundMaterial = new THREE.MeshStandardMaterial({ color: 0xff0000 })
  const foreground = new THREE.Mesh(new THREE.SphereGeometry(0.25), foregroundMaterial)
  foreground.position.z = 1
  root.add(foreground)

  const camera = new THREE.PerspectiveCamera(50, 2, 0.1, 100)
  camera.userData.blendlink_id = 'camera-stable-id'
  camera.position.set(0, 0, 5)
  camera.updateProjectionMatrix()
  camera.updateMatrixWorld(true)

  const capture = new THREE.Texture({ width: 1200, height: 600 })
  capture.name = 'Authoritative Eevee surface capture'
  capture.colorSpace = THREE.SRGBColorSpace

  const contract: ThreeFixedCameraAppearanceContract = {
    schemaVersion: 1,
    sceneHash: SCENE_HASH,
    sourceHash: SOURCE_HASH,
    frame: 1,
    capture: {
      hash: CAPTURE_HASH,
      width: 1200,
      height: 600,
      aspect: 2,
      colorSpace: 'srgb-display',
    },
    camera: {
      objectId: 'camera-stable-id',
      matrixWorld: camera.matrixWorld.toArray(),
      projectionMatrix: camera.projectionMatrix.toArray(),
    },
    surfaces: [{
      receiverId: 'receiver-stable-id',
      sourceMaterialId: 'material-stable-id',
      primitiveCount: 1,
    }],
  }
  return {
    root,
    receiver,
    surface,
    geometry,
    source,
    foreground,
    foregroundMaterial,
    camera,
    capture,
    contract,
  }
}

function installFixture(value = fixture()) {
  return installThreeFixedCameraAppearance({
    root: value.root,
    camera: value.camera,
    texture: value.capture,
    contract: value.contract,
    evidence: {
      sceneHash: SCENE_HASH,
      sourceHash: SOURCE_HASH,
      captureHash: CAPTURE_HASH,
      frame: 1,
    },
    viewport: { width: 1200, height: 600 },
  })
}

describe('Three fixed-camera appearance surface transport', () => {
  it('reversibly projects one attested surface without replacing geometry or unrelated materials', () => {
    const value = fixture()
    const originalBeforeRender = vi.fn()
    value.surface.onBeforeRender = originalBeforeRender
    const captureDispose = vi.spyOn(value.capture, 'dispose')
    const sourceDispose = vi.spyOn(value.source, 'dispose')
    const handle = installFixture(value)

    expect(value.surface.geometry).toBe(value.geometry)
    expect(value.surface.material).not.toBe(value.source)
    expect(value.surface.material).toBeInstanceOf(THREE.MeshBasicMaterial)
    expect(value.foreground.material).toBe(value.foregroundMaterial)
    expect(handle.bindingCount).toBe(1)
    expect(handle.materialCount).toBe(1)

    const installed = value.surface.material as THREE.MeshBasicMaterial
    const installedDispose = vi.spyOn(installed, 'dispose')
    expect(installed.map).not.toBe(value.capture)
    expect(installed.map?.source).toBe(value.capture.source)
    expect(installed.toneMapped).toBe(false)
    expect(installed.transparent).toBe(false)
    expect(installed.depthTest).toBe(value.source.depthTest)
    expect(installed.depthWrite).toBe(value.source.depthWrite)

    const shader = {
      uniforms: {},
      vertexShader: '#include <common>\n#include <project_vertex>',
      fragmentShader: '#include <common>\n#include <map_fragment>',
    }
    installed.onBeforeCompile(shader as never, {} as THREE.WebGLRenderer)
    expect(shader.vertexShader).toContain('blendlinkFixedCameraProjector')
    expect(shader.fragmentShader).toContain('blendlinkFixedCameraCoord')

    const renderer = {
      outputColorSpace: THREE.SRGBColorSpace,
      getCurrentViewport(target: THREE.Vector4) {
        return target.set(0, 0, 1200, 600)
      },
    } as THREE.WebGLRenderer
    expect(() => value.surface.onBeforeRender(
      renderer,
      value.root as THREE.Scene,
      value.camera,
      value.geometry,
      installed,
      null,
    )).not.toThrow()
    expect(originalBeforeRender).toHaveBeenCalledOnce()

    value.camera.position.x = 0.25
    value.camera.updateMatrixWorld(true)
    expect(() => value.surface.onBeforeRender(
      renderer,
      value.root as THREE.Scene,
      value.camera,
      value.geometry,
      installed,
      null,
    )).toThrow(/camera matrix changed/i)

    handle.dispose()
    expect(value.surface.material).toBe(value.source)
    expect(value.surface.onBeforeRender).toBe(originalBeforeRender)
    expect(captureDispose).not.toHaveBeenCalled()
    expect(sourceDispose).not.toHaveBeenCalled()
    expect(installedDispose).toHaveBeenCalledOnce()
    handle.dispose()
  })

  it('rejects camera, aspect, frame, scene, source, and capture drift before mutating the surface', () => {
    const cases: Array<[string, (value: ReturnType<typeof fixture>) => void]> = [
      ['scene hash', (value) => { value.contract.sceneHash = 'd'.repeat(64) }],
      ['source hash', (value) => { value.contract.sourceHash = 'd'.repeat(64) }],
      ['capture hash', (value) => { value.contract.capture.hash = 'd'.repeat(64) }],
      ['capture frame', (value) => { value.contract.frame = 2 }],
      ['capture aspect', (value) => { value.contract.capture.aspect = 1 }],
      ['camera identity', (value) => { value.camera.userData.blendlink_id = 'other-camera' }],
      ['camera matrix', (value) => {
        value.contract.camera.matrixWorld = [...value.contract.camera.matrixWorld]
        value.contract.camera.matrixWorld[12] = 3
      }],
    ]
    for (const [label, mutate] of cases) {
      const value = fixture()
      mutate(value)
      expect(() => installFixture(value), label).toThrow()
      expect(value.surface.material, label).toBe(value.source)
    }
  })

  it('requires exact stable surface bindings and refuses an implicit complete-scene proxy', () => {
    const missing = fixture()
    missing.contract.surfaces[0]!.sourceMaterialId = 'missing-material'
    expect(() => installFixture(missing)).toThrow(/material binding/i)
    expect(missing.surface.material).toBe(missing.source)

    const complete = fixture()
    complete.root.remove(complete.foreground)
    expect(() => installFixture(complete)).toThrow(/complete scene/i)
    expect(complete.surface.material).toBe(complete.source)
  })

  it('refuses dynamic or alpha-composited receivers instead of flattening them', () => {
    const transparent = fixture()
    transparent.source.transparent = true
    transparent.source.opacity = 0.5
    expect(() => installFixture(transparent)).toThrow(/opaque/i)
    expect(transparent.surface.material).toBe(transparent.source)

    const morphed = fixture()
    morphed.surface.morphTargetInfluences = [0]
    expect(() => installFixture(morphed)).toThrow(/morph/i)
    expect(morphed.surface.material).toBe(morphed.source)
  })

  it('does not overwrite material ownership acquired after installation', () => {
    const value = fixture()
    const handle = installFixture(value)
    const laterOwner = new THREE.MeshBasicMaterial({ color: 0x00ff00 })
    value.surface.material = laterOwner
    const laterBeforeRender = vi.fn()
    value.surface.onBeforeRender = laterBeforeRender
    handle.dispose()
    expect(value.surface.material).toBe(laterOwner)
    expect(value.surface.onBeforeRender).toBe(laterBeforeRender)
  })
})
