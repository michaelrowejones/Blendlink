import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8')

test('upstream watch is daily/manual and PR changes run only fast tests with read-only permissions', async () => {
  const source = await read('.github/workflows/blender-node-watch.yml')
  assert.match(source, /schedule:\n\s+- cron:/); assert.match(source, /workflow_dispatch:/); assert.match(source, /pull_request:\n\s+paths:/)
  assert.match(source, /permissions:\n  contents: read\n/); assert.doesNotMatch(source, /contents: write|pull-requests: write|issues: write|pull_request_target/)
  assert.match(source, /observe:[\s\S]*if: github\.event_name != 'pull_request'/)
  assert.match(source, /fast-tests:[\s\S]*node --test scripts\/lib\/blender-build-/)
  assert.doesNotMatch(source, /npm ci|npm run build|gh (?:pr|issue)|GITHUB_TOKEN|NODE_AUTH_TOKEN|secrets\./)
})

test('watcher pins existing actions, caches only checksummed archives, and retains failures without huge owned checkouts', async () => {
  const source = await read('.github/workflows/blender-node-watch.yml')
  const pins = new Set(['actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803', 'actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38', 'actions/cache@caa296126883cff596d87d8935842f9db880ef25', 'actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a'])
  for (const match of source.matchAll(/uses: (\S+)/g)) assert.ok(pins.has(match[1]), 'Unreviewed action pin ' + match[1])
  assert.match(source, /key: blender-daily-archive-.*steps\.discovery\.outputs\.archive-sha256/)
  assert.match(source, /--discovery "\$BLENDLINK_WATCH_DISCOVERY"/); assert.match(source, /GIT_LFS_SKIP_SMUDGE: '1'/)
  assert.match(source, /if: always\(\)/); assert.match(source, /!artifacts\/blender-node-watch\/\.work\/\*\*/)
  assert.doesNotMatch(source, /restore-keys:|test-node-port\.mjs|--update-baseline/)
})

test('committed observer baseline is the actual source revision and catalog, not a version-derived tree', async () => {
  const config = JSON.parse(await read('config/blender-node-watch.json')), catalog = JSON.parse(await read(config.baseline.catalog))
  assert.equal(config.repository, 'https://github.com/blender/blender.git'); assert.equal(config.baseline.commit, '02f0899d78e374b63e7181d9061e1f7ab03419cc'); assert.equal(config.baseline.tree, 'e05e50cc9d58ca09b36a8ed9352c489092436fe1')
  assert.deepEqual(config.baseline.version, [5, 3, 0]); assert.deepEqual(catalog.blenderVersionTuple, config.baseline.version); assert.ok(config.baseline.commit.startsWith(catalog.blenderBuildHash))
})
