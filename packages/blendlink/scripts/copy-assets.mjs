// The in-Blender export script ships beside the compiled JS. It is licensed
// GPL-3.0 (it imports bpy) while the rest of the package is MIT — see the
// header in blender/export_scene.py.
import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
mkdirSync(join(root, 'dist', 'blender'), { recursive: true })
copyFileSync(
  join(root, 'blender', 'export_scene.py'),
  join(root, 'dist', 'blender', 'export_scene.py'),
)
console.log('assets copied')
