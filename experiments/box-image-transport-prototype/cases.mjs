export const blend = Math.fround(0.09966777265071869)
export const sourceSha256 = '9f636b2e1a59b3d181f90caf1b1703658eeadebad57f3c6207737d2fe3ffd85e'
const normals = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
  [1, 1, 1], [-1, -1, -1], [1, 1, 0], [1, 0, 1], [0, 1, 1],
  [1, .95, .1], [1, .1, .95], [.1, 1, .95], [1, .9, .9],
  ...[-1, 1].flatMap(x => [-1, 1].flatMap(y => [-1, 1].map(z => [x * .25, y * .5, z * .75]))),
  [1, Math.fround((1 - blend) / (1 + blend)), 0],
  [1, Math.fround((1 - blend) / (1 + blend)) - 2 ** -23, 0],
  [1, Math.fround((1 - blend) / (1 + blend)) + 2 ** -23, 0],
]
export const weightCases = normals.map((normal, i) => ({ id: 'weights-' + i, normal, blend }))
export const samplerCases = ['Plaster-Overlay.png', 'Plaster-normal.png'].flatMap(image =>
  ['nomip', 'mip'].flatMap(mode => [.03125, 1, 8].flatMap(frequency =>
    [[0, 0, 1], [1, .95, .1], [-1, .95, -.95], [1, -.95, .95]].map((normal, n) => ({
      id: image.replace('.png', '') + '-' + mode + '-' + frequency + '-' + n,
      image, mode, frequency, normal, blend, coordinate: [frequency, .125, .375, .625],
    })))))

// These are fixed research gates, not a production support contract.
export const gates = { weightMaxAbs: 2 ** -20, weightMaxUlp: 8, samplerDiagnosticMaxAbs: 2 ** -10 }
