import type { Camera, OrthographicCamera, PerspectiveCamera } from 'three'
import {
  float,
  orthographicDepthToViewZ,
  perspectiveDepthToViewZ,
  select,
  uniform,
} from 'three/tsl'
import type { TslEffectNode } from './tslPostEffects.js'

/** EEVEE Depth is camera-axis distance, including for off-axis pixels. */
export function buildSourceDepth(depth: TslEffectNode, getCamera: () => Camera): TslEffectNode {
  const camera = () => getCamera() as PerspectiveCamera | OrthographicCamera
  const near = uniform(camera().near).onRenderUpdate(() => camera().near)
  const far = uniform(camera().far).onRenderUpdate(() => camera().far)
  const isOrthographic = () => (camera() as OrthographicCamera).isOrthographicCamera === true
  const orthographic = uniform(isOrthographic()).onRenderUpdate(isOrthographic)
  const viewZ = select(
    orthographic,
    orthographicDepthToViewZ(depth, near, far),
    perspectiveDepthToViewZ(depth, near, far),
  )
  return select(depth.greaterThanEqual(1), float(1e10), viewZ.negate())
}
