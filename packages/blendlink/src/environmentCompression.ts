import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findKtxTool } from './textureCompression.js'

const environmentModuleDirectory = dirname(fileURLToPath(import.meta.url))
// Compiled consumers load dist/blender; source/Vitest consumers load the
// authored package-level blender directory. Keeping both routes executable
// prevents the optional real-tool integration test from testing a path that
// only works after publishing.
const ENVIRONMENT_SCRIPT = [
  join(environmentModuleDirectory, 'blender', 'environment_compress.py'),
  join(environmentModuleDirectory, '..', 'blender', 'environment_compress.py'),
].find((candidate) => existsSync(candidate)) ??
  join(environmentModuleDirectory, 'blender', 'environment_compress.py')

export interface EnvironmentRadianceFidelity {
  width: number
  height: number
  relativeRmse: number
  meanRelativeError: number
  peakRelativeError: number
  maxErrorOverPeak: number
  logLuminanceRmseStops: number
  sourcePeak: number
  decodedPeak: number
  sourceMin: number
  negativeChannels: number
  invalidPixels: number
}

export interface EnvironmentCompressionAsset {
  path: string
  format: 'ktx2'
  codec: 'r11g11b10-zstd'
  bytes: number
  hash: string
  encoder: 'KTX-Software'
  encoderVersion: string
  minThreeRevision: 180
  fidelity: EnvironmentRadianceFidelity
}

export interface EnvironmentCompressionResult {
  asset: EnvironmentCompressionAsset | null
  warnings: string[]
}

export const ENVIRONMENT_FIDELITY_LIMITS = {
  relativeRmse: 0.025,
  meanRelativeError: 0.0125,
  peakRelativeError: 0.05,
  maxErrorOverPeak: 0.05,
  logLuminanceRmseStops: 0.08,
} as const

/** Radiance gates are scale-independent and operate on scene-linear values.
 * Signed or non-finite sources cannot be represented by R11G11B10 and must
 * keep using the byte-exact HDR/EXR fallback. */
export function radianceFidelityFailures(metrics: EnvironmentRadianceFidelity): string[] {
  const failures: string[] = []
  if (metrics.invalidPixels > 0) failures.push(`${metrics.invalidPixels} pixels contain non-finite radiance`)
  if (metrics.negativeChannels > 0) failures.push(`${metrics.negativeChannels} negative channels cannot be represented`)
  const checks: Array<[keyof typeof ENVIRONMENT_FIDELITY_LIMITS, string]> = [
    ['relativeRmse', 'relative RMSE'],
    ['meanRelativeError', 'mean relative error'],
    ['peakRelativeError', 'peak relative error'],
    ['maxErrorOverPeak', 'maximum error / source peak'],
    ['logLuminanceRmseStops', 'log-luminance RMSE'],
  ]
  for (const [key, label] of checks) {
    const value = metrics[key]
    const limit = ENVIRONMENT_FIDELITY_LIMITS[key]
    if (!Number.isFinite(value) || value > limit) {
      failures.push(`${label} ${Number.isFinite(value) ? value.toFixed(5) : String(value)} exceeds ${limit}`)
    }
  }
  return failures
}

/** Optional environment optimization. Any missing tool, converter error, or
 * failed decoded-radiance gate returns the unchanged source as the outcome;
 * callers never need to understand the conversion mechanics. */
