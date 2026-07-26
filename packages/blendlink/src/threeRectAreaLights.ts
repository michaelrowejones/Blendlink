import * as THREE from 'three'
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js'

const DESCRIPTOR_KEY = 'blendlink_rect_area_light'
const INSTALLATION_SLOT = Symbol.for('blendlink.threeRectAreaLights.installation.v1')
const AXIS_EPSILON = 1e-8
const ORTHOGONAL_TOLERANCE = 1e-5

const LTC_SLOT_NAMES = [
  'LTC_FLOAT_1',
  'LTC_FLOAT_2',
  'LTC_HALF_1',
  'LTC_HALF_2',
] as const

type LtcSlotName = typeof LTC_SLOT_NAMES[number]
type LtcUniforms = typeof THREE.UniformsLib & Partial<Record<LtcSlotName, THREE.Texture>>

type RectAreaLightDescriptor = Readonly<{
  color: readonly [number, number, number]
  size: readonly [number, number]
  strength: Readonly<{ kind: 'power' | 'intensity'; value: number }>
}>

type PlannedRectAreaLight = Readonly<{
  marker: THREE.Object3D
  descriptor: RectAreaLightDescriptor
}>

type InstalledLight = Readonly<{
  marker: THREE.Object3D
  light: THREE.RectAreaLight
  descriptor: RectAreaLightDescriptor
  token: symbol
}>

type NextLightState = Readonly<{
  entry: InstalledLight
  width: number
  height: number
  intensity: number
}>

type LtcTextures = Readonly<Record<LtcSlotName, THREE.Texture>>

interface RectAreaLightThreePeer {
  readonly WebGLRenderer: typeof THREE.WebGLRenderer
  readonly RectAreaLight: typeof THREE.RectAreaLight
  readonly UniformsLib: LtcUniforms
}

interface RectAreaLightUniformsModule {
  readonly RectAreaLightUniformsLib: { init(): void }
}

export interface ThreeRectAreaLightReport {
  /** Authored descriptors installed beneath this compiled root. */
  readonly lightsConfigured: number
  /** Unique visible MeshStandard/Physical material instances beneath this
   * compiled root after baked materials and Components finalize. This is not
   * a mesh/object count and does not inspect application-owned scene siblings. */
  readonly supportedReceiverCount: number
  /** Unique visible non-PBR material instances beneath this compiled root.
   * Appearance MeshBasic materials are expected here and remain unchanged. */
  readonly unsupportedReceiverCount: number
}

export interface InstalledThreeRectAreaLights {
  readonly report: ThreeRectAreaLightReport
  /** Recompute authored rectangle dimensions after application/animation transforms. */
  sync(): void
  /** Package-owned installer seam. Call only after baked materials and Components settle. */
  auditReceivers(): void
  dispose(): void
}

export interface InstallThreeRectAreaLightsOptions {
  signal?: AbortSignal
  /** Default true. False retains lazy shared LTC initialization for runtime
   * correctness but leaves GPU upload to Three's first render. */
  prewarm?: boolean
  onWarning?(message: string): unknown
}

interface RectAreaLightRuntime {
  install(
    root: THREE.Object3D,
    renderer: THREE.WebGLRenderer,
    options?: InstallThreeRectAreaLightsOptions,
  ): Promise<InstalledThreeRectAreaLights>
}

function abortError(): Error {
  const error = new Error('Blendlink Rect Area light installation was canceled.')
  error.name = 'AbortError'
  return error
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortError()
}

function own(object: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(object, key)
}

function requiredFiniteNumber(value: unknown, label: string, positive: boolean): number {
  if (typeof value !== 'number' || !Number.isFinite(value)
      || (positive ? value <= 0 : value < 0)) {
    throw new Error(
      `${label} must be a finite ${positive ? 'positive' : 'non-negative'} number; received ${String(value)}.`,
    )
  }
  return value
}

