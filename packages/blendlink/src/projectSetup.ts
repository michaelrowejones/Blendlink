import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { loadConfig, type ResolvedScene } from './config.js'
import { initProject, type InitResult } from './init.js'
import { websitePackageRunner } from './packageRunner.js'

export type WebsiteStack = 'new-three-vite' | 'three' | 'react-three-fiber'

export interface WebsiteSetupResult {
  root: string
  stack: WebsiteStack
  config: InitResult
  sceneName: string
  changes: string[]
  warnings: string[]
  nextActions: string[]
}

export interface WebsiteSetupOptions {
  /** Scene selected in Preview Studio or Blender. New configs connect this
   * exact file instead of scanning; existing executable configs must already
   * declare it and are never rewritten. */
  blendPath?: string
}

interface PackageJson {
  name?: string
  packageManager?: string
  scripts?: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  [key: string]: unknown
}

const SETUP_SCRIPTS = {
  'blendlink:connect': 'blendlink connect',
  'blendlink:preview': 'blendlink preview',
  'blendlink:publish': 'blendlink publish',
  'blendlink:check': 'blendlink verify',
} as const

const STARTER_MARKER = '// Blendlink starter: this entry point is application-owned and safe to edit.'
const DEFAULT_THREE_RANGE = '0.184.0'
const DEFAULT_THREE_TYPES_RANGE = '^0.184.0'
const REQUIRED_THREE_RELEASE = 184
const REQUIRED_REACT_MAJOR = 19
const REQUIRED_R3F_MAJOR = 9

function threeRelease(range: string): number | null {
  const match = /^(?:\^|~)?0\.(\d+)(?:\.(\d+))?$/.exec(range.trim())
  return match ? Number(match[1]) : null
}

function assertSupportedThreeRange(range: string): void {
  const normalized = range.trim().replace(/\s+/g, ' ')
  if (normalized === DEFAULT_THREE_RANGE) return
  throw new Error(
    `This website declares three=${JSON.stringify(range)}, but Blendlink requires the exact ` +
      `source-audited Three ${DEFAULT_THREE_RANGE} runtime. Version ranges can resolve to ` +
      'unaudited executable bytes. Declare exact "0.184.0", then rerun setup.',
  )
}

function assertSupportedMajorRange(
  dependency: string,
  range: string,
  expectedMajor: number,
): void {
  const trimmed = range.trim()
  const simple = /^(?:\^|~)?(\d+)(?:\.(?:\d+|x|\*))?(?:\.(?:\d+|x|\*))?$/.exec(trimmed)
  if (simple && Number(simple[1]) === expectedMajor) return

  const hyphen = /^(\d+)(?:\.\d+){0,2}\s+-\s+(\d+)(?:\.\d+){0,2}$/.exec(trimmed)
  if (hyphen && Number(hyphen[1]) === expectedMajor && Number(hyphen[2]) === expectedMajor) return

  const comparators = [...trimmed.matchAll(/(?:^|\s)(>=|>|<=|<)\s*(\d+)(?:\.\d+){0,2}(?=\s|$)/g)]
  const remainder = trimmed
    .replace(/(?:^|\s)(?:>=|>|<=|<)\s*\d+(?:\.\d+){0,2}(?=\s|$)/g, ' ')
    .trim()
  if (comparators.length > 0 && remainder === '') {
    const hasExpectedLower = comparators.some(
      (match) => (match[1] === '>=' || match[1] === '>') && Number(match[2]) === expectedMajor,
    )
    const hasExpectedUpper = comparators.some(
      (match) => match[1] === '<' && Number(match[2]) === expectedMajor + 1,
    )
    if (hasExpectedLower && hasExpectedUpper) return
  }

  throw new Error(
    `This website declares ${dependency}=${JSON.stringify(range)}, but Blendlink's generated ` +
      `R3F adapter requires ${dependency} ${expectedMajor}.x. Align React 19 with React Three ` +
      'Fiber 9 before connecting this site.',
  )
}

