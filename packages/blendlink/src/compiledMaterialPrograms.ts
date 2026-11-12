import { createHash } from 'node:crypto'
import type { SceneManifest } from './typegen.js'
import type { TslIrDocument } from './tslNodeRecipe.js'
import type { TslRuntimeMeshExtras } from './tslMaterialProgram.js'
import { hasBaseColorCarrier } from './compiledSceneConformance.js'

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/** Evidence for the node-renderer family, never inferred from a class marker.
 * Only exact manifest-pinned sidecar bytes and a Base Color expression that
 * the production builder accepts for every bound primitive can supply it.
 * Already portable colors do not import the optional Three.js peer dependency.
 * A program needing external texture_ref or per-object data without a verified
 * resolver does not earn an exemption; its portable carrier remains accepted.
 */
export async function validatedBaseColorProgramMaterials(
  gltf: Record<string, unknown>,
  manifest: Pick<SceneManifest, 'materialPrograms'>,
  bytes?: Uint8Array,
): Promise<ReadonlySet<number>> {
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
  // The runtime loads all sidecar images before applying any material.
  // Without verified image bytes/resolvers this audit cannot establish that
  // installation succeeds, even when Base Color itself uses no texture_ref.
  if (document.images !== undefined &&
      (!record(document.images) || Object.keys(document.images).length > 0)) return accepted
  const programs = document.materials
  const needsObjectAttribute = (value: unknown): boolean => {
    if (Array.isArray(value)) return value.some(needsObjectAttribute)
    return record(value) && (value.op === 'attribute_object' || Object.values(value).some(needsObjectAttribute))
  }
  const materials = Array.isArray(gltf.materials) ? gltf.materials : []
  const meshes = Array.isArray(gltf.meshes) ? gltf.meshes : []
  const candidates = materials.flatMap((material, index) => {
    if (!record(material) || !record(material.extras)) return []
    const attributes = meshes.flatMap(mesh => record(mesh) && Array.isArray(mesh.primitives)
      ? mesh.primitives.flatMap(primitive => record(primitive) && primitive.material === index
        ? [new Set(Object.keys(record(primitive.attributes) ? primitive.attributes : {}))] : []) : [])
    if (hasBaseColorCarrier(material, attributes)) return []
    const source = material.extras.blendlink_source_material
    if (typeof source !== 'string' || !Object.hasOwn(programs, source)) return []
    const program = programs[source]
    // The installer checks object attributes across every channel and skips
    // the entire material if one is missing. Base Color alone is insufficient
    // evidence until this audit has a verified per-object property resolver.
    if (record(program) && needsObjectAttribute(program.channels)) return []
    const channel = record(program) && record(program.channels) ? program.channels['Base Color'] : null
    if (!record(channel) || !record(channel.tslIr)) return []
    // GLTFLoader creates MeshBasicMaterial for an unlit carrier; the actual
    // program installer only swaps MeshStandardMaterial-compatible carriers.
    if (record(material.extensions) && Object.hasOwn(material.extensions, 'KHR_materials_unlit')) return []
    return [{ index, ir: channel.tslIr as unknown as TslIrDocument }]
  })
  if (!candidates.length) return accepted
  const { buildTslColorNode, createTslBuildResources, TslIrError } = await import('./tslNodeRecipe.js')
  const { buildOptionsFor } = await import('./tslMaterialProgram.js')
  for (const { index, ir } of candidates) {
    let bindings = 0
    let valid = true
    for (const mesh of meshes) {
      if (!record(mesh) || !Array.isArray(mesh.primitives)) continue
      const rawExtras = record(mesh.extras) ? mesh.extras.blendlink_tsl_runtime : null
      const extras = record(rawExtras) ? rawExtras as TslRuntimeMeshExtras : null
      for (const primitive of mesh.primitives) {
        if (!record(primitive) || primitive.material !== index) continue
        bindings++
        const attributes = record(primitive.attributes) ? primitive.attributes : {}
        const resources = createTslBuildResources()
        try {
          const options = buildOptionsFor(extras, resources, `materials[${index}]`)
          options.normalMapBasis = !Object.hasOwn(attributes, 'TEXCOORD_0') ? 'missing'
            : Object.hasOwn(attributes, 'TANGENT') ? 'attribute' : 'derivative'
          // The expression builder validates its operations. These checks also
          // establish that its vertex inputs exist on this exact primitive,
          // rather than relying on the renderer's silent zero-attribute fallbacks.
          const inspect = (value: unknown): void => {
            if (typeof value === 'number' && !Number.isFinite(value)) throw new TslIrError('Nonfinite material program value')
            if (Array.isArray(value)) { value.forEach(inspect); return }
            if (!record(value)) return
            if (value.op === 'uv') {
              const name = typeof value.uvMap === 'string' ? value.uvMap : ''
              const channel = name ? extras?.uvChannels?.[name] : 0
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
            if ((value.op === 'object_coords' || value.op === 'generated') && extras?.objectSpace !== 'gltf-y-up') throw new TslIrError('Base Color program has no exported object-space basis')
            Object.values(value).forEach(inspect)
          }
          inspect(ir)
          buildTslColorNode(ir, options)
        } catch (error) {
          if (!(error instanceof TslIrError)) throw error
          valid = false
        } finally { resources.dispose() }
      }
    }
    if (valid && bindings > 0) accepted.add(index)
  }
  return accepted
}
