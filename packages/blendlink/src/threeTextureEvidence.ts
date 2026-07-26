import * as THREE from 'three'

export type ThreeTextureTargetFamily =
  | 'ASTC'
  | 'BC7'
  | 'BC6H'
  | 'BC-DXT'
  | 'BC4'
  | 'BC5'
  | 'ETC2'
  | 'ETC1'
  | 'EAC'
  | 'PVRTC'
  | 'RGBA'
  | 'RGB'
  | 'RG'
  | 'R'
  | 'depth'
  | 'unknown'

export type ThreeTextureMipSource = 'explicit' | 'generated' | 'base' | 'unknown'

export interface ThreeTextureDimensions {
  width: number | null
  height: number | null
  /** Array layers or 3D slices. Always one for ordinary 2D textures. */
  depth: number | null
  /** Six for cube textures, one for ordinary textures. */
  faces: number | null
}

export interface ThreeTextureMipEvidence extends ThreeTextureDimensions {
  level: number
  /** Standard texel/block payload. Driver allocation overhead is not observable. */
  estimatedResidentBytes: number | null
}

export interface ThreeTextureResidentEvidence {
  /** Sum of every mip whose dimensions and storage format are known. */
  knownBytes: number
  /** Total only when every resident mip can be sized. */
  totalBytes: number | null
  complete: boolean
  unknownMipCount: number
  /** Defines the scope of this estimate and intentionally excludes driver overhead. */
  scope: 'format-payload'
}

export interface ThreeTextureEvidence {
  uuid: string | null
  name: string
  /** Allocation shared by textures that Three WebGL maps to the same Source/cache-key pair. */
  webglAllocationId: string
  /** Material property/uniform paths and scene-level uses referencing this texture. */
  roles: string[]
  dimensions: ThreeTextureDimensions
  mipCount: number
  mipSource: ThreeTextureMipSource
  mips: ThreeTextureMipEvidence[]
  colorSpace: string | null
  type: number | null
  typeName: string | null
  format: number | null
  formatName: string | null
  internalFormat: string | number | null
  targetFamily: ThreeTextureTargetFamily
  targetLabel: string | null
  compressed: boolean | null
  resident: ThreeTextureResidentEvidence
  /** Reasons a target or byte total could not be established. Never replaced by guesses. */
  unknowns: string[]
}

export interface ThreeTextureFormatEvidence {
  targetFamily: ThreeTextureTargetFamily
  textureCount: number
  webglAllocationCount: number
  knownResidentBytes: number
  unknownResidentTextureCount: number
  unknownResidentAllocationCount: number
}

export interface ThreeTextureEvidenceSummary {
  textureCount: number
  webglAllocationCount: number
  /** Logical textures for which every allocated mip can be sized. */
  knownResidentTextureCount: number
  unknownResidentTextureCount: number
  knownResidentAllocationCount: number
  unknownResidentAllocationCount: number
  /** Known format payload summed once per Three WebGL allocation, not per Texture clone. */
  knownResidentBytes: number
  /** Null means some allocation bytes are unknowable from the supplied Three objects. */
  unknownResidentBytes: 0 | null
  /** Null unless every WebGL allocation has a complete estimate. */
  totalEstimatedResidentBytes: number | null
  formatCounts: Record<string, number>
  formats: ThreeTextureFormatEvidence[]
}

export interface ThreeWebGLTextureAllocationEvidence {
  /** Projected for one Three WebGLRenderer; this does not assert that upload has occurred. */
  id: string
  textureUuids: Array<string | null>
  textureNames: string[]
  textureCount: number
  targetFamily: ThreeTextureTargetFamily
  targetLabel: string | null
  resident: ThreeTextureResidentEvidence
  /** Conflicting Texture views of one shared allocation are left explicitly unknown. */
  unknowns: string[]
}

export interface ThreeTextureDiscoveryEvidence {
  complete: boolean
  warnings: string[]
}

export interface ThreeTextureEvidenceReport {
  textures: ThreeTextureEvidence[]
  webglAllocations: ThreeWebGLTextureAllocationEvidence[]
  discovery: ThreeTextureDiscoveryEvidence
  summary: ThreeTextureEvidenceSummary
}

interface StorageFormat {
  name: string
  family: ThreeTextureTargetFamily
  compressed: boolean
  bytesPerTexel?: number
  blockWidth?: number
  blockHeight?: number
  bytesPerBlock?: number
  minimumBlocksX?: number
  minimumBlocksY?: number
}

interface Dimensions {
  width: number | null
  height: number | null
  depth: number | null
}

interface TextureFlags {
  isCubeTexture?: boolean
  isCompressedCubeTexture?: boolean
  isCompressedTexture?: boolean
  isData3DTexture?: boolean
  isDataArrayTexture?: boolean
  isCompressedArrayTexture?: boolean
  isFramebufferTexture?: boolean
  isRenderTargetTexture?: boolean
  isExternalTexture?: boolean
}

interface MipLike {
  width?: unknown
  height?: unknown
  depth?: unknown
  image?: unknown
  mipmaps?: unknown
}

interface EvidenceBuilder {
  texture: THREE.Texture
  roles: Set<string>
}

const FORMAT_STORAGE = new Map<number, StorageFormat>()
const FORMAT_NAMES = new Map<number, string>()
const TYPE_NAMES = new Map<number, string>()

