import { openSync, readSync, closeSync } from 'node:fs'
import { gunzipSync, zstdDecompressSync } from 'node:zlib'

export interface BlendHeader {
  /** e.g. [5, 2] parsed from the saved-file version bytes. */
  version: [number, number] | null
  compression: 'none' | 'zstd' | 'gzip' | 'unknown'
}

/**
 * Read the .blend header's saved-version bytes ("BLENDER…502" = 5.2).
 *
 * A file saved by a NEWER Blender than the discovered binary opens with
 * "expect loss of data" — a bug class we hit ourselves — so the invoker
 * refuses that combination unless forced. Compressed files (zstd since 3.0,
 * gzip before) are decompressed just enough to read the magic.
 */
export function readBlendHeader(path: string): BlendHeader {
  const fd = openSync(path, 'r')
  const buffer = Buffer.alloc(64)
  let head: Buffer
  try {
    const bytes = readSync(fd, buffer, 0, buffer.length, 0)
    head = buffer.subarray(0, bytes)
  } finally {
    closeSync(fd)
  }

  let compression: BlendHeader['compression'] = 'none'
  let plain: Buffer = head
  if (head[0] === 0x28 && head[1] === 0xb5 && head[2] === 0x2f && head[3] === 0xfd) {
    compression = 'zstd'
    plain = tryDecompress(path, 'zstd')
  } else if (head[0] === 0x1f && head[1] === 0x8b) {
    compression = 'gzip'
    plain = tryDecompress(path, 'gzip')
  }

  if (plain.subarray(0, 7).toString('latin1') !== 'BLENDER') {
    return { version: null, compression: plain === head ? 'unknown' : compression }
  }
  const header = plain.subarray(0, 24).toString('latin1')
  // Classic header (through 4.x): "BLENDER" + pointer char + endian char +
  // 3 version digits ("BLENDER-v405" = 4.5). Large header (5.0+):
  // "BLENDER" + 2-digit header size + "-" + 2-digit format version +
  // endian char + 4 version digits ("BLENDER17-01v0502" = 5.2). The guard
  // this feeds was silently dead for every 5.x file until the new shape
  // was parsed — version: null must stay a loud, tested edge.
  const match = /^BLENDER(?:[-_][vV](\d{3})|\d{2}-\d{2}[vV](\d{4}))/.exec(header)
  if (!match) return { version: null, compression }
  const packed = Number(match[1] ?? match[2])
  return { version: [Math.floor(packed / 100), packed % 100], compression }
}

function tryDecompress(path: string, kind: 'zstd' | 'gzip'): Buffer {
  // Only the first few KB are needed; both formats tolerate truncated input
  // poorly, so read a generous chunk and decompress defensively.
  const fd = openSync(path, 'r')
  const chunk = Buffer.alloc(1 << 16)
  try {
    const bytes = readSync(fd, chunk, 0, chunk.length, 0)
    const input = chunk.subarray(0, bytes)
    return kind === 'zstd' ? zstdDecompressSync(input) : gunzipSync(input)
  } catch {
    return Buffer.alloc(0)
  } finally {
    closeSync(fd)
  }
}
