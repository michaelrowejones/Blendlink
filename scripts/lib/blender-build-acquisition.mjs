import { constants as fsConstants } from 'node:fs'
import { copyFile, lstat, mkdir, mkdtemp, open, realpath, rename, rm } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { execFile as nativeExecFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join, relative, resolve, sep } from 'node:path'
import { officialResponse, validateDiscovery } from './blender-build-discovery.mjs'

const execFile = promisify(nativeExecFile)
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const fail = message => { throw new Error(message) }

// Python's data filter checks actual resolved link destinations during extraction.
// The extra checks bound work/storage and require the official single-root layout.
// This is constant program text: paths are subprocess arguments, never shell code.
export const EXTRACT_ARCHIVE_PROGRAM = String.raw`
import posixpath, sys, tarfile
archive, destination, root = sys.argv[1:]
if not hasattr(tarfile, 'data_filter'):
    raise RuntimeError('Safe extraction requires Python tarfile.data_filter (Python 3.12 or patched 3.11)')
with tarfile.open(archive, mode='r:xz') as source:
    members = []
    expanded = 0
    names = set()
    for member in source:
        name = member.name
        if not name or '\\' in name or '\x00' in name or name.startswith('/') or '..' in name.split('/'):
            raise RuntimeError('Archive member has an unsafe path')
        name = posixpath.normpath(name)
        if name != root and not name.startswith(root + '/'):
            raise RuntimeError('Archive member is outside its expected root')
        if name in names:
            raise RuntimeError('Archive has duplicate member paths')
        names.add(name)
        if not (member.isfile() or member.isdir() or member.issym() or member.islnk()):
            raise RuntimeError('Archive contains an unsupported special file')
        if member.issym() or member.islnk():
            target = member.linkname
            if not target or target.startswith('/') or '\\' in target or '\x00' in target:
                raise RuntimeError('Archive link has an unsafe target')
            target = posixpath.normpath(posixpath.join(posixpath.dirname(name), target) if member.issym() else target)
            if target != root and not target.startswith(root + '/'):
                raise RuntimeError('Archive link escapes its expected root')
        if member.size < 0:
            raise RuntimeError('Archive member has invalid size')
        expanded += member.size
        members.append(member)
        if expanded > 8 * 1024**3 or len(members) > 250000:
            raise RuntimeError('Archive exceeds extraction size/member budget')
    if not members:
        raise RuntimeError('Archive is empty')
    source.extractall(path=destination, members=members, filter='data')
`

export function parseNativeBuildVersion(stdout, discovery) {
  validateDiscovery(discovery)
  if (typeof stdout !== 'string' || stdout.length > 1024 * 1024) fail('Native version probe is missing or oversized')
  const header = /^Blender (\d+\.\d+\.\d+)(?: (Alpha|Beta|Release Candidate|Stable))?\r?$/m.exec(stdout)
  const fields = {}
  for (const line of stdout.split(/\r?\n/)) {
    const field = /^\s*build (hash|branch|platform):\s*(.*?)\s*$/.exec(line)
    if (field) { if (Object.hasOwn(fields, field[1])) fail('Native version probe has duplicate identity fields'); fields[field[1]] = field[2] }
  }
  const cycles = { Alpha: 'alpha', Beta: 'beta', 'Release Candidate': 'rc', Stable: 'stable' }
  if (!header || header[1] !== discovery.build.version || (cycles[header[2]] ?? 'stable') !== discovery.build.releaseCycle || fields.branch !== 'main' || fields.platform !== 'Linux' || !/^[0-9a-f]{7,40}$/.test(fields.hash ?? '') || !discovery.source.commit.startsWith(fields.hash) || !fields.hash.startsWith(discovery.build.hash)) fail('Actual Blender --version identity does not match official discovery metadata')
  return { version: header[1], versionTuple: [...discovery.build.versionTuple], buildHash: fields.hash, branch: fields.branch, platform: fields.platform, probeSha256: digest(stdout) }
}

export function validateLinuxExecutableHeader(bytes) {
  if (bytes.length < 20 || bytes[0] !== 0x7f || bytes.toString('ascii', 1, 4) !== 'ELF' || bytes[4] !== 2 || bytes[5] !== 1 || bytes[6] !== 1 || bytes.readUInt16LE(18) !== 62) fail('Acquired Blender executable is not Linux x86_64 ELF64')
}

