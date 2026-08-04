export interface GltfRuntimeCapabilityProfile {
  readonly id: string
  /** Exact extension names this configured runtime may accept when required. */
  readonly supportedRequiredExtensions: ReadonlySet<string>
  /** Omit while KHR_animation_pointer playback is unsupported. */
  supportsAnimationPointer?(pointer: string): boolean
  /**
   * Joints one skin may carry. Omit for a runtime with no ceiling: the classic
   * WebGLRenderer uploads bone matrices through a texture and has none, so a
   * scene that is unrenderable on one runtime is fine on another and the
   * ceiling belongs to the profile rather than to the artifact.
   */
  readonly maxSkinJoints?: number
  /**
   * Highest glTF `texCoord` index the runtime binds to a geometry attribute.
   * Unlike the joint ceiling this is a property of the loader rather than the
   * renderer, so it applies to every three runtime and the compiled profile
   * carries it.
   */
  readonly maxTextureCoordinateIndex?: number
}

/**
 * Mirrors `web_runtime_limits.json`, which carries the measurement and the
 * artist-facing consequence for both numbers. They are repeated here as plain
 * constants on purpose: this module is bundled into the browser runtime, and
 * reading the registry would drag `node:fs` in with it. `webRuntimeLimits.test.ts`
 * asserts the two agree, so the duplication cannot drift silently.
 */
export const THREE_NODE_MAX_SKIN_JOINTS = 1024
export const THREE_MAX_TEXTURE_COORDINATE_INDEX = 3

const BONE_MATRIX_BYTES = 64

const THREE_R184_PACKAGE_REQUIRED_EXTENSIONS = new Set([
  'EXT_materials_bump',
  'EXT_mesh_gpu_instancing',
  'EXT_meshopt_compression',
  'EXT_texture_avif',
  'EXT_texture_webp',
  'KHR_lights_punctual',
  'KHR_materials_anisotropy',
  'KHR_materials_clearcoat',
  'KHR_materials_dispersion',
  'KHR_materials_emissive_strength',
  'KHR_materials_ior',
  'KHR_materials_iridescence',
  'KHR_materials_sheen',
  'KHR_materials_specular',
  'KHR_materials_transmission',
  'KHR_materials_unlit',
  'KHR_materials_volume',
  'KHR_mesh_quantization',
  'KHR_texture_basisu',
  'KHR_texture_transform',
])

/**
 * Exact package-owned profile verified against Three r184. KTX2 and the EXT
 * Meshopt name are included because generated Blendlink descriptors configure
 * those decoders. Draco and KHR_meshopt_compression remain loud gaps.
 */
export const BLENDLINK_THREE_R184_COMPILED_PROFILE: GltfRuntimeCapabilityProfile =
  Object.freeze({
    id: 'Blendlink Three r184 compiled runtime',
    supportedRequiredExtensions: THREE_R184_PACKAGE_REQUIRED_EXTENSIONS,
    // No ceilings on the compile-time profile. The joint ceiling belongs to
    // the node-material renderers and is applied where the renderer is known;
    // the UV ceiling is reported as artifact conformance evidence by
    // compiledSceneAudit, because it must not throw on the Preview path.
  })

const GLB_MAGIC = 0x46546c67
const GLB_JSON_CHUNK = 0x4e4f534a

export interface GltfAnimationPointerEvidence {
  readonly animation: number
  readonly channel: number
  readonly pointer: string
  readonly family: 'material' | 'camera' | 'light' | 'node' | 'other'
}

export interface GltfSkinJointEvidence {
  readonly skin: number
  readonly name?: string
  readonly joints: number
  readonly boneMatrixBytes: number
}

export interface GltfRuntimeCompatibilityIssue {
  readonly code:
    | 'runtime.required-extension-unsupported'
    | 'runtime.animation-pointer-unsupported'
    | 'runtime.skin-joint-budget-exceeded'
  /** Absent for issues that are not about a glTF extension. */
  readonly extension?: string
  readonly location: string
  readonly pointer?: string
  readonly skin?: GltfSkinJointEvidence
  readonly summary: string
  readonly fix: string
}

export interface GltfRuntimeCompatibilityReport {
  readonly profile: string
  readonly extensionsUsed: readonly string[]
  readonly extensionsRequired: readonly string[]
  readonly animationPointers: readonly GltfAnimationPointerEvidence[]
  readonly skins: readonly GltfSkinJointEvidence[]
  readonly issues: readonly GltfRuntimeCompatibilityIssue[]
  readonly compatible: boolean
}

