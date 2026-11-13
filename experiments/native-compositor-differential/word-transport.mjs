// Exact integer JSON words; this transports data, never qualifies a node.
export const MAX_ORACLE_WORDS = 1048576

export function decodeFloat32Words(packet, expectedLength) {
  if (!packet || typeof packet !== 'object' || Array.isArray(packet)
    || packet.model !== 'float32-word-array-v1'
    || !Number.isSafeInteger(expectedLength) || expectedLength < 1 || expectedLength > MAX_ORACLE_WORDS
    || packet.length !== expectedLength || !Array.isArray(packet.words)
    || packet.words.length !== expectedLength) throw new Error('Invalid bounded oracle word packet')
  const words = new Uint32Array(expectedLength)
  for (let index = 0; index < expectedLength; index++) {
    const word = packet.words[index]
    if (!Object.hasOwn(packet.words, index) || !Number.isInteger(word) || word < 0 || word > 0xffffffff)
      throw new Error('Invalid oracle uint32 word at ' + index)
    words[index] = word
  }
  return new Float32Array(words.buffer)
}
