import { createHash } from 'node:crypto'

export const DAILY_FEED_URL = 'https://builder.blender.org/download/daily/?format=json&v=1'
export const ARCHIVE_HOSTS = Object.freeze(['builder.blender.org', 'cdn.builder.blender.org', 'download.blender.org'])
const CYCLES = new Set(['alpha', 'beta', 'rc', 'stable'])
const HEX40 = /^[0-9a-f]{40}$/
const HASH = /^[0-9a-f]{7,40}$/
const SHA256 = /^[0-9a-f]{64}$/
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
const LIMITS = Object.freeze({ feed: 8 * 1024 * 1024, checksum: 8192, source: 8 * 1024 * 1024 })
const fail = message => { throw new Error(message) }
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const sha = bytes => createHash('sha256').update(bytes).digest('hex')

export function officialUrl(value, purpose = 'archive') {
  if (typeof value !== 'string' || value.length > 4096 || /[\u0000-\u0020\u007f]/.test(value)) fail('Official URL must be a bounded, whitespace-free HTTPS URL')
  let url
  try { url = new URL(value) } catch { fail('Invalid official URL') }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) fail('Official URL requires HTTPS, no credentials/port/fragment')
  if (purpose === 'source') {
    if (url.hostname !== 'api.github.com' || !/^\/repos\/blender\/blender\/commits\/[0-9a-f]{7,40}$/.test(url.pathname) || url.search) fail('Source identity must use the official blender/blender commits API')
  } else if (!ARCHIVE_HOSTS.includes(url.hostname) || !url.pathname.startsWith('/download/') || /%2f|%5c/i.test(url.pathname)) {
    fail('URL is outside the exact official Blender download host/path allowlist')
  }
  return url.href
}

export async function officialResponse(value, { purpose = 'archive', fetchImpl = fetch, maxRedirects = 5, timeoutMs = 30_000 } = {}) {
  let url = officialUrl(value, purpose)
  for (let redirects = 0; redirects <= maxRedirects; redirects++) {
    const response = await fetchImpl(url, { redirect: 'manual', signal: AbortSignal.timeout(timeoutMs), headers: { 'User-Agent': 'SceneToWeb-Upstream-Discovery/1', ...(purpose === 'source' ? { Accept: 'application/vnd.github+json' } : {}) } })
    if (response.redirected) fail('Transport followed a redirect without official-host validation')
    if (response.url) officialUrl(response.url, purpose)
    if (response.status >= 300 && response.status < 400) {
      if (redirects === maxRedirects) fail('Too many official download redirects')
      const location = response.headers.get('location')
      if (!location) fail('Official redirect lacks Location')
      url = officialUrl(new URL(location, url).href, purpose)
      await response.body?.cancel?.()
      continue
    }
    if (response.status !== 200) fail(`Official ${purpose} request returned HTTP ${response.status}`)
    return { response, finalUrl: url }
  }
  fail('Official redirect resolution failed')
}

export async function officialBytes(value, { purpose = 'feed', maximumBytes = LIMITS[purpose], ...options } = {}) {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes <= 0) fail('A bounded response size is required')
  const { response, finalUrl } = await officialResponse(value, { purpose, ...options })
  if (!response.body) fail(`Official ${purpose} response has no body`)
  const chunks = []; let size = 0
  for await (const chunk of response.body) {
    const bytes = Buffer.from(chunk); size += bytes.length
    if (size > maximumBytes) { await response.body.cancel?.().catch?.(() => {}); fail(`Official ${purpose} response exceeds its byte budget`) }
    chunks.push(bytes)
  }
  return { bytes: Buffer.concat(chunks), finalUrl }
}

