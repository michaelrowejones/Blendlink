import { createHash } from 'node:crypto'
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { strict as assert } from 'node:assert'

import {
  verifyChecksumContract,
  verifyGithubReleaseContract,
  verifyRegistryContract,
  verifyReleaseManifestContract,
} from './verify-retained-release.mjs'

const version = '0.8.0'
const commit = 'a'.repeat(40)
const repository = 'michaelrowejones/Blendlink'
const npmBytes = Buffer.from('retained npm bytes')
const addonBytes = Buffer.from('retained addon bytes')
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
const shasum = (bytes) => createHash('sha1').update(bytes).digest('hex')
const integrity = (bytes) => `sha512-${createHash('sha512').update(bytes).digest('base64')}`
const manifest = {
  schemaVersion: 1,
  version,
  source: { commit, dirty: false },
  artifacts: [
    {
      kind: 'npm',
      filename: `blendlink-${version}.tgz`,
      license: 'SEE LICENSE IN LICENSES.md',
      licenseMap: 'LICENSES.md',
      fileLicenses: ['MIT', 'GPL-3.0-or-later', 'Apache-2.0'],
      bytes: npmBytes.length,
      sha256: sha(npmBytes),
      integrity: integrity(npmBytes),
      addonFingerprint: 'b'.repeat(64),
    },
    {
      kind: 'blender-extension',
      filename: `blendlink-addon-${version}.zip`,
      license: 'GPL-3.0-or-later',
      bytes: addonBytes.length,
      sha256: sha(addonBytes),
      addonFingerprint: 'b'.repeat(64),
    },
  ],
}

let passed = 0
function test(name, body) {
  try {
    body()
    passed += 1
  } catch (error) {
    error.message = `${name}: ${error.message}`
    throw error
  }
}

test('accepts the exact clean mixed-license manifest', () => {
  verifyReleaseManifestContract(manifest, { version, commit })
})

test('rejects dirty source and license drift', () => {
  assert.throws(() => verifyReleaseManifestContract(
    { ...manifest, source: { commit, dirty: true } }, { version, commit },
  ), /clean source tree/)
  const changed = structuredClone(manifest)
  changed.artifacts[0].fileLicenses = ['MIT']
  assert.throws(() => verifyReleaseManifestContract(changed, { version, commit }), /license manifest/)
})

test('requires the checksum document to be exact and complete', () => {
  const checksum = manifest.artifacts.map((item) => `${item.sha256}  ${item.filename}`).join('\n') + '\n'
  verifyChecksumContract(checksum, manifest.artifacts)
  assert.throws(() => verifyChecksumContract(`${checksum}extra\n`, manifest.artifacts), /SHA256SUMS/)
})

