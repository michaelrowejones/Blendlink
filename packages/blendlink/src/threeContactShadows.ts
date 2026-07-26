import * as THREE from 'three'
import { HorizontalBlurShader } from 'three/addons/shaders/HorizontalBlurShader.js'
import { VerticalBlurShader } from 'three/addons/shaders/VerticalBlurShader.js'
import { GroundedSkybox } from 'three/addons/objects/GroundedSkybox.js'

export type ThreeContactShadowUpdatePolicy = 'static' | 'continuous'

export interface ThreeContactShadowValues {
  /** Fit the receiver to the complete compiled scene instead of using the
   * authored Empty's position and scale. */
  autoFit: boolean
  darkness: number
  opacity: number
  blur: number
  occludeBelowGround: boolean
  backfaceShadows: boolean
  /** Static is Blendlink's artist-first default. It refreshes once and then
   * settles a demand Canvas; continuous matches Needle's per-frame policy. */
  updatePolicy: ThreeContactShadowUpdatePolicy
}

export interface ThreeContactShadowEvidence {
  readonly resolution: number
  readonly refreshes: number
  readonly auxiliaryRenders: number
  readonly specifiedColorAttachmentBytes: number
  readonly hasDepthAttachments: boolean
}

export interface InstallThreeContactShadowsOptions {
  scene: THREE.Scene
  /** The compiled scene root is the auto-fit authority. This deliberately
   * avoids fitting to unrelated website helpers when the site shares a Scene. */
  root: THREE.Object3D
  /** Needle expects Contact Shadows on an Empty/group. Blendlink keeps that
   * authoring model for manual placement and rejects a Mesh loudly. */
  anchor?: THREE.Object3D
  renderer: THREE.WebGLRenderer
  /** The website-owned main camera supplies only its public layer mask; the
   * component never mutates camera layers. */
  camera: THREE.Camera
  values: ThreeContactShadowValues
  requestFrame?(): unknown
  onWarning?(message: string): unknown
  /** Prepare renderer-local resources without registering Canvas context
   * listeners. Defaults to false for backward-compatible immediate behavior. */
  deferActivation?: boolean
}

export interface InstalledThreeContactShadows {
  readonly evidence: ThreeContactShadowEvidence
  /** Idempotently hand an auto-fit helper to the committed Scene and register
   * Canvas context listeners. This synchronous seam lets detached scene
   * preparation remain invisible to the website until commit. */
  activate(scene?: THREE.Scene, camera?: THREE.Camera): void
  /** Safe from both R3F's update hook and a renderer-owning before-render hook.
   * A same-frame second call is suppressed. */
  update(): void
  beforeRender(): void
  isActive(): boolean
  requestRefresh(): void
  dispose(): void
}

interface RendererState {
  target: THREE.WebGLRenderTarget | null
  activeCubeFace: number
  activeMipmapLevel: number
  clearColor: THREE.Color
  clearAlpha: number
  xrEnabled: boolean
  background: THREE.Scene['background']
  overrideMaterial: THREE.Material | null
  matrixWorldAutoUpdate: boolean
}

interface HiddenObject {
  object: THREE.Object3D
  installedVisible: false
}

interface HiddenMaterial {
  material: THREE.Material
  installedVisible: false
}

const TEXTURE_SIZE = 512
const DEPTH_FRAGMENT_SEAM =
  'gl_FragColor = vec4( vec3( 1.0 - fragCoordZ ), opacity );'
const DEPTH_FRAGMENT_REPLACEMENT =
  'gl_FragColor = vec4( vec3( 1.0 ), ( 1.0 - fragCoordZ ) * darkness * opacity * ( gl_FrontFacing ? 1.0 : 0.66 ) );'

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function makeTarget(name: string): THREE.WebGLRenderTarget {
  const target = new THREE.WebGLRenderTarget(TEXTURE_SIZE, TEXTURE_SIZE, {
    depthBuffer: false,
    stencilBuffer: false,
  })
  target.texture.name = name
  target.texture.generateMipmaps = false
  target.texture.minFilter = THREE.LinearFilter
  target.texture.magFilter = THREE.LinearFilter
  return target
}