function matchingThreeTypesRange(range: string): string | null {
  const trimmed = range.trim()
  const match = /^(?:\^|~)?0\.(\d+)(?:\.(?:\d+|x|\*))?$/.exec(trimmed)
  if (match) return `^0.${match[1]}.0`
  return trimmed.replace(/\s+/g, ' ') === '>=0.184.0 <0.185.0'
    ? DEFAULT_THREE_TYPES_RANGE
    : null
}

function packageVersion(): string {
  try {
    const packageJson = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { version?: string }
    if (!packageJson.version) throw new Error('package.json has no version')
    return packageJson.version
  } catch (error) {
    throw new Error(
      'Blendlink cannot determine its package version; reinstall the package before setup: ' +
        (error instanceof Error ? error.message : String(error)),
    )
  }
}

function readPackage(path: string): PackageJson {
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as unknown
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('the root value must be an object')
    }
    return value as PackageJson
  } catch (error) {
    throw new Error(
      `Blendlink found ${path}, but it is not valid package JSON: ` +
        (error instanceof Error ? error.message : String(error)),
    )
  }
}

function dependencies(pkg: PackageJson): Record<string, string> {
  return { ...pkg.dependencies, ...pkg.devDependencies }
}

function detectExistingStack(pkg: PackageJson): Exclude<WebsiteStack, 'new-three-vite'> {
  const packages = dependencies(pkg)
  const declaredThree = packages.three
  if (declaredThree) assertSupportedThreeRange(declaredThree)
  if ('@react-three/fiber' in packages) {
    assertSupportedMajorRange(
      '@react-three/fiber',
      packages['@react-three/fiber']!,
      REQUIRED_R3F_MAJOR,
    )
    if (!packages.react) {
      throw new Error(
        'This R3F website does not declare `react`. Blendlink requires the website to own ' +
          'React 19 with React Three Fiber 9 before connecting it.',
      )
    }
    assertSupportedMajorRange('react', packages.react, REQUIRED_REACT_MAJOR)
    return 'react-three-fiber'
  }
  if ('three' in packages) return 'three'
  throw new Error(
    'This directory already contains a website, but package.json does not declare `three` ' +
      'or `@react-three/fiber`. Blendlink will not replace its renderer. Run setup from the ' +
      'actual Three.js site directory (or add the renderer deliberately), then try again.',
  )
}

function exportName(file: string): string {
  const stem = basename(file).replace(/\.blend$/i, '')
  const cleaned = stem.replace(/[^A-Za-z0-9]+(\w)/g, (_, letter: string) => letter.toUpperCase())
  return /^[A-Za-z_$]/.test(cleaned) ? cleaned : `scene${cleaned}`
}

