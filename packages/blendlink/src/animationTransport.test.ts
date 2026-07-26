import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import {
  startCompiledScenePlayback,
  type AnimationActionLike,
  type AnimationMixerLike,
  type CompiledSceneDescriptor,
} from './runtime.js'
import type { AnimationSequenceRecipe } from './animationSequence.js'

interface TestAction extends AnimationActionLike {
  clip: { name: string, duration: number }
  running: boolean
}

function createHarness() {
  const actions = new Map<string, TestAction>()
  const mixer: AnimationMixerLike = {
    clipAction(clip) {
      const name = clip.name
      const existing = actions.get(name)
      if (existing) return existing
      const action: TestAction = {
        clip: clip as { name: string, duration: number },
        running: false,
        clampWhenFinished: false,
        timeScale: 1,
        enabled: true,
        paused: false,
        time: 0,
        weight: 1,
        reset() {
          this.time = 0
          this.running = false
          return this
        },
        setLoop() { return this },
        play() {
          this.running = true
          return this
        },
        stop() {
          this.running = false
          this.time = 0
          return this
        },
        isRunning() {
          return this.running && this.enabled !== false && this.paused !== true
        },
      }
      actions.set(name, action)
      return action
    },
    update(deltaSeconds) {
      for (const action of actions.values()) {
        if (action.running && !action.paused) {
          action.time = (action.time ?? 0) + deltaSeconds * action.timeScale
        }
      }
    },
    stopAllAction() {
      for (const action of actions.values()) action.stop?.()
    },
  }
  return { actions, mixer }
}

const manualDescriptor: CompiledSceneDescriptor = {
  url: '/animated.glb',
  nodes: {},
  playback: { start: 'manual', loop: 'repeat', speed: 1 },
}

