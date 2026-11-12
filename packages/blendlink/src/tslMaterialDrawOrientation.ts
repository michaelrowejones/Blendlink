import type { Material, Mesh } from 'three'

type DrawCallback = Mesh['onBeforeRender']
type CallbackState = { previous: DrawCallback; disposed: boolean }
const managedCallbacks = new WeakMap<DrawCallback, CallbackState>()

function livePrevious(callback: DrawCallback): DrawCallback {
  let state = managedCallbacks.get(callback)
  while (state?.disposed) {
    callback = state.previous
    state = managedCallbacks.get(callback)
  }
  return callback
}

/** Three r184 keys WebGPU pipelines by winding, but its update predicate
 * misses determinant changes. Invalidate the actual installed draw material
 * once per sign transition; ordinary draws and the WebGL2 backend stay idle. */
export function trackMaterialDrawOrientation(
  mesh: Mesh,
  materials: ReadonlySet<Material>,
): () => void {
  const owned = new Set(materials)
  const signs = new WeakMap<Material, boolean>()
  const state: CallbackState = { previous: mesh.onBeforeRender, disposed: false }
  const beforeRender: DrawCallback = function (this: Mesh, ...args) {
    state.previous.apply(this, args)
    if (state.disposed) return
    const renderer = args[0] as unknown as { backend?: { isWebGPUBackend?: boolean } }
    const material = args[4]
    if (!renderer.backend?.isWebGPUBackend || !owned.has(material)) return
    const determinant = mesh.matrixWorld.determinant()
    // Native geometry validation owns singular/nonfinite transform refusal.
    if (!Number.isFinite(determinant) || determinant === 0) return
    const negative = determinant < 0
    const previous = signs.get(material)
    if (previous !== undefined && previous !== negative) material.needsUpdate = true
    signs.set(material, negative)
  }
  managedCallbacks.set(beforeRender, state)
  mesh.onBeforeRender = beforeRender
  return () => {
    if (state.disposed) return
    state.disposed = true
    owned.clear()
    if (mesh.onBeforeRender === beforeRender) mesh.onBeforeRender = livePrevious(state.previous)
  }
}
