import { readdirSync, rmSync } from 'node:fs'
import { dirname, extname, isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const distRoot = resolve(packageRoot, 'dist')

function clean(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name)
    const relativePath = relative(distRoot, path)
    if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
      throw new Error(`Refusing to clean an unexpected package path: ${path}`)
    }
    if (entry.isDirectory()) {
      if (entry.name === '__pycache__') {
        rmSync(path, { recursive: true, force: true })
      } else {
        clean(path)
      }
      continue
    }
    if (entry.isFile() && ['.pyc', '.pyo'].includes(extname(entry.name))) {
      rmSync(path, { force: true })
    }
  }
}

clean(distRoot)
