// Stage-by-stage GPU-vs-CPU bisection of Blender's perlin_1d in TSL.
//
//   node experiments/tsl-node-differential/run-debug1d.mjs
//
// Renders each stage in debug1d.js on WebGPU and diffs it against the same
// stage computed here in >>>0 integer JS — the CPU port already proven to
// match the Blender reference bake to 2e-4, so a stage that disagrees HERE is
// the stage where the GPU translation breaks. No Blender involved.
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const experimentDir = resolve(import.meta.dirname)
const repositoryRoot = resolve(experimentDir, '..', '..')
const SIZE = 64

// --- CPU ground truth: >>>0 arithmetic, f64 floats -------------------------

const rot = (x, k) => (((x << k) | (x >>> (32 - k))) >>> 0)
function jenkinsFinal(a0, b0, c0) {
  let a = a0 >>> 0
  let b = b0 >>> 0
  let c = c0 >>> 0
  c = (c ^ b) >>> 0; c = (c - rot(b, 14)) >>> 0
  a = (a ^ c) >>> 0; a = (a - rot(c, 11)) >>> 0
  b = (b ^ a) >>> 0; b = (b - rot(a, 25)) >>> 0
  c = (c ^ b) >>> 0; c = (c - rot(b, 16)) >>> 0
  a = (a ^ c) >>> 0; a = (a - rot(c, 4)) >>> 0
  b = (b ^ a) >>> 0; b = (b - rot(a, 14)) >>> 0
  c = (c ^ b) >>> 0; c = (c - rot(b, 24)) >>> 0
  return c
}
function jenkinsMix(a0, b0, c0) {
  let a = a0 >>> 0
  let b = b0 >>> 0
  let c = c0 >>> 0
  a = (a - c) >>> 0; a = (a ^ rot(c, 4)) >>> 0; c = (c + b) >>> 0
  b = (b - a) >>> 0; b = (b ^ rot(a, 6)) >>> 0; a = (a + c) >>> 0
  c = (c - b) >>> 0; c = (c ^ rot(b, 8)) >>> 0; b = (b + a) >>> 0
  a = (a - c) >>> 0; a = (a ^ rot(c, 16)) >>> 0; c = (c + b) >>> 0
  b = (b - a) >>> 0; b = (b ^ rot(a, 19)) >>> 0; a = (a + c) >>> 0
  c = (c - b) >>> 0; c = (c ^ rot(b, 4)) >>> 0; b = (b + a) >>> 0
  return [a, b, c]
}
const SEED4 = (0xdeadbeef + (4 << 2) + 13) >>> 0
function hashUint4(kx, ky, kz, kw) {
  const [a, b, c] = jenkinsMix(
    (SEED4 + kx) >>> 0, (SEED4 + ky) >>> 0, (SEED4 + kz) >>> 0,
  )
  return jenkinsFinal((a + kw) >>> 0, b, c)
}
function grad4(hash, x, y, z, w) {
  const h = hash & 31
  const u = h < 24 ? x : y
  const v = h < 16 ? y : z
  const s = h < 8 ? z : w
  return ((h & 1) ? -u : u) + ((h & 2) ? -v : v) + ((h & 4) ? -s : s)
}
function perlin4dCpu(x, y, z, w) {
  const X = Math.floor(x)
  const Y = Math.floor(y)
  const Z = Math.floor(z)
  const W = Math.floor(w)
  const fx = x - X
  const fy = y - Y
  const fz = z - Z
  const fw = w - W
  const u = fade(fx)
  const v = fade(fy)
  const t = fade(fz)
  const s = fade(fw)
  const tap = (i, j, k, l) => grad4(
    hashUint4((X + i) >>> 0, (Y + j) >>> 0, (Z + k) >>> 0, (W + l) >>> 0),
    fx - i, fy - j, fz - k, fw - l,
  )
  const lerp = (a, b, f) => a + f * (b - a)
  const tri = (l) => lerp(
    lerp(lerp(tap(0, 0, 0, l), tap(1, 0, 0, l), u),
      lerp(tap(0, 1, 0, l), tap(1, 1, 0, l), u), v),
    lerp(lerp(tap(0, 0, 1, l), tap(1, 0, 1, l), u),
      lerp(tap(0, 1, 1, l), tap(1, 1, 1, l), u), v), t,
  )
  return lerp(tri(0), tri(1), s) * 0.8344
}

const SEED1 = (0xdeadbeef + (1 << 2) + 13) >>> 0
const hashUint1 = (kx) => jenkinsFinal((SEED1 + kx) >>> 0, SEED1, SEED1)
const fade = (t) => t * t * t * (t * (t * 6.0 - 15.0) + 10.0)
function grad1(hash, x) {
  const h = hash & 15
  const g = 1.0 + (h & 7)
  return ((h & 8) ? -g : g) * x
}
function perlin1d(x) {
  const X = Math.floor(x)
  const fx = x - X
  const u = fade(fx)
  const a = grad1(hashUint1(X >>> 0), fx)
  const b = grad1(hashUint1((X + 1) >>> 0), fx - 1.0)
  return a + u * (b - a)
}

