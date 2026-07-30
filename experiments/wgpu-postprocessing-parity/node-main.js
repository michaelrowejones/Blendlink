// WGPU-NODE-001 (Phase 4 Track 0): per-effect fixtures for the node-based
// post-processing pipeline (three RenderPipeline + in-tree TSL display nodes
// + n8ao-webgpu), measured on BOTH WebGPURenderer backends — native WebGPU
// and the WebGL2 fallback (forceWebGL) — beside the pinned pmndrs WebGL
// stack as the look-continuity control.  Unlike WGPU-PP-001 (which proved
// the pinned stack constructs 0/13 on WebGPURenderer), this instrument
// measures the REPLACEMENT pipeline the port will ship.
//
// Capture contract: node-pipeline cells render into an explicit RenderTarget
// and read back via readRenderTargetPixelsAsync (the proven
// tsl-node-differential pattern; WebGPU canvases may present-and-clear
// before a drawImage capture).  The WebGL control keeps the WGPU-PP-001
// canvas capture that measured 13/13.  Readback rows are top-down while the
// canvas capture is bottom-up; only orientation-independent stats (mean
// luma, non-background count) are compared across the two capture paths.
import * as THREE from 'three'
import { MeshBasicNodeMaterial, RenderPipeline, WebGPURenderer } from 'three/webgpu'
import { uniform, vec4 as tslVec4 } from 'three/tsl'
import {
  directionToColor,
  emissive,
  mrt,
  normalView,
  output,
  pass,
  renderOutput,
  texture3D,
  vec2,
  vec3,
  vec4,
  velocity,
} from 'three/tsl'
import {
  blendlinkAnisotropicKuwahara,
  blendlinkGeometryAwarePixelation,
  blendlinkRadialChromaticAberration,
  blendlinkTiltShift,
  blendlinkVignette,
} from 'blendlink/three/tsl-effects'
import { ThreeWebgpuPostPipelineService } from '@blendlink-dist/threeWebgpuPostPipeline.js'
import { bloom } from 'three/addons/tsl/display/BloomNode.js'
import { chromaticAberration } from 'three/addons/tsl/display/ChromaticAberrationNode.js'
import { pixelationPass } from 'three/addons/tsl/display/PixelationPassNode.js'
import { outline } from 'three/addons/tsl/display/OutlineNode.js'
import { lut3D } from 'three/addons/tsl/display/Lut3DNode.js'
import { dof } from 'three/addons/tsl/display/DepthOfFieldNode.js'
import { traa } from 'three/addons/tsl/display/TRAANode.js'
import { fxaa } from 'three/addons/tsl/display/FXAANode.js'
import { smaa } from 'three/addons/tsl/display/SMAANode.js'
import {
  BloomEffect,
  ChromaticAberrationEffect,
  DepthOfFieldEffect,
  Effect,
  EffectComposer,
  EffectPass,
  LookupTexture,
  LUT3DEffect,
  OutlineEffect,
  PixelationEffect,
  RenderPass,
  SelectiveBloomEffect,
  TiltShiftEffect,
  ToneMappingEffect,
  VignetteEffect,
} from 'postprocessing'
import { N8AOPostPass } from 'n8ao'
import { createN8AOScenePass, N8AONode } from 'n8ao-webgpu'

const SIZE = 384
// Temporal/warm-up passes (TRAA accumulation, N8AO history) get identical
// repeated frames before capture; the scene is static so every non-temporal
// cell is idempotent under repetition.
const WARMUP_FRAMES = 3

function deterministicScene() {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x202830)
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 50)
  camera.position.set(2.4, 1.8, 3.2)
  camera.lookAt(0, 0.4, 0)

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(8, 8),
    new THREE.MeshStandardMaterial({ color: 0x777f88, roughness: 0.9 }),
  )
  floor.rotation.x = -Math.PI / 2
  scene.add(floor)

  const sphere = new THREE.Mesh(
    new THREE.SphereGeometry(0.6, 48, 32),
    new THREE.MeshStandardMaterial({
      color: 0xcc5533, metalness: 0.8, roughness: 0.25,
    }),
  )
  sphere.position.set(-0.7, 0.6, 0)
  scene.add(sphere)

  const box = new THREE.Mesh(
    new THREE.BoxGeometry(0.8, 0.8, 0.8),
    new THREE.MeshStandardMaterial({ color: 0x3366aa, roughness: 0.6 }),
  )
  box.position.set(0.8, 0.4, 0.3)
  box.rotation.y = 0.6
  scene.add(box)

  // Emissive standard material (the WGPU-PP-001 scene used MeshBasicMaterial
  // here): the selective-bloom node route selects subjects through the
  // emissive MRT target, so the fixture needs a genuinely emissive surface.
  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(0.7, 0.7),
    new THREE.MeshStandardMaterial({
      color: 0x000000, emissive: 0xffe0a0, emissiveIntensity: 2,
    }),
  )
  glow.position.set(0, 1.2, -1.2)
  scene.add(glow)

  const key = new THREE.DirectionalLight(0xffffff, 2.4)
  key.position.set(3, 5, 2)
  scene.add(key)
  scene.add(new THREE.AmbientLight(0x404050, 0.8))
  return { scene, camera, sphere, box, glow }
}