function registerFormat(value: unknown, storage: StorageFormat): void {
  if (typeof value !== 'number') return
  FORMAT_STORAGE.set(value, storage)
  FORMAT_NAMES.set(value, storage.name)
}

function registerType(value: unknown, name: string): void {
  if (typeof value !== 'number') return
  TYPE_NAMES.set(value, name)
}

function block(
  name: string,
  family: ThreeTextureTargetFamily,
  blockWidth: number,
  blockHeight: number,
  bytesPerBlock: number,
  minimumBlocksX = 1,
  minimumBlocksY = 1,
): StorageFormat {
  return {
    name, family, compressed: true,
    blockWidth, blockHeight, bytesPerBlock, minimumBlocksX, minimumBlocksY,
  }
}

registerFormat(THREE.RGB_S3TC_DXT1_Format, block('RGB_S3TC_DXT1_Format', 'BC-DXT', 4, 4, 8))
registerFormat(THREE.RGBA_S3TC_DXT1_Format, block('RGBA_S3TC_DXT1_Format', 'BC-DXT', 4, 4, 8))
registerFormat(THREE.RGBA_S3TC_DXT3_Format, block('RGBA_S3TC_DXT3_Format', 'BC-DXT', 4, 4, 16))
registerFormat(THREE.RGBA_S3TC_DXT5_Format, block('RGBA_S3TC_DXT5_Format', 'BC-DXT', 4, 4, 16))
registerFormat(THREE.RGB_PVRTC_4BPPV1_Format, block('RGB_PVRTC_4BPPV1_Format', 'PVRTC', 4, 4, 8, 2, 2))
registerFormat(THREE.RGBA_PVRTC_4BPPV1_Format, block('RGBA_PVRTC_4BPPV1_Format', 'PVRTC', 4, 4, 8, 2, 2))
registerFormat(THREE.RGB_PVRTC_2BPPV1_Format, block('RGB_PVRTC_2BPPV1_Format', 'PVRTC', 8, 4, 8, 2, 2))
registerFormat(THREE.RGBA_PVRTC_2BPPV1_Format, block('RGBA_PVRTC_2BPPV1_Format', 'PVRTC', 8, 4, 8, 2, 2))
registerFormat(THREE.RGB_ETC1_Format, block('RGB_ETC1_Format', 'ETC1', 4, 4, 8))
registerFormat(THREE.RGB_ETC2_Format, block('RGB_ETC2_Format', 'ETC2', 4, 4, 8))
registerFormat(THREE.RGBA_ETC2_EAC_Format, block('RGBA_ETC2_EAC_Format', 'ETC2', 4, 4, 16))
registerFormat(THREE.R11_EAC_Format, block('R11_EAC_Format', 'EAC', 4, 4, 8))
registerFormat(THREE.SIGNED_R11_EAC_Format, block('SIGNED_R11_EAC_Format', 'EAC', 4, 4, 8))
registerFormat(THREE.RG11_EAC_Format, block('RG11_EAC_Format', 'EAC', 4, 4, 16))
registerFormat(THREE.SIGNED_RG11_EAC_Format, block('SIGNED_RG11_EAC_Format', 'EAC', 4, 4, 16))

const astcFormats: Array<[unknown, string, number, number]> = [
  [THREE.RGBA_ASTC_4x4_Format, 'RGBA_ASTC_4x4_Format', 4, 4],
  [THREE.RGBA_ASTC_5x4_Format, 'RGBA_ASTC_5x4_Format', 5, 4],
  [THREE.RGBA_ASTC_5x5_Format, 'RGBA_ASTC_5x5_Format', 5, 5],
  [THREE.RGBA_ASTC_6x5_Format, 'RGBA_ASTC_6x5_Format', 6, 5],
  [THREE.RGBA_ASTC_6x6_Format, 'RGBA_ASTC_6x6_Format', 6, 6],
  [THREE.RGBA_ASTC_8x5_Format, 'RGBA_ASTC_8x5_Format', 8, 5],
  [THREE.RGBA_ASTC_8x6_Format, 'RGBA_ASTC_8x6_Format', 8, 6],
  [THREE.RGBA_ASTC_8x8_Format, 'RGBA_ASTC_8x8_Format', 8, 8],
  [THREE.RGBA_ASTC_10x5_Format, 'RGBA_ASTC_10x5_Format', 10, 5],
  [THREE.RGBA_ASTC_10x6_Format, 'RGBA_ASTC_10x6_Format', 10, 6],
  [THREE.RGBA_ASTC_10x8_Format, 'RGBA_ASTC_10x8_Format', 10, 8],
  [THREE.RGBA_ASTC_10x10_Format, 'RGBA_ASTC_10x10_Format', 10, 10],
  [THREE.RGBA_ASTC_12x10_Format, 'RGBA_ASTC_12x10_Format', 12, 10],
  [THREE.RGBA_ASTC_12x12_Format, 'RGBA_ASTC_12x12_Format', 12, 12],
]
for (const [value, name, width, height] of astcFormats) {
  registerFormat(value, block(name, 'ASTC', width, height, 16))
}

