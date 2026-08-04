import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { openSync, readSync, closeSync, readFileSync } from 'node:fs'
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

/**
 * The same class of damage as the BOM, from the same source: text that was
 * already UTF-8 read back as cp1252 and re-encoded, so one em dash becomes
 * three characters (U+00E2 U+20AC U+201D). This comment deliberately spells
 * that out in code points rather than showing it, because showing it would
 * make this file fail its own check. It is not cosmetic: 33 of these reached
 * shipped artist-facing refusal strings before the check existed, including
 * atlas density warnings. Detection is exact rather than
 * pattern-matched: a run is mojibake only when re-encoding it through cp1252
 * yields bytes that decode as valid non-ASCII UTF-8, which ordinary prose
 * cannot do by accident.
 */
const CP1252_HIGH = new Map(Object.entries({
  '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84,
  '…': 0x85, '†': 0x86, '‡': 0x87, 'ˆ': 0x88,
  '‰': 0x89, 'Š': 0x8a, '‹': 0x8b, 'Œ': 0x8c,
  'Ž': 0x8e, '‘': 0x91, '’': 0x92, '“': 0x93,
  '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97,
  '˜': 0x98, '™': 0x99, 'š': 0x9a, '›': 0x9b,
  'œ': 0x9c, 'ž': 0x9e, 'Ÿ': 0x9f,
}))

function cp1252Byte(char) {
  const code = char.codePointAt(0)
  if (code <= 0xff && !(code >= 0x80 && code <= 0x9f)) return code
  return CP1252_HIGH.get(char)
}

function mojibakeRuns(text) {
  const found = []
  for (let index = 0; index < text.length; index += 1) {
    // A double-encoded run always begins with the cp1252 reading of a UTF-8
    // lead byte, and every lead byte is 0xC2..0xF4; anchoring on that range
    // keeps the scan cheap on large files. The round-trip below is what
    // actually decides, so a wide anchor costs nothing but time.
    const lead = text.codePointAt(index)
    if (lead < 0xc2 || lead > 0xf4) continue
    for (let length = 4; length >= 2; length -= 1) {
      const run = text.slice(index, index + length)
      if (run.length < length) continue
      const bytes = []
      let encodable = true
      for (const char of run) {
        const byte = cp1252Byte(char)
        if (byte === undefined) { encodable = false; break }
        bytes.push(byte)
      }
      if (!encodable) continue
      const decoded = Buffer.from(bytes).toString('utf8')
      if (decoded.includes('�')) continue
      if (Buffer.from(decoded, 'utf8').length !== bytes.length) continue
      if ([...decoded].some((char) => char.codePointAt(0) < 0xa0)) continue
      found.push({ run, decoded })
      index += length - 1
      break
    }
  }
  return found
}

describe('tracked source hygiene', () => {
  it('finds tracked text files to check', () => {
    assert.ok(trackedTextFiles().length > 100)
  })

  it('has no double-encoded UTF-8 in any tracked text file', () => {
    const offenders = []
    for (const path of trackedTextFiles()) {
      const runs = mojibakeRuns(readFileSync(join(root, path), 'utf8'))
      if (runs.length) {
        offenders.push(
          `${path} (${runs.length}: ` +
            runs.slice(0, 3).map((run) => `${run.run} should be ${run.decoded}`)
              .join(', ') + ')',
        )
      }
    }
    assert.deepEqual(
      offenders,
      [],
      'These tracked files contain UTF-8 text that was decoded as cp1252 and ' +
        're-encoded: ' + offenders.join('; ') +
        '. On Windows this comes from PowerShell Get-Content/Set-Content ' +
        'round-trips; edit the file with the Edit tool or Python/Node instead.',
    )
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
