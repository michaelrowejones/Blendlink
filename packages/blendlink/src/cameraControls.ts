import type { PresentationCameraRecipe } from './sceneRecipe.js'
import type { Object3DLike, SceneBindings } from './runtime.js'

export interface CameraVectorLike {
  x: number
  y: number
  z: number
  set?(x: number, y: number, z: number): unknown
}

export interface CameraQuaternionLike {
  x: number
  y: number
  z: number
  w: number
  set?(x: number, y: number, z: number, w: number): unknown
}

export interface PresentationCameraLike extends Object3DLike {
  position: CameraVectorLike
  quaternion?: CameraQuaternionLike
  isPerspectiveCamera?: boolean
  isOrthographicCamera?: boolean
  fov?: number
  aspect?: number
  zoom?: number
  near?: number
  far?: number
  left?: number
  right?: number
  top?: number
  bottom?: number
  updateProjectionMatrix?(): unknown
  updateMatrixWorld?(force?: boolean): unknown
}

export interface CameraViewport {
  width: number
  height: number
}

export interface CameraBounds {
  /** World-space center. */
  center: readonly [number, number, number]
  /** Radius of a conservative world-space bounding sphere. */
  radius: number
}

export interface InteractiveCameraControls {
  update(deltaSeconds?: number): unknown
  dispose(): unknown
  /** Optional live activity proof for demand-mode rendering. Omit this when
   * the controls cannot prove they are idle; Blendlink then conservatively
   * keeps frames active for as long as the controls are installed. */
  readonly requiresContinuousFrames?: boolean
  /** Required for fit() after installation so controls and camera cannot drift. */
  setTarget?(x: number, y: number, z: number): unknown
  saveState?(): unknown
  reset?(): unknown
}

export interface CameraControlsContext<TObject extends Object3DLike = Object3DLike> {
  behavior: 'orbit' | 'free'
  camera: PresentationCameraLike
  /** Rename-stable target object, when the recipe declares one. */
  target?: TObject
  /** Exact world-space target. For fitted orbit views this remains the
   * authored target while the enclosing radius expands around it. */
  targetPosition?: readonly [number, number, number]
}

export interface InstallCompiledSceneCameraOptions<TObject extends Object3DLike = Object3DLike> {
  /** Required only for Orbit/Free. Usually creates OrbitControls, MapControls,
   * or the site's existing navigation adapter. Blendlink imports none of them. */
  createControls?(context: CameraControlsContext<TObject>): InteractiveCameraControls
  /** Required when the recipe has a target. Must return world, not local, coordinates. */
  getWorldPosition?(object: TObject): readonly [number, number, number]
  /** Required for fit modes; return the normalized camera forward direction. */
  getViewDirection?(camera: PresentationCameraLike): readonly [number, number, number]
  /** Required for fit modes. A Three adapter normally uses Box3.setFromObject()
   * followed by getBoundingSphere(). */
  measureBounds?(object: TObject): CameraBounds
  /** Supplying this is the final explicit opt-in to artist-authored initial fit.
   * Authored framing never moves even when a viewport is supplied. */
  initialViewport?: CameraViewport
  /** Prepare camera selection and framing without constructing interactive
   * controls or attaching their DOM listeners. activate() remains synchronous.
   * Defaults to false for backward-compatible immediate activation. */
  deferActivation?: boolean
}

export interface CameraFitReport {
  scope: 'scene' | 'target'
  composition: string
  viewportAspect: number
  authoredAspect: number
  safeMargin: number
  radius: number
  distance: number
  consequence: string
}

export interface CompiledSceneCamera<TObject extends Object3DLike = Object3DLike> {
  camera: PresentationCameraLike
  target?: TObject
  behavior: PresentationCameraRecipe['behavior']
  /** True only when an explicit controls factory was called. */
  interactive: boolean
  /** False means either no controls are active or their adapter explicitly
   * proves that input/damping work is idle. Unknown adapters remain true. */
  readonly requiresContinuousFrames: boolean
  initialFit: CameraFitReport | null
  /** Idempotently construct and activate artist-requested controls. Fixed
   * cameras are already complete, so activation is a no-op for them. */
  activate(): void
  update(deltaSeconds?: number): void
  /** Explicitly reframe; it is never called on resize by Blendlink. */
  fit(viewport: CameraViewport, scope?: 'scene' | 'target'): CameraFitReport
  reset(): void
  dispose(): void
}

