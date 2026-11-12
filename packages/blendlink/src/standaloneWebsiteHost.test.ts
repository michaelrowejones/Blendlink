import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'
import { standaloneWebsiteMainSource } from './exportWebsite.js'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

async function settle() {
  for (let index = 0; index < 8; index++) await Promise.resolve()
}

function visitor(options: { reducedMotion?: boolean; manual?: boolean; delayed?: boolean; freeCamera?: boolean; initialDeviceLoss?: boolean } = {}) {
  const document = { body: { dataset: {} as Record<string, string> }, activeElement: null as unknown, hidden: false,
    querySelector: (selector: string) => elements[selector] }
  class Element extends EventTarget {
    hidden = false
    disabled = false
    textContent = ''
    attributes = new Map<string, string>()
    setAttribute(name: string, value: string) { this.attributes.set(name, value) }
    focus() { document.activeElement = this }
  }
  const elements: Record<string, Element> = Object.fromEntries(['canvas', '#status', '#retry', '#pause', '#reset'].map(name => [name, new Element()]))
  elements['#retry']!.hidden = true
  const window = new EventTarget()
  const motion = Object.assign(new EventTarget(), { matches: options.reducedMotion ?? false })
  const frames = new Map<number, (now: number) => void>()
  let frameId = 0, now = 0
  const state = { phase: options.manual ? 'idle' : 'playing' }
  const animation = { state, availableClips: [{ name: 'Turn', duration: 1 }],
    play: vi.fn(() => { state.phase = 'playing' }), pause: vi.fn(() => { state.phase = 'paused' }) }
  const scene = { update: vi.fn(), render: vi.fn(), resize: vi.fn(), dispose: vi.fn(), animation,
    cameraController: { interactive: true, behavior: options.freeCamera ? 'free' : 'orbit', update: vi.fn(), reset: vi.fn() } }
  const graphics: Array<{ dispose: ReturnType<typeof vi.fn>; onDeviceLost?: (info: { message: string }) => void }> = []
  class Renderer {
    dispose = vi.fn()
    setPixelRatio = vi.fn()
    onDeviceLost?: (info: { message: string }) => void
    constructor() { graphics.push(this) }
    async init() {}
  }
  if (options.initialDeviceLoss) scene.render.mockImplementationOnce(() => graphics[0]!.onDeviceLost?.({ message: 'initial graphics loss' }))
  const pending = deferred<typeof scene>()
  const install = vi.fn(() => options.delayed ? pending.promise : Promise.resolve(scene))
  const context = { document, window, console: { warn: vi.fn() }, THREE: { Scene: class {} }, WebGPURenderer: Renderer,
    installThreeCompiledScene: install, descriptor: { clips: { Turn: { duration: 1 } } }, createBakedScene: () => {},
    matchMedia: () => motion, AbortController, URL, location: { href: 'https://example.test/nested/site/', reload: vi.fn() },
    performance: { now: () => now }, devicePixelRatio: 1, innerWidth: 1200, innerHeight: 800,
    requestAnimationFrame: (callback: (now: number) => void) => { frames.set(++frameId, callback); return frameId },
    cancelAnimationFrame: (id: number) => frames.delete(id) }
  const source = standaloneWebsiteMainSource('Hero').replace(/^import .*\n/gm, '')
  runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText, context)
  return { scene, install, graphics, pending, motion, elements, document, window, frames, context,
    frame(time: number) {
      now = time
      const entry = frames.entries().next().value
      if (!entry) throw new Error('No scheduled visitor frame')
      frames.delete(entry[0]); entry[1](time)
    },
    preference(reduced: boolean) {
      motion.matches = reduced
      motion.dispatchEvent(Object.assign(new Event('change'), { matches: reduced }))
    },
    pagehide(persisted = false) { window.dispatchEvent(Object.assign(new Event('pagehide'), { persisted })) } }
}

