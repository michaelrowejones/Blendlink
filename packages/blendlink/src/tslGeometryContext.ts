import { irInspectionChildren } from './tslIrInspection.js'
// Native packed-normal math adapts Cycles util/types_normal.h (Apache-2.0).
// Copyright 2011-2026 Blender Foundation. SceneToWeb supplies Three.js bindings,
// source-scene storage profiles, per-owner uniforms and runtime guards.
// See assets/blender-spectral-NOTICE.txt and blender-spectral-apache-2.0.txt.
import {
  Matrix3,
  Matrix4,
  Vector3,
  type BufferGeometry,
  type Camera,
  type Mesh,
  type Object3D,
} from 'three'
import {
  attribute,
  dot,
  frontFacing,
  normalize,
  positionWorld,
  select,
  trunc,
  uniform,
  vec3,
  vec4,
} from 'three/tsl'
import { TslIrError, type TslExpression, type TslIrExpression } from './tslNodeRecipe.js'
import { nativeVectorTransformMatrix } from './tslVectorTransform.js'

type Basis = 'blender-z-up' | 'gltf-y-up'
type Frame = { object: Mesh; camera: Camera }
export const GEOMETRY_CONTEXT_OUTPUTS = [
  'position',
  'normal',
  'true-normal',
  'incoming',
  'backfacing',
  'camera',
  'object-normal',
  'window',
  'reflection',
] as const
type Output = (typeof GEOMETRY_CONTEXT_OUTPUTS)[number]
export type GeometryContextOutput = Output
const normalOutputs = new Set<Output>(['normal', 'object-normal', 'reflection'])

export function collectGeometryContextOutputs(value: unknown, outputs: Set<Output>): void {
  if (Array.isArray(value)) {
    value.forEach((item) => collectGeometryContextOutputs(item, outputs))
    return
  }
  if (!value || typeof value !== 'object') return
  const record = value as TslIrExpression
  if (record.op === 'geometry_context') outputs.add(record.output as Output)
  irInspectionChildren(value).forEach((item) => collectGeometryContextOutputs(item, outputs))
}

function checkedMatrix(object: Object3D): void {
  object.updateWorldMatrix(true, false)
  const matrix = object.matrixWorld
  if (
    !Number.isFinite(matrix.determinant()) ||
    matrix.determinant() === 0 ||
    matrix.elements.some((value) => !Number.isFinite(Math.fround(value)))
  )
    throw new TslIrError('Geometry context requires a finite invertible float32 object matrix')
  if (
    [new Matrix3().setFromMatrix4(matrix), new Matrix3().setFromMatrix4(matrix).invert()].some(
      (value) =>
        value.elements.some(
          (component) => !Number.isFinite(Math.fround(component)) || Math.abs(component) > 1e8,
        ),
    )
  )
    throw new TslIrError(
      'Geometry context object matrix exceeds the verified normal precision domain',
    )
  const linear = new Matrix3().setFromMatrix4(matrix)
  const condition = Math.hypot(...linear.elements) * Math.hypot(...linear.clone().invert().elements)
  if (condition > 100)
    throw new TslIrError(
      'Geometry context requires an object transform condition bound at most 100',
    )
}
export function validateGeometryContextMatrix(object: Object3D, basis: unknown): void {
  if (basis !== 'gltf-y-up' && basis !== 'blender-z-up')
    throw new TslIrError('Geometry context requires an explicit exported coordinate basis')
  checkedMatrix(object)
}

const verified = new WeakMap<
  BufferGeometry,
  { signature: string; position: unknown; normal: unknown; index: unknown }
