import { vertexAlphaLayers, vertexAlphaBinding } from './tslVertexColorAlpha.js'
import { prepareTslNoiseFields } from './tslNoiseFields.js'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { SceneManifest } from './typegen.js'
import type { TslIrDocument } from './tslNodeRecipe.js'
import type { TslRuntimeMeshExtras } from './tslMaterialProgram.js'
import { hasBaseColorCarrier } from './compiledSceneConformance.js'
import { materialProgramObjectOwner } from './materialProgramDocument.js'
import { irInspectionChildren } from './tslIrInspection.js'
import { matchingNodeRendererPrograms, nodeRendererProgramLabel, validateNodeRendererRequirement } from './materialProgramRendererRequirements.js'

/** Exact image companions, keyed by their published basename, not by an IR name. */
export type MaterialProgramImageBytes = ReadonlyMap<string, Uint8Array>
export interface MaterialProgramPrimitiveData {
  position: Float32Array | null
  normal: Float32Array | null
  tangent?: Float32Array | null
  uvs?: ReadonlyMap<string,Float32Array>
  vertexAlpha?: ReadonlyMap<string,Float32Array>
  /** Actual decoded normalized COLOR_0 alpha components, never JSON claims. */
  colorAlpha?: Float32Array
  indices: Uint8Array | Uint16Array | Uint32Array | null
}
export type MaterialProgramGeometryData = ReadonlyMap<string, MaterialProgramPrimitiveData>

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function hasNativeNormal(value:unknown):boolean {
  if(Array.isArray(value))return value.some(hasNativeNormal)
  if(!record(value))return false
  return value.op==='normal_map_native'||value.op==='normal_view_native'||value.op==='normal_map_tangent_native'||value.op==='bump_height_native'||Object.values(value).some(hasNativeNormal)
}

function hasMagic(value:unknown):boolean {
  if(Array.isArray(value))return value.some(hasMagic)
  if(!record(value))return false
  return value.op==='tex_magic_native'||irInspectionChildren(value).some(hasMagic)
}

function hasCameraData(value:unknown):boolean {
  if(Array.isArray(value))return value.some(hasCameraData)
  if(!record(value))return false
  return value.op==='camera_data_native'||irInspectionChildren(value).some(hasCameraData)
}

function hasSqueeze(value:unknown):boolean {
  if(Array.isArray(value))return value.some(hasSqueeze)
  if(!record(value))return false
  return value.op==='squeeze_native'||irInspectionChildren(value).some(hasSqueeze)
}