export interface CameraCompiledDescriptor {
  camera?: PresentationCameraRecipe | null
}

/**
 * Resolve a generated camera by stable ID and install an application-supplied
 * controls adapter. The installer itself is the opt-in: importing or loading a
 * Blendlink scene never attaches listeners or moves a camera.
 */
export function installCompiledSceneCamera<TObject extends Object3DLike>(
  root: TObject,
  bindings: SceneBindings<TObject>,
  descriptor: CameraCompiledDescriptor,
  options: InstallCompiledSceneCameraOptions<TObject> = {},
): CompiledSceneCamera<TObject> | null {
  const recipe = descriptor.camera
  if (!recipe) return null
  const resolved = bindings.byId[recipe.objectId]
  if (!resolved) {
    throw new Error(
      `Blendlink presentation camera "${recipe.objectName}" (${recipe.objectId}) is not present ` +
        'in the loaded scene. Re-export the camera or choose another Presentation Camera in Blender.',
    )
  }
  const camera = resolved as unknown as PresentationCameraLike
  if (!camera.position) {
    throw new Error(`Blendlink object "${recipe.objectName}" resolved by ID but is not a camera-like object.`)
  }
  const target = recipe.targetId ? bindings.byId[recipe.targetId] : undefined
  if (recipe.targetId && !target) {
    throw new Error(
      `Blendlink camera target "${recipe.targetName ?? recipe.targetId}" (${recipe.targetId}) ` +
        'is not present in the loaded scene.',
    )
  }
  if (recipe.behavior === 'orbit' && !target) {
    throw new Error('Blendlink Orbit camera has no resolved stable target. Choose an Orbit Target in Blender.')
  }

  let disposed = false
  let controls: InteractiveCameraControls | null = null
  let lastFitTarget: readonly [number, number, number] | undefined
  let preparedControlsTarget: readonly [number, number, number] | undefined
  const beforeInstall = snapshotCameraState(camera)

  const targetPosition = (): readonly [number, number, number] | undefined => {
    if (!target) return undefined
    if (!options.getWorldPosition) {
      throw new Error(
        'This Blendlink camera uses a stable target. Pass getWorldPosition(object) to ' +
          'installCompiledSceneCamera(); local object.position is not safe under transformed parents.',
      )
    }
    return finiteVector(options.getWorldPosition(target), 'camera target world position')
  }

  const fit = (viewport: CameraViewport, requestedScope?: 'scene' | 'target'): CameraFitReport => {
    assertLive(disposed)
    const beforeFit = snapshotCameraState(camera)
    try {
    const scope = requestedScope ?? (
      recipe.framing === 'fit-target' ? 'target'
        : recipe.framing === 'fit-scene' ? 'scene'
          : undefined
    )
    if (!scope) {
      throw new Error(
        'This camera preserves its authored framing. Pass an explicit "scene" or "target" scope to fit().',
      )
    }
    if (scope === 'target' && !target) {
      throw new Error('Camera fit scope "target" needs a rename-stable target in the Blender camera recipe.')
    }
    if (!options.measureBounds || !options.getViewDirection) {
      throw new Error(
        'Camera fit needs measureBounds(object) and getViewDirection(camera). ' +
          'For Three.js use Box3.setFromObject()/getBoundingSphere() and camera.getWorldDirection().',
      )
    }
    const { width, height } = finiteViewport(viewport)
    const composition = closestComposition(recipe, width / height)
    const measured = options.measureBounds(scope === 'target' ? target! : root)
    const center = finiteVector(measured.center, 'camera fit bounds center')
    if (!Number.isFinite(measured.radius) || measured.radius <= 0) {
      throw new Error(`Camera fit needs a positive finite bounding radius; got ${measured.radius}.`)
    }
    const stableTarget = recipe.behavior === 'orbit' || scope === 'target'
      ? targetPosition()
      : undefined
    const focus = stableTarget ?? center
    if (controls && recipe.behavior === 'orbit' && !controls.setTarget) {
      throw new Error(
        'Re-fitting an interactive Blendlink Orbit camera requires controls.setTarget(x, y, z). ' +
          'Add it to the Orbit controls adapter so camera and interaction state stay synchronized.',
      )
    }
    // Keep an authored orbit/focus target exact while conservatively expanding
    // the sphere to enclose bounds that are not centered on that target.
    const radius = measured.radius + distance(center, focus)
    const direction = normalized(options.getViewDirection(camera), 'camera view direction')
    const viewportAspect = width / height
    const safeScale = 1 - composition.safeMargin * 2
    let fitDistance: number

    if (camera.isPerspectiveCamera || typeof camera.fov === 'number') {
      const fov = camera.fov
      const zoom = camera.zoom ?? 1
      if (!Number.isFinite(fov) || fov! <= 0 || fov! >= 180 || !Number.isFinite(zoom) || zoom <= 0) {
        throw new Error(`Perspective camera fit needs 0 < fov < 180 and zoom > 0; got fov=${fov}, zoom=${zoom}.`)
      }
      const vertical = 2 * Math.atan(Math.tan((fov! * Math.PI / 180) / 2) / zoom)
      const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * viewportAspect)
      const limitingHalfAngle = Math.atan(Math.tan(Math.min(vertical, horizontal) / 2) * safeScale)
      fitDistance = radius / Math.sin(limitingHalfAngle)
      assertClipPlanes(camera, fitDistance, radius)
      setVector(camera.position, subtractScaled(focus, direction, fitDistance))
      camera.aspect = viewportAspect
    } else if (camera.isOrthographicCamera || orthographicShape(camera)) {
      const heightAtZoomOne = camera.top! - camera.bottom!
      const horizontalCenter = (camera.left! + camera.right!) / 2
      const widthAtZoomOne = heightAtZoomOne * viewportAspect
      const nextZoom = Math.min(
        widthAtZoomOne * safeScale / (2 * radius),
        heightAtZoomOne * safeScale / (2 * radius),
      )
      if (!Number.isFinite(nextZoom) || nextZoom <= 0) {
        throw new Error('Orthographic camera fit produced an invalid zoom; inspect its frustum bounds in Blender.')
      }
      fitDistance = distance(readVector(camera.position), focus)
      assertClipPlanes(camera, fitDistance, radius)
      camera.left = horizontalCenter - widthAtZoomOne / 2
      camera.right = horizontalCenter + widthAtZoomOne / 2
      camera.zoom = nextZoom
      setVector(camera.position, subtractScaled(focus, direction, fitDistance))
    } else {
      throw new Error(
        'Camera fit supports Three-compatible PerspectiveCamera or OrthographicCamera objects only.',
      )
    }
    lastFitTarget = focus
    camera.updateProjectionMatrix?.()
    camera.updateMatrixWorld?.(true)
    controls?.setTarget?.(...focus)
    const authoredAspect = composition.width / composition.height
    const delta = Math.abs(viewportAspect / authoredAspect - 1)
    const relation = viewportAspect < authoredAspect ? 'narrower' : 'wider'
    return {
      scope,
      composition: composition.name,
      viewportAspect,
      authoredAspect,
      safeMargin: composition.safeMargin,
      radius,
      distance: fitDistance,
      consequence: delta < 0.02
        ? `Viewport matches the ${composition.name} composition; ${(composition.safeMargin * 100).toFixed(0)}% page-safe edges are protected.`
        : `Viewport is ${(delta * 100).toFixed(0)}% ${relation} than ${composition.name}; fit expanded to protect its ${(composition.safeMargin * 100).toFixed(0)}% page-safe edges.`,
    }
    } catch (error) {
      restoreCameraState(camera, beforeFit)
      throw error
    }
  }

  let initialFit: CameraFitReport | null = null
  const activate = (): void => {
    assertLive(disposed)
    if (recipe.behavior === 'fixed' || controls) return
    if (!options.createControls) {
      throw new Error(
        `Blendlink camera behavior is ${recipe.behavior}. Pass createControls(context); ` +
          'Blendlink never imports or injects browser controls on its own.',
      )
    }
    const worldTarget = lastFitTarget ?? preparedControlsTarget
    const snapshot = snapshotCameraState(camera)
    let candidate: InteractiveCameraControls | null = null
    try {
      candidate = options.createControls({
        behavior: recipe.behavior,
        camera,
        ...(target ? { target } : {}),
        ...(worldTarget ? { targetPosition: worldTarget } : {}),
      })
      if (!candidate || typeof candidate.update !== 'function' || typeof candidate.dispose !== 'function') {
        throw new Error('createControls() must return update() and dispose() methods.')
      }
      // A third-party constructor may eagerly orient toward its own default
      // target or alter projection state. Restore the intentional authored/
      // fitted first frame before saving the controls' reset state.
      restoreCameraState(camera, snapshot)
      candidate.saveState?.()
      controls = candidate
    } catch (error) {
      controls = null
      const cleanupErrors: unknown[] = []
      try { candidate?.dispose?.() } catch (cleanupError) {
        cleanupErrors.push(cleanupError)
      }
      try { restoreCameraState(camera, snapshot) } catch (cleanupError) {
        cleanupErrors.push(cleanupError)
      }
      if (cleanupErrors.length > 0) {
        throw new Error(
          `Could not activate Blendlink camera controls: ${cameraErrorMessage(error)}. ` +
            `Partial controls cleanup also failed: ${cleanupErrors.map(cameraErrorMessage).join('; ')}.`,
          { cause: error },
        )
      }
      throw error
    }
  }
  try {
  if (recipe.framing !== 'authored') {
    if (!options.initialViewport) {
      throw new Error(
        `Blendlink camera framing is ${recipe.framing}. Pass initialViewport to apply that explicit ` +
          'artist choice, or change Framing to Preserve Authored View in Blender.',
      )
    }
    initialFit = fit(options.initialViewport)
  }

  if (recipe.behavior !== 'fixed') {
    if (!options.createControls) {
      throw new Error(
        `Blendlink camera behavior is ${recipe.behavior}. Pass createControls(context); ` +
          'Blendlink never imports or injects browser controls on its own.',
      )
    }
    // Resolve the target while the camera is still being prepared. Commit-time
    // activation then performs only the controls constructor and uses a later
    // explicit fit target when the application fitted before activation.
    preparedControlsTarget = lastFitTarget ?? targetPosition()
    if (!options.deferActivation) activate()
  }
  } catch (error) {
    controls = null
    restoreCameraState(camera, beforeInstall)
    throw error
  }

  return {
    camera,
    ...(target ? { target } : {}),
    behavior: recipe.behavior,
    get interactive() { return controls !== null },
    get requiresContinuousFrames() {
      if (!controls) return false
      return typeof controls.requiresContinuousFrames === 'boolean'
        ? controls.requiresContinuousFrames
        : true
    },
    initialFit,
    activate,
    update(deltaSeconds) {
      assertLive(disposed)
      if (deltaSeconds !== undefined && (!Number.isFinite(deltaSeconds) || deltaSeconds < 0)) {
        throw new Error(`Camera controls update needs a non-negative delta in seconds; got ${deltaSeconds}.`)
      }
      controls?.update(deltaSeconds)
    },
    fit(viewport, scope) {
      const report = fit(viewport, scope)
      controls?.saveState?.()
      return report
    },
    reset() {
      assertLive(disposed)
      controls?.reset?.()
    },
    dispose() {
      if (disposed) return
      disposed = true
      controls?.dispose()
      controls = null
    },
  }
}