>()
export function validateGeometryContextBinding(
  outputs: ReadonlySet<Output>,
  object: Object3D | null,
  basis: unknown,
): void {
  if (!outputs.size) return
  if ([...outputs].some((value) => !GEOMETRY_CONTEXT_OUTPUTS.includes(value)))
    throw new TslIrError('Geometry context has an unknown output')
  if (basis !== 'blender-z-up' && basis !== 'gltf-y-up')
    throw new TslIrError('Geometry context requires an explicit exported coordinate basis')
  const mesh = object as Mesh & {
    isSkinnedMesh?: boolean
    isInstancedMesh?: boolean
    isBatchedMesh?: boolean
  }
  if (
    !mesh?.isMesh ||
    mesh.isSkinnedMesh ||
    mesh.isInstancedMesh ||
    mesh.isBatchedMesh ||
    Object.keys(mesh.geometry.morphAttributes).length
  )
    throw new TslIrError(
      'Geometry context needs triangle meshes without skin, morph or generated/GPU instances',
    )
  checkedMatrix(mesh)
  const geometry = mesh.geometry,
    position = geometry.getAttribute('position'),
    normal = geometry.getAttribute('normal')
  const needsNormals = [...outputs].some((value) => normalOutputs.has(value))
  if (
    !position ||
    position.itemSize !== 3 ||
    position.count < 3 ||
    (needsNormals && (!normal || normal.itemSize !== 3 || normal.count !== position.count))
  )
    throw new TslIrError(
      'Geometry context needs actual finite POSITION and authored NORMAL attributes',
    )
  if (
    !(position.array instanceof Float32Array) ||
    position.normalized ||
    (needsNormals && (!(normal!.array instanceof Float32Array) || normal!.normalized))
  )
    throw new TslIrError(
      'Geometry context requires unquantized Float32 POSITION and NORMAL streams',
    )
  const version = (attribute: any) => attribute?.version ?? attribute?.data?.version
  const signature = [
    version(position),
    version(geometry.index),
    needsNormals ? version(normal) : 'none',
    position.count,
    geometry.index?.count,
  ].join('|')
  const previous = verified.get(geometry)
  if (
    previous?.signature === signature &&
    previous.position === position &&
    previous.normal === normal &&
    previous.index === geometry.index
  )
    return
  const count = geometry.index?.count ?? position.count
  if (count % 3) throw new TslIrError('Geometry context requires triangle topology')
  const a = new Vector3(),
    b = new Vector3(),
    c = new Vector3(),
    face = new Vector3(),
    n = new Vector3()
  for (let index = 0; index < count; index += 3) {
    const vertices = [0, 1, 2].map((offset) =>
      geometry.index ? geometry.index.getX(index + offset) : index + offset,
    )
    a.fromBufferAttribute(position, vertices[0]!)
    b.fromBufferAttribute(position, vertices[1]!)
    c.fromBufferAttribute(position, vertices[2]!)
    if ([...a, ...b, ...c].some((value) => !Number.isFinite(value)))
      throw new TslIrError('Geometry context requires finite vertex positions')
    face.subVectors(b, a).cross(c.clone().sub(a))
    if (face.length() < 2e-12)
      throw new TslIrError('Geometry context refuses degenerate triangle normals')
    face.normalize()
    if (needsNormals)
      for (const vertex of vertices) {
        n.fromBufferAttribute(normal!, vertex)
        if (
          n.toArray().some((value) => !Number.isFinite(value)) ||
          n.dot(face) <= 0.05 ||
          Math.abs(n.length() - 1) > 1e-4
        )
          throw new TslIrError(
            'Geometry context needs authored unit normals with outward triangle cosine above 0.05',
          )
      }
  }
  verified.set(geometry, { signature, position, normal, index: geometry.index })
}

export function validateGeometryContextCamera(camera: Camera | null): asserts camera is Camera {
  if (
    !camera?.isCamera ||
    !(
      (camera as Camera & { isPerspectiveCamera?: boolean }).isPerspectiveCamera ||
      (camera as Camera & { isOrthographicCamera?: boolean }).isOrthographicCamera
    )
  )
    throw new TslIrError('Geometry context requires a perspective or orthographic active camera')
  checkedMatrix(camera)
  const rotation = new Matrix4().extractRotation(camera.matrixWorld),
    e = rotation.elements
  const axes = [
    new Vector3(e[0], e[1], e[2]),
    new Vector3(e[4], e[5], e[6]),
    new Vector3(e[8], e[9], e[10]),
  ]
  if (
    rotation.determinant() < 0 ||
    Math.max(
      Math.abs(axes[0]!.dot(axes[1]!)),
      Math.abs(axes[0]!.dot(axes[2]!)),
      Math.abs(axes[1]!.dot(axes[2]!)),
    ) > 1e-5
  )
    throw new TslIrError(
      'Primary geometry context has no verified reflected/sheared camera projection binding',
    )
}