class ProbeEffect extends Effect {
  constructor() {
    super(
      'BlendlinkProbeEffect',
      'void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {' +
      '  outputColor = vec4(1.0 - inputColor.rgb, inputColor.a);' +
      '}',
    )
  }
}

function controlFactories(context) {
  const { scene, camera, sphere, glow } = context
  return {
    'render-pass-only': () => [],
    'tone-mapping': () => [new ToneMappingEffect()],
    bloom: () => [new BloomEffect({ intensity: 1.2 })],
    'selective-bloom': () => {
      const effect = new SelectiveBloomEffect(scene, camera, { intensity: 1.5 })
      effect.selection.add(glow)
      return [effect]
    },
    vignette: () => [new VignetteEffect({ darkness: 0.6 })],
    'chromatic-aberration': () => [new ChromaticAberrationEffect({
      offset: new THREE.Vector2(0.004, 0.002),
      radialModulation: false,
      modulationOffset: 0,
    })],
    pixelation: () => [new PixelationEffect(6)],
    'tilt-shift': () => [new TiltShiftEffect({ focusArea: 0.3 })],
    outline: () => {
      const effect = new OutlineEffect(scene, camera, { edgeStrength: 3 })
      effect.selection.add(sphere)
      return [effect]
    },
    lut3d: () => [new LUT3DEffect(LookupTexture.createNeutral(32))],
    'depth-of-field': () => [new DepthOfFieldEffect(camera, {
      focusDistance: 0.02, focalLength: 0.05, bokehScale: 2,
    })],
    'custom-effect': () => [new ProbeEffect()],
  }
}

function neutralLut(size) {
  const data = new Uint8Array(size * size * size * 4)
  let index = 0
  for (let b = 0; b < size; b += 1) {
    for (let g = 0; g < size; g += 1) {
      for (let r = 0; r < size; r += 1) {
        data[index] = Math.round((r * 255) / (size - 1))
        data[index + 1] = Math.round((g * 255) / (size - 1))
        data[index + 2] = Math.round((b * 255) / (size - 1))
        data[index + 3] = 255
        index += 4
      }
    }
  }
  const lut = new THREE.Data3DTexture(data, size, size, size)
  lut.format = THREE.RGBAFormat
  lut.type = THREE.UnsignedByteType
  lut.minFilter = THREE.LinearFilter
  lut.magFilter = THREE.LinearFilter
  lut.wrapS = THREE.ClampToEdgeWrapping
  lut.wrapT = THREE.ClampToEdgeWrapping
  lut.wrapR = THREE.ClampToEdgeWrapping
  lut.needsUpdate = true
  return lut
}

