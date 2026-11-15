import * as THREE from 'three'
import { WebGPURenderer, RectAreaLightNode } from 'three/webgpu'
import { texture, lightViewPosition } from 'three/tsl'
import { RectAreaLightTexturesLib } from 'three/addons/lights/RectAreaLightTexturesLib.js'

type Tables = Record<'LTC_FLOAT_1' | 'LTC_FLOAT_2' | 'LTC_HALF_1' | 'LTC_HALF_2', THREE.DataTexture>
type Entry = { tables: Tables | null; references: number; Light: typeof THREE.RectAreaLight; Node: typeof RectAreaLightNode }
const entries = new WeakMap<WebGPURenderer, Entry>()

export interface RendererLocalRectAreaLease {
  readonly Light: typeof THREE.RectAreaLight
  assertActive(): void
  release(): void
}

/** This module is loaded only for the explicit renderer-local ownership path.
 * Three r184's public light-node registration receives a unique light class;
 * application mappings, UniformsLib and write-only setLTC state are untouched. */
export async function acquireRendererLocalRectAreaLights(
  candidate: unknown,
  options: { signal?: AbortSignal; prewarm?: boolean },
): Promise<RendererLocalRectAreaLease> {
  if (!(candidate instanceof WebGPURenderer)) {
    throw new Error('Renderer-local Rect Area lights require the same evaluated Three WebGPURenderer peer. Dedupe/alias three.')
  }
  const renderer = candidate
  const checkAbort = () => {
    if (options.signal?.aborted) {
      const error = new Error('SceneToWeb renderer-local Rect Area light installation was canceled.')
      error.name = 'AbortError'
      throw error
    }
  }
  checkAbort()
  let entry = entries.get(renderer)
  if (!entry) {
    // A class per renderer keeps registration bounded and prevents a shared
    // constructor from being rebound to another renderer's texture lifetime.
    class RendererLocalRectAreaLight extends THREE.RectAreaLight {}
    const state: Entry = { tables: null, references: 0, Light: RendererLocalRectAreaLight, Node: RectAreaLightNode }
    class RendererLocalRectAreaLightNode extends RectAreaLightNode {
      setupDirectRectArea(builder: any): any {
        const tables = state.tables
        if (!tables) throw new Error('Renderer-local Rect Area LTC textures were released before their light.')
        const floats = builder.isAvailable('float32Filterable')
        return {
          lightColor: (this as any).colorNode,
          lightPosition: lightViewPosition(this.light!),
          halfWidth: this.halfWidth,
          halfHeight: this.halfHeight,
          ltc_1: texture(floats ? tables.LTC_FLOAT_1 : tables.LTC_HALF_1),
          ltc_2: texture(floats ? tables.LTC_FLOAT_2 : tables.LTC_HALF_2),
        }
      }
    }
    state.Node = RendererLocalRectAreaLightNode
    renderer.library.addLight(RendererLocalRectAreaLightNode, RendererLocalRectAreaLight)
    entries.set(renderer, state)
    entry = state
  }
  const state = entry
  if ((renderer.library.getLightNodeClass(state.Light) as unknown) !== state.Node) {
    throw new Error('The renderer-local SceneToWeb Rect Area light registration was replaced by the application.')
  }
  if (!state.tables) {
    // r184 init() writes only this.LTC_*: bind a private receiver rather than
    // calling the allocation-heavy initializer on its application-owned class.
    const receiver = {} as Tables
    try {
      RectAreaLightTexturesLib.init.call(receiver)
      const maps = Object.values(receiver)
      if (maps.length !== 4 || maps.some(map => !map.isDataTexture)) {
        throw new Error('Private Rect Area LTC initialization did not provide four DataTextures.')
      }
      state.tables = receiver
    } catch (error) {
      for (const map of Object.values(receiver)) { try { map?.dispose() } catch { /* Preserve initialization failure. */ } }
      throw error
    }
  }
  state.references++
  let released = false
  const lease: RendererLocalRectAreaLease = {
    Light: state.Light,
    assertActive() {
      if (released || !state.tables || (renderer.library.getLightNodeClass(state.Light) as unknown) !== state.Node) {
        throw new Error('Renderer-local SceneToWeb Rect Area light ownership is no longer active.')
      }
    },
    release() {
      if (released) return
      released = true
      if (--state.references === 0) {
        const tables = state.tables
        state.tables = null
        if (tables) {
          const failures: unknown[] = []
          for (const map of Object.values(tables)) { try { map.dispose() } catch (error) { failures.push(error) } }
          if (failures.length) throw new Error('Could not release renderer-local Rect Area LTC textures: ' + failures.map(String).join('; '))
        }
      }
    },
  }
  try {
    if (options.prewarm !== false) {
      for (const map of Object.values(state.tables)) {
        await renderer.initTexture(map)
        checkAbort()
      }
    }
    checkAbort()
    lease.assertActive()
    return lease
  } catch (error) {
    try { lease.release() } catch (cleanupError) {
      const primary = error instanceof Error ? error.message : String(error)
      throw new AggregateError(
        [error, cleanupError],
        `Could not prepare renderer-local Rect Area LTC textures: ${primary}. Cleanup also failed.`,
        { cause: error },
      )
    }
    throw error
  }
}