function makeDepthMaterial(values: ThreeContactShadowValues): THREE.MeshDepthMaterial {
  if (!THREE.ShaderLib.depth.fragmentShader.includes(DEPTH_FRAGMENT_SEAM)) {
    throw new Error(
      'Blendlink Contact Shadows could not find Three.js\' supported depth-shader seam. ' +
        'Use a supported Three release instead of publishing an unverified shadow mask.',
    )
  }
  const material = new THREE.MeshDepthMaterial()
  material.name = 'Blendlink Contact Shadows Depth'
  material.depthTest = false
  material.depthWrite = false
  material.blending = THREE.CustomBlending
  material.blendEquation = THREE.MaxEquation
  material.side = values.backfaceShadows ? THREE.DoubleSide : THREE.FrontSide
  material.userData.blendlinkContactDarkness = {
    value: clamp(finite(values.darkness, 0.5), 0, 20),
  }
  material.onBeforeCompile = (shader) => {
    if (!shader.fragmentShader.includes(DEPTH_FRAGMENT_SEAM)) {
      throw new Error(
        'Blendlink Contact Shadows could not patch Three.js\' depth shader. ' +
          'Disable the component or use a supported Three release.',
      )
    }
    shader.uniforms.darkness = material.userData.blendlinkContactDarkness
    shader.fragmentShader = `
uniform float darkness;
${shader.fragmentShader.replace(DEPTH_FRAGMENT_SEAM, DEPTH_FRAGMENT_REPLACEMENT)}
`
  }
  material.customProgramCacheKey = () =>
    `blendlink-contact-shadows-depth-v1:${values.backfaceShadows ? 'double' : 'front'}`
  return material
}

function makeBlurMaterial(
  direction: 'horizontal' | 'vertical',
): THREE.ShaderMaterial {
  const source = direction === 'horizontal' ? HorizontalBlurShader : VerticalBlurShader
  const material = new THREE.ShaderMaterial({
    name: `Blendlink Contact Shadows ${direction === 'horizontal' ? 'Horizontal' : 'Vertical'} Blur`,
    uniforms: THREE.UniformsUtils.clone(source.uniforms),
    vertexShader: source.vertexShader,
    fragmentShader: source.fragmentShader,
    depthTest: false,
    depthWrite: false,
  })
  return material
}

function expandVisibleRenderableBounds(
  bounds: THREE.Box3,
  object: THREE.Object3D,
  point: THREE.Vector3,
): void {
  if (!object.visible ||
      object.userData.blendlink_auto_fit === false ||
      object.userData.blendlink_contact_shadow === false ||
      (object as THREE.Object3D & { isUI?: boolean }).isUI === true) return

  const mesh = object as THREE.Mesh
  const slots = materials(object)
  const canExpand = mesh.isMesh === true &&
    !(mesh instanceof GroundedSkybox) &&
    !slots.some((material) =>
      (material as THREE.ShadowMaterial).isShadowMaterial === true) &&
    !(slots.length > 0 && slots.every((material) => material.colorWrite === false))
  const geometry = mesh.geometry
  const position = geometry?.getAttribute('position')
  if (canExpand && position) {
    object.updateWorldMatrix(false, false)
    if ((mesh as THREE.InstancedMesh).isInstancedMesh) {
      const instanced = mesh as THREE.InstancedMesh
      if (instanced.boundingBox === null) instanced.computeBoundingBox()
      if (instanced.boundingBox) {
        const objectBounds = instanced.boundingBox.clone().applyMatrix4(object.matrixWorld)
        bounds.union(objectBounds)
      }
    } else {
      for (let index = 0; index < position.count; index += 1) {
        mesh.getVertexPosition(index, point)
        point.applyMatrix4(object.matrixWorld)
        if ([point.x, point.y, point.z].every(Number.isFinite)) bounds.expandByPoint(point)
      }
    }
  }
  for (const child of object.children) {
    expandVisibleRenderableBounds(bounds, child, point)
  }
}

function visibleRenderableBounds(root: THREE.Object3D): THREE.Box3 {
  root.updateWorldMatrix(true, true)
  const bounds = new THREE.Box3().makeEmpty()
  expandVisibleRenderableBounds(bounds, root, new THREE.Vector3())
  return bounds
}

