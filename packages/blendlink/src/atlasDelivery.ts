import { createHash } from 'node:crypto'
import {
  existsSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { basename } from 'node:path'
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS, EXTTextureWebP } from '@gltf-transform/extensions'
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer'
import sharp from './sharpSecurity.js'

export interface TextureDeliveryVariant {
  url: string
  /** PNG tiers are produced by bakelib; WebP tiers are byte-exact delivery
   * derivatives of those finalized PNGs. */
  format: 'png' | 'webp'
  width: number
  height: number
  bytes: number
  hash: string
  lossless: true
}

type WebpDeliveryVariant = TextureDeliveryVariant & { format: 'webp' }

export interface AtlasDeliveryEntry {
  name: string
  source: string
  sourceBytes: number
  variant: WebpDeliveryVariant
  savedBytes: number
  ratio: number
  embedded: boolean
}

export interface AtlasDeliveryReport {
  format: 'lossless-webp'
  encoder: 'sharp'
  inputBytes: number
  outputBytes: number
  savedBytes: number
  ratio: number
  entries: AtlasDeliveryEntry[]
  skipped: Array<{ name: string; reason: string }>
}

export interface CompiledAtlasDelivery {
  report: AtlasDeliveryReport | null
  /** Source PNG path -> verified same-resolution derivative. The source
   * remains published as the conservative fallback and incremental-bake
   * identity; generated runtime recipes may prefer this derivative. */
  variants: ReadonlyMap<string, TextureDeliveryVariant>
}

interface ExactWebp {
  bytes: Uint8Array
  width: number
  height: number
}

/** Encode a lossless WebP and prove that Sharp decodes the exact same pixel
 * bytes, dimensions, and channel count. This is a delivery transform, not a
 * bake transform: it never resizes or changes the source PNG, and the source
 * remains the bake/cache authority. */
export async function encodeExactLosslessWebp(source: Uint8Array): Promise<ExactWebp> {
  const original = await sharp(source, { failOn: 'error' })
    .raw()
    .toBuffer({ resolveWithObject: true })
  const bytes = await sharp(source, { failOn: 'error' })
    .webp({ lossless: true, effort: 6 })
    .toBuffer()
  const decoded = await sharp(bytes, { failOn: 'error' })
    .raw()
    .toBuffer({ resolveWithObject: true })
  if (
    original.info.width !== decoded.info.width
    || original.info.height !== decoded.info.height
    || original.info.channels !== decoded.info.channels
  ) {
    throw new Error(
      `lossless WebP changed decoded shape from `
      + `${original.info.width}x${original.info.height}x${original.info.channels} to `
      + `${decoded.info.width}x${decoded.info.height}x${decoded.info.channels}`,
    )
  }
  if (!original.data.equals(decoded.data)) {
    let different = 0
    for (let index = 0; index < original.data.byteLength; index += 1) {
      if (original.data[index] !== decoded.data[index]) different += 1
    }
    throw new Error(
      `lossless WebP changed ${different}/${original.data.byteLength} decoded channel bytes`,
    )
  }
  return {
    bytes: new Uint8Array(bytes),
    width: original.info.width,
    height: original.info.height,
  }
}

/** Publish verified sidecar derivatives without replacing the canonical PNGs.
 * A derivative that is not smaller is skipped loudly in the report. */
export async function compileAtlasSidecarDelivery(
  sourcePaths: readonly string[],
): Promise<CompiledAtlasDelivery> {
  const variants = new Map<string, TextureDeliveryVariant>()
  const entries: AtlasDeliveryEntry[] = []
  const skipped: AtlasDeliveryReport['skipped'] = []
  for (const sourcePath of [...new Set(sourcePaths)]) {
    if (!existsSync(sourcePath)) {
      throw new Error(`Cannot compile atlas delivery; source does not exist: ${sourcePath}`)
    }
    const source = new Uint8Array(readFileSync(sourcePath))
    let encoded: ExactWebp
    try {
      encoded = await encodeExactLosslessWebp(source)
    } catch (error) {
      throw new Error(
        `Could not prove an exact lossless WebP derivative for ${sourcePath}: ${errorMessage(error)}`,
      )
    }
    if (encoded.bytes.byteLength >= source.byteLength) {
      skipped.push({
        name: basename(sourcePath),
        reason: `lossless WebP would grow ${source.byteLength} bytes to ${encoded.bytes.byteLength}`,
      })
      continue
    }
    const outputPath = replacePngExtension(sourcePath, 'webp')
    atomicWrite(outputPath, encoded.bytes)
    const variant: WebpDeliveryVariant = {
      url: outputPath,
      format: 'webp',
      width: encoded.width,
      height: encoded.height,
      bytes: encoded.bytes.byteLength,
      hash: hash16(encoded.bytes),
      lossless: true,
    }
    variants.set(sourcePath, variant)
    entries.push({
      name: basename(sourcePath),
      source: sourcePath,
      sourceBytes: source.byteLength,
      variant,
      savedBytes: source.byteLength - encoded.bytes.byteLength,
      ratio: encoded.bytes.byteLength / source.byteLength,
      embedded: false,
    })
  }
  return {
    report: reportFor(entries, skipped),
    variants,
  }
}

