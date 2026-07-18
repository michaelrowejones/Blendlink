import { existsSync, writeFileSync } from 'node:fs'
import { readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

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
}

export function initProject(root: string): InitResult {
  const configPath = join(root, 'blendlink.config.mjs')
  if (existsSync(configPath) || existsSync(join(root, 'blendlink.config.js'))) {
    return { configPath, scenes: [], created: false }
  }
  const blends = findBlendFiles(root)
  const sceneLines =
    blends.length > 0
      ? blends.map((file) => `    { file: '${file}' },`).join('\n')
      : `    // { file: 'assets/scene.blend' },`
  const config = `// blendlink — typed scene modules from .blend files.
// Docs: https://github.com/michaelcup/blendlink
// Each scene becomes <genDir>/<name>.gen.ts + .manifest.json and <outDir>/<name>.glb.
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
  return { configPath, scenes: blends, created: true }
}
