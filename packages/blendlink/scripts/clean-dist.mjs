import { rmSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dist = resolve(packageRoot, 'dist')

if (dirname(dist) !== packageRoot || basename(dist) !== 'dist') {
  throw new Error(`Refusing to clean an unexpected build directory: ${dist}`)
}

rmSync(dist, { recursive: true, force: true })