function writeNewSite(root: string, sceneName: string, changes: string[]): void {
  const guarded = [
    'index.html', 'tsconfig.json', join('src', 'main.ts'), join('src', 'style.css'),
  ]
  const conflicts = guarded.filter((path) => existsSync(join(root, path)))
  if (conflicts.length > 0) {
    throw new Error(
      'Blendlink will not overwrite an incomplete website scaffold. Move or remove these ' +
        `files, then retry: ${conflicts.join(', ')}`,
    )
  }

  const version = packageVersion()
  const packageJson = {
    name: basename(root).toLowerCase().replace(/[^a-z0-9-]+/g, '-') || 'blendlink-scene',
    private: true,
    version: '0.0.0',
    type: 'module',
    scripts: {
      dev: 'vite',
      build: 'tsc && vite build',
      ...SETUP_SCRIPTS,
    },
    dependencies: {
      blendlink: `^${version}`,
      three: DEFAULT_THREE_RANGE,
    },
    devDependencies: {
      '@types/three': DEFAULT_THREE_TYPES_RANGE,
      typescript: '^5.9.0',
      vite: '^7.0.0',
    },
  }
  writeFileSync(join(root, 'package.json'), JSON.stringify(packageJson, null, 2) + '\n')
  changes.push('created a minimal Three.js + Vite package.json (dependencies are declared, not installed)')

  writeFileSync(join(root, 'index.html'), `<!doctype html>
<html lang="en">
  <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Blendlink Scene</title></head>
  <body><canvas id="scene" aria-label="3D scene"></canvas><script type="module" src="/src/main.ts"></script></body>
</html>
`)
  writeFileSync(join(root, 'tsconfig.json'), JSON.stringify({
    compilerOptions: {
      target: 'ES2022', useDefineForClassFields: true, module: 'ESNext',
      moduleResolution: 'Bundler', strict: true, noEmit: true,
      lib: ['ES2022', 'DOM', 'DOM.Iterable'], skipLibCheck: true,
    },
    include: ['src'],
  }, null, 2) + '\n')
  mkdirSync(join(root, 'src'), { recursive: true })
  const integrationName = sceneIntegrationName(sceneName)
  writeFileSync(join(root, 'src', 'main.ts'), `${STARTER_MARKER}
import * as THREE from 'three'
import { install${integrationName} } from './blendlink/${integrationName}'
import './style.css'

const canvasElement = document.querySelector<HTMLCanvasElement>('#scene')
if (!canvasElement) throw new Error('Blendlink starter: #scene canvas is missing')
const canvas: HTMLCanvasElement = canvasElement

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
const world = new THREE.Scene()

const installed = await install${integrationName}({
  renderer,
  scene: world,
})
let lastWidth = 0
let lastHeight = 0
let previousTime = performance.now()

function frame(now: number) {
  const width = canvas.clientWidth
  const height = canvas.clientHeight
  if (width > 0 && height > 0 && (width !== lastWidth || height !== lastHeight)) {
    installed.resize(width, height)
    lastWidth = width
    lastHeight = height
  }
  const deltaSeconds = Math.max(0, (now - previousTime) / 1000)
  previousTime = now
  installed.update(deltaSeconds)
  installed.render(deltaSeconds)
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
window.addEventListener('beforeunload', () => installed.dispose(), { once: true })
`)
  writeFileSync(join(root, 'src', 'style.css'), `html, body, #scene { width: 100%; height: 100%; margin: 0; display: block; }
body { overflow: hidden; background: #101116; }
`)
  changes.push('created index.html and a small, user-owned Three.js entry point')
}

function sourceImportPath(fromDirectory: string, file: string): string {
  const withoutExtension = relative(fromDirectory, file).replace(/\\/g, '/').replace(/\.ts$/, '')
  return withoutExtension.startsWith('.') ? withoutExtension : `./${withoutExtension}`
}

function sceneIntegrationName(sceneName: string): string {
  const capitalized = `${sceneName[0]!.toUpperCase()}${sceneName.slice(1)}`
  return /Scene$/i.test(capitalized) ? capitalized : `${capitalized}Scene`
}

function assertUniqueIntegrationNames(scenes: ResolvedScene[]): void {
  const seen = new Map<string, { sceneName: string; integrationName: string }>()
  for (const scene of scenes) {
    const integrationName = sceneIntegrationName(scene.name)
    const previous = seen.get(integrationName.toLowerCase())
    if (previous) {
      throw new Error(
        `Blendlink scenes "${previous.sceneName}" and "${scene.name}" both map to the ` +
          `website integration ${integrationName}.ts. Give one scene a distinct name so setup ` +
          'cannot silently connect both scenes to the same module.',
      )
    }
    seen.set(integrationName.toLowerCase(), { sceneName: scene.name, integrationName })
  }
}

function isBlendlinkStarter(root: string): boolean {
  const entry = join(root, 'src', 'main.ts')
  return existsSync(entry) && readFileSync(entry, 'utf8').includes(STARTER_MARKER)
}

