import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import sharp from './sharpSecurity.js'

export interface VisualAuditViewport {
  width: number
  height: number
  devicePixelRatio: number
}

export interface VisualAuditComparison {
  id: string
  referenceId: string
  quality: 'preview' | 'final'
  buildCommand: string
  browser: {
    status: string
    path: string
    viewport: VisualAuditViewport
    cameraObjectId: string
    lightingState: string
    frame: number
    timeSeconds: number
    bytes?: number
    hash?: string
    error?: string
  }
  comparison: {
    status: string
    path: string
    metrics?: VisualDiffMetrics
    acceptance?: VisualAuditAcceptance
    error?: string
  }
}

export interface VisualReferenceMatrix {
  schemaVersion: 1
  kind: 'blendlink-visual-reference-matrix'
  sourceBlend: string
  sourceBlendHash?: string
  references: Array<{
    id: string
    blender: { status: string; path: string; bytes?: number }
  }>
  comparisons: VisualAuditComparison[]
  [key: string]: unknown
}

export interface VisualDiffMetrics {
  width: number
  height: number
  /** RGB is premultiplied by alpha before comparison, so invisible RGB does
   * not create noise while transparent-vs-opaque composition still fails. */
  comparisonSpace: 'premultiplied-rgba'
  /** Mean normalized absolute error across premultiplied R/G/B plus alpha. */
  meanAbsoluteError: number
  /** Normalized RMSE across premultiplied R/G/B plus alpha. */
  rootMeanSquareError: number
  /** Largest normalized premultiplied RGB or alpha channel error. */
  maxChannelError: number
  changedPixelRatio: number
  pixelThreshold: number
}

export interface VisualAuditAcceptance {
  maxMeanAbsoluteError?: number
  maxChangedPixelRatio?: number
  maxChannelError?: number
  /** A pixel is changed when any RGB channel differs by more than this 0..1 value. */
  pixelThreshold?: number
}

export interface BrowserCaptureContext {
  comparison: VisualAuditComparison
  /** Absolute source-reference path, verified to stay under the matrix root. */
  blenderReferencePath: string
  matrixRoot: string
}

export interface RunVisualReferenceAuditOptions {
  /** Called once per quality before its first capture. The website owns how
   * buildCommand is run (or whether an existing artifact already satisfies it). */
  prepareQuality?(quality: 'preview' | 'final', buildCommand: string): Promise<void>
  /** Capture the real website at the exact viewport/camera/state/frame in context. */
  captureBrowser(context: BrowserCaptureContext): Promise<Uint8Array>
  /** Optional explicit project tolerance. Without one, diffs are measured but
   * never mislabeled passed/failed by an arbitrary Blendlink threshold. */
  acceptance?: VisualAuditAcceptance
  onProgress?(completed: number, total: number, comparison: VisualAuditComparison): unknown
}

export interface VisualAuditReport {
  manifestPath: string
  captured: number
  compared: number
  accepted?: number
  rejected?: number
  comparisons: VisualAuditComparison[]
}

/**
 * Run the browser half of Blender's reference matrix through an explicit
 * website capture seam, produce real pixel diffs, and persist evidence after
 * every cell. No browser, dev server, or controls are injected by Blendlink.
 */
