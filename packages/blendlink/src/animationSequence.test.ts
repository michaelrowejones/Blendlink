import { describe, expect, it } from 'vitest'
import {
  startAnimationSequence,
  validateAnimationSequenceClips,
  type AnimationSequenceRecipe,
  type SequenceActionLike,
} from './animationSequence.js'
import { DEFAULT_SCENE_RECIPE, parseSceneRecipe } from './sceneRecipe.js'
import { startCompiledScenePlayback } from './runtime.js'

const sequence: AnimationSequenceRecipe = {
  name: 'Hero Story',
  source: { objectId: 'hero-id', objectName: 'Hero', track: 'Website Story' },
  duration: 5,
  loop: false,
  speed: 1,
  strips: [
    {
      order: 0, name: 'Enter', clip: 'Enter', at: 0, duration: 2,
      clipStart: 0, clipEnd: 1, scale: 1, speed: 1, repeat: 2,
      blend: 'replace', blendIn: 1, blendOut: 0, weight: 1,
      easing: 'ease-in', extrapolation: 'hold-forward', reverse: false, muted: false,
    },
    {
      order: 1, name: 'Settle', clip: 'Settle', at: 3, duration: 2,
      clipStart: 0, clipEnd: 1, scale: 2, speed: 0.5, repeat: 1,
      blend: 'add', blendIn: 0, blendOut: 0, weight: 0.75,
      easing: 'linear', extrapolation: 'hold-forward', reverse: true, muted: false,
    },
  ],
}

function action(): SequenceActionLike & { events: unknown[] } {
  const events: unknown[] = []
  return {
    events, clampWhenFinished: false, timeScale: 1, enabled: true,
    paused: false, time: 0, weight: 1,
    reset() { events.push('reset') },
    setLoop(mode, repeats) { events.push(['loop', mode, repeats]) },
    play() { events.push('play') },
    stop() { events.push('stop') },
    setEffectiveWeight(value) { this.weight = value; events.push(['weight', value]) },
  }
}

