import * as THREE from 'three'
import type {
  AccessibilityService,
  InteractionService,
  RuntimeAccessibleControl,
  RuntimeDisposable,
  RuntimeInteractionTarget,
} from './componentRuntime.js'

interface InteractiveSurface {
  getBoundingClientRect(): { left: number; top: number; width: number; height: number }
  addEventListener(type: string, listener: EventListener): void
  removeEventListener(type: string, listener: EventListener): void
  setPointerCapture?(pointerId: number): void
  releasePointerCapture?(pointerId: number): void
  hasPointerCapture?(pointerId: number): boolean
}

export interface ThreeAccessibleControl {
  readonly id: string
  readonly target: THREE.Object3D | THREE.Scene
  readonly role: 'button' | 'link'
  readonly label: string
  readonly href?: string
  readonly linkTarget?: '_self' | '_blank'
  /** DOM keyboard/assistive activation and Canvas pointer activation converge
   * on the same authored behavior callback. */
  activate(): void
  /** Application-owned focus presentation may drive authored hover intent. */
  setFocused(focused: boolean): void
}

export interface InstalledThreeInteractionServices extends RuntimeDisposable {
  readonly interaction: InteractionService<THREE.Object3D | THREE.Scene>
  readonly accessibility: AccessibilityService<THREE.Object3D | THREE.Scene>
  readonly controls: readonly ThreeAccessibleControl[]
  /** Idempotently connect the package-owned Canvas listener set. Targets and
   * controls may be registered before this live activation. */
  activate(): void
}

/** One listener set and one raycast per pointer event for every behavior in a
 * compiled scene. DOM rendering remains application-owned. */
