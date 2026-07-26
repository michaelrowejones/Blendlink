import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  installContentAddressedLocalPackage,
  packContentAddressedLocalPackage,
} from './local-package-identity.mjs'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const args = process.argv.slice(2)

function option(name) {
  const index = args.indexOf(name)
  if (index < 0) return undefined
  const value = args[index + 1]
  if (!value || value.startsWith('--')) {
    throw new Error(`${name} requires a path.`)
  }
  return resolve(value)
}

const output = option('--output') ?? resolve(root, 'artifacts', 'dogfood-packages')
const install = option('--install')
const known = new Set(['--output', '--install'])
for (let index = 0; index < args.length; index += 1) {
  const arg = args[index]
  if (!known.has(arg)) throw new Error(`Unknown dogfood package option ${arg}.`)
  index += 1
}

const packed = packContentAddressedLocalPackage(
  resolve(root, 'packages', 'blendlink'),
  output,
)
const installed = install
  ? installContentAddressedLocalPackage(install, packed.archive)
  : undefined

console.log(JSON.stringify({
  schemaVersion: 1,
  archive: packed.archive,
  name: packed.name,
  version: packed.version,
  bytes: (await import('node:fs')).statSync(packed.archive).size,
  sha256: packed.sha256,
  integrity: packed.integrity,
  treeFingerprint: packed.treeFingerprint,
  installedProject: installed ? install : undefined,
  installedFingerprint: installed?.installedFingerprint,
}, null, 2))
console.log(`BLENDLINK_DOGFOOD_PACKAGE_READY ${packed.archive}`)