function requiredTuple(
  value: unknown,
  length: number,
  label: string,
  positive: boolean,
): number[] {
  if (!Array.isArray(value) || value.length !== length) {
    throw new Error(`${label} must contain exactly ${length} numbers.`)
  }
  return value.map((entry, index) =>
    requiredFiniteNumber(entry, `${label}[${index}]`, positive))
}

function parseDescriptor(marker: THREE.Object3D, value: unknown): RectAreaLightDescriptor {
  const label = `Blendlink Rect Area light marker "${marker.name || marker.uuid}"`
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} has a non-object ${DESCRIPTOR_KEY} descriptor.`)
  }
  const payload = value as Record<string, unknown>
  if (payload.schemaVersion !== 1) {
    throw new Error(
      `${label} has unsupported ${DESCRIPTOR_KEY} schemaVersion ${String(payload.schemaVersion)}; expected exactly 1.`,
    )
  }
  const color = requiredTuple(payload.color, 3, `${label} color`, false)
  const size = requiredTuple(payload.size, 2, `${label} size`, true)
  const hasPower = own(payload, 'power')
  const hasIntensity = own(payload, 'intensity')
  if (hasPower === hasIntensity) {
    throw new Error(`${label} must contain exactly one of power or intensity.`)
  }
  const kind = hasPower ? 'power' : 'intensity'
  const strength = requiredFiniteNumber(payload[kind], `${label} ${kind}`, false)
  return {
    color: color as [number, number, number],
    size: size as [number, number],
    strength: { kind, value: strength },
  }
}

function plannedLights(root: THREE.Object3D): PlannedRectAreaLight[] {
  const plans: PlannedRectAreaLight[] = []
  root.traverse((marker) => {
    const userData = marker.userData
    if (!userData || !own(userData, DESCRIPTOR_KEY)) return
    plans.push({ marker, descriptor: parseDescriptor(marker, userData[DESCRIPTOR_KEY]) })
  })
  return plans
}

function markerLabel(marker: THREE.Object3D): string {
  return marker.name || marker.uuid
}

function validateTransform(marker: THREE.Object3D): void {
  marker.updateWorldMatrix(true, false)
  const e = marker.matrixWorld.elements
  if (e.some((value) => !Number.isFinite(value))) {
    throw new Error(`Blendlink Rect Area light marker "${markerLabel(marker)}" has a non-finite world transform.`)
  }
  const x = new THREE.Vector3(e[0], e[1], e[2])
  const y = new THREE.Vector3(e[4], e[5], e[6])
  const z = new THREE.Vector3(e[8], e[9], e[10])
  const sx = x.length()
  const sy = y.length()
  const sz = z.length()
  if (sx <= AXIS_EPSILON || sy <= AXIS_EPSILON || sz <= AXIS_EPSILON) {
    throw new Error(
      `Blendlink Rect Area light marker "${markerLabel(marker)}" has a singular world transform. ` +
        'Use finite positive scale on every axis.',
    )
  }
  x.multiplyScalar(1 / sx)
  y.multiplyScalar(1 / sy)
  z.multiplyScalar(1 / sz)
  // Three's RectArea path constructs its half-width/half-height vectors from
  // the normalized world X/Y columns only. Match the Blender producer's
  // emitter-plane contract exactly: Z shear is harmless here, while X/Y shear
  // changes the rectangle itself and remains a refusal.
  if (Math.abs(x.dot(y)) > ORTHOGONAL_TOLERANCE) {
    throw new Error(
      `Blendlink Rect Area light marker "${markerLabel(marker)}" has sheared world X/Y emitter axes. ` +
        'Apply or remove that shear so the emitted rectangle remains orthogonal.',
    )
  }
  if (x.dot(new THREE.Vector3().crossVectors(y, z)) <= 0) {
    throw new Error(
      `Blendlink Rect Area light marker "${markerLabel(marker)}" has a reflected world transform. ` +
        'Remove negative scale before publishing or keep the Area light bake-only.',
    )
  }
}

function nextLightState(entry: InstalledLight): NextLightState {
  validateTransform(entry.marker)
  const e = entry.marker.matrixWorld.elements
  const width = entry.descriptor.size[0] * Math.hypot(e[0], e[1], e[2])
  const height = entry.descriptor.size[1] * Math.hypot(e[4], e[5], e[6])
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
    throw new Error(
      `Blendlink Rect Area light marker "${markerLabel(entry.marker)}" produced non-finite or zero ` +
        `world dimensions (${String(width)} x ${String(height)}). Use representable positive source sizes and scales.`,
    )
  }
  let intensity = entry.descriptor.strength.value
  if (entry.descriptor.strength.kind === 'power') {
    const powerArea = width * height * Math.PI
    intensity = entry.descriptor.strength.value / powerArea
    if (!Number.isFinite(powerArea) || powerArea <= 0 || !Number.isFinite(intensity)
        || (entry.descriptor.strength.value > 0 && intensity === 0)) {
      throw new Error(
        `Blendlink Rect Area light marker "${markerLabel(entry.marker)}" produced an unrepresentable ` +
          'power-to-area intensity. Use less extreme source dimensions, scale, or power.',
      )
    }
  }
  return { entry, width, height, intensity }
}

function applyLightStates(states: readonly NextLightState[]): void {
  for (const state of states) {
    state.entry.light.width = state.width
    state.entry.light.height = state.height
    state.entry.light.intensity = state.intensity
  }
}

function syncLights(entries: readonly InstalledLight[]): void {
  // Calculate the entire set before touching a light. A late invalid marker
  // cannot leave earlier lights partially advanced to a new transform.
  applyLightStates(entries.map(nextLightState))
}

function ltcState(uniforms: LtcUniforms):
  | { kind: 'absent' }
  | { kind: 'partial'; present: LtcSlotName[] }
  | { kind: 'complete'; textures: LtcTextures } {
  const present = LTC_SLOT_NAMES.filter((name) => uniforms[name] != null)
  if (present.length === 0) return { kind: 'absent' }
  if (present.length !== LTC_SLOT_NAMES.length) return { kind: 'partial', present }
  const entries = LTC_SLOT_NAMES.map((name) => [name, uniforms[name]] as const)
  const invalid = entries.filter(([, texture]) => texture?.isTexture !== true).map(([name]) => name)
  if (invalid.length > 0) {
    throw new Error(
      `Three's Rect Area LTC globals are not Texture instances (${invalid.join(', ')}). ` +
        'Align the application and Blendlink to one evaluated Three peer before installing the scene.',
    )
  }
  return { kind: 'complete', textures: Object.fromEntries(entries) as unknown as LtcTextures }
}