export function createThreeInteractionServices(options: {
  root: THREE.Object3D
  camera: THREE.Camera
  surface: unknown
  /** CSS-pixel distance after which a pointer gesture belongs to scrolling,
   * camera controls, or dragging rather than scene activation. Default 8. */
  tapMovementThreshold?: number
  requestFrame?(): unknown
}): InstalledThreeInteractionServices {
  const registrations = new Map<string, RuntimeInteractionTarget<THREE.Object3D | THREE.Scene>>()
  const controls = new Map<string, RuntimeAccessibleControl<THREE.Object3D | THREE.Scene> & {
    href?: string
    linkTarget?: '_self' | '_blank'
  }>()
  const raycaster = new THREE.Raycaster()
  const pointer = new THREE.Vector2()
  let activated = false
  let connected = false
  let disposed = false
  let hovered = new Set<string>()
  const gestures = new Map<number, {
    startX: number
    startY: number
    moved: boolean
    target: THREE.Object3D | THREE.Scene
  }>()
  const tapMovementThreshold = options.tapMovementThreshold ?? 8
  if (!(Number.isFinite(tapMovementThreshold) && tapMovementThreshold >= 0)) {
    throw new Error(`Blendlink tapMovementThreshold must be a non-negative CSS-pixel value; got ${tapMovementThreshold}.`)
  }

  const surface = (): InteractiveSurface => {
    const candidate = options.surface as Partial<InteractiveSurface>
    if (!candidate?.getBoundingClientRect || !candidate.addEventListener || !candidate.removeEventListener) {
      throw new Error(
        'Blendlink interactive components need a browser event surface. Use a WebGLRenderer canvas ' +
          'or pass application-owned interaction/accessibility services.',
      )
    }
    return candidate as InteractiveSurface
  }

  const visible = (object: THREE.Object3D): boolean => {
    for (let current: THREE.Object3D | null = object; current; current = current.parent) {
      if (!current.visible) return false
    }
    return true
  }
  const contains = (ancestor: THREE.Object3D | THREE.Scene, object: THREE.Object3D): boolean => {
    for (let current: THREE.Object3D | null = object; current; current = current.parent) {
      if (current === ancestor) return true
    }
    return false
  }
  const picked = (event: PointerEvent): RuntimeInteractionTarget<THREE.Object3D | THREE.Scene>[] => {
    const bounds = surface().getBoundingClientRect()
    if (!(Number.isFinite(bounds.width) && Number.isFinite(bounds.height)
        && bounds.width > 0 && bounds.height > 0)) return []
    pointer.set(
      ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
    )
    raycaster.setFromCamera(pointer, options.camera)
    const nearest = raycaster.intersectObject(options.root, true)
      .find((hit) => visible(hit.object))?.object
    if (!nearest) return []
    const candidates = [...registrations.values()].filter((entry) =>
      entry.target instanceof THREE.Object3D && contains(entry.target, nearest))
    if (candidates.length < 2) return candidates
    // Preserve multiple actions on one object, but do not also fire an
    // interactive ancestor when a more specific registered descendant won.
    const closestTarget = candidates.map((entry) => entry.target as THREE.Object3D)
      .find((target) => !candidates.some((other) =>
        other.target !== target && other.target instanceof THREE.Object3D && contains(target, other.target)))
    return candidates.filter((entry) => entry.target === closestTarget)
  }
  const setHovered = (next: Set<string>): void => {
    for (const id of hovered) if (!next.has(id)) registrations.get(id)?.hover?.(false)
    for (const id of next) if (!hovered.has(id)) registrations.get(id)?.hover?.(true)
    hovered = next
    options.requestFrame?.()
  }
  const move: EventListener = (raw) => {
    const event = raw as PointerEvent
    const gesture = gestures.get(event.pointerId)
    if (gesture && !gesture.moved) {
      gesture.moved = Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY)
        > tapMovementThreshold
    }
    if (event.pointerType === 'touch') return
    setHovered(new Set(picked(event).filter((entry) => entry.hover).map((entry) => entry.id)))
  }
  const down: EventListener = (raw) => {
    const event = raw as PointerEvent
    if (event.isPrimary === false || event.button !== 0) return
    const targets = picked(event)
    const target = targets[0]?.target
    if (!target) return
    gestures.set(event.pointerId, {
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      target,
    })
    try { surface().setPointerCapture?.(event.pointerId) } catch { /* capture is an optimization, not ownership */ }
  }
  const finish = (event: PointerEvent, activate: boolean): void => {
    const gesture = gestures.get(event.pointerId)
    if (!gesture) return
    gestures.delete(event.pointerId)
    try {
      const element = surface()
      if (element.hasPointerCapture?.(event.pointerId) !== false) {
        element.releasePointerCapture?.(event.pointerId)
      }
    } catch { /* capture may already have been released by the browser */ }
    if (!activate || gesture.moved || event.isPrimary === false || event.button !== 0) return
    const targets = picked(event).filter((entry) => entry.target === gesture.target)
    if (targets.length === 0) return
    for (const target of targets) target.activate?.()
    options.requestFrame?.()
  }
  const up: EventListener = (raw) => finish(raw as PointerEvent, true)
  const cancel: EventListener = (raw) => finish(raw as PointerEvent, false)
  const lostCapture: EventListener = (raw) => { gestures.delete((raw as PointerEvent).pointerId) }
  const leave: EventListener = () => setHovered(new Set())
  const connect = (): void => {
    if (!activated || connected || registrations.size === 0) return
    const element = surface()
    const listeners: ReadonlyArray<readonly [string, EventListener]> = [
      ['pointerdown', down],
      ['pointermove', move],
      ['pointerup', up],
      ['pointercancel', cancel],
      ['lostpointercapture', lostCapture],
      ['pointerleave', leave],
    ]
    const added: Array<readonly [string, EventListener]> = []
    try {
      for (const [type, listener] of listeners) {
        element.addEventListener(type, listener)
        added.push([type, listener])
      }
      connected = true
    } catch (error) {
      const cleanupErrors: unknown[] = []
      for (const [type, listener] of added.reverse()) {
        try { element.removeEventListener(type, listener) } catch (cleanupError) {
          cleanupErrors.push(cleanupError)
        }
      }
      throw new Error(
        `Blendlink could not activate its Canvas interaction listeners: ${
          error instanceof Error ? error.message : String(error)
        }${cleanupErrors.length > 0
          ? `. Listener rollback also failed: ${cleanupErrors.map(String).join('; ')}`
          : ''}`,
        { cause: error },
      )
    }
  }
  const disconnect = (): void => {
    if (!connected) return
    const element = surface()
    element.removeEventListener('pointerdown', down)
    element.removeEventListener('pointermove', move)
    element.removeEventListener('pointerup', up)
    element.removeEventListener('pointercancel', cancel)
    element.removeEventListener('lostpointercapture', lostCapture)
    element.removeEventListener('pointerleave', leave)
    connected = false
  }

  return {
    interaction: {
      addTarget(target) {
        if (disposed) throw new Error('These Blendlink interaction services have been disposed.')
        if (registrations.has(target.id)) {
          throw new Error(`Blendlink interaction target ${target.id} was registered more than once.`)
        }
        registrations.set(target.id, target)
        connect()
        let active = true
        return { dispose() {
          if (!active) return
          active = false
          if (hovered.has(target.id)) target.hover?.(false)
          registrations.delete(target.id)
          hovered.delete(target.id)
          if (registrations.size === 0) disconnect()
        } }
      },
    },
    accessibility: {
      addControl(control) {
        if (disposed) throw new Error('These Blendlink interaction services have been disposed.')
        if (controls.has(control.id)) {
          throw new Error(`Blendlink accessible control ${control.id} was registered more than once.`)
        }
        controls.set(control.id, control)
        let active = true
        return { dispose() {
          if (!active) return
          active = false
          controls.delete(control.id)
        } }
      },
    },
    get controls() {
      return Object.freeze([...controls.values()].map((control) => Object.freeze({
        id: control.id,
        target: control.target,
        role: control.role,
        label: control.label,
        ...('href' in control && typeof control.href === 'string' ? { href: control.href } : {}),
        ...('linkTarget' in control && (control.linkTarget === '_self' || control.linkTarget === '_blank')
          ? { linkTarget: control.linkTarget }
          : {}),
        activate: () => { control.activate(); options.requestFrame?.() },
        setFocused: (focused: boolean) => {
          for (const registration of registrations.values()) {
            if (registration.target === control.target) registration.hover?.(focused)
          }
          options.requestFrame?.()
        },
      })))
    },
    activate() {
      if (disposed) throw new Error('These Blendlink interaction services have been disposed.')
      if (activated) return
      activated = true
      try {
        connect()
      } catch (error) {
        activated = false
        throw error
      }
    },
    dispose() {
      if (disposed) return
      disposed = true
      setHovered(new Set())
      gestures.clear()
      registrations.clear()
      controls.clear()
      disconnect()
    },
  }
}
