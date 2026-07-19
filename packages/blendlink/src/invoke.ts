import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { discoverBlender, type BlenderInstall } from './discover.js'
import { readBlendHeader } from './blendHeader.js'
import { ProgressEcho, progressEnabled } from './progress.js'

const EXPORT_SCRIPT = join(
  dirname(fileURLToPath(import.meta.url)),
  'blender',
  'export_scene.py',
)

export interface BakeSettings {
  /** Atlas size in px. Default 2048. */
  size?: number
  /** Max adaptive samples. Default 128. */
  samples?: number
  /** Bake margin px (island spacing follows it). Default 48. */
  margin?: number
  /** Bake at N× the atlas size and box-resolve down — free anti-aliasing
   * (Cycles bakes have none) at zero runtime cost. 2 is the sweet spot. */
  supersample?: number
  /** OIDN-denoise the baked images before saving (runs after margin
   * dilation, so the bake-time-denoise margin bug does not apply). */
  denoise?: boolean
  /** Lighting states: each bakes with the listed collections hidden. */
  states?: Array<{ name: string; hideCollections?: string[] }>
}

export interface ExportSettings {
  /** Export only this collection (and children); omit for the whole file. */
  collection?: string
  /** 'AUTO' embeds textures; 'NONE' skips image export (fast dev loops). */
  imageFormat?: 'AUTO' | 'NONE'
  /** 'baked': bake Cycles Combined to an atlas and export unlit. */
  mode?: 'standard' | 'baked'
  bake?: BakeSettings
  /** Curve sampling resolution for non-bezier splines. Default 64. */
  curveSamples?: number
  /** Escape hatch: raw exporter kwargs, RNA-filtered inside Blender. */
  exporterOverrides?: Record<string, unknown>
  /** Compute the bake plan (UV pack + density stats) and stop — no bake,
   * no GLB. The answer to "what is it planning to bake?". */
  planOnly?: boolean
}

export interface BakePlan {
  supersample: number
  atlasSize: number
  marginPx: number
  samples: number
  /** Sum of packed UV areas (0..1) — atlas occupancy. */
  occupancy: number
  states: string[]
  lightGroups: string[]
  bakeCount: number
  objects: Array<{
    name: string
    areaM2: number
    uvShare: number
    pxPerMeter: number
    /** Distance from the scene camera to the object center (null: no camera). */
    cameraDistance: number | null
    /** px/m × distance — equal values = equal perceived quality. */
    screenDensity: number | null
    /** Auto texel weight (camera-distance, median-normalized, quantized). */
    autoWeight: number
    /** Artist texel_weight custom property (1 = default, 0 = excluded). */
    artistWeight: number
  }>
  /** In the GLB for physics, but kept out of the atlas and bake. */
  collisionProxies: string[]
  /** Mixed scenes: meshes that keep real materials and runtime lighting
   * (explicit blendlink_dynamic, armature-deformed, or transparent). */
  dynamicObjects: Array<{ name: string; reason: string }>
  warnings: string[]
}

export interface BlendSidecar {
  fps: number
  markers: Array<{ name: string; frame: number; time: number }>
  empties: Array<{ name: string; displayType: string; size: number }>
  curves: Array<{
    name: string
    kind: 'bezier' | 'points'
    cyclic: boolean
    points: Array<
      | [number, number, number]
      | { co: [number, number, number]; handleLeft: [number, number, number]; handleRight: [number, number, number] }
    >
  }>
}

export interface ExportResult {
  ok: true
  glbPath: string
  blenderVersion: string
  exporterKwargsDropped: string[]
  warnings: string[]
  /** Objects removed by the -noimp convention (never silently). */
  excluded: string[]
  /** Blender-only data the GLB cannot carry. */
  sidecar: BlendSidecar
  /** Baked mode: state name → final PNG path on disk. */
  bakedStates: Record<string, string>
  /** Baked mode: interactive light group → additive layer PNG + peak scale. */
  bakedLightGroups: Record<string, { path: string; maxValue: number }>
  /** Baked mode: the bake plan (planOnly runs produce ONLY this). */
  plan?: BakePlan
  durationMs: number
}

export class BlendExportError extends Error {
  constructor(
    message: string,
    readonly detail: { exitCode: number | null; stderrTail: string },
  ) {
    super(message)
  }
}

/**
 * Run one headless export: `.blend` in, `.glb` out.
 *
 * Trust contract (from the hardened-invoker research): the exit code, the
 * result JSON file, and the BLENDLINK_OK sentinel are authoritative; stdout
 * is otherwise diagnostics. The GLB is written to a temp name and renamed
 * atomically so watchers never see a half-written file.
 */
