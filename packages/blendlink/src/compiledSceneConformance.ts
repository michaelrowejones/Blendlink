import {
  THREE_MAX_TEXTURE_COORDINATE_INDEX,
  THREE_NODE_MAX_SKIN_JOINTS,
} from './gltfRuntimeCompatibility.js'

/**
 * Conformance of one finished GLB with the runtime Blendlink claims to
 * support. It is a pure function of the artifact: no Blender, no depsgraph, no
 * compiler state - which is exactly the point, because the compiler is not the
 * only thing that can put a joint, a UV binding, or a material into a GLB, and
 * the compiler's own preflight cannot see what the exporter did afterwards.
 *
 * Every check here exists because a scene crossed it and the browser said
 * nothing: a character invisible because its material sampled a UV set the
 * loader never bound, materials reaching the runtime with no base-colour
 * carrier at all and rendering pure white, a rig whose skin could never fit in
 * a uniform buffer. None of those raise a runtime error, so the artifact is
 * the last place they can be caught.
 *
 * This module reports; it never throws for a conformance failure. It runs on
 * the Preview path, where refusing would take away the iteration loop an
 * artist needs to FIX the problem. `sync` turns these records into blocking
 * verify issues at publication, where refusing is the right answer.
 */

export type CompiledSceneConformanceCode =
  | 'conformance.texcoord-out-of-range'
  | 'conformance.texcoord-accessor-missing'
  | 'conformance.base-color-carrier-missing'
  | 'conformance.blender-default-material-bound'
  | 'conformance.skin-joint-budget-exceeded'

export const COMPILED_SCENE_CONFORMANCE_CODES: readonly CompiledSceneConformanceCode[] =
  Object.freeze([
    'conformance.texcoord-out-of-range',
    'conformance.texcoord-accessor-missing',
    'conformance.base-color-carrier-missing',
    'conformance.blender-default-material-bound',
    'conformance.skin-joint-budget-exceeded',
  ])

/**
 * How bad each finding is, declared here with the evidence rather than
 * decided by the consumer.
 *
 * `blocking` means the artifact cannot render what the artist authored on any
 * supported runtime, so publishing it would ship a scene that is wrong
 * everywhere. The two advisory codes are deliberately not that: Blendlink
 * substitutes a neutral material on purpose when a mesh has none, and a skin
 * past the joint ceiling still renders on the classic WebGL runtime - refusing
 * publication there would block a scene that works, which is why the joint
 * refusal lives at install time where the renderer is actually known.
 */
export const COMPILED_SCENE_CONFORMANCE_SEVERITY: Readonly<
  Record<CompiledSceneConformanceCode, 'blocking' | 'advisory'>
> = Object.freeze({
  'conformance.texcoord-out-of-range': 'blocking',
  'conformance.texcoord-accessor-missing': 'blocking',
  'conformance.base-color-carrier-missing': 'blocking',
  'conformance.blender-default-material-bound': 'advisory',
  'conformance.skin-joint-budget-exceeded': 'advisory',
})

export interface CompiledSceneConformanceIssue {
  readonly code: CompiledSceneConformanceCode
  /** JSON pointer into the GLB, so the evidence can be checked by hand. */
  readonly location: string
  /** The name an artist can search for in Blender: a material, mesh, or skin. */
  readonly subject: string
  /** Other named things this issue affects, sorted for stable output. */
  readonly affects: readonly string[]
  readonly summary: string
  readonly fix: string
}

export interface CompiledSceneConformance {
  readonly profile: 'blendlink-glb-conformance-v1'
  readonly issues: readonly CompiledSceneConformanceIssue[]
  readonly conformant: boolean
  /**
   * How many subjects each check examined. An empty issue list means nothing
   * unless you can also see that the check ran, so this is recorded even when
   * every check passes.
   */
  readonly checked: Readonly<Record<CompiledSceneConformanceCode, number>>
}

export interface CompiledSceneConformanceInput {
  /** The raw glTF JSON root, exactly as `readGlbJson` returns it. */
  readonly gltf: Record<string, unknown>
  /**
   * Rendered triangles per material index, from the caller's scene-reachability
   * pass. A material bound only by unreachable primitives cannot make anything
   * look wrong, so it is evidence rather than a defect.
   */
  readonly materialRenderedTriangles?: readonly number[]
}

const BLENDER_DEFAULT_MATERIAL_MARKER = 'blender-default-material'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function records(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return []
  return value.filter(isRecord)
}

function nameOf(value: unknown, fallback: string): string {
  return isRecord(value) && typeof value.name === 'string' && value.name
    ? value.name
    : fallback
}

