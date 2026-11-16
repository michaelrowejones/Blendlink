import type { Material, Mesh } from 'three'

type ShadowCallback = Mesh['onBeforeShadow']
type CallbackState = { previous: ShadowCallback; disposed: boolean }
const managedCallbacks = new WeakMap<ShadowCallback, CallbackState>()

function livePrevious(callback: ShadowCallback): ShadowCallback {
  let state = managedCallbacks.get(callback)
  while (state?.disposed) {
    callback = state.previous
    state = managedCallbacks.get(callback)
  }
  return callback
}

/** Three r184 temporarily installs each source material's nodes on a shared
 * shadow-pass override, without changing its version. Its RenderObject cache
 * can then retain an object's previous shadow shader after material replacement.
 * Invalidate only the actual renderer-owned override around our masked draws:
 * before handles a previously opaque draw, after handles later stock draws,
 * including after this lease is disposed. No override or renderer is retained. */
export function trackMaterialShadowCache(mesh: Mesh, materials: ReadonlySet<Material>): () => void {
  const owned = new Set(materials)
  const before: CallbackState = { previous: mesh.onBeforeShadow, disposed: false }
  const after: CallbackState = { previous: mesh.onAfterShadow, disposed: false }
  const affected = (args: Parameters<ShadowCallback>): boolean => {
    if (!(args[5] as Material & { isShadowPassMaterial?: boolean })?.isShadowPassMaterial) return false
    const index = (args[6] as unknown as { materialIndex?: number } | null)?.materialIndex
    const source = Array.isArray(mesh.material)
      ? typeof index === 'number' && Number.isInteger(index) ? mesh.material[index] : undefined
      : mesh.material
    return source !== undefined && owned.has(source)
  }
  const beforeShadow: ShadowCallback = function (this: Mesh, ...args) {
    const invalidate = !before.disposed && affected(args)
    before.previous = livePrevious(before.previous)
    before.previous.apply(this, args)
    if (invalidate) args[5].needsUpdate = true
  }
  const afterShadow: ShadowCallback = function (this: Mesh, ...args) {
    // Snapshot before the app callback: disposing the lease during that callback
    // must still invalidate the shadow shader used by the draw that just ended.
    const invalidate = !after.disposed && affected(args)
    after.previous = livePrevious(after.previous)
    try { after.previous.apply(this, args) }
    finally { if (invalidate) args[5].needsUpdate = true }
  }
  managedCallbacks.set(beforeShadow, before)
  managedCallbacks.set(afterShadow, after)
  mesh.onBeforeShadow = beforeShadow
  try { mesh.onAfterShadow = afterShadow }
  catch (error) {
    before.disposed = after.disposed = true
    owned.clear()
    if (mesh.onBeforeShadow === beforeShadow) mesh.onBeforeShadow = livePrevious(before.previous)
    throw error
  }
  return () => {
    if (before.disposed) return
    before.disposed = after.disposed = true
    owned.clear()
    if (mesh.onBeforeShadow === beforeShadow) mesh.onBeforeShadow = livePrevious(before.previous)
    if (mesh.onAfterShadow === afterShadow) mesh.onAfterShadow = livePrevious(after.previous)
  }
}
