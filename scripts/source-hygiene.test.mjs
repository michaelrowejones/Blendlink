import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { openSync, readSync, closeSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, it } from 'node:test'

const root = resolve(import.meta.dirname, '..')

/**
 * A UTF-8 BOM in a tracked source file is invisible in every editor and
 * breaks tools that read bytes rather than decoded text: JSON.parse
 * rejects it outright, and Python's ast.parse rejects it on an
 * already-decoded string. It is introduced almost exclusively by Windows
 * PowerShell, whose `Set-Content -Encoding utf8` and `Out-File` write one
 * by default — so on this project it arrives through routine scripted
 * file surgery and then rides into a commit unnoticed.
 */
const TEXT_PATTERNS = ['*.py', '*.ts', '*.tsx', '*.mjs', '*.js', '*.json', '*.md', '*.toml']

function trackedTextFiles() {
  return execFileSync('git', ['ls-files', '-z', ...TEXT_PATTERNS], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
    .split('\0')
    .filter(Boolean)
}

function startsWithBom(path) {
  const handle = openSync(join(root, path), 'r')
  try {
    const head = Buffer.alloc(3)
    readSync(handle, head, 0, 3, 0)
    return head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf
  } finally {
    closeSync(handle)
  }
}

describe('tracked source hygiene', () => {
  it('finds tracked text files to check', () => {
    assert.ok(trackedTextFiles().length > 100)
  })

  it('has no UTF-8 BOM in any tracked text file', () => {
    const offenders = trackedTextFiles().filter(startsWithBom)
    assert.deepEqual(
      offenders,
      [],
      'These tracked files begin with a UTF-8 BOM: ' + offenders.join(', ') +
        '. On Windows, write files with Python/Node or PowerShell\'s ' +
        '-Encoding utf8NoBOM; Set-Content -Encoding utf8 emits a BOM in ' +
        'Windows PowerShell 5.1.',
    )
  })
})