function writeThreeIntegration(
  root: string,
  sceneName: string,
  generatedModulePath: string,
  changes: string[],
): string {
  const integrationName = sceneIntegrationName(sceneName)
  const installName = `install${integrationName}`
  const directory = join(root, 'src', 'blendlink')
  const path = join(directory, `${integrationName}.ts`)
  if (existsSync(path)) return relative(root, path).replace(/\\/g, '/')
  mkdirSync(directory, { recursive: true })
  const generatedImport = sourceImportPath(directory, generatedModulePath)
  const bakedImport = sourceImportPath(
    directory,
    generatedModulePath.replace(/\.gen\.ts$/, '.baked.ts'),
  )
  writeFileSync(path, `import {
  installThreeCompiledScene,
  type InstallThreeCompiledSceneOptions,
  type InstalledThreeCompiledScene,
} from 'blendlink/three'
import { ${sceneName} as compiledScene } from '${generatedImport}'
import { createBakedScene } from '${bakedImport}'

export type ${integrationName}Options = Omit<
  InstallThreeCompiledSceneOptions,
  'descriptor' | 'createBakedScene'
>

/** Blendlink generated this integration once; it is application-owned and
 * safe to edit. Call update() in the website frame loop and dispose() when
 * the route or scene is removed. */
export function ${installName}(
  options: ${integrationName}Options,
): Promise<InstalledThreeCompiledScene> {
  return installThreeCompiledScene({
    ...options,
    descriptor: compiledScene,
    createBakedScene,
  })
}
`)
  const display = relative(root, path).replace(/\\/g, '/')
  changes.push(`created user-owned Three.js scene integration ${display}`)
  return display
}

function writeR3fIntegration(
  root: string,
  sceneName: string,
  generatedModulePath: string,
  changes: string[],
): string {
  const componentName = sceneIntegrationName(sceneName)
  const directory = join(root, 'src', 'blendlink')
  const path = join(directory, `${componentName}.ts`)
  if (existsSync(path)) return relative(root, path).replace(/\\/g, '/')
  mkdirSync(directory, { recursive: true })
  const generatedImport = sourceImportPath(directory, generatedModulePath)
  const bakedImport = sourceImportPath(
    directory,
    generatedModulePath.replace(/\.gen\.ts$/, '.baked.ts'),
  )
  writeFileSync(path, `'use client'

import {
  createR3FCompiledScene,
  type R3FCompiledSceneProps,
} from 'blendlink/react-three-fiber'
import { ${sceneName} as compiledScene } from '${generatedImport}'
import { createBakedScene } from '${bakedImport}'

export type ${componentName}Props = R3FCompiledSceneProps

/** Application-owned association; Blendlink's adapter owns loader, camera,
 * resize, frame, composer, error, and disposal lifecycle behind this seam. */
export const ${componentName} = createR3FCompiledScene({
  descriptor: compiledScene,
  createBakedScene,
  displayName: '${componentName}',
})

/** Ready-only access for application behavior mounted beneath ${componentName}. */
export const use${componentName} = ${componentName}.useScene
`)
  const display = relative(root, path).replace(/\\/g, '/')
  changes.push(`created user-owned R3F scene integration ${display}`)
  return display
}