/** Replace only protected, embedded baked PNGs with verified lossless WebP.
 * Other textures remain owned by the semantic KTX2 pipeline. The GLB is read
 * back through the registered extension before atomic replacement. */
export async function convertEmbeddedBakedAtlasesToWebp(
  glbPath: string,
  protectedTextureNames: readonly string[],
): Promise<AtlasDeliveryReport | null> {
  await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready])
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({
      'meshopt.decoder': MeshoptDecoder,
      'meshopt.encoder': MeshoptEncoder,
    })
  const document = await io.readBinary(new Uint8Array(readFileSync(glbPath)))
  const protectedKeys = new Set(protectedTextureNames.flatMap((name) => [
    textureKey(name),
    textureKey(basename(name)),
  ]))
  const entries: AtlasDeliveryEntry[] = []
  const skipped: AtlasDeliveryReport['skipped'] = []
  for (const [index, texture] of document.getRoot().listTextures().entries()) {
    const name = texture.getName() || texture.getURI() || `Texture ${index + 1}`
    const keys = [name, texture.getURI(), basename(texture.getURI())]
      .filter(Boolean)
      .map(textureKey)
    const authoredBakeMarker = /BLENDLINK_BAKED|\.state\./i.test(name)
    if (!authoredBakeMarker && !keys.some((key) => protectedKeys.has(key))) continue
    const image = texture.getImage()
    if (!image) {
      skipped.push({ name, reason: 'protected baked texture is not embedded in the GLB' })
      continue
    }
    if (texture.getMimeType() === 'image/webp') {
      skipped.push({ name, reason: 'protected baked texture is already WebP' })
      continue
    }
    if (texture.getMimeType() !== 'image/png') {
      skipped.push({ name, reason: `protected baked texture uses ${texture.getMimeType() || 'an unknown format'}` })
      continue
    }
    const encoded = await encodeExactLosslessWebp(image)
    if (encoded.bytes.byteLength >= image.byteLength) {
      skipped.push({
        name,
        reason: `lossless WebP would grow ${image.byteLength} bytes to ${encoded.bytes.byteLength}`,
      })
      continue
    }
    texture
      .setImage(encoded.bytes)
      .setMimeType('image/webp')
      .setURI(replacePngExtension(texture.getURI(), 'webp'))
    const variant: WebpDeliveryVariant = {
      url: texture.getURI() || `${name}.webp`,
      format: 'webp',
      width: encoded.width,
      height: encoded.height,
      bytes: encoded.bytes.byteLength,
      hash: hash16(encoded.bytes),
      lossless: true,
    }
    entries.push({
      name,
      source: name,
      sourceBytes: image.byteLength,
      variant,
      savedBytes: image.byteLength - encoded.bytes.byteLength,
      ratio: encoded.bytes.byteLength / image.byteLength,
      embedded: true,
    })
  }
  if (entries.length === 0) return reportFor(entries, skipped)
  document.createExtension(EXTTextureWebP).setRequired(true)
  const output = await io.writeBinary(document)
  await io.readBinary(output)
  atomicWrite(glbPath, output)
  return reportFor(entries, skipped)
}

export function mergeAtlasDeliveryReports(
  ...reports: Array<AtlasDeliveryReport | null | undefined>
): AtlasDeliveryReport | null {
  const present = reports.filter((report): report is AtlasDeliveryReport => report !== null && report !== undefined)
  if (present.length === 0) return null
  return reportFor(
    present.flatMap((report) => report.entries),
    present.flatMap((report) => report.skipped),
  )
}

function reportFor(
  entries: AtlasDeliveryEntry[],
  skipped: AtlasDeliveryReport['skipped'],
): AtlasDeliveryReport | null {
  if (entries.length === 0 && skipped.length === 0) return null
  const inputBytes = entries.reduce((sum, entry) => sum + entry.sourceBytes, 0)
  const outputBytes = entries.reduce((sum, entry) => sum + entry.variant.bytes, 0)
  return {
    format: 'lossless-webp',
    encoder: 'sharp',
    inputBytes,
    outputBytes,
    savedBytes: inputBytes - outputBytes,
    ratio: outputBytes / Math.max(1, inputBytes),
    entries,
    skipped,
  }
}

function textureKey(value: string): string {
  return value.replace(/\\/g, '/').toLowerCase()
}

function replacePngExtension(value: string, extension: string): string {
  return /\.png$/i.test(value) ? value.replace(/\.png$/i, `.${extension}`) : `${value}.${extension}`
}

function hash16(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex').slice(0, 16)
}

function atomicWrite(path: string, bytes: Uint8Array): void {
  const staging = `${path}.blendlink-${process.pid}`
  try {
    writeFileSync(staging, bytes)
    if (!existsSync(staging) || statSync(staging).size !== bytes.byteLength) {
      throw new Error(`staged derivative has ${existsSync(staging) ? statSync(staging).size : 0} bytes; expected ${bytes.byteLength}`)
    }
    renameSync(staging, path)
  } finally {
    if (existsSync(staging)) rmSync(staging, { force: true })
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
