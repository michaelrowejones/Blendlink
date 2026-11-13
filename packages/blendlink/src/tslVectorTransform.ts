import { irInspectionChildren } from './tslIrInspection.js'
import { Matrix3, Matrix4, Vector3, type Camera, type Object3D } from 'three'
import { length, select, uniform, vec4 } from 'three/tsl'
import { TslIrError, type TslExpression, type TslIrExpression } from './tslNodeRecipe.js'
import { materialProgramObjectOwnerNode } from './materialProgramDocument.js'

type Space = 'WORLD' | 'OBJECT' | 'CAMERA'
type Kind = 'POINT' | 'VECTOR' | 'NORMAL'
type Basis = 'blender-z-up' | 'gltf-y-up'
type Frame = { object: Object3D; camera: Camera }
export interface VectorTransformRequirement { kind: Kind; from: Space; to: Space; normal?: number[]; normalModel?: 'direction' | 'object-inverse-transpose' }
const spaces = ['WORLD', 'OBJECT', 'CAMERA']
const kinds = ['POINT', 'VECTOR', 'NORMAL']

function checked(matrix: Matrix4, label: string, invertible = true): Matrix4 {
  const determinant = matrix.determinant()
  if (!Number.isFinite(determinant) || (invertible && determinant === 0) || matrix.elements.some(value => !Number.isFinite(Math.fround(value))))
    throw new TslIrError(`Vector Transform needs a finite${invertible ? ' invertible' : ''} ${label} matrix`)
  return matrix
}

/** Work in Blender's declared vector bases, independently of the geometry
 * carrier. Camera space has positive Z forward and ignores camera scale
 * magnitudes while preserving reflections, as native Vector Transform does. */
export function nativeVectorTransformMatrix(
  { object: drawnObject, camera }: Frame, from: Space, to: Space, kind: Kind, basis: Basis,
  engine: 'CYCLES' | 'EEVEE' = 'CYCLES',
  normalModel: 'direction' | 'object-inverse-transpose' = 'object-inverse-transpose',
): Matrix4 {
  if (from === to) return new Matrix4()
  const change = basis === 'gltf-y-up'
    ? new Matrix4().set(1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1) : new Matrix4()
  const inverseChange = change.clone().transpose()
  const mappings = new Map<Space, Matrix4>([['WORLD', new Matrix4()]])
  if (from === 'OBJECT' || to === 'OBJECT') {
    if (!drawnObject?.isObject3D) throw new TslIrError('Vector Transform needs an actual object transform')
    if ((drawnObject as Object3D & { isInstancedMesh?: boolean; isBatchedMesh?: boolean }).isInstancedMesh ||
        (drawnObject as Object3D & { isBatchedMesh?: boolean }).isBatchedMesh)
      throw new TslIrError('Vector Transform needs verified per-instance transforms for GPU instances')
    const object = materialProgramObjectOwnerNode(drawnObject)
    object.updateWorldMatrix(true, false)
    mappings.set('OBJECT', checked(inverseChange.clone().multiply(object.matrixWorld).multiply(change), 'object',
      kind === 'NORMAL' && !(engine === 'EEVEE' && normalModel === 'direction') ? from === 'OBJECT' : to === 'OBJECT'))
  }
  if (from === 'CAMERA' || to === 'CAMERA') {
    if (!camera?.isCamera) throw new TslIrError('Vector Transform needs the active render camera')
    camera.updateWorldMatrix(true, false)
    checked(camera.matrixWorld, 'camera')
    const normalized = new Matrix4().extractRotation(camera.matrixWorld)
    normalized.setPosition(new Vector3().setFromMatrixPosition(camera.matrixWorld))
    mappings.set('CAMERA', checked(inverseChange.clone().multiply(normalized)
      .multiply(new Matrix4().makeScale(1, 1, -1)), 'camera'))
  }
  const source = mappings.get(from)!, destination = mappings.get(to)!
  let result: Matrix4
  if (kind === 'NORMAL' && !(engine === 'EEVEE' && normalModel === 'direction')) {
    // EEVEE treats camera normals like directions; this differs from the
    // inverse-transpose convention when a native camera parent has shear.
    const into = engine === 'EEVEE' && to === 'CAMERA'
      ? new Matrix3().setFromMatrix4(destination.clone().invert()) : new Matrix3().setFromMatrix4(destination).transpose()
    const out = engine === 'EEVEE' && from === 'CAMERA'
      ? new Matrix3().setFromMatrix4(source) : new Matrix3().getNormalMatrix(source)
    const normal = into.multiply(out)
    result = new Matrix4().setFromMatrix3(normal)
  } else result = destination.clone().invert().multiply(source)
  if (kind === 'NORMAL') result.setPosition(0, 0, 0)
  return checked(result, 'result', false)
}

function literalVector(expression: unknown): number[] | null {
  if (!expression || typeof expression !== 'object') return null
  const value = expression as TslIrExpression
  if (value.op === 'color_convert' && value.mode === 'RGB') return literalVector(value.input)
  if (value.op === 'const_vec3' && Array.isArray(value.value) && value.value.length === 3 &&
      value.value.every(item => typeof item === 'number' && Number.isFinite(item))) return value.value
  if (value.op === 'combine') {
    const channels = ['x', 'y', 'z'].map(axis => value[axis] as TslIrExpression)
    if (channels.every(item => item?.op === 'const_float' && typeof item.value === 'number' && Number.isFinite(item.value)))
      return channels.map(item => item.value as number)
  }
  return null
}