function attachScripts(
  packagePath: string,
  pkg: PackageJson,
  stack: Exclude<WebsiteStack, 'new-three-vite'>,
  changes: string[],
  warnings: string[],
): boolean {
  const scripts = { ...pkg.scripts }
  let changed = false
  let scriptsAdded = false
  let dependenciesChanged = false
  for (const [name, command] of Object.entries(SETUP_SCRIPTS)) {
    const current = scripts[name]
    if (current && current !== command) {
      warnings.push(`kept existing package script ${name}=${JSON.stringify(current)}; Blendlink did not overwrite it`)
      continue
    }
    if (!current) {
      scripts[name] = command
      changed = true
      scriptsAdded = true
    }
  }
  const declared = dependencies(pkg)
  const packageChanges: PackageJson = { ...pkg, scripts }
  if (!('blendlink' in declared)) {
    packageChanges.dependencies = {
      ...pkg.dependencies,
      blendlink: `^${packageVersion()}`,
    }
    changed = true
    dependenciesChanged = true
    changes.push('declared Blendlink as a website dependency (installation remains package-manager owned)')
  }

  let threeRange = pkg.dependencies?.three ?? pkg.devDependencies?.three
  if (!threeRange && stack === 'react-three-fiber') {
    packageChanges.dependencies = {
      ...packageChanges.dependencies,
      three: DEFAULT_THREE_RANGE,
    }
    threeRange = DEFAULT_THREE_RANGE
    changed = true
    dependenciesChanged = true
    changes.push('declared the app-owned Three.js runtime required by React Three Fiber')
  }

  if (threeRange) {
    assertSupportedThreeRange(threeRange)
    if (!('@types/three' in declared)) {
      const typesRange = matchingThreeTypesRange(threeRange)
      if (typesRange) {
        packageChanges.devDependencies = {
          ...packageChanges.devDependencies,
          '@types/three': typesRange,
        }
        changed = true
        dependenciesChanged = true
        changes.push(`declared app-owned @types/three ${typesRange} to match Three.js`)
      } else {
        warnings.push(
          `Three.js is declared as ${JSON.stringify(threeRange)}, so Blendlink did not guess a type ` +
            'release. Declare a matching @types/three version before compiling the generated TypeScript.',
        )
      }
    } else {
      const typesRange = pkg.dependencies?.['@types/three'] ?? pkg.devDependencies?.['@types/three']
      const typesRelease = typesRange ? threeRelease(typesRange) : null
      const runtimeRelease = threeRelease(threeRange)
      if (runtimeRelease !== null && typesRelease !== null && runtimeRelease !== typesRelease) {
        warnings.push(
          `Three.js r${runtimeRelease} and @types/three r${typesRelease} do not match. ` +
            'Align them before compiling Blendlink integrations to avoid duplicate renderer types.',
        )
      }
    }
  }
  if (!changed) return dependenciesChanged
  writeFileSync(packagePath, JSON.stringify(packageChanges, null, 2) + '\n')
  if (scriptsAdded) {
    changes.push('added available blendlink:connect, blendlink:preview, blendlink:publish, and blendlink:check package scripts')
  }
  return dependenciesChanged
}

/**
 * Attach Blendlink to a real Three.js/R3F site, or create the smallest useful
 * vanilla Three.js/Vite site when the directory has no package.json. Existing
 * application source is never edited and ambiguous renderers fail loudly.
 */