registerFormat(THREE.RGBA_BPTC_Format, block('RGBA_BPTC_Format', 'BC7', 4, 4, 16))
registerFormat(THREE.RGB_BPTC_SIGNED_Format, block('RGB_BPTC_SIGNED_Format', 'BC6H', 4, 4, 16))
registerFormat(THREE.RGB_BPTC_UNSIGNED_Format, block('RGB_BPTC_UNSIGNED_Format', 'BC6H', 4, 4, 16))
registerFormat(THREE.RED_RGTC1_Format, block('RED_RGTC1_Format', 'BC4', 4, 4, 8))
registerFormat(THREE.SIGNED_RED_RGTC1_Format, block('SIGNED_RED_RGTC1_Format', 'BC4', 4, 4, 8))
registerFormat(THREE.RED_GREEN_RGTC2_Format, block('RED_GREEN_RGTC2_Format', 'BC5', 4, 4, 16))
registerFormat(THREE.SIGNED_RED_GREEN_RGTC2_Format, block('SIGNED_RED_GREEN_RGTC2_Format', 'BC5', 4, 4, 16))

registerFormat(THREE.AlphaFormat, { name: 'AlphaFormat', family: 'R', compressed: false })
registerFormat(THREE.RedFormat, { name: 'RedFormat', family: 'R', compressed: false })
registerFormat(THREE.RedIntegerFormat, { name: 'RedIntegerFormat', family: 'R', compressed: false })
registerFormat(THREE.RGFormat, { name: 'RGFormat', family: 'RG', compressed: false })
registerFormat(THREE.RGIntegerFormat, { name: 'RGIntegerFormat', family: 'RG', compressed: false })
registerFormat(THREE.RGBFormat, { name: 'RGBFormat', family: 'RGB', compressed: false })
registerFormat(THREE.RGBIntegerFormat, { name: 'RGBIntegerFormat', family: 'RGB', compressed: false })
registerFormat(THREE.RGBAFormat, { name: 'RGBAFormat', family: 'RGBA', compressed: false })
registerFormat(THREE.RGBAIntegerFormat, { name: 'RGBAIntegerFormat', family: 'RGBA', compressed: false })
registerFormat(THREE.DepthFormat, { name: 'DepthFormat', family: 'depth', compressed: false })
registerFormat(THREE.DepthStencilFormat, { name: 'DepthStencilFormat', family: 'depth', compressed: false })

registerType(THREE.UnsignedByteType, 'UnsignedByteType')
registerType(THREE.ByteType, 'ByteType')
registerType(THREE.ShortType, 'ShortType')
registerType(THREE.UnsignedShortType, 'UnsignedShortType')
registerType(THREE.IntType, 'IntType')
registerType(THREE.UnsignedIntType, 'UnsignedIntType')
registerType(THREE.FloatType, 'FloatType')
registerType(THREE.HalfFloatType, 'HalfFloatType')
registerType(THREE.UnsignedShort4444Type, 'UnsignedShort4444Type')
registerType(THREE.UnsignedShort5551Type, 'UnsignedShort5551Type')
registerType(THREE.UnsignedInt248Type, 'UnsignedInt248Type')
registerType(THREE.UnsignedInt5999Type, 'UnsignedInt5999Type')
registerType(THREE.UnsignedInt101111Type, 'UnsignedInt101111Type')

const INTERNAL_FORMATS = new Map<string, StorageFormat>()

function internal(name: string, family: ThreeTextureTargetFamily, bytesPerTexel: number): void {
  INTERNAL_FORMATS.set(name, { name, family, compressed: false, bytesPerTexel })
}

for (const name of ['R8', 'R8_SNORM', 'R8UI', 'R8I']) internal(name, 'R', 1)
for (const name of ['R16F', 'R16UI', 'R16I', 'R16_EXT', 'R16_SNORM_EXT']) internal(name, 'R', 2)
for (const name of ['R32F', 'R32UI', 'R32I']) internal(name, 'R', 4)
for (const name of ['RG8', 'RG8_SNORM', 'RG8UI', 'RG8I']) internal(name, 'RG', 2)
for (const name of ['RG16F', 'RG16UI', 'RG16I', 'RG16_EXT', 'RG16_SNORM_EXT']) internal(name, 'RG', 4)
for (const name of ['RG32F', 'RG32UI', 'RG32I']) internal(name, 'RG', 8)
for (const name of ['RGB8', 'SRGB8', 'RGB8_SNORM', 'RGB8UI', 'RGB8I']) internal(name, 'RGB', 3)
for (const name of ['RGB565', 'RGB5_A1', 'RGBA4']) internal(name, name === 'RGB565' ? 'RGB' : 'RGBA', 2)
for (const name of ['RGB9_E5', 'R11F_G11F_B10F', 'RGB10_A2', 'RGB10_A2UI']) {
  internal(name, name.startsWith('RGB10') ? 'RGBA' : 'RGB', 4)
}
for (const name of ['RGB16F', 'RGB16UI', 'RGB16I']) internal(name, 'RGB', 6)
for (const name of ['RGB32F', 'RGB32UI', 'RGB32I']) internal(name, 'RGB', 12)
for (const name of ['RGBA8', 'SRGB8_ALPHA8', 'RGBA8_SNORM', 'RGBA8UI', 'RGBA8I']) internal(name, 'RGBA', 4)
for (const name of ['RGBA16F', 'RGBA16UI', 'RGBA16I', 'RGBA16_EXT', 'RGBA16_SNORM_EXT']) internal(name, 'RGBA', 8)
for (const name of ['RGBA32F', 'RGBA32UI', 'RGBA32I']) internal(name, 'RGBA', 16)
internal('DEPTH_COMPONENT16', 'depth', 2)
internal('DEPTH_COMPONENT24', 'depth', 4)
internal('DEPTH_COMPONENT32F', 'depth', 4)
internal('DEPTH24_STENCIL8', 'depth', 4)
internal('DEPTH32F_STENCIL8', 'depth', 8)