function fitToRoot(
  shadowsRoot: THREE.Group,
  root: THREE.Object3D,
  blur: number,
): void {
  const bounds = visibleRenderableBounds(root)
  if (bounds.isEmpty() ||
      ![bounds.min.x, bounds.min.y, bounds.min.z, bounds.max.x, bounds.max.y, bounds.max.z]
        .every(Number.isFinite)) {
    throw new Error(
      `Contact Shadows could not auto-fit "${root.name || '(unnamed scene root)'}" ` +
        'because it has no finite renderable bounds. Add visible geometry or use a manual Empty.',
    )
  }
  // This intentionally matches Needle 5.1.7's border-avoidance heuristic.
  const expandFactor = Math.max(1, clamp(finite(blur, 4), 0, 100) / 32)
  const sizeX = bounds.max.x - bounds.min.x
  const sizeZ = bounds.max.z - bounds.min.z
  bounds.expandByVector(new THREE.Vector3(
    expandFactor * sizeX,
    0,
    expandFactor * sizeZ,
  ))
  const height = Math.max(0.00001, bounds.max.y - bounds.min.y)
  const offset = Math.max(0.00001, height * 0.002)
  bounds.max.y += offset
  shadowsRoot.position.set(
    (bounds.min.x + bounds.max.x) / 2,
    bounds.min.y - offset,
    (bounds.min.z + bounds.max.z) / 2,
  )
  shadowsRoot.scale.set(
    Math.max(0.00001, bounds.max.x - bounds.min.x),
    Math.max(0.00001, bounds.max.y - bounds.min.y),
    Math.max(0.00001, bounds.max.z - bounds.min.z),
  )
}

function captureRendererState(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
): RendererState {
  return {
    target: renderer.getRenderTarget(),
    activeCubeFace: renderer.getActiveCubeFace(),
    activeMipmapLevel: renderer.getActiveMipmapLevel(),
    clearColor: renderer.getClearColor(new THREE.Color()).clone(),
    clearAlpha: renderer.getClearAlpha(),
    xrEnabled: renderer.xr.enabled,
    background: scene.background,
    overrideMaterial: scene.overrideMaterial,
    matrixWorldAutoUpdate: scene.matrixWorldAutoUpdate,
  }
}

function restoreRendererState(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  state: RendererState,
): unknown[] {
  const errors: unknown[] = []
  try { scene.background = state.background } catch (error) { errors.push(error) }
  try { scene.overrideMaterial = state.overrideMaterial } catch (error) { errors.push(error) }
  try {
    scene.matrixWorldAutoUpdate = state.matrixWorldAutoUpdate
  } catch (error) { errors.push(error) }
  try { renderer.xr.enabled = state.xrEnabled } catch (error) { errors.push(error) }
  try { renderer.setClearColor(state.clearColor, state.clearAlpha) } catch (error) {
    errors.push(error)
  }
  try {
    renderer.setRenderTarget(
      state.target,
      state.activeCubeFace,
      state.activeMipmapLevel,
    )
  } catch (error) { errors.push(error) }
  return errors
}

function materials(object: THREE.Object3D): THREE.Material[] {
  const material = (object as THREE.Mesh).material as
    | THREE.Material | THREE.Material[] | undefined
  return material ? (Array.isArray(material) ? material : [material]) : []
}

function shouldHideFromCapture(object: THREE.Object3D): boolean {
  for (let current: THREE.Object3D | null = object; current; current = current.parent) {
    if (current.userData.blendlink_contact_shadow === false) return true
  }
  if ((object as THREE.Line).isLine ||
      (object as THREE.Points).isPoints ||
      (object as THREE.Sprite).isSprite) return true
  const slots = materials(object)
  return slots.length > 0 && slots.every((material) =>
    material.colorWrite === false ||
    (material as THREE.MeshBasicMaterial).wireframe === true ||
    (material as THREE.LineBasicMaterial).isLineBasicMaterial === true ||
      (material as THREE.PointsMaterial).isPointsMaterial === true)
}