export async function exportBlend(options: {
  blendPath: string
  outPath: string
  settings?: ExportSettings
  blender?: BlenderInstall
  timeoutMs?: number
  allowNewerFile?: boolean
}): Promise<ExportResult> {
  const started = Date.now()
  const blender = options.blender ?? (await discoverBlender())

  const header = readBlendHeader(options.blendPath)
  if (header.version && !options.allowNewerFile) {
    const [fileMajor, fileMinor] = header.version
    const [binMajor, binMinor] = blender.semver
    if (fileMajor > binMajor || (fileMajor === binMajor && fileMinor > binMinor)) {
      throw new BlendExportError(
        `${options.blendPath} was saved by Blender ${fileMajor}.${fileMinor}, ` +
          `newer than the discovered ${blender.version}. Opening it risks data ` +
          `loss. Install a matching Blender, or override with ` +
          `\`blendlink sync --allow-newer\` (API: allowNewerFile).`,
        { exitCode: null, stderrTail: '' },
      )
    }
  }

  const work = mkdtempSync(join(tmpdir(), 'blendlink-'))
  const settingsPath = join(work, 'settings.json')
  const resultPath = join(work, 'result.json')
  const tempGlb = join(work, 'out.glb')
  writeFileSync(settingsPath, JSON.stringify(options.settings ?? {}))

  try {
    const args = [
      '-b',
      options.blendPath,
      '--factory-startup',
      '--python-exit-code',
      '13',
      '--python',
      EXPORT_SCRIPT,
      '--',
      tempGlb,
      settingsPath,
      resultPath,
    ]
    const { exitCode, stdout, stderr } = await run(blender.executable, args, options.timeoutMs ?? 300_000)

    // Trust the sentinel + artifacts over the exit code: Blender sometimes
    // crashes during process shutdown AFTER a fully successful export
    // (observed: EXCEPTION_ACCESS_VIOLATION freeing the scene on exit).
    const planOnly = options.settings?.planOnly === true
    const sentinel = stdout.includes('BLENDLINK_OK')
    const artifactsComplete = existsSync(resultPath) && (planOnly || existsSync(tempGlb))
    if (!sentinel || !artifactsComplete) {
      const stderrTail = (stderr + '\n' + stdout).split('\n').slice(-15).join('\n')
      throw new BlendExportError(
        exitCode === 13
          ? 'The export script failed inside Blender.'
          : `Blender exited abnormally (code ${exitCode}).`,
        { exitCode, stderrTail },
      )
    }

    const result = JSON.parse(readFileSync(resultPath, 'utf8')) as Omit<
      ExportResult,
      'glbPath' | 'durationMs' | 'bakedStates' | 'bakedLightGroups'
    > & {
      baked?: {
        states?: Record<string, string>
        lightGroups?: Record<string, { path: string; maxValue: number }>
      }
    }
    if (exitCode !== 0) {
      result.warnings = [
        ...result.warnings,
        `Blender crashed during shutdown (code ${exitCode}) after a successful export.`,
      ]
    }
    if (planOnly) {
      return {
        ...result,
        bakedStates: {},
        bakedLightGroups: {},
        glbPath: options.outPath,
        durationMs: Date.now() - started,
      }
    }
    mkdirSync(dirname(options.outPath), { recursive: true })
    const staging = options.outPath + '.tmp-' + process.pid
    renameOrCopy(tempGlb, staging)
    renameSync(staging, options.outPath)

    // Baked-mode state/light textures are written beside the temp GLB; move
    // them out before the temp dir is destroyed.
    const bakedStates: Record<string, string> = {}
    for (const [state, tempPath] of Object.entries(result.baked?.states ?? {})) {
      const finalPath = options.outPath.replace(/\.glb$/i, '') + `.${state}.png`
      if (existsSync(tempPath)) {
        renameOrCopy(tempPath, finalPath)
        bakedStates[state] = finalPath
      }
    }
    const bakedLightGroups: Record<string, { path: string; maxValue: number }> = {}
    for (const [group, layer] of Object.entries(result.baked?.lightGroups ?? {})) {
      const finalPath = options.outPath.replace(/\.glb$/i, '') + `.light.${group}.png`
      if (existsSync(layer.path)) {
        renameOrCopy(layer.path, finalPath)
        bakedLightGroups[group] = { path: finalPath, maxValue: layer.maxValue }
      }
    }

    return {
      ...result,
      bakedStates,
      bakedLightGroups,
      glbPath: options.outPath,
      durationMs: Date.now() - started,
    }
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

function renameOrCopy(from: string, to: string) {
  try {
    renameSync(from, to)
  } catch {
    // Cross-device rename (temp dir on another volume): fall back to copy.
    writeFileSync(to, readFileSync(from))
  }
}

function run(
  executable: string,
  args: string[],
  timeoutMs: number,
): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { shell: false, windowsHide: true })
    let stdout = ''
    let stderr = ''
    // INACTIVITY timeout, not a wall-clock one: a legitimate 4K multi-state
    // bake exceeds any fixed budget, but a healthy Blender keeps talking
    // (Cycles sample logs, progress lines). Silence is the hang signal.
    let timer: NodeJS.Timeout
    const arm = () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        // Blender must die as a tree on Windows or helpers linger.
        if (process.platform === 'win32' && child.pid) {
          spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true })
        } else {
          child.kill('SIGKILL')
        }
        reject(new BlendExportError(
          `Blender produced no output for ${timeoutMs}ms — treating it as hung.`,
          {
            exitCode: null,
            stderrTail: stderr.split('\n').slice(-15).join('\n'),
          },
        ))
      }, timeoutMs)
    }
    // Blender's stdout is captured for the sentinel contract, but progress
    // lines from the export script must stream live to whoever is watching.
    const echo = progressEnabled() ? new ProgressEcho() : null
    child.stdout.on('data', (data) => {
      stdout += data
      echo?.push(String(data))
      arm()
    })
    child.stderr.on('data', (data) => {
      stderr += data
      arm()
    })
    arm()

    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (exitCode) => {
      clearTimeout(timer)
      resolve({ exitCode, stdout, stderr })
    })
  })
}
