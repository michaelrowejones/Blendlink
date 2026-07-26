import { spawnSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Document, NodeIO } from '@gltf-transform/core'

const root = resolve(import.meta.dirname, '..')
const work = mkdtempSync(join(root, '.blendlink-consumer-'))
const tsc = join(root, 'node_modules', 'typescript', 'bin', 'tsc')
const vite = join(root, 'node_modules', 'vite', 'bin', 'vite.js')
const publishedPackageRoot = process.env.BLENDLINK_CONSUMER_PACKAGE_ROOT
  ? resolve(process.env.BLENDLINK_CONSUMER_PACKAGE_ROOT)
  : null
const publishedPackageArchive = process.env.BLENDLINK_CONSUMER_PACKAGE_ARCHIVE
  ? resolve(process.env.BLENDLINK_CONSUMER_PACKAGE_ARCHIVE)
  : null
if (publishedPackageRoot && !existsSync(join(publishedPackageRoot, 'package.json'))) {
  throw new Error(`BLENDLINK_CONSUMER_PACKAGE_ROOT is not a packed Blendlink package: ${publishedPackageRoot}`)
}
if (publishedPackageArchive && !existsSync(publishedPackageArchive)) {
  throw new Error(`BLENDLINK_CONSUMER_PACKAGE_ARCHIVE does not exist: ${publishedPackageArchive}`)
}
if (publishedPackageArchive && !publishedPackageRoot) {
  throw new Error('BLENDLINK_CONSUMER_PACKAGE_ARCHIVE requires BLENDLINK_CONSUMER_PACKAGE_ROOT')
}
const packageUnderTest = publishedPackageRoot ?? join(root, 'packages', 'blendlink')
const workspaceCli = join(packageUnderTest, 'dist', 'cli.js')
const { setupWebsiteProject } = await import(pathToFileURL(
  join(packageUnderTest, 'dist', 'projectSetup.js'),
).href)

function installPublishedPackage(directory) {
  const target = join(directory, 'node_modules', 'blendlink')
  mkdirSync(join(directory, 'node_modules'), { recursive: true })
  // test-package.mjs has already npm-packed and exactly extracted this root.
  // Copying that artifact keeps this release gate deterministic and offline;
  // asking npm to install it with an empty cache silently turns a local test
  // into a registry/network test. The consumer builds below still resolve the
  // artifact's real dependency and peer graph, and the package test separately
  // validates the published manifest and complete tarball file list.
  cpSync(packageUnderTest, target, { recursive: true, errorOnExist: true })
  if (publishedPackageArchive) {
    const nestedThree = join(directory, 'node_modules', 'blendlink', 'node_modules', 'three')
    const nestedTypes = join(directory, 'node_modules', 'blendlink', 'node_modules', '@types', 'three')
    if (existsSync(nestedThree) || existsSync(nestedTypes)) {
      throw new Error(
        'Packed Blendlink installed a private Three.js/type copy instead of using the website-owned peers.',
      )
    }
  }
}

function run(label, command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
  })
  if (result.status === 0 && !result.error) return
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim()
  throw new Error(
    `${label} failed${result.status === null ? '' : ` (exit ${result.status})`}: ` +
      `${result.error?.message ?? output.split(/\r?\n/).slice(-30).join('\n')}`,
  )
}

async function writeGenerated(directory, name) {
  const cli = publishedPackageRoot
    ? join(directory, 'node_modules', 'blendlink', 'dist', 'cli.js')
    : workspaceCli
  const generated = join(directory, 'src', 'generated')
  const models = join(directory, 'public', 'models')
  mkdirSync(generated, { recursive: true })
  mkdirSync(models, { recursive: true })
  const glbPath = join(models, `${name}.glb`)
  const document = new Document()
  document.createScene('Scene').addChild(document.createNode('Realtime Mesh'))
  writeFileSync(glbPath, await new NodeIO().writeBinary(document))
  run(
    `${name} generic typegen`,
    process.execPath,
    [cli, 'typegen', glbPath, '--name', name, '--url', `/models/${name}.glb`, '--out', generated],
    directory,
  )
  const recipePath = join(generated, `${name}.baked.ts`)
  if (!existsSync(recipePath)) {
    throw new Error(`generic typegen did not create its always-importable recipe: ${recipePath}`)
  }
  const artistEdit = `${readFileSync(recipePath, 'utf8')}\n// artist-owned edit\n`
  writeFileSync(recipePath, artistEdit)
  run(
    `${name} repeated generic typegen`,
    process.execPath,
    [cli, 'typegen', glbPath, '--name', name, '--url', `/models/${name}.glb`, '--out', generated],
    directory,
  )
  if (readFileSync(recipePath, 'utf8') !== artistEdit) {
    throw new Error(`generic typegen overwrote the artist-owned recipe: ${recipePath}`)
  }
}

