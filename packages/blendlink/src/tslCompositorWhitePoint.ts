import { DataTexture, FloatType, RGBAFormat } from 'three'
import * as TSL from 'three/tsl'
import type { SourceCompositorOperation } from './sourceDisplay.js'
import type { TslEffectNode } from './tslPostEffects.js'

const { Fn, clamp, float, floor, ivec2, mix, select, sqrt, textureLoad, vec2, vec3 } = TSL as unknown as Record<
  'Fn' | 'clamp' | 'float' | 'floor' | 'ivec2' | 'mix' | 'select' | 'sqrt' | 'textureLoad' | 'vec2' | 'vec3',
  (...args: TslEffectNode[]) => TslEffectNode>

// Robertson's 31-entry Planckian locus, as used by Blender's native
// whitepoint_from_temp_tint (BLI and GPU compositor). Units: inverse MK, u, v, slope.
const LOCUS = [
  [0, .18006, .26352, -.24341], [10, .18066, .26589, -.25479], [20, .18133, .26846, -.26876],
  [30, .18208, .27119, -.28539], [40, .18293, .27407, -.30470], [50, .18388, .27709, -.32675],
  [60, .18494, .28021, -.35156], [70, .18611, .28342, -.37915], [80, .18740, .28668, -.40955],
  [90, .18880, .28997, -.44278], [100, .19032, .29326, -.47888], [125, .19462, .30141, -.58204],
  [150, .19962, .30921, -.70471], [175, .20525, .31647, -.84901], [200, .21142, .32312, -1.0182],
  [225, .21807, .32909, -1.2168], [250, .22511, .33439, -1.4512], [275, .23247, .33904, -1.7298],
  [300, .24010, .34308, -2.0637], [325, .24792, .34655, -2.4681], [350, .25591, .34951, -2.9641],
  [375, .26400, .35200, -3.5814], [400, .27218, .35407, -4.3633], [425, .28039, .35577, -5.3762],
  [450, .28863, .35714, -6.7262], [475, .29685, .35823, -8.5955], [500, .30505, .35907, -11.324],
  [525, .31320, .35968, -15.628], [550, .32129, .36011, -23.325], [575, .32931, .36038, -40.770],
  [600, .33724, .36051, -116.45],
]
const BRADFORD = [[.8951, .2664, -.1614], [-.7502, 1.7135, .0367], [.0389, -.0685, 1.0296]]
const INVERSE_BRADFORD = [[.9869929, -.1470543, .1599627], [.4323053, .5183603, .0492912],
  [-.0085287, .0400428, .9684867]]

export function buildCompositorWhitePoint(op: SourceCompositorOperation,
  input: (name: string) => TslEffectNode, gpu: boolean,
  resources: { dispose(): void }[], fail: (message: string) => never): TslEffectNode {
  const p = op.properties
  const matrix = (value: unknown, label: string): number[][] => {
    if (!Array.isArray(value) || value.length !== 3 || value.some(row => !Array.isArray(row)
      || row.length !== 3 || !row.every(Number.isFinite))) fail('White Point requires finite ' + label + ' matrix rows')
    return value as number[][]
  }
  if (p.white_point_model !== 'native-bradford-robertson-v1' || typeof p.white_point_gpu_constant !== 'boolean')
    fail('White Point requires its native chromatic-adaptation model')
  const domains = p.white_point_domains
  if (!Array.isArray(domains) || domains.length !== 4 || domains.some((row, index) => !Array.isArray(row)
    || row.length !== 2 || !row.every(Number.isFinite) || row[0] > row[1]
    || row[0] < (index % 2 ? -150 : 1800) || row[1] > (index % 2 ? 150 : 100000)))
    fail('White Point requires proven temperature 1800..100000 and tint -150..150 domains')
  const lms = p.white_point_source_lms_bounds
  if (!Array.isArray(lms) || lms.length !== 3 || lms.some(row => !Array.isArray(row) || row.length !== 2
    || !row.every(Number.isFinite) || row[0] > row[1] || row[0] <= 0 && row[1] >= 0))
    fail('White Point requires a provably nonzero Bradford source response')
  const forward = matrix(p.white_point_scene_to_xyz, 'scene-linear to XYZ')
  const reverse = matrix(p.white_point_xyz_to_scene, 'XYZ to scene-linear')
  const multiply = (rows: number[][], value: TslEffectNode): TslEffectNode => vec3(...rows.map(row =>
    value.x.mul(row[0]).add(value.y.mul(row[1])).add(value.z.mul(row[2]))))
  if (p.white_point_constant_matrix !== undefined && (!gpu || p.white_point_gpu_constant)) {
    return multiply(matrix(p.white_point_constant_matrix, 'constant adaptation'), input('Image').rgb)
  }
  if (p.white_point_gpu_constant) fail('White Point is missing its native constant adaptation matrix')
  const texture = new DataTexture(new Float32Array(LOCUS.flat()), 31, 1, RGBAFormat, FloatType)
  texture.needsUpdate = true
  resources.push(texture)
  const white = (temperature: TslEffectNode, tint: TslEffectNode): TslEffectNode => Fn(() => {
    const inverseTemperature = clamp(float(1e6).div(temperature), 0, 600).toVar()
    const index = select(inverseTemperature.lessThan(100), floor(inverseTemperature.div(10)),
      floor(inverseTemperature.sub(100).div(25)).add(10))
    const lower = textureLoad(texture, ivec2(index, 0)).toVar()
    const upper = textureLoad(texture, ivec2(index.add(1), 0)).toVar()
    const factor = inverseTemperature.sub(lower.x).div(upper.x.sub(lower.x))
    const normalize = (vector: TslEffectNode): TslEffectNode => vector.div(sqrt(vector.dot(vector)))
    const direction = normalize(mix(normalize(vec2(1, lower.w)), normalize(vec2(1, upper.w)), factor))
    const uv = mix(lower.yz, upper.yz, factor).sub(direction.mul(tint).div(3000)).toVar()
    const denominator = uv.x.mul(2).sub(uv.y.mul(8)).add(4)
    const x = uv.x.mul(3).div(denominator), y = uv.y.mul(2).div(denominator)
    return vec3(x.div(y), 1, x.negate().sub(y).add(1).div(y))
  })()
  return Fn(() => {
    const from = multiply(BRADFORD, white(input('Input Temperature'), input('Input Tint'))).toVar()
    const to = multiply(BRADFORD, white(input('Output Temperature'), input('Output Tint'))).toVar()
    const color = multiply(BRADFORD, multiply(forward, input('Image').rgb))
    return multiply(reverse, multiply(INVERSE_BRADFORD, color.mul(to.div(from))))
  })()
}
