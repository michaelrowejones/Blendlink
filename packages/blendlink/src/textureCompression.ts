import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { tmpdir } from 'node:os'
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS, KHRTextureBasisu } from '@gltf-transform/extensions'
import { getTextureColorSpace, listTextureSlots } from '@gltf-transform/functions'
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer'
import sharp from './sharpSecurity.js'
import {
  verifiedMaterialCompilationImageTextures,
  type MaterialCompilationEvidence,
} from './sceneDiagnostics.js'

export type TextureCodec = 'etc1s' | 'uastc'
export type TextureCompressionOverride = 'none' | TextureCodec

export interface TextureCompressionPolicy {
  name: string
  override?: TextureCompressionOverride
}

export interface TextureCompressionEntry {
  name: string
  slots: string[]
  codec: TextureCodec
  decision: string
  colorSpace: 'srgb' | 'linear'
  originalWidth: number
  originalHeight: number
  encodedWidth: number
  encodedHeight: number
  inputBytes: number
  outputBytes: number
  savedBytes: number
  ratio: number
  psnr: number
  maxChannelError: number
  mipLevelsVerified: number
  worstMipPsnr: number
  maxMipAlphaCoverageError: number
  meanNormalErrorDegrees?: number
  maxNormalErrorDegrees?: number
  maxMipMeanNormalErrorDegrees?: number
  /** Offline evidence for the deterministic rate-distortion search. This is
   * additive so older manifest readers can continue to consume the entry. */
  rateDistortion?: TextureRateDistortionReport
}

export type TextureSemanticProfile = 'color' | 'normal' | 'data' | 'alpha'

export interface TextureCompressionCandidateSettings {
  semanticProfile: TextureSemanticProfile
  qlevel?: number
  clevel?: number
  uastcQuality?: number
  uastcRdoLambda?: number
  zstdLevel?: number
}

export interface TextureCompressionCandidate {
  id: string
  codec: TextureCodec
  settings: TextureCompressionCandidateSettings
}

export interface TextureCompressionCandidateEvidence {
  id: string
  codec: TextureCodec
  settings: TextureCompressionCandidateSettings
  status: 'selected' | 'passed' | 'rejected'
  outputBytes?: number
  ratio?: number
  psnr?: number
  worstMipPsnr?: number
  maxChannelError?: number
  maxMipAlphaCoverageError?: number
  meanNormalErrorDegrees?: number
  maxNormalErrorDegrees?: number
  maxMipMeanNormalErrorDegrees?: number
  rejection?: string
}

export interface TextureRateDistortionReport {
  selectedCandidate: string
  candidates: TextureCompressionCandidateEvidence[]
}

export interface TextureCompressionReport {
  format: 'ktx2'
  encoder: 'KTX-Software'
  encoderVersion: string
  inputBytes: number
  outputBytes: number
  savedBytes: number
  ratio: number
  textures: TextureCompressionEntry[]
  skipped: Array<{ name: string; reason: string }>
}

export interface TextureCompressionResult {
  report: TextureCompressionReport | null
  warnings: string[]
}

interface CodecDecision {
  codec: TextureCodec
  reason: string
}

export const KTX_SOFTWARE_URL = 'https://github.com/KhronosGroup/KTX-Software/releases'

/** A deliberately small candidate set keeps builds bounded while spanning the
 * useful Basis Universal quality range. ETC1S qlevel derives its endpoint and
 * selector codebooks. UASTC uses the Khronos-recommended tighter lambda range
 * for normals and progressively more permissive ranges for data, alpha, and
 * color. Every candidate still has to pass the same semantic image gates. */
export function textureCompressionCandidateLadder(
  codec: TextureCodec,
  slots: string[],
  hasAlpha: boolean,
): TextureCompressionCandidate[] {
  const semanticProfile = textureSemanticProfile(slots, hasAlpha)
  if (codec === 'etc1s') {
    return [96, 160, 224].map((qlevel) => ({
      id: `etc1s-q${qlevel}`,
      codec,
      settings: { semanticProfile, qlevel, clevel: 2 },
    }))
  }
  const lambdas = semanticProfile === 'normal'
    ? [0.75, 0.5, 0.25]
    : semanticProfile === 'data'
      ? [1.0, 0.625, 0.25]
      : semanticProfile === 'alpha'
        ? [1.25, 0.75, 0.35]
        : [2.0, 1.0, 0.5]
  return lambdas.map((uastcRdoLambda) => ({
    id: `uastc-${semanticProfile}-l${String(uastcRdoLambda).replace('.', '_')}`,
    codec,
    settings: {
      semanticProfile,
      uastcQuality: 2,
      uastcRdoLambda,
      zstdLevel: 18,
    },
  }))
}