export function collectVectorTransformRequirements(value: unknown, requirements: VectorTransformRequirement[]): void {
  if (Array.isArray(value)) { value.forEach(item => collectVectorTransformRequirements(item, requirements)); return }
  if (!value || typeof value !== 'object') return
  const expression = value as TslIrExpression
  if (expression.op === 'vector_transform' && expression.from !== expression.to) {
    const from = expression.from as Space, to = expression.to as Space, kind = expression.kind as Kind
    requirements.push({ from, to, kind, ...(kind === 'NORMAL' ? { normal: literalVector(expression.input) ?? [], normalModel: expression.normalModel as VectorTransformRequirement['normalModel'] } : {}) })
  }
  irInspectionChildren(value).forEach(item => collectVectorTransformRequirements(item, requirements))
}

/** Installer/auditor preflight uses the actual bound object matrix. Camera
 * matrices are deliberately validated on each draw, when an active camera
 * exists; an export snapshot must not stand in for that live context. */
export function validateVectorTransformBinding(
  requirements: readonly VectorTransformRequirement[], object: Object3D | null,
  basis: unknown, instanced = false,
): void {
  if (!requirements.length) return
  if (requirements.some(item => !spaces.includes(item.from) || !spaces.includes(item.to) || !kinds.includes(item.kind)))
    throw new TslIrError('Vector Transform has an invalid context requirement')
  if (basis !== 'gltf-y-up' && basis !== 'blender-z-up') throw new TslIrError('Vector Transform needs an explicitly exported coordinate basis')
  const needed = requirements.filter(item => item.from === 'OBJECT' || item.to === 'OBJECT')
  if (!needed.length) return
  if (!object?.isObject3D) throw new TslIrError('Vector Transform needs the actual default-scene object matrix')
  if (instanced || (object as Object3D & { isInstancedMesh?: boolean; isBatchedMesh?: boolean }).isInstancedMesh ||
      (object as Object3D & { isBatchedMesh?: boolean }).isBatchedMesh)
    throw new TslIrError('Vector Transform needs verified per-instance transforms for GPU instances')
  const owner = materialProgramObjectOwnerNode(object)
  owner.updateWorldMatrix(true, false)
  for (const item of needed) {
    checked(owner.matrixWorld, 'object', item.kind === 'NORMAL' && item.normalModel !== 'direction' ? item.from === 'OBJECT' : item.to === 'OBJECT')
    if (item.kind === 'NORMAL' && item.from !== 'CAMERA' && item.to !== 'CAMERA') {
      const transform = nativeVectorTransformMatrix({ object, camera: null as unknown as Camera }, item.from, item.to, item.kind, basis, item.normalModel === 'direction' ? 'EEVEE' : 'CYCLES', item.normalModel)
      validateNormalResult(item.normal ?? [], transform)
    }
  }
}

function validateNormalResult(witness: readonly number[], matrix: Matrix4): void {
  if (witness.length !== 3 || witness.some(value => !Number.isFinite(value))) throw new TslIrError('Vector Transform needs a verified literal normal')
  const transformed = new Vector3(...witness as [number, number, number]).applyMatrix4(matrix)
  const maximum = Math.max(...transformed.toArray().map(Math.abs))
  if (!Number.isFinite(maximum) || maximum < 1e-18 || maximum > 1e18)
    throw new TslIrError('Vector Transform normal is outside its verified float32 normalization domain')
}

export function buildTslVectorTransformNode(
  expression: TslIrExpression, incoming: TslExpression,
  basis: unknown, fail: (message: string) => never,
): TslExpression {
  const from = expression.from as Space, to = expression.to as Space, kind = expression.kind as Kind
  if (!spaces.includes(from) || !spaces.includes(to) || !kinds.includes(kind))
    return fail('Vector Transform has no verified space or vector type')
  const engine = expression.sourceEngine
  if (engine !== 'CYCLES' && engine !== 'EEVEE') return fail('Vector Transform requires a verified source engine')
  const normalModel = expression.normalModel
  if (kind === 'NORMAL' && normalModel !== 'direction' && normalModel !== 'object-inverse-transpose') return fail('Vector Transform requires a verified native normal model')
  if (kind === 'NORMAL' && engine === 'CYCLES' && normalModel === 'direction') return fail('Vector Transform Cycles normals require inverse-transpose semantics')
  const normalizes = kind === 'NORMAL' && (from !== to || engine === 'EEVEE')
  const witness = normalizes ? literalVector(expression.input) : null
  if (normalizes && (expression.normalDomain !== 'verified-nonzero' || !witness ||
      Math.max(...witness.map(Math.abs)) < 1e-10 || Math.max(...witness.map(Math.abs)) > 1e10))
    return fail('Vector Transform Normal requires a verified nonzero finite input')
  const normalize = (value: any): TslExpression => {
    const magnitude = length(value)
    return value.div(select(magnitude.equal(0), 1, magnitude)) as TslExpression
  }
  if (from === to) return normalizes ? normalize(incoming) : incoming
  if (basis !== 'blender-z-up' && basis !== 'gltf-y-up') return fail('Vector Transform requires an explicit geometry coordinate basis')
  if (expression.cameraModel !== 'scale-normalized-positive-z-forward') return fail('Vector Transform has no verified native camera convention')
  const matrix = uniform(new Matrix4()).onObjectUpdate(function (frame) {
    const value = nativeVectorTransformMatrix(frame as Frame, from, to, kind, basis, engine, normalModel as 'direction' | 'object-inverse-transpose')
    if (witness) validateNormalResult(witness, value)
    this.value.copy(value)
  })
  type Node = any
  const result = (matrix as Node).mul(vec4(incoming as never, kind === 'POINT' ? 1 : 0)).xyz as Node
  if (kind !== 'NORMAL') return result as TslExpression
  // The compiler admits a verified nonzero normal. Guard the inactive zero
  // denominator too, so WGSL never folds a literal 0/0 while building it.
  return normalize(result)
}
