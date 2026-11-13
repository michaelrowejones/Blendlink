import { Vector3, Vector4, type Camera, type Object3D } from 'three'
import { normalize, uniform, vec3, select, viewportUV, cameraProjectionMatrix, positionView } from 'three/tsl'
import { irInspectionChildren } from './tslIrInspection.js'
import { TslIrError, type TslExpression, type TslIrExpression } from './tslNodeRecipe.js'
import { validateGeometryContextCamera } from './tslGeometryContext.js'

import { cameraGeometryBounds, validateOwnedCameraDataGeometry } from './tslCameraGeometry.js'
const versions = [[4, 2, 0], [5, 2, 0], [5, 3, 0]]

export function hasNativeCameraData(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasNativeCameraData)
  if (!value || typeof value !== 'object') return false
  return (value as TslIrExpression).op === 'camera_data_native'
    || irInspectionChildren(value).some(hasNativeCameraData)
}

/** Use actual decoded/drawn positions and transforms. An export snapshot never
 * replaces the active browser camera, which is checked again on every draw. */
export function validateCameraDataBinding(
  object: Object3D | null, basis: unknown, camera?: Camera | null,
  viewport?: {width:number;height:number;x?:number;y?:number},
): void {
  const boxLocal = cameraGeometryBounds(object,basis)
  const mesh = object!
  // Bound absolute intermediate magnitudes too: a small final world box does
  // not certify cancellation of enormous local coordinates and translations.
  const magnitude = [0, 1, 2].map(axis => Math.max(
    Math.abs(boxLocal.min.getComponent(axis)), Math.abs(boxLocal.max.getComponent(axis)),
  ))
  const e = mesh.matrixWorld.elements
  if ([0, 1, 2].some(row => Math.abs(e[row + 12])
    + [0, 1, 2].reduce((sum, axis) => sum + Math.abs(e[row + axis * 4]) * magnitude[axis], 0) > 128))
    throw new TslIrError('Camera Data requires object-to-world absolute position staging at most 128 units; apply/recenter distant geometry or choose source capture')
  const box = boxLocal.clone().applyMatrix4(mesh.matrixWorld)
  if ([...box.min, ...box.max].some(value => !Number.isFinite(value) || Math.abs(value) > 64))
    throw new TslIrError('Camera Data requires actual world mesh bounds within +/-64 units; reduce scene scale or choose source capture')
  if (camera === undefined) return
  validateGeometryContextCamera(camera)
  const point = new Vector3().setFromMatrixPosition(camera.matrixWorld)
  if (point.toArray().some(value => !Number.isFinite(value) || Math.abs(value) > 64))
    throw new TslIrError('Camera Data requires camera translation within +/-64 world units')
  const distance = box.distanceToPoint(point)
  if (distance < 1)
    throw new TslIrError('Camera Data requires the active camera at least 1 world unit from the mesh bounding box; move the camera back or choose source capture')
  if (!viewport || !Number.isFinite(viewport.width) || !Number.isFinite(viewport.height)
    || viewport.width <= 0 || viewport.height <= 0)
    throw new TslIrError('Camera Data needs the actual active renderer viewport')
  if((viewport.x??0)!==0||(viewport.y??0)!==0||(camera as Camera & {isArrayCamera?:boolean}).isArrayCamera)
    throw new TslIrError('Camera Data currently requires a single primary camera and a viewport starting at the render origin')
  const projection = camera.projectionMatrix.elements
  const perspective = !!(camera as Camera & {isPerspectiveCamera?:boolean}).isPerspectiveCamera
  const zero = perspective ? [1,2,3,4,6,7,8,9,12,13,15] : [1,2,3,4,6,7,8,9,11,12,13]
  if (projection.some(value => !Number.isFinite(Math.fround(value)))
    || projection[0] <= 0 || projection[5] <= 0 || zero.some(index => projection[index] !== 0)
    || projection[perspective ? 11 : 15] !== (perspective ? -1 : 1))
    throw new TslIrError('Camera Data requires a finite unshifted perspective/orthographic projection')
  const footprint = Math.max(2 / (projection[0] * viewport.width), 2 / (projection[5] * viewport.height))
    / (perspective ? 1 : distance)
  if (footprint > 1 / 256)
    throw new TslIrError('Camera Data angular footprint is unproven: use a narrower field of view, reduce orthographic scale/move back, or enlarge the render/preview viewport')

}

export function buildNativeCameraData(
  expression: TslIrExpression, basis: unknown,
): TslExpression {
  const child = expression.camera as TslIrExpression, version = expression.sourceVersion
  if (expression.model !== 'eevee-primary-camera-v1' || expression.sourceEngine !== 'EEVEE'
    || expression.output !== 'view-vector' || !Array.isArray(version) || version.length !== 3
    || !versions.some(known => known.every((value, index) => value === version[index]))
    || child?.op !== 'geometry_context' || child.output !== 'camera'
    || child.model !== 'primary-triangles-v1' || child.sourceEngine !== 'EEVEE'
    || !['gltf-y-up','blender-z-up'].includes(String(basis)))
    throw new TslIrError('Camera Data currently supports only View Vector with its verified EEVEE primary-camera model and actual geometry camera binding; raw Z Depth/Distance lack a verified clip/interpolant precision contract')
  const approved = uniform(1).onObjectUpdate(frame => {
    const renderer = frame.renderer as any
    validateOwnedCameraDataGeometry(frame.object,renderer,basis)
    const target = renderer.getRenderTarget()
    const viewport = target?.viewport ?? renderer.getViewport(new Vector4())
    const ratio = target ? 1 : renderer.getPixelRatio()
    validateCameraDataBinding(frame.object, basis, frame.camera, {width:viewport.z * ratio,height:viewport.w * ratio,x:viewport.x * ratio,y:viewport.y * ratio})
  })
  const perspective = uniform(1).onObjectUpdate(function(frame) {
    this.value = (frame.camera as Camera & {isPerspectiveCamera?:boolean})?.isPerspectiveCamera ? 1 : 0
  })
  // EEVEE normalizes camera-space surface P. For a primary fragment its XY
  // coordinates follow the inverse projection ray; perspective normalization
  // cancels depth. Orthographic projection retains the actual surface depth.
  // This avoids substituting a constant orthographic ray or inheriting a
  // backend's coarse world-position interpolant for the screen coordinates.
  const projection:any = cameraProjectionMatrix
  const point = vec3(
    viewportUV.x.mul(2).sub(1).div(projection.element(0).x),
    viewportUV.y.mul(-2).add(1).div(projection.element(1).y),
    select(perspective.equal(1),1,positionView.z.negate()),
  )
  return normalize(point).mul(approved) as unknown as TslExpression
}