export async function runVisualReferenceAudit(
  manifestPath: string,
  options: RunVisualReferenceAuditOptions,
): Promise<VisualAuditReport> {
  if (!options?.captureBrowser) throw new Error('Visual audit needs captureBrowser(context).')
  const absoluteManifest = resolve(manifestPath)
  const root = dirname(absoluteManifest)
  const matrix = parseVisualReferenceMatrix(readFileSync(absoluteManifest, 'utf8'))
  validateAcceptance(options.acceptance)
  verifySourceBlend(matrix)
  const referenceById = new Map(matrix.references.map((reference) => [reference.id, reference]))
  const prepared = new Set<string>()
  const failures: string[] = []
  let captured = 0
  let compared = 0
  let accepted = 0
  let rejected = 0

  for (const [index, comparison] of matrix.comparisons.entries()) {
    const reference = referenceById.get(comparison.referenceId)
    if (!reference) {
      failures.push(`${comparison.id}: missing Blender reference ${comparison.referenceId}`)
      continue
    }
    const referencePath = safeChildPath(root, reference.blender.path)
    const browserPath = safeChildPath(root, comparison.browser.path)
    const diffPath = safeChildPath(root, comparison.comparison.path)
    let browserCaptured = false
    try {
      if (reference.blender.status !== 'captured' || !existsSync(referencePath)) {
        throw new Error(
          `Blender reference ${reference.id} is not captured at ${reference.blender.path}. ` +
            'Run Capture Blender References first.',
        )
      }
      if (!prepared.has(comparison.quality)) {
        await options.prepareQuality?.(comparison.quality, comparison.buildCommand)
        prepared.add(comparison.quality)
      }
      const expectedWidth = Math.round(
        comparison.browser.viewport.width * comparison.browser.viewport.devicePixelRatio,
      )
      const expectedHeight = Math.round(
        comparison.browser.viewport.height * comparison.browser.viewport.devicePixelRatio,
      )
      const captureComparison = JSON.parse(JSON.stringify(comparison)) as VisualAuditComparison
      const png = await options.captureBrowser({
        comparison: captureComparison,
        blenderReferencePath: referencePath,
        matrixRoot: root,
      })
      const metadata = await sharp(png).metadata()
      if (metadata.format !== 'png' || metadata.width !== expectedWidth || metadata.height !== expectedHeight) {
        throw new Error(
          `browser capture must be an unscaled ${expectedWidth}x${expectedHeight} PNG; ` +
            `received ${metadata.format ?? 'unknown'} ${metadata.width ?? '?'}x${metadata.height ?? '?'}`,
        )
      }
      atomicWrite(browserPath, png)
      comparison.browser = {
        ...comparison.browser,
        status: 'captured',
        bytes: png.byteLength,
        hash: createHash('sha256').update(png).digest('hex').slice(0, 16),
      }
      delete comparison.browser.error
      browserCaptured = true
      captured += 1
      const metrics = await writeVisualDiff(referencePath, browserPath, diffPath, options.acceptance)
      const passed = options.acceptance ? accepts(metrics, options.acceptance) : undefined
      comparison.comparison = {
        ...comparison.comparison,
        status: passed === undefined ? 'compared' : passed ? 'passed' : 'failed',
        metrics,
        ...(options.acceptance ? { acceptance: options.acceptance } : {}),
      }
      delete comparison.comparison.error
      compared += 1
      if (passed === true) accepted += 1
      if (passed === false) rejected += 1
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!browserCaptured) {
        comparison.browser.status = 'failed'
        comparison.browser.error = message
      }
      comparison.comparison.status = 'failed'
      comparison.comparison.error = message
      failures.push(`${comparison.id}: ${message}`)
    }
    atomicWrite(absoluteManifest, Buffer.from(`${JSON.stringify(matrix, null, 2)}\n`))
    options.onProgress?.(index + 1, matrix.comparisons.length, comparison)
  }

  if (failures.length) {
    throw new Error(
      `Blendlink visual audit failed ${failures.length}/${matrix.comparisons.length} comparisons:\n` +
        failures.map((failure) => `- ${failure}`).join('\n'),
    )
  }
  return {
    manifestPath: absoluteManifest,
    captured,
    compared,
    ...(options.acceptance ? { accepted, rejected } : {}),
    comparisons: matrix.comparisons,
  }
}

export function parseVisualReferenceMatrix(json: string): VisualReferenceMatrix {
  let value: unknown
  try {
    value = JSON.parse(json)
  } catch (error) {
    throw new Error(`Visual reference matrix is not valid JSON: ${String(error)}`)
  }
  const matrix = value as Partial<VisualReferenceMatrix>
  if (matrix.schemaVersion !== 1 || matrix.kind !== 'blendlink-visual-reference-matrix') {
    throw new Error(
      `Unsupported visual reference matrix ${String(matrix.kind)} schemaVersion ` +
        `${String(matrix.schemaVersion)}; rebuild it from Blender.`,
    )
  }
  if (!Array.isArray(matrix.references) || !Array.isArray(matrix.comparisons)) {
    throw new Error('Visual reference matrix needs references and comparisons arrays.')
  }
  if (matrix.references.length === 0 || matrix.comparisons.length === 0) {
    throw new Error('Visual reference matrix is empty; rebuild it with at least one camera/composition/pose.')
  }
  return matrix as VisualReferenceMatrix
}

