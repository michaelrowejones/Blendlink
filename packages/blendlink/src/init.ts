import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { readdirSync } from 'node:fs'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Bundled sample scene — resolves from src/ and dist/ alike. */
const SAMPLE_BLEND = join(
  dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'sample.blend',
)

const SKIP_DIRS = new Set(['node_modules', '.git', '.next', 'dist', 'out', 'build'])
const MAX_DEPTH = 4

/** Find .blend files near the project root (bounded, skips build output). */
export function findBlendFiles(root: string): string[] {
  const found: string[] = []
  const walk = (directory: string, depth: number) => {
    let entries
    try {
      entries = readdirSync(directory, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (depth < MAX_DEPTH && !SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
          walk(join(directory, entry.name), depth + 1)
        }
      } else if (/\.blend$/i.test(entry.name)) {
        found.push(relative(root, join(directory, entry.name)).replace(/\\/g, '/'))
      }
    }
  }
  walk(root, 0)
  return found.sort()
}

export interface InitResult {
  configPath: string
  scenes: string[]
  created: boolean
  /** True when the bundled sample.blend was copied in (no blends existed). */
  sampleCopied: boolean
}

export interface InitProjectOptions {
  /** Explicit scene handoff from Preview/Blender. Paths may live outside the
   * website; the generated project link remains relative when possible. */
  sceneFiles?: string[]
}

export function initProject(root: string, options: InitProjectOptions = {}): InitResult {
  const configPath = join(root, 'blendlink.config.mjs')
  if (existsSync(configPath) || existsSync(join(root, 'blendlink.config.js'))) {
    return { configPath, scenes: [], created: false, sampleCopied: false }
  }
  let blends = options.sceneFiles?.map((file) => {
    const absolute = resolve(file)
    if (extname(absolute).toLowerCase() !== '.blend') {
      throw new Error(`Blendlink connect expected a .blend file, received ${absolute}`)
    }
    if (!existsSync(absolute)) {
      throw new Error(`Blendlink connect cannot find the selected scene: ${absolute}`)
    }
    return relative(root, absolute).replace(/\\/g, '/')
  }) ?? findBlendFiles(root)
  let sampleCopied = false
  if (blends.length === 0 && existsSync(SAMPLE_BLEND)) {
    // No scene yet: drop in the bundled sample so the very first
    // `blendlink compile` produces a working typed module to explore.
    mkdirSync(join(root, 'assets'), { recursive: true })
    copyFileSync(SAMPLE_BLEND, join(root, 'assets', 'sample.blend'))
    blends = ['assets/sample.blend']
    sampleCopied = true
  }
  const sceneLines =
    blends.length > 0
      ? blends.map((file) => `    { file: ${JSON.stringify(file)} },`).join('\n')
      : `    // { file: 'assets/scene.blend' },`
  const config = `// @ts-check
// blendlink — artist-authored Blender scenes compiled for Three.js.
// Docs: https://github.com/michaelrowejones/Blendlink
// Each scene becomes <genDir>/<name>.gen.ts + .manifest.json and <outDir>/<name>.glb.
/** @type {import('blendlink').BlendlinkConfig} */
const config = {
  // outDir: 'public/models',   // where GLBs land (served statically)
  // genDir: 'src/generated',   // where typed modules land
  // urlPrefix: '/models',
  // Website preview is auto-detected from package.json. For monorepos or
  // unusual dev servers, make the integration explicit (art settings stay in Blender):
  // website: { root: '.', devCommand: 'npm run dev', url: 'http://localhost:5173' },
  scenes: [
${sceneLines}
  ],
}

export default config
`
  writeFileSync(configPath, config)
  return { configPath, scenes: blends, created: true, sampleCopied }
}