function sameLtcTextures(left: LtcTextures, right: LtcTextures): boolean {
  return LTC_SLOT_NAMES.every((name) => left[name] === right[name])
}

function lightingAtlasReceivers(root: THREE.Object3D): string[] {
  const receivers = new Set<string>()
  root.traverse((object) => {
    if ((object as THREE.Mesh).isMesh !== true) return
    for (let current: THREE.Object3D | null = object; current; current = current.parent) {
      if (current.userData?.blendlink_bake_output === 'lighting') {
        receivers.add(markerLabel(object))
        break
      }
      if (current === root) break
    }
  })
  return [...receivers]
}

function isEffectivelyVisible(object: THREE.Object3D, root: THREE.Object3D): boolean {
  for (let current: THREE.Object3D | null = object; current; current = current.parent) {
    if (!current.visible) return false
    if (current === root) return true
  }
  return false
}

function receiverCounts(root: THREE.Object3D): { supported: number; unsupported: number } {
  const supported = new Set<THREE.Material>()
  const unsupported = new Set<THREE.Material>()
  root.traverse((object) => {
    const mesh = object as THREE.Mesh
    if (mesh.isMesh !== true || !isEffectivelyVisible(mesh, root)) return
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const material of materials) {
      if (!material?.isMaterial || !material.visible) continue
      const pbr = material as THREE.MeshStandardMaterial & THREE.MeshPhysicalMaterial
      if (pbr.isMeshStandardMaterial === true || pbr.isMeshPhysicalMaterial === true) {
        supported.add(material)
      } else {
        unsupported.add(material)
      }
    }
  })
  return { supported: supported.size, unsupported: unsupported.size }
}

