import assert from 'node:assert/strict'
import test from 'node:test'
import { DAILY_FEED_URL, officialUrl, officialBytes, officialResponse, selectLatestDailyBuild, parseOfficialChecksum, sourceIdentity, buildIdentity, validateDiscovery, discoverBlenderBuild } from './blender-build-discovery.mjs'

const checksum = 'a'.repeat(64), buildHash = 'abcdef123456', fullCommit = buildHash + 'c'.repeat(28), tree = 'b'.repeat(40)
function row({ hash = buildHash, version = '5.4.0', time = 100, companion = false, ...overrides } = {}) {
  const fileName = `blender-${version}-alpha+main.${hash}-linux.x86_64-release.tar.xz${companion ? '.sha256' : ''}`
  return { app: 'Blender', branch: 'main', version, risk_id: 'alpha', release_cycle: 'alpha', patch: '', hash, platform: 'linux', architecture: 'x86_64', bitness: 64, file_mtime: time, file_size: companion ? 64 : 1000, file_extension: companion ? 'sha256' : 'xz', file_name: fileName, url: 'https://cdn.builder.blender.org/download/daily/' + fileName, ...overrides }
}
const pair = options => [row(options), row({ ...options, companion: true })]
function transport(feed = pair(), { checksumBody = checksum, source = { sha: fullCommit, commit: { tree: { sha: tree } } } } = {}) {
  const requested = []
  const fetchImpl = async (url, options) => {
    requested.push({ url, options })
    if (url === DAILY_FEED_URL) return new Response(JSON.stringify(feed))
    if (url.endsWith('.sha256')) return new Response(checksumBody)
    if (url.startsWith('https://api.github.com/repos/blender/blender/commits/')) return new Response(JSON.stringify(source))
    throw new Error('Unexpected test URL: ' + url)
  }
  return { requested, fetchImpl }
}

test('official feed selects the latest exact target and resolves the advertised hash, never version', async () => {
  const io = transport([...pair({ hash: '123456abcdef', time: 50 }), ...pair(), row({ platform: 'windows', architecture: 'amd64', time: 5000 })])
  const document = await discoverBlenderBuild({ fetchImpl: io.fetchImpl, now: () => '2026-11-13T00:00:00.000Z' })
  assert.equal(document.source.commit, fullCommit); assert.equal(document.source.tree, tree); assert.equal(document.archive.sha256, checksum)
  assert.equal(document.build.hash, buildHash); assert.deepEqual(document.build.versionTuple, [5, 4, 0]); assert.equal(document.qualification, 'unqualified')
  assert.ok(io.requested.some(row => row.url === `https://api.github.com/repos/blender/blender/commits/${buildHash}`))
  assert.ok(io.requested.every(row => row.options.redirect === 'manual'))
  assert.equal(document.identity.value, buildIdentity(document)); assert.equal(validateDiscovery(document), document)
  const reversed = { ...document, selection: { architecture: 'x86_64', platform: 'linux', branch: 'main', app: 'Blender' }, source: { tree, repository: 'blender/blender', commit: fullCommit } }
  assert.equal(buildIdentity(reversed), document.identity.value); validateDiscovery(reversed)
})

test('malformed target, wrong architecture/name and inconsistent metadata fail closed', () => {
  for (const feed of [null, {}, [], [null], [{ app: 'Blender' }]]) assert.throws(() => selectLatestDailyBuild(feed))
  assert.throws(() => selectLatestDailyBuild(pair({ architecture: 'arm64' })), /No official/)
  for (const changes of [{ bitness: 32 }, { hash: 'not-a-hash' }, { version: '5.4' }, { patch: 'unreviewed' }, { risk_id: 'beta' }, { file_mtime: '100' }, { file_size: -1 }, { file_name: 'blender-other-linux.arm64.tar.xz' }, { url: 'https://evil.example/download/archive.tar.xz' }]) assert.throws(() => selectLatestDailyBuild([{ ...row(), ...changes }, row({ companion: true })]))
})

