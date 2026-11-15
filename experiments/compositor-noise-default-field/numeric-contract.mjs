/* SPDX-License-Identifier: MIT */
// Browser-safe metric definitions. References come from actual Blender words.
export const precision = Object.freeze({ absoluteMax: 2 ** -20, ulpsMax: 8 })
// Synchronous casts share one scratch word; large proof readbacks must not
// allocate several ArrayBuffers per pixel channel.
const scratch = new ArrayBuffer(4), floats = new Float32Array(scratch), integers = new Uint32Array(scratch)
export const word = value => { floats[0] = value; return integers[0] }
export const floatFromWord = value => { integers[0] = value; return floats[0] }
const ordered = value => value & 0x80000000 ? 0x80000000 - value : 0x80000000 + value
export function numericDifference(actualWord, nativeWord) {
  const actual = floatFromWord(actualWord), native = floatFromWord(nativeWord)
  const absoluteError = Math.abs(actual - native), ulps = Math.abs(ordered(actualWord) - ordered(nativeWord))
  return { absoluteError, ulps, outsideTolerance: !Number.isFinite(actual) || !Number.isFinite(native)
    || absoluteError > precision.absoluteMax || ulps > precision.ulpsMax }
}
export function uniformAxisWords(size, maximum) {
  const f = Math.fround
  return Array.from({ length: size }, (_, i) => word(f(f(f(f(i + .5) - f(size / 2)) / maximum) * 2)))
}
export function compareNoise(actual, native, coordinates, entry, flip = false) {
  const length = entry.width * entry.height * 4
  if (![actual, native, coordinates].every(values => values.length === length)) throw Error('Noise comparison extent mismatch')
  let wordDifferences = 0, contractViolations = 0, maxUlps = 0, maxAbsoluteError = 0
  let alphaDifferences = 0, latticeControls = 0, latticeDifferences = 0, facBroadcastDifferences = 0
  const firstDifferences = []
  for (let y = 0; y < entry.height; y++) for (let x = 0; x < entry.width; x++) {
    const i = (y * entry.width + x) * 4
    const j = ((flip ? entry.height - 1 - y : y) * entry.width + x) * 4
    const lattice = Number.isInteger(Math.fround(floatFromWord(coordinates[j]) * 5))
      && Number.isInteger(Math.fround(floatFromWord(coordinates[j + 1]) * 5))
    if (native[j + 3] !== word(1)) throw Error('Native Noise alpha must be exactly one')
    if (entry.output === 'Fac') {
      if (native[j] !== native[j + 1] || native[j] !== native[j + 2]) throw Error('Native Fac must broadcast exactly')
      facBroadcastDifferences += Number(actual[i] !== actual[i + 1]) + Number(actual[i] !== actual[i + 2])
    }
    for (let lane = 0; lane < 4; lane++) {
      const a = actual[i + lane], b = native[j + lane]
      const value = floatFromWord(a)
      const { absoluteError: delta, ulps, outsideTolerance } = numericDifference(a, b)
      maxUlps = Math.max(maxUlps, ulps); maxAbsoluteError = Math.max(maxAbsoluteError, delta)
      wordDifferences += Number(a !== b)
      const endpoint = lattice && lane < 3 && (entry.output === 'Fac' || lane === 0)
      if (endpoint) {
        if (b !== word(.5)) throw Error('Native scaled lattice Fac/red must be exactly one half')
        latticeControls++; latticeDifferences += Number(a !== word(.5))
      }
      alphaDifferences += Number(lane === 3 && a !== word(1))
      const invalid = !Number.isFinite(value) || value < 0 || value > 1
        || (lane === 3 ? a !== word(1) : outsideTolerance)
        || (endpoint && a !== word(.5))
        || (entry.output === 'Fac' && lane > 0 && lane < 3 && a !== actual[i])
      contractViolations += Number(invalid)
      if (a !== b && firstDifferences.length < 8) firstDifferences.push({ x, y, lane, actualWord: a, nativeWord: b, absoluteError: delta, ulps })
    }
  }
  return { comparedWords: length, wordDifferences, contractViolations, maxUlps, maxAbsoluteError,
    alphaDifferences, latticeControls, latticeDifferences, facBroadcastDifferences, firstDifferences }
}
export function assertRedFac(fac, color) {
  if (fac.length !== color.length) throw Error('Red/Fac extent mismatch')
  let differences = 0
  for (let i = 0; i < fac.length; i += 4) differences += Number(fac[i] !== color[i])
  if (differences) throw Error('Color.red differs from Fac: ' + differences)
  return { comparedPixels: fac.length / 4, differences }
}
export function assertRedFacObservations(observations) {
  const groups = new Map()
  for (const observation of observations) {
    const group = groups.get(observation.cohort) ?? { Fac: [], Color: [] }
    if (!['Fac', 'Color'].includes(observation.output)) throw Error('Unknown observation output')
    group[observation.output].push(observation.words); groups.set(observation.cohort, group)
  }
  let comparedPixels = 0
  for (const [cohort, group] of groups) {
    if (group.Fac.length !== group.Color.length || !group.Fac.length) throw Error('Missing exact red/Fac partner: ' + cohort)
    for (let i = 0; i < group.Fac.length; i++) comparedPixels += assertRedFac(group.Fac[i], group.Color[i]).comparedPixels
  }
  return { comparedPixels, differences: 0, cohorts: groups.size }
}
