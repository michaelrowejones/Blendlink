import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { createServer } from 'node:http'
import {
  dirname,
  extname,
  join,
  relative,
  resolve,
  sep,
} from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import {
  createAtomicGreenPng,
  createExternalTextureGlb,
} from '../r3f-atomic-presentation-prototype/fixture-assets.mjs'

const experimentRoot = resolve(import.meta.dirname)
const repositoryRoot = resolve(experimentRoot, '..', '..')
const siteRoot = resolve(
  process.env.BLENDLINK_SITE_ROOT ??
    join(repositoryRoot, '..', 'MichaelRoweJonesSite'),
)
const siteNodeModules = join(siteRoot, 'node_modules')
const outputDirectory = join(experimentRoot, 'output')
const workDirectory = mkdtempSync(join(repositoryRoot, '.blendlink-graph-deployment-'))
const npmCli = process.env.npm_execpath ?? join(
  dirname(process.execPath),
  'node_modules',
  'npm',
  'bin',
  'npm-cli.js',
)
const tarCommand = process.platform === 'win32' ? 'tar.exe' : 'tar'

const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable'
const MUTABLE_CACHE_CONTROL = 'public, max-age=0'

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function packageVersion(packagePath) {
  return JSON.parse(readFileSync(packagePath, 'utf8')).version
}

function run(label, command, args, cwd = repositoryRoot) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      NEXT_TELEMETRY_DISABLED: '1',
      npm_config_cache: join(workDirectory, 'npm-cache'),
    },
    maxBuffer: 64 * 1024 * 1024,
    timeout: 10 * 60 * 1000,
    windowsHide: true,
  })
  if (result.status !== 0 || result.error) {
    const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim()
    throw new Error(
      `${label} failed${result.status === null ? '' : ` (exit ${result.status})`}: ` +
        `${result.error?.message ?? output.split(/\r?\n/).slice(-60).join('\n')}`,
    )
  }
  return Object.freeze({
    label,
    stderrTail: (result.stderr ?? '').trim().split(/\r?\n/).filter(Boolean).slice(-12),
    stdoutTail: (result.stdout ?? '').trim().split(/\r?\n/).filter(Boolean).slice(-12),
  })
}