function hideUnsupportedObjects(
  scene: THREE.Scene,
  helper: THREE.Object3D,
): { objects: HiddenObject[]; materials: HiddenMaterial[] } {
  const hidden: HiddenObject[] = []
  const hiddenMaterials: HiddenMaterial[] = []
  const hiddenRoots = new Set<THREE.Object3D>()
  scene.traverse((object) => {
    if (!object.visible || isPartOf(object, helper)) return
    for (let current = object.parent; current; current = current.parent) {
      if (hiddenRoots.has(current)) return
    }
    if (shouldHideFromCapture(object)) {
      object.visible = false
      hidden.push({ object, installedVisible: false })
      hiddenRoots.add(object)
      return
    }
    // Needle removes transparent render-list entries. Toggle the public
    // material visibility seam instead, preserving opaque groups on a mixed
    // material mesh without mutating renderer-private lists.
    for (const material of materials(object)) {
      if ((material.transparent || material.allowOverride === false) && material.visible) {
        material.visible = false
        hiddenMaterials.push({ material, installedVisible: false })
      }
    }
  })
  return { objects: hidden, materials: hiddenMaterials }
}

function restoreHiddenObjects(
  hidden: readonly HiddenObject[],
  hiddenMaterials: readonly HiddenMaterial[],
): unknown[] {
  const errors: unknown[] = []
  for (const entry of hidden) {
    try {
      // A website that took ownership during renderer.render wins.
      if (entry.object.visible === entry.installedVisible) entry.object.visible = true
    } catch (error) { errors.push(error) }
  }
  for (const entry of hiddenMaterials) {
    try {
      if (entry.material.visible === entry.installedVisible) entry.material.visible = true
    } catch (error) { errors.push(error) }
  }
  return errors
}

function isPartOf(object: THREE.Object3D, ancestor: THREE.Object3D): boolean {
  for (let current: THREE.Object3D | null = object; current; current = current.parent) {
    if (current === ancestor) return true
  }
  return false
}

function updateShadowCamera(
  camera: THREE.OrthographicCamera,
): void {
  if (camera.parent) camera.matrixWorld.multiplyMatrices(camera.parent.matrixWorld, camera.matrix)
  else camera.matrixWorld.copy(camera.matrix)
  camera.matrixWorldInverse.copy(camera.matrixWorld).invert()
}

function throwWithRestoreErrors(error: unknown, restoreErrors: readonly unknown[]): never {
  if (restoreErrors.length === 0) throw error
  throw new Error(
    `Blendlink Contact Shadows failed: ${message(error)}. ` +
      `Renderer restoration also failed: ${restoreErrors.map(message).join('; ')}`,
    { cause: error },
  )
}

/** Install Needle-compatible planar contact shadows while preserving website
 * ownership of the Scene, renderer, Canvas, and render loop. Blendlink exceeds
 * the pinned implementation by using depthless targets, public traversal, an
 * exact transactional renderer restore, and a truthful static update policy. */
