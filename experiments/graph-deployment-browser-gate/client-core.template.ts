import {
  compiledSceneAssetUrls,
  createCompiledAssetUrlModifier,
  resolveCompiledAssetUrl,
} from 'blendlink/assets'
import { LoadingManager, Mesh, Texture } from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

const GRAPH = __BLENDLINK_GRAPH_JSON__ as const
const PUBLICATION = __BLENDLINK_PUBLICATION_JSON__ as const
const SCENE_URL = __BLENDLINK_SCENE_URL_JSON__ as string
const FINGERPRINT = GRAPH.fingerprint
const sceneEntry = GRAPH.entries.find((entry) => entry.role === 'scene')
if (!sceneEntry || sceneEntry.path !== PUBLICATION.scenePath) {
  throw new Error('Packed publication record does not identify the graph scene.')
}
if (!SCENE_URL.endsWith(`/${PUBLICATION.scenePath}`)) {
  throw new Error('Packed publication URL does not end with its graph scene path.')
}
const PUBLIC_ROOT = SCENE_URL.slice(0, -PUBLICATION.scenePath.length)

const descriptor = Object.freeze({
  schemaVersion: 3,
  name: 'GraphDeploymentBrowserGate',
  url: `${SCENE_URL}?v=scene`,
  nodes: Object.freeze({ Triangle: 'Triangle' }),
  runtimeAssetGraph: GRAPH,
})

type GateOptions = Readonly<{
  assetBaseUrl: string
  host: 'vite' | 'next'
  transport: 'same-origin' | 'cdn'
}>

type ResponseFact = Readonly<{
  cacheControl: string | null
  contentType: string | null
  status: number
  url: string
}>

declare global {
  interface Window {
    __BLENDLINK_GRAPH_GATE__?: unknown
  }
}

async function fetchFact(url: string): Promise<ResponseFact> {
  const response = await fetch(url, {
    credentials: 'omit',
    mode: 'cors',
  })
  if (!response.ok) {
    throw new Error(`Graph deployment fixture request failed (${response.status}): ${url}`)
  }
  await response.arrayBuffer()
  return Object.freeze({
    cacheControl: response.headers.get('cache-control'),
    contentType: response.headers.get('content-type'),
    status: response.status,
    url: response.url,
  })
}

export async function runGraphDeploymentGate(options: GateOptions): Promise<void> {
  const resolvedByManager: Array<Readonly<{ input: string; output: string }>> = []
  const modifier = createCompiledAssetUrlModifier(
    descriptor,
    options.assetBaseUrl,
    [`${PUBLIC_ROOT}blendlink-basis/`],
  )
  const manager = new LoadingManager()
  manager.setURLModifier((url) => {
    const output = modifier(url)
    resolvedByManager.push(Object.freeze({ input: url, output }))
    return output
  })

  const loaded = await new GLTFLoader(manager).loadAsync(descriptor.url)
  const triangle = loaded.scene.getObjectByName('ExternalTexturePlane')
  if (!triangle) {
    throw new Error('GLTFLoader parsed the graph scene but did not find Triangle.')
  }
  let decodedTexture: unknown = null
  loaded.scene.traverse((object) => {
    if (decodedTexture || !(object instanceof Mesh)) return
    const materials = Array.isArray(object.material) ? object.material : [object.material]
    decodedTexture = materials.find((candidate) => (
      'map' in candidate && candidate.map instanceof Texture
    ))?.map ?? null
  })
  if (!decodedTexture) {
    throw new Error('GLTFLoader did not decode the external PNG texture.')
  }

  const declaredUrls = compiledSceneAssetUrls(descriptor)
  const basisUrls = GRAPH.entries
    .filter((entry) => entry.role === 'basis-runtime')
    .map((entry) => `${PUBLIC_ROOT}${entry.path}`)
  const basisResponses = await Promise.all(
    basisUrls.map((url) => fetchFact(modifier(url))),
  )

  const mutableResponses = await Promise.all([
    '/models/hero/current.json',
    '/models/hero/stable.txt',
    `/models/hero/${FINGERPRINT.slice(0, 63)}/lookalike.txt`,
    `/models/hero/${FINGERPRINT.slice(0, 63)}g/lookalike.txt`,
  ].map((url) => fetchFact(resolveCompiledAssetUrl(url, options.assetBaseUrl))))

  const evidence = Object.freeze({
    assetBaseUrl: options.assetBaseUrl,
    basisResponses,
    declaredUrls,
    fingerprint: FINGERPRINT,
    host: options.host,
    mutableResponses,
    runtimeAssetPublication: PUBLICATION,
    resolvedByManager,
    sceneUrl: SCENE_URL,
    sceneChildren: loaded.scene.children.length,
    textureDecoded: true,
    transport: options.transport,
  })
  window.__BLENDLINK_GRAPH_GATE__ = evidence
  document.documentElement.dataset.state = 'ready'
  document.body.innerHTML = `
    <main>
      <p class="eyebrow">Blendlink deployment evidence</p>
      <h1>${options.host.toUpperCase()} · ${options.transport}</h1>
      <p class="status">Complete graph loaded</p>
      <dl>
        <div><dt>Graph</dt><dd>${FINGERPRINT}</dd></div>
        <div><dt>Scene</dt><dd>${loaded.scene.children.length} parsed child</dd></div>
        <div><dt>External image</dt><dd>decoded</dd></div>
        <div><dt>Basis closure</dt><dd>${basisResponses.length} files fetched</dd></div>
      </dl>
    </main>
  `
}

export function failGraphDeploymentGate(error: unknown): void {
  const message = error instanceof Error ? error.stack ?? error.message : String(error)
  window.__BLENDLINK_GRAPH_GATE__ = Object.freeze({ error: message })
  document.documentElement.dataset.state = 'failed'
  document.body.innerHTML = `<pre>${message.replace(/[&<>]/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
  })[character]!)}</pre>`
}