function runNpm(label, args, cwd = repositoryRoot) {
  if (!existsSync(npmCli)) {
    throw new Error(`npm CLI is missing: ${npmCli}`)
  }
  return run(label, process.execPath, [npmCli, ...args], cwd)
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function linkDirectory(target, linkPath) {
  mkdirSync(dirname(linkPath), { recursive: true })
  symlinkSync(resolve(target), linkPath, process.platform === 'win32' ? 'junction' : 'dir')
}

function assertInside(root, path) {
  const child = relative(resolve(root), resolve(path))
  if (!child || child === '..' || child.startsWith(`..${sep}`)) {
    throw new Error(`Static response path escaped its root: ${path}`)
  }
}

function contentType(path) {
  return ({
    '.css': 'text/css; charset=utf-8',
    '.glb': 'model/gltf-binary',
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.md': 'text/markdown; charset=utf-8',
    '.png': 'image/png',
    '.txt': 'text/plain; charset=utf-8',
    '.wasm': 'application/wasm',
  })[extname(path).toLowerCase()] ?? 'application/octet-stream'
}

function createStaticHost({
  root,
  mountPath,
  immutablePolicy,
  matchesImmutablePolicy,
  corsOrigins = null,
}) {
  const requests = []
  const mount = mountPath.endsWith('/') ? mountPath : `${mountPath}/`
  const server = createServer((request, response) => {
    const parsed = new URL(request.url ?? '/', 'http://blendlink.invalid')
    let status = 200
    let decodedPath = ''
    try {
      decodedPath = decodeURIComponent(parsed.pathname)
      if (!decodedPath.startsWith(mount)) {
        status = 404
        response.statusCode = status
        response.end('Not found')
        requests.push({ method: request.method, origin: request.headers.origin ?? null, path: parsed.pathname, status })
        return
      }
      const relativePath = decodedPath.slice(mount.length) || 'index.html'
      if (relativePath.split('/').some((segment) => segment === '..')) {
        throw new Error('traversal')
      }
      const localPath = resolve(root, ...relativePath.split('/'))
      assertInside(root, localPath)
      if (!existsSync(localPath) || !statSync(localPath).isFile()) {
        status = 404
        response.statusCode = status
        response.setHeader('Cache-Control', MUTABLE_CACHE_CONTROL)
        response.end('Not found')
        requests.push({ method: request.method, origin: request.headers.origin ?? null, path: parsed.pathname, status })
        return
      }

      const immutable = matchesImmutablePolicy(parsed.pathname, immutablePolicy)
      response.setHeader(
        'Cache-Control',
        immutable ? IMMUTABLE_CACHE_CONTROL : MUTABLE_CACHE_CONTROL,
      )
      response.setHeader('Content-Type', contentType(localPath))
      response.setHeader('X-Blendlink-Graph-Cache', immutable ? 'immutable' : 'mutable')
      if (corsOrigins) {
        const origin = request.headers.origin
        if (origin && corsOrigins.has(origin)) {
          response.setHeader('Access-Control-Allow-Origin', origin)
          response.setHeader('Vary', 'Origin')
        }
      }
      if (request.method === 'OPTIONS') {
        response.statusCode = 204
        response.end()
      } else {
        response.end(readFileSync(localPath))
      }
      requests.push({
        cacheControl: response.getHeader('Cache-Control'),
        method: request.method,
        origin: request.headers.origin ?? null,
        path: parsed.pathname,
        status,
      })
    } catch (error) {
      status = 400
      response.statusCode = status
      response.end(error instanceof Error ? error.message : String(error))
      requests.push({ method: request.method, origin: request.headers.origin ?? null, path: parsed.pathname, status })
    }
  })
  return Object.freeze({
    requests,
    async listen() {
      await new Promise((resolvePromise, reject) => {
        server.once('error', reject)
        server.listen(0, '127.0.0.1', resolvePromise)
      })
      const address = server.address()
      assert(address && typeof address === 'object')
      return `http://127.0.0.1:${address.port}`
    },
    async close() {
      if (!server.listening) return
      await new Promise((resolvePromise, reject) => {
        server.close((error) => error ? reject(error) : resolvePromise())
      })
    },
  })
}

async function createPublishedGraph(packed) {
  const stageDirectory = join(workDirectory, 'stage')
  const publicationRoot = join(workDirectory, 'published')
  const png = createAtomicGreenPng()
  const assets = [
    { bytes: createExternalTextureGlb('textures/pixel.png'), path: 'scene.glb', role: 'scene' },
    { bytes: png, path: 'textures/pixel.png', role: 'companion' },
    {
      bytes: Buffer.from('/* Blendlink deployment fixture Basis JS */\n'),
      path: 'blendlink-basis/basis_transcoder.js',
      role: 'basis-runtime',
    },
    {
      bytes: Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]),
      path: 'blendlink-basis/basis_transcoder.wasm',
      role: 'basis-runtime',
    },
    {
      bytes: Buffer.from('Blendlink deployment fixture Basis runtime.\n'),
      path: 'blendlink-basis/README.md',
      role: 'basis-runtime',
    },
    {
      bytes: readFileSync(join(repositoryRoot, 'packages', 'blendlink', 'assets', 'basis-apache-2.0.txt')),
      path: 'blendlink-basis/LICENSE',
      role: 'basis-runtime',
    },
  ]
  for (const asset of assets) {
    const destination = join(stageDirectory, ...asset.path.split('/'))
    mkdirSync(dirname(destination), { recursive: true })
    writeFileSync(destination, asset.bytes)
  }

  const sceneAssetGraphPath = join(
    packed.packageRoot,
    'dist',
    'sceneAssetGraph.js',
  )
  const scenePublicationPath = join(
    packed.packageRoot,
    'dist',
    'scenePublication.js',
  )
  const assetUrlsPath = join(packed.packageRoot, 'dist', 'assetUrls.js')
  const [
    { createSceneAssetGraph },
    {
      createSceneRuntimePublication,
      sceneRuntimePublicationUrl,
      sealScenePublication,
    },
    {
      BLENDLINK_IMMUTABLE_CACHE_CONTROL,
      compiledSceneImmutableAssetPolicy,
      matchesCompiledSceneImmutableAssetPolicy,
    },
  ] = await Promise.all([
    import(pathToFileURL(sceneAssetGraphPath).href),
    import(pathToFileURL(scenePublicationPath).href),
    import(pathToFileURL(assetUrlsPath).href),
  ])
  assert.equal(
    BLENDLINK_IMMUTABLE_CACHE_CONTROL,
    IMMUTABLE_CACHE_CONTROL,
    'The browser fixture cache contract drifted from the packed package.',
  )

  const graph = createSceneAssetGraph(assets, { requiresKtx2: true })
  const sealed = sealScenePublication({
    sourceDirectory: stageDirectory,
    destinationParent: join(publicationRoot, 'models', 'hero'),
    graph,
    requiresKtx2: true,
  })
  const runtimeAssetPublication = createSceneRuntimePublication('hero', sealed)
  const sceneUrl = sceneRuntimePublicationUrl(
    '/models/scene.glb',
    runtimeAssetPublication,
    runtimeAssetPublication.scenePath,
  )
  const descriptor = Object.freeze({
    schemaVersion: 3,
    name: 'GraphDeploymentBrowserGate',
    url: sceneUrl,
    nodes: Object.freeze({ Triangle: 'Triangle' }),
    runtimeAssetGraph: graph,
  })
  const immutablePolicies = Object.freeze({
    originRoot: compiledSceneImmutableAssetPolicy(descriptor),
    vite: compiledSceneImmutableAssetPolicy(descriptor, '/portfolio/'),
    cdn: compiledSceneImmutableAssetPolicy(descriptor, '/cdn-root/'),
  })

  // Production activation is the generated module/manifest. This mutable JSON
  // exists only as a negative cache-header probe and is deliberately outside
  // the immutable graph directory.
  const mutableControlPath = join(
    publicationRoot,
    'models',
    'hero',
    'current.json',
  )
  writeJson(mutableControlPath, {
    schema: 'blendlink-graph-deployment-mutable-control-v1',
    runtimeAssetGraph: graph,
    runtimeAssetPublication,
    url: sceneUrl,
  })

  const heroRoot = join(publicationRoot, 'models', 'hero')
  writeFileSync(join(heroRoot, 'stable.txt'), 'mutable stable-path fixture\n')
  const shortDigest = graph.fingerprint.slice(0, 63)
  const malformedDigest = `${shortDigest}g`
  for (const name of [shortDigest, malformedDigest]) {
    mkdirSync(join(heroRoot, name), { recursive: true })
    writeFileSync(join(heroRoot, name, 'lookalike.txt'), 'must not be immutable\n')
  }
  return Object.freeze({
    bundleDirectory: sealed.directory,
    fingerprint: sealed.fingerprint,
    graph,
    immutablePolicies,
    matchesImmutablePolicy: matchesCompiledSceneImmutableAssetPolicy,
    mutableControlPath,
    productionModules: Object.freeze({
      assetUrls: 'dist/assetUrls.js',
      sceneAssetGraph: 'dist/sceneAssetGraph.js',
      scenePublication: 'dist/scenePublication.js',
    }),
    publicationRoot,
    reused: sealed.reused,
    runtimeAssetPublication,
    sceneUrl,
  })
}

