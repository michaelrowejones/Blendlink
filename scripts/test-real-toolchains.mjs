import { spawnSync } from 'node:child_process'
import {
  existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(import.meta.dirname, '..')
const cli = join(root, 'packages', 'blendlink', 'dist', 'cli.js')
const textureCompression = await import(pathToFileURL(
  join(root, 'packages', 'blendlink', 'dist', 'textureCompression.js'),
).href)
const ktx = textureCompression.findKtxTool()

if (!ktx) {
  throw new Error(
    'The full Blendlink release gate requires Khronos KTX-Software so real KTX2 ' +
      'texture and HDR fidelity tests cannot be silently skipped. Run `blendlink doctor` ' +
      'after installing KTX-Software.',
  )
}

const discovery = spawnSync(process.execPath, [cli, 'discover'], {
  cwd: root,
  encoding: 'utf8',
  windowsHide: true,
})
if (discovery.stdout) process.stdout.write(discovery.stdout)
if (discovery.stderr) process.stderr.write(discovery.stderr)
if (discovery.error || discovery.status !== 0) {
  throw new Error(
    `Could not discover a supported Blender for the real toolchain gate` +
      `${discovery.status === null ? '' : ` (exit ${discovery.status})`}: ` +
      `${discovery.error?.message ?? 'see discovery output above'}`,
  )
}
const blender = discovery.stdout.trim().split(/\r?\n/).filter(Boolean).at(-1)
if (!blender) throw new Error('Blendlink discovery returned no Blender executable')

const work = mkdtempSync(join(tmpdir(), 'blendlink-real-tools-'))

function cleanWork() {
  const resolved = resolve(work)
  if (dirname(resolved) !== resolve(tmpdir()) || !basename(resolved).startsWith('blendlink-real-tools-')) {
    throw new Error(`Refusing to clean an unexpected temporary directory: ${resolved}`)
  }
  rmSync(resolved, { recursive: true, force: true })
}

function run(label, command, args, options = {}) {
  console.log(`BLENDLINK_FULL_TEST real tools: ${label}`)
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
    ...options,
  })
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  if (result.error || result.status !== 0) {
    throw new Error(
      `${label} failed${result.status === null ? '' : ` (exit ${result.status})`}: ` +
        `${result.error?.message ?? 'see tool output above'}`,
    )
  }
}

function runExpectedFailure(label, command, args, expected, options = {}) {
  console.log(`BLENDLINK_FULL_TEST real tools: ${label}`)
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
    ...options,
  })
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  if (result.error || result.status === 0) {
    throw new Error(
      `${label} unexpectedly ${result.error ? `failed to start: ${result.error.message}` : 'passed'}`,
    )
  }
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`
  if (!expected.test(output)) {
    throw new Error(`${label} failed for the wrong reason; expected ${expected}`)
  }
}

try {
  const blend = join(work, 'real-tools.blend')
  const hdr = join(work, 'studio-environment.hdr')
  run('creating owned HDR fixture with Blender', blender, [
    '--background',
    '--factory-startup',
    '--python-exit-code', '1',
    '--python', join(root, 'scripts', 'make-baked-e2e-scene.py'),
    '--', blend,
  ])
  if (!existsSync(hdr)) throw new Error(`Blender did not create the HDR fixture: ${hdr}`)

  const emptyBlend = join(work, 'empty-scene.blend')
  run('creating owned empty-scene refusal fixture with Blender', blender, [
    '--background',
    '--factory-startup',
    '--python-exit-code', '1',
    '--python-expr',
    `import bpy; [bpy.data.objects.remove(obj, do_unlink=True) for obj in list(bpy.data.objects)]; bpy.ops.wm.save_as_mainfile(filepath=${JSON.stringify(emptyBlend)})`,
  ])
  const emptyProject = join(work, 'empty-scene-project')
  mkdirSync(emptyProject, { recursive: true })
  writeFileSync(join(emptyProject, 'blendlink.config.mjs'), `export default ${JSON.stringify({
    blenderPath: blender,
    outDir: 'public/models',
    genDir: 'src/generated',
    scenes: [{ file: '../empty-scene.blend', name: 'emptyScene' }],
  }, null, 2)}\n`)
  runExpectedFailure(
    'CLI refuses a real Standard export with no renderable mesh primitives',
    process.execPath,
    [cli, 'compile', 'emptyScene', '--force'],
    /no renderable mesh primitives.*helper or asset library.*blendlink plan/is,
    { cwd: emptyProject },
  )
  for (const path of [
    join(emptyProject, 'public', 'models', 'emptyScene.glb'),
    join(emptyProject, 'src', 'generated', 'emptyScene.manifest.json'),
    join(emptyProject, 'src', 'generated', 'emptyScene.gen.ts'),
  ]) {
    if (existsSync(path)) throw new Error(`Empty-scene refusal published a partial artifact: ${path}`)
  }
  const emptyPublishDirectory = join(emptyProject, 'public', 'models')
  if (existsSync(emptyPublishDirectory)
      && readdirSync(emptyPublishDirectory).some((name) => name.startsWith('.blendlink-stage-'))) {
    throw new Error('Empty-scene refusal left a compiler staging directory behind')
  }

  const vitest = join(root, 'node_modules', 'vitest', 'vitest.mjs')
  if (!existsSync(vitest)) {
    throw new Error(`The full Blendlink release gate could not find its pinned Vitest executable: ${vitest}`)
  }
  run(
    `KTX ${ktx.version} texture and HDR round trips`,
    process.execPath,
    [
      vitest,
      'run',
      '--passWithNoTests',
      'src/textureCompression.test.ts',
      'src/environmentCompression.test.ts',
    ],
    {
      cwd: join(root, 'packages', 'blendlink'),
      env: {
        ...process.env,
        BLENDLINK_BLENDER_PATH: blender,
        BLENDLINK_KTX_PATH: ktx.executable,
        BLENDLINK_HDR_TEST_IMAGE: hdr,
      },
    },
  )
  console.log('BLENDLINK_REAL_TOOLCHAINS_PASSED')
} finally {
  cleanWork()
}