/**
 * Every `texCoord` a material references, wherever it appears.
 *
 * Walking the material subtree generically rather than naming the slots is
 * deliberate: glTF puts textureInfo objects inside material extensions, and an
 * enumeration of the known ones is a list that silently loses a member every
 * time an extension is added. `KHR_texture_transform` can also override the
 * set a texture samples, and it is found by the same walk for free.
 */
function referencedTexCoords(material: Record<string, unknown>): Map<number, string[]> {
  const found = new Map<number, string[]>()
  const walk = (value: unknown, pointer: string): void => {
    if (Array.isArray(value)) {
      value.forEach((entry, index) => walk(entry, `${pointer}/${index}`))
      return
    }
    if (!isRecord(value)) return
    const texCoord = value.texCoord
    if (typeof texCoord === 'number' && Number.isInteger(texCoord) && texCoord >= 0) {
      const at = found.get(texCoord) ?? []
      at.push(pointer)
      found.set(texCoord, at)
    }
    // A textureInfo with no explicit texCoord samples set 0 by glTF default.
    if (typeof value.index === 'number' && value.texCoord === undefined &&
        pointer.endsWith('Texture')) {
      const at = found.get(0) ?? []
      at.push(pointer)
      found.set(0, at)
    }
    for (const [key, entry] of Object.entries(value)) {
      walk(entry, `${pointer}/${key}`)
    }
  }
  walk(material, '')
  return found
}

/**
 * Whether anything in the artifact decides this surface's colour.
 *
 * glTF's default base colour is opaque white, and a material that carries the
 * default explicitly is indistinguishable from one that carries nothing: both
 * render pure white. So an all-ones `baseColorFactor` counts as absent. Vertex
 * colours count as present, because Blendlink itself lowers a proven colour
 * attribute to `COLOR_0` and that surface is fully decided.
 */
function hasBaseColorCarrier(
  material: Record<string, unknown>,
  attributeSets: readonly Set<string>[],
): boolean {
  const pbr = material.pbrMetallicRoughness
  if (isRecord(pbr)) {
    if (isRecord(pbr.baseColorTexture)) return true
    const factor = pbr.baseColorFactor
    if (Array.isArray(factor) &&
        factor.some((value) => typeof value === 'number' && value !== 1)) {
      return true
    }
  }
  const extensions = material.extensions
  if (isRecord(extensions)) {
    for (const extension of Object.values(extensions)) {
      if (!isRecord(extension)) continue
      if (isRecord(extension.diffuseTexture) || Array.isArray(extension.diffuseFactor)) {
        return true
      }
    }
  }
  return attributeSets.some((attributes) =>
    [...attributes].some((attribute) => attribute.startsWith('COLOR_')))
}

