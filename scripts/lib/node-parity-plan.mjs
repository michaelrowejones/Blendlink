// Every hosted shard has an explicit scope. No shard may silently fall back to all.
export const NODE_PARITY_SUITES = Object.freeze(['compositor', 'shaders', 'geometry', 'noise-fbm', 'noise-types'])
export function nodeParityPlan(args) {
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--suite') { index++; continue }
    if (args[index] !== '--list-suites') throw new Error('Unknown node parity argument ' + args[index])
  }
  const positions = args.flatMap((value, index) => value === '--suite' ? [index] : [])
  if (positions.length > 1) throw new Error('--suite must be specified once')
  const suite = positions.length ? args[positions[0] + 1] : 'all'
  if (suite !== 'all' && !NODE_PARITY_SUITES.includes(suite))
    throw new Error('--suite requires all, compositor, shaders, geometry, noise-fbm or noise-types')
  const selected = suite === 'all' ? [...NODE_PARITY_SUITES] : [suite]
  return Object.freeze({ suite, selected: Object.freeze(selected),
    compositor: selected.includes('compositor'), shaders: selected.includes('shaders'), geometry: selected.includes('geometry'),
    noiseFbm: selected.includes('noise-fbm'), noiseTypes: selected.includes('noise-types') })
}