/**
 * Collects texture-format and standard storage-payload evidence from a live
 * Three object graph. It observes the texture selected by loaders such as
 * KTX2Loader; it does not infer a source codec or inaccessible driver overhead.
 */
export function collectThreeTextureEvidence(root: THREE.Object3D): ThreeTextureEvidenceReport {
  if (!root || typeof root.traverse !== 'function') {
    throw new TypeError('Three texture evidence requires an Object3D or Scene with traverse().')
  }

  const builders = new Map<THREE.Texture, EvidenceBuilder>()
  const scannedMaterials = new Map<THREE.Material, Set<string>>()
  const discoveryWarnings = new Set<string>()

  const record = (texture: THREE.Texture, role: string): void => {
    let builder = builders.get(texture)
    if (!builder) {
      builder = { texture, roles: new Set<string>() }
      builders.set(texture, builder)
    }
    builder.roles.add(role)
  }

  const scanValue = (value: unknown, role: string, seen: Set<object>, depth: number): void => {
    if (!value || (typeof value !== 'object' && typeof value !== 'function')) return
    if ((value as THREE.Texture).isTexture === true) {
      record(value as THREE.Texture, role)
      return
    }
    if (depth >= 64) {
      discoveryWarnings.add(`Texture discovery stopped at ${role}: nesting exceeds 64 levels.`)
      return
    }
    if (seen.has(value as object)) return
    seen.add(value as object)
    if (Array.isArray(value)) {
      value.forEach((entry, index) => scanValue(entry, `${role}[${index}]`, seen, depth + 1))
      return
    }
    if (value instanceof Map) {
      let index = 0
      for (const entry of value.values()) {
        scanValue(entry, `${role}.mapValue[${index}]`, seen, depth + 1)
        index += 1
      }
      return
    }
    if (value instanceof Set) {
      let index = 0
      for (const entry of value.values()) {
        scanValue(entry, `${role}.setValue[${index}]`, seen, depth + 1)
        index += 1
      }
      return
    }
    if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return
    const recordValue = value as Record<string, unknown>
    if (Object.prototype.hasOwnProperty.call(recordValue, 'value')) {
      scanValue(recordValue.value, `${role}.value`, seen, depth + 1)
    }
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) return
    for (const [key, entry] of Object.entries(recordValue)) {
      if (key === 'value') continue
      scanValue(entry, `${role}.${key}`, seen, depth + 1)
    }
  }

  const scanMaterial = (material: THREE.Material, rolePrefix = 'material'): void => {
    const prefixes = scannedMaterials.get(material) ?? new Set<string>()
    if (prefixes.has(rolePrefix)) return
    prefixes.add(rolePrefix)
    scannedMaterials.set(material, prefixes)
    for (const [key, value] of Object.entries(material)) {
      if (key === 'userData' || key === '_listeners') continue
      scanValue(value, `${rolePrefix}.${key}`, new Set<object>(), 0)
    }
  }

  root.traverse((object) => {
    const scene = object as THREE.Scene
    if (scene.isScene === true) {
      if ((scene.background as THREE.Texture | null)?.isTexture === true) {
        record(scene.background as THREE.Texture, 'scene.background')
      }
      if (scene.environment?.isTexture === true) record(scene.environment, 'scene.environment')
      if (scene.overrideMaterial?.isMaterial === true) {
        scanMaterial(scene.overrideMaterial, 'scene.overrideMaterial')
      }
    }
    const material = (object as THREE.Mesh).material
    if (Array.isArray(material)) material.forEach((entry) => entry?.isMaterial && scanMaterial(entry))
    else if (material?.isMaterial) scanMaterial(material)
    const customDepthMaterial = (object as THREE.Mesh).customDepthMaterial
    if (customDepthMaterial?.isMaterial) scanMaterial(customDepthMaterial, 'customDepthMaterial')
    const customDistanceMaterial = (object as THREE.Mesh).customDistanceMaterial
    if (customDistanceMaterial?.isMaterial) scanMaterial(customDistanceMaterial, 'customDistanceMaterial')
  })

  const analyzed = [...builders.values()]
    .map(({ texture, roles }) => ({
      texture,
      evidence: analyzeTexture(texture, [...roles].sort()),
    }))
  const webglAllocations = buildWebGLAllocations(analyzed)
  const textures = analyzed
    .map(({ evidence }) => evidence)
    .sort((a, b) => (a.name || a.uuid || '').localeCompare(b.name || b.uuid || ''))

  const warnings = [...discoveryWarnings].sort()
  return {
    textures,
    webglAllocations,
    discovery: { complete: warnings.length === 0, warnings },
    summary: summarize(textures, webglAllocations),
  }
}