// Each cell mirrors one production ThreePostPipelineService configuration on
// the node pipeline.  A cell returns { outputNode, outputColorTransform?,
// disposables? }; RenderPipeline applies the default output transform unless
// the cell composes renderOutput() itself.
function nodeCells(context) {
  const { scene, camera, sphere } = context
  return {
    'render-pass-only': () => ({ outputNode: pass(scene, camera) }),
    'tone-mapping': () => {
      const scenePass = pass(scene, camera)
      return {
        outputNode: renderOutput(scenePass),
        outputColorTransform: false,
      }
    },
    bloom: () => {
      const scenePass = pass(scene, camera)
      const color = scenePass.getTextureNode()
      return { outputNode: color.add(bloom(color, 1.2)) }
    },
    'selective-bloom': () => {
      const scenePass = pass(scene, camera)
      scenePass.setMRT(mrt({ output, emissive }))
      const color = scenePass.getTextureNode()
      const emissiveColor = scenePass.getTextureNode('emissive')
      return { outputNode: color.add(bloom(emissiveColor, 1.5)) }
    },
    'chromatic-aberration': () => {
      const scenePass = pass(scene, camera)
      // The helper's default center=null is broken upstream in r184: the
      // docstring promises screen center but setup() forwards the null into
      // a declared vec2 parameter, producing black.  Pass it explicitly.
      return {
        outputNode: chromaticAberration(
          scenePass.getTextureNode(), 1.0, vec2(0.5, 0.5), 1.1,
        ),
      }
    },
    pixelation: () => ({
      outputNode: pixelationPass(scene, camera, 6, 0.3, 0.3),
    }),
    outline: () => {
      const scenePass = pass(scene, camera)
      const outlinePass = outline(scene, camera, {
        selectedObjects: [sphere], edgeThickness: 1, edgeGlow: 0,
      })
      const { visibleEdge, hiddenEdge } = outlinePass
      const edgeColor = visibleEdge.mul(vec3(1, 1, 1))
        .add(hiddenEdge.mul(vec3(0.3, 0.2, 0.2))).mul(3)
      return {
        outputNode: edgeColor.add(scenePass.getTextureNode()),
        disposables: [outlinePass],
      }
    },
    lut3d: () => {
      const lut = neutralLut(32)
      const scenePass = pass(scene, camera)
      return {
        outputNode: lut3D(scenePass.getTextureNode(), texture3D(lut), 32, 1),
        disposables: [lut],
      }
    },
    'depth-of-field': () => {
      const scenePass = pass(scene, camera)
      return {
        outputNode: dof(
          scenePass.getTextureNode(), scenePass.getViewZNode(), 4.2, 3.5, 3,
        ),
      }
    },
    'custom-effect': () => {
      const scenePass = pass(scene, camera)
      const color = scenePass.getTextureNode()
      return { outputNode: vec4(color.rgb.oneMinus(), color.a) }
    },
    n8ao: () => {
      const scenePass = createN8AOScenePass(scene, camera)
      const node = new N8AONode({
        beautyNode: scenePass.getTextureNode('output'),
        beautyTexture: scenePass.getTexture('output'),
        depthNode: scenePass.getTextureNode('depth'),
        depthTexture: scenePass.getTexture('depth'),
        normalNode: scenePass.getTextureNode('normal'),
        normalTexture: scenePass.getTexture('normal'),
        scenePassNode: scenePass,
        scene,
        camera,
      })
      return { outputNode: node.getTextureNode(), disposables: [node] }
    },
    traa: () => {
      const scenePass = pass(scene, camera)
      scenePass.setMRT(mrt({ output, velocity }))
      return {
        outputNode: traa(
          scenePass.getTextureNode(),
          scenePass.getTextureNode('depth'),
          scenePass.getTextureNode('velocity'),
          camera,
        ),
      }
    },
    fxaa: () => {
      const scenePass = pass(scene, camera)
      return {
        outputNode: fxaa(renderOutput(scenePass)),
        outputColorTransform: false,
      }
    },
    smaa: () => {
      const scenePass = pass(scene, camera)
      return {
        outputNode: smaa(renderOutput(scenePass)),
        outputColorTransform: false,
      }
    },
    // The five Blendlink-owned nodes (blendlink/three/tsl-effects), each
    // mirroring the shipped GLSL math from threeComponents.ts.
    vignette: () => {
      const scenePass = pass(scene, camera)
      return {
        outputNode: blendlinkVignette(scenePass.getTextureNode(), {
          intensity: 0.6, softness: 0.55,
        }),
      }
    },
    'tilt-shift': () => {
      const scenePass = pass(scene, camera)
      return {
        outputNode: blendlinkTiltShift(scenePass.getTextureNode(), {
          feather: 0.25, strength: 0.7,
        }),
      }
    },
    kuwahara: () => {
      const scenePass = pass(scene, camera)
      return {
        outputNode: blendlinkAnisotropicKuwahara(scenePass.getTextureNode(), {
          brushScale: 4, strength: 0.75,
        }),
      }
    },
    'radial-chromatic-aberration': () => {
      const scenePass = pass(scene, camera)
      return {
        outputNode: blendlinkRadialChromaticAberration(
          scenePass.getTextureNode(), { amount: 0.004 },
        ),
      }
    },
    'geometry-pixelation': () => {
      const scenePass = pass(scene, camera)
      scenePass.setMRT(mrt({
        output,
        normal: directionToColor(normalView),
      }))
      return {
        outputNode: blendlinkGeometryAwarePixelation({
          color: scenePass.getTextureNode(),
          depth: scenePass.getTextureNode('depth'),
          normal: scenePass.getTextureNode('normal'),
          camera,
        }, {
          pixelSize: 6, depthEdgeStrength: 1, normalEdgeStrength: 1,
        }),
      }
    },
  }
}

// Formerly the pendingTrackB list: every Blendlink-owned display node now
// has a measured cell above.  The empty list stays so the run.mjs honesty
// check (a pending id must never also have a cell) keeps its seam.
const PENDING_TRACK_B = []