function packedBlendlink() {
  const build = runNpm(
    'Blendlink package build',
    ['run', 'build', '--workspace', 'blendlink'],
  )
  const archiveDirectory = join(workDirectory, 'archive')
  mkdirSync(archiveDirectory, { recursive: true })
  const pack = runNpm(
    'Blendlink npm pack',
    ['pack', './packages/blendlink', '--pack-destination', archiveDirectory, '--json'],
  )
  const archives = readdirSync(archiveDirectory).filter((name) => name.endsWith('.tgz'))
  assert.equal(archives.length, 1, `Expected one packed Blendlink archive, found ${archives.length}`)
  const archivePath = join(archiveDirectory, archives[0])
  const unpackDirectory = join(workDirectory, 'unpacked')
  mkdirSync(unpackDirectory, { recursive: true })
  const extract = run(
    'Blendlink tarball extraction',
    tarCommand,
    ['-xzf', archivePath, '-C', unpackDirectory],
  )
  const packageRoot = join(unpackDirectory, 'package')
  assert(existsSync(join(packageRoot, 'dist', 'assetUrls.js')))
  assert(existsSync(join(packageRoot, 'dist', 'sceneAssetGraph.js')))
  assert(existsSync(join(packageRoot, 'dist', 'scenePublication.js')))
  const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'))
  assert.equal(manifest.name, 'blendlink')
  return Object.freeze({
    archivePath,
    build,
    extract,
    manifest,
    packageRoot,
    pack,
    sha256: sha256(readFileSync(archivePath)),
  })
}