function build(directory, label) {
  run(`${label} TypeScript`, process.execPath, [tsc, '--project', 'tsconfig.json'], directory)
  run(`${label} Vite`, process.execPath, [vite, 'build'], directory)
}

function verifyRootImportWithoutOptionalReact(directory) {
  mkdirSync(directory, { recursive: true })
  installPublishedPackage(directory)
  const loader = join(directory, 'reject-optional-react.mjs')
  const entry = join(directory, 'root-import.mjs')
  writeFileSync(loader, `
export async function resolve(specifier, context, nextResolve) {
  if (
    specifier === 'react' ||
    specifier.startsWith('react/') ||
    specifier === '@react-three/fiber' ||
    specifier.startsWith('@react-three/fiber/')
  ) {
    throw new Error('root Blendlink import reached optional peer ' + specifier)
  }
  return nextResolve(specifier, context)
}
`)
  writeFileSync(entry, `
import { defineConfig } from 'blendlink'
if (typeof defineConfig !== 'function') {
  throw new Error('root Blendlink import lost its renderer-neutral API')
}
`)
  run(
    'renderer-neutral root import without optional React/R3F',
    process.execPath,
    ['--no-warnings', '--experimental-loader', pathToFileURL(loader).href, entry],
    directory,
  )
}

function writeReadonlyDescriptorContract(directory) {
  writeFileSync(join(directory, 'src', 'readonly-descriptor-contract.ts'), `
import type { CompiledSceneDescriptor } from 'blendlink'
import { componentDefinition } from 'blendlink/components'
import {
  collectThreeTextureEvidence,
  type ThreeTextureEvidenceReport,
} from 'blendlink/three'
import type { Object3D } from 'three'

// Typegen publishes one deeply readonly literal. Keep non-null camera and
// nested diagnostics here: empty generic GLBs otherwise hide mutability drift
// between generated modules and the official runtime's input contract.
const generatedDescriptor = {
  url: '/models/readonly.glb?v=test',
  nodes: { Hero_Camera: 'Hero_Camera', Hero_LOD0: 'Hero_LOD0' },
  camera: {
    objectId: 'camera-id', objectName: 'Hero Camera', behavior: 'fixed',
    framing: 'authored',
    compositions: [
      { name: 'Desktop', width: 1440, height: 900, safeMargin: 0.08 },
      { name: 'Mobile', width: 390, height: 844, safeMargin: 0.1 },
    ],
  },
  sceneDiagnostics: {
    lod: {
      chains: [{
        base: 'Hero', valid: true,
        levels: [{
          index: 0, node: 'Hero_LOD0', loadedName: 'Hero_LOD0',
          distance: 0, drawCalls: 1,
        }],
        drawCallsWithoutAdapter: 1, drawCallsWithAdapter: 1,
        warnings: ['compile-only readonly fixture'],
      }],
      validChains: 1, drawCallsWithoutAdapter: 1, drawCallsWithAdapter: 1,
    },
    instances: {
      groups: [], gpuBatches: [], eligibleGroups: 0,
      estimatedDrawCallsCurrent: 1,
      estimatedDrawCallsIfEligibleBatched: 1,
      estimatedDrawCallsSaved: 0,
    },
    procedural: {
      objects: [], blockers: 0, topologyChanging: 0, cacheCandidates: 0,
    },
  },
} as const satisfies CompiledSceneDescriptor

void generatedDescriptor
const bloomDefinition = componentDefinition('blendlink.bloom')
if (!bloomDefinition?.requires.includes('post-pipeline')) {
  throw new Error('browser-safe component metadata subpath lost the Bloom contract')
}
const collectTextureEvidenceContract: (root: Object3D) => ThreeTextureEvidenceReport =
  collectThreeTextureEvidence
void collectTextureEvidenceContract
`)
}

