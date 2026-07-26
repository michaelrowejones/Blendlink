import { createHash } from 'node:crypto'
import { inflateSync } from 'node:zlib'
import { Accessor, type Document, type Node, type Primitive, type TextureInfo } from '@gltf-transform/core'
import type { BakePlan } from './invoke.js'

type AtlasLayout = NonNullable<BakePlan['atlasLayout']>
type AtlasRecord = AtlasLayout['objects'][number]

function hash16(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex').slice(0, 16)
}

function decodeRecord(record: AtlasRecord): Array<[number, number]> {
  const raw = inflateSync(Buffer.from(record.data, 'base64'))
  if (raw.byteLength !== record.loopCount * 8) {
    throw new Error(`UV payload has ${raw.byteLength} bytes; expected ${record.loopCount * 8}`)
  }
  if (hash16(raw) !== record.uvHash) throw new Error('UV payload hash does not match')
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength)
  return Array.from({ length: record.loopCount }, (_, index) => [
    view.getFloat32(index * 8, true),
    view.getFloat32(index * 8 + 4, true),
  ])
}

function findNode(document: Document, record: AtlasRecord): Node {
  const nodes = document.getRoot().listNodes()
  const matches = record.id
    ? nodes.filter((node) => node.getExtras()?.blendlink_id === record.id)
    : nodes.filter((node) => node.getName() === record.name)
  if (matches.length !== 1) {
    throw new Error(
      `${record.id ? `stable ID ${JSON.stringify(record.id)}` : `name ${JSON.stringify(record.name)}`} ` +
      `matched ${matches.length} final GLB nodes`,
    )
  }
  if (!matches[0]!.getMesh()) throw new Error('final GLB node has no mesh')
  return matches[0]!
}

function textureInfoFor(primitive: Primitive): TextureInfo {
  const material = primitive.getMaterial()
  const info = material?.getBaseColorTextureInfo() ?? material?.getEmissiveTextureInfo()
  if (!info) throw new Error('baked primitive has no color texture coordinate binding')
  return info
}

function finalUvs(node: Node): Array<[number, number]> {
  const values: Array<[number, number]> = []
  for (const primitive of node.getMesh()!.listPrimitives()) {
    const semantic = `TEXCOORD_${textureInfoFor(primitive).getTexCoord()}`
    const accessor = primitive.getAttribute(semantic)
    if (!accessor || accessor.getElementSize() !== 2) {
      throw new Error(`baked primitive is missing ${semantic}`)
    }
    if (accessor.getComponentType() !== Accessor.ComponentType.FLOAT || accessor.getNormalized()) {
      throw new Error(
        `${semantic} is quantized in the final GLB; Blendlink requires lossless Float32 atlas UVs`,
      )
    }
    const value = [0, 0]
    for (let index = 0; index < accessor.getCount(); index += 1) {
      accessor.getElement(index, value)
      values.push([value[0]!, value[1]!])
    }
  }
  if (values.length === 0) throw new Error('final GLB mesh has no atlas UV values')
  return values
}

function uvKey(value: [number, number]): string {
  // Normalize signed zero (texture sampling does not distinguish it), while
  // retaining every other Float32 bit exactly.
  if (!Number.isFinite(value[0]) || !Number.isFinite(value[1])) {
    throw new Error('atlas UV contains a non-finite value')
  }
  const u = Math.fround(value[0]) === 0 ? 0 : Math.fround(value[0])
  const v = Math.fround(value[1]) === 0 ? 0 : Math.fround(value[1])
  return `${u},${v}`
}

function verifyFinalUvs(
  source: Array<[number, number]>,
  published: Array<[number, number]>,
): void {
  // Blender's glTF exporter converts its bottom-left UV convention to glTF's
  // top-left convention by storing (u, 1-v). Reproduce that Float32 write
  // exactly before comparing the decoded accessor. The retained payload stays
  // in Blender space so the addon can apply it directly to an editable layer.
  const sourceSet = new Set(source.map(([u, v]) => uvKey([
    Math.fround(u),
    Math.fround(1 - v),
  ])))
  const publishedSet = new Set(published.map(uvKey))
  const missingFromFinal = [...sourceSet].filter((value) => !publishedSet.has(value))
  const missingFromSource = [...publishedSet].filter((value) => !sourceSet.has(value))
  if (missingFromFinal.length || missingFromSource.length) {
    throw new Error(
      `final Float32 atlas UV set differs from the Blender pack after glTF V-axis conversion ` +
      `(${missingFromFinal.length} source value(s) absent, ` +
      `${missingFromSource.length} final value(s) unrecognized)`,
    )
  }
}

/** Prove every distinct Blender-pack Float32 UV pair survives in the decoded
 * final GLB after Blender's deterministic V-axis conversion. The payload stays
 * in Blender loop order and its topology hash gates application in the addon;
 * this verifier deliberately does not invent a correspondence between Blender
 * loops and the exporter's split/reordered glTF vertices. Records that cannot
 * be attested remain explicit `unavailable` diagnostics. */
export function finalizeAtlasLayoutEvidence(
  document: Document,
  evidence: AtlasLayout,
): AtlasLayout {
  const objects: AtlasRecord[] = []
  const unavailable = [...(evidence.unavailable ?? [])]
  for (const record of evidence.objects) {
    try {
      const source = decodeRecord(record)
      const published = finalUvs(findNode(document, record))
      verifyFinalUvs(source, published)
      objects.push(record)
    } catch (error) {
      unavailable.push({
        name: record.name,
        ...(record.id ? { id: record.id } : {}),
        reason: error instanceof Error ? error.message : String(error),
      })
    }
  }
  return {
    ...evidence,
    space: 'final-glb-decoded',
    objects,
    ...(unavailable.length ? { unavailable } : {}),
  }
}
