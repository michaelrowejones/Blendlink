import { createHash } from 'node:crypto'
import { Accessor, Document } from '@gltf-transform/core'
import { EXTMeshGPUInstancing, KHRMaterialsUnlit } from '@gltf-transform/extensions'
import { quantize, reorder, weld } from '@gltf-transform/functions'
import { MeshoptEncoder } from 'meshoptimizer'
import { describe, expect, it } from 'vitest'
import {
  compileAuthoredOrthographicAspectEvidence,
  compileSceneDiagnostics,
  type BlenderSceneDiagnostics,
  type MaterialCompilationEvidence,
} from './sceneDiagnostics.js'
import {
  RUNTIME_SCENE_DIAGNOSTICS_SCHEMA_VERSION,
  compileRuntimeSceneDiagnostics,
  resolveRuntimeSceneDiagnostics,
} from './runtimeDiagnostics.js'
import type { PresentationCameraRecipe } from './sceneRecipe.js'
import type { Vocabulary } from './vocabulary.js'

function vocabulary(levels: Vocabulary['lods'][number]['levels']): Vocabulary {
  return {
    colliders: [], sockets: [], hotspots: [], audio: [], physics: [], warnings: [],
    lods: [{ base: 'Rock', levels }],
  }
}

function documentWithLods() {
  const document = new Document()
  const buffer = document.createBuffer()
  const position = document.createAccessor('positions')
    .setType('VEC3')
    .setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]))
    .setBuffer(buffer)
  const mesh = document.createMesh('RockMesh')
    .addPrimitive(document.createPrimitive().setAttribute('POSITION', position))
  const near = document.createNode('Rock_LOD0').setMesh(mesh).setExtras({ blendlink_id: 'near-id' })
  const far = document.createNode('Rock_LOD1').setMesh(mesh).setExtras({ blendlink_id: 'far-id' })
  document.createScene().addChild(near).addChild(far)
  return { document, near, far, mesh, buffer }
}

function authoredCameraRecipe(
  framing: PresentationCameraRecipe['framing'] = 'authored',
): PresentationCameraRecipe {
  return {
    objectId: 'camera-id',
    objectName: 'Website Camera',
    behavior: 'fixed',
    framing,
    compositions: [
      { name: 'Desktop', width: 1440, height: 900, safeMargin: 0.08 },
      { name: 'Mobile', width: 390, height: 844, safeMargin: 0.08 },
    ],
  }
}

function documentWithCamera(type: 'orthographic' | 'perspective', xmag = 2.88, ymag = 1.8) {
  const document = new Document()
  const camera = document.createCamera('Website Camera').setType(type)
  if (type === 'orthographic') camera.setXMag(xmag).setYMag(ymag)
  document.createScene('Scene').addChild(
    document.createNode('Website Camera')
      .setExtras({ blendlink_id: 'camera-id' })
      .setCamera(camera),
  )
  return document
}

const attestationImage = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lsk+2QAAAABJRU5ErkJggg==',
  'base64',
)
const positionOnlyQuantization = /^(?!TEXCOORD(?:_\d+)?$).*$/

function imageAttestationFixture(indexed: boolean) {
  const document = new Document()
  const buffer = document.createBuffer()
  const uniquePositions = [
    [-2, -1, 0],
    [2, -1, 0],
    [2, 1, 0],
    [-2, 1, 0],
  ] as const
  const uniqueUvs = [
    [0.125, 0.25],
    [0.875, 0.25],
    [0.875, 0.75],
    [0.125, 0.75],
  ] as const
  const corners = [0, 1, 2, 0, 2, 3, 0, 1, 2]
  const positions = indexed
    ? uniquePositions
    : corners.map((index) => uniquePositions[index]!)
  const uvs = indexed
    ? uniqueUvs
    : corners.map((index) => uniqueUvs[index]!)
  const position = document.createAccessor('attested positions')
    .setType('VEC3')
    .setArray(new Float32Array(positions.flat()))
    .setBuffer(buffer)
  const uv = document.createAccessor('attested UV')
    .setType('VEC2')
    .setArray(new Float32Array(uvs.flat()))
    .setBuffer(buffer)
  const texture = document.createTexture('Attested Image')
    .setImage(attestationImage)
    .setMimeType('image/png')
  const material = document.createMaterial('BLENDLINK_WEB.IMAGE.Attested')
    .setBaseColorTexture(texture)
  material.setExtension(
    'KHR_materials_unlit',
    document.createExtension(KHRMaterialsUnlit).createUnlit(),
  )
  material.getBaseColorTextureInfo()!
    .setTexCoord(0)
    .setMagFilter(9729)
    .setMinFilter(9987)
    .setWrapS(10497)
    .setWrapT(10497)
  const primitive = document.createPrimitive()
    .setAttribute('POSITION', position)
    .setAttribute('TEXCOORD_0', uv)
    .setMaterial(material)
  if (indexed) {
    primitive.setIndices(
      document.createAccessor('attested indices')
        .setType('SCALAR')
        .setArray(new Uint16Array(corners))
        .setBuffer(buffer),
    )
  }
  const mesh = document.createMesh('Attested Mesh').addPrimitive(primitive)
  document.createScene('Scene').addChild(
    document.createNode('Attested Object').setMesh(mesh),
  )
  const evidence: MaterialCompilationEvidence = {
    schemaVersion: 1,
    attestationModel: 'primitive-corner-v1',
    sourceFingerprint: 'optimizer-differential-source',
    loweredMaterials: ['Attested Source'],
    generatedMaterials: ['BLENDLINK_WEB.IMAGE.Attested'],
    gltfEvidence: [{
      sourceMaterial: 'Attested Source',
      generatedMaterial: 'BLENDLINK_WEB.IMAGE.Attested',
      transport: 'image',
      unlit: true,
      primitiveCount: 1,
      color0: false,
      imageSha256: createHash('sha256').update(attestationImage).digest('hex'),
      imageMime: 'image/png',
      imageWidth: 1,
      imageHeight: 1,
      sampler: { magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 },
      texCoord: 0,
      uvHash: '757b4a4afbc9031ae9a86c7c33fc6d94383e05b18a2818b524970de8118a2f83',
      uvDistinctValues: 4,
      uvMin: [0.125, 0.25],
      uvMax: [0.875, 0.75],
      uvGeometryAssociation: {
        algorithm: 'mesh-position14-uv-triangles-v1',
        // Independent golden produced by Blender 5.2 material_compiler.py.
        hash: '34c47291e3e7415a42a93f1e090490a41efdc488a2f7585879c31097ac730962',
        triangleCount: 3,
        positionGrids: [{ mesh: 0, bits: 14, offset: [0, 0, 0], scale: 2 }],
      },
      alphaMode: 'OPAQUE',
      baseColorFactor: [1, 1, 1, 1],
      doubleSided: false,
      bindings: ['Attested Object[0]'],
      bindingPrimitives: [{
        binding: 'Attested Object[0]',
        occurrences: [{ mesh: 0, primitives: [0] }],
      }],
    }],
  }
  return { document, evidence, primitive }
}