// Browser truth for the production service: each cell drives the BUILT
// ThreeWebgpuPostPipelineService through its full lifecycle (create →
// addEffect per descriptor → finalize → activate → render) — the unit
// suite proves the plumbing, only this compiles the shaders.
const SERVICE_CELLS = {
  'service-baseline': { components: [], expectedOrder: ['scene-color'] },
  'service-full': {
    components: [
      {
        id: 'bloom-1', type: 'blendlink.bloom', phase: 'post-hdr',
        values: { intensity: 1.2, threshold: 0.8, radius: 0.4, mode: 'bright-pixels' },
      },
      {
        id: 'sharpen-1', type: 'blendlink.sharpen', phase: 'post-ldr',
        values: { amount: 0.5 },
      },
      {
        id: 'vignette-1', type: 'blendlink.vignette', phase: 'post-ldr',
        values: { intensity: 0.6, softness: 0.55, color: [0, 0, 0] },
      },
    ],
    expectedOrder: [
      'scene-color', 'temporal-antialiasing', 'bloom-1', 'sharpen-1', 'vignette-1',
    ],
  },
  'service-ao-outline': {
    components: [
      {
        id: 'ao-1', type: 'blendlink.ambient-occlusion', phase: 'post-hdr',
        values: { radiusMode: 'world', worldRadius: 1, intensity: 2, color: [0, 0, 0] },
      },
      {
        id: 'outline-1', type: 'blendlink.outline', phase: 'post-hdr',
        values: {
          thickness: 1, strength: 3,
          visibleColor: [1, 1, 1], hiddenColor: [0.3, 0.2, 0.2], xRay: false,
        },
      },
    ],
    expectedOrder: [
      'scene-color', 'temporal-antialiasing', 'ao-1', 'outline-1', 'post-edge-antialiasing',
    ],
  },
  'service-pixelation': {
    components: [
      {
        id: 'pixelation-1', type: 'blendlink.pixelation', phase: 'post-ldr',
        values: { pixelSize: 6, depthEdgeStrength: 1, normalEdgeStrength: 1 },
      },
    ],
    // Intentional pixelation suppresses the TRAA default.
    expectedOrder: ['scene-color', 'pixelation-1'],
  },
  'service-dof-grading': {
    components: [
      {
        id: 'dof-1', type: 'blendlink.depth-of-field', phase: 'post-hdr',
        values: {
          focusMode: 'distance', focusDistance: 4.2, focusRange: 1, blurStrength: 3,
        },
      },
      {
        id: 'grade-1', type: 'blendlink.color-grading', phase: 'post-ldr',
        // The page supplies loadLut (an inverting 32-cube), so the URL is
        // identity only.
        values: { lutUrl: 'https://fixtures.invalid/invert.cube', intensity: 1 },
      },
    ],
    loadLut: true,
    expectedOrder: ['scene-color', 'temporal-antialiasing', 'dof-1', 'grade-1'],
  },
}

function invertedLut(size) {
  const lut = neutralLut(size)
  const data = lut.image.data
  for (let index = 0; index < data.length; index += 4) {
    data[index] = 255 - data[index]
    data[index + 1] = 255 - data[index + 1]
    data[index + 2] = 255 - data[index + 2]
  }
  lut.needsUpdate = true
  return lut
}

window.__wgpuServiceCell = async (backendId, cellId) => {
  const entry = state.node[backendId]
  if (!entry) return { ok: false, phase: 'construct-renderer' }
  const config = SERVICE_CELLS[cellId]
  if (!config) return { ok: false, phase: 'unknown-cell', error: cellId }
  const { renderer } = entry
  const context = entry.context
  let phase = 'create-service'
  let service = null
  let target = null
  try {
    const options = {
      renderer,
      scene: context.scene,
      camera: context.camera,
      root: context.scene,
      bindings: { byId: {}, byName: {} },
      components: config.components.map((component) => ({
        id: component.id, type: component.type, enabled: true, values: component.values,
      })),
      ...(config.loadLut ? { loadLut: async () => invertedLut(32) } : {}),
    }
    service = await ThreeWebgpuPostPipelineService.create(options)
    phase = 'add-effects'
    for (const component of config.components) {
      await service.addEffect({
        id: component.id,
        type: component.type,
        phase: component.phase,
        values: component.values,
      })
    }
    phase = 'finalize'
    service.finalize()
    if (JSON.stringify(service.resolvedOrder) !== JSON.stringify(config.expectedOrder)) {
      throw new Error(
        `resolvedOrder ${JSON.stringify(service.resolvedOrder)} != expected ${JSON.stringify(config.expectedOrder)}`,
      )
    }
    phase = 'activate'
    service.activate(context.scene, context.camera)
    phase = 'render'
    target = new THREE.RenderTarget(SIZE, SIZE, { type: THREE.UnsignedByteType })
    renderer.setRenderTarget(target)
    for (let frame = 0; frame < WARMUP_FRAMES; frame += 1) service.render(1 / 60)
    renderer.setRenderTarget(null)
    phase = 'readback'
    const data = await renderer.readRenderTargetPixelsAsync(target, 0, 0, SIZE, SIZE)
    const pixels = await statsFromRgba(data)
    return {
      ok: true,
      pixels,
      resolvedOrder: [...service.resolvedOrder],
      postEdgeAntialiasing: service.postEdgeAntialiasing,
      antialiasingSamples: service.multisampling,
    }
  } catch (error) {
    return {
      ok: false,
      phase,
      error: `${error?.name ?? 'Error'}: ${error?.message ?? error}`,
    }
  } finally {
    try {
      renderer.setRenderTarget(null)
      target?.dispose()
      service?.dispose()
    } catch {
      // The recorded failure above is the evidence; cleanup of a half-built
      // service may itself fail.
    }
  }
}