function materializeClientCore(destination, published) {
  const template = readFileSync(join(experimentRoot, 'client-core.template.ts'), 'utf8')
  assert(template.includes('__BLENDLINK_GRAPH_JSON__'))
  assert(template.includes('__BLENDLINK_PUBLICATION_JSON__'))
  assert(template.includes('__BLENDLINK_SCENE_URL_JSON__'))
  writeFileSync(
    destination,
    template
      .replace('__BLENDLINK_GRAPH_JSON__', JSON.stringify(published.graph))
      .replace(
        '__BLENDLINK_PUBLICATION_JSON__',
        JSON.stringify(published.runtimeAssetPublication),
      )
      .replace('__BLENDLINK_SCENE_URL_JSON__', JSON.stringify(published.sceneUrl)),
  )
}

function copyPublicGraph(publicationRoot, fixtureRoot) {
  const publicRoot = join(fixtureRoot, 'public')
  mkdirSync(publicRoot, { recursive: true })
  cpSync(join(publicationRoot, 'models'), join(publicRoot, 'models'), {
    recursive: true,
  })
}

function createViteFixture(packed, published) {
  const fixtureRoot = join(workDirectory, 'vite-consumer')
  mkdirSync(join(fixtureRoot, 'src'), { recursive: true })
  linkDirectory(packed.packageRoot, join(fixtureRoot, 'node_modules', 'blendlink'))
  linkDirectory(join(repositoryRoot, 'node_modules', 'three'), join(fixtureRoot, 'node_modules', 'three'))
  writeJson(join(fixtureRoot, 'package.json'), {
    dependencies: {
      blendlink: packed.manifest.version,
      three: packageVersion(join(repositoryRoot, 'node_modules', 'three', 'package.json')),
    },
    private: true,
    type: 'module',
  })
  writeFileSync(join(fixtureRoot, 'index.html'), `<!doctype html>
<html data-state="loading">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <link rel="icon" href="data:,">
    <title>Blendlink Vite graph deployment gate</title>
    <style>
      :root { color-scheme: dark; font: 16px/1.5 Inter, ui-sans-serif, system-ui; background: #090b12; color: #f4f7ff; }
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: radial-gradient(circle at 70% 20%, #243664, transparent 45%), #090b12; }
      main { width: min(720px, calc(100vw - 64px)); padding: 48px; border: 1px solid #32446f; border-radius: 24px; background: #111725e8; box-shadow: 0 30px 100px #0008; }
      .eyebrow { color: #90aef9; letter-spacing: .14em; text-transform: uppercase; }
      h1 { margin: .25rem 0; font-size: clamp(2.2rem, 7vw, 4.8rem); }
      .status { color: #83e6bd; font-weight: 700; }
      dl { display: grid; gap: 12px; }
      dl div { display: grid; grid-template-columns: 140px 1fr; gap: 16px; border-top: 1px solid #ffffff1a; padding-top: 12px; }
      dt { color: #aab6d1; } dd { margin: 0; overflow-wrap: anywhere; }
    </style>
  </head>
  <body><p>Loading graph…</p><script type="module" src="/src/main.ts"></script></body>
</html>
`)
  writeFileSync(join(fixtureRoot, 'vite.config.mjs'), `export default {
  base: '/portfolio/',
  build: { outDir: 'dist' },
}
`)
  materializeClientCore(join(fixtureRoot, 'src', 'client-core.ts'), published)
  writeFileSync(join(fixtureRoot, 'src', 'main.ts'), `import {
  failGraphDeploymentGate,
  runGraphDeploymentGate,
} from './client-core'

const cdn = new URLSearchParams(location.search).get('cdn')
void runGraphDeploymentGate({
  assetBaseUrl: cdn || import.meta.env.BASE_URL,
  host: 'vite',
  transport: cdn ? 'cdn' : 'same-origin',
}).catch(failGraphDeploymentGate)
`)
  copyPublicGraph(published.publicationRoot, fixtureRoot)
  const viteBin = join(repositoryRoot, 'node_modules', 'vite', 'bin', 'vite.js')
  const build = run(
    'packed Vite consumer production build',
    process.execPath,
    [viteBin, 'build', '--configLoader', 'native'],
    fixtureRoot,
  )
  return Object.freeze({ build, fixtureRoot, outputRoot: join(fixtureRoot, 'dist') })
}

