// The in-Blender Python ships beside the compiled JS. export_scene.py is
// GPL-3.0 (it imports bpy) while the rest of the package is MIT — see its
// header. EVERY .py in blender/ is copied so a new module can never be
// silently missing from dist (bakelib.py was, once).
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
mkdirSync(join(root, 'dist', 'blender'), { recursive: true })
for (const entry of readdirSync(join(root, 'blender'))) {
  if (!entry.endsWith('.py')) continue
  copyFileSync(join(root, 'blender', entry), join(root, 'dist', 'blender', entry))
}
console.log('assets copied')