function activeInstallation(marker: THREE.Object3D): unknown {
  return Reflect.get(marker, INSTALLATION_SLOT)
}

function createRuntime(
  peer: RectAreaLightThreePeer,
  loadLtcModule: () => Promise<RectAreaLightUniformsModule>,
): RectAreaLightRuntime {
  let ltcInitialization: Promise<LtcTextures> | null = null

  const ensureLtcTextures = (): Promise<LtcTextures> => {
    if (!ltcInitialization) {
      const pending = (async () => {
        let state = ltcState(peer.UniformsLib)
        if (state.kind === 'partial') {
          throw new Error(
            `Three's Rect Area LTC globals are only partially initialized (${state.present.join(', ')}). ` +
              'Blendlink will not replace application-owned shader textures. Align Three versions/aliases, ' +
              'remove the competing initializer, and reload the page.',
          )
        }
        if (state.kind === 'complete') return state.textures

        let module: RectAreaLightUniformsModule
        try {
          module = await loadLtcModule()
        } catch (error) {
          if (error instanceof Error && error.name === 'AbortError') throw error
          const detail = error instanceof Error ? error.message : String(error)
          throw new Error(
            'Blendlink could not access Three RectArea LTC support from the installed Three peer. ' +
              `Align the application and Blendlink Three versions, then retry. ${detail}`,
          )
        }
        // A second evaluated Blendlink module may have completed initialization
        // while the initializer provider settled. Re-check before calling the
        // allocation-heavy, non-idempotent Three initializer.
        state = ltcState(peer.UniformsLib)
        if (state.kind === 'partial') {
          throw new Error(
            `Three's Rect Area LTC globals became partially initialized (${state.present.join(', ')}). ` +
              'A competing Three/RectAreaLight initializer owns only part of the shared shader state.',
          )
        }
        if (state.kind === 'absent') module.RectAreaLightUniformsLib.init()
        state = ltcState(peer.UniformsLib)
        if (state.kind !== 'complete') {
          throw new Error(
            'Three RectAreaLightUniformsLib.init() did not publish all four LTC textures. ' +
              'Check that Blendlink and the renderer resolve the same Three peer.',
          )
        }
        return state.textures
      })()
      ltcInitialization = pending
      // Import/CSP/initializer failures are recoverable installation failures.
      // Every concurrent subscriber still observes this rejection, while a
      // later explicit retry re-evaluates the shared Three globals instead of
      // inheriting a permanently poisoned Promise.
      void pending.catch(() => {
        if (ltcInitialization === pending) ltcInitialization = null
      })
    }
    return ltcInitialization.then((expected) => {
      const current = ltcState(peer.UniformsLib)
      if (current.kind !== 'complete' || !sameLtcTextures(current.textures, expected)) {
        throw new Error(
          'Three Rect Area LTC texture ownership changed after Blendlink initialized it. ' +
            'A duplicate Three peer or non-idempotent RectAreaLightUniformsLib.init() call replaced shared ' +
            'shader state; dedupe/alias `three` and initialize Rect Area lights through Blendlink only.',
        )
      }
      return expected
    })
  }

  return {
    async install(root, renderer, options = {}) {
      throwIfAborted(options.signal)
      const plans = plannedLights(root)
      if (plans.length === 0) {
        const report: ThreeRectAreaLightReport = Object.freeze({
          lightsConfigured: 0,
          supportedReceiverCount: 0,
          unsupportedReceiverCount: 0,
        })
        return { report, sync() {}, auditReceivers() {}, dispose() {} }
      }

      // Validate the complete authored set before importing LTC data or
      // mutating markers. A malformed second light cannot leave a first light
      // partially configured.
      for (const plan of plans) {
        validateTransform(plan.marker)
        if (activeInstallation(plan.marker) !== undefined) {
          throw new Error(
            `Blendlink Rect Area light marker "${markerLabel(plan.marker)}" already has an active installation. ` +
              'Dispose the previous scene handle before reinstalling it.',
          )
        }
        if ((plan.marker as THREE.Light).isLight === true) {
          throw new Error(
            `Blendlink Rect Area descriptor marker "${markerLabel(plan.marker)}" is already a Three light. ` +
              'A tampered punctual-light node cannot also own a Rect Area child.',
          )
        }
        if (plan.marker.children.some((child) => (child as THREE.RectAreaLight).isRectAreaLight === true)) {
          throw new Error(
            `Blendlink Rect Area descriptor marker "${markerLabel(plan.marker)}" already contains a RectAreaLight. ` +
              'Remove the application-created duplicate and let Blendlink own the authored lowering.',
          )
        }
      }

      const lightingReceivers = lightingAtlasReceivers(root)
      if (lightingReceivers.length > 0) {
        const sample = lightingReceivers.slice(0, 3).map((name) => `"${name}"`).join(', ')
        const remainder = lightingReceivers.length > 3
          ? ` and ${lightingReceivers.length - 3} more`
          : ''
        throw new Error(
          `Blendlink will not install authored Rect Area direct lights over a Lighting atlas without ` +
            `compiled per-light bake-exclusion evidence. Probable double illumination affects ${sample}${remainder}. ` +
            'Keep these Area lights bake-only, use Appearance for static baked surfaces with explicit live PBR ' +
            'exceptions, or author a portable Point/Spot/Sun light. Re-sync after choosing one contract.',
        )
      }

      if (!(renderer instanceof peer.WebGLRenderer)) {
        throw new Error(
          'Blendlink Rect Area lights require the renderer and Blendlink runtime to share one evaluated Three peer. ' +
            'The supplied WebGLRenderer comes from another copy. Dedupe/alias `three` in the site bundler and align ' +
            'the application version with Blendlink before publishing.',
        )
      }

      throwIfAborted(options.signal)
      const ltc = await ensureLtcTextures()
      throwIfAborted(options.signal)
      if (options.prewarm !== false) {
        const selected = renderer.extensions.has('OES_texture_float_linear')
          ? [ltc.LTC_FLOAT_1, ltc.LTC_FLOAT_2]
          : [ltc.LTC_HALF_1, ltc.LTC_HALF_2]
        for (const texture of selected) {
          renderer.initTexture(texture)
          throwIfAborted(options.signal)
        }
      }

      const installed: InstalledLight[] = []
      let disposed = false
      const reportState = {
        supportedReceiverCount: 0,
        unsupportedReceiverCount: 0,
      }
      const report: ThreeRectAreaLightReport = Object.freeze({
        get lightsConfigured() { return plans.length },
        get supportedReceiverCount() { return reportState.supportedReceiverCount },
        get unsupportedReceiverCount() { return reportState.unsupportedReceiverCount },
      })
      const token = Symbol('Blendlink Rect Area light installation')

      const cleanup = (): unknown[] => {
        const errors: unknown[] = []
        for (const entry of installed.splice(0).reverse()) {
          try {
            if (entry.light.parent === entry.marker) entry.marker.remove(entry.light)
          } catch (error) { errors.push(error) }
          try { entry.light.dispose() } catch (error) { errors.push(error) }
          try {
            if (activeInstallation(entry.marker) === entry.token) {
              const deleted = Reflect.deleteProperty(entry.marker, INSTALLATION_SLOT)
              const cleared = deleted || (
                Reflect.set(entry.marker, INSTALLATION_SLOT, undefined)
                && activeInstallation(entry.marker) === undefined
              )
              if (!cleared) {
                throw new Error(
                  `Blendlink Rect Area light marker "${markerLabel(entry.marker)}" could not release its ` +
                    'private ownership token. Keep installed markers writable until scene disposal completes.',
                )
              }
            }
          } catch (error) { errors.push(error) }
        }
        return errors
      }

      try {
        // Reserve every marker in one synchronous transaction after the shared
        // await. This closes the concurrent-install race without exposing a
        // partially attached light set.
        for (const plan of plans) {
          if (activeInstallation(plan.marker) !== undefined) {
            throw new Error(
              `Blendlink Rect Area light marker "${markerLabel(plan.marker)}" was claimed by a concurrent installation. ` +
                'Dispose that scene handle before retrying.',
            )
          }
          const light = new peer.RectAreaLight()
          let reserved = false
          try {
            reserved = Reflect.set(plan.marker, INSTALLATION_SLOT, token)
              && activeInstallation(plan.marker) === token
          } catch {
            reserved = false
          }
          if (!reserved) {
            light.dispose()
            throw new Error(
              `Blendlink Rect Area light marker "${markerLabel(plan.marker)}" cannot store its private ` +
                'installation ownership token. Keep the loaded Object3D extensible until installation completes.',
            )
          }
          const entry: InstalledLight = { ...plan, light, token }
          installed.push(entry)
        }
        for (const entry of installed) {
          entry.light.name = `${markerLabel(entry.marker)}__Blendlink_RectAreaLight`
          entry.light.color.setRGB(...entry.descriptor.color)
          entry.light.castShadow = false
        }
        // Configure detached lights before Three emits `added`/`childadded`.
        // Observers therefore never see constructor defaults for an authored
        // light, and a bad later marker leaves the whole set untouched.
        syncLights(installed)
        for (const entry of installed) {
          entry.marker.add(entry.light)
        }
      } catch (error) {
        const cleanupErrors = cleanup()
        if (cleanupErrors.length > 0) {
          throw new Error(
            `Could not install Blendlink Rect Area lights: ${error instanceof Error ? error.message : String(error)}. ` +
              `Rollback also failed: ${cleanupErrors.map(String).join('; ')}`,
          )
        }
        throw error
      }

      return {
        report,
        sync() {
          if (disposed) throw new Error('This Blendlink Rect Area light installation has been disposed.')
          syncLights(installed)
        },
        auditReceivers() {
          if (disposed) throw new Error('This Blendlink Rect Area light installation has been disposed.')
          const counts = receiverCounts(root)
          reportState.supportedReceiverCount = counts.supported
          reportState.unsupportedReceiverCount = counts.unsupported
          if (counts.supported === 0) {
            const message =
              `Blendlink installed ${plans.length} authored Rect Area light${plans.length === 1 ? '' : 's'}, ` +
              'but the finalized scene has no visible MeshStandardMaterial or MeshPhysicalMaterial receiver. ' +
              `${counts.unsupported} visible material${counts.unsupported === 1 ? '' : 's'} will ignore these lights; ` +
              'Appearance MeshBasicMaterial surfaces intentionally remain unchanged.'
            if (options.onWarning) options.onWarning(message)
            else console.warn(message)
          }
        },
        dispose() {
          if (disposed) return
          disposed = true
          const errors = cleanup()
          if (errors.length > 0) {
            throw new Error(
              `Could not fully dispose Blendlink Rect Area lights: ${errors.map(String).join('; ')}`,
            )
          }
        },
      }
    },
  }
}

const runtime = createRuntime(
  {
    WebGLRenderer: THREE.WebGLRenderer,
    RectAreaLight: THREE.RectAreaLight,
    UniformsLib: THREE.UniformsLib as LtcUniforms,
  },
  async () => ({ RectAreaLightUniformsLib }),
)

export function installThreeRectAreaLights(
  root: THREE.Object3D,
  renderer: THREE.WebGLRenderer,
  options?: InstallThreeRectAreaLightsOptions,
): Promise<InstalledThreeRectAreaLights> {
  return runtime.install(root, renderer, options)
}

/** Internal source-test seam. It is not exported from the package map. */
export const createThreeRectAreaLightRuntimeForTests = createRuntime