function imageFile(value: unknown): string {
  if (typeof value !== 'string' || !value || value === '.' || value === '..' || /[\\/\u0000?#:%]/.test(value)) {
    throw new Error('Compiled material program image must name a basename beside its sidecar.')
  }
  return value
}

/** Read exactly the companions the browser resolves beside this sidecar. */
export function readMaterialProgramImageBytes(bytes: Uint8Array, sidecarPath: string): MaterialProgramImageBytes {
  const document: unknown = JSON.parse(new TextDecoder().decode(bytes))
  if (!record(document) || document.images === undefined) return new Map()
  if (!record(document.images)) throw new Error('Compiled material program images must be an object.')
  const result = new Map<string, Uint8Array>()
  for (const image of Object.values(document.images)) {
    if (!record(image)) throw new Error('Compiled material program image metadata is invalid.')
    const file = imageFile(image.file)
    result.set(file, readFileSync(join(dirname(sidecarPath), file)))
  }
  return result
}

interface PrimitiveBinding {
  meshIndex: number
  primitiveIndex: number
  primitive: Record<string, unknown>
  extras: Record<string, unknown>
  runtime: TslRuntimeMeshExtras | null
  instanced: boolean
  nodeChain: Record<string, unknown>[] | null
  hierarchyIssue?: string
}

/** Match GLTFLoader r184: mesh extras live on each primitive Mesh; node
 * extras overlay that Mesh only when the node has a single mesh attachment.
 * Multi-primitive/camera/light/bone nodes put node extras on a parent Group.
 * The material installer reads the actual Mesh, never inherited properties.
 */
function primitiveBindings(gltf: Record<string, unknown>): PrimitiveBinding[] {
  const meshes = Array.isArray(gltf.meshes) ? gltf.meshes : []
  const nodes = Array.isArray(gltf.nodes) ? gltf.nodes : null
  const bindings: PrimitiveBinding[] = []
  const joints = new Set((Array.isArray(gltf.skins) ? gltf.skins : []).flatMap(skin =>
    record(skin) && Array.isArray(skin.joints) ? skin.joints : []))
  const add = (mesh: unknown, node?: Record<string, unknown>, index?: number, nodeChain: Record<string, unknown>[] | null = null): void => {
    if (!record(mesh) || !Array.isArray(mesh.primitives)) return
    const nodeOnMesh = mesh.primitives.length === 1 && node?.camera === undefined &&
      !(record(node?.extensions) && Object.hasOwn(node.extensions, 'KHR_lights_punctual')) && !joints.has(index)
    const meshExtras = { ...(record(mesh.extras) ? mesh.extras : {}),
      ...(nodeOnMesh && record(node?.extras) ? node.extras : {}) }
    const runtime = record(meshExtras.blendlink_tsl_runtime) ? meshExtras.blendlink_tsl_runtime as TslRuntimeMeshExtras : null
    // A marked single-attachment node is the direct parent of primitive
    // Mesh children. Camera/light/bone plus multi-primitive combinations
    // introduce another unmarked Group and therefore earn no inheritance.
    const directParent = mesh.primitives.length === 1 || (node?.camera === undefined &&
      !(record(node?.extensions) && Object.hasOwn(node.extensions, 'KHR_lights_punctual')) && !joints.has(index))
    const extras = !materialProgramObjectOwner(meshExtras.blendlink_tsl_object) && directParent &&
      record(node?.extras) && materialProgramObjectOwner(node.extras.blendlink_tsl_object)
      ? { ...meshExtras, ...node.extras } : meshExtras
    const instanced = record(node?.extensions) && Object.hasOwn(node.extensions, 'EXT_mesh_gpu_instancing')
    for (const [primitiveIndex,primitive] of mesh.primitives.entries()) if (record(primitive)) bindings.push({ meshIndex:meshes.indexOf(mesh),primitiveIndex,primitive, extras, runtime, instanced, nodeChain })
  }
  if (!nodes) { meshes.forEach(mesh => add(mesh)); return bindings }
  const scenes = Array.isArray(gltf.scenes) ? gltf.scenes : []
  const scene = scenes[typeof gltf.scene === 'number' ? gltf.scene : 0]
  const seen = new Set<number>()
  let hierarchyIssue: string | undefined
  const visit = (index: unknown, chain: Record<string, unknown>[]): void => {
    if (typeof index !== 'number' || !Number.isInteger(index)) { hierarchyIssue = 'default-scene node index is invalid'; return }
    if (seen.has(index)) { hierarchyIssue = 'default-scene hierarchy has a cycle or a node with multiple parents'; return }
    seen.add(index)
    const node = nodes[index]
    if (!record(node)) { hierarchyIssue = 'default-scene node is missing'; return }
    const next = [...chain, node]
    if (typeof node.mesh === 'number') add(meshes[node.mesh], node, index, next)
    if (Array.isArray(node.children)) node.children.forEach(child => visit(child, next))
  }
  if (record(scene) && Array.isArray(scene.nodes)) scene.nodes.forEach(root => visit(root, []))
  if (hierarchyIssue) for (const binding of bindings) binding.hierarchyIssue = hierarchyIssue
  return bindings
}

async function verifiedImages(document: Record<string, unknown>, bytes: MaterialProgramImageBytes) {
  if (document.images !== undefined && !record(document.images)) throw new Error('Compiled material program images must be an object.')
  const decoded = new Map<string, { data: Uint8Array; width: number; height: number; colorSpace: string }>()
  const images = record(document.images) ? document.images : {}
  if (!Object.keys(images).length) return decoded
  const { default: sharp } = await import('sharp')
  for (const [name, image] of Object.entries(images)) {
    if (!record(image)) throw new Error(`Compiled material program image ${JSON.stringify(name)} has invalid metadata.`)
    const file = imageFile(image.file)
    const payload = bytes.get(file)
    if (!payload || payload.byteLength !== image.bytes || typeof image.hash !== 'string' ||
        !/^[a-f0-9]{16}$/.test(image.hash) || createHash('sha256').update(payload).digest('hex').slice(0, 16) !== image.hash) {
      throw new Error(`Compiled material program image ${JSON.stringify(name)} bytes do not match its byte/hash pin.`)
    }
    const source = sharp(payload, { animated: false, failOn: 'error' })
    const metadata = await source.metadata()
    const formats: Record<string, string> = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' }
    const mime = formats[metadata.format ?? '']
    if (!mime || image.mime !== mime || image.width !== metadata.width || image.height !== metadata.height ||
        !metadata.width || !metadata.height || (metadata.pages ?? 1) !== 1 || (metadata.orientation ?? 1) !== 1 ||
        !['sRGB', 'Non-Color', 'Raw', 'Linear Rec.709'].includes(String(image.colorSpace))) {
      throw new Error(`Compiled material program image ${JSON.stringify(name)} format/dimensions/color-space metadata do not match a supported static image.`)
    }
    // The production bitmap decoder flips rows into Blender's bottom-up
    // graph convention. Audit textures must use the same verified pixel rows.
    const rgba = await source.flip().ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    if (rgba.info.channels !== 4 || rgba.info.width !== metadata.width || rgba.info.height !== metadata.height) {
      throw new Error(`Compiled material program image ${JSON.stringify(name)} could not decode to its declared RGBA dimensions.`)
    }
    decoded.set(name, { data: rgba.data, width: metadata.width, height: metadata.height, colorSpace: String(image.colorSpace) })
  }
  return decoded
}

/** Evidence for the node-renderer family, never inferred from a class marker.
 * Only exact manifest-pinned sidecar bytes and a Base Color expression that
 * the production builder accepts for every bound primitive can supply it.
 * Already portable colors do not import the optional Three.js peer dependency.
 * External images and object properties must resolve from exact companion
 * bytes and actual rendered GLB bindings; missing data earns no exemption.
 */
export async function validatedBaseColorProgramMaterials(
  gltf: Record<string, unknown>,
  manifest: Pick<SceneManifest, 'materialPrograms'>,
  bytes?: Uint8Array,
  imageBytes?: MaterialProgramImageBytes,
  geometryData?: MaterialProgramGeometryData,
  preparationOptions: { signal?: AbortSignal } = {},
): Promise<ReadonlySet<number>> {
  if (preparationOptions.signal?.aborted) {
    const error = new Error('Compiled material program preparation aborted');error.name='AbortError';throw error
  }
  const accepted = new Set<number>()
  if (!bytes) return accepted
  const pointer = manifest.materialPrograms
  if (!pointer || bytes.byteLength !== pointer.bytes ||
      createHash('sha256').update(bytes).digest('hex').slice(0, 16) !== pointer.hash) {
    throw new Error('Compiled material programs bytes do not match the manifest byte/hash pin.')
  }
  let document: unknown
  try { document = JSON.parse(new TextDecoder().decode(bytes)) }
  catch { throw new Error('Compiled material programs are not valid JSON.') }
  if (!record(document) || document.schemaVersion !== 1 ||
      document.model !== 'blendlink-material-programs-v1' || !record(document.materials)) {
    throw new Error('Compiled material programs use an unsupported document schema/model.')
  }
  if (document.images !== undefined && !record(document.images)) throw new Error('Compiled material program images must be an object.')
  if (record(document.images) && Object.keys(document.images).length > 0 && !imageBytes) {
    // Returning no Base Color exemption is sufficient for old live-only
    // carriers, but a portable color must not hide required live programs in
    // Roughness or another channel. Only actual matched bindings require
    // this preflight; unrelated/unbound programs keep the old no-proof path.
    const bindings = primitiveBindings(gltf)
    const programs = document.materials
    const materials = Array.isArray(gltf.materials) ? gltf.materials : []
    materials.forEach((material, index) => {
      if (!record(material) || !record(material.extras)) return
      const source = material.extras.blendlink_source_material
      const program = typeof source === 'string' && Object.hasOwn(programs, source) ? programs[source] : null
      if(!record(program))return
      for(const binding of bindings){
        if(binding.primitive.material!==index)continue
        const requirement=validateNodeRendererRequirement(program.channels,binding.runtime?.requiresNodeRenderer)
        if(requirement.issue)throw new Error(requirement.issue)
        if(requirement.required.length)throw new Error(`${nodeRendererProgramLabel(requirement.required)} CPU material preflight requires verified companion image bytes; supply the exact published image payloads before auditing this binding.`)
      }
    })
    return accepted
  }
  const decoded = await verifiedImages(document, imageBytes ?? new Map())
  const programs = document.materials
  const materials = Array.isArray(gltf.materials) ? gltf.materials : []
  const bindings = primitiveBindings(gltf)
  const candidates = materials.flatMap((material, index) => {
    if (!record(material) || !record(material.extras)) return []
    const attributes = bindings.filter(binding => binding.primitive.material === index)
      .map(({ primitive }) => new Set(Object.keys(record(primitive.attributes) ? primitive.attributes : {})))
    const baseColorRequired=!hasBaseColorCarrier(material, attributes)
    const source = material.extras.blendlink_source_material
    if (typeof source !== 'string' || !Object.hasOwn(programs, source)) return []
    const program = programs[source]
    const nativeNormal=record(program)&&hasNativeNormal(program.channels)
    const magic=record(program)&&hasMagic(program.channels)
    const cameraData=record(program)&&hasCameraData(program.channels)
    const squeeze=record(program)&&hasSqueeze(program.channels)
    const vertexAlpha = vertexAlphaLayers(record(program) ? program.channels : null).size > 0
    const rendererRequired=record(program)&&bindings.some(binding=>{
      if(binding.primitive.material!==index)return false
      const validation=validateNodeRendererRequirement(program.channels,binding.runtime?.requiresNodeRenderer)
      return !!validation.issue||validation.required.length>0
    })
    if(!baseColorRequired&&!nativeNormal&&!magic&&!cameraData&&!squeeze&&!rendererRequired&&!vertexAlpha)return []
    const channel = record(program) && record(program.channels) ? program.channels['Base Color'] : null
    if (baseColorRequired&&(!record(channel) || !record(channel.tslIr))) return []
    // GLTFLoader creates MeshBasicMaterial for an unlit carrier; the actual
    // program installer only swaps MeshStandardMaterial-compatible carriers.
    if (record(material.extensions) && Object.hasOwn(material.extensions, 'KHR_materials_unlit')) {
      if(squeeze||rendererRequired)throw new Error(`${nodeRendererProgramLabel(validateNodeRendererRequirement(record(program)?program.channels:null,undefined).required)} requires a lit material carrier compatible with its node renderer`)
      return []
    }
    return [{ index, ir: record(channel)&&record(channel.tslIr)?channel.tslIr as unknown as TslIrDocument:null, program,baseColorRequired,nativeNormal,magic,cameraData,squeeze,rendererRequired,vertexAlpha }]
  })
  if (!candidates.length) return accepted
  const { buildTslColorNode, createTslBuildResources, TslIrError } = await import('./tslNodeRecipe.js')
  const { buildOptionsFor, collectObjectAttributeNames,buildMaterialProgram } = await import('./tslMaterialProgram.js')
  const { objectAttributeResolver, objectAttributeValue, loadProgramTextures } = await import('./tslMaterialRuntime.js')
  const { collectObjectInfoOutputs, createObjectInfoResolver, validateObjectInfoBinding } = await import('./tslObjectInfo.js')
  const { collectVectorTransformRequirements, validateVectorTransformBinding } = await import('./tslVectorTransform.js')
  const { collectGeometryContextOutputs, validateGeometryContextMatrix } = await import('./tslGeometryContext.js')
  const { collectNormalMapRequirements,validateNormalMapBinding } = await import('./tslNormalNodes.js')
  const {collectTangentRequirements,validateTangentBinding}=await import('./tslTangentNodes.js')
  const {collectTangentNormalMaps,validateTangentNormalMapBinding}=await import('./tslTangentNormalMap.js')
  const {collectBumpHeights,validateBumpHeightBinding}=await import('./tslBumpHeight.js')
  const {collectMagicTextures,validateMagicCoordinates}=await import('./tslMagicBounds.js')
  const {validateCameraDataBinding}=await import('./tslCameraData.js')
  const THREE = await import('three')
  const objectForBinding = (binding: PrimitiveBinding): import('three').Object3D => {
    if (binding.hierarchyIssue || !binding.nodeChain?.length) throw new TslIrError('Vector Transform needs actual default-scene object matrices: ' + (binding.hierarchyIssue ?? 'node hierarchy is missing'))
    const numbers = (raw: unknown, size: number, defaults: number[], label: string): number[] => {
      if (raw === undefined) return defaults
      if (!Array.isArray(raw) || raw.length !== size || raw.some(value => typeof value !== 'number' || !Number.isFinite(value)))
        throw new TslIrError('Vector Transform has invalid glTF node ' + label)
      return raw
    }
    let parent: import('three').Object3D | null = null
    for (const node of binding.nodeChain) {
      const object = new THREE.Object3D()
      // GLTFLoader r184 applies matrix then decomposes/recomposes it; TRS
      // fields follow the standard glTF identity defaults. Reproduce that
      // actual loader path instead of treating every binding as identity.
      if (node.matrix !== undefined) object.applyMatrix4(new THREE.Matrix4().fromArray(numbers(node.matrix, 16, [], 'matrix')))
      else {
        object.position.fromArray(numbers(node.translation, 3, [0, 0, 0], 'translation'))
        object.quaternion.fromArray(numbers(node.rotation, 4, [0, 0, 0, 1], 'rotation'))
        object.scale.fromArray(numbers(node.scale, 3, [1, 1, 1], 'scale'))
      }
      parent?.add(object)
      parent = object
    }
    parent!.updateWorldMatrix(true, false)
    return parent!
  }
  const preparation = await prepareTslNoiseFields(candidates, preparationOptions)
  let textures: Awaited<ReturnType<typeof loadProgramTextures>> = null
  try {
    textures = await loadProgramTextures(document as unknown as import('./materialProgramDocument.js').MaterialProgramsDocument, pointer.url, {
    ...(preparationOptions.signal ? {signal:preparationOptions.signal} : {}),
    loadProgramTexture: async name => {
      const image = decoded.get(name)!
      const texture = new THREE.DataTexture(image.data, image.width, image.height)
      texture.flipY = false
      texture.colorSpace = image.colorSpace === 'sRGB' ? THREE.SRGBColorSpace : THREE.NoColorSpace
      texture.needsUpdate = true
      return texture
    },
  })
    for (const { index, ir, program,baseColorRequired,nativeNormal,magic,cameraData,squeeze,rendererRequired,vertexAlpha } of candidates) {
      let bindingCount = 0
      let valid = true
      let refusal=''
      const names = new Set<string>()
      const info = new Set<string>()
      collectObjectAttributeNames(record(program) ? program.channels : null, names)
      collectObjectInfoOutputs(record(program) ? program.channels : null, info)
      const transforms: import('./tslVectorTransform.js').VectorTransformRequirement[] = []
      collectVectorTransformRequirements(record(program) ? program.channels : null, transforms)
      const geometry=new Set<import('./tslGeometryContext.js').GeometryContextOutput>()
      collectGeometryContextOutputs(record(program)?program.channels:null,geometry)
      const normalMaps:import('./tslNodeRecipe.js').TslIrExpression[]=[]
      collectNormalMapRequirements(record(program)?program.channels:null,normalMaps)
      const tangents:import('./tslNodeRecipe.js').TslIrExpression[]=[]
      collectTangentRequirements(record(program)?program.channels:null,tangents)
      const tangentMaps:import('./tslNodeRecipe.js').TslIrExpression[]=[]
      collectTangentNormalMaps(record(program)?program.channels:null,tangentMaps)
      const heights:import('./tslNodeRecipe.js').TslIrExpression[]=[]
      collectBumpHeights(record(program)?program.channels:null,heights)
      const magicTextures:import('./tslNodeRecipe.js').TslIrExpression[]=[]
      collectMagicTextures(record(program)?program.channels:null,magicTextures)
      const material = materials[index]
      const materialInfo = record(material) && record(material.extras) ? material.extras.blendlink_tsl_material : null
      for (const binding of bindings) {
          const { primitive, extras: properties, runtime: extras, instanced } = binding
          if (!record(primitive) || primitive.material !== index) continue
          bindingCount++
          const attributes = record(primitive.attributes) ? primitive.attributes : {}
          const resources = createTslBuildResources()
          let actualGeometry:import('three').Mesh|null=null
          try {
            if ((primitive.mode !== undefined && ![4, 5, 6].includes(Number(primitive.mode))) ||
                [...names].some(name => !Object.hasOwn(properties, name) || !objectAttributeValue(properties[name]))) {
              throw new TslIrError('Material program requires unavailable per-object properties or a non-mesh binding')
            }
            const opacityChannel=record(program)&&record(program.channels)?program.channels.Alpha:null
            const colorAccessor=Array.isArray(gltf.accessors)?gltf.accessors[Number(attributes.COLOR_0)]:null
            const actualColorAlpha=geometryData?.get(`${binding.meshIndex}:${binding.primitiveIndex}`)?.colorAlpha
            if(vertexAlphaLayers(opacityChannel).size&&record(colorAccessor)&&colorAccessor.type==='VEC4'
              &&(!actualColorAlpha||actualColorAlpha.length!==colorAccessor.count||!actualColorAlpha.every(value=>value===1)))
              throw new TslIrError('Vertex Color Alpha opacity with stock VEC4 COLOR_0 is unqualified; implicit vertex alpha would multiply opacity twice')
            const rendererRequirement=validateNodeRendererRequirement(record(program)?program.channels:null,extras?.requiresNodeRenderer)
            if(rendererRequirement.issue)throw new TslIrError(rendererRequirement.issue)
            const options:import('./tslNodeRecipe.js').BuildTslOptions = { ...buildOptionsFor(extras, resources, `materials[${index}]`, textures?.resolver, objectAttributeResolver()), preparedNoiseFields:preparation }
            if(geometry.size){
              const accessors=Array.isArray(gltf.accessors)?gltf.accessors:[]
              const position=accessors[Number(attributes.POSITION)]
              const normal=accessors[Number(attributes.NORMAL)]
              if(instanced||binding.nodeChain?.some(node=>node.skin!==undefined)||primitive.targets!==undefined||
                (primitive.mode!==undefined&&primitive.mode!==4)||!record(position)||position.type!=='VEC3'||position.componentType!==5126||position.normalized===true||Number(position.count)<3||
                [...geometry].some(value=>['normal','object-normal','reflection'].includes(value))&&(!record(normal)||normal.type!=='VEC3'||normal.componentType!==5126||normal.normalized===true||normal.count!==position.count))
                throw new TslIrError('Geometry context requires actual triangle position/normal attributes without skin, morph or GPU instances')
              validateGeometryContextMatrix(objectForBinding(binding),extras?.objectSpace)
            }
            if(vertexAlpha||normalMaps.length||tangents.length||heights.length||cameraData||magicTextures.some(item=>item.evaluationModel==='shader')){
              const needsNormal=normalMaps.length||tangents.length||heights.length
              if(needsNormal&&!extras?.geometryContext?.includes('normal'))throw new TslIrError('Native Normal Map requires its exported primary-normal context declaration')
              if(magicTextures.some(item=>item.evaluationModel==='shader')&&(instanced||binding.nodeChain?.some(node=>node.skin!==undefined)||primitive.targets!==undefined))
                throw new TslIrError('Magic Texture coordinate proof currently requires static authored primitive attributes without skin/morph/instances')
              const owner=needsNormal||cameraData?objectForBinding(binding):new THREE.Object3D(),data=geometryData?.get(`${binding.meshIndex}:${binding.primitiveIndex}`)
              let bound:import('three').Object3D=owner
              if(data?.position&&(!needsNormal||data.normal)){
                const actual=new THREE.BufferGeometry().setAttribute('position',new THREE.BufferAttribute(data.position,3))
                if(data.normal)actual.setAttribute('normal',new THREE.BufferAttribute(data.normal,3))
                if(data.indices)actual.setIndex(new THREE.BufferAttribute(data.indices,1))
                data.vertexAlpha?.forEach((values, semantic) => actual.setAttribute(semantic.toLowerCase(), new THREE.BufferAttribute(values, 1)))
                if(data.tangent)actual.setAttribute('tangent',new THREE.BufferAttribute(data.tangent,4))
                data.uvs?.forEach((values,semantic)=>{
                  const match=/^TEXCOORD_(\d+)$/.exec(semantic)
                  if(match)actual.setAttribute(match[1]==='0'?'uv':'uv'+match[1],new THREE.BufferAttribute(values,2))
                })
                const mesh=new THREE.Mesh(actual);owner.add(mesh);bound=mesh;actualGeometry=mesh
              }
              if(normalMaps.length)validateNormalMapBinding(normalMaps,bound,extras?.objectSpace)
              if(tangents.length){
                if(!(bound as import('three').Mesh).isMesh)throw new TslIrError('UV Tangent needs actual decoded primitive geometry')
                validateTangentBinding(tangents,bound as import('three').Mesh,extras?.objectSpace,extras)
              }
            }
            if(vertexAlpha){
              if(instanced || binding.nodeChain?.some(node=>node.skin!==undefined) || primitive.targets!==undefined || primitive.mode!==undefined&&primitive.mode!==4 || !actualGeometry)
                throw new TslIrError('Vertex Color Alpha requires actual static triangle primitive data')
              const source = record(material) && record(material.extras) ? material.extras.blendlink_source_material : null
              if(typeof source !== 'string')throw new TslIrError('Vertex Color Alpha has no actual material source owner')
              for(const layer of vertexAlphaLayers(record(program)?program.channels:null)){
                const bound = extras?.vertexColorAlpha?.[layer]
                const accessor = bound && Array.isArray(gltf.accessors) ? gltf.accessors[Number(attributes[bound.semantic])] : null
                if(!record(accessor)||accessor.type!=='SCALAR'||accessor.componentType!==5126||accessor.normalized===true)
                  throw new TslIrError('Vertex Color Alpha accessor metadata is not raw Float32 SCALAR')
              }
              Object.assign(options,vertexAlphaBinding(actualGeometry,record(program)?program.channels:null,extras,source).options)
            }
            if(cameraData){
              if(!actualGeometry)throw new TslIrError('Camera Data needs actual decoded primitive geometry')
              validateCameraDataBinding(actualGeometry,extras?.objectSpace)
            }
            if(magicTextures.length){
              options.validateMagicCoordinates=expression=>validateMagicCoordinates(expression,actualGeometry??undefined,options)
              for(const expression of magicTextures)options.validateMagicCoordinates(expression)
            }
            if(heights.length){
              if(!actualGeometry)throw new TslIrError('Bump Height needs actual decoded primitive geometry')
              validateBumpHeightBinding(heights,actualGeometry,options)
            }
            if (transforms.length) {
              const objectNeeded = transforms.some(item => item.from === 'OBJECT' || item.to === 'OBJECT')
              validateVectorTransformBinding(transforms, objectNeeded ? objectForBinding(binding) : null, extras?.objectSpace, instanced)
            }
            validateObjectInfoBinding(info, properties.blendlink_tsl_object, materialInfo, instanced)
            if (info.size) options.objectInfo = createObjectInfoResolver(properties.blendlink_tsl_object, materialInfo)
            options.normalMapBasis = !Object.hasOwn(attributes, 'TEXCOORD_0') ? 'missing'
              : Object.hasOwn(attributes, 'TANGENT') ? 'attribute' : 'derivative'
            if(tangentMaps.length){
              if(!actualGeometry)throw new TslIrError('Tangent Normal Map needs actual decoded primitive geometry')
              validateTangentNormalMapBinding(tangentMaps,actualGeometry,extras?.objectSpace,extras,options)
            }
            // The expression builder validates its operations. These checks also
            // establish that its vertex inputs exist on this exact primitive,
            // rather than relying on the renderer's silent zero-attribute fallbacks.
            const inspect = (value: unknown): void => {
              if (typeof value === 'number' && !Number.isFinite(value)) throw new TslIrError('Nonfinite material program value')
              if (Array.isArray(value)) { value.forEach(inspect); return }
              if (!record(value)) return
              if (value.op === 'texture_ref') {
                const ref = record(value.ref) ? value.ref : null
                const image = ref && typeof ref.image === 'string' ? decoded.get(ref.image) : null
                if (!ref || !image || !record(value.image) || value.image.name !== ref.image ||
                    value.image.width !== image.width || value.image.height !== image.height || value.image.colorSpace !== image.colorSpace ||
                    !['Linear', 'Closest'].includes(String(ref.interpolation ?? 'Linear')) || !['REPEAT', 'EXTEND'].includes(String(ref.extension ?? 'REPEAT'))) {
                  throw new TslIrError('Material program texture_ref does not match its verified image metadata/sampling')
                }
              }
              if (value.op === 'uv' || value.op === 'uv_active') {
                const name = typeof value.uvMap === 'string' ? value.uvMap : ''
                const active = extras?.activeRenderUv
                if (value.op === 'uv_active' && (!active || active.schemaVersion !== 1
                  || active.model !== 'source-active-render-v1' || typeof active.uvMap !== 'string' || !active.uvMap
                  || extras?.uvChannels?.[active.uvMap] !== active.channel))
                  throw new TslIrError('Base Color program requires its source active-render UV binding')
                const channel = value.op === 'uv_active' ? active?.channel : name ? extras?.uvChannels?.[name] : 0
                if (!Number.isInteger(channel) || channel! < 0 || channel! > 3 ||
                    !Object.hasOwn(attributes, `TEXCOORD_${channel}`)) {
                  throw new TslIrError('Base Color program requires an unavailable UV attribute')
                }
              }
              if (value.op === 'vertex_color') {
                const name = typeof value.layer === 'string' ? value.layer : ''
                const attribute = name ? extras?.colorLayers?.[name] : 'color'
                const semantic = attribute === 'color' ? 'COLOR_0' : attribute?.match(/^color_(\d+)$/)?.[1]
                if (!semantic || !Object.hasOwn(attributes, semantic === 'COLOR_0' ? semantic : `COLOR_${semantic}`)) {
                  throw new TslIrError('Base Color program requires an unavailable color attribute')
                }
              }
              if (value.op === 'generated' && !extras?.texspace) throw new TslIrError('Base Color program has no Generated texspace')
              if ((value.op === 'object_coords' || value.op === 'generated') && !['gltf-y-up', 'blender-z-up'].includes(String(extras?.objectSpace))) throw new TslIrError('Base Color program has no exported object-space basis')
              Object.values(value).forEach(inspect)
            }
            inspect(record(program) ? program.channels : ir)
            if(ir)buildTslColorNode(ir, options)
            if((vertexAlpha||nativeNormal||magic||cameraData||squeeze||rendererRequired)&&record(program)&&record(program.channels)){
              const built=buildMaterialProgram(program.channels as unknown as Record<string,import('./tslMaterialProgram.js').MaterialProgramChannel>,options)
              for(const [name,channel] of Object.entries(program.channels)){
                if(vertexAlphaLayers(channel).size||hasNativeNormal(channel)||hasMagic(channel)||hasCameraData(channel)||hasSqueeze(channel)||matchingNodeRendererPrograms(channel,rendererRequirement.required).length){
                  const skipped=built.skipped.find(item=>item.channel===name)
                  if(skipped)throw new TslIrError(`Native material channel ${name}: ${skipped.reason}`)
                }
              }
            }
          } catch (error) {
            if (!(error instanceof TslIrError)) throw error
            valid = false
            refusal=error.message
          } finally { actualGeometry?.geometry.dispose();resources.dispose() }
      }
      if(!baseColorRequired&&!valid&&bindingCount>0)throw new Error(`Compiled live material program on material[${index}] has no verified actual binding: ${refusal}`)
      if (baseColorRequired&&valid && bindingCount > 0) accepted.add(index)
    }
  } finally { preparation.dispose();textures?.dispose() }
  return accepted
}
