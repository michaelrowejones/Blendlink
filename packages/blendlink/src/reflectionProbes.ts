import type { CompiledSceneDescriptor, Object3DLike } from './runtime.js'
import type { ReflectionProbeRecipe } from './sceneRecipe.js'

export interface ReflectionProbeMaterialLike {
  envMap?: unknown
  envMapIntensity?: number
  needsUpdate?: boolean
  clone?(): ReflectionProbeMaterialLike
  dispose?(): void
}

export interface ReflectionProbeObjectLike extends Object3DLike {
  material?: ReflectionProbeMaterialLike | ReflectionProbeMaterialLike[]
  /** Standard Three Object3D capture visibility. The package-owned WebGL
   * CubeCamera path requires this so reflective receivers cannot photograph
   * themselves from an interior probe origin. */
  visible?: boolean
}

/** Explicit ownership wrapper. A website-supplied PMREM usually omits
 * dispose; runtime captures should return their render target's disposer. */
export interface ReflectionProbeTextureResource {
  texture: unknown
  dispose?(): void
}

export interface ReflectionProbePublishedAsset {
  url: string
  sourceName: string
  mode: 'baked' | 'custom'
  format: 'hdr' | 'exr' | 'png' | 'jpeg' | 'webp'
  colorSpace: 'linear' | 'srgb'
  width: number
  height: number
  bytes: number
  hash: string
  source: 'packed' | 'linked'
  sourceHash?: string
}

interface CaptureVectorLike {
  copy(value: CaptureVectorLike): unknown
}

interface CaptureAnchorLike {
  getWorldPosition(target: CaptureVectorLike): CaptureVectorLike
}

interface CubeRenderTargetLike {
  texture: unknown
  dispose(): void
}

interface CubeCameraLike {
  position: CaptureVectorLike
  updateMatrixWorld(force?: boolean): void
  update(renderer: unknown, scene: unknown): void
}

interface PmremTargetLike {
  texture: unknown
  dispose(): void
}

/** Minimal constructor surface from the official Three WebGL classes. Pass
 * the application's imported `THREE` namespace; Blendlink stays peer/version
 * agnostic and does not bundle a second renderer. */
export interface ThreeWebGLReflectionCaptureNamespace {
  Vector3: new () => CaptureVectorLike
  WebGLCubeRenderTarget: new (
    resolution: number,
    options?: Record<string, unknown>,
  ) => CubeRenderTargetLike
  CubeCamera: new (
    near: number,
    far: number,
    target: CubeRenderTargetLike,
  ) => CubeCameraLike
  PMREMGenerator: new (renderer: unknown) => {
    compileCubemapShader?(): void
    fromCubemap(texture: unknown): PmremTargetLike
    dispose(): void
  }
  HalfFloatType?: unknown
  LinearMipmapLinearFilter?: unknown
}

export interface ThreeWebGLReflectionCaptureOptions {
  THREE: ThreeWebGLReflectionCaptureNamespace
  renderer: unknown
  scene: unknown
  near?: number
  far?: number | ((definition: ReflectionProbeRecipe) => number)
}

/** Ready-made one-shot CubeCamera -> PMREM capture for standard Three WebGL.
 * The temporary cubemap/generator are released immediately; the returned
 * PMREM target remains owned by the reflection-probe handle until dispose(). */
export function createThreeWebGLReflectionCapture<
  TObject extends ReflectionProbeObjectLike & CaptureAnchorLike = ReflectionProbeObjectLike & CaptureAnchorLike,