function morphGridAttestationFixture() {
  const document = new Document()
  const buffer = document.createBuffer()
  const halfGridPosition = -0.9503418207168579
  const position = document.createAccessor('morph-grid positions')
    .setType('VEC3')
    .setArray(new Float32Array([
      -2, -1, 0,
      2, -1, 0,
      halfGridPosition, 1, 0,
    ]))
    .setBuffer(buffer)
  const uv = document.createAccessor('morph-grid UV')
    .setType('VEC2')
    .setArray(new Float32Array([
      0.125, 0.25,
      0.875, 0.25,
      0.875, 0.75,
    ]))
    .setBuffer(buffer)
  const morphPosition = document.createAccessor('morph-grid delta')
    .setType('VEC3')
    .setArray(new Float32Array([
      -3, 0, 0,
      1.5, 0, 0,
      0, 0, 0,
    ]))
    .setBuffer(buffer)
  const texture = document.createTexture('Morph Attested Image')
    .setImage(attestationImage)
    .setMimeType('image/png')
  const material = document.createMaterial('BLENDLINK_WEB.IMAGE.MorphAttested')
    .setBaseColorTexture(texture)
  material.setExtension(
    'KHR_materials_unlit',
    document.createExtension(KHRMaterialsUnlit).createUnlit(),
  )
  material.getBaseColorTextureInfo()!
    .setTexCoord(0)
    .setMagFilter(9729)
    .setMinFilter(9987)
    .setWrapS(10497)
    .setWrapT(10497)
  const primitive = document.createPrimitive()
    .setAttribute('POSITION', position)
    .setAttribute('TEXCOORD_0', uv)
    .addTarget(
      document.createPrimitiveTarget().setAttribute('POSITION', morphPosition),
    )
    .setMaterial(material)
  const mesh = document.createMesh('Morph Attested Mesh').addPrimitive(primitive)
  document.createScene('Scene').addChild(
    document.createNode('Morph Attested Object').setMesh(mesh),
  )
  const evidence: MaterialCompilationEvidence = {
    schemaVersion: 1,
    attestationModel: 'primitive-corner-v1',
    sourceFingerprint: 'morph-grid-differential-source',
    loweredMaterials: ['Morph Attested Source'],
    generatedMaterials: ['BLENDLINK_WEB.IMAGE.MorphAttested'],
    gltfEvidence: [{
      sourceMaterial: 'Morph Attested Source',
      generatedMaterial: 'BLENDLINK_WEB.IMAGE.MorphAttested',
      transport: 'image',
      unlit: true,
      primitiveCount: 1,
      color0: false,
      imageSha256: createHash('sha256').update(attestationImage).digest('hex'),
      imageMime: 'image/png',
      imageWidth: 1,
      imageHeight: 1,
      sampler: { magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 },
      texCoord: 0,
      uvHash: 'a0305ace52d8bb246a9682723d16aa60c5ad0208bd728041e8265a4005633694',
      uvDistinctValues: 3,
      uvMin: [0.125, 0.25],
      uvMax: [0.875, 0.75],
      uvGeometryAssociation: {
        algorithm: 'mesh-position14-uv-triangles-v1',
        // The morph deltas expand x to [-6, 3], yielding offset -1.5 / scale 4.5.
        // This independent producer golden also places one source x just above a
        // 14-bit half-grid boundary (1000.5000325573816).
        hash: 'f42e3f0d04afb808548736711e3597844f100feafc0859f0819afff0ea8f7638',
        triangleCount: 1,
        positionGrids: [{
          mesh: 0,
          bits: 14,
          offset: [-1.5, 0, 0],
          scale: 4.5,
        }],
      },
      alphaMode: 'OPAQUE',
      baseColorFactor: [1, 1, 1, 1],
      doubleSided: false,
      bindings: ['Morph Attested Object[0]'],
      bindingPrimitives: [{
        binding: 'Morph Attested Object[0]',
        occurrences: [{ mesh: 0, primitives: [0] }],
      }],
    }],
  }
  return { document, evidence, primitive, halfGridPosition }
}

function verifyFixture(
  document: Document,
  materialCompilation: MaterialCompilationEvidence,
) {
  return compileSceneDiagnostics(document, vocabulary([]), {
    procedural: [],
    instances: [],
    materialCompilation,
    limits: { maxAuditFrames: 120, maxMorphCacheBytes: 64 * 1024 * 1024 },
  })
}

