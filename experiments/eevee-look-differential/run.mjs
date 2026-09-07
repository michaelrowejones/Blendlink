import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { cp, mkdir, readdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { createServer } from 'vite'

const execute = promisify(execFile)
const root = resolve(import.meta.dirname, '../..')
const artifacts = join(root, 'artifacts/verification-look')
const browserData = join(artifacts, 'browser')
const blender =
  process.env.BLENDLINK_BLENDER_PATH ??
  'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe'
const npx =
  process.env.npm_execpath?.replace(/npm-cli\.js$/, 'npx-cli.js') ??
  join(dirname(process.execPath), 'node_modules/npm/bin/npx-cli.js')
const session = `blendlink-look-gate-${process.pid}`
await mkdir(browserData, { recursive: true })
if (!process.argv.includes('--reuse')) {
  for (const [script, args] of [
    ['display.py', []],
    ['display_alpha.py', []],
    ['compositor.py', []],
    ['kernels.py', []],
    ['kernels.py', ['--', '--bloom-quality']],
    ['normals.py', []],
    ['export_normals.py', []],
    ['passes.py', []],
  ]) {
    const result = await execute(
      blender,
      [
        '--background',
        '--factory-startup',
        '--python-exit-code',
        '1',
        '--python',
        join(import.meta.dirname, script),
        ...args,
      ],
      { maxBuffer: 32 * 1024 * 1024, windowsHide: true },
    )
    await writeFile(
      join(artifacts, `gate-${script}${args.length ? '-quality' : ''}.log`),
      result.stdout + result.stderr,
    )
    console.log(`Blender reference: ${script}${args.length ? ' quality cases' : ''}`)
  }
}
await cp(join(artifacts, 'compositor/browser-cases'), join(browserData, 'compositor-cases'), {
  recursive: true,
})
await cp(join(artifacts, 'compositor/display-alpha-cases'), join(browserData, 'alpha'), {
  recursive: true,
})
const kernelCases = []
await mkdir(join(browserData, 'kernel-cases'), { recursive: true })
for (const directory of ['kernel-browser-cases', 'bloom-browser-cases']) {
  const source = join(artifacts, 'compositor', directory)
  for (const name of await readdir(source)) {
    if (!/^(blur-|glare-|bloom-).+\.json$/.test(name) || name.endsWith('results.json')) continue
    await cp(join(source, name), join(browserData, 'kernel-cases', name))
    kernelCases.push({ case: name.slice(0, -5) })
  }
}
await writeFile(join(browserData, 'kernel-cases/index.json'), JSON.stringify(kernelCases))
// Reference assets live separately from source: publicDir must never shadow TS modules.
const publicData = join(artifacts, 'gate-assets')
await mkdir(publicData, { recursive: true })
await mkdir(join(publicData, 'passes'), { recursive: true })
for (const name of ['perspective-depth.json', 'ortho-depth.json']) {
  await cp(join(artifacts, 'passes', name), join(publicData, 'passes', name))
}
for (const name of await readdir(browserData)) {
  if (/\.(json|glb)$/.test(name) || ['compositor-cases', 'kernel-cases', 'alpha'].includes(name)) {
    await cp(join(browserData, name), join(publicData, name), { recursive: true })
  }
}
const server = await createServer({
  configFile: false,
  root: join(import.meta.dirname, 'browser'),
  publicDir: publicData,
  resolve: { dedupe: ['three'] },
  server: { host: '127.0.0.1', port: 0, fs: { allow: [root] } },
})
await server.listen()
const base = server.resolvedUrls.local[0]
async function browser(...args) {
  const { stdout } = await execute(
    process.execPath,
    [npx, '--yes', 'agent-browser', '--session', session, '--json', ...args],
    { windowsHide: true, timeout: 30000, maxBuffer: 8 * 1024 * 1024 },
  )
  const response = JSON.parse(stdout)
  if (!response.success) throw new Error(response.error)
  return response.data
}
const reports = []
try {
  for (const backend of ['webgpu', 'webgl2'])
    for (const [path, tolerance, field] of [
      ['index.html', 0.00003, 'clampedMax'],
      ['alpha.html', 0.00003, 'max'],
      ['compositor.html', 0.000004, 'max'],
      ['compositor.html?kernels', 0.00004, 'max'],
      ['normals.html', 0.0005, 'error'],
      ['normals.html?derivative', 0.0005, 'error'],
      ['depth.html', 0.0001, 'max'],
    ]) {
      const url = new URL(path, base)
      if (backend === 'webgl2') url.searchParams.set('webgl2', '')
      await browser('open', url.href)
      let rows
      const deadline = Date.now() + 60000
      while (!rows && Date.now() < deadline) {
        rows = (await browser('eval', 'window.__reports ?? null')).result
        if (!rows) await new Promise((resolve) => setTimeout(resolve, 200))
      }
      if (!Array.isArray(rows) || !rows.length) throw new Error(`No completed results for ${url}`)
      if (path === 'index.html' && rows.some(row => row.backend !== (backend === 'webgpu' ? 'WebGPUBackend' : 'WebGLBackend'))) {
        throw new Error(`The ${backend} test initialized a different renderer backend`)
      }
      const failures = rows.filter((row) => {
        // Unsupported Fog Glow is an intentional named refusal, never substituted Bloom.
        if (/^glare-fog_glow-(image|glare)$/.test(row.case ?? ''))
          return typeof row.error !== 'string' || !row.error.includes('different spatial kernel')
        return (
          typeof row[field] !== 'number' ||
          !Number.isFinite(row[field]) ||
          row[field] > tolerance ||
          (field !== 'error' && row.error)
        )
      })
      reports.push({ backend, path, tolerance, rows, failures })
      await writeFile(
        join(artifacts, 'differential-results.json'),
        JSON.stringify(reports, null, 2),
      )
      if (failures.length) throw new Error(`${backend} ${path}: ${JSON.stringify(failures)}`)
      console.log(`${backend} ${path}: ${rows.length} cases passed`)
    }
} finally {
  await browser('close').catch(() => {})
  await server.close()
}
