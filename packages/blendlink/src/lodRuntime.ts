import {
  type LodChainDiagnostic,
} from './sceneDiagnostics.js'
import {
  resolveRuntimeSceneDiagnostics,
  type RuntimeSceneDiagnosticsDescriptor,
} from './runtimeDiagnostics.js'
import type { DeepReadonly } from './runtime.js'

export interface LodObjectLike {
  name: string
  userData?: Record<string, unknown>
  visible?: boolean
  children?: LodObjectLike[]
  traverse?(visitor: (object: LodObjectLike) => void): void
  getWorldPosition?(target: LodVectorLike): LodVectorLike
}

export interface LodVectorLike {
  distanceTo(other: LodVectorLike): number
}

export interface LodCompiledDescriptor extends RuntimeSceneDiagnosticsDescriptor {}

export interface CompiledSceneLodOptions {
  /** Supply `() => new THREE.Vector3()` for native Three Object3D cameras. */
  createVector3(): LodVectorLike
  /** Fractional dead band around each threshold. Default 0.05 (5%). */
  hysteresis?: number
}

export interface CompiledSceneLods {
  active: Record<string, number>
  update(): void
  /** Restore every level's visibility from before Blendlink took ownership. */
  stop(): void
}

function visit(root: LodObjectLike, visitor: (object: LodObjectLike) => void): void {
  if (root.traverse) {
    root.traverse(visitor)
    return
  }
  visitor(root)
  for (const child of root.children ?? []) visit(child, visitor)
}

function byName(root: LodObjectLike): Map<string, LodObjectLike> {
  const objects = new Map<string, LodObjectLike>()
  visit(root, (object) => objects.set(object.name, object))
  return objects
}

function byStableId(root: LodObjectLike): Map<string, LodObjectLike> {
  const objects = new Map<string, LodObjectLike>()
  visit(root, (object) => {
    const id = object.userData?.blendlink_id
    if (typeof id !== 'string') return
    if (objects.has(id)) throw new Error(`Blendlink LOD binding found duplicate stable object ID ${id}.`)
    objects.set(id, object)
  })
  return objects
}

function selectedLevel(
  levels: readonly DeepReadonly<LodChainDiagnostic['levels'][number]>[],
  distance: number,
  current: number | undefined,
  hysteresis: number,
): number {
  let target = 0
  for (let index = 1; index < levels.length; index += 1) {
    const threshold = levels[index]!.distance!
    if (distance >= threshold) target = index
  }
  if (current === undefined || target === current || hysteresis === 0) return target
  if (target > current) {
    const threshold = levels[target]!.distance!
    return distance >= threshold * (1 + hysteresis) ? target : current
  }
  const threshold = levels[current]!.distance!
  return distance < threshold * (1 - hysteresis) ? target : current
}

/**
 * Owns visibility for valid authored LOD chains without reparenting the scene.
 * This is safer than constructing THREE.LOD objects after load: authored world
 * transforms, stable IDs, and hierarchy remain intact. Call `update()` once per
 * frame after camera movement, and `stop()` before another system takes over.
 */
export function startCompiledSceneLods(
  root: LodObjectLike,
  camera: LodObjectLike,
  descriptor: LodCompiledDescriptor,
  options: CompiledSceneLodOptions,
): CompiledSceneLods | null {
  const chains = resolveRuntimeSceneDiagnostics(descriptor)?.lodChains ?? []
  if (!chains.length) return null
  const invalid = chains.filter((chain) => !chain.valid)
  if (invalid.length) {
    throw new Error(
      `Blendlink cannot start LOD switching: ${invalid.map((chain) =>
        `${chain.base}: ${chain.warnings.join('; ')}`).join(' | ')}`,
    )
  }
  if (!camera.getWorldPosition) {
    throw new Error('Blendlink LOD switching needs a Three-compatible camera.getWorldPosition().')
  }
  const hysteresis = options.hysteresis ?? 0.05
  if (!Number.isFinite(hysteresis) || hysteresis < 0 || hysteresis >= 0.5) {
    throw new Error('Blendlink LOD hysteresis must be finite and in the range 0..<0.5.')
  }
  const objects = byName(root)
  const objectsById = byStableId(root)
  const resolved = chains.map((chain) => ({
    chain,
    levels: chain.levels.map((level) => {
      const object = (level.id ? objectsById.get(level.id) : undefined) ?? objects.get(level.loadedName)
      if (!object) {
        throw new Error(
          `Blendlink LOD ${chain.base} cannot find exported level ${level.loadedName}.`,
        )
      }
      if (!object.getWorldPosition) {
        throw new Error(
          `Blendlink LOD ${chain.base} level ${level.loadedName} needs getWorldPosition().`,
        )
      }
      return object
    }),
  }))
  const visibility = new Map<LodObjectLike, {
    hadOwnValue: boolean
    previous: boolean | undefined
    installed: boolean
  }>()
  for (const { levels } of resolved) {
    for (const object of levels) {
      visibility.set(object, {
        hadOwnValue: Object.prototype.hasOwnProperty.call(object, 'visible'),
        previous: object.visible,
        installed: object.visible ?? true,
      })
    }
  }
  const active: Record<string, number> = {}
  const cameraPosition = options.createVector3()
  const anchorPosition = options.createVector3()
  let stopped = false

  const update = (): void => {
    if (stopped) throw new Error('Blendlink LOD switching has already been stopped.')
    camera.getWorldPosition!(cameraPosition)
    for (const { chain, levels } of resolved) {
      levels[0]!.getWorldPosition!(anchorPosition)
      const distance = anchorPosition.distanceTo(cameraPosition)
      if (!Number.isFinite(distance) || distance < 0) {
        throw new Error(`Blendlink LOD ${chain.base} produced invalid camera distance ${distance}.`)
      }
      const next = selectedLevel(chain.levels, distance, active[chain.base], hysteresis)
      active[chain.base] = next
      levels.forEach((object, index) => {
        const installed = index === next
        object.visible = installed
        visibility.get(object)!.installed = installed
      })
    }
  }
  const restoreVisibility = (conditional: boolean): void => {
    for (const [object, installation] of visibility) {
      if (conditional && object.visible !== installation.installed) continue
      object.visible = installation.previous
      if (!installation.hadOwnValue && Object.prototype.hasOwnProperty.call(object, 'visible')
          && object.visible === installation.previous) {
        delete object.visible
      }
    }
  }
  try {
    update()
  } catch (error) {
    restoreVisibility(false)
    throw error
  }
  return {
    active,
    update,
    stop() {
      if (stopped) return
      stopped = true
      restoreVisibility(true)
    },
  }
}