export async function compressEnvironmentKtx2(
  sourcePath: string,
  outputPath: string,
  options: { blenderExecutable: string; ktxExecutable?: string },
): Promise<EnvironmentCompressionResult> {
  const tool = findKtxTool(options.ktxExecutable)
  if (!tool) {
    return {
      asset: null,
      warnings: ['HDR GPU compression skipped: Khronos KTX-Software was not found; the byte-exact HDR/EXR remains published.'],
    }
  }
  const work = mkdtempSync(join(tmpdir(), 'blendlink-hdr-'))
  const candidate = join(work, 'environment.ktx2')
  const resultPath = join(work, 'result.json')
  let staging: string | undefined
  try {
    const child = await runBlender(options.blenderExecutable, [
      '--background',
      '--factory-startup',
      '--python-exit-code', '13',
      '--python', ENVIRONMENT_SCRIPT,
      '--',
      sourcePath,
      candidate,
      tool.executable,
      resultPath,
    ], 300_000)
    const output = `${child.stdout}\n${child.stderr}`.trim()
    if (!output.includes('BLENDLINK_HDR_OK') || !existsSync(resultPath)) {
      const detail = output.split(/\r?\n/).slice(-12).join('\n') ||
        `Blender exited ${child.exitCode ?? 'without an exit code'} and produced no diagnostic output`
      return {
        asset: null,
        warnings: [`HDR GPU compression failed; the byte-exact HDR/EXR remains published. ${detail}`],
      }
    }
    const result = JSON.parse(readFileSync(resultPath, 'utf8')) as {
      ok: boolean
      error?: string
      bytes?: number
      hash?: string
      metrics?: EnvironmentRadianceFidelity
    }
    if (!result.ok || !result.metrics || !existsSync(candidate)) {
      return {
        asset: null,
        warnings: [`HDR GPU compression skipped; the byte-exact HDR/EXR remains published. ${result.error ?? 'converter produced no verified artifact'}`],
      }
    }
    const failures = radianceFidelityFailures(result.metrics)
    if (failures.length > 0) {
      return {
        asset: null,
        warnings: [
          `HDR GPU compression failed the decoded-radiance gate (${failures.join('; ')}); ` +
          'the byte-exact HDR/EXR remains published.',
        ],
      }
    }
    const payload = readFileSync(candidate)
    staging = `${outputPath}.tmp-${process.pid}`
    writeFileSync(staging, payload)
    renameSync(staging, outputPath)
    staging = undefined
    return {
      asset: {
        path: outputPath,
        format: 'ktx2',
        codec: 'r11g11b10-zstd',
        bytes: payload.byteLength,
        hash: createHash('sha256').update(payload).digest('hex').slice(0, 16),
        encoder: 'KTX-Software',
        encoderVersion: tool.version,
        minThreeRevision: 180,
        fidelity: result.metrics,
      },
      warnings: [],
    }
  } catch (error) {
    if (staging) rmSync(staging, { force: true })
    return {
      asset: null,
      warnings: [
        `HDR GPU compression failed; the byte-exact HDR/EXR remains published. ` +
        `${error instanceof Error ? error.message : String(error)}`,
      ],
    }
  } finally {
    removeOwnedTemp(work)
  }
}

/** Blender may launch KTX as a child process. A stalled conversion therefore
 * has to terminate the complete process tree on Windows, not only Blender's
 * parent PID. The timeout is inactivity-based so a large environment can run
 * as long as each stage continues to report progress. */
function runBlender(
  executable: string,
  args: string[],
  inactivityMs: number,
): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { shell: false, windowsHide: true })
    const maxCapturedCharacters = 8 * 1024 * 1024
    let stdout = ''
    let stderr = ''
    let timer: NodeJS.Timeout
    let terminationTimer: NodeJS.Timeout | undefined
    let timedOut = false
    let settled = false

    const append = (current: string, data: unknown): string => {
      const combined = current + String(data)
      return combined.length > maxCapturedCharacters
        ? combined.slice(-maxCapturedCharacters)
        : combined
    }
    const finish = (
      outcome: 'resolve' | 'reject',
      value: { exitCode: number | null; stdout: string; stderr: string } | Error,
    ) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (terminationTimer) clearTimeout(terminationTimer)
      if (outcome === 'resolve') {
        resolve(value as { exitCode: number | null; stdout: string; stderr: string })
      } else {
        reject(value)
      }
    }
    const timeoutError = () => new Error(
      `Blender produced no HDR conversion output for ${inactivityMs}ms; ` +
      `the process tree was terminated. ${stderr.split(/\r?\n/).slice(-12).join('\n')}`,
    )
    const arm = () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        timedOut = true
        if (process.platform === 'win32' && child.pid) {
          const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
            shell: false,
            windowsHide: true,
          })
          killer.on('error', () => child.kill('SIGKILL'))
        } else {
          child.kill('SIGKILL')
        }
        // Normally `close` settles after the process tree exits. This guard
        // keeps an OS-level termination failure from hanging the compile.
        terminationTimer = setTimeout(() => finish('reject', timeoutError()), 30_000)
      }, inactivityMs)
    }

    child.stdout.on('data', (data) => {
      stdout = append(stdout, data)
      arm()
    })
    child.stderr.on('data', (data) => {
      stderr = append(stderr, data)
      arm()
    })
    child.on('error', (error) => finish('reject', error))
    child.on('close', (exitCode) => {
      if (timedOut) finish('reject', timeoutError())
      else finish('resolve', { exitCode, stdout, stderr })
    })
    arm()
  })
}

function removeOwnedTemp(path: string): void {
  if (dirname(path) !== tmpdir() || !basename(path).startsWith('blendlink-hdr-')) {
    throw new Error(`Refusing to remove unexpected HDR temporary directory: ${path}`)
  }
  rmSync(path, { recursive: true, force: true })
}