function createNextFixture(packed, published) {
  const fixtureRoot = join(workDirectory, 'next-consumer')
  mkdirSync(join(fixtureRoot, 'app'), { recursive: true })
  const packageLinks = {
    '@types': join(siteNodeModules, '@types'),
    blendlink: packed.packageRoot,
    next: join(siteNodeModules, 'next'),
    react: join(siteNodeModules, 'react'),
    'react-dom': join(siteNodeModules, 'react-dom'),
    three: join(siteNodeModules, 'three'),
    typescript: join(siteNodeModules, 'typescript'),
  }
  for (const [name, target] of Object.entries(packageLinks)) {
    if (!existsSync(target)) {
      throw new Error(`Next fixture dependency is missing: ${target}`)
    }
    linkDirectory(target, join(fixtureRoot, 'node_modules', ...name.split('/')))
  }
  writeJson(join(fixtureRoot, 'package.json'), {
    dependencies: {
      blendlink: packed.manifest.version,
      next: packageVersion(join(siteNodeModules, 'next', 'package.json')),
      react: packageVersion(join(siteNodeModules, 'react', 'package.json')),
      'react-dom': packageVersion(join(siteNodeModules, 'react-dom', 'package.json')),
      three: packageVersion(join(siteNodeModules, 'three', 'package.json')),
    },
    devDependencies: {
      '@types/node': packageVersion(join(siteNodeModules, '@types', 'node', 'package.json')),
      '@types/react': packageVersion(join(siteNodeModules, '@types', 'react', 'package.json')),
      '@types/react-dom': packageVersion(join(siteNodeModules, '@types', 'react-dom', 'package.json')),
      typescript: packageVersion(join(siteNodeModules, 'typescript', 'package.json')),
    },
    private: true,
    type: 'module',
  })
  writeFileSync(join(fixtureRoot, 'next-env.d.ts'), `/// <reference types="next" />
/// <reference types="next/image-types/global" />
`)
  writeJson(join(fixtureRoot, 'tsconfig.json'), {
    compilerOptions: {
      allowJs: false,
      esModuleInterop: true,
      incremental: true,
      isolatedModules: true,
      jsx: 'react-jsx',
      lib: ['dom', 'dom.iterable', 'esnext'],
      module: 'esnext',
      moduleResolution: 'bundler',
      noEmit: true,
      plugins: [{ name: 'next' }],
      resolveJsonModule: true,
      skipLibCheck: true,
      strict: true,
      target: 'ES2017',
    },
    exclude: ['node_modules'],
    include: ['next-env.d.ts', '**/*.ts', '**/*.tsx', '.next/types/**/*.ts'],
  })
  const immutableSource =
    `${published.immutablePolicies.originRoot.urlPrefix.replace(/\/$/u, '')}/:path*`
  writeFileSync(join(fixtureRoot, 'next.config.mjs'), `export default {
  basePath: '/portfolio',
  poweredByHeader: false,
  turbopack: {
    root: ${JSON.stringify(resolve(repositoryRoot, '..'))},
  },
  async headers() {
    return [{
      source: ${JSON.stringify(immutableSource)},
      headers: [
        { key: 'Cache-Control', value: ${JSON.stringify(published.immutablePolicies.originRoot.cacheControl)} },
        { key: 'X-Blendlink-Graph-Cache', value: 'immutable' },
      ],
    }]
  },
}
`)
  writeFileSync(join(fixtureRoot, 'app', 'layout.tsx'), `import type { ReactNode } from 'react'

export default function Layout({ children }: { children: ReactNode }) {
  return <html data-state="loading"><head><link rel="icon" href="data:," /><style>{\`
    :root { color-scheme: dark; font: 16px/1.5 Inter, ui-sans-serif, system-ui; background: #090b12; color: #f4f7ff; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: radial-gradient(circle at 70% 20%, #243664, transparent 45%), #090b12; }
    main { width: min(720px, calc(100vw - 64px)); padding: 48px; border: 1px solid #32446f; border-radius: 24px; background: #111725e8; box-shadow: 0 30px 100px #0008; }
    .eyebrow { color: #90aef9; letter-spacing: .14em; text-transform: uppercase; }
    h1 { margin: .25rem 0; font-size: clamp(2.2rem, 7vw, 4.8rem); }
    .status { color: #83e6bd; font-weight: 700; }
    dl { display: grid; gap: 12px; }
    dl div { display: grid; grid-template-columns: 140px 1fr; gap: 16px; border-top: 1px solid #ffffff1a; padding-top: 12px; }
    dt { color: #aab6d1; } dd { margin: 0; overflow-wrap: anywhere; }
  \`}</style></head><body>{children}</body></html>
}
`)
  materializeClientCore(join(fixtureRoot, 'client-core.ts'), published)
  writeFileSync(join(fixtureRoot, 'app', 'page.tsx'), `'use client'

import { useEffect } from 'react'
import {
  failGraphDeploymentGate,
  runGraphDeploymentGate,
} from '../client-core'

export default function Page() {
  useEffect(() => {
    const cdn = new URLSearchParams(location.search).get('cdn')
    void runGraphDeploymentGate({
      assetBaseUrl: cdn || '/portfolio/',
      host: 'next',
      transport: cdn ? 'cdn' : 'same-origin',
    }).catch(failGraphDeploymentGate)
  }, [])
  return <p>Loading graph…</p>
}
`)
  copyPublicGraph(published.publicationRoot, fixtureRoot)
  const nextBin = join(siteNodeModules, 'next', 'dist', 'bin', 'next')
  const build = run('packed Next 16.2.6 consumer production build', process.execPath, [nextBin, 'build'], fixtureRoot)
  return Object.freeze({ build, fixtureRoot })
}

