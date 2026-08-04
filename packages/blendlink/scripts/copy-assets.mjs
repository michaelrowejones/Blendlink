// The in-Blender Python ships beside the compiled JS under the file-level
// licenses mapped in LICENSES.md. EVERY .py in blender/ is copied so a new
// module can never be silently missing from dist (bakelib.py was, once).
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const packageVersion = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
const addonManifestText = readFileSync(
  join(root, '..', 'blender-addon', 'blender_manifest.toml'),
  'utf8',
)
const addonVersion = addonManifestText.match(/^version\s*=\s*"([^"]+)"/m)?.[1]
const addonId = addonManifestText.match(/^id\s*=\s*"([^"]+)"/m)?.[1]
const semver = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
if (addonId !== 'blendlink' || !semver.test(packageVersion) ||
    !addonVersion || !semver.test(addonVersion) || addonVersion !== packageVersion) {
  throw new Error(
    `Blendlink release identity mismatch: npm ${String(packageVersion)}, ` +
      `Blender addon ${String(addonId)}@${String(addonVersion)}`,
  )
}
mkdirSync(join(root, 'dist', 'blender'), { recursive: true })
for (const entry of readdirSync(join(root, 'blender'))) {
  if (!entry.endsWith('.py')) continue
  copyFileSync(join(root, 'blender', entry), join(root, 'dist', 'blender', entry))
}
// Several Blender-side policies are authored once with the addon and used by
// the headless exporter too: procedural diagnostics (one analyze_scene seam),
// website-material planning, GLB read/write, the node->TSL IR emitter,
// realtime-light units and render visibility, reflection-probe validation,
// and authored NLA sequencing.
//
// Which ones those are is DERIVED, not listed. A hand-written list here
// shipped an exporter that could not import itself the first time one of
// these modules grew a new sibling, and that failure only surfaced in an
// isolated extension install. The closure below reads the same `import x`
// statements Python will execute and follows them until nothing new appears,
// so adding an import is the only step required.
const addonDir = join(root, '..', 'blender-addon')
const addonModules = new Set(
  readdirSync(addonDir).filter((entry) => entry.endsWith('.py'))
    .map((entry) => entry.slice(0, -3)),
)
const distBlender = join(root, 'dist', 'blender')
const copiedFromAddon = new Set()
const pending = readdirSync(distBlender).filter((entry) => entry.endsWith('.py'))
  .map((entry) => join(distBlender, entry))
while (pending.length) {
  const source = readFileSync(pending.pop(), 'utf8')
  for (const match of source.matchAll(/^[ \t]*(?:import|from)[ \t]+([A-Za-z_][A-Za-z0-9_]*)/gm)) {
    const name = match[1]
    if (!addonModules.has(name) || copiedFromAddon.has(name)) continue
    copiedFromAddon.add(name)
    const target = join(distBlender, `${name}.py`)
    copyFileSync(join(addonDir, `${name}.py`), target)
    pending.push(target)
  }
}
// Data registries those modules read at import time travel with them.
for (const entry of readdirSync(addonDir)) {
  if (!entry.endsWith('.json')) continue
  copyFileSync(join(addonDir, entry), join(distBlender, entry))
}
// Ship the artist workspace with the compiler so setup is one command. Keep
// tests and built archives out; Blender's extension builder reads the manifest
// from this flat package directory.
const addonSource = join(root, '..', 'blender-addon')
const addonOut = join(root, 'dist', 'addon')
rmSync(addonOut, { recursive: true, force: true })
mkdirSync(addonOut, { recursive: true })
for (const entry of readdirSync(addonSource)) {
  // Every .py and every .json: the addon's evidence registries are data its
  // own modules read at import time, so naming them one by one shipped an
  // addon that could not read itself the first time a second registry landed.
  if (
    !entry.endsWith('.py') && !entry.endsWith('.json') &&
    entry !== 'blender_manifest.toml' &&
    entry !== 'README.md' && entry !== 'LICENSE'
  ) continue
  copyFileSync(join(addonSource, entry), join(addonOut, entry))
}
// The addon imports the same canonical bake modules as the exporter. These
// are generated distribution copies, never a second authored
// implementation. EVERY .py in blender/ is copied for the same reason the
// dist/blender loop above does it: bakelib.py imports its siblings, so a
// hand-named list silently ships an addon that cannot import itself (the
// pure-geometry module was missing exactly that way, caught only by the
// isolated extension install check).
for (const entry of readdirSync(join(root, 'blender'))) {
  if (!entry.endsWith('.py')) continue
  copyFileSync(join(root, 'blender', entry), join(addonOut, entry))
}
console.log('assets copied')