export class GltfRuntimeCompatibilityError extends Error {
  readonly report: GltfRuntimeCompatibilityReport

  constructor(report: GltfRuntimeCompatibilityReport) {
    super(formatCompatibilityFailure(report))
    this.name = 'GltfRuntimeCompatibilityError'
    this.report = report
  }
}

export function inspectGltfRuntimeCompatibility(
  document: unknown,
  profile: GltfRuntimeCapabilityProfile,
): GltfRuntimeCompatibilityReport {
  if (!isRecord(document)) {
    throw new Error('glTF runtime compatibility requires a JSON object root.')
  }
  if (!profile.id.trim()) {
    throw new Error('glTF runtime capability profile requires a non-empty id.')
  }
  const extensionsUsed = stringArray(document.extensionsUsed, '/extensionsUsed')
  const extensionsRequired = stringArray(
    document.extensionsRequired,
    '/extensionsRequired',
  )
  const animationPointers = animationPointerEvidence(document.animations)
  const skins = skinJointEvidence(document.skins)
  const issues: GltfRuntimeCompatibilityIssue[] = []
  if (profile.maxSkinJoints !== undefined) {
    const budget = profile.maxSkinJoints
    if (!Number.isInteger(budget) || budget <= 0) {
      throw new Error(
        `glTF runtime capability profile maxSkinJoints must be a positive integer; got ${budget}.`,
      )
    }
    for (const skin of skins) {
      if (skin.joints <= budget) continue
      issues.push(Object.freeze({
        code: 'runtime.skin-joint-budget-exceeded',
        location: `/skins/${skin.skin}/joints`,
        skin,
        summary:
          `Skin ${skin.name ? `"${skin.name}" ` : ''}carries ${skin.joints} joints, but ` +
          `${profile.id} binds bone matrices through a uniform buffer that holds ${budget}. ` +
          `Its ${skin.boneMatrixBytes} bytes of bone matrices exceed the 65536-byte limit.`,
        fix:
          'Nothing renders past this ceiling and the runtime reports no error of its own: ' +
          'the mesh draws no pixels while the failed pipeline retries every frame. Export ' +
          'deforming joints only, reduce the rig\'s deforming bone count, or split the ' +
          'character across more than one armature.',
      }))
    }
  }
  for (const [index, extension] of extensionsRequired.entries()) {
    if (profile.supportedRequiredExtensions.has(extension)) continue
    issues.push(Object.freeze({
      code: 'runtime.required-extension-unsupported',
      extension,
      location: `/extensionsRequired/${index}`,
      summary: `The compiled glTF requires ${extension}, but ${profile.id} has no verified handler.`,
      fix: `Remove or bake the feature, or provide a compatible runtime before publishing this scene.`,
    }))
  }
  for (const pointer of animationPointers) {
    if (profile.supportsAnimationPointer?.(pointer.pointer) === true) continue
    const location = `/animations/${pointer.animation}/channels/${pointer.channel}` +
      '/target/extensions/KHR_animation_pointer/pointer'
    issues.push(Object.freeze({
      code: 'runtime.animation-pointer-unsupported',
      extension: 'KHR_animation_pointer',
      location,
      pointer: pointer.pointer,
      summary: `The compiled glTF animates ${pointer.pointer}, but ${profile.id} would omit that channel.`,
      fix: `Bake or remove the pointer animation, or provide a compatible runtime before publishing this scene.`,
    }))
  }
  return Object.freeze({
    profile: profile.id,
    extensionsUsed: Object.freeze(extensionsUsed),
    extensionsRequired: Object.freeze(extensionsRequired),
    animationPointers: Object.freeze(animationPointers),
    skins: Object.freeze(skins),
    issues: Object.freeze(issues),
    compatible: issues.length === 0,
  })
}

export function assertGltfRuntimeCompatibility(
  document: unknown,
  profile: GltfRuntimeCapabilityProfile,
): GltfRuntimeCompatibilityReport {
  const report = inspectGltfRuntimeCompatibility(document, profile)
  if (!report.compatible) throw new GltfRuntimeCompatibilityError(report)
  return report
}

/**
 * Describe the concrete handlers on one already-loaded Three parser without
 * registering, unregistering, or otherwise mutating an application loader.
 */
