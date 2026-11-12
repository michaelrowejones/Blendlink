// Optional network gate: install the retained archive outside this workspace,
// with an empty npm cache. No symlinks or borrowed monorepo dependencies.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const archive = resolve(process.argv[2] || '')
if (!process.argv[2] || !archive.endsWith('.tgz') || !existsSync(archive)) {
  throw new Error('usage: npm run test:fresh-install -- <retained-blendlink.tgz>')
}
const work = mkdtempSync(join(tmpdir(), 'blendlink-fresh-install-'))
const npmCli = process.env.npm_execpath
if (!npmCli) throw new Error('Run this gate through npm so it uses the invoking npm installation.')
function run(label, args) {
  const result = spawnSync(process.execPath, args, { cwd: work, encoding: 'utf8', windowsHide: true, maxBuffer: 32 * 1024 * 1024 })
  if (result.error || result.status !== 0) throw new Error(label + ': ' + (result.error?.message || result.stdout + '\n' + result.stderr))
  return result.stdout
}
try {
  writeFileSync(join(work, 'package.json'), JSON.stringify({
    name: 'blendlink-independent-consumer', private: true, type: 'module',
    dependencies: { blendlink: 'file:' + archive, three: '0.184.0' },
    devDependencies: { vite: '7.3.8' },
  }, null, 2))
  run('independent npm install', [npmCli, 'install', '--cache', join(work, 'empty-cache'), '--no-fund', '--no-audit'])
  const lock = JSON.parse(readFileSync(join(work, 'package-lock.json'), 'utf8'))
  const sri = 'sha512-' + createHash('sha512').update(readFileSync(archive)).digest('base64')
  assert.equal(lock.packages['node_modules/blendlink'].integrity, sri)
  run('packed CLI version', [join(work, 'node_modules/blendlink/dist/cli.js'), 'version'])
  run('framework-neutral root import', ['--input-type=module', '-e', 'await import("blendlink")'])
  writeFileSync(join(work, 'index.html'), '<!doctype html><html lang="en"><head><meta charset="UTF-8"></head><body><script type="module" src="/src/main.js"></script></body></html>')
  mkdirSync(join(work, 'src'))
  writeFileSync(join(work, 'src/main.js'), 'import { installThreeCompiledScene } from "blendlink/three"; import { WebGPURenderer } from "three/webgpu"; window.blendlinkConsumer = { installThreeCompiledScene, WebGPURenderer };')
  run('independent browser build', [join(work, 'node_modules/vite/bin/vite.js'), 'build'])
  assert.ok(existsSync(join(work, 'dist/index.html')))
  console.log('BLENDLINK_FRESH_INSTALL_PASSED exact archive SRI, independent dependencies, root import and browser build')
} finally { rmSync(work, { recursive: true, force: true }) }
