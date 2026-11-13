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
  mkdirSync(join(root, 'dist', 'vendor', 'n8ao-webgpu'), { recursive: true })
  writeFileSync(join(root, 'dist', 'vendor', 'n8ao-webgpu', 'LICENSE'),
    'CC0 1.0 Universal\nStatement of Purpose\nLimitations and Disclaimers')
  writeFileSync(join(root, 'dist', 'vendor', 'n8ao-webgpu', 'NOTICE.md'), 'Upstream notice')
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
      'BSD-3-Clause',
      'CC0-1.0',
      'dist/addon/LICENSE',
      'assets/basis-apache-2.0.txt',
      'assets/blender-spectral-NOTICE.txt',
      'assets/blender-spectral-apache-2.0.txt',
      'assets/blender-noise-bsd-3-clause.txt',
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
  writeFileSync(join(root, 'assets', 'blender-spectral-NOTICE.txt'),
    'Blender Foundation\nApache-2.0\nBlendlink modifications')
  writeFileSync(join(root, 'assets', 'blender-spectral-apache-2.0.txt'),
    'Apache License\nVersion 2.0\nEND OF TERMS AND CONDITIONS')
  writeFileSync(join(root, 'dist', 'addon', 'spectral-NOTICE.txt'), 'Blender Foundation\nApache')
  writeFileSync(join(root, 'dist', 'addon', 'spectral-LICENSE.txt'), 'Apache License\nEND OF TERMS AND CONDITIONS')
  const bsd = ['Sony Pictures Imageworks', 'Blender Foundation',
    'Redistribution and use in source and binary forms', 'Redistributions of source code',
    'Redistributions in binary form', 'Neither the name of the copyright holder',
    'THIS SOFTWARE IS PROVIDED', 'EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.'].join('\n')
  writeFileSync(join(root, 'assets', 'blender-noise-bsd-3-clause.txt'), bsd)
  writeFileSync(join(root, 'dist', 'addon', 'noise-LICENSE.txt'), bsd)
  return root
}

describe('packed SceneToWeb license contract', () => {
  it('accepts a complete mixed-license aggregate', () => {
    const root = packedFixture()

    assert.deepEqual(verifyPackedBlendlinkLicenseContract(root), {
      license: 'SEE LICENSE IN LICENSES.md',
      licenseMap: 'LICENSES.md',
      fileLicenses: ['MIT', 'GPL-3.0-or-later', 'Apache-2.0', 'BSD-3-Clause', 'CC0-1.0'],
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
  it('rejects a missing bundled WebGPU AO notice', () => {
    const root = packedFixture()
    rmSync(join(root, 'dist', 'vendor', 'n8ao-webgpu', 'NOTICE.md'))
    assert.throws(() => verifyPackedBlendlinkLicenseContract(root), /WebGPU AO upstream notice/)
  })
  it('rejects a truncated or missing Perlin license in either carrier', () => {
    for (const relative of ['assets/blender-noise-bsd-3-clause.txt', 'dist/addon/noise-LICENSE.txt']) {
      const root = packedFixture()
      writeFileSync(join(root, relative), 'BSD-3-Clause')
      assert.throws(() => verifyPackedBlendlinkLicenseContract(root), /complete BSD-3-Clause/)
      rmSync(join(root, relative))
      assert.throws(() => verifyPackedBlendlinkLicenseContract(root), /BSD-3-Clause license/)
    }
  })
  it('rejects a missing spectral port attribution', () => {
    const root = packedFixture()
    rmSync(join(root, 'assets', 'blender-spectral-NOTICE.txt'))
    assert.throws(() => verifyPackedBlendlinkLicenseContract(root), /spectral node attribution/)
  })
})