const UNIT = 4294967295.0
const EXPECTED = {
  x: (u) => u,
  seed: () => SEED1 / UNIT,
  rot14: () => rot(0x12345678, 14) / UNIT,
  floorx: (u) => Math.floor(u * 8.0) / 8.0,
  hash1: (u) => hashUint1(Math.floor(u * 8.0) >>> 0) / UNIT,
  hash1next: (u) => hashUint1((Math.floor(u * 8.0) + 1) >>> 0) / UNIT,
  grad: (u) => {
    const cell = Math.floor(u * 8.0)
    return grad1(hashUint1(cell >>> 0), u * 8.0 - cell) * 0.0625 + 0.5
  },
  fade: (u) => fade(u * 8.0 - Math.floor(u * 8.0)),
  perlin: (u) => perlin1d(u * 11.0) * 0.25 * 0.5 + 0.5,
  hash4cell: (u, v) => hashUint4(
    Math.floor(u * 5.0) >>> 0, Math.floor(v * 5.0) >>> 0, 0, 16,
  ) / UNIT,
  grad4probe: (u, v) => grad4(
    hashUint4(Math.floor(u * 5.0) >>> 0, Math.floor(v * 5.0) >>> 0, 0, 16),
    u * 5.0 - Math.floor(u * 5.0), v * 5.0 - Math.floor(v * 5.0), 0.3, 0.7,
  ) * 0.1 + 0.5,
  perlin4dsingle: (u, v) => perlin4dCpu(u * 5.0, v * 5.0, 0.0, 16.5) * 0.5 + 0.5,
  tap0000: (u, v) => {
    const fx = u * 5.0 - Math.floor(u * 5.0)
    const fy = v * 5.0 - Math.floor(v * 5.0)
    return grad4(hashUint4(
      Math.floor(u * 5.0) >>> 0, Math.floor(v * 5.0) >>> 0, 0, 16,
    ), fx, fy, 0.0, 0.5) * 0.1 + 0.5
  },
  mixtap: (u, v) => {
    const fx = u * 5.0 - Math.floor(u * 5.0)
    const fy = v * 5.0 - Math.floor(v * 5.0)
    const X = Math.floor(u * 5.0) >>> 0
    const Y = Math.floor(v * 5.0) >>> 0
    const a = grad4(hashUint4(X, Y, 0, 16), fx, fy, 0.0, 0.5)
    const b = grad4(hashUint4((X + 1) >>> 0, Y, 0, 16), fx - 1.0, fy, 0.0, 0.5)
    return (a + fade(fx) * (b - a)) * 0.1 + 0.5
  },
  tri0: (u, v) => {
    const fx = u * 5.0 - Math.floor(u * 5.0)
    const fy = v * 5.0 - Math.floor(v * 5.0)
    const X = Math.floor(u * 5.0) >>> 0
    const Y = Math.floor(v * 5.0) >>> 0
    const fu = fade(fx)
    const fv = fade(fy)
    const tap = (i, j, k) => grad4(
      hashUint4((X + i) >>> 0, (Y + j) >>> 0, k, 16),
      fx - i, fy - j, 0.0 - k, 0.5,
    )
    const lerp = (a, b, f) => a + f * (b - a)
    return lerp(
      lerp(lerp(tap(0, 0, 0), tap(1, 0, 0), fu), lerp(tap(0, 1, 0), tap(1, 1, 0), fu), fv),
      lerp(lerp(tap(0, 0, 1), tap(1, 0, 1), fu), lerp(tap(0, 1, 1), tap(1, 1, 1), fu), fv),
      fade(0.0),
    ) * 0.1 + 0.5
  },
  tap1100: (u, v) => {
    const fx = u * 5.0 - Math.floor(u * 5.0)
    const fy = v * 5.0 - Math.floor(v * 5.0)
    const X = Math.floor(u * 5.0) >>> 0
    const Y = Math.floor(v * 5.0) >>> 0
    return grad4(hashUint4((X + 1) >>> 0, (Y + 1) >>> 0, 0, 16),
      fx - 1.0, fy - 1.0, 0.0, 0.5) * 0.1 + 0.5
  },
  bil0: (u, v) => {
    const fx = u * 5.0 - Math.floor(u * 5.0)
    const fy = v * 5.0 - Math.floor(v * 5.0)
    const X = Math.floor(u * 5.0) >>> 0
    const Y = Math.floor(v * 5.0) >>> 0
    const tap = (i, j) => grad4(
      hashUint4((X + i) >>> 0, (Y + j) >>> 0, 0, 16),
      fx - i, fy - j, 0.0, 0.5,
    )
    const lerp = (a, b, f) => a + f * (b - a)
    return lerp(
      lerp(tap(0, 0), tap(1, 0), fade(fx)),
      lerp(tap(0, 1), tap(1, 1), fade(fx)), fade(fy),
    ) * 0.1 + 0.5
  },
  tap1000: (u, v) => {
    const fx = u * 5.0 - Math.floor(u * 5.0)
    const fy = v * 5.0 - Math.floor(v * 5.0)
    return grad4(hashUint4(
      (Math.floor(u * 5.0) + 1) >>> 0, Math.floor(v * 5.0) >>> 0, 0, 16,
    ), fx - 1.0, fy, 0.0, 0.5) * 0.1 + 0.5
  },
}

