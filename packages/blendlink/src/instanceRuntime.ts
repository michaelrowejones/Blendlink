import {
  resolveRuntimeSceneDiagnostics,
  type RuntimeSceneDiagnosticsDescriptor,
} from './runtimeDiagnostics.js'

export interface InstanceParentLike {
  add(object: InstanceBatchLike): unknown
  remove(object: InstanceBatchLike): unknown
}

export interface InstanceObjectLike {
  name: string
  userData?: Record<string, unknown>
  visible?: boolean
  castShadow?: boolean
  receiveShadow?: boolean
  geometry?: unknown
  material?: unknown | unknown[]
  matrix?: unknown
  parent?: unknown
  children?: InstanceObjectLike[]
  traverse?(visitor: (object: InstanceObjectLike) => void): void
  updateMatrix?(): unknown
}

export interface InstanceBatchLike {
  name?: string
  visible?: boolean
  castShadow?: boolean
  receiveShadow?: boolean
  userData?: Record<string, unknown>
  /** Runtime ownership probe only. Three's Object3D parent is deliberately
   * wider than this adapter's minimal parent interface. */
  parent?: unknown
  instanceMatrix?: { needsUpdate?: boolean }
  setMatrixAt(index: number, matrix: unknown): unknown
  computeBoundingBox?(): unknown
  computeBoundingSphere?(): unknown
  dispose?(): unknown
}

export interface InstanceCompiledDescriptor extends RuntimeSceneDiagnosticsDescriptor {}

export interface CompiledSceneInstanceOptions {
  /** Usually `(geometry, material, count) => new THREE.InstancedMesh(...)`. */
  createInstancedMesh(geometry: unknown, material: unknown | unknown[], count: number): InstanceBatchLike
  /** Do not batch small groups. Default 2. */
  minimumCount?: number
}

export interface CompiledInstanceBinding {
  groupId: string
  batch: InstanceBatchLike
  members: InstanceObjectLike[]
  stableIds: string[]
  names: string[]
  drawCallsSaved: number
}

export interface CompiledSceneInstances {
  bindings: CompiledInstanceBinding[]
  report: { groupsBatched: number; instancesBatched: number; drawCallsSaved: number }
  /** Copy current local transforms from the hidden stable objects into batches. */
  update(): void
  /** Resolve Three raycaster `instanceId` back to the authored stable object. */
  resolveInstance(batch: InstanceBatchLike, instanceId: number): {
    id: string
    name: string
    object: InstanceObjectLike
  }
  /** Remove batches and restore every original object's prior visibility. */
  stop(): void
}

function sanitizeNodeName(name: string): string {
  return name.replace(/\s/g, '_').replace(/[\[\]%$.:/]/g, '')
}

function visit(root: InstanceObjectLike, visitor: (object: InstanceObjectLike) => void): void {
  if (root.traverse) {
    root.traverse(visitor)
    return
  }
  visitor(root)
  for (const child of root.children ?? []) visit(child, visitor)
}

function materialsEqual(a: unknown | unknown[], b: unknown | unknown[]): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b)
      && a.length === b.length && a.every((material, index) => material === b[index])
  }
  return a === b
}

function hasInstanceParentMethods(value: unknown): value is object {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return false
  return typeof Reflect.get(value, 'add') === 'function'
    && typeof Reflect.get(value, 'remove') === 'function'
}

function callInstanceParent(
  parent: object,
  methodName: 'add' | 'remove',
  batch: InstanceBatchLike,
): void {
  const method = Reflect.get(parent, methodName)
  if (typeof method !== 'function') {
    throw new Error(`Blendlink instance parent no longer exposes ${methodName}().`)
  }
  Reflect.apply(method, parent, [batch])
}

/**
 * Explicitly converts diagnosed, static shared meshes into InstancedMesh-like
 * batches after GLTFLoader. Original objects stay in the hierarchy (hidden),
 * so generated stable-ID bindings remain valid; ray hits map instanceId back
 * to those objects. No batching occurs unless the application calls this.
 */