describe('compiled scene animation transport', () => {
  it('makes a manual scene controllable without exposing application timing policy', () => {
    const { actions, mixer } = createHarness()
    const requestFrame = vi.fn()
    const listener = vi.fn()
    const transport = startCompiledScenePlayback({
      scene: { name: 'Root' },
      animations: [
        { name: 'Idle', duration: 2 },
        { name: 'Wave', duration: 1 },
      ],
    }, manualDescriptor, {
      createMixer: () => mixer,
      loopModes: { once: 1, repeat: 2, pingpong: 3 },
      requestFrame,
    })

    expect(transport).not.toBeNull()
    expect(transport?.availableClips).toEqual([
      { name: 'Idle', duration: 2 },
      { name: 'Wave', duration: 1 },
    ])
    expect(transport?.state).toMatchObject({
      phase: 'idle',
      mode: 'clips',
      activeClips: [],
      time: 0,
    })
    expect(transport?.requiresContinuousFrames).toBe(false)
    const unsubscribe = transport!.subscribe(listener)

    transport!.play('Wave')
    expect(actions.get('Wave')).toMatchObject({ running: true, paused: false })
    expect(transport?.state).toMatchObject({
      phase: 'playing',
      activeClips: ['Wave'],
      time: 0,
    })
    expect(transport?.requiresContinuousFrames).toBe(true)

    transport!.update(0.25)
    expect(transport?.state.time).toBeCloseTo(0.25)
    transport!.pause()
    expect(actions.get('Wave')?.paused).toBe(true)
    expect(transport?.state.phase).toBe('paused')
    expect(transport?.requiresContinuousFrames).toBe(false)

    transport!.seek(0.75)
    expect(actions.get('Wave')?.time).toBeCloseTo(0.75)
    transport!.play()
    expect(transport?.state.phase).toBe('playing')
    expect(actions.get('Wave')?.paused).toBe(false)

    transport!.stop()
    expect(transport?.state).toMatchObject({ phase: 'idle', time: 0, activeClips: [] })
    expect(transport?.requiresContinuousFrames).toBe(false)
    expect(requestFrame).toHaveBeenCalled()
    expect(listener).toHaveBeenCalled()
    unsubscribe()
  })

  it('settles a once animation without depending on Three action isRunning timing', () => {
    const { mixer } = createHarness()
    const transport = startCompiledScenePlayback({
      scene: { name: 'Root' },
      animations: [{ name: 'Reveal', duration: 1 }],
    }, {
      ...manualDescriptor,
      playback: { start: 'first', loop: 'once', speed: 2 },
    }, {
      createMixer: () => mixer,
      loopModes: { once: 1, repeat: 2, pingpong: 3 },
    })!

    expect(transport.requiresContinuousFrames).toBe(true)
    transport.update(0.49)
    expect(transport.state.phase).toBe('playing')
    transport.update(0.01)
    expect(transport.state).toMatchObject({ phase: 'finished', time: 1 })
    expect(transport.requiresContinuousFrames).toBe(false)
    transport.seek(0.25)
    expect(transport.state.phase).toBe('paused')
    transport.play()
    expect(transport.state.phase).toBe('playing')
  })

  it('keeps unknown-duration adapters conservative and reports ping-pong authored time correctly', () => {
    const unknownHarness = createHarness()
    const unknown = startCompiledScenePlayback({
      scene: { name: 'Root' },
      animations: [{ name: 'External Clip' }],
    }, {
      ...manualDescriptor,
      playback: { start: 'first', loop: 'once', speed: 1 },
    }, {
      createMixer: () => unknownHarness.mixer,
      loopModes: { once: 1, repeat: 2, pingpong: 3 },
    })!

    unknown.update(10)
    expect(unknown.state).toMatchObject({
      phase: 'playing',
      duration: null,
      time: 10,
    })
    expect(unknown.requiresContinuousFrames).toBe(true)
    unknown.stop()
    expect(unknown.requiresContinuousFrames).toBe(false)

    const pingPongHarness = createHarness()
    const pingPong = startCompiledScenePlayback({
      scene: { name: 'Root' },
      animations: [{ name: 'Pendulum', duration: 1 }],
    }, {
      ...manualDescriptor,
      playback: { start: 'first', loop: 'pingpong', speed: 1 },
    }, {
      createMixer: () => pingPongHarness.mixer,
      loopModes: { once: 1, repeat: 2, pingpong: 3 },
    })!
    pingPong.update(1.2)
    expect(pingPong.state.time).toBeCloseTo(0.8)
    pingPong.update(0.1)
    expect(pingPong.state.time).toBeCloseTo(0.7)
  })

  it('keeps the bounded NLA sequence controllable even though its sampled actions stay paused', () => {
    const { actions, mixer } = createHarness()
    const sequence: AnimationSequenceRecipe = {
      name: 'Website Story',
      source: { objectId: 'hero', objectName: 'Hero', track: 'Website Story' },
      duration: 2,
      loop: false,
      speed: 1,
      strips: [{
        order: 0,
        name: 'Enter',
        clip: 'Enter',
        at: 0,
        duration: 2,
        clipStart: 0,
        clipEnd: 2,
        scale: 1,
        speed: 1,
        repeat: 1,
        blend: 'replace',
        blendIn: 0,
        blendOut: 0,
        weight: 1,
        easing: 'linear',
        extrapolation: 'hold-forward',
        reverse: false,
        muted: false,
      }],
    }
    const transport = startCompiledScenePlayback({
      scene: { name: 'Root' },
      animations: [{ name: 'Enter', duration: 2 }],
    }, {
      ...manualDescriptor,
      animationSequence: sequence,
    }, {
      createMixer: () => mixer,
      loopModes: { once: 1, repeat: 2, pingpong: 3 },
      createSequenceClip: (source) => ({ ...source, name: `${source.name}:sequence` }),
    })!

    expect(actions.get('Enter:sequence')?.paused).toBe(true)
    expect(transport.state).toMatchObject({
      phase: 'playing',
      mode: 'sequence',
      activeClips: ['Enter'],
      duration: 2,
    })
    expect(transport.requiresContinuousFrames).toBe(true)

    transport.update(0.5)
    transport.pause()
    const pausedSample = actions.get('Enter:sequence')?.time
    transport.update(0.5)
    expect(actions.get('Enter:sequence')?.time).toBe(pausedSample)
    transport.seek(1.5)
    expect(actions.get('Enter:sequence')?.time).toBeCloseTo(1.5)
    transport.play()
    transport.update(0.5)
    expect(transport.state.phase).toBe('finished')
    expect(transport.requiresContinuousFrames).toBe(false)

    transport.stop()
    transport.play()
    expect(transport.state).toMatchObject({ phase: 'playing', time: 0 })
  })

  it('fails loudly for ambiguous commands and becomes terminal only on disposal', () => {
    const { mixer } = createHarness()
    const transport = startCompiledScenePlayback({
      scene: { name: 'Root' },
      animations: [{ name: 'Idle', duration: 1 }],
    }, manualDescriptor, {
      createMixer: () => mixer,
      loopModes: { once: 1, repeat: 2, pingpong: 3 },
    })!

    expect(() => transport.play('Missing')).toThrow(/Missing.*available.*Idle/i)
    expect(() => transport.seek(-1)).toThrow(/non-negative finite time/i)
    expect(() => transport.update(Number.NaN)).toThrow(/non-negative delta/i)
    transport.dispose()
    transport.dispose()
    expect(() => transport.play('Idle')).toThrow(/disposed/i)
    expect(() => transport.seek(0)).toThrow(/disposed/i)
  })

  it('resets real Three loop parity before seeking a ping-pong action', () => {
    const root = new THREE.Group()
    const clip = new THREE.AnimationClip('Pendulum', 1, [
      new THREE.NumberKeyframeTrack('.position[x]', [0, 1], [0, 10]),
    ])
    const transport = startCompiledScenePlayback({
      scene: root,
      animations: [clip],
    }, {
      ...manualDescriptor,
      playback: { start: 'first', loop: 'pingpong', speed: 1 },
    }, {
      createMixer: (object) =>
        new THREE.AnimationMixer(object as THREE.Object3D) as unknown as AnimationMixerLike,
      loopModes: {
        once: THREE.LoopOnce,
        repeat: THREE.LoopRepeat,
        pingpong: THREE.LoopPingPong,
      },
    })!

    transport.update(1.2)
    expect(root.position.x).toBeCloseTo(8)
    transport.pause()
    transport.seek(0.75)
    expect(transport.state.time).toBeCloseTo(0.75)
    expect(root.position.x).toBeCloseTo(7.5)
  })

  it.each(['repeat', 'pingpong'] as const)(
    'samples and settles a zero-duration real Three clip in %s mode',
    (loop) => {
      const root = new THREE.Group()
      const clip = new THREE.AnimationClip('Static Pose', 0, [
        new THREE.NumberKeyframeTrack('.position[x]', [0], [4]),
      ])
      const transport = startCompiledScenePlayback({
        scene: root,
        animations: [clip],
      }, {
        ...manualDescriptor,
        playback: { start: 'first', loop, speed: 1 },
      }, {
        createMixer: (object) =>
          new THREE.AnimationMixer(object as THREE.Object3D) as unknown as AnimationMixerLike,
        loopModes: {
          once: THREE.LoopOnce,
          repeat: THREE.LoopRepeat,
          pingpong: THREE.LoopPingPong,
        },
      })!

      expect(root.position.x).toBeCloseTo(4)
      expect(transport.state).toMatchObject({
        phase: 'finished',
        time: 0,
        duration: 0,
      })
      expect(transport.requiresContinuousFrames).toBe(false)
      expect(Number.isFinite(transport.actions[0]?.time)).toBe(true)
    },
  )

  it('serializes reentrant subscribers and schedules a frame before surfacing observer errors', () => {
    const reentrantHarness = createHarness()
    const transport = startCompiledScenePlayback({
      scene: { name: 'Root' },
      animations: [{ name: 'Wave', duration: 1 }],
    }, manualDescriptor, {
      createMixer: () => reentrantHarness.mixer,
      loopModes: { once: 1, repeat: 2, pingpong: 3 },
    })!
    const order: string[] = []
    transport.subscribe((state) => {
      order.push(`first:${state.phase}`)
      if (state.phase === 'playing') transport.pause()
    })
    transport.subscribe((state) => { order.push(`second:${state.phase}`) })

    transport.play('Wave')
    expect(order).toEqual([
      'first:playing',
      'second:playing',
      'first:paused',
      'second:paused',
    ])
    expect(transport.state.phase).toBe('paused')

    const throwingHarness = createHarness()
    const requestFrame = vi.fn()
    const throwing = startCompiledScenePlayback({
      scene: { name: 'Root' },
      animations: [{ name: 'Wave', duration: 1 }],
    }, manualDescriptor, {
      createMixer: () => throwingHarness.mixer,
      loopModes: { once: 1, repeat: 2, pingpong: 3 },
      requestFrame,
    })!
    throwing.subscribe(() => { throw new Error('application animation observer failed') })

    expect(() => throwing.play('Wave')).toThrow(/animation observer failed/i)
    expect(throwing.state.phase).toBe('playing')
    expect(requestFrame).toHaveBeenCalledTimes(1)

    const updateHarness = createHarness()
    const updateFrame = vi.fn()
    const updateThrowing = startCompiledScenePlayback({
      scene: { name: 'Root' },
      animations: [{ name: 'Wave', duration: 1 }],
    }, manualDescriptor, {
      createMixer: () => updateHarness.mixer,
      loopModes: { once: 1, repeat: 2, pingpong: 3 },
      requestFrame: updateFrame,
    })!
    updateThrowing.play('Wave')
    updateFrame.mockClear()
    updateThrowing.subscribe((state) => {
      if (state.time > 0) throw new Error('per-frame animation observer failed')
    })

    expect(() => updateThrowing.update(0.1)).toThrow(/per-frame animation observer failed/i)
    expect(updateFrame).toHaveBeenCalledTimes(1)
  })
})