function analyzeTexture(texture: THREE.Texture, roles: string[]): ThreeTextureEvidence {
  const flags = texture as THREE.Texture & TextureFlags
  const unknowns: string[] = []
  const rawInternalFormat = (texture as THREE.Texture & { internalFormat?: unknown }).internalFormat
  const internalFormat = typeof rawInternalFormat === 'string' || typeof rawInternalFormat === 'number'
    ? rawInternalFormat
    : null
  const format = finiteNumber(texture.format)
  const type = finiteNumber(texture.type)
  const formatStorage = format === null ? null : FORMAT_STORAGE.get(format) ?? null
  const storage = resolveStorage(internalFormat, formatStorage, format, type, unknowns)
  const base = textureDimensions(texture, unknowns)
  const faces = flags.isCubeTexture === true ? 6 : 1
  const mipResult = textureMips(texture, base, faces, storage, unknowns)

  if (mipResult.mips.some((mip) =>
    mip.width === null || mip.height === null || mip.depth === null || mip.faces === null)) {
    unknowns.push('one or more resident mip dimensions are unavailable')
  }

  if (!storage) {
    if (internalFormat !== null) unknowns.push(`unrecognized internalFormat ${String(internalFormat)}`)
    else if (format === null) unknowns.push('missing numeric texture format')
    else unknowns.push(`unrecognized texture format ${format}`)
  }

  const knownBytes = mipResult.mips.reduce(
    (sum, mip) => sum + (mip.estimatedResidentBytes ?? 0),
    0,
  )
  const unknownMipCount = mipResult.mips.filter((mip) => mip.estimatedResidentBytes === null).length
  const complete = unknownMipCount === 0
  const formatFallback = internalFormat === null ? formatStorage : null
  const targetFamily = storage?.family ?? formatFallback?.family ?? 'unknown'
  const compressed = storage?.compressed ?? formatFallback?.compressed ?? null

  return {
    uuid: typeof texture.uuid === 'string' && texture.uuid.length > 0 ? texture.uuid : null,
    name: typeof texture.name === 'string' ? texture.name : '',
    webglAllocationId: '',
    roles,
    dimensions: { ...base, faces },
    mipCount: mipResult.mips.length,
    mipSource: mipResult.source,
    mips: mipResult.mips,
    colorSpace: typeof texture.colorSpace === 'string' ? texture.colorSpace : null,
    type,
    typeName: type === null ? null : TYPE_NAMES.get(type) ?? null,
    format,
    formatName: format === null ? null : FORMAT_NAMES.get(format) ?? null,
    internalFormat,
    targetFamily,
    targetLabel: storage?.name ?? formatFallback?.name ?? null,
    compressed,
    resident: {
      knownBytes,
      totalBytes: complete ? knownBytes : null,
      complete,
      unknownMipCount,
      scope: 'format-payload',
    },
    unknowns: [...new Set(unknowns)],
  }
}

function resolveStorage(
  internalFormat: string | number | null,
  formatStorage: StorageFormat | null,
  format: number | null,
  type: number | null,
  unknowns: string[],
): StorageFormat | null {
  if (internalFormat !== null) {
    if (typeof internalFormat !== 'string') return null
    return INTERNAL_FORMATS.get(internalFormat) ?? null
  }
  if (!formatStorage) return null
  if (formatStorage.compressed) return formatStorage
  const bytesPerTexel = uncompressedBytesPerTexel(format, type)
  if (bytesPerTexel === null) {
    if (type === null) unknowns.push('missing numeric texture type')
    else unknowns.push(`format/type storage size is unknown (${String(format)} / ${type})`)
    return null
  }
  return { ...formatStorage, bytesPerTexel }
}

function uncompressedBytesPerTexel(format: number | null, type: number | null): number | null {
  if (format === null || type === null) return null
  if (type === THREE.UnsignedShort4444Type || type === THREE.UnsignedShort5551Type) return 2
  if (type === THREE.UnsignedInt248Type || type === THREE.UnsignedInt5999Type ||
      type === THREE.UnsignedInt101111Type) return 4

  if (format === THREE.DepthFormat) {
    if (type === THREE.UnsignedShortType) return 2
    if (type === THREE.FloatType || type === THREE.UnsignedIntType ||
        type === THREE.UnsignedInt248Type) return 4
    return null
  }
  if (format === THREE.DepthStencilFormat) {
    if (type === THREE.UnsignedIntType || type === THREE.UnsignedInt248Type ||
        type === THREE.UnsignedShortType) return 4
    if (type === THREE.FloatType) return 8
    return null
  }

  const components = format === THREE.AlphaFormat || format === THREE.RedFormat || format === THREE.RedIntegerFormat
    ? 1
    : format === THREE.RGFormat || format === THREE.RGIntegerFormat
      ? 2
      : format === THREE.RGBFormat || format === THREE.RGBIntegerFormat
        ? 3
        : format === THREE.RGBAFormat || format === THREE.RGBAIntegerFormat
          ? 4
          : null
  if (components === null) return null
  const bytesPerComponent = type === THREE.UnsignedByteType || type === THREE.ByteType
    ? 1
    : type === THREE.UnsignedShortType || type === THREE.ShortType || type === THREE.HalfFloatType
      ? 2
      : type === THREE.UnsignedIntType || type === THREE.IntType || type === THREE.FloatType
        ? 4
        : null
  return bytesPerComponent === null ? null : components * bytesPerComponent
}