window.__wgpuServiceCellIds = () => Object.keys(SERVICE_CELLS)

// Track C ground truth: the BUILT tslMaterialRuntime applied to the real
// compiled cube-diorama GLB + published programs sidecar.  The gate is
// end-to-end: extras identity resolves on GLTFLoader output, the programs
// fetch + hash-verify over real HTTP, the node materials compile and
// render on this backend, and the swap visibly changes pixels.
window.__wgpuRuntimeCell = async (backendId, config) => {
  const entry = state.node[backendId]
  if (!entry) return { ok: false, phase: 'construct-renderer' }
  const { renderer } = entry
  let phase = 'load-glb'
  let installed = null
  let target = null
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x202830)
  try {
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js')
    const { MeshoptDecoder } = await import('three/addons/libs/meshopt_decoder.module.js')
    const loader = new GLTFLoader()
    loader.setMeshoptDecoder(MeshoptDecoder)
    const gltf = await loader.loadAsync(config.glbUrl)
    scene.add(gltf.scene)
    const key = new THREE.DirectionalLight(0xffffff, 2.4)
    key.position.set(3, 5, 2)
    scene.add(key, new THREE.AmbientLight(0x404050, 1.2))
    const sphere = new THREE.Box3().setFromObject(gltf.scene)
      .getBoundingSphere(new THREE.Sphere())
    const camera = new THREE.PerspectiveCamera(45, 1, sphere.radius / 100, sphere.radius * 10)
    camera.position.copy(sphere.center)
      .add(new THREE.Vector3(1, 0.8, 1).normalize().multiplyScalar(sphere.radius * 2.2))
    camera.lookAt(sphere.center)

    target = new THREE.RenderTarget(SIZE, SIZE, { type: THREE.UnsignedByteType })
    const capture = async () => {
      renderer.setRenderTarget(target)
      renderer.render(scene, camera)
      renderer.setRenderTarget(null)
      const data = await renderer.readRenderTargetPixelsAsync(target, 0, 0, SIZE, SIZE)
      return statsFromRgba(data)
    }
    phase = 'render-before'
    const before = await capture()
    phase = 'fetch-programs'
    const response = await fetch(config.programsUrl)
    if (!response.ok) throw new Error(`programs fetch ${response.status}`)
    const payload = new Uint8Array(await response.arrayBuffer())
    const digest = await crypto.subtle.digest(
      'SHA-256',
      payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength),
    )
    const hash = [...new Uint8Array(digest)]
      .map((item) => item.toString(16).padStart(2, '0')).join('').slice(0, 16)
    phase = 'install'
    // eslint-disable-next-line no-var
    var { installTslMaterials } = await import('@blendlink-dist/tslMaterialRuntime.js')
    installed = await installTslMaterials({
      root: gltf.scene,
      descriptor: {
        materialPrograms: {
          url: config.programsUrl,
          bytes: payload.byteLength,
          hash,
          materials: 0,
        },
      },
    })
    phase = 'render-after'
    const after = await capture()
    const shipped = {
      materials: installed.materials,
      applied: installed.applied,
      skipped: installed.skipped,
    }
    // Liveness is proven with a PERTURBED program, not by demanding the
    // shipped programs differ from their carriers: the diorama's six
    // programs are all constants, and a constant program that equals its
    // carrier's factors renders byte-identically -- which is correctness,
    // not deadness (the earlier "4.82 vs 4.75" delta this cell used to
    // ride was a runtime inexactness that has since been fixed). Override
    // every Base Color with a distinctive red; if THAT render matches the
    // carrier render, the install pipeline is provably not reaching
    // pixels.
    phase = 'perturbed-install'
    installed.dispose()
    installed = null
    const document = JSON.parse(new TextDecoder().decode(payload))
    for (const material of Object.values(document.materials)) {
      material.channels['Base Color'] = {
        tslIr: {
          schemaVersion: 1,
          model: 'blendlink-tsl-ir-v1',
          output: { op: 'const_vec3', value: [1, 0, 0] },
        },
      }
    }
    installed = await installTslMaterials({
      root: gltf.scene,
      descriptor: {
        materialPrograms: {
          url: config.programsUrl,
          bytes: payload.byteLength,
          hash,
          materials: 0,
        },
      },
      loadPrograms: async () => document,
    })
    phase = 'render-perturbed'
    const perturbed = await capture()
    return {
      ok: true,
      before,
      after,
      perturbed,
      ...shipped,
      perturbedApplied: installed.applied,
    }
  } catch (error) {
    return {
      ok: false,
      phase,
      error: `${error?.name ?? 'Error'}: ${error?.message ?? error}`,
    }
  } finally {
    try {
      renderer.setRenderTarget(null)
      installed?.dispose()
      target?.dispose()
    } catch {
      // The recorded failure above is the evidence.
    }
  }
}