describe('authored NLA sequence', () => {
  it('seeks trims, fractional timelines, reverse, easing, gaps, and hold-forward deterministically', () => {
    const actions: ReturnType<typeof action>[] = []
    const updates: number[] = []
    const mixer = {
      clipAction() { const next = action(); actions.push(next); return next },
      update(delta: number) { updates.push(delta) },
      stopAllAction() { updates.push(-1) },
    }
    const running = startAnimationSequence(
      {},
      [{ name: 'Enter', duration: 1 }, { name: 'Settle', duration: 1 }],
      sequence,
      {
        createMixer: () => mixer,
        createStripClip: (source, strip) => ({ ...source, name: `${source.name}-${strip.order}` }),
        loopOnce: 'once',
      },
    )

    expect(actions[0]).toMatchObject({ enabled: true, paused: true, time: 0, weight: 0 })
    expect(actions[1]).toMatchObject({ enabled: false, paused: true, timeScale: -0.5 })
    running.update(0.5)
    expect(actions[0]).toMatchObject({ time: 0.5, weight: 0.25 })
    running.update(1.75)
    expect(actions[0]).toMatchObject({ enabled: true, time: 1, weight: 1 })
    expect(actions[1]?.enabled).toBe(false)
    running.update(0.75)
    expect(actions[0]?.enabled).toBe(false)
    expect(actions[1]).toMatchObject({ enabled: true, time: 1, weight: 0.75 })
    expect(updates.every((value) => value === 0)).toBe(true)

    running.stop()
    running.stop()
    expect(updates.filter((value) => value === -1)).toHaveLength(1)
    expect(() => running.update(0.1)).toThrow(/has been stopped/)
  })

  it('fails loudly for missing clips, trim drift, and aliased repeated clips', () => {
    expect(() => validateAnimationSequenceClips(sequence, {
      Enter: { duration: 1 }, Settle: { duration: 0.5 },
    })).toThrow(/trims to 1\.0000s.*0\.5000s/)
    expect(() => validateAnimationSequenceClips(sequence, {
      Enter: { duration: 1 },
    })).toThrow(/GLB contains: Enter/)

    const repeated: AnimationSequenceRecipe = {
      ...sequence,
      duration: 4,
      strips: [
        sequence.strips[0]!,
        { ...sequence.strips[0]!, order: 1, name: 'Enter Again', at: 2 },
      ],
    }
    expect(() => startAnimationSequence({}, [{ name: 'Enter', duration: 1 }], repeated, {
      createMixer: () => ({ clipAction: () => action(), update() {}, stopAllAction() {} }),
      createStripClip: (source) => source,
      loopOnce: 1,
    })).toThrow(/must return a distinct clip/)
  })

  it('loops at whole-sequence speed and resolves hold extrapolation without a competing pose', () => {
    const actions: ReturnType<typeof action>[] = []
    const heldSequence: AnimationSequenceRecipe = {
      ...sequence,
      loop: true,
      speed: 2,
      strips: [
        sequence.strips[0]!,
        { ...sequence.strips[1]!, extrapolation: 'hold', blendIn: 0.5 },
      ],
    }
    const running = startAnimationSequence(
      {},
      [{ name: 'Enter', duration: 1 }, { name: 'Settle', duration: 1 }],
      heldSequence,
      {
        createMixer: () => ({
          clipAction() { const next = action(); actions.push(next); return next },
          update() {},
          stopAllAction() {},
        }),
        createStripClip: (source, strip) => ({ ...source, name: `${source.name}-${strip.order}` }),
        loopOnce: 'once',
      },
    )

    // 1.25 real seconds -> 2.5 sequence seconds: the second strip's HOLD
    // owns the authored gap from the first strip's end until its own start.
    running.update(1.25)
    expect(actions[0]).toMatchObject({ enabled: false, weight: 0 })
    // HOLD preserves the boundary pose and its boundary influence. It must not
    // pop to full weight immediately before the authored Blend In begins.
    expect(actions[1]).toMatchObject({ enabled: true, time: 1, weight: 0 })

    // A further 1.5 seconds wraps 5.5 authored seconds to 0.5 seconds.
    running.update(1.5)
    expect(actions[0]).toMatchObject({ enabled: true, time: 0.5, weight: 0.25 })
    expect(actions[1]).toMatchObject({ enabled: false, weight: 0 })
    expect(() => running.update(-0.01)).toThrow(/non-negative delta/)
  })

  it('parses the additive schema and rejects timing or portability drift', () => {
    const parsed = parseSceneRecipe({ ...DEFAULT_SCENE_RECIPE, animationSequence: sequence })
    expect(parsed.diagnostics).toEqual([])
    expect(parsed.recipe?.animationSequence?.strips.map((strip) => strip.clip)).toEqual(['Enter', 'Settle'])

    const invalid = parseSceneRecipe({
      ...DEFAULT_SCENE_RECIPE,
      animationSequence: {
        ...sequence,
        strips: [{ ...sequence.strips[0], blend: 'multiply', speed: 2 }],
        duration: 2,
      },
    })
    expect(invalid.recipe).toBeNull()
    expect(invalid.diagnostics.map((entry) => entry.path)).toEqual(expect.arrayContaining([
      'animationSequence.strips[0].blend',
      'animationSequence.strips[0].speed',
    ]))
  })

  it('takes precedence over simple autoplay through the compiled-scene interface', () => {
    const actions: SequenceActionLike[] = []
    const mixer = {
      clipAction() { const next = action(); actions.push(next); return next },
      update() {},
      stopAllAction() {},
    }
    const loaded = {
      scene: { name: 'Root' },
      animations: [{ name: 'Enter', duration: 1 }, { name: 'Settle', duration: 1 }],
    }
    expect(() => startCompiledScenePlayback(loaded, {
      url: '/hero.glb', nodes: {}, animationSequence: sequence,
      playback: { start: 'manual', loop: 'repeat', speed: 1 },
    }, {
      createMixer: () => mixer,
      loopModes: { once: 1, repeat: 2, pingpong: 3 },
    })).toThrow(/createSequenceClip adapter/)

    const running = startCompiledScenePlayback(loaded, {
      url: '/hero.glb', nodes: {}, animationSequence: sequence,
      playback: { start: 'manual', loop: 'repeat', speed: 1 },
    }, {
      createMixer: () => mixer,
      loopModes: { once: 1, repeat: 2, pingpong: 3 },
      createSequenceClip: (source, strip) => ({ ...source, name: `${source.name}-${strip.order}` }),
    })
    expect(running?.clips.map((clip) => clip.name)).toEqual(['Enter-0', 'Settle-1'])
    expect(actions).toHaveLength(2)
  })
})
