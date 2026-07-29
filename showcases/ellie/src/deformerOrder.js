// Probe: how do you express a deformer that runs AFTER skinning in TSL?
//
// docs/character-routes-and-deformation-2026.md section 6a. SkinningNode writes
// positionLocal from inside its own setup(), which StackNode.build appends to
// the tail, so the question is which authoring pattern lands a deformer after
// that write.
//
// METHOD NOTE: each pattern gets its OWN renderer. Sharing one renderer let the
// node-builder cache serve a previously built program for a structurally
// similar material, which showed up as an override that never ran while still
// producing a shader.
import * as THREE from 'three'
import * as WGPU from 'three/webgpu'
import { Fn, nodeObject, positionLocal, vec3, float } from 'three/tsl'
// Node itself is not on the three/webgpu barrel; ./src/* is a public export
// path, and a Node subclass is the only shape whose setup() is guaranteed to
// run when the stack builds (it is what SkinningNode uses).
import Node from 'three/src/nodes/core/Node.js'

const { WebGPURenderer, MeshStandardNodeMaterial } = WGPU

const MARK = { A: 0.135791, B: 0.224466, C: 0.313377, D: 0.402488 }
export const trace = { A: 0, B: 0, C: 0, D: 0, fnBodyA: 0, setupD: 0 }

/** A: an Fn queued after super.setupPosition (the original proposal). */
class PatternA extends MeshStandardNodeMaterial {
  setupPosition(builder) {
    const result = super.setupPosition(builder)
    trace.A += 1
    Fn(() => {
      trace.fnBodyA += 1
      positionLocal.addAssign(vec3(0.0, float(MARK.A), 0.0))
    })().toStack()
    return result
  }
}

/** B: assign straight onto the live stack after super, no Fn wrapper. */
class PatternB extends MeshStandardNodeMaterial {
  setupPosition(builder) {
    const result = super.setupPosition(builder)
    trace.B += 1
    positionLocal.addAssign(vec3(0.0, float(MARK.B), 0.0))
    return result
  }
}

/** C: the documented seam - material.positionNode reading positionLocal. */
function patternC() {
  const material = new MeshStandardNodeMaterial()
  material.positionNode = Fn(() => {
    trace.C += 1
    return positionLocal.add(vec3(0.0, float(MARK.C), 0.0))
  })()
  return material
}

/** D: a real Node subclass whose setup() writes positionLocal - the same
 * shape SkinningNode itself uses, queued after skinning. */
// SkinningNode's setup() RETURNS the skinned position and declares a vec3
// type. A node whose setup yields nothing appears to be dropped before it is
// ever built, so this mirrors SkinningNode exactly.
class DeformNode extends Node {
  constructor() {
    super('vec3')
  }

  setup() {
    trace.setupD += 1
    positionLocal.addAssign(vec3(0.0, float(MARK.D), 0.0))
    return positionLocal
  }
}

class PatternDMaterial extends MeshStandardNodeMaterial {
  setupPosition(builder) {
    const result = super.setupPosition(builder)
    trace.D += 1
    nodeObject(new DeformNode()).toStack()
    return result
  }
}

function patternD() {
  return new PatternDMaterial()
}

function skinnedBox(material) {
  const geometry = new THREE.BoxGeometry(1, 4, 1, 1, 8, 1)
  const count = geometry.attributes.position.count
  const index = []
  const weight = []
  for (let i = 0; i < count; i += 1) {
    const t = Math.min(1, Math.max(0, (geometry.attributes.position.getY(i) + 2) / 4))
    index.push(0, 1, 0, 0)
    weight.push(1 - t, t, 0, 0)
  }
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(index, 4))
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weight, 4))
  const root = new THREE.Bone()
  const tip = new THREE.Bone()
  root.add(tip)
  tip.position.y = 2
  const mesh = new THREE.SkinnedMesh(geometry, material)
  mesh.add(root)
  mesh.bind(new THREE.Skeleton([root, tip]))
  return mesh
}

async function measureOne(name, makeMaterial, forceWebGL) {
  const material = makeMaterial()
  if (!material) return { unavailable: true }
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 64
  const renderer = new WebGPURenderer({ canvas, forceWebGL })
  await renderer.init()
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100)
  camera.position.z = 8
  const scene = new THREE.Scene()
  const mesh = skinnedBox(material)
  scene.add(mesh)

  let vertex = ''
  let error = null
  try {
    const shader = await renderer.debug.getShaderAsync(scene, camera, mesh)
    vertex = shader?.vertexShader ?? ''
  } catch (caught) {
    error = String(caught).slice(0, 160)
  }
  renderer.dispose()
  if (error) return { error }

  const body = vertex.slice(vertex.indexOf(forceWebGL ? 'void main' : 'fn main'))
  const lines = body.split('\n').map((l) => l.trim()).filter(Boolean)
  const skin = lines.findIndex((l) =>
    /positionLocal\s*=/.test(l) && /skinWeight/.test(l))
  const markLine = lines.findIndex((l) => l.includes(String(MARK[name]).slice(0, 7)))
  return {
    emitted: markLine >= 0,
    markLine,
    skinLine: skin,
    skinningPresent: skin >= 0,
    afterSkinning: markLine >= 0 && skin >= 0 && markLine > skin,
    statement: markLine >= 0 ? lines[markLine].slice(0, 140) : null,
    shaderChars: vertex.length,
  }
}

const MAKERS = {
  A: () => new PatternA(),
  B: () => new PatternB(),
  C: patternC,
  D: patternD,
}

const el = document.getElementById('out')
try {
  const results = {}
  for (const forceWebGL of [false, true]) {
    const backend = forceWebGL ? 'webgl2' : 'webgpu'
    results[backend] = {}
    for (const [name, make] of Object.entries(MAKERS)) {
      results[backend][name] = await measureOne(name, make, forceWebGL)
    }
  }
  window.__deformerOrder = { results, trace }
  el.textContent = JSON.stringify({ results, trace }, null, 2)
  const winners = Object.keys(MAKERS).filter((k) =>
    results.webgpu[k]?.afterSkinning)
  console.log('BLENDLINK_DEFORMER_ORDER', winners.length
    ? `post-skin achieved via ${winners.join(',')}`
    : 'NO PATTERN ACHIEVED POST-SKIN DEFORMATION')
} catch (error) {
  window.__deformerOrder = { error: String(error) }
  el.textContent = 'FAILED: ' + String(error)
}
