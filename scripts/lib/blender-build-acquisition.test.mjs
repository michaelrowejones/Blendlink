import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { execFile as callbackExecFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildIdentity } from './blender-build-discovery.mjs'
import { acquireBlenderBuild, EXTRACT_ARCHIVE_PROGRAM, parseNativeBuildVersion, validateLinuxExecutableHeader } from './blender-build-acquisition.mjs'

const python = process.env.BLENDLINK_TEST_PYTHON || 'python3'
const execFile = promisify(callbackExecFile), sha = data => createHash('sha256').update(data).digest('hex')
const hash = 'abcdef123456', root = `blender-5.4.0-alpha+main.${hash}-linux.x86_64-release`, fileName = root + '.tar.xz'
const probe = `Blender 5.4.0 Alpha\n\tbuild hash: ${hash}\n\tbuild branch: main\n\tbuild platform: Linux\n`
function document(bytes) {
  const value = { schemaVersion: 1, kind: 'blender-build-discovery', selection: { app: 'Blender', branch: 'main', platform: 'linux', architecture: 'x86_64' }, build: { version: '5.4.0', versionTuple: [5, 4, 0], releaseCycle: 'alpha', hash, fileMtime: 100 }, source: { repository: 'blender/blender', commit: hash + 'c'.repeat(28), tree: 'd'.repeat(40) }, archive: { url: 'https://cdn.builder.blender.org/download/daily/' + fileName, fileName, sizeBytes: bytes.length, checksumUrl: 'https://cdn.builder.blender.org/download/daily/' + fileName + '.sha256', sha256: sha(bytes) }, qualification: 'unqualified' }
  value.identity = { algorithm: 'sha256', value: buildIdentity(value) }; return value
}
function elf(machine = 62) { const bytes = Buffer.alloc(64); bytes.write('\x7fELF', 0, 'ascii'); bytes[4] = 2; bytes[5] = 1; bytes[6] = 1; bytes.writeUInt16LE(machine, 18); return bytes }
async function scope(t) { const path = await mkdtemp(join(tmpdir(), 'blendlink-acquire-test-')); t.after(() => rm(path, { recursive: true, force: true })); return { path, cacheDir: join(path, 'cache'), workDir: join(path, 'work') } }
async function tar(path, entries = [{ name: root + '/blender', data: elf().toString('hex'), mode: 0o755 }]) {
  const archive = join(path, 'fixture.tar.xz')
  await execFile(python, ['-c', String.raw`
import io, json, sys, tarfile
with tarfile.open(sys.argv[1], 'w:xz') as output:
    for value in json.loads(sys.argv[2]):
        member = tarfile.TarInfo(value['name'])
        member.mode = value.get('mode', 0o644)
        if value.get('type') == 'symlink':
            member.type = tarfile.SYMTYPE
            member.linkname = value['link']
            output.addfile(member)
        elif value.get('type') == 'fifo':
            member.type = tarfile.FIFOTYPE
            output.addfile(member)
        else:
            data = bytes.fromhex(value.get('data', ''))
            member.size = len(data)
            output.addfile(member, io.BytesIO(data))
`, archive, JSON.stringify(entries)])
  return readFile(archive)
}
function options(scope, bytes, extra = {}) {
  const calls = [], requests = []
  return { ...scope, platform: 'linux', architecture: 'x64', python, calls, requests, fetchImpl: async url => { requests.push(url); return new Response(bytes) }, run: async (file, args, settings) => { calls.push({ file, args, settings }); return args[0] === '--version' ? { stdout: probe, stderr: '' } : execFile(file, args, settings) }, ...extra }
}

test('Linux-only acquisition hashes download/cache bytes and probes the owned executable each time', async t => {
  const paths = await scope(t), bytes = await tar(paths.path), input = document(bytes), firstOptions = options(paths, bytes)
  const first = await acquireBlenderBuild(input, firstOptions)
  assert.equal(first.kind, 'blender-build-acquisition'); assert.equal(first.qualification, 'unqualified'); assert.equal(first.acquisition.cacheHit, false); assert.equal(first.acquisition.checksumVerified, true)
  assert.equal(first.native.buildHash, hash); assert.equal(first.native.probeSha256, sha(probe)); assert.equal(first.source.commit, input.source.commit)
  assert.equal(firstOptions.requests.length, 1); assert.deepEqual(firstOptions.calls.at(-1).args, ['--version']); assert.equal(firstOptions.calls.at(-1).file, first.native.executable)
  assert.equal((await readFile(first.native.executable)).toString('hex'), elf().toString('hex')); assert.ok(!(await readdir(first.native.directory)).includes('.archive.tar.xz'))
  const secondOptions = options(paths, bytes), second = await acquireBlenderBuild(input, secondOptions)
  assert.equal(second.acquisition.cacheHit, true); assert.equal(secondOptions.requests.length, 0); assert.notEqual(first.native.directory, second.native.directory); assert.equal(secondOptions.calls.length, 2)
  await assert.rejects(acquireBlenderBuild(input, { ...firstOptions, platform: 'darwin', architecture: 'arm64' }), /actual Linux/)
})

