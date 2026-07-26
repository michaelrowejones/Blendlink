import { createHash } from 'node:crypto'
import { Document, NodeIO, Primitive } from '@gltf-transform/core'
import { describe, expect, it } from 'vitest'
import { auditCompiledSceneArtifact } from './compiledSceneAudit.js'
import type { SceneManifest } from './typegen.js'

interface TestMaterialDiagnostic {
  material: string
  status: 'exact' | 'approximated' | 'needsBake'
  reasons: string[]
  cyclesAppearance?: {
    status: 'compatible' | 'blocked'
    blockers: string[]
  }
}

async function write(document: Document): Promise<Uint8Array> {
  return new NodeIO().writeBinary(document)
}

function mutateGlbJson(
  bytes: Uint8Array,
  mutate: (json: Record<string, unknown>) => void,
): Uint8Array {
  const source = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const jsonLength = source.getUint32(12, true)
  const jsonStart = 20
  const jsonEnd = jsonStart + jsonLength
  const json = JSON.parse(
    new TextDecoder().decode(bytes.subarray(jsonStart, jsonEnd)).trim(),
  ) as Record<string, unknown>
  mutate(json)
  const encoded = new TextEncoder().encode(JSON.stringify(json))
  const paddedLength = Math.ceil(encoded.byteLength / 4) * 4
  const suffix = bytes.subarray(jsonEnd)
  const result = new Uint8Array(20 + paddedLength + suffix.byteLength)
  const view = new DataView(result.buffer)
  view.setUint32(0, 0x46546c67, true)
  view.setUint32(4, 2, true)
  view.setUint32(8, result.byteLength, true)
  view.setUint32(12, paddedLength, true)
  view.setUint32(16, 0x4e4f534a, true)
  result.set(encoded, 20)
  result.fill(0x20, 20 + encoded.byteLength, 20 + paddedLength)
  result.set(suffix, 20 + paddedLength)
  return result
}

function manifest(
  bytes: Uint8Array,
  materials?: readonly TestMaterialDiagnostic[],
): SceneManifest {
  return {
    generator: 'blendlink',
    schemaVersion: 3,
    hash: createHash('sha256').update(bytes).digest('hex').slice(0, 16),
    url: '/models/test.glb',
    stats: {
      bytes: bytes.byteLength,
      triangles: 0,
      meshes: 0,
      texturesBytes: 0,
    },
    ...(materials
      ? { sceneDiagnostics: { materials: { records: materials } } }
      : {}),
  } as unknown as SceneManifest
}

function position(
  document: Document,
  buffer: ReturnType<Document['createBuffer']>,
  name: string,
  triangles: number,
) {
  const values = new Float32Array(triangles * 9)
  for (let triangle = 0; triangle < triangles; triangle += 1) {
    const offset = triangle * 9
    values.set([
      triangle, 0, 0,
      triangle + 0.5, 0, 0,
      triangle, 0.5, 0,
    ], offset)
  }
  return document.createAccessor(name).setType('VEC3').setArray(values).setBuffer(buffer)
}

