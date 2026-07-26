import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const PACKAGE_LICENSE = 'SEE LICENSE IN LICENSES.md'
const FILE_LICENSES = Object.freeze([
  'MIT',
  'GPL-3.0-or-later',
  'Apache-2.0',
])

function readRequiredText(packageRoot, relativePath, label) {
  try {
    return readFileSync(join(packageRoot, ...relativePath.split('/')), 'utf8')
  } catch (error) {
    throw new Error(
      `Packed Blendlink is missing its ${label} at ${relativePath}.`,
      { cause: error },
    )
  }
}

function requireFragments(text, fragments, failure) {
  const missing = fragments.filter((fragment) => !text.includes(fragment))
  if (missing.length > 0) {
    throw new Error(`${failure}; missing ${missing.join(', ')}.`)
  }
}

/**
 * Verify licensing from an extracted npm archive. Source-tree checks cannot
 * prove that npm retained the map and complete license texts in the bytes a
 * developer will install.
 */
export function verifyPackedBlendlinkLicenseContract(packageRoot) {
  let manifest
  try {
    manifest = JSON.parse(
      readRequiredText(packageRoot, 'package.json', 'package manifest'),
    )
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error('Packed Blendlink package.json is not valid JSON.', { cause: error })
    }
    throw error
  }
  if (manifest.license !== PACKAGE_LICENSE) {
    throw new Error(
      `Packed Blendlink must declare ${PACKAGE_LICENSE}; got ${String(manifest.license)}.`,
    )
  }

  const licenseMap = readRequiredText(packageRoot, 'LICENSES.md', 'mixed-license map')
  requireFragments(
    licenseMap,
    [
      ...FILE_LICENSES,
      'dist/addon/LICENSE',
      'assets/basis-apache-2.0.txt',
    ],
    'Packed Blendlink license map is incomplete',
  )

  const mitText = readRequiredText(packageRoot, 'LICENSE', 'MIT license text')
  requireFragments(
    mitText,
    ['MIT License', 'Permission is hereby granted'],
    'Packed Blendlink must embed the complete MIT license text',
  )

  const gplText = readRequiredText(
    packageRoot,
    'dist/addon/LICENSE',
    'GPL version 3 license text',
  )
  requireFragments(
    gplText,
    [
      'GNU GENERAL PUBLIC LICENSE',
      'Version 3, 29 June 2007',
      'END OF TERMS AND CONDITIONS',
    ],
    'Packed Blendlink must embed the complete GPL version 3 license text',
  )

  const apacheText = readRequiredText(
    packageRoot,
    'assets/basis-apache-2.0.txt',
    'Apache-2.0 license text',
  )
  requireFragments(
    apacheText,
    [
      'Apache License',
      'Version 2.0, January 2004',
      'TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION',
      'limitations under the License.',
    ],
    'Packed Blendlink must embed the complete Apache-2.0 license text',
  )

  return {
    license: PACKAGE_LICENSE,
    licenseMap: 'LICENSES.md',
    fileLicenses: [...FILE_LICENSES],
  }
}