export function inspectCompiledSceneConformance(
  input: CompiledSceneConformanceInput,
): CompiledSceneConformance {
  const { gltf } = input
  const materials = records(gltf.materials)
  const meshes = records(gltf.meshes)
  const skins = records(gltf.skins)
  const issues: CompiledSceneConformanceIssue[] = []
  const checked: Record<CompiledSceneConformanceCode, number> = {
    'conformance.texcoord-out-of-range': 0,
    'conformance.texcoord-accessor-missing': 0,
    'conformance.base-color-carrier-missing': 0,
    'conformance.blender-default-material-bound': 0,
    'conformance.skin-joint-budget-exceeded': 0,
  }

  const materialTexCoords = materials.map(referencedTexCoords)
  const materialNames = materials.map((material, index) =>
    nameOf(material, `materials[${index}]`))
  const boundBy = materials.map((): { mesh: string; pointer: string; attributes: Set<string> }[] => [])

  meshes.forEach((mesh, meshIndex) => {
    const meshName = nameOf(mesh, `meshes[${meshIndex}]`)
    records(mesh.primitives).forEach((primitive, primitiveIndex) => {
      const materialRef = primitive.material
      if (typeof materialRef !== 'number' || !materials[materialRef]) return
      const attributes = isRecord(primitive.attributes)
        ? new Set(Object.keys(primitive.attributes))
        : new Set<string>()
      boundBy[materialRef]!.push({
        mesh: meshName,
        pointer: `/meshes/${meshIndex}/primitives/${primitiveIndex}`,
        attributes,
      })
    })
  })

  materials.forEach((material, index) => {
    const name = materialNames[index]!
    const bindings = boundBy[index]!
    const texCoords = materialTexCoords[index]!
    const renderedTriangles = input.materialRenderedTriangles?.[index]

    for (const [texCoord, pointers] of [...texCoords].sort((a, b) => a[0] - b[0])) {
      checked['conformance.texcoord-out-of-range'] += 1
      if (texCoord > THREE_MAX_TEXTURE_COORDINATE_INDEX) {
        issues.push(Object.freeze({
          code: 'conformance.texcoord-out-of-range',
          location: `/materials/${index}${pointers[0] ?? ''}`,
          subject: name,
          affects: Object.freeze([...new Set(bindings.map((binding) => binding.mesh))].sort()),
          summary:
            `Material "${name}" samples texCoord ${texCoord}, but three's GLTFLoader binds ` +
            `TEXCOORD_0..${THREE_MAX_TEXTURE_COORDINATE_INDEX} and loads anything above that ` +
            'under a name no material can reach.',
          fix:
            'Nothing reports this at runtime: the material samples a zero vector, which lands ' +
            'outside every UV island, and where that area is transparent the mesh disappears ' +
            'entirely. Reduce the mesh to at most four UV maps before the compiled layer is ' +
            'added, or remove the utility UV maps this material does not sample.',
        }))
        continue
      }
      const missing = bindings.filter((binding) =>
        !binding.attributes.has(`TEXCOORD_${texCoord}`))
      if (!missing.length) continue
      checked['conformance.texcoord-accessor-missing'] += 1
      issues.push(Object.freeze({
        code: 'conformance.texcoord-accessor-missing',
        location: missing[0]!.pointer,
        subject: name,
        affects: Object.freeze([...new Set(missing.map((binding) => binding.mesh))].sort()),
        summary:
          `Material "${name}" samples texCoord ${texCoord}, but ${missing.length} of the ` +
          `${bindings.length} primitive(s) bound to it carry no TEXCOORD_${texCoord} attribute.`,
        fix:
          'The runtime substitutes a zero vector for the missing attribute and samples outside ' +
          'every island, so the surface takes the colour of the gutter. Give those meshes the ' +
          'UV map the material expects, or bind the material to the UV set they actually have.',
      }))
    }

    if (bindings.length) {
      checked['conformance.base-color-carrier-missing'] += 1
      if (!hasBaseColorCarrier(material, bindings.map((binding) => binding.attributes)) &&
          (renderedTriangles === undefined || renderedTriangles > 0)) {
        issues.push(Object.freeze({
          code: 'conformance.base-color-carrier-missing',
          location: `/materials/${index}`,
          subject: name,
          affects: Object.freeze([...new Set(bindings.map((binding) => binding.mesh))].sort()),
          summary:
            `Material "${name}" reaches the runtime with neither a base-colour texture nor a ` +
            'base-colour factor.',
          fix:
            "glTF's default base colour is opaque white, so this surface renders pure white " +
            'with no warning of any kind. Give the material a colour Blendlink can carry, or ' +
            'route it through a bake so the compiled artifact carries one.',
        }))
      }

      checked['conformance.blender-default-material-bound'] += 1
      const extras = material.extras
      if (isRecord(extras) &&
          extras.blendlink_generated === BLENDER_DEFAULT_MATERIAL_MARKER) {
        issues.push(Object.freeze({
          code: 'conformance.blender-default-material-bound',
          location: `/materials/${index}`,
          subject: name,
          affects: Object.freeze([...new Set(bindings.map((binding) => binding.mesh))].sort()),
          summary:
            `${bindings.length} primitive(s) are bound to Blendlink's stand-in for Blender's ` +
            'own default material, which means they had no material of their own.',
          fix:
            'Blendlink substitutes a neutral dielectric so the surface is visible rather than ' +
            'undefined, but nobody authored it. Assign a material to those meshes in Blender.',
        }))
      }
    }
  })

  skins.forEach((skin, index) => {
    checked['conformance.skin-joint-budget-exceeded'] += 1
    const joints = Array.isArray(skin.joints) ? skin.joints.length : 0
    if (joints <= THREE_NODE_MAX_SKIN_JOINTS) return
    const name = nameOf(skin, `skins[${index}]`)
    issues.push(Object.freeze({
      code: 'conformance.skin-joint-budget-exceeded',
      location: `/skins/${index}/joints`,
      subject: name,
      affects: Object.freeze([]),
      summary:
        `Skin "${name}" carries ${joints} joints. three's node-material renderers bind bone ` +
        `matrices as a uniform buffer that holds ${THREE_NODE_MAX_SKIN_JOINTS}; ` +
        `${joints * 64} bytes of matrices do not fit in the 65536-byte limit.`,
      fix:
        'The character draws nothing at all on the WebGPU renderer and on its WebGL2 fallback, ' +
        'with no runtime error, while the failed pipeline retries every frame. The classic ' +
        'WebGLRenderer still renders it. Export deforming joints only, reduce the deforming ' +
        'bone count, or split the character across more than one armature.',
    }))
  })

  return Object.freeze({
    profile: 'blendlink-glb-conformance-v1',
    issues: Object.freeze(issues),
    conformant: issues.length === 0,
    checked: Object.freeze(checked),
  })
}