// --- browser machinery, cribbed from run.mjs -------------------------------

async function importPlaywright() {
  const candidates = [
    process.env.BLENDLINK_PLAYWRIGHT_MODULE,
    join(repositoryRoot, 'node_modules', 'playwright', 'index.mjs'),
    join(
      repositoryRoot, '..', 'MichaelRoweJonesSite',
      'node_modules', 'playwright', 'index.mjs',
    ),
  ].filter(Boolean)
  for (const candidate of candidates) {
    if (existsSync(candidate)) return await import(pathToFileURL(candidate).href)
  }
  throw new Error(`Playwright is unavailable; looked at: ${candidates.join(', ')}`)
}

const { createServer } = await import(pathToFileURL(join(
  repositoryRoot, 'node_modules', 'vite', 'dist', 'node', 'index.js',
)).href)
const server = await createServer({
  configFile: false,
  root: experimentDir,
  logLevel: 'warn',
  optimizeDeps: { noDiscovery: true },
  server: {
    host: '127.0.0.1',
    port: 0,
    strictPort: false,
    fs: { allow: [repositoryRoot] },
  },
})
await server.listen()
const baseUrl = `http://127.0.0.1:${server.httpServer.address().port}/`

const { chromium } = await importPlaywright()
const executableCandidates = [
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean)
const executablePath = executableCandidates.find((item) => existsSync(item))
if (!executablePath) throw new Error('no Chromium executable found')

const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-unsafe-swiftshader'],
})
const page = await browser.newPage({ viewport: { width: 320, height: 320 } })
const pageErrors = []
page.on('pageerror', (error) => pageErrors.push(String(error)))
page.on('console', (message) => {
  pageErrors.push(`[${message.type()}] ${message.text()}`)
})

try {
  await page.goto(`${baseUrl}debug1d.html`)
  const environment = await page.evaluate(() => window.__debugInit())
  if (!environment.ready || environment.error) {
    throw new Error(`page init failed: ${environment.error}`)
  }
  console.log(`backend=${environment.backend ? 'webgpu' : 'fallback'}`)

  for (const [stage, expected] of Object.entries(EXPECTED)) {
    const rendered = await page.evaluate(
      (id) => window.__debugRun(id), stage,
    )
    if (!rendered.ok) {
      console.log(`${stage.padEnd(10)} RENDER FAILED: ${rendered.error}`)
      continue
    }
    const pixels = new Float32Array(
      Uint8Array.from(atob(rendered.base64), (c) => c.charCodeAt(0)).buffer,
    )
    const components = rendered.components
    // Fields vary in x only; read the top readback row (any row) and also
    // verify rows agree with each other so a y-dependence is itself caught.
    let maxAbs = 0
    let worstColumn = -1
    let worstRow = 0
    let rowSpread = 0
    // Full field: readback rows are top-down, uv().y = 1 at readback row 0.
    for (let row = 0; row < SIZE; row += 1) {
      const vRow = (SIZE - 1 - row + 0.5) / SIZE
      for (let column = 0; column < SIZE; column += 1) {
        const u = (column + 0.5) / SIZE
        const value = pixels[(row * SIZE + column) * components]
        const delta = Math.abs(value - expected(u, vRow))
        if (delta > maxAbs) {
          maxAbs = delta
          worstColumn = column
          worstRow = row
        }
      }
    }
    const verdict = maxAbs < 1e-4 ? 'ok  ' : 'FAIL'
    let detail = ''
    if (maxAbs >= 1e-4) {
      const u = (worstColumn + 0.5) / SIZE
      const vRow = (SIZE - 1 - worstRow + 0.5) / SIZE
      detail = `  worst (${worstRow},${worstColumn}): gpu=${
        pixels[(worstRow * SIZE + worstColumn) * components].toFixed(6)} cpu=${
        expected(u, vRow).toFixed(6)}`
    }
    console.log(`${stage.padEnd(10)} ${verdict} maxAbs=${
      maxAbs.toExponential(2)} rowSpread=${rowSpread.toExponential(1)}${detail}`)
  }
  // Optional: dump one stage's fragment WGSL for reading.
  //   node run-debug1d.mjs <stageId>
  if (process.argv[2]) {
    const dump = await page.evaluate(
      (id) => window.__debugShader(id), process.argv[2],
    )
    const { writeFileSync } = await import('node:fs')
    if (dump.ok) {
      const target = join(experimentDir, `debug1d-${process.argv[2]}.wgsl`)
      writeFileSync(target, dump.fragment ?? '(null)')
      console.log(`fragment WGSL written: ${target}`)
    } else {
      console.log(`shader dump failed: ${dump.error}`)
    }
  }
  if (pageErrors.length) {
    console.log(`page errors:\n  ${pageErrors.slice(0, 5).join('\n  ')}`)
  }
} finally {
  await browser.close()
  await server.close()
}
