import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { readdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
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

export function initProject(root: string): InitResult {
  const configPath = join(root, 'blendlink.config.mjs')
  if (existsSync(configPath) || existsSync(join(root, 'blendlink.config.js'))) {
    return { configPath, scenes: [], created: false, sampleCopied: false }
  }
  let blends = findBlendFiles(root)
  let sampleCopied = false
  if (blends.length === 0 && existsSync(SAMPLE_BLEND)) {
    // No scene yet: drop in the bundled sample so the very first
    // `blendlink sync` produces a working typed module to explore.
    mkdirSync(join(root, 'assets'), { recursive: true })
    copyFileSync(SAMPLE_BLEND, join(root, 'assets', 'sample.blend'))
    blends = ['assets/sample.blend']
    sampleCopied = true
  }
  const sceneLines =
    blends.length > 0
      ? blends.map((file) => `    { file: '${file}' },`).join('\n')
      : `    // { file: 'assets/scene.blend' },`
  const config = `// @ts-check
// blendlink — typed scene modules from .blend files.
// Docs: https://github.com/michaelcup/blendlink
// Each scene becomes <genDir>/<name>.gen.ts + .manifest.json and <outDir>/<name>.glb.
/** @type {import('blendlink').BlendlinkConfig} */
const config = {
  // outDir: 'public/models',   // where GLBs land (served statically)
  // genDir: 'src/generated',   // where typed modules land
  // urlPrefix: '/models',
  scenes: [
${sceneLines}
  ],
}

export default config
`
  writeFileSync(configPath, config)
  return { configPath, scenes: blends, created: true, sampleCopied }
}
