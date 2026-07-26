import assert from 'node:assert/strict'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, sep } from 'node:path'
import test from 'node:test'
import {
  publishContentAddressedBundle,
  resolveContentAddressedAssetUrl,
} from './publisher.mjs'

const EXPECTED_PATHS = Object.freeze([
  'blendlink-basis/LICENSE',
  'blendlink-basis/README.md',
  'blendlink-basis/basis_transcoder.js',
  'blendlink-basis/basis_transcoder.wasm',
  'environments/studio/main light.hdr',
  'hero.glb',
  'textures/albedo.ktx2',
])

function minimalGlb(tag = 'A') {
  const json = Buffer.from(JSON.stringify({
    asset: { version: '2.0', generator: `bundle-fixture-${tag}` },
    images: [{ uri: 'textures/albedo.ktx2' }],
  }))
  const padding = Buffer.alloc((4 - (json.byteLength % 4)) % 4, 0x20)
  const jsonChunk = Buffer.concat([json, padding])
  const glb = Buffer.alloc(20 + jsonChunk.byteLength)
  glb.writeUInt32LE(0x46546c67, 0)
  glb.writeUInt32LE(2, 4)
  glb.writeUInt32LE(glb.byteLength, 8)
  glb.writeUInt32LE(jsonChunk.byteLength, 12)
  glb.writeUInt32LE(0x4e4f534a, 16)
  jsonChunk.copy(glb, 20)
  return glb
}

function createHarness(t) {
  const root = mkdtempSync(join(tmpdir(), 'blendlink-addressed-bundle-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return {
    root,
    publicationRoot: join(root, 'public'),
    pointerPath: join(root, 'generated', 'hero.bundle.json'),
  }
}

function createStage(root, name, {
  glbTag = 'A',
  textureByte = 0x11,
  basisByte = 0x21,
} = {}) {
  const stageDirectory = join(root, name)
  const files = new Map([
    ['hero.glb', minimalGlb(glbTag)],
    ['textures/albedo.ktx2', Buffer.from([textureByte])],
    ['environments/studio/main light.hdr', Buffer.from('nested environment')],
    ['blendlink-basis/basis_transcoder.js', Buffer.from('basis wrapper')],
    ['blendlink-basis/basis_transcoder.wasm', Buffer.from([basisByte])],
    ['blendlink-basis/README.md', Buffer.from('basis readme')],
    ['blendlink-basis/LICENSE', Buffer.from('basis license')],
  ])
  for (const [path, bytes] of files) {
    const localPath = join(stageDirectory, ...path.split('/'))
    mkdirSync(dirname(localPath), { recursive: true })
    writeFileSync(localPath, bytes)
  }
  const declaredAssets = [...files.keys()].map((path) => ({
    path,
    role: path === 'hero.glb'
      ? 'scene'
      : path.startsWith('blendlink-basis/')
        ? 'basis-runtime'
        : 'companion',
  }))
  return { stageDirectory, declaredAssets }
}

function publishInput(harness, stage) {
  return {
    ...stage,
    publicationRoot: harness.publicationRoot,
    publicBundlePath: 'models/hero',
    pointerPath: harness.pointerPath,
    requiresKtx2: true,
  }
}

function readPointer(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function recursivelyListFiles(root) {
  const found = []
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) visit(path)
      else found.push(relative(root, path).split(sep).join('/'))
    }
  }
  visit(root)
  return found.sort()
}

function fingerprintDirectories(harness) {
  const parent = join(harness.publicationRoot, 'models', 'hero')
  if (!existsSync(parent)) return []
  return readdirSync(parent, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^[a-f0-9]{64}$/.test(entry.name))
    .map((entry) => join(parent, entry.name))
    .sort()
}

test('identical closed graphs reuse one never-mutated fingerprint directory', (t) => {
  const harness = createHarness(t)
  const firstStage = createStage(harness.root, 'stage-a')
  const first = publishContentAddressedBundle(publishInput(harness, firstStage))
  assert.equal(first.reused, false)
  assert.deepEqual(recursivelyListFiles(first.bundleDirectory), EXPECTED_PATHS)

  const publishedTexture = join(first.bundleDirectory, 'textures', 'albedo.ktx2')
  const oldTime = new Date('2001-02-03T04:05:06.000Z')
  utimesSync(publishedTexture, oldTime, oldTime)
  const before = readFileSync(publishedTexture)

  const secondStage = createStage(harness.root, 'stage-b')
  const second = publishContentAddressedBundle(publishInput(harness, secondStage))
  assert.equal(second.reused, true)
  assert.equal(second.fingerprint, first.fingerprint)
  assert.equal(second.bundleDirectory, first.bundleDirectory)
  assert.deepEqual(readFileSync(publishedTexture), before)
  assert.equal(statSync(publishedTexture).mtimeMs, oldTime.getTime())
  assert.equal(fingerprintDirectories(harness).length, 1)
  assert.equal(readPointer(harness.pointerPath).fingerprint, first.fingerprint)
})

test('one-byte scene, nested companion, and Basis changes each create a new directory', async (t) => {
  const harness = createHarness(t)
  const baseline = publishContentAddressedBundle(
    publishInput(harness, createStage(harness.root, 'stage-base')),
  )
  const variants = [
    ['scene GLB', { glbTag: 'B' }],
    ['nested texture', { textureByte: 0x12 }],
    ['Basis transcoder', { basisByte: 0x22 }],
  ]

  for (const [label, changes] of variants) {
    await t.test(label, () => {
      const stage = createStage(harness.root, `stage-${label.replaceAll(' ', '-')}`, changes)
      const published = publishContentAddressedBundle(publishInput(harness, stage))
      assert.notEqual(published.fingerprint, baseline.fingerprint)
      assert.equal(existsSync(published.bundleDirectory), true)
      assert.deepEqual(recursivelyListFiles(published.bundleDirectory), EXPECTED_PATHS)
    })
  }
  assert.equal(new Set(fingerprintDirectories(harness)).size, 4)
})

