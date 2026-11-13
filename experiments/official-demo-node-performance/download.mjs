// Demo assets have a separate boundary from Blender executable acquisition.
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'

export async function downloadPinnedDemo(scene, {fetchImpl = fetch} = {}) {
  const url = new URL(scene.url)
  assert.equal(url.origin, 'https://download.blender.org')
  assert.ok(url.pathname.startsWith('/demo/') && /\.(blend|zip)$/.test(url.pathname))
  assert.ok(!url.username && !url.password && !url.search && !url.hash)
  assert.ok(Number.isSafeInteger(scene.bytes) && scene.bytes > 0 && scene.bytes <= 64 * 1024 * 1024)
  assert.match(scene.sha256, /^[a-f0-9]{64}$/)
  const response = await fetchImpl(url.href, {redirect: 'error', signal: AbortSignal.timeout(120_000)})
  assert.equal(response.status, 200, 'Official demo download failed')
  if (response.headers.has('content-length')) assert.equal(Number(response.headers.get('content-length')), scene.bytes, 'Official demo byte length changed')
  assert.ok(response.body, 'Official demo response has no body')
  const chunks = [], reader = response.body.getReader(); let length = 0
  try {
    for (;;) {
      const {value, done} = await reader.read()
      if (done) break
      length += value.byteLength
      assert.ok(length <= scene.bytes, 'Official demo exceeds its pinned byte length')
      chunks.push(Buffer.from(value))
    }
  } finally { await reader.cancel().catch(() => {}) }
  const bytes = Buffer.concat(chunks)
  assert.equal(bytes.length, scene.bytes, 'Official demo is truncated')
  assert.equal(createHash('sha256').update(bytes).digest('hex'), scene.sha256, 'Official demo content changed')
  return bytes
}