export function applyCompiledSceneInstances(
  root: InstanceObjectLike,
  descriptor: InstanceCompiledDescriptor,
  options: CompiledSceneInstanceOptions,
): CompiledSceneInstances | null {
  const minimumCount = options.minimumCount ?? 2
  if (!Number.isInteger(minimumCount) || minimumCount < 2) {
    throw new Error('Blendlink instance minimumCount must be an integer of at least 2.')
  }
  const candidates = (resolveRuntimeSceneDiagnostics(descriptor)?.instanceGroups ?? [])
    .filter((group) => group.eligible && group.count >= minimumCount)
  if (!candidates.length) return null

  const objects = new Map<string, InstanceObjectLike>()
  const objectsById = new Map<string, InstanceObjectLike>()
  visit(root, (object) => {
    objects.set(object.name, object)
    const id = object.userData?.blendlink_id
    if (typeof id === 'string') {
      if (objectsById.has(id)) {
        throw new Error(`Blendlink instance binding found duplicate stable object ID ${id}.`)
      }
      objectsById.set(id, object)
    }
  })
  const bindings: CompiledInstanceBinding[] = []
  const visibility = new Map<InstanceObjectLike, {
    hadOwnValue: boolean
    previous: boolean | undefined
    installed: boolean
  }>()
  const ownedBatches: Array<{
    batch: InstanceBatchLike
    parent: object
    attached: boolean
  }> = []

  try {
    for (const group of candidates) {
      const members = group.members.map((member) => {
        const loadedName = member.loadedName ?? sanitizeNodeName(member.name)
        const object = (member.id ? objectsById.get(member.id) : undefined) ?? objects.get(loadedName)
        if (!object) throw new Error(`Blendlink instance group ${group.id} cannot find ${loadedName}.`)
        return object
      })
      if (members.length !== group.count) {
        throw new Error(
          `Blendlink instance group ${group.id} expected ${group.count} members, found ${members.length}.`,
        )
      }
      const first = members[0]!
      if (first.geometry === undefined || first.material === undefined || first.matrix === undefined) {
        throw new Error(`Blendlink instance group ${group.id} contains a non-Mesh object.`)
      }
      if (!hasInstanceParentMethods(first.parent)) {
        throw new Error(`Blendlink instance group ${group.id} needs one mutable common parent.`)
      }
      const parent = first.parent
      for (const member of members) {
        if (member.parent !== parent) {
          throw new Error(`Blendlink instance group ${group.id} members no longer share one parent.`)
        }
        if (member.geometry !== first.geometry || !materialsEqual(member.material, first.material)) {
          throw new Error(`Blendlink instance group ${group.id} geometry/material identity drifted after compile.`)
        }
        if (member.visible === false) {
          throw new Error(`Blendlink instance group ${group.id} contains a hidden member; per-instance visibility cannot be merged.`)
        }
        if (member.castShadow !== first.castShadow || member.receiveShadow !== first.receiveShadow) {
          throw new Error(`Blendlink instance group ${group.id} shadow intent differs at runtime.`)
        }
        if (member.matrix === undefined) {
          throw new Error(`Blendlink instance group ${group.id} member ${member.name} has no local matrix.`)
        }
      }
      const stableIds = group.members.map((member) => member.id).filter((id): id is string => Boolean(id))
      if (stableIds.length !== members.length) {
        throw new Error(`Blendlink instance group ${group.id} cannot preserve stable identity: an ID is missing.`)
      }
      const batch = options.createInstancedMesh(first.geometry, first.material, members.length)
      const owned = { batch, parent, attached: false }
      // Register ownership before calling into the supplied Three factory's
      // result. If setMatrixAt/add throws, this just-created GPU resource is
      // still disposed and no partial conversion survives.
      ownedBatches.push(owned)
      batch.name = `BLENDLINK_INSTANCES_${group.id}`
      batch.visible = true
      batch.castShadow = first.castShadow
      batch.receiveShadow = first.receiveShadow
      batch.userData = {
        ...(batch.userData ?? {}),
        blendlinkInstanceIds: stableIds,
        blendlinkInstanceNames: group.members.map((member) => member.name),
      }
      members.forEach((member, index) => {
        member.updateMatrix?.()
        batch.setMatrixAt(index, member.matrix!)
      })
      if (batch.instanceMatrix) batch.instanceMatrix.needsUpdate = true
      batch.computeBoundingBox?.()
      batch.computeBoundingSphere?.()
      callInstanceParent(parent, 'add', batch)
      owned.attached = true
      members.forEach((member) => {
        visibility.set(member, {
          hadOwnValue: Object.prototype.hasOwnProperty.call(member, 'visible'),
          previous: member.visible,
          installed: false,
        })
        member.visible = false
      })
      bindings.push({
        groupId: group.id,
        batch,
        members,
        stableIds,
        names: group.members.map((member) => member.name),
        drawCallsSaved: group.drawCallsSaved,
      })
    }
  } catch (error) {
    for (const owned of [...ownedBatches].reverse()) {
      if (owned.attached) callInstanceParent(owned.parent, 'remove', owned.batch)
      owned.batch.dispose?.()
    }
    for (const [object, installation] of visibility) {
      object.visible = installation.previous
      if (!installation.hadOwnValue && Object.prototype.hasOwnProperty.call(object, 'visible')
          && object.visible === installation.previous) {
        delete object.visible
      }
    }
    throw error
  }

  const byBatch = new Map(bindings.map((binding) => [binding.batch, binding]))
  let stopped = false
  return {
    bindings,
    report: {
      groupsBatched: bindings.length,
      instancesBatched: bindings.reduce((sum, binding) => sum + binding.members.length, 0),
      drawCallsSaved: bindings.reduce((sum, binding) => sum + binding.drawCallsSaved, 0),
    },
    update() {
      if (stopped) throw new Error('Blendlink instance batches have already been stopped.')
      for (const binding of bindings) {
        binding.members.forEach((member, index) => {
          member.updateMatrix?.()
          binding.batch.setMatrixAt(index, member.matrix!)
        })
        if (binding.batch.instanceMatrix) binding.batch.instanceMatrix.needsUpdate = true
        binding.batch.computeBoundingBox?.()
        binding.batch.computeBoundingSphere?.()
      }
    },
    resolveInstance(batch, instanceId) {
      if (stopped) throw new Error('Blendlink instance batches have already been stopped.')
      const binding = byBatch.get(batch)
      if (!binding || !Number.isInteger(instanceId) || instanceId < 0 || instanceId >= binding.members.length) {
        throw new Error(`Blendlink cannot resolve instanceId ${instanceId}; it is not in an owned batch.`)
      }
      return {
        id: binding.stableIds[instanceId]!,
        name: binding.names[instanceId]!,
        object: binding.members[instanceId]!,
      }
    },
    stop() {
      if (stopped) return
      stopped = true
      const transferredMembers = new Set<InstanceObjectLike>()
      for (const owned of [...ownedBatches].reverse()) {
        const parentKnown = Object.prototype.hasOwnProperty.call(owned.batch, 'parent')
        const transferred = parentKnown && owned.batch.parent !== null
          && owned.batch.parent !== undefined && owned.batch.parent !== owned.parent
        if (transferred) {
          const binding = bindings.find((entry) => entry.batch === owned.batch)
          binding?.members.forEach((member) => transferredMembers.add(member))
          continue
        }
        if (owned.attached && (!parentKnown || owned.batch.parent === owned.parent)) {
          callInstanceParent(owned.parent, 'remove', owned.batch)
        }
        owned.batch.dispose?.()
      }
      for (const [object, installation] of visibility) {
        if (transferredMembers.has(object) || object.visible !== installation.installed) continue
        object.visible = installation.previous
        if (!installation.hadOwnValue && Object.prototype.hasOwnProperty.call(object, 'visible')
            && object.visible === installation.previous) {
          delete object.visible
        }
      }
    },
  }
}
