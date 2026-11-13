import type { Material, Mesh } from 'three'

type DrawCallback = Mesh['onBeforeRender']
type CallbackState = { previous: DrawCallback; disposed: boolean; callback?: DrawCallback }
const managedCallbacks = new WeakMap<DrawCallback, CallbackState>()

function livePrevious(callback: DrawCallback): DrawCallback {
  let state = managedCallbacks.get(callback)
  while (state?.disposed) {
    callback = state.previous
    state = managedCallbacks.get(callback)
  }
  return callback
}

/** Shared managed draw callback chain: source leases can be released out of
 * order, and disposed validation callbacks never retain an active draw path. */
export function trackMaterialDrawCallback(mesh: Mesh, materials: ReadonlySet<Material>, callback: DrawCallback): () => void {
  const owned = new Set(materials)
  const state: CallbackState = { previous: mesh.onBeforeRender, disposed: false, callback }
  const beforeRender: DrawCallback = function (this: Mesh, ...args) {
    state.previous = livePrevious(state.previous)
    state.previous.apply(this, args)
    if (!state.disposed && owned.has(args[4])) state.callback?.apply(this, args)
  }
  managedCallbacks.set(beforeRender, state)
  mesh.onBeforeRender = beforeRender
  return () => {
    if (state.disposed) return
    state.disposed = true
    state.callback = undefined
    owned.clear()
    if (mesh.onBeforeRender === beforeRender) mesh.onBeforeRender = livePrevious(state.previous)
  }
}

/** Three r184 keys WebGPU pipelines by winding, but its update predicate
 * misses determinant changes. Invalidate the actual installed draw material
 * once per sign transition; ordinary draws and the WebGL2 backend stay idle. */
export function trackMaterialDrawOrientation(mesh: Mesh, materials: ReadonlySet<Material>): () => void {
  const signs = new WeakMap<Material, boolean>()
  return trackMaterialDrawCallback(mesh, materials, function (...args) {
    const renderer = args[0] as unknown as { backend?: { isWebGPUBackend?: boolean } }
    const material = args[4]
    if (!renderer.backend?.isWebGPUBackend) return
    const determinant = mesh.matrixWorld.determinant()
    if (!Number.isFinite(determinant) || determinant === 0) return
    const negative = determinant < 0, previous = signs.get(material)
    if (previous !== undefined && previous !== negative) material.needsUpdate = true
    signs.set(material, negative)
  })
}