/** Artist-facing intent -> deterministic codec. Detail/data textures avoid
 * ETC1S because Khronos and glTF Transform both call out its artifacts on
 * normal and ORM maps; smooth opaque color can take the smaller codec. */
export function chooseTextureCodec(
  slots: string[],
  hasAlpha: boolean,
  override: TextureCompressionOverride | undefined,
  sceneKtx2: boolean,
): CodecDecision | null {
  if (override === 'none') return null
  if (override === 'etc1s') return { codec: 'etc1s', reason: 'artist chose Compact' }
  if (override === 'uastc') return { codec: 'uastc', reason: 'artist chose High Fidelity' }
  if (!sceneKtx2 || slots.length === 0) return null
  const detailSlot = slots.some((slot) => /normal|occlusion|metallic|roughness/i.test(slot))
  if (detailSlot) return { codec: 'uastc', reason: 'detail/data texture uses High Fidelity automatically' }
  if (hasAlpha) return { codec: 'uastc', reason: 'alpha texture uses High Fidelity automatically' }
  return { codec: 'etc1s', reason: 'opaque color texture uses Compact automatically' }
}

/** Semantic KTX2 compilation behind one seam: policy, local tool discovery,
 * encoding, glTF validation, decoded-image fidelity gates, extension wiring,
 * and atomic replacement. The caller only supplies artist intent. */