async function writeVisualDiff(
  referencePath: string,
  browserPath: string,
  diffPath: string,
  acceptance?: VisualAuditAcceptance,
): Promise<VisualDiffMetrics> {
  const reference = await sharp(referencePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const browser = await sharp(browserPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  if (reference.info.width !== browser.info.width || reference.info.height !== browser.info.height) {
    throw new Error(
      `Blender/browser backing dimensions differ: ${reference.info.width}x${reference.info.height} ` +
        `vs ${browser.info.width}x${browser.info.height}.`,
    )
  }
  const threshold = acceptance?.pixelThreshold ?? (2 / 255)
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    throw new Error(`pixelThreshold must be between 0 and 1; got ${threshold}.`)
  }
  const diff = Buffer.alloc(reference.data.length)
  let absolute = 0
  let squared = 0
  let max = 0
  let changed = 0
  const pixels = reference.info.width * reference.info.height
  for (let offset = 0; offset < reference.data.length; offset += 4) {
    let pixelChanged = false
    const referenceAlpha = reference.data[offset + 3]! / 255
    const browserAlpha = browser.data[offset + 3]! / 255
    const deltas = [0, 0, 0, Math.abs(reference.data[offset + 3]! - browser.data[offset + 3]!)]
    for (let channel = 0; channel < 3; channel += 1) {
      deltas[channel] = Math.abs(
        reference.data[offset + channel]! * referenceAlpha
          - browser.data[offset + channel]! * browserAlpha,
      )
    }
    for (const delta of deltas) {
      absolute += delta
      squared += delta * delta
      max = Math.max(max, delta)
      pixelChanged ||= delta / 255 > threshold
    }
    // Make alpha-only mismatches visible in the opaque diff PNG.
    for (let channel = 0; channel < 3; channel += 1) {
      diff[offset + channel] = Math.min(255, Math.max(deltas[channel]!, deltas[3]!) * 4)
    }
    diff[offset + 3] = 255
    if (pixelChanged) changed += 1
  }
  const channelCount = pixels * 4
  mkdirSync(dirname(diffPath), { recursive: true })
  await sharp(diff, {
    raw: { width: reference.info.width, height: reference.info.height, channels: 4 },
  }).png().toFile(diffPath)
  return {
    width: reference.info.width,
    height: reference.info.height,
    comparisonSpace: 'premultiplied-rgba',
    meanAbsoluteError: absolute / channelCount / 255,
    rootMeanSquareError: Math.sqrt(squared / channelCount) / 255,
    maxChannelError: max / 255,
    changedPixelRatio: changed / pixels,
    pixelThreshold: threshold,
  }
}

function accepts(metrics: VisualDiffMetrics, acceptance: VisualAuditAcceptance): boolean {
  return (acceptance.maxMeanAbsoluteError === undefined
      || metrics.meanAbsoluteError <= acceptance.maxMeanAbsoluteError)
    && (acceptance.maxChangedPixelRatio === undefined
      || metrics.changedPixelRatio <= acceptance.maxChangedPixelRatio)
    && (acceptance.maxChannelError === undefined
      || metrics.maxChannelError <= acceptance.maxChannelError)
}

function validateAcceptance(acceptance?: VisualAuditAcceptance): void {
  if (!acceptance) return
  if (acceptance.maxMeanAbsoluteError === undefined
      && acceptance.maxChangedPixelRatio === undefined
      && acceptance.maxChannelError === undefined) {
    throw new Error(
      'Visual audit acceptance needs at least one maximum error threshold; ' +
        'pixelThreshold only defines which pixels count as changed.',
    )
  }
  for (const [name, value] of Object.entries(acceptance)) {
    if (value !== undefined && (!Number.isFinite(value) || value < 0 || value > 1)) {
      throw new Error(`Visual audit acceptance ${name} must be between 0 and 1; got ${value}.`)
    }
  }
}

function verifySourceBlend(matrix: VisualReferenceMatrix): void {
  if (!matrix.sourceBlendHash) return
  if (!matrix.sourceBlend || !existsSync(matrix.sourceBlend)) {
    throw new Error(
      `Visual audit source .blend is missing at ${matrix.sourceBlend}; rebuild the matrix from the saved scene.`,
    )
  }
  const hash = createHash('sha256').update(readFileSync(matrix.sourceBlend)).digest('hex').slice(0, 16)
  if (hash !== matrix.sourceBlendHash) {
    throw new Error(
      `Visual audit source .blend changed (${hash} != ${matrix.sourceBlendHash}). ` +
        'Save and recapture Blender references before capturing the website.',
    )
  }
}

function safeChildPath(root: string, path: string): string {
  if (!path || isAbsolute(path)) throw new Error(`Visual audit path must be relative to its matrix root: ${path}`)
  const target = resolve(root, path)
  const fromRoot = relative(root, target)
  if (fromRoot.startsWith('..') || isAbsolute(fromRoot)) {
    throw new Error(`Visual audit path escapes its matrix root: ${path}`)
  }
  return target
}

function atomicWrite(path: string, bytes: Uint8Array): void {
  mkdirSync(dirname(path), { recursive: true })
  const temporary = `${path}.tmp`
  writeFileSync(temporary, bytes)
  try {
    renameSync(temporary, path)
  } catch {
    // Windows rename cannot replace an existing destination. The complete
    // temporary remains available until the replacement write succeeds.
    writeFileSync(path, bytes)
    unlinkSync(temporary)
  }
}
