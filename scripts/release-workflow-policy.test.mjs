import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { releaseChannelPolicy } from './release-channel.mjs'

const workflow = readFileSync(new URL('../.github/workflows/blender-contract.yml', import.meta.url), 'utf8')

function job(name, nextName) {
  const start = workflow.indexOf(`\n  ${name}:`)
  assert.notEqual(start, -1, `missing ${name} job`)
  const end = nextName === undefined ? workflow.length : workflow.indexOf(`\n  ${nextName}:`, start + 1)
  assert.notEqual(end, -1, `missing ${nextName} job boundary`)
  return workflow.slice(start, end)
}

test('pull requests run platform checks while distribution stays tag-only', () => {
  assert.match(workflow, /\n  pull_request:\n/)
  assert.match(job('full-contract', 'linux'), /run: npm run test:full/)
  assert.match(job('linux', 'windows'), /test-addon-headless\.mjs --desktop-smoke/)
  assert.match(job('windows', 'release-candidate'), /test-addon-headless\.mjs --desktop-smoke/)
  for (const [name, next] of [
    ['release-candidate', 'publish-npm'],
    ['publish-npm', 'publish-github-release'],
    ['publish-github-release', undefined],
  ]) {
    assert.match(job(name, next), /if: \$\{\{ startsWith\(github\.ref, 'refs\/tags\/v'\) \}\}/)
  }
})

test('new PR revisions can supersede stale checks without cancelling tagged distribution', () => {
  assert.match(workflow, /concurrency:\n  group: release-candidate-\$\{\{ github\.ref \}\}\n(?:  #[^\n]*\n)?  cancel-in-progress: \$\{\{ github\.event_name == 'pull_request' \}\}/)
})

test('only the compositor shard gets expanded-corpus timeout headroom', () => {
  const linux = job('linux', 'windows')
  const timeouts = [...linux.matchAll(/^    timeout-minutes: (.+)$/gm)].map(match => match[1])
  assert.deepEqual(timeouts, ["${{ matrix.suite == 'compositor' && 90 || 75 }}"])
  assert.match(linux, /suite: \[compositor, shaders, geometry, noise-fbm, noise-types\]/)
  assert.match(linux, /suite: noise-watchdog-diagnostic/)
})

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
  assert.match(publisher, /SCENETOWEB_NPM_TRUSTED_PUBLISHING/)
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
  assert.match(publisher, /SCENETOWEB_IMMUTABLE_RELEASES/)
  assert.match(publisher, /verify-retained-release\.mjs github/)
  assert.doesNotMatch(publisher, /--clobber|gh release upload/)
  for (const filename of [
    'scenetoweb-$RELEASE_VERSION.tgz',
    'scenetoweb-addon-$RELEASE_VERSION.zip',
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

test('release channels use strict core and prerelease SemVer identifiers', () => {
  for (const version of ['0.9.0', '1.0.0', '2.10.123']) {
    const policy = releaseChannelPolicy(version)
    assert.equal(policy.channel, 'stable')
    assert.equal(policy.npmDistTag, 'latest')
    assert.equal(policy.githubPrerelease, false)
    assert.equal(policy.githubLatest, true)
    assert.equal(policy.githubTitle, `SceneToWeb ${version}`)
  }
  for (const version of ['1.0.0-alpha', '1.0.0-beta.0', '1.0.0-rc.1', '1.0.0-0', '1.0.0-01a']) {
    const policy = releaseChannelPolicy(version)
    assert.equal(policy.channel, 'prerelease')
    assert.equal(policy.npmDistTag, 'beta')
    assert.equal(policy.githubPrerelease, true)
    assert.equal(policy.githubLatest, false)
    assert.equal(policy.githubTitle, `SceneToWeb ${version} prerelease`)
  }
  for (const version of [undefined, null, 1, '', 'v1.0.0', '1.0', '01.0.0', '1.00.0', '1.0.01',
    '1.0.0-', '1.0.0-01', '1.0.0-rc.01', '1.0.0-rc..1', '1.0.0-rc_1',
    '1.0.0+build.1', '1.0.0-beta.1+build.1', ' 1.0.0', '1.0.0\n']) {
    assert.throws(() => releaseChannelPolicy(version), /strict SemVer/, String(version))
  }
})

test('workflow channel CLI returns literal flags and refuses invalid input before publication', () => {
  const cli = fileURLToPath(new URL('./release-channel.mjs', import.meta.url))
  const run = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' })
  for (const version of ['1.0.0', '1.0.0-rc.1']) {
    const policy = releaseChannelPolicy(version)
    for (const [field, key] of [['npm-dist-tag', 'npmDistTag'], ['github-prerelease', 'githubPrerelease'],
      ['github-latest', 'githubLatest'], ['github-title', 'githubTitle']]) {
      const result = run(version, field)
      assert.equal(result.status, 0, result.stderr)
      assert.equal(result.stdout, `${policy[key]}\n`)
    }
  }
  for (const args of [[], ['01.0.0', 'npm-dist-tag'], ['1.0.0', 'unknown'],
    ['1.0.0', 'npm-dist-tag', 'extra']]) {
    const result = run(...args)
    assert.equal(result.status, 1)
    assert.equal(result.stdout, '')
  }
})

test('npm and GitHub consume the same channel policy for create and publish', () => {
  const candidate = job('release-candidate', 'publish-npm')
  assert.match(candidate, /release-channel\.mjs "\$version" npm-dist-tag/)
  assert.match(job('publish-npm', 'publish-github-release'), /release-channel\.mjs "\$RELEASE_VERSION" npm-dist-tag/)
  const publisher = job('publish-github-release')
  for (const field of ['github-prerelease', 'github-latest', 'github-title']) {
    assert.ok(publisher.includes(`release-channel.mjs "$RELEASE_VERSION" ${field}`))
  }
  assert.equal([...publisher.matchAll(/--prerelease="\$release_prerelease"/g)].length, 2)
  assert.equal([...publisher.matchAll(/--latest="\$release_latest"/g)].length, 2)
  assert.match(publisher, /releases\/latest.*--jq \.tag_name/)
  assert.doesNotMatch(publisher, /public beta|--latest=false|--prerelease\s*\\/)
})