async function startNextProductionServer(fixtureRoot, requireFromSite) {
  const next = requireFromSite('next')
  const app = next({ dev: false, dir: fixtureRoot, quiet: true })
  await app.prepare()
  const handler = app.getRequestHandler()
  const server = createServer((request, response) => {
    void handler(request, response)
  })
  await new Promise((resolvePromise, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolvePromise)
  })
  const address = server.address()
  assert(address && typeof address === 'object')
  return Object.freeze({
    origin: `http://127.0.0.1:${address.port}`,
    async close() {
      await new Promise((resolvePromise, reject) => {
        server.close((error) => error ? reject(error) : resolvePromise())
      })
      await app.close()
    },
  })
}

function lowerCaseHeaders(headers) {
  return Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]),
  )
}

async function exercisePage({
  browser,
  cdnOrigin,
  fingerprint,
  host,
  origin,
  screenshotPath = null,
  transport,
}) {
  const context = await browser.newContext({ serviceWorkers: 'block' })
  const page = await context.newPage()
  const responsePromises = []
  const pageErrors = []
  const consoleErrors = []
  page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('response', (response) => {
    const pathname = new URL(response.url()).pathname
    if (!pathname.includes('/models/hero/')) return
    responsePromises.push((async () => ({
      headers: lowerCaseHeaders(await response.allHeaders()),
      status: response.status(),
      url: response.url(),
    }))())
  })
  const cdnBase = `${cdnOrigin}/cdn-root/`
  const url = transport === 'cdn'
    ? `${origin}/portfolio/?cdn=${encodeURIComponent(cdnBase)}`
    : `${origin}/portfolio/`
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.waitForFunction(() => {
    const state = document.documentElement.dataset.state
    return state === 'ready' || state === 'failed'
  }, null, { timeout: 30_000 })
  const state = await page.evaluate(() => document.documentElement.dataset.state)
  const clientEvidence = await page.evaluate(() => window.__BLENDLINK_GRAPH_GATE__)
  assert.equal(state, 'ready', `${host}/${transport} failed: ${JSON.stringify(clientEvidence)}`)
  assert.equal(clientEvidence.host, host)
  assert.equal(clientEvidence.transport, transport)
  assert.equal(clientEvidence.fingerprint, fingerprint)
  assert.equal(clientEvidence.textureDecoded, true)
  assert.equal(clientEvidence.basisResponses.length, 4)
  assert.equal(pageErrors.length, 0, `${host}/${transport} page errors: ${pageErrors.join('\n')}`)
  assert.equal(consoleErrors.length, 0, `${host}/${transport} console errors: ${consoleErrors.join('\n')}`)

  const responses = await Promise.all(responsePromises)
  const expectedOrigin = transport === 'cdn' ? cdnOrigin : origin
  const expectedPrefix = transport === 'cdn' ? '/cdn-root/' : '/portfolio/'
  const graphPaths = [
    `models/hero/${fingerprint}/scene.glb`,
    `models/hero/${fingerprint}/textures/pixel.png`,
    `models/hero/${fingerprint}/blendlink-basis/basis_transcoder.js`,
    `models/hero/${fingerprint}/blendlink-basis/basis_transcoder.wasm`,
    `models/hero/${fingerprint}/blendlink-basis/README.md`,
    `models/hero/${fingerprint}/blendlink-basis/LICENSE`,
  ]
  for (const graphPath of graphPaths) {
    const expectedPath = `${expectedPrefix}${graphPath}`
    const response = responses.find((candidate) => {
      const parsed = new URL(candidate.url)
      return parsed.origin === expectedOrigin && parsed.pathname === expectedPath
    })
    assert(response, `${host}/${transport} did not request ${expectedOrigin}${expectedPath}`)
    assert.equal(response.status, 200)
    assert.equal(response.headers['cache-control'], IMMUTABLE_CACHE_CONTROL)
    if (transport === 'cdn') {
      assert.equal(response.headers['access-control-allow-origin'], origin)
      assert.match(response.headers.vary ?? '', /(?:^|,\s*)Origin(?:,|$)/i)
    }
  }

  const negativePaths = [
    '/models/hero/current.json',
    '/models/hero/stable.txt',
    `/models/hero/${fingerprint.slice(0, 63)}/lookalike.txt`,
    `/models/hero/${fingerprint.slice(0, 63)}g/lookalike.txt`,
  ]
  for (const negativePath of negativePaths) {
    const expectedPath = `${expectedPrefix}${negativePath.replace(/^\//, '')}`
    const response = responses.find((candidate) => {
      const parsed = new URL(candidate.url)
      return parsed.origin === expectedOrigin && parsed.pathname === expectedPath
    })
    assert(response, `${host}/${transport} did not request negative header probe ${expectedPath}`)
    assert.equal(response.status, 200)
    assert.doesNotMatch(response.headers['cache-control'] ?? '', /immutable/i)
  }

  const leaked = responses.filter((response) => {
    const parsed = new URL(response.url)
    return parsed.origin === origin && parsed.pathname.startsWith('/models/hero/')
  })
  assert.equal(leaked.length, 0, `${host}/${transport} leaked origin-root /models requests`)

  if (screenshotPath) {
    await page.screenshot({ fullPage: true, path: screenshotPath })
  }
  await context.close()
  return Object.freeze({
    clientEvidence,
    consoleErrors,
    pageErrors,
    requestedPage: url,
    responses,
  })
}