// 8b.4: the load-bearing skinning invariant. Install a program clone onto
// a SkinnedMesh carrying a morph target and prove the generated VERTEX
// shader still contains the skinning and morph statements. A clone whose
// null-slot restore missed vertexNode would bypass setupPosition -- where
// morphReference and skinning are stacked -- and the character would
// render at bind pose under a perfectly plausible surface. Vitest cannot
// see this (no backend, no shader text); only getShaderAsync can, and only
// on the native backend (the WebGL2 backend returned nothing usable for
// shader text when measured for plan-doc section 6a).
window.__wgpuSkinningCell = async (backendId, config) => {
  const entry = state.node[backendId]
  if (!entry) return { ok: false, phase: 'construct-renderer' }
  const { renderer } = entry
  let phase = 'load-glb'
  let installed = null
  const scene = new THREE.Scene()
  try {
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js')
    const loader = new GLTFLoader()
    const gltf = await loader.loadAsync(config.glbUrl)
    scene.add(gltf.scene)
    scene.add(new THREE.AmbientLight(0xffffff, 1))
    phase = 'find-skinned-mesh'
    let skinned = null
    gltf.scene.traverse((object) => {
      if (object.isSkinnedMesh && !skinned) skinned = object
    })
    if (!skinned) throw new Error('fixture has no SkinnedMesh')
    const morphCount = skinned.geometry.morphAttributes.position?.length ?? 0
    phase = 'install'
    const material = Array.isArray(skinned.material)
      ? skinned.material[0]
      : skinned.material
    material.userData.blendlink_source_material = 'SkinningFixture'
    const { installTslMaterials } = await import('@blendlink-dist/tslMaterialRuntime.js')
    installed = await installTslMaterials({
      root: gltf.scene,
      descriptor: {
        materialPrograms: {
          url: 'synthetic://skinning', bytes: 0, hash: '0', materials: 1,
        },
      },
      loadPrograms: async () => ({
        schemaVersion: 1,
        model: 'blendlink-material-programs-v1',
        materials: {
          SkinningFixture: {
            channels: {
              'Base Color': {
                tslIr: {
                  schemaVersion: 1,
                  model: 'blendlink-tsl-ir-v1',
                  output: { op: 'separate', channel: 'x', input: { op: 'uv' } },
                },
              },
            },
          },
        },
      }),
    })
    if (installed.applied < 1) {
      throw new Error(
        `program did not install: skipped=${JSON.stringify(installed.skipped)}`,
      )
    }
    phase = 'get-shader'
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100)
    camera.position.set(0, 1, 4)
    camera.lookAt(0, 0.5, 0)
    const shaders = await renderer.debug.getShaderAsync(scene, camera, skinned)
    const vertex = String(shaders?.vertexShader ?? '')
    const markers = {
      skinIndex: vertex.includes('skinIndex'),
      skinWeight: vertex.includes('skinWeight'),
      // Morphs never say "morph" in generated WGSL: the target table
      // compiles to a vertex-stage texture_2d_array sample (measured on
      // this fixture -- nodeUniform : texture_2d_array<f32> plus a
      // mangled influence uniform). The array texture IS the signature;
      // nothing else binds one in the vertex stage of this material.
      morph: vertex.includes('texture_2d_array'),
    }
    const healthy = markers.skinIndex && markers.skinWeight
      && (morphCount === 0 || markers.morph)
    return {
      ok: true,
      applied: installed.applied,
      morphCount,
      markers,
      vertexBytes: vertex.length,
      // Failure diagnosis only: localize what the shader actually holds.
      snippet: healthy ? null : vertex.slice(0, 2000),
    }
  } catch (error) {
    return {
      ok: false,
      phase,
      error: `${error?.name ?? 'Error'}: ${error?.message ?? error}`,
    }
  } finally {
    try {
      installed?.dispose()
    } catch {
      // The recorded failure above is the evidence.
    }
  }
}