test('missing/duplicate/ambiguous latest companion is not silently replaced with an older build', () => {
  assert.throws(() => selectLatestDailyBuild([...pair({ hash: '123456abcdef', time: 50 }), row()]), /matching checksum/)
  assert.throws(() => selectLatestDailyBuild([...pair(), row({ companion: true })]), /exactly one/)
  assert.throws(() => selectLatestDailyBuild([...pair(), ...pair({ hash: '123456abcdef' })]), /ambiguous/)
  assert.throws(() => selectLatestDailyBuild([...pair(), row()]), /ambiguous|duplicated/)
  assert.throws(() => selectLatestDailyBuild([row(), { ...row({ companion: true }), version: '5.5.0' }]), /filename|metadata/)
})

test('checksum parser requires one exact digest and matching optional filename', () => {
  const name = row().file_name
  assert.equal(parseOfficialChecksum(checksum, name), checksum)
  assert.equal(parseOfficialChecksum(checksum.toUpperCase() + ' *' + name + '\n', name), checksum)
  for (const text of ['', 'x'.repeat(64), checksum + '\n' + checksum, checksum + ' other.tar.xz', ' ' + checksum]) assert.throws(() => parseOfficialChecksum(text, name))
})

test('source API identity cannot substitute a different commit or infer a tree', () => {
  for (const source of [{}, { sha: fullCommit }, { sha: 'd'.repeat(40), commit: { tree: { sha: tree } } }, { sha: [fullCommit], commit: { tree: { sha: tree } } }, { sha: fullCommit, commit: { tree: { sha: 'short' } } }]) assert.throws(() => sourceIdentity(source, buildHash))
})

test('redirect host/protocol is validated before a second network request', async () => {
  for (const location of ['https://cdn.builder.blender.org.evil.example/download/a', 'http://cdn.builder.blender.org/download/a', 'https://user:pass@builder.blender.org/download/a', 'https://github.com/blender/blender/releases/a']) {
    let calls = 0
    await assert.rejects(officialResponse(DAILY_FEED_URL, { purpose: 'feed', fetchImpl: async () => { calls++; return new Response(null, { status: 302, headers: { location } }) } }))
    assert.equal(calls, 1)
  }
  const calls = []
  const result = await officialBytes(DAILY_FEED_URL, { purpose: 'feed', fetchImpl: async url => { calls.push(url); return calls.length === 1 ? new Response(null, { status: 302, headers: { location: 'https://cdn.builder.blender.org/download/daily/feed.json' } }) : new Response('[]') } })
  assert.equal(result.finalUrl, calls[1]); assert.equal(calls.length, 2)
  assert.throws(() => officialUrl('https://api.github.com/repos/other/repo/commits/' + buildHash, 'source'))
})

test('network bodies/status and discovery documents have meaningful integrity limits', async () => {
  await assert.rejects(officialBytes(DAILY_FEED_URL, { maximumBytes: 2, fetchImpl: async () => new Response('larger') }), /byte budget/)
  await assert.rejects(officialBytes(DAILY_FEED_URL, { fetchImpl: async () => new Response('no', { status: 404 }) }), /HTTP 404/)
  await assert.rejects(discoverBlenderBuild({ fetchImpl: transport(pair(), { checksumBody: 'broken' }).fetchImpl }), /checksum/)
  const document = await discoverBlenderBuild({ fetchImpl: transport().fetchImpl })
  for (const change of [doc => { doc.archive.sha256 = 'f'.repeat(64) }, doc => { doc.build.hash = 12345678 }, doc => { doc.source.commit = 'e'.repeat(40) }, doc => { doc.qualification = 'qualified' }, doc => { doc.archive.url = 'https://evil.example/download/' + doc.archive.fileName }]) { const changed = structuredClone(document); change(changed); assert.throws(() => validateDiscovery(changed)) }
})