describe('standalone website visitor lifecycle', () => {
  it('starts manual playback on Play, pauses it, and can replay a finished clip', async () => {
    const host = visitor({ manual: true })
    await settle()
    expect(host.document.body.dataset.ready).toBe('true')
    expect(host.elements['#pause']!.textContent).toBe('Play')
    expect(host.scene.animation.play).not.toHaveBeenCalled()
    host.preference(false)
    expect(host.scene.animation.play).not.toHaveBeenCalled()
    host.elements['#pause']!.dispatchEvent(new Event('click'))
    expect(host.scene.animation.play).toHaveBeenCalledTimes(1)
    expect(host.elements['#pause']!.textContent).toBe('Pause')
    host.elements['#pause']!.dispatchEvent(new Event('click'))
    expect(host.scene.animation.pause).toHaveBeenCalledTimes(1)
    host.elements['#pause']!.dispatchEvent(new Event('click'))
    host.scene.animation.state.phase = 'finished'
    host.frame(50)
    expect(host.elements['#pause']!.textContent).toBe('Play')
    host.elements['#pause']!.dispatchEvent(new Event('click'))
    expect(host.scene.animation.play).toHaveBeenCalledTimes(3)
  })

  it('honors reduced motion without disabling navigation and preserves an explicit visitor choice', async () => {
    const host = visitor({ reducedMotion: true, freeCamera: true })
    await settle()
    expect(host.scene.animation.pause).toHaveBeenCalledTimes(1)
    host.scene.update.mockClear(); host.scene.render.mockClear()
    host.frame(50)
    expect(host.scene.update).toHaveBeenLastCalledWith(0)
    expect(host.scene.render).toHaveBeenLastCalledWith(0)
    expect(host.scene.cameraController.update).toHaveBeenLastCalledWith(0.05)
    host.preference(false)
    expect(host.elements['#pause']!.textContent).toBe('Pause')
    host.elements['#pause']!.dispatchEvent(new Event('click'))
    host.preference(false)
    expect(host.elements['#pause']!.textContent).toBe('Play')
    host.frame(100)
    expect(host.scene.update).toHaveBeenLastCalledWith(0)
  })

  it('clears readiness and releases both resources after a runtime failure, preserving keyboard recovery', async () => {
    const host = visitor()
    await settle()
    host.elements['#pause']!.focus()
    host.scene.render.mockImplementationOnce(() => { throw new Error('lost scene renderer') })
    host.scene.dispose.mockImplementationOnce(() => { throw new Error('scene cleanup error') })
    host.frame(50)
    expect(host.document.body.dataset.ready).toBeUndefined()
    expect(host.elements['#status']!.textContent).toContain('lost scene renderer')
    expect(host.elements['#status']!.attributes.get('role')).toBe('alert')
    expect(host.document.activeElement).toBe(host.elements['#retry'])
    expect(host.elements['#pause']!.disabled).toBe(true)
    expect(host.scene.dispose).toHaveBeenCalledTimes(1)
    expect(host.graphics[0]!.dispose).toHaveBeenCalledTimes(1)
    expect(host.frames.size).toBe(0)
    host.pagehide()
    expect(host.graphics[0]!.dispose).toHaveBeenCalledTimes(1)
  })

  it('aborts an unfinished installation on departure and disposes a late result without reviving the page', async () => {
    const host = visitor({ delayed: true })
    await settle()
    expect(host.install).toHaveBeenCalledTimes(1)
    const signal = (host.install.mock.calls[0] as unknown as [{ signal: AbortSignal }])[0].signal
    host.pagehide()
    expect(signal.aborted).toBe(true)
    expect(host.graphics[0]!.dispose).toHaveBeenCalledTimes(1)
    host.pending.resolve(host.scene)
    await settle()
    expect(host.scene.dispose).toHaveBeenCalledTimes(1)
    expect(host.document.body.dataset.ready).toBeUndefined()
    expect(host.frames.size).toBe(0)
  })

  it('keeps an initial graphics-loss error visible instead of promoting a failed first frame', async () => {
    const host = visitor({ initialDeviceLoss: true })
    await settle()
    expect(host.document.body.dataset.ready).toBeUndefined()
    expect(host.elements['#status']!.hidden).toBe(false)
    expect(host.elements['#status']!.textContent).toContain('initial graphics loss')
    expect(host.elements['#retry']!.hidden).toBe(false)
    expect(host.scene.dispose).toHaveBeenCalledTimes(1)
    expect(host.graphics[0]!.dispose).toHaveBeenCalledTimes(1)
    expect(host.frames.size).toBe(0)
  })

  it('keeps a cached page intact for Back and Forward navigation', async () => {
    const host = visitor()
    await settle()
    host.pagehide(true)
    expect(host.scene.dispose).not.toHaveBeenCalled()
    expect(host.graphics[0]!.dispose).not.toHaveBeenCalled()
    host.frame(50)
    expect(host.scene.update).toHaveBeenLastCalledWith(0.05)
  })
})
