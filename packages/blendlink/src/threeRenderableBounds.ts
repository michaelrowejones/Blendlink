import * as THREE from 'three'

function expandVisibleMeshBounds(
  bounds: THREE.Box3,
  object: THREE.Object3D,
  point: THREE.Vector3,
): void {
  if (!object.visible ||
      object.userData.blendlink_auto_fit === false ||
      (object as THREE.Object3D & { isUI?: boolean }).isUI === true) return

  const mesh = object as THREE.Mesh
  const geometry = mesh.geometry
  const position = geometry?.getAttribute('position')
  if ((mesh as THREE.Mesh).isMesh && position) {
    object.updateWorldMatrix(false, false)
    if ((mesh as THREE.InstancedMesh).isInstancedMesh) {
      const instanced = mesh as THREE.InstancedMesh
      if (instanced.boundingBox === null) instanced.computeBoundingBox()
      if (instanced.boundingBox) {
        bounds.union(instanced.boundingBox.clone().applyMatrix4(object.matrixWorld))
      }
    } else {
      for (let index = 0; index < position.count; index += 1) {
        mesh.getVertexPosition(index, point)
        point.applyMatrix4(object.matrixWorld)
        if ([point.x, point.y, point.z].every(Number.isFinite)) bounds.expandByPoint(point)
      }
    }
  }

  for (const child of object.children) expandVisibleMeshBounds(bounds, child, point)
}

/** World-space bounds for visible renderable meshes beneath one compiled root.
 * Application-owned siblings, hidden subtrees, UI, and explicitly excluded
 * authoring helpers cannot influence the result. */
export function visibleCompiledRootBounds(root: THREE.Object3D): THREE.Box3 {
  root.updateWorldMatrix(true, true)
  const bounds = new THREE.Box3().makeEmpty()
  expandVisibleMeshBounds(bounds, root, new THREE.Vector3())
  return bounds
}

/** Center a grounded environment over the compiled scene and place its floor
 * at the lowest visible renderable point. Returns false for an empty root so
 * environment-only scenes can retain the authored world origin. */
export function fitGroundedBackgroundToCompiledRoot(
  ground: THREE.Object3D,
  root: THREE.Object3D,
  captureHeight: number,
): boolean {
  const bounds = visibleCompiledRootBounds(root)
  if (bounds.isEmpty() ||
      ![bounds.min.x, bounds.min.y, bounds.min.z, bounds.max.x, bounds.max.y, bounds.max.z]
        .every(Number.isFinite)) return false

  ground.position.set(
    (bounds.min.x + bounds.max.x) / 2,
    bounds.min.y + captureHeight,
    (bounds.min.z + bounds.max.z) / 2,
  )
  return true
}