async function statsFromRgba(data) {
  let sum = 0
  let nonBackground = 0
  let nonFinite = 0
  for (let index = 0; index < data.length; index += 4) {
    const r = data[index]
    const g = data[index + 1]
    const b = data[index + 2]
    if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) {
      nonFinite += 1
      continue
    }
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b
    sum += luma
    if (luma > 8) nonBackground += 1
  }
  const digest = await crypto.subtle.digest(
    'SHA-256', data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
  )
  return {
    meanLuma: sum / (data.length / 4),
    nonBackgroundPixels: nonBackground,
    nonFinitePixels: nonFinite,
    sha256: [...new Uint8Array(digest)]
      .map((item) => item.toString(16).padStart(2, '0')).join(''),
  }
}

async function captureCanvas(canvas) {
  const staging = document.createElement('canvas')
  staging.width = canvas.width
  staging.height = canvas.height
  const context = staging.getContext('2d')
  context.drawImage(canvas, 0, 0)
  const data = context.getImageData(0, 0, canvas.width, canvas.height).data
  return statsFromRgba(data)
}

const state = {
  ready: false,
  environment: null,
  control: null,
  node: {},
}

window.__wgpuNodeInit = async () => {
  const environment = {
    threeRevision: THREE.REVISION,
    webgpuAvailable: Boolean(navigator.gpu),
    adapter: null,
    backends: {},
  }
  if (navigator.gpu) {
    try {
      const adapter = await navigator.gpu.requestAdapter()
      if (adapter) {
        const info = adapter.info ?? {}
        environment.adapter = {
          vendor: info.vendor ?? null,
          architecture: info.architecture ?? null,
          device: info.device ?? null,
          description: info.description ?? null,
        }
      }
    } catch (error) {
      environment.adapter = { error: String(error) }
    }
  }

  try {
    const canvas = document.createElement('canvas')
    canvas.width = SIZE
    canvas.height = SIZE
    document.body.appendChild(canvas)
    const renderer = new THREE.WebGLRenderer({
      canvas, antialias: false, preserveDrawingBuffer: true,
    })
    renderer.setSize(SIZE, SIZE, false)
    renderer.setPixelRatio(1)
    state.control = { renderer, context: deterministicScene() }
    environment.backends.control = { constructed: true }
  } catch (error) {
    environment.backends.control = {
      constructed: false,
      error: `${error?.name ?? 'Error'}: ${error?.message ?? error}`,
    }
  }

  for (const backendId of ['native', 'fallback']) {
    try {
      const canvas = document.createElement('canvas')
      canvas.width = SIZE
      canvas.height = SIZE
      document.body.appendChild(canvas)
      const renderer = new WebGPURenderer({
        canvas, antialias: false, forceWebGL: backendId === 'fallback',
      })
      renderer.setSize(SIZE, SIZE, false)
      renderer.setPixelRatio(1)
      await renderer.init()
      state.node[backendId] = { renderer, context: deterministicScene() }
      environment.backends[backendId] = {
        constructed: true,
        isWebGPUBackend: Boolean(renderer.backend?.isWebGPUBackend),
      }
    } catch (error) {
      environment.backends[backendId] = {
        constructed: false,
        error: `${error?.name ?? 'Error'}: ${error?.message ?? error}`,
      }
    }
  }
  state.environment = environment
  state.ready = true
  return environment
}

window.__wgpuNodeControl = async (effectId) => {
  const entry = state.control
  if (!entry) return { ok: false, phase: 'construct-renderer' }
  let phase = 'construct-composer'
  let composer = null
  try {
    composer = new EffectComposer(entry.renderer)
    composer.setSize(SIZE, SIZE)
    composer.addPass(new RenderPass(entry.context.scene, entry.context.camera))
    phase = 'construct-effect'
    if (effectId === 'n8ao') {
      composer.addPass(new N8AOPostPass(
        entry.context.scene, entry.context.camera, SIZE, SIZE,
      ))
    } else {
      const factory = controlFactories(entry.context)[effectId]
      if (!factory) throw new Error(`unknown control effect ${effectId}`)
      const effects = factory()
      if (effects.length > 0) {
        composer.addPass(new EffectPass(entry.context.camera, ...effects))
      }
    }
    phase = 'render'
    for (let frame = 0; frame < WARMUP_FRAMES; frame += 1) {
      composer.render(1 / 60)
    }
    const pixels = await captureCanvas(entry.renderer.domElement)
    return { ok: true, pixels }
  } catch (error) {
    return {
      ok: false,
      phase,
      error: `${error?.name ?? 'Error'}: ${error?.message ?? error}`,
    }
  } finally {
    try {
      composer?.dispose()
    } catch {
      // A failed construction may also fail to dispose; the measured failure
      // above is the evidence that matters.
    }
  }
}