>(options: ThreeWebGLReflectionCaptureOptions) {
  return (context: ReflectionProbeRuntimeContext<TObject>): ReflectionProbeTextureResource => {
    const { THREE, renderer, scene } = options
    const near = options.near ?? 0.05
    const far = typeof options.far === 'function'
      ? options.far(context.definition)
      : (options.far ?? Math.max(1000, context.definition.influence * 4))
    if (!Number.isFinite(near) || near <= 0 || !Number.isFinite(far) || far <= near) {
      throw new Error(`Reflection probe "${context.definition.name}" needs finite capture planes with 0 < near < far.`)
    }
    const target = new THREE.WebGLCubeRenderTarget(context.definition.resolution, {
      ...(THREE.HalfFloatType !== undefined ? { type: THREE.HalfFloatType } : {}),
      generateMipmaps: true,
      ...(THREE.LinearMipmapLinearFilter !== undefined
        ? { minFilter: THREE.LinearMipmapLinearFilter }
        : {}),
    })
    const generator = new THREE.PMREMGenerator(renderer)
    let pmrem: PmremTargetLike | undefined
    const receiverVisibility: Array<{ object: TObject; visible: boolean }> = []
    try {
      for (const object of new Set(context.assignedObjects)) {
        if (typeof object.visible !== 'boolean') {
          throw new Error(
            `Reflection probe "${context.definition.name}" cannot exclude assigned receiver ` +
              `"${object.name || '<unnamed>'}" because it exposes no boolean Object3D.visible state.`,
          )
        }
        receiverVisibility.push({ object, visible: object.visible })
        object.visible = false
      }
      const camera = new THREE.CubeCamera(near, far, target)
      const position = context.anchorObject.getWorldPosition(new THREE.Vector3())
      camera.position.copy(position)
      camera.updateMatrixWorld(true)
      camera.update(renderer, scene)
      generator.compileCubemapShader?.()
      pmrem = generator.fromCubemap(target.texture)
    } catch (error) {
      pmrem?.dispose()
      throw error
    } finally {
      for (const entry of receiverVisibility.reverse()) {
        entry.object.visible = entry.visible
      }
      target.dispose()
      generator.dispose()
    }
    if (!pmrem?.texture) {
      pmrem?.dispose()
      throw new Error(`Reflection probe "${context.definition.name}" produced no PMREM texture.`)
    }
    return { texture: pmrem.texture, dispose: () => pmrem!.dispose() }
  }
}

export interface ReflectionProbeRuntimeContext<
  TObject extends ReflectionProbeObjectLike = ReflectionProbeObjectLike,
> {
  definition: ReflectionProbeRecipe
  probeObject: TObject
  /** The optional authored capture/parallax anchor, otherwise probeObject. */
  anchorObject: TObject
  assignedObjects: TObject[]
}

export interface ApplyReflectionProbesOptions<
  TObject extends ReflectionProbeObjectLike = ReflectionProbeObjectLike,
> {
  /** Ready-to-assign cubemap or PMREM resources keyed by generated probe id.
   * A supplied resource wins over runtime capture and remains caller-owned
   * unless it explicitly provides dispose(). */
  providedTextures?: Readonly<Record<string, ReflectionProbeTextureResource>>
  /** Resolve one compiler-published baked/custom equirectangular asset. The
   * high-level Three installer supplies this automatically. Generic renderers
   * can decode their own texture type without changing probe assignment. */
  loadTexture?(
    asset: ReflectionProbePublishedAsset,
    context: ReflectionProbeRuntimeContext<TObject>,
  ): ReflectionProbeTextureResource | Promise<ReflectionProbeTextureResource>
  /** Capture one ready-to-assign cubemap/PMREM. A Three implementation can
   * use PMREMGenerator.fromScene(..., { size: resolution, position: anchor })
   * or CubeCamera + PMREMGenerator.fromCubemap(). */
  capture?(context: ReflectionProbeRuntimeContext<TObject>):
    ReflectionProbeTextureResource | Promise<ReflectionProbeTextureResource>
  /** Override material assignment for node materials, parallax-corrected box
   * projection, or another renderer. Return a restoration callback when the
   * assignment mutates application-owned state. */
  assignTexture?(
    object: TObject,
    resource: ReflectionProbeTextureResource,
    context: ReflectionProbeRuntimeContext<TObject>,
  ): void | (() => void)
  /** Observe default-path material clones so another installed composition
   * system can keep stateful material fields and shader patches connected.
   * The returned release receives true when a later owner replaced the clone;
   * in that case it must detach bookkeeping without mutating the transferred
   * material or releasing resources that material still references. */
  trackMaterialClone?(
    source: ReflectionProbeMaterialLike,
    clone: ReflectionProbeMaterialLike,
    context: ReflectionProbeRuntimeContext<TObject>,
  ): void | ((transferred: boolean) => void)
}

