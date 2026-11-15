import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

// SemVer 2.0 core and prerelease identifiers, without v-prefixes or coercion.
// Publication deliberately excludes +build metadata: npm's canonical identity
// must equal the tag, archive filenames and Blender manifest version exactly.
const NUMBER = '(?:0|[1-9][0-9]*)'
const IDENTIFIER = '(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)'
const RELEASE_VERSION = new RegExp(`^${NUMBER}\\.${NUMBER}\\.${NUMBER}(?:-(${IDENTIFIER}(?:\\.${IDENTIFIER})*))?$`)

export function releaseChannelPolicy(version) {
  const match = typeof version === 'string' ? RELEASE_VERSION.exec(version) : null
  if (!match || match[0] !== version) {
    throw new Error('Release version must be strict SemVer without a v prefix or build metadata')
  }
  const prerelease = match[1] !== undefined
  return Object.freeze({
    version,
    channel: prerelease ? 'prerelease' : 'stable',
    npmDistTag: prerelease ? 'beta' : 'latest',
    githubPrerelease: prerelease,
    githubLatest: !prerelease,
    githubTitle: `SceneToWeb ${version}${prerelease ? ' prerelease' : ''}`,
  })
}

const FIELDS = Object.freeze({
  'npm-dist-tag': 'npmDistTag',
  'github-prerelease': 'githubPrerelease',
  'github-latest': 'githubLatest',
  'github-title': 'githubTitle',
})

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const [version, field, ...extra] = process.argv.slice(2)
    if (extra.length || !Object.hasOwn(FIELDS, field)) {
      throw new Error(`Use release-channel.mjs VERSION ${Object.keys(FIELDS).join('|')}`)
    }
    process.stdout.write(`${releaseChannelPolicy(version)[FIELDS[field]]}\n`)
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