test('an incomplete or extra staged graph fails before publication', (t) => {
  const harness = createHarness(t)
  const stage = createStage(harness.root, 'stage-open')
  writeFileSync(join(stage.stageDirectory, 'orphan.tmp'), 'undeclared encoder output')

  assert.throws(
    () => publishContentAddressedBundle(publishInput(harness, stage)),
    /undeclared compiler-owned staged file.*orphan\.tmp/i,
  )
  assert.equal(existsSync(harness.pointerPath), false)
  assert.deepEqual(fingerprintDirectories(harness), [])
})

test('pointer replacement failure leaves the last pointer intact', (t) => {
  const harness = createHarness(t)
  const first = publishContentAddressedBundle(
    publishInput(harness, createStage(harness.root, 'stage-current')),
  )
  const pointerBefore = readFileSync(harness.pointerPath)
  const nextStage = createStage(harness.root, 'stage-next', { textureByte: 0x13 })

  assert.throws(
    () => publishContentAddressedBundle(publishInput(harness, nextStage), {
      replacePointer() {
        throw new Error('injected pointer rename failure')
      },
    }),
    /injected pointer rename failure/,
  )

  assert.deepEqual(readFileSync(harness.pointerPath), pointerBefore)
  assert.equal(readPointer(harness.pointerPath).fingerprint, first.fingerprint)
  const completeDirectories = fingerprintDirectories(harness)
  assert.equal(completeDirectories.length, 2)
  for (const directory of completeDirectories) {
    assert.deepEqual(recursivelyListFiles(directory), EXPECTED_PATHS)
  }
  assert.equal(
    readdirSync(dirname(harness.pointerPath)).some((name) => name.includes('blendlink-pointer-next')),
    false,
  )
})

test('the public pointer sees only the old or the fully committed new bundle', (t) => {
  const harness = createHarness(t)
  const current = publishContentAddressedBundle(
    publishInput(harness, createStage(harness.root, 'stage-visible-current')),
  )
  const observedPointerFingerprints = []
  let copiedEvents = 0
  let committedFingerprint = null
  const nextStage = createStage(harness.root, 'stage-visible-next', { basisByte: 0x23 })

  const next = publishContentAddressedBundle(publishInput(harness, nextStage), {
    onPhase(event) {
      if (existsSync(harness.pointerPath)) {
        observedPointerFingerprints.push(readPointer(harness.pointerPath).fingerprint)
      }
      if (event.phase === 'entry-copied') {
        copiedEvents += 1
        assert.equal(existsSync(event.bundleDirectory), false)
        assert.deepEqual(fingerprintDirectories(harness), [current.bundleDirectory])
      }
      if (event.phase === 'bundle-committed') {
        committedFingerprint = event.fingerprint
        assert.equal(existsSync(event.bundleDirectory), true)
        assert.deepEqual(recursivelyListFiles(event.bundleDirectory), EXPECTED_PATHS)
        assert.equal(readPointer(harness.pointerPath).fingerprint, current.fingerprint)
      }
      if (event.phase === 'before-pointer-commit') {
        assert.equal(readPointer(harness.pointerPath).fingerprint, current.fingerprint)
        assert.deepEqual(recursivelyListFiles(event.bundleDirectory), EXPECTED_PATHS)
      }
      if (event.phase === 'pointer-committed') {
        assert.equal(readPointer(harness.pointerPath).fingerprint, event.fingerprint)
        assert.deepEqual(recursivelyListFiles(event.bundleDirectory), EXPECTED_PATHS)
      }
    },
  })

  assert.equal(copiedEvents, EXPECTED_PATHS.length)
  assert.equal(committedFingerprint, next.fingerprint)
  assert.deepEqual(
    new Set(observedPointerFingerprints),
    new Set([current.fingerprint, next.fingerprint]),
  )
  assert.equal(readPointer(harness.pointerPath).fingerprint, next.fingerprint)
})

test('one pointer resolves every nested asset under root, subpath, or CDN bases', (t) => {
  const harness = createHarness(t)
  const published = publishContentAddressedBundle(
    publishInput(harness, createStage(harness.root, 'stage-urls')),
  )
  const pointer = readPointer(harness.pointerPath)
  const suffix = `models/hero/${published.fingerprint}/environments/studio/main%20light.hdr`

  assert.equal(
    resolveContentAddressedAssetUrl(pointer, 'environments/studio/main light.hdr', '/'),
    `/${suffix}`,
  )
  assert.equal(
    resolveContentAddressedAssetUrl(
      pointer,
      'environments/studio/main light.hdr',
      '/portfolio/',
    ),
    `/portfolio/${suffix}`,
  )
  assert.equal(
    resolveContentAddressedAssetUrl(
      pointer,
      'environments/studio/main light.hdr',
      'https://cdn.example.com/portfolio-assets/',
    ),
    `https://cdn.example.com/portfolio-assets/${suffix}`,
  )
  assert.throws(
    () => resolveContentAddressedAssetUrl(pointer, '../escape.glb', '/'),
    /traversal/i,
  )
})
