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
// Procedural diagnostics are authored once with the Blender addon, then used
// by the headless exporter too.  Both call the same analyze_scene() seam.
copyFileSync(
  join(root, '..', 'blender-addon', 'procedural.py'),
  join(root, 'dist', 'blender', 'procedural.py'),
)
// Explicit website-material intent is planned, lowered, and GLB-attested by
// one module shared with the artist workspace. Selected-field UV, EMIT,
// coverage, save, and device mechanics remain in canonical bakelib.py.
copyFileSync(
  join(root, '..', 'blender-addon', 'material_compiler.py'),
  join(root, 'dist', 'blender', 'material_compiler.py'),
)
copyFileSync(
  join(root, '..', 'blender-addon', 'glblib.py'),
  join(root, 'dist', 'blender', 'glblib.py'),
)
// The node->TSL IR emitter rides the channel plan as additive evidence
// (material_compiler imports it), so the packaged exporter needs it too.
copyFileSync(
  join(root, '..', 'blender-addon', 'tsl_ir.py'),
  join(root, 'dist', 'blender', 'tsl_ir.py'),
)
// Realtime-light units, render visibility, and compatibility warnings also
// share one canonical Blender-side policy between the addon and exporter.
copyFileSync(
  join(root, '..', 'blender-addon', 'weblights.py'),
  join(root, 'dist', 'blender', 'weblights.py'),
)
// Reflection image validation/path evidence is shared with the authoring
// workspace. Panoramic render/save mechanics remain in canonical bakelib.py.
copyFileSync(
  join(root, '..', 'blender-addon', 'probe_authoring.py'),
  join(root, 'dist', 'blender', 'probe_authoring.py'),
)
// Authored NLA sequencing likewise owns the portable strip subset and the
// stock glTF Action-export policy on both interactive and headless paths.
copyFileSync(
  join(root, '..', 'blender-addon', 'nla_sequence.py'),
  join(root, 'dist', 'blender', 'nla_sequence.py'),
)
// Ship the artist workspace with the compiler so setup is one command. Keep
// tests and built archives out; Blender's extension builder reads the manifest
// from this flat package directory.
const addonSource = join(root, '..', 'blender-addon')
const addonOut = join(root, 'dist', 'addon')
rmSync(addonOut, { recursive: true, force: true })
mkdirSync(addonOut, { recursive: true })
for (const entry of readdirSync(addonSource)) {
  if (
    !entry.endsWith('.py') && entry !== 'blender_manifest.toml' &&
    entry !== 'README.md' && entry !== 'LICENSE' &&
    entry !== 'blender_known_issues.json'
  ) continue
  copyFileSync(join(addonSource, entry), join(addonOut, entry))
}
// The addon imports the same canonical bake module as the exporter. This is
// a generated distribution copy, never a second authored implementation.
copyFileSync(
  join(root, 'blender', 'bakelib.py'),
  join(addonOut, 'bakelib.py'),
)
console.log('assets copied')