try {
  verifyRootImportWithoutOptionalReact(join(work, 'root-without-react'))

  const vanilla = join(work, 'vanilla')
  await setupWebsiteProject(vanilla)
  installPublishedPackage(vanilla)
  await writeGenerated(vanilla, 'sample')
  writeReadonlyDescriptorContract(vanilla)
  build(vanilla, 'generated Vanilla Three starter')

  const attachedThree = join(work, 'attached-three')
  mkdirSync(join(attachedThree, 'src'), { recursive: true })
  writeFileSync(join(attachedThree, 'package.json'), JSON.stringify({
    private: true,
    type: 'module',
    dependencies: { three: '0.184.0' },
    devDependencies: { '@types/three': '^0.184.0' },
  }, null, 2) + '\n')
  writeFileSync(join(attachedThree, 'hero.blend'), 'discovery fixture only')
  writeFileSync(
    join(attachedThree, 'index.html'),
    '<script type="module" src="/src/main.ts"></script>\n',
  )
  writeFileSync(join(attachedThree, 'tsconfig.json'), JSON.stringify({
    compilerOptions: {
      target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler',
      strict: true, noEmit: true, skipLibCheck: true,
      lib: ['ES2022', 'DOM', 'DOM.Iterable'],
    },
    include: ['src'],
  }, null, 2) + '\n')
  await setupWebsiteProject(attachedThree)
  installPublishedPackage(attachedThree)
  await writeGenerated(attachedThree, 'hero')
  writeFileSync(join(attachedThree, 'src', 'main.ts'), `
export { installHeroScene } from './blendlink/HeroScene'
`)
  build(attachedThree, 'generated existing Vanilla Three integration')

  const r3f = join(work, 'r3f')
  mkdirSync(join(r3f, 'src'), { recursive: true })
  writeFileSync(join(r3f, 'package.json'), JSON.stringify({
    private: true,
    type: 'module',
    scripts: { dev: 'vite', build: 'tsc && vite build' },
    dependencies: {
      '@react-three/fiber': '^9.6.1',
      react: '^19.0.0',
      'react-dom': '^19.0.0',
      three: '0.184.0',
    },
    devDependencies: {
      '@types/react': '^19.0.0',
      '@types/react-dom': '^19.0.0',
      '@types/three': '^0.184.0',
    },
  }, null, 2) + '\n')
  writeFileSync(join(r3f, 'hero.blend'), 'discovery fixture only')
  writeFileSync(join(r3f, 'index.html'), '<div id="root"></div><script type="module" src="/src/main.tsx"></script>\n')
  writeFileSync(join(r3f, 'tsconfig.json'), JSON.stringify({
    compilerOptions: {
      target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler',
      strict: true, noEmit: true, skipLibCheck: true,
      jsx: 'react-jsx',
      lib: ['ES2022', 'DOM', 'DOM.Iterable'],
    },
    include: ['src'],
  }, null, 2) + '\n')
  await setupWebsiteProject(r3f)
  installPublishedPackage(r3f)
  await writeGenerated(r3f, 'hero')
  writeFileSync(join(r3f, 'src', 'main.tsx'), `import { createRoot } from 'react-dom/client'
import { Canvas } from '@react-three/fiber'
import { createUseBlendlink } from 'blendlink/react'
import { HeroScene } from './blendlink/HeroScene'

void createUseBlendlink
const element = document.querySelector('#root')
if (!element) throw new Error('missing root')
createRoot(element).render(
  <Canvas>
    <HeroScene onReady={(installed) => {
    void installed.setStateAsync('Default')
    installed.setLightGroup('Key', { strength: 0.8 })
    installed.playback?.actions[0]?.play()
    }} />
  </Canvas>,
)
`)
  build(r3f, 'generated React Three Fiber integration')
  console.log('BLENDLINK_CONSUMER_BUILDS_PASSED')
} finally {
  const owned = resolve(work)
  if (!owned.startsWith(root) || !owned.includes('.blendlink-consumer-')) {
    throw new Error(`Refusing to remove unexpected consumer-test path: ${owned}`)
  }
  rmSync(owned, { recursive: true, force: true })
}