export async function compressTexturesKtx2(
  glbPath: string,
  options: {
    sceneKtx2: boolean
    policies?: TextureCompressionPolicy[]
    protectedTextureNames?: string[]
    materialCompilation?: MaterialCompilationEvidence
    executable?: string
  },
): Promise<TextureCompressionResult> {
  await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready])
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({
      'meshopt.decoder': MeshoptDecoder,
      'meshopt.encoder': MeshoptEncoder,
    })
  const originalGlb = readFileSync(glbPath)
  const document = await io.readBinary(new Uint8Array(originalGlb))
  const textures = document.getRoot().listTextures()
  const policies = new Map(
    (options.policies ?? []).map((policy) => [textureKey(policy.name), policy.override]),
  )
  const matchedPolicies = new Set<string>()
  const protectedCompilationTextures = new Set(
    options.materialCompilation
      ? verifiedMaterialCompilationImageTextures(document, options.materialCompilation)
      : [],
  )
  const protectedNames = new Set(
    (options.protectedTextureNames ?? []).flatMap((name) => {
      const file = basename(name)
      return [textureKey(name), textureKey(file)]
    }),
  )
  const candidates: Array<{
    texture: (typeof textures)[number]
    name: string
    slots: string[]
    image: Uint8Array
    decision: CodecDecision
    colorSpace: 'srgb' | 'linear'
    hasAlpha: boolean
  }> = []
  const skipped: TextureCompressionReport['skipped'] = []
  const warnings: string[] = []

  for (const [index, texture] of textures.entries()) {
    const name = texture.getName() || texture.getURI() || `Texture ${index + 1}`
    const identityKeys = [name, texture.getURI(), basename(texture.getURI())]
      .filter(Boolean)
      .map(textureKey)
    if (protectedCompilationTextures.has(texture)) {
      const reason =
        'selected-field compiler attestation requires its exact original image bytes and MIME'
      skipped.push({
        name,
        reason,
      })
      warnings.push(
        `Texture "${name}" remains ${texture.getMimeType() || 'in its original format'} because ${reason}; ` +
          'scene-wide GPU compression intentionally excludes this compiler-owned carrier.',
      )
      continue
    }
    if (identityKeys.some((key) => protectedNames.has(key))
        || /BLENDLINK_BAKED|\.state\.[^.]+(?:\.[^.]+)?$/i.test(name)) {
      skipped.push({ name, reason: 'baked lighting atlas keeps its constant-background PNG contract' })
      continue
    }
    const image = texture.getImage()
    if (!image) {
      skipped.push({ name, reason: 'image bytes are not embedded in the GLB' })
      continue
    }
    if (texture.getMimeType() === 'image/ktx2') {
      skipped.push({ name, reason: 'already KTX2' })
      continue
    }
    let metadata: sharp.Metadata
    try {
      metadata = await sharp(image).metadata()
    } catch (error) {
      const override = policies.get(textureKey(name))
      if (override && override !== 'none') {
        throw new Error(`Texture "${name}" was explicitly selected for GPU compression but cannot be decoded: ${errorMessage(error)}`)
      }
      warnings.push(`Texture "${name}" cannot be decoded by the local image pipeline; semantic compression skipped it.`)
      continue
    }
    const slots = listTextureSlots(texture)
    const policyKey = [textureKey(name), textureKey(texture.getURI())]
      .find((key) => policies.has(key))
    if (policyKey) matchedPolicies.add(policyKey)
    const override = policyKey ? policies.get(policyKey) : undefined
    const decision = chooseTextureCodec(slots, metadata.hasAlpha ?? false, override, options.sceneKtx2)
    if (!decision) {
      skipped.push({
        name,
        reason: override === 'none'
          ? 'artist chose Uncompressed'
          : slots.length === 0
            ? 'not connected to a material texture slot'
            : 'scene GPU texture compression is off',
      })
      continue
    }
    const width = metadata.width ?? 0
    const height = metadata.height ?? 0
    try {
      textureEncodingDimensions(width, height)
    } catch (error) {
      const reason =
        `kept the original ${width || '?'}x${height || '?'} image because ` +
        'KHR_texture_basisu requires both dimensions to be multiples of 4'
      skipped.push({ name, reason })
      warnings.push(`Texture "${name}" ${reason}.`)
      continue
    }
    candidates.push({
      texture,
      name,
      slots,
      image,
      decision,
      colorSpace: getTextureColorSpace(texture) === 'srgb' ? 'srgb' : 'linear',
      hasAlpha: metadata.hasAlpha ?? false,
    })
  }

  for (const policy of options.policies ?? []) {
    if (policy.override !== 'none' && !matchedPolicies.has(textureKey(policy.name))) {
      warnings.push(
        `Texture compression override for "${policy.name}" did not match an exported material image; ` +
          'the image was not compressed.',
      )
    }
  }

  if (candidates.length === 0) return { report: null, warnings }
  const tool = resolveKtxTool(options.executable)
  const temp = mkdtempSync(join(tmpdir(), 'blendlink-ktx-'))
  const entries: TextureCompressionEntry[] = []
  try {
    for (const [index, candidate] of candidates.entries()) {
      const safe = candidate.name.replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 48) || `texture_${index}`
      const sourcePath = join(temp, `${index}-${safe}.png`)
      const source = sharp(candidate.image)
      const metadata = await source.metadata()
      const originalWidth = metadata.width ?? 0
      const originalHeight = metadata.height ?? 0
      if (!originalWidth || !originalHeight) {
        throw new Error(`Texture "${candidate.name}" has no decodable dimensions.`)
      }
      // KHR_texture_basisu requires multiples of four. Candidates that do not
      // satisfy that portable contract were already kept in their original
      // format; conforming images retain their exact authored dimensions.
      const { width: encodedWidth, height: encodedHeight } = textureEncodingDimensions(
        originalWidth, originalHeight,
      )
      await sharp(candidate.image).png({ compressionLevel: 9 }).toFile(sourcePath)
      const sourceMeta = await sharp(sourcePath).metadata()
      const channels = Math.max(1, Math.min(4, sourceMeta.channels ?? (candidate.hasAlpha ? 4 : 3)))
      const format = ktxFormat(channels, candidate.colorSpace)
      const rateCandidates = textureCompressionCandidateLadder(
        candidate.decision.codec,
        candidate.slots,
        candidate.hasAlpha,
      )
      const evidence: TextureCompressionCandidateEvidence[] = []
      const passing: Array<{
        rateCandidate: TextureCompressionCandidate
        ladderIndex: number
        output: Uint8Array
        fidelity: Awaited<ReturnType<typeof compareImages>>
        mipFidelity: Awaited<ReturnType<typeof verifyMipChain>>
      }> = []
      for (const [ladderIndex, rateCandidate] of rateCandidates.entries()) {
        const stem = `${index}-${safe}-${rateCandidate.id}`
        const outputPath = join(temp, `${stem}.ktx2`)
        const decodedPath = join(temp, `${stem}.decoded.png`)
        let output: Uint8Array | undefined
        let fidelity: Awaited<ReturnType<typeof compareImages>> | undefined
        try {
          const args = createArgs(
            tool,
            rateCandidate,
            candidate.colorSpace,
            format,
            candidate.slots,
            sourcePath,
            outputPath,
          )
          runKtx(
            tool.executable,
            args,
            `encoding texture "${candidate.name}" candidate ${rateCandidate.id}`,
          )
          runKtx(
            tool.executable,
            ['validate', '--gltf-basisu', outputPath],
            `validating texture "${candidate.name}" candidate ${rateCandidate.id}`,
          )
          output = new Uint8Array(readFileSync(outputPath))
          runKtx(
            tool.executable,
            ['extract', '--transcode', 'rgba8', '--level', '0', outputPath, decodedPath],
            `decoding texture "${candidate.name}" candidate ${rateCandidate.id} for fidelity verification`,
          )
          fidelity = await compareImages(sourcePath, decodedPath, candidate.slots)
          assertFullResolutionFidelity(
            candidate.name,
            candidate.decision.codec,
            candidate.hasAlpha,
            fidelity,
          )
          // Mip extraction is the expensive half of verification, so only run
          // it after the candidate has passed the full-resolution gates.
          const mipFidelity = await verifyMipChain(
            tool.executable,
            outputPath,
            sourcePath,
            originalWidth,
            originalHeight,
            candidate.slots,
            candidate.decision.codec,
            candidate.hasAlpha,
            temp,
            stem,
            candidate.name,
          )
          passing.push({ rateCandidate, ladderIndex, output, fidelity, mipFidelity })
          evidence.push({
            id: rateCandidate.id,
            codec: rateCandidate.codec,
            settings: rateCandidate.settings,
            status: 'passed',
            outputBytes: output.byteLength,
            ratio: output.byteLength / Math.max(1, candidate.image.byteLength),
            ...fidelityEvidence(fidelity, mipFidelity),
          })
        } catch (error) {
          evidence.push({
            id: rateCandidate.id,
            codec: rateCandidate.codec,
            settings: rateCandidate.settings,
            status: 'rejected',
            ...(output
              ? {
                  outputBytes: output.byteLength,
                  ratio: output.byteLength / Math.max(1, candidate.image.byteLength),
                }
              : {}),
            ...(fidelity ? { psnr: fidelity.psnr, maxChannelError: fidelity.maxChannelError } : {}),
            rejection: errorMessage(error),
          })
        }
      }
      const selected = passing.sort((left, right) =>
        left.output.byteLength - right.output.byteLength || left.ladderIndex - right.ladderIndex,
      )[0]
      if (!selected) {
        const failures = evidence
          .map((attempt) => `${attempt.id}: ${attempt.rejection ?? 'failed without a diagnostic'}`)
          .join(' | ')
        throw new Error(
          `Texture "${candidate.name}" has no ${candidate.decision.codec.toUpperCase()} ` +
            `rate-distortion candidate that passes every semantic fidelity gate. ${failures}`,
        )
      }
      const selectedEvidence = evidence.find((attempt) => attempt.id === selected.rateCandidate.id)
      if (!selectedEvidence || selectedEvidence.status !== 'passed') {
        throw new Error(`Internal KTX rate-distortion report mismatch for texture "${candidate.name}".`)
      }
      selectedEvidence.status = 'selected'
      const { output, fidelity, mipFidelity } = selected
      candidate.texture
        .setImage(output)
        .setMimeType('image/ktx2')
        .setURI(replaceExtension(candidate.texture.getURI(), 'ktx2'))
      entries.push({
        name: candidate.name,
        slots: candidate.slots,
        codec: candidate.decision.codec,
        decision: candidate.decision.reason,
        colorSpace: candidate.colorSpace,
        originalWidth,
        originalHeight,
        encodedWidth,
        encodedHeight,
        inputBytes: candidate.image.byteLength,
        outputBytes: output.byteLength,
        savedBytes: candidate.image.byteLength - output.byteLength,
        ratio: output.byteLength / Math.max(1, candidate.image.byteLength),
        psnr: fidelity.psnr,
        maxChannelError: fidelity.maxChannelError,
        mipLevelsVerified: mipFidelity.levels,
        worstMipPsnr: mipFidelity.worstPsnr,
        maxMipAlphaCoverageError: mipFidelity.maxAlphaCoverageError,
        ...(fidelity.meanNormalErrorDegrees !== undefined
          ? {
              meanNormalErrorDegrees: fidelity.meanNormalErrorDegrees,
              maxNormalErrorDegrees: fidelity.maxNormalErrorDegrees,
              maxMipMeanNormalErrorDegrees: mipFidelity.maxMeanNormalErrorDegrees,
            }
          : {}),
        rateDistortion: {
          selectedCandidate: selected.rateCandidate.id,
          candidates: evidence,
        },
      })
    }

    document.createExtension(KHRTextureBasisu).setRequired(true)
    const outputGlb = await io.writeBinary(document)
    const staging = `${glbPath}.ktx2-${process.pid}`
    writeFileSync(staging, outputGlb)
    // Read what will ship before replacing the source artifact.
    await io.readBinary(outputGlb)
    renameSync(staging, glbPath)
  } finally {
    removeOwnedTemp(temp)
  }

  const inputBytes = entries.reduce((sum, entry) => sum + entry.inputBytes, 0)
  const outputBytes = entries.reduce((sum, entry) => sum + entry.outputBytes, 0)
  return {
    report: {
      format: 'ktx2',
      encoder: 'KTX-Software',
      encoderVersion: tool.version,
      inputBytes,
      outputBytes,
      savedBytes: inputBytes - outputBytes,
      ratio: outputBytes / Math.max(1, inputBytes),
      textures: entries,
      skipped,
    },
    warnings,
  }
}