export function loadedThreeRuntimeProfile(
  parser: unknown,
  applicationCapabilities?: GltfRuntimeCapabilityProfile,
): {
  readonly json: Record<string, unknown>
  readonly profile: GltfRuntimeCapabilityProfile
} {
  if (!isRecord(parser) || !isRecord(parser.json)) {
    throw new Error(
      'Loaded Three glTF has no inspectable parser JSON; Blendlink cannot prove runtime compatibility.',
    )
  }
  const plugins = optionalRecord(parser.plugins, 'loaded Three parser plugins')
  const extensions = optionalRecord(parser.extensions, 'loaded Three parser extensions')
  const options = optionalRecord(parser.options, 'loaded Three parser options')
  const registered = new Set([...Object.keys(plugins), ...Object.keys(extensions)])
  const supported = new Set(
    BLENDLINK_THREE_R184_COMPILED_PROFILE.supportedRequiredExtensions,
  )
  if (!options.ktx2Loader) supported.delete('KHR_texture_basisu')
  const meshopt = options.meshoptDecoder
  if (!isRecord(meshopt) || meshopt.supported !== true) {
    supported.delete('EXT_meshopt_compression')
    supported.delete('KHR_meshopt_compression')
  }
  if (applicationCapabilities) {
    if (!applicationCapabilities.id.trim()) {
      throw new Error('Application glTF runtime capabilities require a non-empty id.')
    }
    for (const extension of applicationCapabilities.supportedRequiredExtensions) {
      if (registered.has(extension)) supported.add(extension)
    }
  }
  const supportsAnimationPointer = applicationCapabilities?.supportsAnimationPointer
  const pointerRegistered = registered.has('KHR_animation_pointer')
  return Object.freeze({
    json: parser.json,
    profile: Object.freeze({
      id: applicationCapabilities
        ? `configured Three r184 loaded parser + ${applicationCapabilities.id}`
        : 'configured Three r184 loaded parser',
      supportedRequiredExtensions: supported,
      // An application that has measured its own renderer's ceiling states it;
      // the parser cannot know one, so nothing is invented here.
      ...(applicationCapabilities?.maxSkinJoints !== undefined
        ? { maxSkinJoints: applicationCapabilities.maxSkinJoints }
        : {}),
      ...(pointerRegistered && supportsAnimationPointer
        ? {
            supportsAnimationPointer: (pointer: string) =>
              supportsAnimationPointer(pointer),
          }
        : {}),
    }),
  })
}

export function readGlbJson(
  bytes: Uint8Array,
  label = 'glTF',
): Record<string, unknown> {
  if (!(bytes instanceof Uint8Array)) {
    throw new Error(`${label} GLB bytes must be a Uint8Array.`)
  }
  if (bytes.byteLength < 20) throw new Error(`${label} GLB header is truncated.`)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (view.getUint32(0, true) !== GLB_MAGIC) {
    throw new Error(`${label} artifact is not a GLB.`)
  }
  const version = view.getUint32(4, true)
  if (version !== 2) throw new Error(`${label} GLB version ${version} is not supported.`)
  const declaredLength = view.getUint32(8, true)
  if (declaredLength !== bytes.byteLength) {
    throw new Error(
      `${label} GLB declares ${declaredLength} bytes but contains ${bytes.byteLength}.`,
    )
  }
  let offset = 12
  let json: string | null = null
  while (offset < declaredLength) {
    if (offset + 8 > declaredLength) {
      throw new Error(`${label} GLB chunk header is truncated.`)
    }
    const chunkLength = view.getUint32(offset, true)
    const chunkType = view.getUint32(offset + 4, true)
    const start = offset + 8
    const end = start + chunkLength
    if (!Number.isSafeInteger(end) || end > declaredLength) {
      throw new Error(`${label} GLB chunk exceeds the artifact boundary.`)
    }
    if (chunkType === GLB_JSON_CHUNK) {
      if (json !== null) throw new Error(`${label} GLB contains more than one JSON chunk.`)
      try {
        json = new TextDecoder('utf-8', { fatal: true })
          .decode(bytes.subarray(start, end))
          .replace(/[\u0000\u0020]+$/u, '')
      } catch (error) {
        throw new Error(`${label} GLB JSON is not valid UTF-8: ${errorMessage(error)}`)
      }
    }
    offset = end
  }
  if (json === null) throw new Error(`${label} GLB has no JSON chunk.`)
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch (error) {
    throw new Error(`${label} GLB JSON is invalid: ${errorMessage(error)}`)
  }
  if (!isRecord(parsed)) throw new Error(`${label} GLB JSON root must be an object.`)
  return parsed
}