export interface CompiledReflectionProbeReport {
  probesConfigured: number
  objectsAssigned: number
  runtimeCaptures: number
  publishedTextures: number
  /** Six square cubemap faces per runtime capture. Supplied textures cost 0. */
  capturePixels: number
  unusedProbes: string[]
}

export interface CompiledReflectionProbes {
  resources: Readonly<Record<string, ReflectionProbeTextureResource>>
  report: CompiledReflectionProbeReport
  /** Restores original mesh materials before releasing owned capture targets. */
  dispose(): void
}

/** Resolve explicit Blender assignments and apply local environment maps.
 *
 * Influence volumes are authoring/capture metadata, not an implicit spatial
 * blend. Standard Three materials have one envMap, so auto-assigning by volume
 * would hide overlap and shared-material consequences. The default path clones
 * every assigned material; custom box projection belongs in assignTexture(). */
export async function applyCompiledSceneReflectionProbes<
  TObject extends ReflectionProbeObjectLike = ReflectionProbeObjectLike,
>(
  root: TObject,
  descriptor: CompiledSceneDescriptor,
  options: ApplyReflectionProbesOptions<TObject> = {},
): Promise<CompiledReflectionProbes> {
  const definitions = descriptor.reflectionProbes ?? []
  const allByName = indexByName(root)
  const allById = indexByStableId(root)
  for (const [id, loadedName] of Object.entries(descriptor.objectsById ?? {})) {
    if (!allById[id] && allByName[loadedName]) allById[id] = allByName[loadedName]!
  }
  const byObjectId = new Map(definitions.map((definition) => [definition.objectId, definition]))
  const assignedByProbe = new Map<string, TObject[]>()

  for (const [loadedName, extras] of Object.entries(descriptor.extras ?? {})) {
    const probeObjectId = extras.blendlink_reflection_probe
    if (probeObjectId === undefined) continue
    if (typeof probeObjectId !== 'string' || !probeObjectId) {
      throw new Error(
        `Blendlink object "${loadedName}" has an invalid blendlink_reflection_probe extra; ` +
          'reassign it from the Reflection Probes panel in Blender.',
      )
    }
    const definition = byObjectId.get(probeObjectId)
    if (!definition) {
      throw new Error(
        `Blendlink object "${loadedName}" references missing reflection probe ${probeObjectId}. ` +
          'Reassign it or remove the stale assignment in Blender.',
      )
    }
    const stableId = descriptor.nodeIds?.[loadedName]
    const object = (stableId ? allById[stableId] : undefined) ?? allByName[loadedName]
    if (!object) {
      throw new Error(
        `Blendlink reflection assignment target "${loadedName}" is not present in the loaded scene.`,
      )
    }
    const assigned = assignedByProbe.get(probeObjectId) ?? []
    assigned.push(object)
    assignedByProbe.set(probeObjectId, assigned)
  }

  const resources: Record<string, ReflectionProbeTextureResource> = {}
  const restorations: Array<{
    resource: ReflectionProbeTextureResource
    restore: () => void | boolean
  }> = []
  const disposableResources = new Set<ReflectionProbeTextureResource>()
  const pendingAssignments: Array<{
    context: ReflectionProbeRuntimeContext<TObject>
    resource: ReflectionProbeTextureResource
  }> = []
  const unusedProbes: string[] = []
  let runtimeCaptures = 0
  let publishedTextures = 0
  const runtimeCaptureIds = new Set<string>()
  let objectsAssigned = 0
  let disposed = false

  const dispose = () => {
    if (disposed) return
    disposed = true
    const errors: unknown[] = []
    const transferredResources = new Set<ReflectionProbeTextureResource>()
    for (const installation of restorations.reverse()) {
      try {
        if (installation.restore() === false) transferredResources.add(installation.resource)
      } catch (error) {
        errors.push(error)
      }
    }
    for (const resource of disposableResources) {
      if (transferredResources.has(resource)) continue
      try { resource.dispose?.() } catch (error) { errors.push(error) }
    }
    if (errors.length > 0) {
      throw new Error(
        'Could not fully dispose Blendlink reflection probes: ' +
          errors.map((error) => error instanceof Error ? error.message : String(error)).join('; '),
      )
    }
  }

  try {
    for (const definition of definitions) {
      const probeObject = allById[definition.objectId]
      if (!probeObject) {
        throw new Error(
          `Reflection probe "${definition.name}" (${definition.objectName}) is not present in the loaded scene. ` +
            'Re-run Blendlink export and ensure its helper empty is included.',
        )
      }
      const anchorObject = definition.anchorId ? allById[definition.anchorId] : probeObject
      if (!anchorObject) {
        throw new Error(
          `Reflection probe "${definition.name}" cannot resolve its anchor "${definition.anchorName ?? definition.anchorId}".`,
        )
      }
      const assignedObjects = assignedByProbe.get(definition.objectId) ?? []
      if (assignedObjects.length === 0) {
        unusedProbes.push(definition.id)
        continue
      }
      const context: ReflectionProbeRuntimeContext<TObject> = {
        definition, probeObject, anchorObject, assignedObjects,
      }
      let resource = options.providedTextures?.[definition.id]
      if (!resource) {
        const source = definition.source ?? 'runtime'
        const asset = descriptor.reflectionProbeAssets?.[definition.id] as
          ReflectionProbePublishedAsset | undefined
        if (source !== 'runtime') {
          if (!asset) {
            throw new Error(
              `Reflection probe "${definition.name}" uses ${source} source but its published texture is missing. ` +
                'Re-run blendlink sync and publish the complete generated asset set.',
            )
          }
          if (!options.loadTexture) {
            throw new Error(
              `Reflection probe "${definition.name}" needs a published-texture loader. ` +
                `Supply loadTexture(asset, context) or providedTextures["${definition.id}"].`,
            )
          }
          resource = await options.loadTexture(asset, context)
          publishedTextures += 1
        } else {
          if (asset) {
            throw new Error(
              `Runtime reflection probe "${definition.name}" unexpectedly declares a published texture asset.`,
            )
          }
          if (!options.capture) {
            throw new Error(
              `Reflection probe "${definition.name}" needs a runtime capture. ` +
                `Supply capture(context) or providedTextures["${definition.id}"].`,
            )
          }
          resource = await options.capture(context)
          runtimeCaptures += 1
          runtimeCaptureIds.add(definition.id)
        }
      }
      if (!resource || resource.texture === undefined || resource.texture === null) {
        throw new Error(`Reflection probe "${definition.name}" resolved without a usable texture.`)
      }
      resources[definition.id] = resource
      if (resource.dispose) disposableResources.add(resource)
      pendingAssignments.push({ context, resource })
    }

    // Capture every probe against the original loaded scene. Assigning probe
    // materials between captures makes later probes photograph earlier local
    // env maps, so results would depend on authoring/list order.
    for (const { context, resource } of pendingAssignments) {
      for (const object of context.assignedObjects) {
        const restore = options.assignTexture
          ? options.assignTexture(object, resource, context)
          : assignClonedMaterials(
              object,
              resource.texture,
              context,
              options.trackMaterialClone,
            )
        if (restore) restorations.push({ resource, restore })
        objectsAssigned += 1
      }
    }
  } catch (error) {
    try {
      dispose()
    } catch (cleanupError) {
      throw new Error(
        `Could not apply Blendlink reflection probes: ${error instanceof Error ? error.message : String(error)}. ` +
          `Rollback also failed: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`,
      )
    }
    throw error
  }

  return {
    resources,
    report: {
      probesConfigured: Object.keys(resources).length,
      objectsAssigned,
      runtimeCaptures,
      publishedTextures,
      capturePixels: definitions.reduce((pixels, definition) =>
        pixels + (runtimeCaptureIds.has(definition.id)
          ? 6 * definition.resolution ** 2
          : 0), 0),
      unusedProbes,
    },
    dispose,
  }
}

