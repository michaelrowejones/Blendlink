// SPDX-License-Identifier: MIT
// Reconstruct only an isolated experimental source worktree. No install,
// build, input scene, GPU work, publication, or existing worktree reset.
import assert from 'node:assert/strict'
import { readFile, access } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const destination = process.argv[2] && resolve(process.argv[2])
assert.ok(destination && process.argv.length === 3, 'Use NEW_ABSOLUTE_WORKTREE_DIRECTORY')
await assert.rejects(access(destination), { code: 'ENOENT' })
const meta = JSON.parse(await readFile(new URL('integrated-sdk-43840-reconstruction.json', import.meta.url)))
const patch = await readFile(new URL('integrated-sdk-43840.patch', import.meta.url))
const commit = await readFile(new URL('integrated-sdk-43840.commit.txt', import.meta.url))
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
assert.equal(sha(patch), meta.patchSha256)
assert.equal(sha(commit), meta.commitObjectSha256)
const git = (cwd, args, input) => execFileSync('git', args, { cwd, input, encoding: 'utf8' }).trim()
assert.equal(git(root, ['rev-parse', meta.base]), meta.base)
assert.equal(git(root, ['hash-object', '-t', 'commit', '--stdin'], commit), meta.commit)
git(root, ['worktree', 'add', '--detach', destination, meta.base])
git(destination, ['apply', '--index', '--unidiff-zero', '--whitespace=error-all', '-'], patch)
assert.equal(git(destination, ['write-tree']), meta.tree, 'Reconstructed source tree differs')
assert.equal(git(destination, ['hash-object', '-t', 'commit', '-w', '--stdin'], commit), meta.commit)
// The newly created index and worktree already equal this exact tree. Align
// only the new detached HEAD; no source files or existing branches are reset.
git(destination, ['reset', '--soft', meta.commit])
assert.equal(git(destination, ['status', '--porcelain', '--untracked-files=no']), '')
assert.equal(git(destination, ['rev-parse', 'HEAD']), meta.commit)
console.log(JSON.stringify({ status: meta.status, destination, commit: meta.commit, tree: meta.tree }))