function textureDimensions(texture: THREE.Texture, unknowns: string[]): Dimensions {
  const flags = texture as THREE.Texture & TextureFlags
  const image = texture.image as unknown
  if (flags.isCubeTexture === true) {
    if (!Array.isArray(image) || image.length !== 6) {
      unknowns.push('cube texture does not expose six face images')
      return { width: null, height: null, depth: 1 }
    }
    const dimensions = image.map((face) => dimensionsFromValue(face))
    const first = dimensions[0]!
    if (first.width === null || first.height === null || dimensions.some((entry) =>
      entry.width !== first.width || entry.height !== first.height)) {
      unknowns.push('cube face dimensions are missing or inconsistent')
      return { width: null, height: null, depth: 1 }
    }
    return { width: first.width, height: first.height, depth: 1 }
  }
  let dimensions = dimensionsFromValue(image)
  if ((dimensions.width === null || dimensions.height === null) &&
      Array.isArray(texture.mipmaps) && texture.mipmaps.length > 0) {
    const mipDimensions = dimensionsFromValue(texture.mipmaps[0])
    dimensions = {
      width: dimensions.width ?? mipDimensions.width,
      height: dimensions.height ?? mipDimensions.height,
      depth: dimensions.depth ?? mipDimensions.depth,
    }
  }
  const defaultDepth = flags.isData3DTexture || flags.isDataArrayTexture || flags.isCompressedArrayTexture
    ? null
    : 1
  const depth = dimensions.depth ?? defaultDepth
  if (dimensions.width === null || dimensions.height === null) {
    unknowns.push('texture dimensions are unavailable')
  }
  if (depth === null) unknowns.push('texture depth/layer count is unavailable')
  return { width: dimensions.width, height: dimensions.height, depth }
}

function dimensionsFromValue(value: unknown, seen = new Set<object>()): Dimensions {
  if (!value || (typeof value !== 'object' && typeof value !== 'function')) {
    return { width: null, height: null, depth: null }
  }
  if (seen.has(value as object)) return { width: null, height: null, depth: null }
  seen.add(value as object)
  const candidate = value as Record<string, unknown>
  const width = positiveInteger(candidate.width)
    ?? positiveInteger(candidate.videoWidth)
    ?? positiveInteger(candidate.naturalWidth)
  const height = positiveInteger(candidate.height)
    ?? positiveInteger(candidate.videoHeight)
    ?? positiveInteger(candidate.naturalHeight)
  const depth = positiveInteger(candidate.depth)
  if (width !== null || height !== null || depth !== null) return { width, height, depth }
  if ('image' in candidate) return dimensionsFromValue(candidate.image, seen)
  return { width: null, height: null, depth: null }
}

function textureMips(
  texture: THREE.Texture,
  base: Dimensions,
  faces: number,
  storage: StorageFormat | null,
  unknowns: string[],
): { source: ThreeTextureMipSource; mips: ThreeTextureMipEvidence[] } {
  const flags = texture as THREE.Texture & TextureFlags
  const explicit = Array.isArray(texture.mipmaps) ? texture.mipmaps as MipLike[] : []

  if (flags.isCompressedCubeTexture === true && Array.isArray(texture.image)) {
    const faceMips = texture.image.map((face) => {
      const value = face as MipLike
      return Array.isArray(value.mipmaps) ? value.mipmaps as MipLike[] : []
    })
    const levelCount = faceMips[0]?.length ?? 0
    if (levelCount > 0 && faceMips.every((entries) => entries.length === levelCount)) {
      const mips: ThreeTextureMipEvidence[] = []
      for (let level = 0; level < levelCount; level += 1) {
        const dimensions = faceMips.map((entries) => dimensionsFromValue(entries[level]))
        const first = dimensions[0]!
        const consistent = first.width !== null && first.height !== null && dimensions.every((entry) =>
          entry.width === first.width && entry.height === first.height)
        mips.push(mipEvidence(
          level,
          consistent ? first.width : null,
          consistent ? first.height : null,
          1,
          faces,
          storage,
        ))
      }
      if (mips.some((mip) => mip.width === null)) {
        unknowns.push('compressed cube mip dimensions are missing or inconsistent')
      }
      return { source: 'explicit', mips }
    }
  }

  // Three's uncompressed cube representation keeps level zero in image[6] and
  // only the additional levels in mipmaps[].image[6].
  if (flags.isCubeTexture === true && explicit.length > 0) {
    const mips = [mipEvidence(0, base.width, base.height, base.depth, faces, storage)]
    explicit.forEach((mip, index) => {
      const dimensions = cubeLevelDimensions(mip)
      mips.push(mipEvidence(
        index + 1,
        dimensions.width,
        dimensions.height,
        1,
        faces,
        storage,
      ))
    })
    if (mips.some((mip) => mip.width === null || mip.height === null)) {
      unknowns.push('cube mip face dimensions are missing or inconsistent')
    }
    return { source: 'explicit', mips }
  }

  // WebGL texStorage3D derives immutable mip dimensions from the base image.
  // DataArray depth stays constant; Data3D depth halves with each level.
  if ((flags.isDataArrayTexture === true || flags.isData3DTexture === true) &&
      explicit.length > 0) {
    const mips: ThreeTextureMipEvidence[] = []
    for (let level = 0; level < explicit.length; level += 1) {
      const divisor = 2 ** level
      mips.push(mipEvidence(
        level,
        base.width === null ? null : Math.max(1, Math.floor(base.width / divisor)),
        base.height === null ? null : Math.max(1, Math.floor(base.height / divisor)),
        base.depth === null
          ? null
          : flags.isData3DTexture === true
            ? Math.max(1, Math.floor(base.depth / divisor))
            : base.depth,
        faces,
        storage,
      ))
    }
    return { source: 'explicit', mips }
  }

  if (explicit.length > 0) {
    const mips = explicit.map((mip, level) => {
      const dimensions = dimensionsFromValue(mip)
      const depth = dimensions.depth ?? explicitDepth(flags, base.depth)
      return mipEvidence(level, dimensions.width, dimensions.height, depth, faces, storage)
    })
    return { source: 'explicit', mips }
  }

  const framebufferMipChain = flags.isFramebufferTexture === true &&
    texture.minFilter !== THREE.NearestFilter && texture.minFilter !== THREE.LinearFilter
  if (texture.generateMipmaps === true || framebufferMipChain) {
    if (base.width === null || base.height === null || base.depth === null) {
      return {
        source: 'unknown',
        mips: [mipEvidence(0, base.width, base.height, base.depth, faces, storage)],
      }
    }
    const levels = Math.floor(Math.log2(Math.max(base.width, base.height))) + 1
    const mips: ThreeTextureMipEvidence[] = []
    for (let level = 0; level < levels; level += 1) {
      const divisor = 2 ** level
      const depth = flags.isData3DTexture === true
        ? Math.max(1, Math.floor(base.depth / divisor))
        : base.depth
      mips.push(mipEvidence(
        level,
        Math.max(1, Math.floor(base.width / divisor)),
        Math.max(1, Math.floor(base.height / divisor)),
        depth,
        faces,
        storage,
      ))
    }
    return { source: 'generated', mips }
  }

  return {
    source: base.width === null || base.height === null ? 'unknown' : 'base',
    mips: [mipEvidence(0, base.width, base.height, base.depth, faces, storage)],
  }
}