function indexByName<TObject extends ReflectionProbeObjectLike>(root: TObject): Record<string, TObject> {
  const result: Record<string, TObject> = {}
  const visit = (object: Object3DLike) => {
    if (object.name) result[object.name] = object as TObject
  }
  if (root.traverse) root.traverse(visit)
  else walk(root, visit)
  return result
}

function indexByStableId<TObject extends ReflectionProbeObjectLike>(root: TObject): Record<string, TObject> {
  const result: Record<string, TObject> = {}
  const visit = (object: Object3DLike) => {
    const id = object.userData?.blendlink_id
    if (typeof id !== 'string') return
    if (result[id] && result[id] !== object) {
      throw new Error(`Blendlink reflection binding found duplicate stable object ID ${id}.`)
    }
    result[id] = object as TObject
  }
  if (root.traverse) root.traverse(visit)
  else walk(root, visit)
  return result
}

function assignClonedMaterials<TObject extends ReflectionProbeObjectLike>(
  object: TObject,
  texture: unknown,
  context: ReflectionProbeRuntimeContext<TObject>,
  trackMaterialClone: ApplyReflectionProbesOptions<TObject>['trackMaterialClone'],
): () => boolean {
  const definition = context.definition
  const original = object.material
  if (!original) {
    throw new Error(
      `Reflection probe "${definition.name}" is assigned to "${object.name}", which has no material.`,
    )
  }
  const materials = Array.isArray(original) ? original : [original]
  const clones: ReflectionProbeMaterialLike[] = []
  const cloneReleases: Array<(transferred: boolean) => void> = []
  try {
    for (const material of materials) {
      const clone = material.clone?.()
      if (!clone || !('envMap' in clone)) {
        throw new Error(
          `Reflection probe "${definition.name}" cannot safely assign material on "${object.name}". ` +
            'Use a cloneable Three material with envMap or pass assignTexture() for this renderer/material.',
        )
      }
      clone.envMap = texture
      if ('envMapIntensity' in clone) clone.envMapIntensity = definition.intensity
      clone.needsUpdate = true
      clones.push(clone)
      const release = trackMaterialClone?.(material, clone, context)
      if (release) cloneReleases.push(release)
    }
    object.material = Array.isArray(original) ? clones : clones[0]
  } catch (error) {
    const cleanupErrors: unknown[] = []
    for (const release of cloneReleases.reverse()) {
      try { release(false) } catch (cleanupError) { cleanupErrors.push(cleanupError) }
    }
    for (const clone of clones) {
      try { clone.dispose?.() } catch (cleanupError) { cleanupErrors.push(cleanupError) }
    }
    if (cleanupErrors.length > 0) {
      throw new Error(
        `${error instanceof Error ? error.message : String(error)} ` +
          `Clone cleanup also failed: ${cleanupErrors.map((item) =>
            item instanceof Error ? item.message : String(item)).join('; ')}`,
      )
    }
    throw error
  }
  const installed = object.material
  return () => {
    const stillInstalled = object.material === installed && (
      !Array.isArray(installed) ||
      (installed.length === clones.length && installed.every((material, index) => material === clones[index]))
    )
    const cleanupErrors: unknown[] = []
    for (const release of cloneReleases.reverse()) {
      try { release(!stillInstalled) } catch (error) { cleanupErrors.push(error) }
    }
    if (!stillInstalled) {
      if (cleanupErrors.length > 0) {
        throw new Error(cleanupErrors.map((error) =>
          error instanceof Error ? error.message : String(error)).join('; '))
      }
      return false
    }
    object.material = original
    for (const clone of clones) {
      try { clone.dispose?.() } catch (error) { cleanupErrors.push(error) }
    }
    if (cleanupErrors.length > 0) {
      throw new Error(cleanupErrors.map((error) =>
        error instanceof Error ? error.message : String(error)).join('; '))
    }
    return true
  }
}

function walk(object: Object3DLike, visitor: (object: Object3DLike) => void): void {
  visitor(object)
  for (const child of object.children ?? []) walk(child, visitor)
}