const work = mkdtempSync(join(tmpdir(), 'blendlink-release-contract-test-'))
try {
  for (const [name, bytes] of [
    [`blendlink-${version}.tgz`, npmBytes],
    [`blendlink-addon-${version}.zip`, addonBytes],
    ['release-manifest.json', Buffer.from('{}')],
    ['SHA256SUMS', Buffer.from('checksums')],
  ]) writeFileSync(join(work, name), bytes)
  const contract = verifyReleaseManifestContract(manifest, { version, commit })
  test('accepts exact registry bytes and provenance', () => {
    const downloaded = join(work, 'registry.tgz')
    writeFileSync(downloaded, npmBytes)
    verifyRegistryContract({
      metadata: {
        name: 'blendlink', version,
        repository: { url: 'git+https://github.com/michaelrowejones/Blendlink.git' },
        _npmUser: {
          name: 'GitHub Actions',
          trustedPublisher: { id: 'github', oidcConfigId: 'oidc:test' },
        },
        dist: {
          integrity: integrity(npmBytes),
          shasum: shasum(npmBytes),
          tarball: `https://registry.npmjs.org/blendlink/-/blendlink-${version}.tgz`,
          attestations: {
            url: 'https://registry.npmjs.org/-/npm/v1/attestations/blendlink@0.8.0',
            provenance: { predicateType: 'https://slsa.dev/provenance/v1' },
          },
        },
      },
      downloadedArchive: downloaded,
      retainedArchive: join(work, `blendlink-${version}.tgz`),
      contract,
      repository,
    })
  })
  test('rejects registry repository casing drift', () => {
    assert.throws(() => verifyRegistryContract({
      metadata: {
        name: 'blendlink', version,
        repository: { url: 'git+https://github.com/MichaelRoweJones/Blendlink.git' },
      },
      downloadedArchive: join(work, 'registry.tgz'),
      retainedArchive: join(work, `blendlink-${version}.tgz`),
      contract,
      repository,
    }), /must exactly identify/)
  })
  test('rejects registry bytes without provenance', () => {
    const downloaded = join(work, 'registry.tgz')
    assert.throws(() => verifyRegistryContract({
      metadata: {
        name: 'blendlink', version,
        repository: { url: 'git+https://github.com/michaelrowejones/Blendlink.git' },
        _npmUser: {
          name: 'GitHub Actions',
          trustedPublisher: { id: 'github', oidcConfigId: 'oidc:test' },
        },
        dist: {
          integrity: integrity(npmBytes),
          shasum: shasum(npmBytes),
          tarball: `https://registry.npmjs.org/blendlink/-/blendlink-${version}.tgz`,
        },
      },
      downloadedArchive: downloaded,
      retainedArchive: join(work, `blendlink-${version}.tgz`),
      contract,
      repository,
    }), /attestations|provenance/)
  })
  test('rejects provenance that was not published through GitHub OIDC', () => {
    const downloaded = join(work, 'registry.tgz')
    assert.throws(() => verifyRegistryContract({
      metadata: {
        name: 'blendlink', version,
        repository: { url: 'git+https://github.com/michaelrowejones/Blendlink.git' },
        _npmUser: { name: 'maintainer' },
        dist: {
          integrity: integrity(npmBytes),
          shasum: shasum(npmBytes),
          tarball: `https://registry.npmjs.org/blendlink/-/blendlink-${version}.tgz`,
          attestations: {
            url: 'https://registry.npmjs.org/-/npm/v1/attestations/blendlink@0.8.0',
            provenance: { predicateType: 'https://slsa.dev/provenance/v1' },
          },
        },
      },
      downloadedArchive: downloaded,
      retainedArchive: join(work, `blendlink-${version}.tgz`),
      contract,
      repository,
    }), /trusted publishing/)
  })
  test('accepts only the exact four GitHub assets', () => {
    const names = [
      `blendlink-${version}.tgz`,
      `blendlink-addon-${version}.zip`,
      'release-manifest.json',
      'SHA256SUMS',
    ]
    const release = {
      tag_name: `v${version}`,
      target_commitish: commit,
      draft: true,
      prerelease: true,
      assets: names.map((name) => {
        const path = join(work, name)
        const bytes = name === `blendlink-${version}.tgz` ? npmBytes
          : name === `blendlink-addon-${version}.zip` ? addonBytes
            : name === 'release-manifest.json' ? Buffer.from('{}') : Buffer.from('checksums')
        return { name, state: 'uploaded', size: bytes.length, digest: `sha256:${sha(bytes)}` }
      }),
    }
    const downloads = mkdtempSync(join(tmpdir(), 'blendlink-github-assets-'))
    try {
      for (const name of names) copyFileSync(join(work, name), join(downloads, name))
      assert.equal(verifyGithubReleaseContract({
        release, directory: work, downloadedDirectory: downloads, version, commit, state: 'draft',
      }), 'draft')
      release.draft = false
      assert.throws(() => verifyGithubReleaseContract({
        release, directory: work, downloadedDirectory: downloads, version, commit, state: 'published',
      }), /immutable releases/)
      release.immutable = true
      assert.equal(verifyGithubReleaseContract({
        release, directory: work, downloadedDirectory: downloads, version, commit, state: 'published',
      }), 'published')
      release.draft = true
      delete release.immutable
      release.assets.push({ name: 'unexpected', state: 'uploaded', size: 1, digest: `sha256:${'0'.repeat(64)}` })
      assert.throws(() => verifyGithubReleaseContract({
        release, directory: work, version, commit, state: 'draft',
      }), /exactly the four/)
    } finally {
      rmSync(downloads, { recursive: true, force: true })
    }
  })
} finally {
  rmSync(work, { recursive: true, force: true })
}

console.log(`BLENDLINK_RETAINED_RELEASE_POLICY_PASSED ${passed}`)