window.__wgpuNodeEffect = async (backendId, effectId) => {
  const entry = state.node[backendId]
  if (!entry) return { ok: false, phase: 'construct-renderer' }
  const { renderer } = entry
  let phase = 'construct-node'
  let pipeline = null
  let target = null
  let disposables = []
  try {
    const factory = nodeCells(entry.context)[effectId]
    if (!factory) throw new Error(`unknown node cell ${effectId}`)
    const built = factory()
    disposables = built.disposables ?? []
    phase = 'construct-pipeline'
    pipeline = new RenderPipeline(renderer, built.outputNode)
    if (built.outputColorTransform === false) {
      pipeline.outputColorTransform = false
    }
    phase = 'render'
    // Default (no) color space: the pipeline's renderOutput already encodes
    // sRGB in-shader; an SRGBColorSpace target would make the hardware
    // encode AGAIN on write (measured: baseline mean luma 144 vs the
    // control's 79 — a classic double-encode wash-out).
    target = new THREE.RenderTarget(SIZE, SIZE, {
      type: THREE.UnsignedByteType,
    })
    renderer.setRenderTarget(target)
    for (let frame = 0; frame < WARMUP_FRAMES; frame += 1) {
      pipeline.render()
    }
    renderer.setRenderTarget(null)
    phase = 'readback'
    const data = await renderer.readRenderTargetPixelsAsync(
      target, 0, 0, SIZE, SIZE,
    )
    const pixels = await statsFromRgba(data)
    return { ok: true, pixels }
  } catch (error) {
    return {
      ok: false,
      phase,
      error: `${error?.name ?? 'Error'}: ${error?.message ?? error}`,
    }
  } finally {
    try {
      renderer.setRenderTarget(null)
      target?.dispose()
      for (const item of disposables) item?.dispose?.()
      pipeline?.dispose()
    } catch {
      // Same contract as the control path: the recorded failure is the
      // evidence; cleanup of a half-built pipeline may itself fail.
    }
  }
}

window.__wgpuNodeIds = () => {
  const context = state.node.native?.context
    ?? state.node.fallback?.context ?? state.control?.context
  return {
    control: [...Object.keys(controlFactories(context)), 'n8ao'],
    node: Object.keys(nodeCells(context)),
    pendingTrackB: PENDING_TRACK_B,
  }
}

window.__wgpuNodeReady = () => state.ready

// Track C proof cell: does uniform().onObjectUpdate deliver PER-OBJECT
// values through one shared node material on three 0.184?  Two quads share
// one MeshBasicNodeMaterial whose red channel reads the rendering object's
// userData; distinct halves prove the contract and lift the per-mesh
// material fork for generated/object_coords populations.
window.__wgpuObjectUniformProbe = async (backendId) => {
  const entry = state.node[backendId]
  if (!entry) return { ok: false, phase: 'construct-renderer' }
  const { renderer } = entry
  let phase = 'construct'
  let target = null
  const scene = new THREE.Scene()
  try {
    const perObject = uniform(0)
    perObject.onObjectUpdate(({ object }) => object.userData.blendlinkProbeValue ?? 0)
    const material = new MeshBasicNodeMaterial()
    material.colorNode = tslVec4(perObject, 0, 0, 1)
    const geometry = new THREE.PlaneGeometry(1, 2)
    const left = new THREE.Mesh(geometry, material)
    left.position.x = -0.5
    left.userData.blendlinkProbeValue = 0.25
    const right = new THREE.Mesh(geometry, material)
    right.position.x = 0.5
    right.userData.blendlinkProbeValue = 0.75
    scene.add(left, right)
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10)
    camera.position.z = 2
    phase = 'render'
    target = new THREE.RenderTarget(SIZE, SIZE, { type: THREE.UnsignedByteType })
    renderer.setRenderTarget(target)
    renderer.render(scene, camera)
    renderer.setRenderTarget(null)
    phase = 'readback'
    const data = await renderer.readRenderTargetPixelsAsync(target, 0, 0, SIZE, SIZE)
    const mid = Math.floor(SIZE / 2)
    const sample = (x) => data[(mid * SIZE + x) * 4] / 255
    const leftRed = sample(Math.floor(SIZE * 0.25))
    const rightRed = sample(Math.floor(SIZE * 0.75))
    return { ok: true, leftRed, rightRed }
  } catch (error) {
    return {
      ok: false,
      phase,
      error: `${error?.name ?? 'Error'}: ${error?.message ?? error}`,
    }
  } finally {
    try {
      renderer.setRenderTarget(null)
      target?.dispose()
    } catch {
      // The recorded failure above is the evidence.
    }
  }
}