/** Cycles 5.2+ stores corner normals in its native two-component octahedral
 * format. The operation runs per vertex, before raster interpolation. */
function cyclesNormal(value: any): any {
  const inv = value.x.abs().add(value.y.abs()).add(value.z.abs()).add(1e-6).reciprocal()
  const x = value.x.mul(inv),
    y = value.y.mul(inv)
  const sx = select(x.lessThan(0), -1, 1),
    sy = select(y.lessThan(0), -1, 1)
  const u = select(value.z.lessThan(0), y.abs().oneMinus().mul(sx), x)
  const v = select(value.z.lessThan(0), x.abs().oneMinus().mul(sy), y)
  const nx = trunc(u.mul(32767.5).add(32768).clamp(0, 65535))
    .mul(2 / 65535)
    .sub(1)
  const ny = trunc(v.mul(32767.5).add(32768).clamp(0, 65535))
    .mul(2 / 65535)
    .sub(1)
  const nz = nx.abs().oneMinus().sub(ny.abs()),
    t = nz.negate().max(0)
  return normalize(
    vec3(
      nx.add(select(nx.greaterThan(0), t.negate(), t)),
      ny.add(select(ny.greaterThan(0), t.negate(), t)),
      nz,
    ),
  )
}

export function buildGeometryContext(expression: TslIrExpression, basis: unknown): TslExpression {
  const output = expression.output as Output
  if (
    !GEOMETRY_CONTEXT_OUTPUTS.includes(output) ||
    expression.model !== 'primary-triangles-v1' ||
    !['CYCLES', 'EEVEE'].includes(String(expression.sourceEngine))
  )
    throw new TslIrError(
      'Geometry context requires a verified primary triangle model and source engine',
    )
  if (basis !== 'gltf-y-up' && basis !== 'blender-z-up')
    throw new TslIrError('Geometry context requires an explicit exported coordinate basis')
  const outputs = new Set([output]),
    toBlender = (value: any) =>
      basis === 'gltf-y-up' ? vec3(value.x, value.z.negate(), value.y) : value
  const approved = uniform(1).onObjectUpdate(function (frame) {
    validateGeometryContextBinding(outputs, frame.object, basis)
    // Even the normal/backface outputs use primary-ray face orientation.
    if (output !== 'position') validateGeometryContextCamera(frame.camera)
  })
  const finish = (value: any): TslExpression => value.mul(approved)
  const world: any = toBlender(positionWorld)
  const normalMatrix = uniform(new Matrix3()).onObjectUpdate(function (frame) {
    validateGeometryContextBinding(outputs, frame.object, basis)
    this.value.setFromMatrix4(
      nativeVectorTransformMatrix(frame as unknown as Frame, 'OBJECT', 'WORLD', 'NORMAL', basis),
    )
  })
  const storage = expression.normalStorage
  if (
    normalOutputs.has(output) &&
    !['FLOAT32', 'OCT16', 'SNORM10', 'SNORM16'].includes(String(storage))
  )
    throw new TslIrError('Geometry context needs verified native vertex-normal storage')
  if (
    normalOutputs.has(output) &&
    (expression.sourceEngine === 'CYCLES'
      ? !['FLOAT32', 'OCT16'].includes(String(storage))
      : !['SNORM10', 'SNORM16'].includes(String(storage)))
  )
    throw new TslIrError('Geometry context native normal storage does not match its source engine')
  if (
    normalOutputs.has(output) &&
    expression.sourceEngine === 'CYCLES' &&
    !['object', 'world-vertex'].includes(String(expression.normalTransform))
  )
    throw new TslIrError('Geometry context needs verified source-scene Cycles normal interpolation')
  const sourceNormal: any = toBlender(attribute('normal', 'vec3'))
  const packed =
    storage === 'SNORM10'
      ? trunc(sourceNormal.mul(511)).div(511)
      : storage === 'SNORM16'
        ? trunc(sourceNormal.mul(32767)).div(32767)
        : sourceNormal
  const decoded: any = storage === 'OCT16' ? cyclesNormal(packed) : packed
  const worldVertex =
    expression.sourceEngine === 'EEVEE' || expression.normalTransform === 'world-vertex'
  let vertex: any = decoded
  if (expression.sourceEngine === 'EEVEE') {
    // EEVEE normalizes inverse-transformed packed normals in the vertex
    // shader, then normalizes their interpolated value in the fragment.
    vertex = normalize((normalMatrix as any).mul(decoded))
  } else if (worldVertex) {
    const transformed: any = normalize((normalMatrix as any).mul(decoded))
    const nonidentity = uniform(0).onObjectUpdate(function (frame) {
      const matrix = nativeVectorTransformMatrix(
        frame as unknown as Frame,
        'OBJECT',
        'WORLD',
        'POINT',
        basis,
      )
      this.value = matrix.equals(new Matrix4()) ? 0 : 1
    })
    vertex = select(
      nonidentity.equal(1),
      storage === 'OCT16' ? cyclesNormal(transformed) : transformed,
      decoded,
    )
  }
  const varying: any = vertex.toVarying()
  const normal: any = normalize(worldVertex ? varying : (normalMatrix as any).mul(varying)).mul(
    select(frontFacing, 1, -1),
  )
  if (output === 'position') return finish(world)
  if (output === 'backfacing') return finish(select(frontFacing, 0, 1))
  if (output === 'normal') return finish(normal)
  if (output === 'object-normal') {
    const inverseNormal = uniform(new Matrix3()).onObjectUpdate(function (frame) {
      validateGeometryContextBinding(outputs, frame.object, basis)
      this.value.setFromMatrix4(
        nativeVectorTransformMatrix(frame as unknown as Frame, 'WORLD', 'OBJECT', 'NORMAL', basis),
      )
    })
    return finish(normalize((inverseNormal as any).mul(normal)))
  }
  const cameraMatrix = uniform(new Matrix4()).onObjectUpdate(function (frame) {
    validateGeometryContextBinding(outputs, frame.object, basis)
    validateGeometryContextCamera(frame.camera)
    this.value.copy(
      nativeVectorTransformMatrix(frame as unknown as Frame, 'CAMERA', 'WORLD', 'POINT', basis),
    )
  })
  const orthographic = uniform(0).onObjectUpdate(function (frame) {
    validateGeometryContextCamera(frame.camera)
    this.value = (frame.camera as Camera & { isOrthographicCamera?: boolean }).isOrthographicCamera
      ? 1
      : 0
  })
  const cameraPosition: any = (cameraMatrix as any).mul(vec4(0, 0, 0, 1)).xyz
  const incoming: any = select(
    orthographic.equal(1),
    normalize((cameraMatrix as any).mul(vec4(0, 0, -1, 0)).xyz),
    normalize(cameraPosition.sub(world)),
  )
  if (output === 'incoming') return finish(incoming)
  if (output === 'reflection') return finish(normal.mul(dot(normal, incoming).mul(2)).sub(incoming))
  if (output === 'true-normal') {
    const face: any = normalize(world.dFdx().cross(world.dFdy()))
    return finish(face.mul(select(dot(face, incoming).lessThan(0), -1, 1)))
  }
  const inverse = uniform(new Matrix4()).onObjectUpdate(function (frame) {
    validateGeometryContextBinding(outputs, frame.object, basis)
    validateGeometryContextCamera(frame.camera)
    this.value.copy(
      nativeVectorTransformMatrix(frame as unknown as Frame, 'WORLD', 'CAMERA', 'POINT', basis),
    )
  })
  const camera: any = (inverse as any).mul(vec4(world, 1)).xyz
  if (output === 'camera') return finish(camera)
  const projection = uniform(new Matrix4()).onObjectUpdate(function (frame) {
    validateGeometryContextCamera(frame.camera)
    this.value.copy(frame.camera.projectionMatrix)
  })
  const clip: any = (projection as any).mul(vec4(camera.x, camera.y, camera.z.negate(), 1))
  return finish(vec3(clip.x.div(clip.w).mul(0.5).add(0.5), clip.y.div(clip.w).mul(0.5).add(0.5), 0))
}