test('corrupt cache cannot become trusted through a prior hit and private failed extraction directories are cleaned', async t => {
  const paths = await scope(t), bytes = await tar(paths.path), input = document(bytes), settings = options(paths, bytes)
  const good = await acquireBlenderBuild(input, settings)
  const corrupted = Buffer.from(bytes); corrupted[corrupted.length - 1] ^= 1; await writeFile(good.acquisition.archivePath, corrupted)
  settings.calls.length = 0; settings.requests.length = 0
  await assert.rejects(acquireBlenderBuild(input, settings), /SHA256\/size/)
  assert.equal(settings.calls.length, 0); assert.equal(settings.requests.length, 0)
  assert.deepEqual(await readdir(paths.workDir), [good.native.directory.split('/').at(-1)])
  assert.deepEqual(await readFile(good.acquisition.archivePath), corrupted)
})

test('download length/checksum failure never extracts, publishes cache, or leaves owned work behind', async t => {
  for (const mode of ['long', 'short', 'corrupt']) {
    const paths = await scope(t), bytes = await tar(paths.path), input = document(bytes)
    const bad = mode === 'long' ? Buffer.concat([bytes, Buffer.from('extra')]) : mode === 'short' ? bytes.subarray(1) : Buffer.from(bytes)
    if (mode === 'corrupt') bad[0] ^= 1
    const settings = options(paths, bad)
    await assert.rejects(acquireBlenderBuild(input, settings), /byte size|SHA256\/size/)
    assert.equal(settings.calls.length, 0); assert.deepEqual(await readdir(paths.workDir), []); assert.deepEqual(await readdir(paths.cacheDir), [])
  }
})

test('cached archive symlinks are refused without following or deleting the external target', async t => {
  const paths = await scope(t), bytes = await tar(paths.path), input = document(bytes), good = await acquireBlenderBuild(input, options(paths, bytes)), target = join(paths.path, 'external')
  await writeFile(target, 'external-data'); await rm(good.acquisition.archivePath); await symlink(target, good.acquisition.archivePath)
  await assert.rejects(acquireBlenderBuild(input, options(paths, bytes)), /ELOOP/)
  assert.equal(await readFile(target, 'utf8'), 'external-data')
})

test('source discovery is snapshotted before asynchronous acquisition', async t => {
  const paths = await scope(t), bytes = await tar(paths.path), input = document(bytes)
  const settings = options(paths, bytes, { fetchImpl: async () => { input.source.commit = 'e'.repeat(40); input.archive.sha256 = 'f'.repeat(64); return new Response(bytes) } })
  const result = await acquireBlenderBuild(input, settings)
  assert.equal(result.source.commit, hash + 'c'.repeat(28)); assert.equal(result.archive.sha256, sha(bytes))
})

test('safe extraction rejects path traversal, external links, duplicate paths, special files and wrong root', async t => {
  const attacks = [{ name: '../escape' }, { name: '/absolute' }, { name: 'other-root/blender' }, { name: root + '/link', type: 'symlink', link: '../../escape' }, { name: root + '/pipe', type: 'fifo' }]
  for (const entry of attacks) {
    const paths = await scope(t), bytes = await tar(paths.path, [entry])
    await assert.rejects(acquireBlenderBuild(document(bytes), options(paths, bytes)), error => /unsafe|root|escapes|special/.test(error.stderr || error.message))
    assert.deepEqual(await readdir(paths.workDir), [])
  }
  const paths = await scope(t), bytes = await tar(paths.path, [{ name: root + '/blender' }, { name: root + '/blender' }])
  await assert.rejects(acquireBlenderBuild(document(bytes), options(paths, bytes)), error => /duplicate/.test(error.stderr || error.message))
})

test('executable symlinks, wrong ELF architecture and native probe mismatches never return acquisition identity', async t => {
  const entries = [
    [{ name: root + '/real', data: elf().toString('hex'), mode: 0o755 }, { name: root + '/blender', type: 'symlink', link: 'real' }],
    [{ name: root + '/blender', data: elf(183).toString('hex'), mode: 0o755 }],
  ]
  for (const entry of entries) { const paths = await scope(t), bytes = await tar(paths.path, entry); await assert.rejects(acquireBlenderBuild(document(bytes), options(paths, bytes)), /regular file|ELF64/); assert.deepEqual(await readdir(paths.workDir), []) }
  const paths = await scope(t), bytes = await tar(paths.path)
  const settings = options(paths, bytes); const originalRun = settings.run; settings.run = (file, args, opts) => args[0] === '--version' ? { stdout: probe.replace(hash, 'fedcba123456') } : originalRun(file, args, opts)
  await assert.rejects(acquireBlenderBuild(document(bytes), settings), /identity/); assert.deepEqual(await readdir(paths.workDir), [])
})

test('version probe validates version, release cycle, branch, platform and exact source hash independently', () => {
  const input = document(Buffer.from('fixture')); assert.equal(parseNativeBuildVersion(probe, input).buildHash, hash)
  for (const text of [probe.replace('5.4.0', '5.4.1'), probe.replace('Alpha', 'Beta'), probe.replace('main', 'release'), probe.replace('Linux', 'Windows'), probe.replace(hash, 'abcdef'), probe + `build hash: ${hash}\n`, '']) assert.throws(() => parseNativeBuildVersion(text, input))
  for (const bytes of [Buffer.alloc(3), Buffer.alloc(64), elf(183)]) assert.throws(() => validateLinuxExecutableHeader(bytes))
  assert.ok(EXTRACT_ARCHIVE_PROGRAM.includes("filter='data'"))
})