function cubeLevelDimensions(value: unknown): Dimensions {
  if (!value || typeof value !== 'object') return { width: null, height: null, depth: 1 }
  const candidate = value as { image?: unknown }
  const faceValues = Array.isArray(value)
    ? value
    : Array.isArray(candidate.image)
      ? candidate.image
      : null
  if (!faceValues || faceValues.length !== 6) return { width: null, height: null, depth: 1 }
  const dimensions = faceValues.map((face) => dimensionsFromValue(face))
  const first = dimensions[0]!
  const consistent = first.width !== null && first.height !== null && dimensions.every((entry) =>
    entry.width === first.width && entry.height === first.height)
  return {
    width: consistent ? first.width : null,
    height: consistent ? first.height : null,
    depth: 1,
  }
}

function explicitDepth(flags: TextureFlags, baseDepth: number | null): number | null {
  if (flags.isDataArrayTexture || flags.isCompressedArrayTexture || flags.isData3DTexture) return baseDepth
  return 1
}

function mipEvidence(
  level: number,
  width: number | null,
  height: number | null,
  depth: number | null,
  faces: number | null,
  storage: StorageFormat | null,
): ThreeTextureMipEvidence {
  return {
    level,
    width,
    height,
    depth,
    faces,
    estimatedResidentBytes: estimateBytes(width, height, depth, faces, storage),
  }
}

function estimateBytes(
  width: number | null,
  height: number | null,
  depth: number | null,
  faces: number | null,
  storage: StorageFormat | null,
): number | null {
  if (!storage || width === null || height === null || depth === null || faces === null) return null
  if (storage.bytesPerTexel !== undefined) return width * height * depth * faces * storage.bytesPerTexel
  if (storage.blockWidth === undefined || storage.blockHeight === undefined ||
      storage.bytesPerBlock === undefined) return null
  const blocksX = Math.max(storage.minimumBlocksX ?? 1, Math.ceil(width / storage.blockWidth))
  const blocksY = Math.max(storage.minimumBlocksY ?? 1, Math.ceil(height / storage.blockHeight))
  return blocksX * blocksY * storage.bytesPerBlock * depth * faces
}