async function writeChunk(handle, chunk) {
  let offset = 0
  while (offset < chunk.length) {
    const { bytesWritten } = await handle.write(chunk, offset, chunk.length - offset)
    if (!bytesWritten) fail('Archive staging write did not advance')
    offset += bytesWritten
  }
}

async function stageVerifiedArchive(chunks, destination, archive) {
  const output = await open(destination, 'wx', 0o600), hash = createHash('sha256'); let size = 0
  try {
    for await (const value of chunks) {
      const chunk = Buffer.from(value); size += chunk.length
      if (size > archive.sizeBytes) fail('Archive response exceeds its exact declared byte size')
      hash.update(chunk); await writeChunk(output, chunk)
    }
    if (size !== archive.sizeBytes || hash.digest('hex') !== archive.sha256) fail('Archive SHA256/size does not match the official discovery checksum')
    await output.sync()
  } finally { await output.close() }
}

async function cachedArchive(path, staging, archive) {
  let handle
  try { handle = await open(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW) } catch (error) { if (error.code === 'ENOENT') return false; throw error }
  try {
    if (!(await handle.stat()).isFile()) fail('Cached archive is not a regular file')
    // Hash the private copy, not a pathname that could change after validation.
    await stageVerifiedArchive(handle.createReadStream({ autoClose: false }), staging, archive)
  } finally { await handle.close() }
  return true
}

export async function acquireBlenderBuild(document, { cacheDir, workDir, platform = process.platform, architecture = process.arch, fetchImpl = fetch, run = execFile, python = 'python3' } = {}) {
  if (platform !== 'linux' || architecture !== 'x64') fail('Blender build acquisition supports an actual Linux x86_64 host only')
  // Callers may retain and mutate their document while a network request awaits.
  const discovery = structuredClone(document); validateDiscovery(discovery)
  if (typeof cacheDir !== 'string' || !cacheDir || typeof workDir !== 'string' || !workDir) fail('Explicit archive cache and owned work directories are required')
  cacheDir = resolve(cacheDir); workDir = resolve(workDir)
  await mkdir(cacheDir, { recursive: true }); await mkdir(workDir, { recursive: true })
  const directory = await mkdtemp(join(workDir, 'blendlink-blender-')), staging = join(directory, '.archive.tar.xz'), archivePath = join(cacheDir, 'sha256-' + discovery.archive.sha256 + '.tar.xz')
  try {
    const cacheHit = await cachedArchive(archivePath, staging, discovery.archive)
    if (!cacheHit) {
      const { response } = await officialResponse(discovery.archive.url, { fetchImpl, purpose: 'archive', timeoutMs: 15 * 60_000 })
      if (!response.body) fail('Official archive response has no body')
      await stageVerifiedArchive(response.body, staging, discovery.archive)
      const temporary = join(cacheDir, '.archive-' + randomUUID() + '.tmp')
      try { await copyFile(staging, temporary, fsConstants.COPYFILE_EXCL); await rename(temporary, archivePath) } finally { await rm(temporary, { force: true }) }
    }
    const root = discovery.archive.fileName.slice(0, -'.tar.xz'.length)
    await run(python, ['-c', EXTRACT_ARCHIVE_PROGRAM, staging, directory, root], { timeout: 10 * 60_000, maxBuffer: 1024 * 1024, encoding: 'utf8' })
    const executable = join(directory, root, 'blender'), info = await lstat(executable), actual = await realpath(executable), within = relative(await realpath(directory), actual)
    if (!info.isFile() || info.isSymbolicLink() || !within || within === '..' || within.startsWith('..' + sep) || (info.mode & 0o111) === 0) fail('Extracted Blender executable must be an owned executable regular file')
    const handle = await open(executable, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW)
    try { const bytes = Buffer.alloc(64); const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0); validateLinuxExecutableHeader(bytes.subarray(0, bytesRead)) } finally { await handle.close() }
    const probe = await run(executable, ['--version'], { timeout: 60_000, maxBuffer: 1024 * 1024, encoding: 'utf8', env: { ...process.env, LC_ALL: 'C', LANG: 'C' } })
    const native = parseNativeBuildVersion(probe.stdout, discovery)
    await rm(staging)
    return { ...discovery, kind: 'blender-build-acquisition', native: { ...native, directory, executable }, acquisition: { archivePath, cacheHit, checksumVerified: true } }
  } catch (error) { await rm(directory, { recursive: true, force: true }); throw error }
}