function formatCompatibilityFailure(report: GltfRuntimeCompatibilityReport): string {
  return [
    `Compiled glTF is not compatible with ${report.profile}:`,
    ...report.issues.map((issue) =>
      `- [${issue.code}] ${issue.summary} ${issue.fix}`),
  ].join('\n')
}

function stringArray(value: unknown, location: string): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) ||
      value.some((entry) => typeof entry !== 'string' || entry.length === 0)) {
    throw new Error(`glTF ${location} must be an array of non-empty strings.`)
  }
  return [...value]
}

/**
 * Joint counts for every skin, gathered whether or not a ceiling applies, so
 * the report carries the number even for a runtime that has no limit. A skin
 * with a malformed joint list is an inspection error rather than a pass: the
 * whole point of this report is that nothing downstream has to guess.
 */
function skinJointEvidence(value: unknown): GltfSkinJointEvidence[] {
  if (value === undefined) return []
  const skins = recordArray(value, '/skins')
  return skins.map((skin, index) => {
    const joints = skin.joints
    if (!Array.isArray(joints) || joints.length === 0 ||
        !joints.every((joint) => Number.isSafeInteger(joint) && (joint as number) >= 0)) {
      throw new Error(
        `glTF /skins/${index}/joints must be a non-empty array of node indices.`,
      )
    }
    const name = typeof skin.name === 'string' && skin.name ? skin.name : undefined
    return Object.freeze({
      skin: index,
      ...(name ? { name } : {}),
      joints: joints.length,
      boneMatrixBytes: joints.length * BONE_MATRIX_BYTES,
    })
  })
}

function animationPointerEvidence(value: unknown): GltfAnimationPointerEvidence[] {
  if (value === undefined) return []
  const animations = recordArray(value, '/animations')
  const pointers: GltfAnimationPointerEvidence[] = []
  for (const [animationIndex, animation] of animations.entries()) {
    const channels = recordArray(
      animation.channels,
      `/animations/${animationIndex}/channels`,
    )
    for (const [channelIndex, channel] of channels.entries()) {
      if (!isRecord(channel.target)) {
        throw new Error(
          `glTF /animations/${animationIndex}/channels/${channelIndex}/target must be an object.`,
        )
      }
      const target = channel.target
      if (target.extensions === undefined) continue
      if (!isRecord(target.extensions)) {
        throw new Error(
          `glTF /animations/${animationIndex}/channels/${channelIndex}/target/extensions must be an object.`,
        )
      }
      const extension = target.extensions.KHR_animation_pointer
      if (extension === undefined) continue
      const location = `/animations/${animationIndex}/channels/${channelIndex}` +
        '/target/extensions/KHR_animation_pointer'
      if (!isRecord(extension) ||
          typeof extension.pointer !== 'string' ||
          !extension.pointer.startsWith('/')) {
        throw new Error(`glTF ${location}/pointer must be a non-empty JSON pointer string.`)
      }
      if (target.path !== 'pointer') {
        throw new Error(`glTF ${location} requires target.path "pointer".`)
      }
      pointers.push(Object.freeze({
        animation: animationIndex,
        channel: channelIndex,
        pointer: extension.pointer,
        family: pointerFamily(extension.pointer),
      }))
    }
  }
  return pointers
}

function pointerFamily(
  pointer: string,
): GltfAnimationPointerEvidence['family'] {
  if (pointer.startsWith('/materials/')) return 'material'
  if (pointer.startsWith('/cameras/')) return 'camera'
  if (pointer.startsWith('/nodes/')) return 'node'
  if (pointer.startsWith('/extensions/KHR_lights_punctual/lights/')) return 'light'
  return 'other'
}

function recordArray(value: unknown, location: string): Record<string, unknown>[] {
  if (!Array.isArray(value) || value.some((entry) => !isRecord(entry))) {
    throw new Error(`glTF ${location} must be an array of objects.`)
  }
  return value
}

function optionalRecord(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (value === undefined) return {}
  if (!isRecord(value)) throw new Error(`${label} must be an object.`)
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