describe('scene diagnostics', () => {
  it('attests a final orthographic projection that matches a named authored composition', () => {
    const evidence = compileAuthoredOrthographicAspectEvidence(
      documentWithCamera('orthographic'),
      authoredCameraRecipe(),
    )

    expect(evidence).toMatchObject({
      cameraObjectId: 'camera-id',
      exportedAspect: 1.6,
      matchedComposition: 'Desktop',
    })
    expect(evidence?.warning).toBeUndefined()
    expect(evidence?.compositions[0]).toMatchObject({
      name: 'Desktop', aspect: 1.6, relativeDifference: 0,
    })
  })

  it('warns when AUTHORED final GLB framing matches no declared composition', () => {
    const evidence = compileAuthoredOrthographicAspectEvidence(
      documentWithCamera('orthographic', 1.8, 1.8),
      authoredCameraRecipe(),
    )

    expect(evidence).toMatchObject({
      exportedAspect: 1,
      compositions: [
        { name: 'Desktop', width: 1440, height: 900 },
        { name: 'Mobile', width: 390, height: 844 },
      ],
    })
    expect(evidence?.matchedComposition).toBeUndefined()
    expect(evidence?.warning).toMatch(
      /AUTHORED orthographic camera "Website Camera".*1\.0000:1.*no named camera composition matches.*"Desktop" 1440x900.*Output resolution and pixel aspect.*reference images will not compare 1:1/s,
    )
  })

  it('does not apply the authored orthographic rule to fit modes or perspective cameras', () => {
    expect(compileAuthoredOrthographicAspectEvidence(
      documentWithCamera('orthographic', 1.8, 1.8),
      authoredCameraRecipe('fit-scene'),
    )).toBeUndefined()
    expect(compileAuthoredOrthographicAspectEvidence(
      documentWithCamera('perspective'),
      authoredCameraRecipe(),
    )).toBeUndefined()
  })

  it('makes LOD thresholds, stable IDs, and draw-call consequence explicit', () => {
    const { document } = documentWithLods()
    const report = compileSceneDiagnostics(document, vocabulary([
      { index: 0, node: 'Rock_LOD0' },
      { index: 1, node: 'Rock_LOD1', distance: 12 },
    ]))
    expect(report.lod).toMatchObject({
      validChains: 1,
      drawCallsWithoutAdapter: 2,
      drawCallsWithAdapter: 1,
      chains: [{
        valid: true,
        levels: [
          { loadedName: 'Rock_LOD0', id: 'near-id', distance: 0 },
          { loadedName: 'Rock_LOD1', id: 'far-id', distance: 12 },
        ],
      }],
    })
  })

  it('blocks ambiguous thresholds and origins before runtime mutation', () => {
    const { document, far } = documentWithLods()
    far.setTranslation([2, 0, 0])
    const report = compileSceneDiagnostics(document, vocabulary([
      { index: 0, node: 'Rock_LOD0' },
      { index: 1, node: 'Rock_LOD1' },
    ]))
    expect(report.lod.chains[0]?.valid).toBe(false)
    expect(report.lod.chains[0]?.warnings.join(' ')).toMatch(/switch distance.*origins differ/)
  })

  it('rejects LOD gaps even when the remaining thresholds are ordered', () => {
    const { document } = documentWithLods()
    const report = compileSceneDiagnostics(document, vocabulary([
      { index: 0, node: 'Rock_LOD0', distance: 99 },
      { index: 2, node: 'Rock_LOD1', distance: 12 },
    ]))
    expect(report.lod.chains[0]).toMatchObject({
      valid: false,
      levels: [{ distance: 0 }, { distance: 12 }],
    })
    expect(report.lod.chains[0]?.warnings.join(' ')).toMatch(/contiguous from LOD0/)
  })

  it('reports source instance eligibility separately from actual GPU batches', () => {
    const { document, mesh, buffer } = documentWithLods()
    const transforms = document.createAccessor('instance positions')
      .setType('VEC3')
      .setArray(new Float32Array([0, 0, 0, 2, 0, 0, 4, 0, 0]))
      .setBuffer(buffer)
    const extension = document.createExtension(EXTMeshGPUInstancing)
    document.createNode('Trees').setMesh(mesh).setExtension(
      'EXT_mesh_gpu_instancing', extension.createInstancedMesh().setAttribute('TRANSLATION', transforms),
    )
    document.createNode('Tree A').setMesh(mesh)
    document.createNode('Tree B').setMesh(mesh)
    const blender: BlenderSceneDiagnostics = {
      limits: { maxAuditFrames: 120, maxMorphCacheBytes: 64 * 1024 * 1024 },
      procedural: [],
      instances: [{
        id: 'tree-group', meshData: 'Tree', count: 2, eligible: true, reasons: [],
        members: [{ name: 'Tree A', id: 'a' }, { name: 'Tree B', id: 'b' }],
        drawCallsSeparate: 2, drawCallsInstanced: 1, drawCallsSaved: 1,
        emission: 'shared-data',
      }],
    }
    const report = compileSceneDiagnostics(document, vocabulary([]), blender)
    expect(report.instances).toMatchObject({
      eligibleGroups: 1,
      estimatedDrawCallsCurrent: 2,
      estimatedDrawCallsIfEligibleBatched: 1,
      estimatedDrawCallsSaved: 1,
      gpuBatches: [{ node: 'Trees', instances: 3, drawCalls: 1, semantics: ['TRANSLATION'] }],
    })
  })

  it('summarizes topology blockers without claiming a non-standard cache exists', () => {
    const { document } = documentWithLods()
    const procedural = [{
      object: 'Wave', modifiers: [], dependencies: { camera: false, objects: [], collections: [] },
      source: {
        frame: 1, vertices: 3, edges: 3, polygons: 1, triangles: 1,
        topologyHash: 'a', positionHash: 'a', appearanceHash: 'a',
      },
      samples: [], sampledExhaustively: true, frameRange: [1, 2] as [number, number],
      topology: 'changing' as const,
      appearanceChanging: false,
      sourceDelta: {
        vertices: 0, triangles: 0, topologyChanged: false, appearanceChanged: false,
      },
      route: 'Block' as const, blocking: true,
      reason: 'Core glTF cannot animate changing topology.',
    }]
    const report = compileSceneDiagnostics(document, vocabulary([]), {
      procedural,
      instances: [],
      limits: { maxAuditFrames: 120, maxMorphCacheBytes: 64 * 1024 * 1024 },
    })
    expect(report.procedural).toMatchObject({ blockers: 1, topologyChanging: 1, cacheCandidates: 0 })
  })

  it('preserves material portability separately from Cycles bake compatibility', () => {
    const { document } = documentWithLods()
    const report = compileSceneDiagnostics(document, vocabulary([]), {
      procedural: [],
      instances: [],
      materials: [{
        material: 'Toon Bush',
        status: 'needsBake',
        label: 'Needs Bake',
        summary: 'The active shader graph cannot publish faithfully as editable glTF.',
        reasons: ['Shader to RGB is not a portable stock glTF material node.'],
        usedBy: ['Bush B', 'Bush A'],
        cyclesAppearance: {
          status: 'blocked',
          blockers: ['Shader to RGB is EEVEE-only and cannot be evaluated by Cycles Appearance baking.'],
        },
      }, {
        material: 'Portable Paint',
        status: 'exact',
        label: 'Exact glTF',
        summary: 'Supported Principled inputs publish through Blender\'s glTF exporter.',
        reasons: [],
        usedBy: ['Sign'],
        cyclesAppearance: { status: 'compatible', blockers: [] },
      }],
      limits: { maxAuditFrames: 120, maxMorphCacheBytes: 64 * 1024 * 1024 },
    })

    expect(report.materials).toMatchObject({
      exact: 1,
      approximated: 0,
      needsBake: 1,
      cyclesAppearanceBlocked: 1,
      records: [{ material: 'Portable Paint' }, {
        material: 'Toon Bush',
        usedBy: ['Bush A', 'Bush B'],
        cyclesAppearance: { status: 'blocked' },
      }],
    })
  })

  it('persists finished-GLB material compiler attestation without reshaping portability', () => {
    const { document, buffer } = documentWithLods()
    const position = document.createAccessor('compiled positions')
      .setType('VEC3')
      .setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]))
      .setBuffer(buffer)
    const color = document.createAccessor('compiled colors')
      .setType('VEC4')
      .setArray(new Float32Array([
        1, 0, 0, 0.25,
        0, 1, 0, 0.5,
        0, 0, 1, 1,
      ]))
      .setBuffer(buffer)
    const material = document.createMaterial('BLENDLINK_WEB.123.DPM')
      .setAlphaMode('BLEND')
    material.setExtension(
      'KHR_materials_unlit',
      document.createExtension(KHRMaterialsUnlit).createUnlit(),
    )
    const compiledMesh = document.createMesh('Compiled Mesh').addPrimitive(
      document.createPrimitive()
        .setAttribute('POSITION', position)
        .setAttribute('COLOR_0', color)
        .setMaterial(material),
    )
    document.getRoot().listScenes()[0]!.addChild(
      document.createNode('Character').setMesh(compiledMesh),
    )
    const sourceBindings = ['Character[0]']
    const report = compileSceneDiagnostics(document, vocabulary([]), {
      procedural: [],
      instances: [],
      materials: [{
        material: 'DPM',
        status: 'needsBake',
        label: 'Needs Bake',
        summary: 'The full shader graph is not stock glTF.',
        reasons: ['Shader to RGB is not portable.'],
        usedBy: ['Character'],
        materialCompilation: {
          intent: 'webColor', outcome: 'lowered', fidelity: 'selected-field',
          transport: 'vertexColor',
          colorSource: { node: 'Root Color', socket: 'Color', kind: 'vertexColor' },
          limitations: ['Publishes the selected intrinsic field only.'],
        },
      }],
      materialCompilation: {
        schemaVersion: 1,
        sourceFingerprint: 'abc123',
        loweredMaterials: ['DPM'],
        generatedMaterials: ['BLENDLINK_WEB.123.DPM'],
        gltfEvidence: [{
          sourceMaterial: 'DPM',
          generatedMaterial: 'BLENDLINK_WEB.123.DPM',
          transport: 'vertexColor',
          unlit: true,
          primitiveCount: 1,
          color0: true,
          color0Type: 'VEC4',
          color0Min: [0, 0, 0, 0.25],
          color0Max: [1, 1, 1, 1],
          color0Tolerance: 1e-5,
          alphaMode: 'BLEND',
          baseColorFactor: [1, 1, 1, 1],
          doubleSided: false,
          bindings: sourceBindings,
        }],
      },
      limits: { maxAuditFrames: 120, maxMorphCacheBytes: 64 * 1024 * 1024 },
    })

    expect(report.materials).toMatchObject({ needsBake: 1 })
    expect(report.materials?.records[0]?.materialCompilation).toMatchObject({
      outcome: 'lowered', fidelity: 'selected-field', transport: 'vertexColor',
    })
    expect(report.materialCompilation).toEqual({
      schemaVersion: 1,
      sourceFingerprint: 'abc123',
      loweredMaterials: ['DPM'],
      generatedMaterials: ['BLENDLINK_WEB.123.DPM'],
      gltfEvidence: [{
        sourceMaterial: 'DPM', generatedMaterial: 'BLENDLINK_WEB.123.DPM',
        transport: 'vertexColor', unlit: true, primitiveCount: 1,
        color0: true, color0Type: 'VEC4', alphaMode: 'BLEND',
        color0Min: [0, 0, 0, 0.25], color0Max: [1, 1, 1, 1],
        color0Tolerance: 1e-5,
        baseColorFactor: [1, 1, 1, 1], doubleSided: false,
        bindings: ['Character[0]'],
      }],
    })
    sourceBindings.push('Mutation after compilation')
    expect(report.materialCompilation?.gltfEvidence[0]?.bindings).toEqual(['Character[0]'])

    material.setBaseColorFactor([0.5, 1, 1, 1])
    expect(() => compileSceneDiagnostics(document, vocabulary([]), {
      procedural: [],
      instances: [],
      materialCompilation: report.materialCompilation!,
      limits: { maxAuditFrames: 120, maxMorphCacheBytes: 64 * 1024 * 1024 },
    })).toThrow(/refused the final GLB.*changed baseColorFactor/)

    material.setBaseColorFactor([1, 1, 1, 1])
    color.setArray(new Float32Array([
      1, 1, 1, 1,
      1, 1, 1, 1,
      1, 1, 1, 1,
    ]))
    expect(() => compileSceneDiagnostics(document, vocabulary([]), {
      procedural: [],
      instances: [],
      materialCompilation: report.materialCompilation!,
      limits: { maxAuditFrames: 120, maxMorphCacheBytes: 64 * 1024 * 1024 },
    })).toThrow(/refused the final GLB.*changed COLOR_0 numeric range/)

    color.setArray(new Float32Array([
      1, 0, 0, 0.25,
      0, 1, 0, 0.5,
      0, 0, 1, 1,
    ]))
    compiledMesh.listPrimitives()[0]!.setAttribute('_BLENDLINK_WEB_FAKE', color)
    expect(() => compileSceneDiagnostics(document, vocabulary([]), {
      procedural: [],
      instances: [],
      materialCompilation: report.materialCompilation!,
      limits: { maxAuditFrames: 120, maxMorphCacheBytes: 64 * 1024 * 1024 },
    })).toThrow(/refused the final GLB.*leaked compiler-private attributes/)
  })

  it('re-attests lit selected fields as stock glTF PBR without an unlit extension', () => {
    const document = new Document()
    const buffer = document.createBuffer()
    const position = document.createAccessor('lit positions')
      .setType('VEC3')
      .setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]))
      .setBuffer(buffer)
    const material = document.createMaterial('BLENDLINK_WEB.LIT.Paint')
      .setMetallicFactor(0)
      .setRoughnessFactor(0.5)
    const mesh = document.createMesh('Lit Mesh').addPrimitive(
      document.createPrimitive()
        .setAttribute('POSITION', position)
        .setMaterial(material),
    )
    document.createScene('Scene').addChild(
      document.createNode('Lit Object').setMesh(mesh),
    )
    const evidence: MaterialCompilationEvidence = {
      schemaVersion: 1,
      attestationModel: 'primitive-corner-v1',
      sourceFingerprint: 'lit-selected-field',
      loweredMaterials: ['Paint'],
      generatedMaterials: ['BLENDLINK_WEB.LIT.Paint'],
      gltfEvidence: [{
        sourceMaterial: 'Paint',
        generatedMaterial: 'BLENDLINK_WEB.LIT.Paint',
        transport: 'factor',
        surfaceResponse: 'lit',
        unlit: false,
        metallicFactor: 0,
        roughnessFactor: 0.5,
        primitiveCount: 1,
        color0: false,
        alphaMode: 'OPAQUE',
        baseColorFactor: [1, 1, 1, 1],
        doubleSided: false,
        bindings: ['Lit Object[0]'],
        bindingPrimitives: [{
          binding: 'Lit Object[0]',
          occurrences: [{ mesh: 0, primitives: [0] }],
        }],
      }],
    }

    expect(() => verifyFixture(document, evidence)).not.toThrow()

    material.setMetallicFactor(0.25)
    expect(() => verifyFixture(document, evidence))
      .toThrow(/refused the final GLB.*changed metallicFactor/)
    material.setMetallicFactor(0)

    material.setExtension(
      'KHR_materials_unlit',
      document.createExtension(KHRMaterialsUnlit).createUnlit(),
    )
    expect(() => verifyFixture(document, evidence))
      .toThrow(/refused the final GLB.*unexpectedly gained KHR_materials_unlit/)
  })

  it('re-attests the exact shared-texture static shade-floor carrier', () => {
    const document = new Document()
    const buffer = document.createBuffer()
    const position = document.createAccessor('factorized positions')
      .setType('VEC3')
      .setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]))
      .setBuffer(buffer)
    const uvValues: Array<[number, number]> = [
      [0.125, 0.75], [0.875, 0.75], [0.5, 0.25],
    ]
    const uv = document.createAccessor('factorized UV')
      .setType('VEC2')
      .setArray(new Float32Array(uvValues.flat()))
      .setBuffer(buffer)
    const image = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lsk+2QAAAABJRU5ErkJggg==',
      'base64',
    )
    const texture = document.createTexture('One intrinsic texture')
      .setImage(image)
      .setMimeType('image/png')
    const material = document.createMaterial('BLENDLINK_WEB.FLOOR.Paint')
      .setBaseColorFactor([0.7, 0.7, 0.7, 1])
      .setBaseColorTexture(texture)
      .setEmissiveFactor([0.356, 0.44, 0.594])
      .setEmissiveTexture(texture)
      .setMetallicFactor(0)
      .setRoughnessFactor(0.5)
    for (const info of [
      material.getBaseColorTextureInfo()!,
      material.getEmissiveTextureInfo()!,
    ]) {
      info.setTexCoord(0)
        .setMagFilter(9729)
        .setMinFilter(9987)
        .setWrapS(10497)
        .setWrapT(10497)
    }
    const mesh = document.createMesh('Factorized Mesh').addPrimitive(
      document.createPrimitive()
        .setAttribute('POSITION', position)
        .setAttribute('TEXCOORD_0', uv)
        .setMaterial(material),
    )
    document.createScene().addChild(
      document.createNode('Factorized Object').setMesh(mesh),
    )
    const uvBytes = Buffer.alloc(uvValues.length * 8)
    ;[...uvValues].sort((left, right) => left[0] - right[0] || left[1] - right[1])
      .forEach((value, index) => {
        uvBytes.writeFloatLE(value[0], index * 8)
        uvBytes.writeFloatLE(value[1], index * 8 + 4)
      })
    const sampler = {
      magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497,
    }
    const association = {
      algorithm: 'mesh-position14-uv-triangles-v1' as const,
      hash: 'a26224e3b03b793bbc96f5e6cefc3eeae345a3864f98e28b79ab9ee3e217ceb1',
      triangleCount: 1,
      positionGrids: [{
        mesh: 0,
        bits: 14,
        offset: [0.5, 0.5, 0] as [number, number, number],
        scale: 0.5,
      }],
    }
    const imageHash = createHash('sha256').update(image).digest('hex')
    const uvHash = createHash('sha256').update(uvBytes).digest('hex')
    const evidence: MaterialCompilationEvidence = {
      schemaVersion: 1,
      attestationModel: 'primitive-corner-v1',
      sourceFingerprint: 'factorized-selected-field',
      loweredMaterials: ['Paint'],
      generatedMaterials: ['BLENDLINK_WEB.FLOOR.Paint'],
      gltfEvidence: [{
        sourceMaterial: 'Paint',
        generatedMaterial: 'BLENDLINK_WEB.FLOOR.Paint',
        transport: 'image',
        surfaceResponse: 'lit',
        unlit: false,
        metallicFactor: 0,
        roughnessFactor: 0.5,
        primitiveCount: 1,
        color0: false,
        imageSha256: imageHash,
        imageMime: 'image/png',
        imageWidth: 1,
        imageHeight: 1,
        sampler,
        texCoord: 0,
        uvHash,
        uvDistinctValues: 3,
        uvMin: [0.125, 0.25],
        uvMax: [0.875, 0.75],
        uvGeometryAssociation: association,
        surfaceFactorization: {
          model: 'selected-intrinsic-static-shade-floor-v1',
          shadeValue: 0.7,
          shadeColor: [0.08, 0.2, 0.42, 1],
          proofHash: 'exact-topology-proof',
          baseColorFactor: [0.7, 0.7, 0.7],
          emissiveFactor: [0.356, 0.44, 0.594],
          textureOwnership: 'sharedBaseAndEmissive',
          exactTerms: ['selectedIntrinsic', 'staticShadeFloor'],
          approximateTerms: ['shaderToRgbDirectResponseAsMetallicRoughness'],
        },
        textureNormalization: {
          model: 'stock-gltf-shared-texture-v1',
          baseTextureIndex: 1,
          exporterEmissiveTextureIndex: 0,
          duplicateTextureRecordRetained: true,
        },
        sharedTextureIndex: 1,
        emissiveFactor: [0.356, 0.44, 0.594],
        emissiveImageSha256: imageHash,
        emissiveImageMime: 'image/png',
        emissiveImageWidth: 1,
        emissiveImageHeight: 1,
        emissiveSampler: sampler,
        emissiveTexCoord: 0,
        emissiveUvHash: uvHash,
        emissiveUvDistinctValues: 3,
        emissiveUvMin: [0.125, 0.25],
        emissiveUvMax: [0.875, 0.75],
        emissiveUvGeometryAssociation: association,
        alphaMode: 'OPAQUE',
        baseColorFactor: [0.7, 0.7, 0.7, 1],
        doubleSided: false,
        bindings: ['Factorized Object[0]'],
        bindingPrimitives: [{
          binding: 'Factorized Object[0]',
          occurrences: [{ mesh: 0, primitives: [0] }],
        }],
      }],
    }

    expect(() => verifyFixture(document, evidence)).not.toThrow()
    evidence.gltfEvidence[0]!.textureNormalization = {
      model: 'stock-gltf-shared-texture-v1',
      baseTextureIndex: 0,
      exporterEmissiveTextureIndex: 0,
      duplicateTextureRecordRetained: false,
    }
    expect(() => verifyFixture(document, evidence)).not.toThrow()

    material.setEmissiveFactor([0.4, 0.44, 0.594])
    expect(() => verifyFixture(document, evidence))
      .toThrow(/refused the final GLB.*changed emissiveFactor/)
    material.setEmissiveFactor([0.356, 0.44, 0.594])

    const duplicateTexture = document.createTexture('Duplicate intrinsic texture')
      .setImage(image)
      .setMimeType('image/png')
    material.setEmissiveTexture(duplicateTexture)
    expect(() => verifyFixture(document, evidence))
      .toThrow(/refused the final GLB.*no longer shares one Texture object/)
  })

  it('refuses unsupported nested material-compilation evidence versions', () => {
    const { document } = documentWithLods()
    expect(() => compileSceneDiagnostics(document, vocabulary([]), {
      procedural: [],
      instances: [],
      materialCompilation: {
        schemaVersion: 2 as 1,
        sourceFingerprint: 'future-evidence',
        loweredMaterials: [],
        generatedMaterials: [],
        gltfEvidence: [],
      },
      limits: { maxAuditFrames: 120, maxMorphCacheBytes: 64 * 1024 * 1024 },
    })).toThrow(/material compilation evidence schemaVersion 2 is unsupported; expected 1/)
  })

  it('refuses moving a generated material to another primitive on the same mesh', () => {
    const document = new Document()
    const buffer = document.createBuffer()
    const firstPosition = document.createAccessor('first slot positions')
      .setType('VEC3')
      .setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]))
      .setBuffer(buffer)
    const secondPosition = document.createAccessor('second slot positions')
      .setType('VEC3')
      .setArray(new Float32Array([2, 0, 0, 3, 0, 0, 2, 1, 0]))
      .setBuffer(buffer)
    const generated = document.createMaterial('BLENDLINK_WEB.SLOT.Source')
    generated.setExtension(
      'KHR_materials_unlit',
      document.createExtension(KHRMaterialsUnlit).createUnlit(),
    )
    const neighbour = document.createMaterial('Neighbour')
    const expectedPrimitive = document.createPrimitive()
      .setAttribute('POSITION', firstPosition)
      .setMaterial(generated)
    const neighbourPrimitive = document.createPrimitive()
      .setAttribute('POSITION', secondPosition)
      .setMaterial(neighbour)
    const mesh = document.createMesh('Two Slot Mesh')
      .addPrimitive(expectedPrimitive)
      .addPrimitive(neighbourPrimitive)
    document.createScene().addChild(document.createNode('Two Slot Object').setMesh(mesh))
    const evidence: MaterialCompilationEvidence = {
      schemaVersion: 1,
      attestationModel: 'primitive-corner-v1',
      sourceFingerprint: 'two-slot-source',
      loweredMaterials: ['Source'],
      generatedMaterials: ['BLENDLINK_WEB.SLOT.Source'],
      gltfEvidence: [{
        sourceMaterial: 'Source',
        generatedMaterial: 'BLENDLINK_WEB.SLOT.Source',
        transport: 'factor',
        unlit: true,
        primitiveCount: 1,
        color0: false,
        alphaMode: 'OPAQUE',
        baseColorFactor: [1, 1, 1, 1],
        doubleSided: false,
        bindings: ['Two Slot Object[0]'],
        bindingPrimitives: [{
          binding: 'Two Slot Object[0]',
          occurrences: [{ mesh: 0, primitives: [0] }],
        }],
      }],
    }
    expect(() => compileSceneDiagnostics(document, vocabulary([]), {
      procedural: [], instances: [], materialCompilation: evidence,
      limits: { maxAuditFrames: 120, maxMorphCacheBytes: 64 * 1024 * 1024 },
    })).not.toThrow()

    expectedPrimitive.setMaterial(neighbour)
    neighbourPrimitive.setMaterial(generated)
    expect(() => compileSceneDiagnostics(document, vocabulary([]), {
      procedural: [], instances: [], materialCompilation: evidence,
      limits: { maxAuditFrames: 120, maxMorphCacheBytes: 64 * 1024 * 1024 },
    })).toThrow(/refused the final GLB.*binding occurrence Two Slot Object\[0\].*primitive/)
  })

  it('re-attests exact image bytes, sampler, texCoord, and UVs after final transforms', () => {
    const document = new Document()
    const buffer = document.createBuffer()
    const position = document.createAccessor('picture positions')
      .setType('VEC3')
      .setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]))
      .setBuffer(buffer)
    const uvValues: Array<[number, number]> = [
      [0.125, 0.75], [0.875, 0.75], [0.5, 0.25],
    ]
    const uv = document.createAccessor('picture UV')
      .setType('VEC2')
      .setArray(new Float32Array(uvValues.flat()))
      .setBuffer(buffer)
    const image = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lsk+2QAAAABJRU5ErkJggg==',
      'base64',
    )
    const texture = document.createTexture('Packed Website Picture')
      .setImage(image)
      .setMimeType('image/png')
    const material = document.createMaterial('BLENDLINK_WEB.IMAGE.Picture')
      .setBaseColorTexture(texture)
    material.setExtension(
      'KHR_materials_unlit',
      document.createExtension(KHRMaterialsUnlit).createUnlit(),
    )
    material.getBaseColorTextureInfo()!
      .setTexCoord(0)
      .setMagFilter(9729)
      .setMinFilter(9987)
      .setWrapS(10497)
      .setWrapT(10497)
    const mesh = document.createMesh('Picture Mesh').addPrimitive(
      document.createPrimitive()
        .setAttribute('POSITION', position)
        .setAttribute('TEXCOORD_0', uv)
        .setMaterial(material),
    )
    document.createScene().addChild(document.createNode('Picture').setMesh(mesh))
    const uvBytes = Buffer.alloc(uvValues.length * 8)
    ;[...uvValues].sort((left, right) => left[0] - right[0] || left[1] - right[1])
      .forEach((value, index) => {
        uvBytes.writeFloatLE(value[0], index * 8)
        uvBytes.writeFloatLE(value[1], index * 8 + 4)
      })
    const legacyMaterialization: NonNullable<
      MaterialCompilationEvidence['gltfEvidence'][number]['materializationEvidence']
    > = {
      coveredFraction: 1,
      rgbMin: [0, 0, 0],
      rgbMax: [1, 1, 1],
      deviceClass: 'cpu',
      backend: 'cpu',
      resolutionPolicy: 'fallback-no-camera',
      targetPxPerMeter: null,
      targetProjectedPixels: null,
      projectedCoverageFraction: null,
      achievedPxPerMeter: 128,
      achievedProjectedPixels: 16_384,
      resolution: 128,
      minimumCandidateResolution: 128,
      densityRatio: null,
      densityMet: true,
      uvStrategy: 'authored-atlas',
      sourceUvName: 'BLENDLINK_WEB_ATLAS',
      sourceLayoutIssues: [],
      sourceRescuePolygonCount: 0,
      sourceRescueAttemptedPolygonCount: 0,
      ignoredZeroAreaTriangles: 0,
      zeroWorldAreaTriangleCount: 0,
      uvArea: 1,
      margin: 2,
    }
    const evidence: BlenderSceneDiagnostics['materialCompilation'] = {
      schemaVersion: 1,
      attestationModel: 'primitive-corner-v1',
      sourceFingerprint: 'image-source',
      loweredMaterials: ['Picture Material'],
      generatedMaterials: ['BLENDLINK_WEB.IMAGE.Picture'],
      gltfEvidence: [{
        sourceMaterial: 'Picture Material',
        generatedMaterial: 'BLENDLINK_WEB.IMAGE.Picture',
        transport: 'image',
        unlit: true,
        primitiveCount: 1,
        color0: false,
        imageSha256: createHash('sha256').update(image).digest('hex'),
        imageMime: 'image/png',
        imageWidth: 1,
        imageHeight: 1,
        sampler: { magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 },
        texCoord: 0,
        uvHash: createHash('sha256').update(uvBytes).digest('hex'),
        uvDistinctValues: 3,
        uvMin: [0.125, 0.25],
        uvMax: [0.875, 0.75],
        bindingPrimitives: [{
          binding: 'Picture[0]',
          occurrences: [{ mesh: 0, primitives: [0] }],
        }],
        uvGeometryAssociation: {
          algorithm: 'mesh-position14-uv-triangles-v1',
          hash: 'a26224e3b03b793bbc96f5e6cefc3eeae345a3864f98e28b79ab9ee3e217ceb1',
          triangleCount: 1,
          positionGrids: [{
            mesh: 0,
            bits: 14,
            offset: [0.5, 0.5, 0],
            scale: 0.5,
          }],
        },
        alphaMode: 'OPAQUE',
        baseColorFactor: [1, 1, 1, 1],
        doubleSided: false,
        bindings: ['Picture[0]'],
        materialization: 'cyclesEmit',
        materializationEvidence: legacyMaterialization,
      }],
    }
    const report = compileSceneDiagnostics(document, vocabulary([]), {
      procedural: [], instances: [], materialCompilation: evidence,
      limits: { maxAuditFrames: 120, maxMorphCacheBytes: 64 * 1024 * 1024 },
    })
    expect(report.materialCompilation?.gltfEvidence[0]).toMatchObject({
      transport: 'image', imageMime: 'image/png', texCoord: 0, uvDistinctValues: 3,
      bindingPrimitives: [{
        binding: 'Picture[0]',
        occurrences: [{ mesh: 0, primitives: [0] }],
      }],
      uvGeometryAssociation: {
        algorithm: 'mesh-position14-uv-triangles-v1',
        triangleCount: 1,
      },
      materializationEvidence: legacyMaterialization,
    })

    const exactMaterialization: typeof legacyMaterialization = {
      ...legacyMaterialization,
      measurementModel: 'selected-field-density-v1',
      sourceUnitSystem: 'METRIC',
      sourceMetersPerBlenderUnit: 0.01,
      sourceWorldAreaBlenderUnitsSquared: 1,
      sourceWorldAreaSquareMeters: 0.0001,
      projectionMetric: 'clipped-triangle-area-sum-capped-to-viewport',
      cameraScope: 'all-scene-perspective-orthographic-cameras',
      cameraSelection: 'maximum-projected-triangle-area-sum',
      selectedCameraName: null,
      selectedCameraStableId: null,
      eligibleCameraCount: 0,
      projectingCameraCount: 0,
      projectedTriangleAreaSumPixelAreaCapped: null,
      projectedTriangleAreaSumFractionCapped: null,
      achievedTexelsPerBlenderUnit: 128,
      achievedTexelsPerSourceMeter: 12_800,
      allocatedBindingTexelArea: 16_384,
      uvGenerationSpace: 'world-linear-private-proxy',
      sourceLayoutIssues: ['source-evidence'],
      repairCount: 0,
      uvRepairStrategies: [],
    }
    const exactEvidence: MaterialCompilationEvidence = {
      ...evidence!,
      gltfEvidence: [{
        ...evidence!.gltfEvidence[0]!,
        materializationEvidence: exactMaterialization,
      }],
    }
    const exactReport = compileSceneDiagnostics(document, vocabulary([]), {
      procedural: [], instances: [], materialCompilation: exactEvidence,
      limits: { maxAuditFrames: 120, maxMorphCacheBytes: 64 * 1024 * 1024 },
    })
    expect(
      exactReport.materialCompilation?.gltfEvidence[0]?.materializationEvidence,
    ).toMatchObject({
      measurementModel: 'selected-field-density-v1',
      sourceMetersPerBlenderUnit: 0.01,
      projectionMetric: 'clipped-triangle-area-sum-capped-to-viewport',
      achievedTexelsPerSourceMeter: 12_800,
      allocatedBindingTexelArea: 16_384,
      uvGenerationSpace: 'world-linear-private-proxy',
      repairCount: 0,
      uvRepairStrategies: [],
    })
    exactMaterialization.sourceLayoutIssues.push('mutation after compilation')
    exactMaterialization.uvRepairStrategies?.push(
      'sampleable-regular-polygon-rescue',
    )
    expect(
      exactReport.materialCompilation?.gltfEvidence[0]?.materializationEvidence
        ?.sourceLayoutIssues,
    ).toEqual(['source-evidence'])
    expect(
      exactReport.materialCompilation?.gltfEvidence[0]?.materializationEvidence
        ?.uvRepairStrategies,
    ).toEqual([])

    texture.setImage(new Uint8Array(image.map((value, index) => index === 30 ? value ^ 1 : value)))
    expect(() => compileSceneDiagnostics(document, vocabulary([]), {
      procedural: [], instances: [], materialCompilation: evidence,
      limits: { maxAuditFrames: 120, maxMorphCacheBytes: 64 * 1024 * 1024 },
    })).toThrow(/refused the final GLB.*changed selected image bytes or MIME/)

    texture.setImage(image)
    const {
      attestationModel: _attestationModel,
      ...legacyEvidenceFields
    } = evidence!
    const legacyEvidence: MaterialCompilationEvidence = {
      ...legacyEvidenceFields,
      gltfEvidence: evidence!.gltfEvidence.map((item) => {
        const {
          bindingPrimitives: _bindingPrimitives,
          uvGeometryAssociation: _uvGeometryAssociation,
          ...legacyItem
        } = item
        return legacyItem
      }),
    }
    uv.setArray(new Float32Array([0, 0, 0.875, 0.75, 0.5, 0.25]))
    expect(() => compileSceneDiagnostics(document, vocabulary([]), {
      procedural: [], instances: [], materialCompilation: legacyEvidence,
      limits: { maxAuditFrames: 120, maxMorphCacheBytes: 64 * 1024 * 1024 },
    })).toThrow(/refused the final GLB.*changed TEXCOORD_0 numeric evidence/)

    uv.setArray(new Float32Array([
      ...uvValues[1]!,
      ...uvValues[0]!,
      ...uvValues[2]!,
    ]))
    expect(() => compileSceneDiagnostics(document, vocabulary([]), {
      procedural: [], instances: [], materialCompilation: evidence,
      limits: { maxAuditFrames: 120, maxMorphCacheBytes: 64 * 1024 * 1024 },
    })).toThrow(/refused the final GLB.*changed TEXCOORD_0 corner association/)
  })

  it('projects exactly the versioned LOD and instance inputs needed by browser adapters', () => {
    const { document } = documentWithLods()
    const full = compileSceneDiagnostics(document, vocabulary([
      { index: 0, node: 'Rock_LOD0', distance: 0 },
      { index: 1, node: 'Rock_LOD1', distance: 12 },
    ]))
    const runtime = compileRuntimeSceneDiagnostics(full)

    expect(runtime).toEqual({
      schemaVersion: RUNTIME_SCENE_DIAGNOSTICS_SCHEMA_VERSION,
      lodChains: full.lod.chains,
      instanceGroups: full.instances.groups,
    })
    expect(Object.keys(runtime).sort()).toEqual([
      'instanceGroups', 'lodChains', 'schemaVersion',
    ])
    expect(runtime).not.toHaveProperty('procedural')
    expect(runtime).not.toHaveProperty('materials')
    expect(runtime).not.toHaveProperty('camera')
  })

  it('prefers and validates current runtime diagnostics while projecting legacy bindings', () => {
    const { document } = documentWithLods()
    const legacy = compileSceneDiagnostics(document, vocabulary([
      { index: 0, node: 'Rock_LOD0', distance: 0 },
      { index: 1, node: 'Rock_LOD1', distance: 12 },
    ]))
    const current = {
      schemaVersion: RUNTIME_SCENE_DIAGNOSTICS_SCHEMA_VERSION,
      lodChains: [],
      instanceGroups: [],
    } as const

    expect(resolveRuntimeSceneDiagnostics({
      runtimeDiagnostics: current,
      sceneDiagnostics: legacy,
    })).toBe(current)
    expect(resolveRuntimeSceneDiagnostics({ sceneDiagnostics: legacy })).toMatchObject({
      schemaVersion: 1,
      lodChains: [{ base: 'Rock' }],
      instanceGroups: [],
    })
    expect(() => resolveRuntimeSceneDiagnostics({
      runtimeDiagnostics: { ...current, schemaVersion: 2 as 1 },
      sceneDiagnostics: legacy,
    })).toThrow(/schema 2 is unsupported/)
    expect(() => resolveRuntimeSceneDiagnostics({
      runtimeDiagnostics: { ...current, lodChains: null as never },
    })).toThrow(/runtime diagnostics v1 is malformed/)
  })
})