function closestComposition(recipe: PresentationCameraRecipe, aspect: number) {
  if (recipe.compositions.length === 0) {
    throw new Error('Camera fit cannot run without at least one responsive composition.')
  }
  return recipe.compositions.reduce((best, candidate) => {
    const bestDistance = Math.abs(Math.log(aspect / (best.width / best.height)))
    const candidateDistance = Math.abs(Math.log(aspect / (candidate.width / candidate.height)))
    return candidateDistance < bestDistance ? candidate : best
  })
}

function finiteViewport(viewport: CameraViewport): CameraViewport {
  if (!Number.isFinite(viewport.width) || !Number.isFinite(viewport.height)
      || viewport.width <= 0 || viewport.height <= 0) {
    throw new Error(`Camera viewport needs positive finite width/height; got ${viewport.width}x${viewport.height}.`)
  }
  return viewport
}

function finiteVector(value: readonly [number, number, number], label: string): readonly [number, number, number] {
  if (!value || value.length !== 3 || value.some((entry) => !Number.isFinite(entry))) {
    throw new Error(`${label} must contain three finite world-space numbers.`)
  }
  return value
}

function normalized(value: readonly [number, number, number], label: string): readonly [number, number, number] {
  const checked = finiteVector(value, label)
  const length = Math.hypot(...checked)
  if (length <= 1e-9) throw new Error(`${label} must not be zero-length.`)
  return [checked[0] / length, checked[1] / length, checked[2] / length]
}