function json(bytes, label) {
  try { return JSON.parse(bytes.toString('utf8')) } catch { fail(`Official ${label} is not valid JSON`) }
}
function versionTuple(value) {
  if (typeof value !== 'string' || !VERSION.test(value)) fail('Build version must be an exact numeric major.minor.patch')
  const tuple = value.split('.').map(Number)
  if (!tuple.every(Number.isSafeInteger) || tuple.some(n => n > 9999)) fail('Build version components are out of bounds')
  return tuple
}
function basename(url) {
  try { return decodeURIComponent(new URL(url).pathname.split('/').at(-1)) } catch { fail('Malformed filename URL encoding') }
}
function validateTarget(row, index) {
  for (const key of ['url', 'app', 'version', 'risk_id', 'branch', 'patch', 'hash', 'platform', 'architecture', 'file_name', 'file_extension', 'release_cycle']) if (typeof row[key] !== 'string') fail(`Daily feed target ${index} lacks string ${key}`)
  versionTuple(row.version)
  if (!CYCLES.has(row.release_cycle) || row.risk_id !== row.release_cycle || row.patch !== '' || !HASH.test(row.hash)) fail(`Daily feed target ${index} has inconsistent build metadata`)
  if (row.bitness !== 64 || !Number.isSafeInteger(row.file_mtime) || row.file_mtime <= 0 || !Number.isSafeInteger(row.file_size) || row.file_size <= 0 || row.file_size > 4 * 1024 ** 3) fail(`Daily feed target ${index} has invalid size/timestamp/bitness`)
  const archiveName = `blender-${row.version}-${row.release_cycle}+main.${row.hash}-linux.x86_64-release.tar.xz`
  const expectedName = row.file_extension === 'sha256' ? archiveName + '.sha256' : archiveName
  if (!['xz', 'sha256'].includes(row.file_extension) || row.file_name !== expectedName || basename(officialUrl(row.url)) !== expectedName) fail(`Daily feed target ${index} filename/architecture/version/hash does not match its metadata`)
  if (row.file_extension === 'sha256' && row.file_size > LIMITS.checksum) fail('Checksum companion exceeds its byte budget')
  return { ...row, url: officialUrl(row.url) }
}

export function selectLatestDailyBuild(feed) {
  if (!Array.isArray(feed) || feed.length === 0 || feed.length > 20_000 || feed.some(row => !record(row))) fail('Official daily feed must be a bounded nonempty array of records')
  const targets = []
  for (const [index, row] of feed.entries()) {
    if (typeof row.app !== 'string' || typeof row.branch !== 'string' || typeof row.platform !== 'string' || typeof row.architecture !== 'string') fail(`Malformed daily feed selector at row ${index}`)
    if (row.app !== 'Blender' || row.branch !== 'main' || row.platform !== 'linux' || row.architecture !== 'x86_64') continue
    // Main Linux can include non-archive products in a future feed; only an
    // archive or its checksum is relevant, but contradictory .tar.xz rows fail.
    if (row.file_extension !== 'xz' && row.file_extension !== 'sha256' && !(typeof row.file_name === 'string' && /\.tar\.xz(?:\.sha256)?$/.test(row.file_name))) continue
    targets.push(validateTarget(row, index))
  }
  const archives = targets.filter(row => row.file_extension === 'xz')
  if (!archives.length) fail('No official Blender main Linux x86_64 tar.xz build is available')
  const latest = Math.max(...archives.map(row => row.file_mtime)), candidates = archives.filter(row => row.file_mtime === latest)
  if (candidates.length !== 1) fail('Latest official daily build has ambiguous archive identity')
  const archive = candidates[0]
  if (targets.filter(row => row.file_name === archive.file_name).length !== 1) fail('Official archive identity is duplicated')
  const checksums = targets.filter(row => row.file_name === archive.file_name + '.sha256')
  if (checksums.length !== 1) fail('Latest official build requires exactly one matching checksum companion')
  const checksum = checksums[0]
  for (const key of ['app', 'version', 'risk_id', 'release_cycle', 'branch', 'patch', 'hash', 'platform', 'architecture', 'bitness']) if (archive[key] !== checksum[key]) fail(`Checksum companion has mismatched ${key}`)
  return { archive, checksum }
}

export function parseOfficialChecksum(bytes, fileName) {
  const text = Buffer.from(bytes).toString('utf8')
  const match = /^([0-9a-fA-F]{64})(?:[ \t]+\*?([^\r\n]+))?\r?\n?$/.exec(text)
  if (!match || (match[2] && match[2] !== fileName)) fail('Official checksum must contain one SHA256 for the exact archive filename')
  return match[1].toLowerCase()
}

export function sourceIdentity(payload, buildHash) {
  if (typeof buildHash !== 'string' || !HASH.test(buildHash) || !record(payload) || typeof payload.sha !== 'string' || !HEX40.test(payload.sha) || !record(payload.commit) || !record(payload.commit.tree) || typeof payload.commit.tree.sha !== 'string' || !HEX40.test(payload.commit.tree.sha) || !payload.sha.startsWith(buildHash)) fail('Official source commit/tree does not resolve the exact advertised build hash')
  return { repository: 'blender/blender', commit: payload.sha, tree: payload.commit.tree.sha }
}