export async function setupWebsiteProject(
  targetRoot: string,
  options: WebsiteSetupOptions = {},
): Promise<WebsiteSetupResult> {
  const root = resolve(targetRoot)
  mkdirSync(root, { recursive: true })
  const packagePath = join(root, 'package.json')
  const existing = existsSync(packagePath)
  const pkg = existing ? readPackage(packagePath) : undefined
  const stack = pkg ? detectExistingStack(pkg) : 'new-three-vite'
  const changes: string[] = []
  const warnings: string[] = []
  let dependencyInstallRequired = stack === 'new-three-vite'

  if (stack === 'new-three-vite') {
    const conflicts = [
      'index.html', 'tsconfig.json', join('src', 'main.ts'), join('src', 'style.css'),
    ].filter((path) => existsSync(join(root, path)))
    if (conflicts.length > 0) {
      throw new Error(
        'Blendlink will not overwrite an incomplete website scaffold. Move or remove these ' +
          `files, then retry: ${conflicts.join(', ')}`,
      )
    }
  }

  // Scene discovery and the optional bundled sample stay behind initProject;
  // setup composes that contract instead of growing a second scanner.
  const selectedBlendPath = options.blendPath ? resolve(options.blendPath) : undefined
  const initialized = initProject(root, selectedBlendPath ? { sceneFiles: [selectedBlendPath] } : {})
  const config: InitResult = initialized.created
    ? initialized
    : {
        ...initialized,
        configPath: existsSync(join(root, 'blendlink.config.mjs'))
          ? join(root, 'blendlink.config.mjs')
          : join(root, 'blendlink.config.js'),
      }
  if (config.created) changes.push(`created ${basename(config.configPath)}`)
  else warnings.push('kept the existing Blendlink config; setup never rewrites integration paths')
  if (config.sampleCopied) changes.push('copied the bundled sample scene to assets/sample.blend')

  const resolvedConfig = await loadConfig(root)
  assertUniqueIntegrationNames(resolvedConfig.scenes)
  const scene = selectedBlendPath
    ? resolvedConfig.scenes.find((candidate) => resolve(candidate.blendPath) === selectedBlendPath)
    : resolvedConfig.scenes[0]
  if (!scene) {
    throw new Error(selectedBlendPath
      ? `${basename(config.configPath)} already exists but does not declare the selected scene ` +
        `${selectedBlendPath}. Add it to scenes, then rerun connect; Blendlink never rewrites executable config.`
      : `${basename(config.configPath)} does not declare a scene. Add one .blend file, then rerun connect.`)
  }
  const sceneFile = relative(root, scene.blendPath).replace(/\\/g, '/')
  const sceneName = scene.name || exportName(sceneFile)
  for (const configuredScene of resolvedConfig.scenes) {
    mkdirSync(dirname(configuredScene.glbPath), { recursive: true })
    mkdirSync(dirname(configuredScene.modulePath), { recursive: true })
  }

  const existingStarter = stack === 'three' && isBlendlinkStarter(root)
  if (stack === 'new-three-vite') {
    writeNewSite(root, sceneName, changes)
    if (resolvedConfig.scenes.length > 1) {
      warnings.push(
        `the starter renders ${sceneName}; ${resolvedConfig.scenes.length - 1} additional configured ` +
          'scene(s) each have a user-owned integration ready to load',
      )
    }
  } else if (pkg) {
    dependencyInstallRequired = attachScripts(packagePath, pkg, stack, changes, warnings)
    if (existingStarter) {
      warnings.push('recognized the Blendlink starter and kept its application-owned entry point')
    } else {
      changes.push(
        `attached the ${stack === 'react-three-fiber' ? 'React Three Fiber' : 'Three.js'} site without editing application source`,
      )
    }
  }
  const r3fIntegrations = stack === 'react-three-fiber'
    ? resolvedConfig.scenes.map((configuredScene) => writeR3fIntegration(
        root,
        configuredScene.name,
        configuredScene.modulePath,
        changes,
      ))
    : []
  const threeIntegrations = stack === 'three' || stack === 'new-three-vite'
    ? resolvedConfig.scenes.map((configuredScene) => writeThreeIntegration(
        root,
        configuredScene.name,
        configuredScene.modulePath,
        changes,
      ))
    : []

  const packageRunner = websitePackageRunner(root, readPackage(packagePath))
  const run = (script: keyof typeof SETUP_SCRIPTS) =>
    `${packageRunner} ${script}`
  const displayDirectory = (directory: string) =>
    relative(root, directory).replace(/\\/g, '/') || '.'
  const commitDirectories = [...new Set(resolvedConfig.scenes.flatMap((configuredScene) => [
    displayDirectory(dirname(configuredScene.glbPath)),
    displayDirectory(dirname(configuredScene.modulePath)),
  ]))].join(', ')
  return {
    root,
    stack,
    config,
    sceneName,
    changes,
    warnings,
    nextActions: [
      ...(dependencyInstallRequired ? ['install the declared website dependencies with your package manager'] : []),
      `open ${sceneFile} and click Blendlink > Set Up Blendlink Scene`,
      ...r3fIntegrations.map((integration) =>
        `render the exported scene in a WebGL R3F Canvas with <${basename(integration, '.ts')} /> from ${integration}`),
      ...threeIntegrations.slice(stack === 'new-three-vite' || existingStarter ? 1 : 0).map((integration) => {
        const integrationName = basename(integration, '.ts')
        return `load the exported scene in a Three WebGLRenderer with await install${integrationName}({ renderer, scene }) from ${integration}`
      }),
      `run ${run('blendlink:preview')} to compile Preview quality and open the real site`,
      `run ${run('blendlink:publish')} when the scene is approved; it compiles Final, verifies it, and runs the website build`,
      `commit ${commitDirectories}, and ${basename(config.configPath)}`,
    ],
  }
}
