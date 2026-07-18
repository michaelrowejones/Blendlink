import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { discoverBlender, type BlenderInstall } from './discover.js'
import { readBlendHeader } from './blendHeader.js'

const EXPORT_SCRIPT = join(
  dirname(fileURLToPath(import.meta.url)),
  'blender',
  'export_scene.py',
)

export interface ExportSettings {
  /** Export only this collection (and children); omit for the whole file. */
  collection?: string
  /** 'AUTO' embeds textures; 'NONE' skips image export (fast dev loops). */
  imageFormat?: 'AUTO' | 'NONE'
  /** Escape hatch: raw exporter kwargs, RNA-filtered inside Blender. */
  exporterOverrides?: Record<string, unknown>
}

export interface ExportResult {
  ok: true
  glbPath: string
  blenderVersion: string
  exporterKwargsDropped: string[]
  warnings: string[]
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
          `loss. Install a matching Blender or pass allowNewerFile.`,
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
    const sentinel = stdout.includes('BLENDLINK_OK')
    const artifactsComplete = existsSync(resultPath) && existsSync(tempGlb)
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
      'glbPath' | 'durationMs'
    >
    if (exitCode !== 0) {
      result.warnings = [
        ...result.warnings,
        `Blender crashed during shutdown (code ${exitCode}) after a successful export.`,
      ]
    }
    mkdirSync(dirname(options.outPath), { recursive: true })
    const staging = options.outPath + '.tmp-' + process.pid
    renameOrCopy(tempGlb, staging)
    renameSync(staging, options.outPath)

    return {
      ...result,
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
    child.stdout.on('data', (data) => (stdout += data))
    child.stderr.on('data', (data) => (stderr += data))

    const timer = setTimeout(() => {
      // Blender must die as a tree on Windows or helpers linger.
      if (process.platform === 'win32' && child.pid) {
        spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true })
      } else {
        child.kill('SIGKILL')
      }
      reject(new BlendExportError(`Blender timed out after ${timeoutMs}ms.`, {
        exitCode: null,
        stderrTail: stderr.split('\n').slice(-15).join('\n'),
      }))
    }, timeoutMs)

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