export function buildIdentity(document) {
  const { selection: s, build: b, source: r, archive: a } = document
  return sha(JSON.stringify({ selection: { app: s.app, branch: s.branch, platform: s.platform, architecture: s.architecture }, build: { version: b.version, versionTuple: b.versionTuple, releaseCycle: b.releaseCycle, hash: b.hash, fileMtime: b.fileMtime }, source: { repository: r.repository, commit: r.commit, tree: r.tree }, archive: { url: a.url, fileName: a.fileName, sizeBytes: a.sizeBytes, checksumUrl: a.checksumUrl, sha256: a.sha256 } }))
}

export function validateDiscovery(document) {
  if (!record(document) || document.schemaVersion !== 1 || document.kind !== 'blender-build-discovery' || document.qualification !== 'unqualified') fail('Expected an unqualified Blender discovery document schema1')
  const target = { app: 'Blender', branch: 'main', platform: 'linux', architecture: 'x86_64' }
  if (!record(document.selection) || Object.keys(document.selection).length !== 4 || Object.entries(target).some(([key, value]) => document.selection[key] !== value)) fail('Discovery selection is not the fixed Blender main Linux x86_64 target')
  const build = document.build, archive = document.archive
  if (!record(build) || !record(archive) || !record(document.source) || document.source.repository !== 'blender/blender') fail('Discovery build/source/archive shape is invalid')
  const tuple = versionTuple(build.version)
  if (JSON.stringify(tuple) !== JSON.stringify(build.versionTuple) || typeof build.hash !== 'string' || !HASH.test(build.hash) || !CYCLES.has(build.releaseCycle) || !Number.isSafeInteger(build.fileMtime) || build.fileMtime <= 0) fail('Discovery build identity is invalid')
  sourceIdentity({ sha: document.source.commit, commit: { tree: { sha: document.source.tree } } }, build.hash)
  const expectedName = `blender-${build.version}-${build.releaseCycle}+main.${build.hash}-linux.x86_64-release.tar.xz`
  if (archive.fileName !== expectedName || basename(officialUrl(archive.url)) !== expectedName || basename(officialUrl(archive.checksumUrl)) !== expectedName + '.sha256' || typeof archive.sha256 !== 'string' || !SHA256.test(archive.sha256) || !Number.isSafeInteger(archive.sizeBytes) || archive.sizeBytes <= 0 || archive.sizeBytes > 4 * 1024 ** 3) fail('Discovery archive metadata is invalid')
  if (!record(document.identity) || document.identity.algorithm !== 'sha256' || document.identity.value !== buildIdentity(document)) fail('Discovery canonical identity digest does not match its fields')
  return document
}

export async function discoverBlenderBuild({ fetchImpl = fetch, now = () => new Date().toISOString() } = {}) {
  const feed = await officialBytes(DAILY_FEED_URL, { fetchImpl, purpose: 'feed' })
  const { archive, checksum } = selectLatestDailyBuild(json(feed.bytes, 'daily feed'))
  const [checksumData, sourceData] = await Promise.all([
    officialBytes(checksum.url, { fetchImpl, purpose: 'checksum' }),
    officialBytes(`https://api.github.com/repos/blender/blender/commits/${archive.hash}`, { fetchImpl, purpose: 'source' }),
  ])
  const document = {
    schemaVersion: 1, kind: 'blender-build-discovery',
    selection: { app: 'Blender', branch: 'main', platform: 'linux', architecture: 'x86_64' },
    build: { version: archive.version, versionTuple: versionTuple(archive.version), releaseCycle: archive.release_cycle, hash: archive.hash, fileMtime: archive.file_mtime },
    source: sourceIdentity(json(sourceData.bytes, 'source commit'), archive.hash),
    archive: { url: archive.url, fileName: archive.file_name, sizeBytes: archive.file_size, checksumUrl: checksum.url, sha256: parseOfficialChecksum(checksumData.bytes, archive.file_name) },
    qualification: 'unqualified',
    provenance: { feedUrl: DAILY_FEED_URL, feedFinalUrl: feed.finalUrl, feedSha256: sha(feed.bytes), checksumFinalUrl: checksumData.finalUrl, checksumResponseSha256: sha(checksumData.bytes), sourceApiUrl: sourceData.finalUrl, sourceResponseSha256: sha(sourceData.bytes), discoveredAt: now() },
  }
  document.identity = { algorithm: 'sha256', value: buildIdentity(document) }
  return validateDiscovery(document)
}
