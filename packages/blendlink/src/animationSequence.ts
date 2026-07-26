/**
 * A deliberately small authored-animation seam.
 *
 * Blender remains the timeline editor. The compiler publishes one NLA track
 * as an ordered schedule over ordinary glTF clips, and this module performs
 * that schedule without introducing an Animator/state-machine abstraction.
 */

export type AnimationSequenceBlend = 'replace' | 'add'
export type AnimationSequenceEasing = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out'
export type AnimationSequenceExtrapolation = 'nothing' | 'hold-forward' | 'hold'

export interface AnimationSequenceStrip {
  /** Stable ordering evidence from the selected Blender NLA track. */
  order: number
  /** Artist-facing NLA strip name. */
  name: string
  /** Exact exported Blender Action / glTF clip name. */
  clip: string
  /** Sequence-local start and duration in seconds. */
  at: number
  duration: number
  /** Trim inside the zero-based exported Action clip, in seconds. */
  clipStart: number
  clipEnd: number
  /** Blender NLA time stretch and its explicit reciprocal. */
  scale: number
  speed: number
  /** Fractional repeats are supported and sampled deterministically. */
  repeat: number
  blend: AnimationSequenceBlend
  /** Blend envelope in seconds, multiplied by weight. */
  blendIn: number
  blendOut: number
  weight: number
  easing: AnimationSequenceEasing
  extrapolation: AnimationSequenceExtrapolation
  reverse: boolean
  muted: boolean
}

export interface AnimationSequenceRecipe {
  name: string
  /** Diagnostic evidence only; runtime clip binding is name-based. */
  source: Readonly<{
    objectId: string
    objectName: string
    track: string
  }>
  duration: number
  loop: boolean
  /** Whole-sequence playback multiplier. */
  speed: number
  strips: readonly AnimationSequenceStrip[]
}

export interface SequenceClipLike {
  name: string
  duration?: number
  [key: string]: unknown
}

export interface SequenceActionLike {
  clampWhenFinished: boolean
  timeScale: number
  enabled?: boolean
  paused?: boolean
  time?: number
  weight?: number
  reset(): unknown
  setLoop(mode: unknown, repetitions: number): unknown
  play(): unknown
  stop?(): unknown
  setEffectiveWeight?(weight: number): unknown
}

export interface SequenceMixerLike<TClip extends SequenceClipLike = SequenceClipLike> {
  clipAction(clip: TClip): SequenceActionLike
  update(deltaSeconds: number): unknown
  stopAllAction(): unknown
}

export interface AnimationSequenceOptions<
  TRoot,
  TClip extends SequenceClipLike,
  TMixer extends SequenceMixerLike<TClip>,
> {
  createMixer(root: TRoot): TMixer
  /**
   * Return a distinct clip for every strip. Three's mixer otherwise aliases
   * two uses of the same Action to one AnimationAction. Additive strips must
   * also be converted here using the host animation library's native helper.
   */
  createStripClip(source: TClip, strip: AnimationSequenceStrip): TClip
  loopOnce: unknown
}

export interface RunningAnimationSequence<
  TClip extends SequenceClipLike = SequenceClipLike,
  TMixer extends SequenceMixerLike<TClip> = SequenceMixerLike<TClip>,
> {
  readonly mixer: TMixer
  readonly clips: readonly TClip[]
  readonly actions: readonly SequenceActionLike[]
  readonly recipe: AnimationSequenceRecipe
  /** Current authored sequence time in seconds, after whole-sequence speed. */
  readonly time: number
  readonly paused: boolean
  readonly finished: boolean
  update(deltaSeconds: number): void
  /** Seek in authored sequence seconds and evaluate the exact pose immediately. */
  seek(timeSeconds: number): void
  pause(): void
  resume(): void
  stop(): void
}

interface PreparedStrip<TClip extends SequenceClipLike> {
  recipe: AnimationSequenceStrip
  source: TClip
  action: SequenceActionLike
  holdFrom: number
  holdUntil: number
  holdsToSequenceEnd: boolean
}

const EPSILON = 1e-6