describe('compiled scene artifact audit', () => {
  it('refuses a renderable final GLB with an unsupported required extension', async () => {
    const document = new Document()
    const buffer = document.createBuffer()
    const mesh = document.createMesh('Visible').addPrimitive(
      document.createPrimitive().setAttribute(
        'POSITION',
        position(document, buffer, 'Position', 1),
      ),
    )
    document.createScene('Scene').addChild(document.createNode('Node').setMesh(mesh))
    const bytes = mutateGlbJson(await write(document), (json) => {
      json.extensionsUsed = ['KHR_node_visibility']
      json.extensionsRequired = ['KHR_node_visibility']
    })

    await expect(auditCompiledSceneArtifact({
      manifest: manifest(bytes),
      glbBytes: bytes,
    })).rejects.toThrow(
      /runtime\.required-extension-unsupported.*KHR_node_visibility.*compatible runtime/s,
    )
  })

  it('refuses byte-count and SHA-256 identity mismatches', async () => {
    const document = new Document()
    document.createScene('Scene')
    const bytes = await write(document)
    const correct = manifest(bytes)

    await expect(auditCompiledSceneArtifact({
      manifest: {
        ...correct,
        stats: { ...correct.stats, bytes: bytes.byteLength + 1 },
      },
      glbBytes: bytes,
    })).rejects.toThrow(/byte count does not match/)

    await expect(auditCompiledSceneArtifact({
      manifest: { ...correct, hash: '0000000000000000' },
      glbBytes: bytes,
    })).rejects.toThrow(/SHA-256 does not match/)
  })

  it('refuses an empty final artifact with an artist-readable plan-only escape hatch', async () => {
    const document = new Document()
    document.createScene('World and camera helpers only')
    const bytes = await write(document)

    await expect(auditCompiledSceneArtifact({
      manifest: manifest(bytes),
      glbBytes: bytes,
    })).rejects.toThrow(
      /no renderable mesh primitives.*Cameras, lights, Worlds.*non-empty evaluated geometry.*`blendlink plan`/s,
    )
  })

  it('refuses mesh definitions that are not rendered by the default scene', async () => {
    const document = new Document()
    const buffer = document.createBuffer()
    const mesh = document.createMesh('Unpublished library mesh').addPrimitive(
      document.createPrimitive().setAttribute(
        'POSITION',
        position(document, buffer, 'LibraryPosition', 1),
      ),
    )
    document.createScene('Default website scene')
    document.createScene('Unselected asset library')
      .addChild(document.createNode('Library Node').setMesh(mesh))
    const bytes = await write(document)

    await expect(auditCompiledSceneArtifact({
      manifest: manifest(bytes),
      glbBytes: bytes,
    })).rejects.toThrow(/no renderable mesh primitives in its default scene/)
  })

  it('accepts visible point primitives without misusing triangle count as the gate', async () => {
    const document = new Document()
    const buffer = document.createBuffer()
    const points = document.createMesh('Point cloud').addPrimitive(
      document.createPrimitive()
        .setMode(Primitive.Mode.POINTS!)
        .setAttribute('POSITION', position(document, buffer, 'PointPosition', 1)),
    )
    document.createScene('Scene').addChild(document.createNode('Points').setMesh(points))
    const bytes = await write(document)

    const audit = await auditCompiledSceneArtifact({ manifest: manifest(bytes), glbBytes: bytes })

    expect(audit.counts).toMatchObject({
      renderedPrimitiveInstances: 1,
      renderedTriangles: 0,
    })
  })

  it('counts a shared accessor once in the decoded scene total', async () => {
    const document = new Document()
    const buffer = document.createBuffer()
    const shared = position(document, buffer, 'SharedPosition', 1)
    const mesh = document.createMesh('SharedMesh')
      .addPrimitive(document.createPrimitive('First').setAttribute('POSITION', shared))
      .addPrimitive(document.createPrimitive('Second').setAttribute('POSITION', shared))
    document.createScene('Scene').addChild(document.createNode('Node').setMesh(mesh))
    const bytes = await write(document)

    const audit = await auditCompiledSceneArtifact({ manifest: manifest(bytes), glbBytes: bytes })

    expect(audit.counts.decodedAccessors).toBe(1)
    expect(audit.counts.decodedAccessorBytes).toBe(shared.getArray()!.byteLength)
    expect(audit.counts.decodedGeometryAccessors).toBe(1)
    expect(audit.counts.decodedGeometryAccessorBytes).toBe(shared.getArray()!.byteLength)
    expect(audit.meshContributors[0]).toMatchObject({
      name: 'SharedMesh',
      nodes: ['Node'],
      triangles: 2,
      referencedDecodedAccessorBytes: shared.getArray()!.byteLength,
    })
  })

  it('orders the largest decoded mesh contributor first', async () => {
    const document = new Document()
    const buffer = document.createBuffer()
    const small = document.createMesh('Small')
      .addPrimitive(document.createPrimitive().setAttribute(
        'POSITION',
        position(document, buffer, 'SmallPosition', 1),
      ))
    const dominant = document.createMesh('Dominant')
      .addPrimitive(document.createPrimitive().setAttribute(
        'POSITION',
        position(document, buffer, 'DominantPosition', 4),
      ))
    document.createScene('Scene')
      .addChild(document.createNode('SmallNode').setMesh(small))
      .addChild(document.createNode('DominantNode').setMesh(dominant))
    const bytes = await write(document)

    const audit = await auditCompiledSceneArtifact({ manifest: manifest(bytes), glbBytes: bytes })

    expect(audit.meshContributors.map((entry) => entry.name)).toEqual(['Dominant', 'Small'])
    expect(audit.meshContributors[0]).toMatchObject({ triangles: 4, renderedTriangles: 4 })
    expect(audit.meshContributors[0]!.referencedDecodedAccessorBytes)
      .toBeGreaterThan(audit.meshContributors[1]!.referencedDecodedAccessorBytes)
  })

  it('does not classify a Needs Bake material with meaningful exported PBR payload as collapsed', async () => {
    const document = new Document()
    const buffer = document.createBuffer()
    const material = document.createMaterial('Procedural').setBaseColorFactor([0.2, 0.3, 0.4, 1])
    const mesh = document.createMesh('Mesh').addPrimitive(
      document.createPrimitive()
        .setAttribute('POSITION', position(document, buffer, 'Position', 1))
        .setMaterial(material),
    )
    document.createScene('Scene').addChild(document.createNode('Node').setMesh(mesh))
    const bytes = await write(document)
    const audit = await auditCompiledSceneArtifact({
      manifest: manifest(bytes, [{
        material: 'Procedural',
        status: 'needsBake',
        reasons: ['Uses a shader graph that glTF cannot reproduce.'],
      }]),
      glbBytes: bytes,
    })

    expect(audit.materialBindings[0]?.payload).toMatchObject({
      pbr: 'meaningful',
      meaningful: true,
    })
    expect(audit.materialPayloadCollapse.detected).toBe(false)
    expect(audit.materialPortability).toMatchObject({
      diagnosticsPresent: true,
      usedMaterials: 1,
      diagnosedUsedMaterials: 1,
      needsBakeUsedMaterials: 1,
      needsBakeRenderedTriangles: 1,
      needsBakeMeaningfulPayloadTriangles: 1,
      cyclesAppearanceBlockedUsedMaterials: 0,
    })
    expect(audit.materialPayloadCollapse.checks).toMatchObject({
      everyUsedMaterialNeedsBake: true,
      allRenderedTrianglesAffected: true,
      usedMaterialsLackMeaningfulPayload: false,
    })
  })

  it('detects all-default payload collapse only when every rendered triangle needs a bake', async () => {
    const document = new Document()
    const buffer = document.createBuffer()
    const material = document.createMaterial('UnsupportedDefault')
    const mesh = document.createMesh('CollapsedMesh').addPrimitive(
      document.createPrimitive()
        .setAttribute('POSITION', position(document, buffer, 'Position', 3))
        .setMaterial(material),
    )
    document.createScene('Scene').addChild(document.createNode('Node').setMesh(mesh))
    const bytes = await write(document)
    const reason = 'Mix Shader is not portable to glTF.'
    const audit = await auditCompiledSceneArtifact({
      manifest: manifest(bytes, [{
        material: 'UnsupportedDefault',
        status: 'needsBake',
        reasons: [reason],
        cyclesAppearance: {
          status: 'blocked',
          blockers: ['Shader to RGB is EEVEE-only.'],
        },
      }]),
      glbBytes: bytes,
    })

    expect(audit.materialBindings[0]?.payload).toMatchObject({
      // NodeIO writes explicit PBR defaults; raw JSON parsing preserves that
      // distinction without treating default values as meaningful payload.
      pbr: 'defaults-only',
      emissive: 'omitted',
      meaningful: false,
    })
    expect(audit.materialPayloadCollapse).toMatchObject({
      detected: true,
      affectedTriangles: 3,
      totalRenderedTriangles: 3,
      dominantAffectedTriangles: 3,
      checks: {
        materialDiagnosticsPresent: true,
        everyUsedMaterialNeedsBake: true,
        allRenderedTrianglesAffected: true,
        usedMaterialsLackMeaningfulPayload: true,
      },
    })
    expect(audit.materialPayloadCollapse.families).toEqual([{
      reasons: [reason],
      materials: ['UnsupportedDefault'],
      affectedTriangles: 3,
    }])
    expect(audit.materialPortability).toMatchObject({
      totalRenderedTriangles: 3,
      usedMaterials: 1,
      diagnosedUsedMaterials: 1,
      needsBakeUsedMaterials: 1,
      needsBakeRenderedTriangles: 3,
      needsBakeMeaningfulPayloadTriangles: 0,
      cyclesAppearanceBlockedUsedMaterials: 1,
    })
  })
})