function distance(a: readonly [number, number, number], b: readonly [number, number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
}

function subtractScaled(
  origin: readonly [number, number, number],
  direction: readonly [number, number, number],
  distanceAlong: number,
): readonly [number, number, number] {
  return [
    origin[0] - direction[0] * distanceAlong,
    origin[1] - direction[1] * distanceAlong,
    origin[2] - direction[2] * distanceAlong,
  ]
}

function readVector(vector: CameraVectorLike): readonly [number, number, number] {
  return [vector.x, vector.y, vector.z]
}

function setVector(vector: CameraVectorLike, value: readonly [number, number, number]): void {
  if (vector.set) vector.set(...value)
  else [vector.x, vector.y, vector.z] = value
}

function orthographicShape(camera: PresentationCameraLike): boolean {
  return [camera.left, camera.right, camera.top, camera.bottom]
    .every((value) => typeof value === 'number' && Number.isFinite(value))
}

function assertClipPlanes(camera: PresentationCameraLike, distanceToFocus: number, radius: number): void {
  const nearest = distanceToFocus - radius
  const farthest = distanceToFocus + radius
  if (typeof camera.near === 'number' && camera.near >= nearest) {
    throw new Error(
      `Auto-fit would clip the subject: camera near=${camera.near}, required below ${nearest.toFixed(3)}. ` +
        'Lower Clip Start on the Blender camera; Blendlink will not silently change depth precision.',
    )
  }
  if (typeof camera.far === 'number' && camera.far <= farthest) {
    throw new Error(
      `Auto-fit would clip the subject: camera far=${camera.far}, required above ${farthest.toFixed(3)}. ` +
        'Raise Clip End on the Blender camera; Blendlink will not silently change it.',
    )
  }
}

interface TransformSnapshot {
  position: readonly [number, number, number]
  quaternion?: readonly [number, number, number, number]
}

interface CameraStateSnapshot extends TransformSnapshot {
  aspect?: number
  zoom?: number
  left?: number
  right?: number
  top?: number
  bottom?: number
}

function snapshotCameraState(camera: PresentationCameraLike): CameraStateSnapshot {
  return {
    ...snapshotTransform(camera),
    ...(typeof camera.aspect === 'number' ? { aspect: camera.aspect } : {}),
    ...(typeof camera.zoom === 'number' ? { zoom: camera.zoom } : {}),
    ...(typeof camera.left === 'number' ? { left: camera.left } : {}),
    ...(typeof camera.right === 'number' ? { right: camera.right } : {}),
    ...(typeof camera.top === 'number' ? { top: camera.top } : {}),
    ...(typeof camera.bottom === 'number' ? { bottom: camera.bottom } : {}),
  }
}

function restoreCameraState(camera: PresentationCameraLike, snapshot: CameraStateSnapshot): void {
  restoreTransform(camera, snapshot)
  for (const key of ['aspect', 'zoom', 'left', 'right', 'top', 'bottom'] as const) {
    if (snapshot[key] !== undefined) camera[key] = snapshot[key]
  }
  camera.updateProjectionMatrix?.()
  camera.updateMatrixWorld?.(true)
}

function snapshotTransform(camera: PresentationCameraLike): TransformSnapshot {
  const quaternion = camera.quaternion
  return {
    position: readVector(camera.position),
    ...(quaternion ? { quaternion: [quaternion.x, quaternion.y, quaternion.z, quaternion.w] } : {}),
  }
}

function restoreTransform(camera: PresentationCameraLike, snapshot: TransformSnapshot): void {
  setVector(camera.position, snapshot.position)
  if (snapshot.quaternion && camera.quaternion) {
    if (camera.quaternion.set) camera.quaternion.set(...snapshot.quaternion)
    else [
      camera.quaternion.x,
      camera.quaternion.y,
      camera.quaternion.z,
      camera.quaternion.w,
    ] = snapshot.quaternion
  }
}

function assertLive(disposed: boolean): void {
  if (disposed) throw new Error('Blendlink camera controls have been disposed.')
}

function cameraErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