/** Validate a parsed sequence against the clips that actually survived glTF. */
export function validateAnimationSequenceClips(
  recipe: AnimationSequenceRecipe,
  clips: Readonly<Record<string, { duration: number }>>,
): void {
  for (const strip of recipe.strips) {
    const clip = clips[strip.clip]
    if (!clip) {
      throw new Error(
        `Animation sequence "${recipe.name}" strip "${strip.name}" references ` +
          `clip "${strip.clip}", but the GLB contains: ` +
          `${Object.keys(clips).join(', ') || 'none'}. Ensure the Action is assigned to ` +
          'the selected NLA source and is included in the exported scene.',
      )
    }
    if (strip.clipEnd > clip.duration + 1e-4) {
      throw new Error(
        `Animation sequence "${recipe.name}" strip "${strip.name}" trims to ` +
          `${strip.clipEnd.toFixed(4)}s, beyond exported clip "${strip.clip}" ` +
          `(${clip.duration.toFixed(4)}s). Save the .blend and rebuild so the ` +
          'NLA metadata and glTF Action agree.',
      )
    }
  }
}

/**
 * Compose a validated authored sequence over one mixer.
 *
 * Actions are paused and sought explicitly, making frame trims, reverse,
 * fractional repeats, gaps, and large render-loop deltas deterministic. The
 * mixer receives update(0) only to evaluate the authored pose at that time.
 */
export function startAnimationSequence<
  TRoot,
  TClip extends SequenceClipLike,
  TMixer extends SequenceMixerLike<TClip>,
>(
  root: TRoot,
  availableClips: readonly TClip[],
  recipe: AnimationSequenceRecipe,
  options: AnimationSequenceOptions<TRoot, TClip, TMixer>,
): RunningAnimationSequence<TClip, TMixer> {
  if (recipe.strips.length === 0) {
    throw new Error(`Animation sequence "${recipe.name}" contains no NLA strips.`)
  }
  const available = new Map<string, TClip>()
  for (const clip of availableClips) {
    if (!clip.name) continue
    if (available.has(clip.name)) {
      throw new Error(
        `Animation sequence "${recipe.name}" cannot bind duplicate exported clip name "${clip.name}".`,
      )
    }
    available.set(clip.name, clip)
  }

  const mixer = options.createMixer(root)
  const ordered = [...recipe.strips].sort((left, right) => left.order - right.order)
  const prepared: PreparedStrip<TClip>[] = []
  try {
    for (const [index, strip] of ordered.entries()) {
      const source = available.get(strip.clip)
      if (!source) {
        throw new Error(
          `Animation sequence "${recipe.name}" strip "${strip.name}" references ` +
            `clip "${strip.clip}", but the loaded GLB contains: ` +
            `${[...available.keys()].join(', ') || 'none'}.`,
        )
      }
      if (source.duration !== undefined && strip.clipEnd > source.duration + 1e-4) {
        throw new Error(
          `Animation sequence "${recipe.name}" strip "${strip.name}" trims past ` +
            `loaded clip "${strip.clip}" (${source.duration.toFixed(4)}s).`,
        )
      }
      const stripClip = options.createStripClip(source, strip)
      if (stripClip === source && ordered.some((candidate, other) =>
        other !== index && candidate.clip === strip.clip
      )) {
        throw new Error(
          `Animation sequence adapter reused clip "${strip.clip}" for multiple strips. ` +
            'createStripClip() must return a distinct clip so Three.js does not alias their actions.',
        )
      }
      const action = mixer.clipAction(stripClip)
      action.reset()
      action.clampWhenFinished = true
      action.timeScale = (strip.reverse ? -1 : 1) * strip.speed * recipe.speed
      action.setLoop(options.loopOnce, 1)
      action.play()
      action.paused = true
      action.enabled = false
      action.weight = 0
      action.setEffectiveWeight?.(0)
      const next = ordered.slice(index + 1).find((candidate) => !candidate.muted)
      const previous = [...ordered.slice(0, index)].reverse().find((candidate) => !candidate.muted)
      prepared.push({
        recipe: strip,
        source: stripClip,
        action,
        holdFrom: previous ? previous.at + previous.duration : 0,
        holdUntil: next?.extrapolation === 'hold'
          ? strip.at + strip.duration
          : next?.at ?? recipe.duration,
        holdsToSequenceEnd: next === undefined,
      })
    }
  } catch (error) {
    mixer.stopAllAction()
    throw error
  }

  let elapsed = 0
  let paused = false
  let stopped = false

  const sequenceTime = (): number => recipe.loop
    ? positiveModulo(elapsed * recipe.speed, recipe.duration)
    : Math.min(elapsed * recipe.speed, recipe.duration)
  const finished = (): boolean => !recipe.loop
    && elapsed * recipe.speed >= recipe.duration - EPSILON

  const evaluate = (): void => {
    const currentTime = sequenceTime()
    for (const item of prepared) {
      const strip = item.recipe
      const local = currentTime - strip.at
      const active = !strip.muted && local >= -EPSILON && local < strip.duration - EPSILON
      const heldBackward = !strip.muted && strip.extrapolation === 'hold'
        && currentTime >= item.holdFrom - EPSILON && currentTime < strip.at - EPSILON
      const heldForward = !strip.muted && strip.extrapolation !== 'nothing'
        && local >= strip.duration - EPSILON
        && (item.holdsToSequenceEnd
          ? currentTime <= item.holdUntil + EPSILON
          : currentTime < item.holdUntil - EPSILON)
      const contributing = active || heldBackward || heldForward
      const action = item.action
      action.enabled = contributing
      action.paused = true
      if (!contributing) {
        action.weight = 0
        action.setEffectiveWeight?.(0)
        continue
      }
      const sampleElapsed = active ? Math.max(0, local) : heldBackward ? 0 : strip.duration
      action.time = stripSampleTime(strip, sampleElapsed)
      // Extrapolation holds the boundary pose, not a different influence.
      // Re-evaluating the envelope at that boundary avoids a full-weight pop
      // immediately before Blend In or immediately after Blend Out.
      const weight = stripEnvelope(strip, sampleElapsed)
      action.weight = weight
      action.setEffectiveWeight?.(weight)
    }
    mixer.update(0)
  }

  evaluate()
  return {
    mixer,
    clips: prepared.map((item) => item.source),
    actions: prepared.map((item) => item.action),
    recipe,
    get time() { return sequenceTime() },
    get paused() { return paused },
    get finished() { return finished() },
    update(deltaSeconds: number) {
      if (stopped) throw new Error(`Animation sequence "${recipe.name}" has been stopped.`)
      if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) {
        throw new Error(
          `Animation sequence "${recipe.name}" update needs a non-negative delta in seconds; ` +
          `got ${deltaSeconds}.`,
        )
      }
      if (paused || finished()) return
      elapsed += deltaSeconds
      evaluate()
    },
    seek(timeSeconds: number) {
      if (stopped) throw new Error(`Animation sequence "${recipe.name}" has been stopped.`)
      if (!Number.isFinite(timeSeconds) || timeSeconds < 0) {
        throw new Error(
          `Animation sequence "${recipe.name}" seek needs a non-negative finite time in seconds; ` +
            `got ${timeSeconds}.`,
        )
      }
      const authoredTime = recipe.loop
        ? positiveModulo(timeSeconds, recipe.duration)
        : Math.min(timeSeconds, recipe.duration)
      elapsed = recipe.speed > 0 ? authoredTime / recipe.speed : 0
      evaluate()
    },
    pause() {
      if (stopped) throw new Error(`Animation sequence "${recipe.name}" has been stopped.`)
      paused = true
    },
    resume() {
      if (stopped) throw new Error(`Animation sequence "${recipe.name}" has been stopped.`)
      paused = false
    },
    stop() {
      if (stopped) return
      stopped = true
      for (const item of prepared) item.action.stop?.()
      mixer.stopAllAction()
    },
  }
}