function buildWebGLAllocations(
  analyzed: Array<{ texture: THREE.Texture; evidence: ThreeTextureEvidence }>,
): ThreeWebGLTextureAllocationEvidence[] {
  interface AllocationBuilder {
    id: string
    entries: Array<{ texture: THREE.Texture; evidence: ThreeTextureEvidence }>
  }

  const sourceGroups = new WeakMap<object, Map<string, AllocationBuilder>>()
  const builders: AllocationBuilder[] = []
  const create = (): AllocationBuilder => {
    const builder = { id: `webgl-texture-${builders.length + 1}`, entries: [] }
    builders.push(builder)
    return builder
  }

  for (const entry of analyzed) {
    const flags = entry.texture as THREE.Texture & TextureFlags
    const source = entry.texture.source as unknown
    let builder: AllocationBuilder

    // Render-target and externally-owned textures do not use WebGLTextures'
    // ordinary Source/cache-key allocation path.
    if (flags.isRenderTargetTexture === true || flags.isExternalTexture === true ||
        !source || typeof source !== 'object') {
      builder = create()
    } else {
      let byCacheKey = sourceGroups.get(source)
      if (!byCacheKey) {
        byCacheKey = new Map<string, AllocationBuilder>()
        sourceGroups.set(source, byCacheKey)
      }
      const cacheKey = threeWebGLTextureCacheKey(entry.texture)
      builder = byCacheKey.get(cacheKey) ?? create()
      byCacheKey.set(cacheKey, builder)
    }

    builder.entries.push(entry)
    entry.evidence.webglAllocationId = builder.id
  }

  return builders.map((builder) => {
    const evidence = builder.entries.map((entry) => entry.evidence)
    const first = evidence[0]!
    const residentSignature = JSON.stringify({
      targetFamily: first.targetFamily,
      targetLabel: first.targetLabel,
      resident: first.resident,
    })
    const consistent = evidence.every((entry) => JSON.stringify({
      targetFamily: entry.targetFamily,
      targetLabel: entry.targetLabel,
      resident: entry.resident,
    }) === residentSignature)
    const unknowns = new Set(evidence.flatMap((entry) => entry.unknowns))
    if (!consistent) {
      unknowns.add('textures sharing this WebGL allocation expose conflicting storage evidence')
    }
    return {
      id: builder.id,
      textureUuids: evidence.map((entry) => entry.uuid),
      textureNames: evidence.map((entry) => entry.name),
      textureCount: evidence.length,
      targetFamily: consistent ? first.targetFamily : 'unknown',
      targetLabel: consistent ? first.targetLabel : null,
      resident: consistent
        ? { ...first.resident }
        : {
            knownBytes: 0,
            totalBytes: null,
            complete: false,
            unknownMipCount: Math.max(...evidence.map((entry) => entry.resident.unknownMipCount), 1),
            scope: 'format-payload',
          },
      unknowns: [...unknowns],
    }
  })
}

/** Mirrors Three r184 WebGLTextures.getTextureCacheKey(). */
function threeWebGLTextureCacheKey(texture: THREE.Texture): string {
  const values = texture as THREE.Texture & { wrapR?: unknown }
  return [
    texture.wrapS,
    texture.wrapT,
    values.wrapR || 0,
    texture.magFilter,
    texture.minFilter,
    texture.anisotropy,
    texture.internalFormat,
    texture.format,
    texture.type,
    texture.generateMipmaps,
    texture.premultiplyAlpha,
    texture.flipY,
    texture.unpackAlignment,
    texture.colorSpace,
  ].join()
}

function summarize(
  textures: ThreeTextureEvidence[],
  webglAllocations: ThreeWebGLTextureAllocationEvidence[],
): ThreeTextureEvidenceSummary {
  const formatCounts: Record<string, number> = {}
  const formats = new Map<ThreeTextureTargetFamily, ThreeTextureFormatEvidence>()
  let knownResidentTextureCount = 0
  for (const texture of textures) {
    const formatKey = texture.formatName ?? (texture.format === null ? 'unknown' : `unknown(${texture.format})`)
    formatCounts[formatKey] = (formatCounts[formatKey] ?? 0) + 1
    if (texture.resident.complete) knownResidentTextureCount += 1
    const format = formats.get(texture.targetFamily) ?? {
      targetFamily: texture.targetFamily,
      textureCount: 0,
      webglAllocationCount: 0,
      knownResidentBytes: 0,
      unknownResidentTextureCount: 0,
      unknownResidentAllocationCount: 0,
    }
    format.textureCount += 1
    if (!texture.resident.complete) format.unknownResidentTextureCount += 1
    formats.set(texture.targetFamily, format)
  }
  let knownResidentBytes = 0
  let knownResidentAllocationCount = 0
  for (const allocation of webglAllocations) {
    knownResidentBytes += allocation.resident.knownBytes
    if (allocation.resident.complete) knownResidentAllocationCount += 1
    const format = formats.get(allocation.targetFamily) ?? {
      targetFamily: allocation.targetFamily,
      textureCount: 0,
      webglAllocationCount: 0,
      knownResidentBytes: 0,
      unknownResidentTextureCount: 0,
      unknownResidentAllocationCount: 0,
    }
    format.webglAllocationCount += 1
    format.knownResidentBytes += allocation.resident.knownBytes
    if (!allocation.resident.complete) format.unknownResidentAllocationCount += 1
    formats.set(allocation.targetFamily, format)
  }
  const unknownResidentTextureCount = textures.length - knownResidentTextureCount
  const unknownResidentAllocationCount = webglAllocations.length - knownResidentAllocationCount
  return {
    textureCount: textures.length,
    webglAllocationCount: webglAllocations.length,
    knownResidentTextureCount,
    unknownResidentTextureCount,
    knownResidentAllocationCount,
    unknownResidentAllocationCount,
    knownResidentBytes,
    unknownResidentBytes: unknownResidentAllocationCount === 0 ? 0 : null,
    totalEstimatedResidentBytes: unknownResidentAllocationCount === 0 ? knownResidentBytes : null,
    formatCounts,
    formats: [...formats.values()].sort((a, b) => a.targetFamily.localeCompare(b.targetFamily)),
  }
}

function positiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && Number.isInteger(value)
    ? value
    : null
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}
