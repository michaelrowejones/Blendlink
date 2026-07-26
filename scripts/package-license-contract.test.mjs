import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, it } from 'node:test'

import { verifyPackedBlendlinkLicenseContract } from './package-license-contract.mjs'

const owned = []

afterEach(() => {
  for (const path of owned.splice(0)) {
    rmSync(path, { recursive: true, force: true })
  }
})

function packedFixture() {
  const root = mkdtempSync(join(tmpdir(), 'blendlink-license-contract-'))
  owned.push(root)
  mkdirSync(join(root, 'assets'), { recursive: true })
  mkdirSync(join(root, 'dist', 'addon'), { recursive: true })
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ license: 'SEE LICENSE IN LICENSES.md' }),
  )
  writeFileSync(
    join(root, 'LICENSES.md'),
    [
      'MIT',
      'GPL-3.0-or-later',
      'Apache-2.0',
      'dist/addon/LICENSE',
      'assets/basis-apache-2.0.txt',
    ].join('\n'),
  )
  writeFileSync(
    join(root, 'LICENSE'),
    'MIT License\nPermission is hereby granted, free of charge',
  )
  writeFileSync(
    join(root, 'dist', 'addon', 'LICENSE'),
    [
      'GNU GENERAL PUBLIC LICENSE',
      'Version 3, 29 June 2007',
      'END OF TERMS AND CONDITIONS',
    ].join('\n'),
  )
  writeFileSync(
    join(root, 'assets', 'basis-apache-2.0.txt'),
    [
      'Apache License',
      'Version 2.0, January 2004',
      'TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION',
      'limitations under the License.',
    ].join('\n'),
  )
  return root
}

describe('packed Blendlink license contract', () => {
  it('accepts a complete mixed-license aggregate', () => {
    const root = packedFixture()

    assert.deepEqual(verifyPackedBlendlinkLicenseContract(root), {
      license: 'SEE LICENSE IN LICENSES.md',
      licenseMap: 'LICENSES.md',
      fileLicenses: ['MIT', 'GPL-3.0-or-later', 'Apache-2.0'],
    })
  })

  it('rejects a truncated Apache notice in the retained archive', () => {
    const root = packedFixture()
    writeFileSync(
      join(root, 'assets', 'basis-apache-2.0.txt'),
      'Apache License\nVersion 2.0, January 2004',
    )

    assert.throws(
      () => verifyPackedBlendlinkLicenseContract(root),
      /complete Apache-2\.0 license text/i,
    )
  })
})
