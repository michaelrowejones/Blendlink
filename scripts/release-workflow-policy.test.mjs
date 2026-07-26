import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const workflow = readFileSync(new URL('../.github/workflows/blender-contract.yml', import.meta.url), 'utf8')

function job(name, nextName) {
  const start = workflow.indexOf(`\n  ${name}:`)
  assert.notEqual(start, -1, `missing ${name} job`)
  const end = nextName === undefined ? workflow.length : workflow.indexOf(`\n  ${nextName}:`, start + 1)
  assert.notEqual(end, -1, `missing ${nextName} job boundary`)
  return workflow.slice(start, end)
}

test('release candidate attests and retains one exact carrier', () => {
  const candidate = job('release-candidate', 'publish-npm')
  assert.match(candidate, /verify-retained-release\.mjs retained/)
  assert.match(candidate, /actions\/attest@f7c74d28b9d84cb8768d0b8ca14a4bac6ef463e6 # v4\.2\.0/)
  assert.match(candidate, /actions\/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7\.0\.1/)
  assert.match(candidate, /artifact_id: \$\{\{ steps\.retain\.outputs\.artifact-id \}\}/)
  assert.match(candidate, /artifact_digest: \$\{\{ steps\.retain\.outputs\.artifact-digest \}\}/)
  assert.match(candidate, /GITHUB_REF_PROTECTED/)
  assert.doesNotMatch(candidate, /overwrite:/)
})

test('npm publisher uses OIDC and only the retained tarball', () => {
  const publisher = job('publish-npm', 'publish-github-release')
  assert.match(publisher, /environment:\s+name: npm-production/)
  assert.match(publisher, /actions: read/)
  assert.match(publisher, /id-token: write/)
  assert.match(publisher, /actions\/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c # v8\.0\.1/)
  assert.match(publisher, /artifact-ids: \$\{\{ needs\.release-candidate\.outputs\.artifact_id \}\}/)
  assert.match(publisher, /digest-mismatch: error/)
  assert.match(publisher, /npm publish "\.\/\$retained_archive"/)
  assert.match(publisher, /--provenance/)
  assert.match(publisher, /verify-retained-release\.mjs registry/)
  assert.match(publisher, /npm audit signatures/)
  assert.match(publisher, /BLENDLINK_NPM_TRUSTED_PUBLISHING/)
  assert.doesNotMatch(publisher, /npm pack/)
  assert.doesNotMatch(publisher, /NODE_AUTH_TOKEN:\s*\$\{\{\s*secrets\./)
  assert.doesNotMatch(publisher, /--force|--ignore-scripts=false/)
  assert.equal([...publisher.matchAll(/^\s+npm publish /gm)].length, 1)
})

test('GitHub publisher attaches only the same four files and refuses mutation', () => {
  const publisher = job('publish-github-release')
  assert.match(publisher, /needs:\s+- release-candidate\s+- publish-npm/)
  assert.match(publisher, /environment:\s+name: github-release-production/)
  assert.match(publisher, /actions: read/)
  assert.match(publisher, /actions\/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c # v8\.0\.1/)
  assert.match(publisher, /gh release create "\$GITHUB_REF_NAME"/)
  assert.match(publisher, /--verify-tag/)
  assert.match(publisher, /--draft/)
  assert.match(publisher, /BLENDLINK_IMMUTABLE_RELEASES/)
  assert.match(publisher, /verify-retained-release\.mjs github/)
  assert.doesNotMatch(publisher, /--clobber|gh release upload/)
  for (const filename of [
    'blendlink-$RELEASE_VERSION.tgz',
    'blendlink-addon-$RELEASE_VERSION.zip',
    'release-manifest.json',
    'SHA256SUMS',
  ]) {
    assert.match(publisher, new RegExp(filename.replaceAll('.', '\\.').replaceAll('$', '\\$')))
  }
})

test('all external actions are full-SHA pinned', () => {
  const externalUses = [...workflow.matchAll(/^\s*uses:\s*([^\s#]+)(?:\s+#.*)?$/gm)]
    .map((match) => match[1])
    .filter((value) => !value.startsWith('./'))
  assert.ok(externalUses.length > 0)
  for (const value of externalUses) assert.match(value, /@[0-9a-f]{40}$/)
})
