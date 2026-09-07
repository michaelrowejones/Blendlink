/** Portable OCIO program. LUT samples retain their original float32 values. */
export interface SourceDisplayProgram {
  version: 1
  view: string
  look: string
  inputColorSpace: string
  outputDisplay: string
  ops: readonly SourceDisplayOperation[]
}

export interface SourceDisplayOperation {
  type: string
  direction: string
  [key: string]: unknown
}

export interface SourcePresentation {
  schemaVersion: 1
  model: 'blendlink-source-presentation-v1'
  display?: SourceDisplayProgram
  compositor?: SourceCompositorProgram
  warnings: readonly string[]
}

export interface CompositorValue {
  kind: 'constant' | 'ref' | 'convert'
  type: string
  value?: unknown
  node?: string
  fromType?: string
  input?: CompositorValue
}

export interface SourceCompositorOperation {
  id: string
  kind: string
  type: string
  value?: unknown
  source: { path: string[]; node: string; nodeType: string; output: string }
  properties: Record<string, unknown>
  inputs: Record<string, { name: string; socketType: string; value: CompositorValue }>
  pass?: {
    scene: string
    viewLayer: string
    pass: string
    name: string
    type: string
    aov?: unknown
  }
}

export interface SourceCompositorProgram {
  luminance?: [number, number, number]
  version: 1
  status: 'extracted' | 'unsupported' | 'disabled'
  ops: SourceCompositorOperation[]
  output?: CompositorValue
  passes: NonNullable<SourceCompositorOperation['pass']>[]
  diagnostics: { path: string[]; node: string; socket: string; message: string }[]
}

export interface SourcePresentationAsset {
  url: string
  bytes: number
  hash: string
}

/** Fetch bytes before parsing so stale publications cannot install a different look. */
export async function loadSourcePresentation(
  asset: SourcePresentationAsset,
  signal?: AbortSignal,
): Promise<SourcePresentation> {
  signal?.throwIfAborted()
  const response = signal ? await fetch(asset.url, { signal }) : await fetch(asset.url)
  if (!response.ok)
    throw new Error(`Source presentation fetch failed (${response.status}): ${asset.url}`)
  const bytes = await response.arrayBuffer()
  if (bytes.byteLength !== asset.bytes)
    throw new Error('Source presentation byte count differs from the compiled descriptor.')
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  signal?.throwIfAborted()
  const hash = [...new Uint8Array(digest)]
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16)
  if (hash !== asset.hash)
    throw new Error('Source presentation hash differs from the compiled descriptor.')
  const result = JSON.parse(new TextDecoder().decode(bytes)) as SourcePresentation
  if (result.schemaVersion !== 1 || result.model !== 'blendlink-source-presentation-v1') {
    throw new Error('Unsupported source presentation version.')
  }
  return result
}
