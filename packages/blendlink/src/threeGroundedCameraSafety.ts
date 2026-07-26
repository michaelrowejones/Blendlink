import * as THREE from 'three'

export interface ThreeGroundedCameraSafety {
  cameraInsideRadius: boolean
  cameraDistance: number
  radius: number
  currentFar: number
  requiredFar: number
  clippedVertexCount: number
}

type ClippableCamera = THREE.Camera & {
  far: number
  updateProjectionMatrix(): void
}

/**
 * Inspect the exact generated GroundedSkybox geometry in camera space.
 *
 * A sphere-distance estimate is needlessly conservative after Three flattens
 * the lower hemisphere, so the runtime measures the shipped vertices once.
 * This is an installation-time safety check, not continuous camera ownership.
 */
export function inspectThreeGroundedCameraSafety(
  camera: ClippableCamera,
  ground: THREE.Mesh<THREE.BufferGeometry>,
  radius: number,
): ThreeGroundedCameraSafety {
  if (!Number.isFinite(radius) || radius <= 0) {
    throw new Error(`Grounded Backdrop radius must be positive and finite; got ${radius}.`)
  }
  if (!Number.isFinite(camera.far) || camera.far <= 0) {
    throw new Error(`Grounded Backdrop camera far plane must be positive and finite; got ${camera.far}.`)
  }
  const position = ground.geometry.getAttribute('position')
  if (!position || position.itemSize < 3 || position.count === 0) {
    throw new Error('Grounded Backdrop camera safety needs finite generated position vertices.')
  }

  camera.updateWorldMatrix(true, false)
  camera.matrixWorldInverse.copy(camera.matrixWorld).invert()
  ground.updateWorldMatrix(true, false)
  const groundToView = new THREE.Matrix4().multiplyMatrices(
    camera.matrixWorldInverse,
    ground.matrixWorld,
  )
  const vertex = new THREE.Vector3()
  let maximumDepth = 0
  let clippedVertexCount = 0
  for (let index = 0; index < position.count; index += 1) {
    vertex.fromBufferAttribute(position, index).applyMatrix4(groundToView)
    const depth = -vertex.z
    if (!Number.isFinite(depth) || depth <= 0) continue
    maximumDepth = Math.max(maximumDepth, depth)
    if (depth > camera.far) clippedVertexCount += 1
  }
  if (maximumDepth <= 0) {
    throw new Error(
      'Grounded Backdrop camera safety found no finite projection vertices in front of the camera.',
    )
  }

  const cameraPosition = camera.getWorldPosition(new THREE.Vector3())
  const groundCenter = ground.getWorldPosition(new THREE.Vector3())
  const cameraDistance = cameraPosition.distanceTo(groundCenter)
  // Clipping is performed in homogeneous float precision after vertex-shader
  // transforms. A tenth-percent guard keeps edge triangles clear of the far
  // plane without adopting the much more conservative center-distance-plus-
  // radius estimate.
  const numericalMargin = Math.max(0.001, maximumDepth * 0.001)
  return Object.freeze({
    cameraInsideRadius: cameraDistance <= radius * (1 + 1e-6),
    cameraDistance,
    radius,
    currentFar: camera.far,
    requiredFar: maximumDepth + numericalMargin,
    clippedVertexCount,
  })
}

export function repairPackageGroundedCameraFar(
  camera: ClippableCamera,
  safety: ThreeGroundedCameraSafety,
): boolean {
  if (camera.far >= safety.requiredFar) return false
  camera.far = safety.requiredFar
  camera.updateProjectionMatrix()
  return true
}