function stripSampleTime(strip: AnimationSequenceStrip, elapsed: number): number {
  const span = strip.clipEnd - strip.clipStart
  const totalSourceTime = span * strip.repeat
  const sourceElapsed = Math.min(totalSourceTime, Math.max(0, elapsed / strip.scale))
  const atEnd = sourceElapsed >= totalSourceTime - EPSILON
  let cycle = sourceElapsed % span
  if (atEnd && Math.abs(strip.repeat - Math.round(strip.repeat)) < EPSILON) cycle = span
  const forward = strip.clipStart + cycle
  return strip.reverse ? strip.clipEnd - cycle : forward
}

function stripEnvelope(strip: AnimationSequenceStrip, elapsed: number): number {
  const fadeIn = strip.blendIn <= EPSILON ? 1 : Math.min(1, elapsed / strip.blendIn)
  const remaining = Math.max(0, strip.duration - elapsed)
  const fadeOut = strip.blendOut <= EPSILON ? 1 : Math.min(1, remaining / strip.blendOut)
  return strip.weight * ease(Math.min(fadeIn, fadeOut), strip.easing)
}

function ease(value: number, easing: AnimationSequenceEasing): number {
  const t = Math.max(0, Math.min(1, value))
  if (easing === 'ease-in') return t * t
  if (easing === 'ease-out') return 1 - (1 - t) * (1 - t)
  if (easing === 'ease-in-out') return t * t * (3 - 2 * t)
  return t
}

function positiveModulo(value: number, divisor: number): number {
  if (!(divisor > 0)) return 0
  return ((value % divisor) + divisor) % divisor
}