export function installThreeContactShadows(
  options: InstallThreeContactShadowsOptions,
): InstalledThreeContactShadows {
  const { scene, root, anchor, renderer, camera, values } = options
  if (values.updatePolicy !== 'static' && values.updatePolicy !== 'continuous') {
    throw new Error(
      `Contact Shadows uses unsupported update policy ${JSON.stringify(values.updatePolicy)}.`,
    )
  }
  if (!values.autoFit && !anchor) {
    throw new Error(
      'Manual Contact Shadows needs an Empty/group target. Enable Fit to Scene ' +
        'or move the component from the Scene to an Empty.',
    )
  }
  if (anchor && (anchor as THREE.Mesh).isMesh) {
    throw new Error(
      `Contact Shadows target "${anchor.name || '(unnamed)'}" is a Mesh. ` +
        'Attach it to an Empty/group so the authored transform can define the receiver volume.',
    )
  }

  const renderTarget = makeTarget('Blendlink Contact Shadows')
  const blurTarget = makeTarget('Blendlink Contact Shadows Blur')
  const planeGeometry = new THREE.PlaneGeometry(1, 1).rotateX(Math.PI / 2)
  const depthMaterial = makeDepthMaterial(values)
  const horizontalBlurMaterial = makeBlurMaterial('horizontal')
  const verticalBlurMaterial = makeBlurMaterial('vertical')
  const planeMaterial = new THREE.MeshBasicMaterial({
    name: 'Blendlink Contact Shadows Plane',
    map: renderTarget.texture,
    opacity: clamp(finite(values.opacity, 0.5), 0, 1),
    color: 0x000000,
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
  })
  const occluderMaterial = new THREE.MeshBasicMaterial({
    name: 'Blendlink Contact Shadows Occluder',
    depthWrite: true,
    stencilWrite: true,
    colorWrite: false,
    side: THREE.BackSide,
  })
  const shadowsRoot = new THREE.Group()
  shadowsRoot.name = 'Blendlink Contact Shadows Root'
  shadowsRoot.userData.blendlink_internal = true
  shadowsRoot.userData.blendlink_contact_shadow = false
  const shadowGroup = new THREE.Group()
  shadowGroup.name = 'Blendlink Contact Shadows Capture'
  shadowsRoot.add(shadowGroup)

  const plane = new THREE.Mesh(planeGeometry, planeMaterial)
  plane.name = 'Blendlink Contact Shadows Plane'
  plane.scale.y = -1
  plane.renderOrder = 1
  plane.layers.mask = camera.layers.mask
  shadowsRoot.add(plane)

  const occluder = new THREE.Mesh(planeGeometry, occluderMaterial)
  occluder.name = 'Blendlink Contact Shadows Occluder'
  occluder.position.y = -0.0001
  occluder.renderOrder = -100
  occluder.visible = values.occludeBelowGround
  occluder.layers.mask = camera.layers.mask
  shadowsRoot.add(occluder)

  const blurPlane = new THREE.Mesh(planeGeometry, horizontalBlurMaterial)
  blurPlane.name = 'Blendlink Contact Shadows Blur Plane'
  blurPlane.visible = false
  shadowGroup.add(blurPlane)

  const shadowCamera = new THREE.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, 0, 1)
  shadowCamera.name = 'Blendlink Contact Shadows Camera'
  shadowCamera.layers.enableAll()
  shadowCamera.rotation.x = Math.PI / 2
  shadowCamera.matrixWorldAutoUpdate = false
  shadowCamera.updateMatrix()
  shadowGroup.add(shadowCamera)
  shadowGroup.visible = false

  let parent: THREE.Object3D
  try {
    if (values.autoFit) {
      fitToRoot(shadowsRoot, root, values.blur)
      parent = scene
    } else {
      parent = anchor!
    }
    parent.add(shadowsRoot)
  } catch (error) {
    renderTarget.dispose()
    blurTarget.dispose()
    planeGeometry.dispose()
    depthMaterial.dispose()
    horizontalBlurMaterial.dispose()
    verticalBlurMaterial.dispose()
    planeMaterial.dispose()
    occluderMaterial.dispose()
    throw error
  }

  const surface = renderer.domElement
  let dirty = true
  let contextLost = false
  let disposed = false
  let activated = false
  let resourcesDisposed = false
  let suppressNextBeforeRender = false
  let suppressionGeneration = 0
  let refreshRequestGeneration = 0
  let refreshes = 0
  let auxiliaryRenders = 0
  let renderingScene = scene
  let renderingCamera = camera

  const warn = (warning: string): void => {
    try { options.onWarning?.(warning) } catch {
      // Diagnostics must never break context recovery or cleanup.
    }
  }
  const requestFrame = (): void => {
    try { options.requestFrame?.() } catch (error) {
      warn(`Contact Shadows could not request a website frame: ${message(error)}.`)
    }
  }

  const contextLostListener = (): void => {
    contextLost = true
    dirty = true
    refreshRequestGeneration += 1
    suppressNextBeforeRender = false
    suppressionGeneration += 1
  }
  const contextRestoredListener = (): void => {
    contextLost = false
    dirty = true
    refreshRequestGeneration += 1
    suppressNextBeforeRender = false
    suppressionGeneration += 1
    requestFrame()
  }
  let lostListenerRegistered = false
  let restoredListenerRegistered = false
  const ownedResources: Array<{ dispose(): void }> = [
    renderTarget,
    blurTarget,
    planeGeometry,
    depthMaterial,
    horizontalBlurMaterial,
    verticalBlurMaterial,
    planeMaterial,
    occluderMaterial,
  ]
  const disposeOwned = (): unknown[] => {
    const errors: unknown[] = []
    if (restoredListenerRegistered) {
      try {
        surface.removeEventListener('webglcontextrestored', contextRestoredListener)
      } catch (error) { errors.push(error) }
      restoredListenerRegistered = false
    }
    if (lostListenerRegistered) {
      try {
        surface.removeEventListener('webglcontextlost', contextLostListener)
      } catch (error) { errors.push(error) }
      lostListenerRegistered = false
    }
    try { shadowsRoot.removeFromParent() } catch (error) { errors.push(error) }
    if (!resourcesDisposed) {
      resourcesDisposed = true
      for (const resource of ownedResources) {
        try { resource.dispose() } catch (error) { errors.push(error) }
      }
    }
    return errors
  }
  const activate = (
    nextScene: THREE.Scene = scene,
    nextCamera: THREE.Camera = camera,
  ): void => {
    if (disposed) throw new Error('These Blendlink Contact Shadows have been disposed.')
    if (activated) return
    try {
      if (!nextScene?.isScene) {
        throw new Error('Contact Shadows activation needs the committed Three.js Scene.')
      }
      if (!nextCamera?.isCamera) {
        throw new Error('Contact Shadows activation needs the committed Three.js camera.')
      }
      renderingScene = nextScene
      renderingCamera = nextCamera
      // Auto-fit helpers belong directly to a Scene, not to the imported GLTF
      // root. Move this one owned helper from private preparation to the live
      // Scene synchronously. A manual helper stays under its authored Empty,
      // which transfers with the compiled root.
      if (values.autoFit && shadowsRoot.parent !== nextScene) {
        nextScene.add(shadowsRoot)
      }
      plane.layers.mask = renderingCamera.layers.mask
      occluder.layers.mask = renderingCamera.layers.mask
      surface.addEventListener('webglcontextlost', contextLostListener)
      lostListenerRegistered = true
      surface.addEventListener('webglcontextrestored', contextRestoredListener)
      restoredListenerRegistered = true
      activated = true
    } catch (error) {
      disposed = true
      const cleanupErrors = disposeOwned()
      if (cleanupErrors.length > 0) {
        throw new Error(
          `Could not activate Contact Shadows listeners: ${message(error)}. ` +
            `Rollback also failed: ${cleanupErrors.map(message).join('; ')}`,
          { cause: error },
        )
      }
      throw error
    }
  }

  const blurOnce = (amount: number): void => {
    blurPlane.visible = true
    const worldScale = shadowsRoot.getWorldScale(new THREE.Vector3())
    const average = Math.max(0.00001, (Math.abs(worldScale.x) + Math.abs(worldScale.z)) / 2)
    const aspectX = Math.abs(worldScale.z) / average
    const aspectZ = Math.abs(worldScale.x) / average

    blurPlane.material = horizontalBlurMaterial
    horizontalBlurMaterial.uniforms.tDiffuse!.value = renderTarget.texture
    horizontalBlurMaterial.uniforms.h!.value =
      amount / TEXTURE_SIZE * aspectX
    renderer.setRenderTarget(blurTarget)
    renderer.render(blurPlane, shadowCamera)
    auxiliaryRenders += 1

    blurPlane.material = verticalBlurMaterial
    verticalBlurMaterial.uniforms.tDiffuse!.value = blurTarget.texture
    verticalBlurMaterial.uniforms.v!.value =
      amount / TEXTURE_SIZE * aspectZ
    renderer.setRenderTarget(renderTarget)
    renderer.render(blurPlane, shadowCamera)
    auxiliaryRenders += 1
    blurPlane.visible = false
  }

  const refresh = (): boolean => {
    if (disposed) throw new Error('These Blendlink Contact Shadows have been disposed.')
    if (!activated) return false
    if (contextLost) return false
    if (values.updatePolicy === 'static' && !dirty) return false

    const requestGenerationAtStart = refreshRequestGeneration
    const rendererState = captureRendererState(renderer, renderingScene)
    const planeWasVisible = plane.visible
    const occluderWasVisible = occluder.visible
    const groupWasVisible = shadowGroup.visible
    const blurWasVisible = blurPlane.visible
    const blurMaterial = blurPlane.material
    let hidden: HiddenObject[] = []
    let hiddenMaterials: HiddenMaterial[] = []
    let operationError: unknown
    try {
      planeMaterial.opacity = clamp(finite(values.opacity, 0.5), 0, 1)
      const darkness = depthMaterial.userData.blendlinkContactDarkness as
        | { value: number } | undefined
      if (darkness) darkness.value = clamp(finite(values.darkness, 0.5), 0, 20)
      depthMaterial.side = values.backfaceShadows ? THREE.DoubleSide : THREE.FrontSide

      renderingScene.updateMatrixWorld(true)
      updateShadowCamera(shadowCamera)
      shadowGroup.visible = true
      plane.visible = false
      occluder.visible = false
      blurPlane.visible = false
      const hiddenState = hideUnsupportedObjects(renderingScene, shadowsRoot)
      hidden = hiddenState.objects
      hiddenMaterials = hiddenState.materials

      renderingScene.background = null
      renderingScene.overrideMaterial = depthMaterial
      renderingScene.matrixWorldAutoUpdate = false
      renderer.xr.enabled = false
      renderer.setClearAlpha(0)
      renderer.setRenderTarget(renderTarget)
      renderer.clear()
      renderer.render(renderingScene, shadowCamera)
      auxiliaryRenders += 1

      // Blur renders their own ShaderMaterial directly; the application Scene's
      // override is restored transactionally after all five auxiliary renders.
      const blurAmount = Math.max(clamp(finite(values.blur, 4), 0, 100), 0.05)
      blurOnce(blurAmount * 2)
      blurOnce(blurAmount * 0.5)
      refreshes += 1
      dirty = refreshRequestGeneration !== requestGenerationAtStart
    } catch (error) {
      operationError = error
      dirty = true
      refreshRequestGeneration += 1
    }

    const restoreErrors: unknown[] = []
    restoreErrors.push(...restoreHiddenObjects(hidden, hiddenMaterials))
    try { shadowGroup.visible = groupWasVisible } catch (error) { restoreErrors.push(error) }
    try { plane.visible = planeWasVisible } catch (error) { restoreErrors.push(error) }
    try {
      occluder.visible = occluderWasVisible
    } catch (error) { restoreErrors.push(error) }
    try { blurPlane.visible = blurWasVisible } catch (error) { restoreErrors.push(error) }
    try { blurPlane.material = blurMaterial } catch (error) { restoreErrors.push(error) }
    restoreErrors.push(...restoreRendererState(renderer, renderingScene, rendererState))

    if (operationError !== undefined) throwWithRestoreErrors(operationError, restoreErrors)
    if (restoreErrors.length > 0) {
      throw new Error(
        `Blendlink Contact Shadows rendered, but renderer restoration failed: ` +
          restoreErrors.map(message).join('; '),
      )
    }
    return true
  }

  const evidence: ThreeContactShadowEvidence = {
    resolution: TEXTURE_SIZE,
    get refreshes() { return refreshes },
    get auxiliaryRenders() { return auxiliaryRenders },
    // Two RGBA8 color targets. Unlike Needle 5.1.7, neither allocates an
    // unused depth or stencil attachment.
    specifiedColorAttachmentBytes: TEXTURE_SIZE * TEXTURE_SIZE * 4 * 2,
    hasDepthAttachments: false,
  }

  const installed: InstalledThreeContactShadows = {
    evidence,
    activate,
    update() {
      plane.layers.mask = renderingCamera.layers.mask
      occluder.layers.mask = renderingCamera.layers.mask
      const refreshed = refresh()
      // installThreeComponents.render() invokes beforeRender after update in a
      // renderer-owning path. Suppress that one duplicate without preventing
      // a later render-only host from refreshing. The microtask bounds the
      // suppression to this synchronous host frame.
      if (refreshed) {
        suppressNextBeforeRender = true
        const generation = ++suppressionGeneration
        queueMicrotask(() => {
          if (suppressionGeneration === generation) suppressNextBeforeRender = false
        })
      }
    },
    beforeRender() {
      plane.layers.mask = renderingCamera.layers.mask
      occluder.layers.mask = renderingCamera.layers.mask
      if (suppressNextBeforeRender) {
        suppressNextBeforeRender = false
        suppressionGeneration += 1
        return
      }
      refresh()
    },
    isActive() {
      return !disposed && activated && !contextLost &&
        (values.updatePolicy === 'continuous' || dirty)
    },
    requestRefresh() {
      if (disposed) throw new Error('These Blendlink Contact Shadows have been disposed.')
      dirty = true
      refreshRequestGeneration += 1
      suppressNextBeforeRender = false
      suppressionGeneration += 1
      if (activated) requestFrame()
    },
    dispose() {
      if (disposed) return
      disposed = true
      const errors = disposeOwned()
      if (errors.length > 0) {
        throw new Error(
          `Blendlink Contact Shadows cleanup failed: ${errors.map(message).join('; ')}`,
        )
      }
    },
  }
  if (!options.deferActivation) installed.activate()
  return installed
}