interface KtxCreateDialect {
  transferOption: '--assign-tf' | '--assign-oetf'
  assignTexcoordOrigin: boolean
  normalize: boolean
}

interface KtxTool extends KtxCreateDialect {
  executable: string
  version: string
}

/** KTX-Software 4.4 renamed the transfer flag and added explicit orientation.
 * Inspect capabilities instead of pinning artists to one installed minor. */
export function ktxCreateDialect(help: string): KtxCreateDialect {
  const transferOption = /(?:^|\s)--assign-tf(?:\s|<)/m.test(help)
    ? '--assign-tf' as const
    : /(?:^|\s)--assign-oetf(?:\s|<)/m.test(help)
      ? '--assign-oetf' as const
      : null
  if (!transferOption) {
    throw new Error('KTX create help exposes neither --assign-tf nor --assign-oetf')
  }
  return {
    transferOption,
    assignTexcoordOrigin: /(?:^|\s)--assign-texcoord-origin(?:\s|<)/m.test(help),
    normalize: /(?:^|\s)--normalize(?:\s|$)/m.test(help),
  }
}

export function findKtxTool(explicit?: string): KtxTool | null {
  const candidates = [
    explicit,
    process.env.BLENDLINK_KTX_PATH,
    ...(process.platform === 'win32'
      ? [
          join(process.env.ProgramFiles ?? 'C:\\Program Files', 'KTX-Software', 'bin', 'ktx.exe'),
          join(process.env.LOCALAPPDATA ?? '', 'KTX-Software', 'bin', 'ktx.exe'),
        ]
      : []),
    'ktx',
  ].filter((candidate): candidate is string => Boolean(candidate))
  for (const candidate of candidates) {
    const executable = existsSync(candidate) && statSync(candidate).isDirectory()
      ? join(candidate, process.platform === 'win32' ? 'ktx.exe' : 'ktx')
      : candidate
    const result = spawnSync(executable, ['--version'], { encoding: 'utf8', windowsHide: true })
    if (!result.error && result.status === 0) {
      const help = spawnSync(executable, ['create', '--help'], {
        encoding: 'utf8', windowsHide: true, maxBuffer: 8 * 1024 * 1024,
      })
      if (help.error || help.status !== 0) continue
      let dialect: KtxCreateDialect
      try {
        dialect = ktxCreateDialect(`${help.stdout ?? ''}\n${help.stderr ?? ''}`)
      } catch {
        continue
      }
      return {
        executable,
        version: `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim().split(/\r?\n/)[0] || 'unknown',
        ...dialect,
      }
    }
  }
  return null
}

function resolveKtxTool(explicit?: string): KtxTool {
  const tool = findKtxTool(explicit)
  if (tool) return tool
  throw new Error(
    'GPU Texture Compression is enabled, but the free Khronos KTX tools were not found. ' +
      `Install KTX-Software from ${KTX_SOFTWARE_URL}, restart Blender, then run \`blendlink doctor\`. ` +
      'A custom executable may be set with BLENDLINK_KTX_PATH.',
  )
}

function createArgs(
  tool: KtxCreateDialect,
  candidate: TextureCompressionCandidate,
  colorSpace: 'srgb' | 'linear',
  format: string,
  slots: string[],
  sourcePath: string,
  outputPath: string,
): string[] {
  const common = [
    'create',
    '--format', format,
    '--encode', candidate.codec === 'etc1s' ? 'basis-lz' : 'uastc',
    '--generate-mipmap',
    '--mipmap-filter', 'lanczos3',
    '--mipmap-wrap', 'clamp',
    tool.transferOption, colorSpace,
    '--threads', '1',
  ]
  if (tool.assignTexcoordOrigin) {
    common.push('--assign-texcoord-origin', 'top-left')
  }
  common.push('--assign-primaries', colorSpace === 'srgb' ? 'bt709' : 'none')
  const normal = slots.some((slot) => /normal/i.test(slot))
  if (normal && tool.normalize) common.push('--normalize')
  if (candidate.codec === 'etc1s') {
    common.push(
      '--qlevel', String(candidate.settings.qlevel),
      '--clevel', String(candidate.settings.clevel),
    )
  }
  else {
    common.push(
      '--uastc-quality', String(candidate.settings.uastcQuality),
      '--uastc-rdo',
      '--uastc-rdo-l', String(candidate.settings.uastcRdoLambda),
      '--zstd', String(candidate.settings.zstdLevel),
    )
  }
  return [...common, sourcePath, outputPath]
}

function runKtx(executable: string, args: string[], action: string): void {
  const result = spawnSync(executable, args, {
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
  })
  if (result.error || result.status !== 0) {
    const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim()
    throw new Error(
      `KTX-Software failed while ${action}${result.status === null ? '' : ` (exit ${result.status})`}: ` +
        `${result.error?.message ?? (output || 'no diagnostic output')}`,
    )
  }
}

function textureSemanticProfile(slots: string[], hasAlpha: boolean): TextureSemanticProfile {
  if (slots.some((slot) => /normal/i.test(slot))) return 'normal'
  if (slots.some((slot) => /occlusion|metallic|roughness/i.test(slot))) return 'data'
  if (hasAlpha) return 'alpha'
  return 'color'
}

function assertFullResolutionFidelity(
  textureName: string,
  codec: TextureCodec,
  hasAlpha: boolean,
  fidelity: Awaited<ReturnType<typeof compareImages>>,
): void {
  const minimumPsnr = codec === 'uastc' ? 35 : 24
  if (fidelity.psnr < minimumPsnr) {
    throw new Error(
      `Texture "${textureName}" failed the visual fidelity gate: ` +
        `${fidelity.psnr.toFixed(1)} dB PSNR is below ${minimumPsnr} dB for ${codec.toUpperCase()}. ` +
        `${codec === 'etc1s' ? 'Choose High Fidelity for this image.' : 'Keep this image Uncompressed.'}`,
    )
  }
  if (hasAlpha && fidelity.maxAlphaError > 32) {
    throw new Error(
      `Texture "${textureName}" failed the alpha fidelity gate: maximum alpha error ` +
        `${fidelity.maxAlphaError}/255. Keep this image Uncompressed.`,
    )
  }
  if (hasAlpha && fidelity.alphaCoverageError > 0.02) {
    throw new Error(
      `Texture "${textureName}" failed the alpha-coverage gate: ` +
        `${(fidelity.alphaCoverageError * 100).toFixed(2)}% of pixels crossed the coverage threshold. ` +
        'Keep this image Uncompressed.',
    )
  }
  if ((fidelity.meanNormalErrorDegrees ?? 0) > 5 || (fidelity.maxNormalErrorDegrees ?? 0) > 45) {
    throw new Error(
      `Texture "${textureName}" failed the normal-map fidelity gate: ` +
        `mean ${(fidelity.meanNormalErrorDegrees ?? 0).toFixed(2)} degrees, ` +
        `maximum ${(fidelity.maxNormalErrorDegrees ?? 0).toFixed(2)} degrees. ` +
        `${codec === 'etc1s' ? 'Choose High Fidelity for this image.' : 'Keep this image Uncompressed.'}`,
    )
  }
}

function fidelityEvidence(
  fidelity: Awaited<ReturnType<typeof compareImages>>,
  mipFidelity: Awaited<ReturnType<typeof verifyMipChain>>,
): Pick<
  TextureCompressionCandidateEvidence,
  | 'psnr'
  | 'worstMipPsnr'
  | 'maxChannelError'
  | 'maxMipAlphaCoverageError'
  | 'meanNormalErrorDegrees'
  | 'maxNormalErrorDegrees'
  | 'maxMipMeanNormalErrorDegrees'
> {
  return {
    psnr: fidelity.psnr,
    worstMipPsnr: mipFidelity.worstPsnr,
    maxChannelError: fidelity.maxChannelError,
    maxMipAlphaCoverageError: mipFidelity.maxAlphaCoverageError,
    meanNormalErrorDegrees: fidelity.meanNormalErrorDegrees,
    maxNormalErrorDegrees: fidelity.maxNormalErrorDegrees,
    maxMipMeanNormalErrorDegrees: mipFidelity.maxMeanNormalErrorDegrees,
  }
}

async function compareImages(sourcePath: string, decodedPath: string, slots: string[]): Promise<{
  psnr: number
  rgbPsnr: number
  visibleRgbPsnr: number
  maxChannelError: number
  maxAlphaError: number
  alphaCoverageError: number
  meanNormalErrorDegrees?: number
  maxNormalErrorDegrees?: number
}> {
  const [source, decoded] = await Promise.all([
    sharp(sourcePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(decodedPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
  ])
  if (source.info.width !== decoded.info.width || source.info.height !== decoded.info.height) {
    throw new Error(
      `KTX fidelity verification changed dimensions from ${source.info.width}x${source.info.height} ` +
        `to ${decoded.info.width}x${decoded.info.height}.`,
    )
  }
  let squared = 0
  let rgbSquared = 0
  let visibleRgbSquared = 0
  let visibleRgbSamples = 0
  let maxChannelError = 0
  let maxAlphaError = 0
  let normalSum = 0
  let normalMax = 0
  let sourceCovered = 0
  let decodedCovered = 0
  const normal = slots.some((slot) => /normal/i.test(slot))
  const pixels = source.info.width * source.info.height
  for (let offset = 0; offset < source.data.length; offset += 4) {
    const sourceVisible = source.data[offset + 3]! >= 128
    for (let channel = 0; channel < 4; channel += 1) {
      const error = Math.abs(source.data[offset + channel]! - decoded.data[offset + channel]!)
      squared += error * error
      if (channel < 3) rgbSquared += error * error
      if (channel < 3 && sourceVisible) {
        visibleRgbSquared += error * error
        visibleRgbSamples += 1
      }
      maxChannelError = Math.max(maxChannelError, error)
      if (channel === 3) maxAlphaError = Math.max(maxAlphaError, error)
    }
    if (normal) {
      const a = normalVector(source.data, offset)
      const b = normalVector(decoded.data, offset)
      const dot = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))
      const degrees = Math.acos(dot) * 180 / Math.PI
      normalSum += degrees
      normalMax = Math.max(normalMax, degrees)
    }
    if (source.data[offset + 3]! >= 128) sourceCovered += 1
    if (decoded.data[offset + 3]! >= 128) decodedCovered += 1
  }
  const mse = squared / Math.max(1, source.data.length)
  const psnr = mse === 0 ? 99 : 10 * Math.log10((255 * 255) / mse)
  const rgbMse = rgbSquared / Math.max(1, pixels * 3)
  const rgbPsnr = rgbMse === 0 ? 99 : 10 * Math.log10((255 * 255) / rgbMse)
  const visibleRgbMse = visibleRgbSquared / Math.max(1, visibleRgbSamples)
  const visibleRgbPsnr = visibleRgbMse === 0 ? 99 : 10 * Math.log10((255 * 255) / visibleRgbMse)
  return {
    psnr,
    rgbPsnr,
    visibleRgbPsnr,
    maxChannelError,
    maxAlphaError,
    alphaCoverageError: Math.abs(sourceCovered - decodedCovered) / Math.max(1, pixels),
    ...(normal
      ? { meanNormalErrorDegrees: normalSum / Math.max(1, pixels), maxNormalErrorDegrees: normalMax }
      : {}),
  }
}

async function verifyMipChain(
  executable: string,
  ktxPath: string,
  sourcePath: string,
  width: number,
  height: number,
  slots: string[],
  codec: TextureCodec,
  hasAlpha: boolean,
  directory: string,
  stem: string,
  textureName: string,
): Promise<{
  levels: number
  worstPsnr: number
  maxAlphaCoverageError: number
  maxMeanNormalErrorDegrees?: number
}> {
  const levels = Math.floor(Math.log2(Math.max(width, height))) + 1
  let worstPsnr = 99
  let maxAlphaCoverageError = 0
  let maxMeanNormalErrorDegrees: number | undefined
  for (let level = 1; level < levels; level += 1) {
    const levelWidth = Math.max(1, Math.floor(width / (2 ** level)))
    const levelHeight = Math.max(1, Math.floor(height / (2 ** level)))
    const expectedPath = join(directory, `${stem}.expected-mip-${level}.png`)
    const decodedPath = join(directory, `${stem}.decoded-mip-${level}.png`)
    await sharp(sourcePath)
      .resize(levelWidth, levelHeight, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
      .png({ compressionLevel: 9 })
      .toFile(expectedPath)
    runKtx(
      executable,
      ['extract', '--transcode', 'rgba8', '--level', String(level), ktxPath, decodedPath],
      `decoding mip level ${level} for fidelity verification`,
    )
    const fidelity = await compareImages(expectedPath, decodedPath, slots)
    // Independent mip generators legitimately choose different edge-alpha
    // filters. For alpha textures, gate RGB reconstruction plus measured
    // coverage instead of treating every antialiased edge byte as color loss.
    const qualityPsnr = hasAlpha ? fidelity.visibleRgbPsnr : fidelity.psnr
    worstPsnr = Math.min(worstPsnr, qualityPsnr)
    maxAlphaCoverageError = Math.max(maxAlphaCoverageError, fidelity.alphaCoverageError)
    if (fidelity.meanNormalErrorDegrees !== undefined) {
      maxMeanNormalErrorDegrees = Math.max(
        maxMeanNormalErrorDegrees ?? 0,
        fidelity.meanNormalErrorDegrees,
      )
    }
    const minimumPsnr = codec === 'uastc' ? 24 : 18
    if (qualityPsnr < minimumPsnr) {
      throw new Error(
        `KTX texture "${textureName}" mip ${level} failed fidelity: ` +
          `${qualityPsnr.toFixed(1)} dB ${hasAlpha ? 'visible RGB ' : ''}PSNR is below ` +
          `${minimumPsnr} dB for ${codec.toUpperCase()}.`,
      )
    }
    const mipPixels = levelWidth * levelHeight
    // Coverage is quantized in whole texels. At a 1×1 tail, preserving a 50%
    // silhouette is mathematically impossible; allow at most one-texel drift
    // while keeping the stricter proportional gate for useful mip sizes.
    const coverageLimit = Math.max(mipPixels < 16 ? 0.35 : 0.1, 1 / mipPixels)
    if (fidelity.alphaCoverageError > coverageLimit) {
      throw new Error(
        `KTX texture "${textureName}" mip ${level} changed alpha coverage by ` +
          `${(fidelity.alphaCoverageError * 100).toFixed(1)}% (limit ${(coverageLimit * 100).toFixed(0)}%).`,
      )
    }
    if ((fidelity.meanNormalErrorDegrees ?? 0) > 15) {
      throw new Error(
        `KTX texture "${textureName}" mip ${level} changed normal direction by ` +
          `${fidelity.meanNormalErrorDegrees!.toFixed(1)} degrees on average.`,
      )
    }
  }
  return { levels, worstPsnr, maxAlphaCoverageError, maxMeanNormalErrorDegrees }
}

function normalVector(data: Buffer, offset: number): [number, number, number] {
  const x = data[offset]! / 127.5 - 1
  const y = data[offset + 1]! / 127.5 - 1
  const z = data[offset + 2]! / 127.5 - 1
  const length = Math.hypot(x, y, z) || 1
  return [x / length, y / length, z / length]
}

function ktxFormat(channels: number, colorSpace: 'srgb' | 'linear'): string {
  const count = colorSpace === 'srgb' ? Math.max(3, channels) : channels
  const channelName = ['R8', 'R8G8', 'R8G8B8', 'R8G8B8A8'][count - 1]!
  return `${channelName}_${colorSpace === 'srgb' ? 'SRGB' : 'UNORM'}`
}

export function textureEncodingDimensions(width: number, height: number): { width: number; height: number } {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error(`Texture dimensions must be positive integers; got ${width}x${height}.`)
  }
  if (width % 4 !== 0 || height % 4 !== 0) {
    throw new Error(
      `KHR_texture_basisu requires width and height to be multiples of 4; got ${width}x${height}.`,
    )
  }
  return { width, height }
}

const textureKey = (name: string) => name.toLowerCase().replace(/\.(?:png|jpe?g|webp|avif|ktx2)$/i, '')

function replaceExtension(uri: string, extension: string): string {
  if (!uri) return uri
  return uri.replace(/\.[^.\/\\]+$/, `.${extension}`)
}

function removeOwnedTemp(path: string): void {
  const resolved = realpathSync(path)
  const root = realpathSync(tmpdir())
  if (!resolved.startsWith(root + (process.platform === 'win32' ? '\\' : '/')) || !basename(resolved).startsWith('blendlink-ktx-')) {
    throw new Error(`Refusing to remove unexpected KTX temporary directory: ${resolved}`)
  }
  rmSync(resolved, { recursive: true, force: true })
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