async function main() {
  if (!existsSync(join(siteNodeModules, 'next', 'package.json'))) {
    throw new Error(
      `Next fixture requires the dogfood site's installed node_modules. Missing: ${siteNodeModules}`,
    )
  }
  mkdirSync(outputDirectory, { recursive: true })
  const requireFromSite = createRequire(join(siteRoot, 'package.json'))
  const packed = packedBlendlink()
  const published = await createPublishedGraph(packed)
  const vite = createViteFixture(packed, published)
  const next = createNextFixture(packed, published)
  const allowedCorsOrigins = new Set()
  const viteHost = createStaticHost({
    immutablePolicy: published.immutablePolicies.vite,
    matchesImmutablePolicy: published.matchesImmutablePolicy,
    mountPath: '/portfolio/',
    root: vite.outputRoot,
  })
  const cdnHost = createStaticHost({
    corsOrigins: allowedCorsOrigins,
    immutablePolicy: published.immutablePolicies.cdn,
    matchesImmutablePolicy: published.matchesImmutablePolicy,
    mountPath: '/cdn-root/',
    root: published.publicationRoot,
  })
  let nextHost
  let browser
  try {
    const viteOrigin = await viteHost.listen()
    const cdnOrigin = await cdnHost.listen()
    nextHost = await startNextProductionServer(next.fixtureRoot, requireFromSite)
    allowedCorsOrigins.add(viteOrigin)
    allowedCorsOrigins.add(nextHost.origin)
    const { chromium } = requireFromSite('playwright')
    const chromiumCandidates = [
      process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    ].filter(Boolean)
    const systemChromium = chromiumCandidates.find((candidate) => existsSync(candidate))
    browser = await chromium.launch({
      headless: true,
      ...(systemChromium ? {
        args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
        executablePath: systemChromium,
      } : {}),
    })
    const screenshotPath = join(outputDirectory, 'graph-deployment-browser-gate.png')
    const cases = []
    cases.push(await exercisePage({
      browser,
      cdnOrigin,
      fingerprint: published.fingerprint,
      host: 'vite',
      origin: viteOrigin,
      transport: 'same-origin',
    }))
    cases.push(await exercisePage({
      browser,
      cdnOrigin,
      fingerprint: published.fingerprint,
      host: 'vite',
      origin: viteOrigin,
      transport: 'cdn',
    }))
    cases.push(await exercisePage({
      browser,
      cdnOrigin,
      fingerprint: published.fingerprint,
      host: 'next',
      origin: nextHost.origin,
      transport: 'same-origin',
    }))
    cases.push(await exercisePage({
      browser,
      cdnOrigin,
      fingerprint: published.fingerprint,
      host: 'next',
      origin: nextHost.origin,
      screenshotPath,
      transport: 'cdn',
    }))

    const browserVersion = browser.version()
    const evidence = Object.freeze({
      capability: {
        evidenceState: 'Verified local browser gate',
        id: 'NDL-DEP-002',
        implementationState: 'Shipped',
        relation: 'No analogue',
      },
      command: 'node experiments/graph-deployment-browser-gate/run.mjs',
      graph: published.graph,
      productionPublication: {
        immutablePolicies: published.immutablePolicies,
        modules: published.productionModules,
        reused: published.reused,
        runtimeAssetPublication: published.runtimeAssetPublication,
        sceneUrl: published.sceneUrl,
      },
      headerContract: {
        immutable: IMMUTABLE_CACHE_CONTROL,
        mutableNamespace: '/models/hero/',
        rule: 'Only a lower-case, full 64-hex graph directory in the scene namespace receives immutable.',
      },
      limitations: [
        'Second-origin CDN is a local loopback host, not a deployed edge.',
        'Basis closure is fetched but no KTX2 transcode or decoder worker runs.',
        'External PNG is decoded by GLTFLoader but not uploaded by a WebGL renderer.',
        'Vite production output is served by a minimal host adapter; Vite does not own response headers.',
        'Next uses a production server build, not output export.',
        'Anonymous exact-origin CORS only; no credentials, signed URLs, or custom request headers.',
        'Production graph sealing and activation records are exercised from the packed package; this fixture does not execute the full Blender sync pipeline.',
      ],
      needleBaseline: {
        integration: 'mixed-source',
        package: '@needle-tools/engine',
        version: '5.1.7',
      },
      package: {
        archive: packed.manifest.name + '-' + packed.manifest.version + '.tgz',
        sha256: packed.sha256,
        version: packed.manifest.version,
      },
      passedAt: new Date().toISOString(),
      schema: 'blendlink-graph-deployment-browser-evidence-v1',
      status: 'passed',
      toolchain: {
        chromium: browserVersion,
        next: packageVersion(join(siteNodeModules, 'next', 'package.json')),
        node: process.version,
        npm: runNpm('npm version probe', ['--version']).stdoutTail.at(-1),
        playwright: packageVersion(join(siteNodeModules, 'playwright', 'package.json')),
        react: packageVersion(join(siteNodeModules, 'react', 'package.json')),
        three: packageVersion(join(siteNodeModules, 'three', 'package.json')),
        vite: packageVersion(join(repositoryRoot, 'node_modules', 'vite', 'package.json')),
      },
      builds: {
        blendlink: packed.build,
        next: next.build,
        vite: vite.build,
      },
      cases,
      serverRequestLogs: {
        cdn: cdnHost.requests,
        vite: viteHost.requests,
      },
    })
    writeJson(join(outputDirectory, 'evidence.json'), evidence)
    console.log(
      `BLENDLINK_GRAPH_DEPLOYMENT_BROWSER_PASSED ` +
      `graph=${published.fingerprint} vite=7.3.6 next=16.2.6 cases=${cases.length}`,
    )
  } finally {
    if (browser) await browser.close()
    if (nextHost) await nextHost.close()
    await cdnHost.close()
    await viteHost.close()
  }
}

let failure
try {
  await main()
} catch (error) {
  failure = error
  console.error(error)
  process.exitCode = 1
} finally {
  const owned = resolve(workDirectory)
  if (!owned.startsWith(`${repositoryRoot}${sep}.blendlink-graph-deployment-`)) {
    throw new Error(`Refusing to remove unexpected graph deployment work directory: ${owned}`)
  }
  rmSync(owned, { force: true, recursive: true })
}
if (failure) {
  process.exitCode = 1
}
