import { createHash } from 'node:crypto'
import {
  closeSync,
  mkdtempSync,
  openSync,
  readSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  Accessor,
  type Document,
  type Material,
  type Mesh,
  type Node,
  type Primitive,
  type Texture,
} from '@gltf-transform/core'
import type { InstancedMesh } from '@gltf-transform/extensions'
import type { Vocabulary } from './vocabulary.js'
import { allocateLoadedNodeNames } from './loadedNames.js'
import type { PresentationCameraRecipe } from './sceneRecipe.js'

/** Allows for JSON float serialization without treating meaningfully different
 * viewport shapes as the same authored composition. */
export const CAMERA_ASPECT_RELATIVE_TOLERANCE = 0.001

export interface TopologySnapshot {
  frame: number
  vertices: number
  edges: number
  polygons: number
  triangles: number
  topologyHash: string
  positionHash: string
  appearanceHash: string
}

export interface ProceduralDiagnostic {
  object: string
  objectId?: string
  modifiers: Array<{
    name: string
    nodeGroup: string | null
    nodeTypes: string[]
    usesSceneTime: boolean
    usesCamera: boolean
    objects: string[]
    collections: string[]
    animatedNodeGroups?: string[]
    hasSimulation: boolean
    hasNamedAttributes: boolean
    hasUnrealizedInstances: boolean
  }>
  dependencies: {
    camera: boolean
    objects: string[]
    collections: string[]
    animated?: string[]
    animatedNodeGroups?: string[]
  }
  source: TopologySnapshot
  samples: TopologySnapshot[]
  sampledExhaustively: boolean
  frameRange: [number, number]
  topology: 'static' | 'deforming' | 'changing'
  appearanceChanging: boolean
  sourceDelta: {
    vertices: number
    triangles: number
    topologyChanged: boolean
    appearanceChanged: boolean
  }
  route: 'Realize' | 'Cache' | 'Block'
  blocking: boolean
  reason: string
  estimatedMorphBytes?: number
}

/** Phase 0c evidence: what Blendlink's pinned `export_apply=True` actually
 * does to one shape-keyed mesh. Blender's own property text
 * (io_scene_gltf2 __init__.py:679-684) claims applying modifiers always
 * prevents exporting shape keys; measured, it does not — 7 of
 * ellie's 9 render-visible shape-keyed meshes ship real morph targets. The
 * record therefore reports the per-key outcome instead of asserting the
 * general rule. */
export interface ShapeKeyTransportDiagnostic {
  object: string
  objectId?: string
  /** Which array io_scene_gltf2 reads POSITION from. `basis` means
   * primitive_extract.py:1112-1116 sources the Basis cage because a key block
   * survived, so the evaluated deformer stack is absent from the glb rather
   * than frozen into it. This field is the baseline selector the frozen
   * modifier residual needs. */
  positionSource: 'basis' | 'evaluated'
  basisKey?: string
  sourceVertices: number
  appliedVertices: number
  /** World-space, from `obj.bound_box` at the audited frame, so percentages
   * carry the animated pose's drift while the metre figures do not. */
  bboxDiagonal: number
  /** Metres between the exported POSITION and the evaluated mesh. Present only
   * when `positionSource` is `basis`. */
  basisDisplacement?: number
  /** Enabled modifiers whose type can change the vertex container. Context for
   * the drop, never the proof of it. */
  containerModifiers: string[]
  /** Leave-one-out attribution, present only when key blocks were lost. Empty
   * means no single modifier restores them. */
  restoredBy?: string[]
  keys: Array<{
    name: string
    /** `frozen` keys are dropped by the applied path with their current blend
     * already baked into POSITION; `skipped` keys are the Basis, muted, or
     * self-relative ones Blender's own `skip_sk` discards. */
    transport: 'morphTarget' | 'frozen' | 'skipped'
    value: number
    muted: boolean
    /** Metres this key moves at value 1.0, before the modifier stack. */
    maxDelta: number
    /** Evaluated, never inferred from channel presence: ellie's rig keys
     * constant-valued F-Curves, so existence of a channel proves nothing. */
    animation: 'notSampled' | 'unproven' | 'constant' | 'varying'
    /** The value that freezes into the shipped mesh. Present for `frozen`. */
    frozenValue?: number
    valueRange?: [number, number]
    /** `maxDelta` times the value range: the motion the glb cannot carry. */
    lostDisplacement?: number
  }>
  /** `static` needs no frames (the Key has no reachable time source);
   * `currentFrame` is the live addon, which can never refuse. */
  valueProof: 'notRequired' | 'static' | 'currentFrame' | 'sampled' | 'exhaustive'
  frameRange: [number, number]
  /** io_scene_gltf2 blender/exp/export.py:28-29 freezes frame 0, which can lie
   * outside the scene's own range. */
  frozenAtFrame: number
  severity: 'info' | 'warn' | 'refuse'
  message: string
}

/** Phase 0d evidence: ARMATURE options with no glTF form. Presence is the loss
 * — glTF skinning is LBS-only and weights come from vertex groups alone
 * (primitive_extract.py:1557) — so this record is measured by RNA read and
 * deliberately carries no magnitude. Emitted only for objects that set a flag. */
export interface SkinApproximationDiagnostic {
  object: string
  objectId?: string
  /** Whether the exporter-selected modifier actually produces a skin
   * (tree.py:247-248 keys on `modifiers["ARMATURE"].object is not null`). */
  skinned: boolean
  armature?: string
  /** The ARMATURE modifier the exporter's `{type: modifier}` dict keeps: the
   * last one, regardless of `show_viewport`. */
  exporterSelected: string
  preserveVolume: boolean
  boneEnvelopes: boolean
  modifiers: Array<{
    name: string
    armature: string | null
    preserveVolume: boolean
    boneEnvelopes: boolean
    vertexGroups: boolean
    showViewport: boolean
    exporterSelected: boolean
  }>
  severity: 'info' | 'warn'
  message: string
}

export interface InstanceSourceDiagnostic {
  id: string
  meshData: string
  members: Array<{ name: string; loadedName?: string; id?: string }>
  count: number
  eligible: boolean
  reasons: string[]
  drawCallsSeparate: number
  drawCallsInstanced: number
  drawCallsSaved: number
  emission: 'shared-data'
}

export interface MaterialPortabilityDiagnostic {
  material: string
  status: 'exact' | 'approximated' | 'needsBake'
  label: string
  summary: string
  reasons: string[]
  usedBy: string[]
  /** Portability and bake-engine compatibility are independent. A material
   * can need flattening while still containing EEVEE-only nodes that the
   * current Cycles Appearance route cannot evaluate. */
  cyclesAppearance?: {
    status: 'compatible' | 'blocked'
    blockers: string[]
  }
  /** Explicit, material-local website field selection. `lowered` means the
   * Python compiler will replace only this export binding with an attested
   * stock glTF material; it does not claim full-surface shader parity.
   * `materialBake` intent (MTL-BAKE-001) carries every Principled channel
   * per its own route instead of one selected field. */
  materialCompilation?: {
    intent: 'automatic' | 'webColor' | 'materialBake'
    outcome: 'preserved' | 'lowered' | 'blocked'
    fidelity: 'full-surface' | 'selected-field' | 'per-channel'
    transport?: 'stock' | 'factor' | 'vertexColor' | 'image' | 'channels'
    surfaceResponse?: 'lit' | 'unlit'
    colorSource?: {
      node: string
      socket: string
      kind: 'constant' | 'vertexColor' | 'image' | 'materialized'
      materialization?: 'cyclesEmit'
    }
    alphaSource?: { node: string; socket: string; kind: 'constant' | 'vertexColor' | 'image' }
    surfaceFactorization?: SurfaceFactorizationEvidence
    limitations: string[]
    issues?: Array<{
      code: string
      material: string
      problem: string
      fix: string
      objects: string[]
    }>
    /** MTL-BAKE-001 per-channel plan for `materialBake` intent: every
     * Principled channel's resolved route, visible even when blocked. */
    channels?: MaterialChannelPlanDiagnostic
  }
  /** MTL-UV-002 per-channel coordinate-space routing. Additive: absent for
   * pre-channel producers and for materials without an active surface. */
  channels?: MaterialChannelRoutingDiagnostic
}

/** One channel's resolved Material-bake route. `factor-over-carrier` is a
 * constant base colour filled into the RGBA carrier a baked alpha needs. */
export interface MaterialChannelPlanEntry {
  channel: string
  route: 'factor' | 'factor-over-carrier' | 'passthrough' | 'bake' | 'refused'
  uv?: 'tile' | 'unique'
  resolution?: number | 'per-binding'
  colorspace?: 'srgb' | 'data'
  pass?: 'EMIT' | 'NORMAL'
  pack?: string
  wrapGate?: boolean
  uvMaps?: string[]
  usesActiveUv?: boolean
  value?: number | number[] | null
  strength?: number | null
  reasons?: string[]
  /** MTLX-TSL-001 additive evidence: the channel's compiled node->TSL IR
   * document (schemaVersion 1, model blendlink-tsl-ir-v1), attached only
   * for materials opted into `blendlink_tsl_ir`. The route above never
   * changes — the IR is what the future TSL runtime will build, while the
   * factor/bake carrier keeps rendering today. */
  tslIr?: { schemaVersion: 1; model: string; output: Record<string, unknown>; viewDependent?: boolean }
  /** sha256 of the IR's canonical JSON — enters plan fingerprints so
   * content is pinned without embedding megabyte payloads in hashes. */
  tslIrHash?: string
  tslIrBytes?: number
  /** Named reason the emitter refused this channel (unproven node, byte
   * budget, merged Emission record). */
  tslIrRefusal?: string
}

export interface MaterialChannelPlanDiagnostic {
  model: string
  channels: MaterialChannelPlanEntry[]
  /** MTL-CONS-003 stage 1: one generated material per variant. Tileable and
   * factor-only materials consolidate across every non-distinct binding;
   * the Unique population stays per-binding until the shared-atlas pack
   * lands. `distinctObjects` lists per-object opt-outs
   * (`blendlink_distinct_material`). */
  consolidation?: {
    population: 'factor' | 'tileable' | 'unique'
    bindings: number
    sharedMaterial: boolean
    distinctObjects?: string[]
  }
  wrapGateWindow?: number[]
}

/** One Principled input's coordinate-space routing. `tileable` is a
 * structural candidate — numeric channel fidelity at bake time may still
 * demote a channel whose graph is not period-1 in UV space. */
export interface MaterialChannelRoutingEntry {
  channel: string
  linked: boolean
  routing:
    | 'constant'
    | 'uniform'
    | 'tileable'
    | 'unique'
    | 'viewDependent'
    | 'sceneDependent'
    | 'unknown'
  /** Present only for linked channels. */
  spaces?: string[]
  uvMaps?: string[]
  usesActiveUv?: boolean
  animated?: boolean
  reasons?: string[]
  /** Present only for `constant` routing. */
  value?: number | number[] | null
}

export interface MaterialChannelRoutingDiagnostic {
  model: string
  surfaceRoot: 'principled' | 'unsupported'
  reason?: string
  channels: MaterialChannelRoutingEntry[]
}

export interface SurfaceFactorizationEvidence {
  model: 'selected-intrinsic-static-shade-floor-v1'
  shadeValue: number
  shadeColor: [number, number, number, number]
  proofHash: string
  baseColorFactor: [number, number, number]
  emissiveFactor: [number, number, number]
  textureOwnership: 'sharedBaseAndEmissive'
  exactTerms: ['selectedIntrinsic', 'staticShadeFloor']
  approximateTerms: ['shaderToRgbDirectResponseAsMetallicRoughness']
}

export interface SharedTextureNormalizationEvidence {
  model: 'stock-gltf-shared-texture-v1'
  baseTextureIndex: number
  exporterEmissiveTextureIndex: number
  duplicateTextureRecordRetained: boolean
}

export interface MaterialCompilationEvidence {
  schemaVersion: 1
  /**
   * Absent on legacy schema-1 producer output, whose UV proof covered only
   * the distinct numeric set and whose binding proof stopped at Mesh
   * ownership. Current output names the stronger, additive contract.
   */
  attestationModel?: 'primitive-corner-v1'
  sourceFingerprint: string
  loweredMaterials: string[]
  generatedMaterials: string[]
  gltfEvidence: Array<{
    sourceMaterial: string
    generatedMaterial: string
    transport: 'factor' | 'vertexColor' | 'image' | 'channels'
    /** MTL-BAKE-001 per-channel carrier evidence for `channels` transport:
     * every planned baked texture slot with its exact embedded bytes,
     * dimensions, texCoord, and wrap contract. */
    materialBake?: {
      channels?: unknown
      gates?: unknown
      textures?: Partial<Record<'baseColor' | 'orm' | 'normal' | 'emissive', {
        textureIndex: number
        imageSha256: string
        imageMime: 'image/png' | 'image/jpeg'
        imageWidth: number
        imageHeight: number
        texCoord: number
        wrap: number
        emissiveStrength?: number
      }>>
      uvEvidence?: unknown
    }
    surfaceResponse?: 'lit' | 'unlit'
    unlit: boolean
    metallicFactor?: number
    roughnessFactor?: number
    primitiveCount: number
    color0?: boolean
    color0Type?: 'VEC3' | 'VEC4'
    color0Min?: number[]
    color0Max?: number[]
    color0Tolerance?: number
    imageSha256?: string
    imageMime?: 'image/png' | 'image/jpeg'
    imageWidth?: number
    imageHeight?: number
    sampler?: {
      magFilter: number
      minFilter: number
      wrapS: number
      wrapT: number
    }
    texCoord?: number
    uvHash?: string
    uvDistinctValues?: number
    uvMin?: [number, number]
    uvMax?: [number, number]
    /**
     * Exact emitted primitive references for every source Object[slot]
     * binding. Primitive ordinals are observed from Blender's GLB; they are
     * never inferred from the Blender slot number.
     */
    bindingPrimitives?: Array<{
      binding: string
      occurrences: Array<{
        mesh: number
        primitives: number[]
      }>
    }>
    /**
     * Geometry-associated, rendered-triangle UV evidence. The source
     * position grid is persisted so the same codes survive glTF-Transform's
     * optional 14-bit mesh-volume POSITION quantization.
     */
    uvGeometryAssociation?: {
      algorithm: 'mesh-position14-uv-triangles-v1'
      hash: string
      triangleCount: number
      positionGrids: Array<{
        mesh: number
        bits: 14
        offset: [number, number, number]
        scale: number
      }>
    }
    surfaceFactorization?: SurfaceFactorizationEvidence
    textureNormalization?: SharedTextureNormalizationEvidence
    /** Blender-export indices are diagnostic provenance only. Final
     * glTF-Transform verification proves shared Texture object identity. */
    sharedTextureIndex?: number
    emissiveFactor?: [number, number, number]
    emissiveImageSha256?: string
    emissiveImageMime?: 'image/png' | 'image/jpeg'
    emissiveImageWidth?: number
    emissiveImageHeight?: number
    emissiveSampler?: {
      magFilter: number
      minFilter: number
      wrapS: number
      wrapT: number
    }
    emissiveTexCoord?: number
    emissiveUvHash?: string
    emissiveUvDistinctValues?: number
    emissiveUvMin?: [number, number]
    emissiveUvMax?: [number, number]
    emissiveUvGeometryAssociation?: {
      algorithm: 'mesh-position14-uv-triangles-v1'
      hash: string
      triangleCount: number
      positionGrids: Array<{
        mesh: number
        bits: 14
        offset: [number, number, number]
        scale: number
      }>
    }
    alphaMode?: 'OPAQUE' | 'MASK' | 'BLEND'
    baseColorFactor: [number, number, number, number]
    doubleSided: boolean
    bindings: string[]
    materialization?: 'cyclesEmit'
    materializationEvidence?: {
      coveredFraction: number
      rgbMin: [number, number, number]
      rgbMax: [number, number, number]
      deviceClass: 'cpu' | 'gpu'
      backend: string
      measurementModel?: 'selected-field-density-v1'
      resolutionPolicy: 'fallback-no-camera' | 'projected-camera-coverage'
      sourceUnitSystem?: 'NONE' | 'METRIC' | 'IMPERIAL'
      sourceMetersPerBlenderUnit?: number | null
      sourceWorldAreaBlenderUnitsSquared?: number
      sourceWorldAreaSquareMeters?: number | null
      projectionMetric?: 'clipped-triangle-area-sum-capped-to-viewport'
      cameraScope?: 'all-scene-perspective-orthographic-cameras'
      cameraSelection?: 'maximum-projected-triangle-area-sum'
      selectedCameraName?: string | null
      selectedCameraStableId?: string | null
      eligibleCameraCount?: number
      projectingCameraCount?: number
      /** @deprecated Unused schema-1 placeholder. */
      targetPxPerMeter: number | null
      /** @deprecated Alias of projectedTriangleAreaSumPixelAreaCapped. */
      targetProjectedPixels: number | null
      /** @deprecated Alias of projectedTriangleAreaSumFractionCapped. */
      projectedCoverageFraction: number | null
      projectedTriangleAreaSumPixelAreaCapped?: number | null
      projectedTriangleAreaSumFractionCapped?: number | null
      /** @deprecated Alias of achievedTexelsPerBlenderUnit. */
      achievedPxPerMeter: number
      /** @deprecated Alias of allocatedBindingTexelArea. */
      achievedProjectedPixels: number
      achievedTexelsPerBlenderUnit?: number
      achievedTexelsPerSourceMeter?: number | null
      allocatedBindingTexelArea?: number
      resolution: number
      minimumCandidateResolution: number
      densityRatio: number | null
      densityMet: boolean
      uvStrategy:
        | 'authored-atlas'
        | 'active-render-copy'
        | 'active-render-copy+local-degenerate-rescue'
        | 'active-edit-copy'
        | 'active-edit-copy+local-degenerate-rescue'
        | 'first-layer-copy'
        | 'first-layer-copy+local-degenerate-rescue'
        | 'ambiguous-render-fallback'
        | 'ambiguous-render-fallback+local-degenerate-rescue'
        | 'smart-project-fallback'
        | 'smart-project-fallback+lightmap-rescue'
      /**
       * Origin of the complete private UV candidate before bounded evaluated
       * or post-pack repairs. Absent on older schema-1 producer output.
       */
      uvGenerationSpace?:
        | 'artist-authored'
        | 'source-uv'
        | 'world-linear-private-proxy'
      sourceUvName: string
      sourceLayoutIssues: string[]
      sourceRescuePolygonCount: number
      sourceRescueAttemptedPolygonCount: number
      /** Bounded UV repair transactions after the initial candidate layout. */
      repairCount?: number
      /** Exact repair strategies; absent on older schema-1 producer output. */
      uvRepairStrategies?: Array<
        | 'smart-project-whole-unpinned-object'
        | 'smart-project-whole-unpinned-object+planar-polygon-rescue'
        /** The projection still self-overlapped, so the layout became
         * per-face lightmap charts — injective, but one seam per edge. */
        | 'smart-project-whole-unpinned-object+lightmap-rescue'
        | 'smart-project-whole-unpinned-object+planar-polygon-rescue+lightmap-rescue'
        | 'sampleable-regular-polygon-rescue'
      >
      ignoredZeroAreaTriangles: number
      zeroWorldAreaTriangleCount: number
      uvArea: number
      margin: number
    }
  }>
}

export interface BlenderSceneDiagnostics {
  procedural: ProceduralDiagnostic[]
  instances: InstanceSourceDiagnostic[]
  materials?: MaterialPortabilityDiagnostic[]
  materialCompilation?: MaterialCompilationEvidence
  /** GEO-EVAL-001: budgeted evaluated-geometry realizations (Grease Pencil,
   * Hair Curves, childless legacy HAIR/PATH particle parents) and the
   * refusals that exceeded the deterministic triangle budget. */
  realizedGeometry?: {
    budgetTriangles: number
    profileSides: number
    realize: Array<Record<string, unknown> & {
      object: string
      kind: 'hairCurves' | 'greasePencil' | 'particleStrands'
      estimatedTriangles: number
      realizedNode?: string
      realizedTriangles?: number
    }>
    refuse: Array<Record<string, unknown> & { object: string }>
  }
  /** Meshes that publish one frozen pose of a deformer that keeps moving.
   * Blender's glTF exporter mutes ARMATURE modifiers and nothing else before
   * it evaluates the mesh, so an unskinned mesh whose deformer input is
   * animated ships a single snapshot forever. Decided with no depsgraph
   * evaluation: presence means the contribution provably varies, never by how
   * much. An empty array is the positive evidence that the check ran. */
  frozenDeformers?: Array<Record<string, unknown> & {
    code: 'geometry.frozen-deformer-no-armature'
    object: string
    objectId?: string
    modifiers: Array<Record<string, unknown> & {
      name: string
      type: string
      timeSource: string
    }>
    frameRange: [number, number]
    reason: string
  }>
  /** Phase 0c: shape-key transport per shape-keyed mesh. Additive; absent from
   * sidecars written before the addon reported it. */
  shapeKeys?: ShapeKeyTransportDiagnostic[]
  /** Phase 0d: ARMATURE options glTF cannot carry. Additive. */
  skinApproximation?: SkinApproximationDiagnostic[]
  limits: { maxAuditFrames: number; maxMorphCacheBytes: number }
}

export interface LodLevelDiagnostic {
  index: number
  node: string
  /** Name after GLTFLoader's documented sanitization. */
  loadedName: string
  id?: string
  distance: number | null
  drawCalls: number
}

export interface LodChainDiagnostic {
  base: string
  valid: boolean
  levels: LodLevelDiagnostic[]
  /** Cost if no adapter hides inactive levels. */
  drawCallsWithoutAdapter: number
  /** Worst-case cost while exactly one level is active. */
  drawCallsWithAdapter: number
  warnings: string[]
}

export interface GpuInstanceBatchDiagnostic {
  node: string
  instances: number
  drawCalls: number
  semantics: string[]
}

export interface SceneDiagnostics {
  lod: {
    chains: LodChainDiagnostic[]
    validChains: number
    drawCallsWithoutAdapter: number
    drawCallsWithAdapter: number
  }
  instances: {
    groups: InstanceSourceDiagnostic[]
    gpuBatches: GpuInstanceBatchDiagnostic[]
    eligibleGroups: number
    estimatedDrawCallsCurrent: number
    estimatedDrawCallsIfEligibleBatched: number
    estimatedDrawCallsSaved: number
  }
  procedural: {
    objects: ProceduralDiagnostic[]
    blockers: number
    topologyChanging: number
    cacheCandidates: number
  }
  /** Phase 0a. Meshes publishing one frozen pose of a moving deformer.
   * Absent on manifests compiled before the check existed; `objects: []`
   * is the positive evidence that it ran and found nothing. */
  frozenDeformers?: {
    objects: BlenderSceneDiagnostics['frozenDeformers']
    blockers: number
  }
  /** Additive schema-v3 evidence; absent on manifests compiled before the
   * material portability audit was persisted. */
  materials?: {
    records: MaterialPortabilityDiagnostic[]
    exact: number
    approximated: number
    needsBake: number
    cyclesAppearanceBlocked: number
  }
  /** Finished-GLB evidence emitted only after every generated material passes
   * the compiler's unlit/COLOR_0/alpha attestation. */
  materialCompilation?: MaterialCompilationEvidence
  /** Phase 0c. Absent — not empty — when the sidecar predates the diagnostic,
   * so a missing section can never be read as "nothing was lost". */
  shapeKeys?: {
    objects: ShapeKeyTransportDiagnostic[]
    dropped: number
    basisSourced: number
    warnings: string[]
    refusals: string[]
  }
  /** Phase 0d. Same absent-vs-empty rule. */
  skinApproximation?: {
    objects: SkinApproximationDiagnostic[]
    preserveVolume: number
    boneEnvelopes: number
    warnings: string[]
  }
  /** Final-GLB projection evidence for an explicitly authored presentation
   * camera. Fit modes and perspective cameras do not use this diagnostic. */
  camera?: {
    authoredOrthographicAspect: AuthoredOrthographicAspectEvidence
  }
}

export interface CameraCompositionAspectEvidence {
  name: string
  width: number
  height: number
  aspect: number
  relativeDifference: number
}

export interface AuthoredOrthographicAspectEvidence {
  code: 'camera.authored-orthographic-aspect'
  cameraObjectId: string
  cameraObjectName: string
  xmag: number
  ymag: number
  exportedAspect: number
  relativeTolerance: number
  compositions: CameraCompositionAspectEvidence[]
  matchedComposition?: string
  /** Present only when no explicitly named composition matches the exact
   * projection carried by the final GLB. */
  warning?: string
}

function roundedAspect(value: number): number {
  return Math.round(value * 1e6) / 1e6
}

function aspectLabel(value: number): string {
  return `${value.toFixed(4)}:1`
}

/** Compare the exact camera projection published in the final GLB with the
 * composition frames that the artist explicitly named in the scene recipe.
 *
 * Khronos defines xmag and ymag as half the orthographic view width and
 * height, so xmag / ymag is the exported composition aspect. Blender's glTF
 * exporter derives that pair from Output resolution and pixel aspect. Doing
 * this after all compiler transforms makes the warning describe shipped
 * bytes rather than Blender-side intent inferred before export. */
export function compileAuthoredOrthographicAspectEvidence(
  document: Document,
  recipe?: PresentationCameraRecipe,
): AuthoredOrthographicAspectEvidence | undefined {
  if (!recipe || recipe.framing !== 'authored') return undefined

  const matches = document.getRoot().listNodes().filter((node) =>
    node.getExtras()?.blendlink_id === recipe.objectId)
  if (matches.length !== 1) return undefined
  const camera = matches[0]!.getCamera()
  if (!camera || camera.getType() !== 'orthographic') return undefined

  const xmag = camera.getXMag()
  const ymag = camera.getYMag()
  if (!Number.isFinite(xmag) || !Number.isFinite(ymag) || xmag <= 0 || ymag <= 0) {
    throw new Error(
      `Cannot verify authored orthographic camera "${recipe.objectName}": ` +
        `the final GLB has invalid xmag/ymag ${xmag}/${ymag}.`,
    )
  }
  const exportedAspect = xmag / ymag
  const compositions = recipe.compositions.map((composition): CameraCompositionAspectEvidence => {
    const aspect = composition.width / composition.height
    return {
      name: composition.name,
      width: composition.width,
      height: composition.height,
      aspect: roundedAspect(aspect),
      relativeDifference: roundedAspect(Math.abs(exportedAspect / aspect - 1)),
    }
  })
  const matchedIndex = recipe.compositions.findIndex((composition) =>
    Math.abs(exportedAspect / (composition.width / composition.height) - 1)
      <= CAMERA_ASPECT_RELATIVE_TOLERANCE)
  const matched = matchedIndex >= 0 ? compositions[matchedIndex] : undefined
  const declared = compositions.map((composition) =>
    `${JSON.stringify(composition.name)} ${composition.width}x${composition.height} ` +
      `(${aspectLabel(composition.aspect)})`).join(', ')
  const warning = matched
    ? undefined
    : `AUTHORED orthographic camera ${JSON.stringify(recipe.objectName)} was exported at ` +
      `${aspectLabel(exportedAspect)} (xmag ${xmag.toFixed(4)}, ymag ${ymag.toFixed(4)}), ` +
      `but no named camera composition matches. Declared: ${declared || '(none)'}. ` +
      'Blender glTF orthographic framing follows Output resolution and pixel aspect. ' +
      'Set Output to one intended composition before export, or update Camera Framing if ' +
      'website-owned fitting is intentional; otherwise browser resizing changes horizontal ' +
      'coverage and Blender reference images will not compare 1:1.'

  return {
    code: 'camera.authored-orthographic-aspect',
    cameraObjectId: recipe.objectId,
    cameraObjectName: recipe.objectName,
    xmag: roundedAspect(xmag),
    ymag: roundedAspect(ymag),
    exportedAspect: roundedAspect(exportedAspect),
    relativeTolerance: CAMERA_ASPECT_RELATIVE_TOLERANCE,
    compositions,
    ...(matched ? { matchedComposition: matched.name } : {}),
    ...(warning ? { warning } : {}),
  }
}

function meshDrawCalls(mesh: Mesh | null): number {
  return mesh?.listPrimitives().length ?? 0
}

function sourceNodeByName(document: Document): Map<string, Node> {
  return new Map(document.getRoot().listNodes().map((node) => [node.getName(), node]))
}

function compileLods(
  document: Document,
  vocabulary: Vocabulary,
  loadedNames: Map<Node, string>,
): SceneDiagnostics['lod'] {
  const nodes = sourceNodeByName(document)
  const chains = vocabulary.lods.map((chain): LodChainDiagnostic => {
    const warnings: string[] = []
    const levels = [...chain.levels]
      .sort((a, b) => a.index - b.index)
      .map((level): LodLevelDiagnostic => {
        const node = nodes.get(level.node)
        if (!node) warnings.push(`${level.node} is not present in the exported GLB`)
        const extras = node?.getExtras()
        const id = typeof extras?.blendlink_id === 'string' ? extras.blendlink_id : undefined
        return {
          index: level.index,
          node: level.node,
          loadedName: node ? (loadedNames.get(node) ?? '') : '',
          ...(id ? { id } : {}),
          // LOD0 is always the near level. An old/manual custom property on
          // it must not shift every later threshold or change runtime math.
          distance: level.index === 0 ? 0 : (level.distance ?? null),
          drawCalls: meshDrawCalls(node?.getMesh() ?? null),
        }
      })

    if (!levels.length || levels[0]!.index !== 0) warnings.push('LOD0 is required as the near level')
    const indices = levels.map((level) => level.index)
    if (indices.some((index, position) => index !== position)) {
      warnings.push(`levels must be contiguous from LOD0; found [${indices.join(', ')}]`)
    }
    let previous = -Infinity
    for (const level of levels) {
      if (level.distance === null) {
        warnings.push(`${level.node} needs a positive switch distance`)
        continue
      }
      if (level.index > 0 && level.distance <= 0) {
        warnings.push(`${level.node} switch distance must be greater than 0`)
      }
      if (level.distance <= previous) {
        warnings.push(`${level.node} switch distance must be greater than the preceding level`)
      }
      previous = level.distance
    }

    // LOD meshes are authored as peers. A divergent origin causes a visible
    // jump when the runtime helper switches them, even if thresholds are valid.
    const translations = levels
      .map((level) => nodes.get(level.node)?.getWorldTranslation())
      .filter((value): value is NonNullable<typeof value> => Boolean(value))
    if (translations.length > 1) {
      const origin = translations[0]!
      const divergent = translations.some((value) =>
        Math.hypot(value[0] - origin[0], value[1] - origin[1], value[2] - origin[2]) > 1e-4,
      )
      if (divergent) warnings.push('level origins differ; switching will visibly jump')
    }

    return {
      base: chain.base,
      valid: warnings.length === 0,
      levels,
      drawCallsWithoutAdapter: levels.reduce((sum, level) => sum + level.drawCalls, 0),
      drawCallsWithAdapter: Math.max(0, ...levels.map((level) => level.drawCalls)),
      warnings,
    }
  })
  return {
    chains,
    validChains: chains.filter((chain) => chain.valid).length,
    drawCallsWithoutAdapter: chains.reduce((sum, chain) => sum + chain.drawCallsWithoutAdapter, 0),
    drawCallsWithAdapter: chains.reduce((sum, chain) => sum + chain.drawCallsWithAdapter, 0),
  }
}

function compileGpuBatches(
  document: Document,
  loadedNames: Map<Node, string>,
): GpuInstanceBatchDiagnostic[] {
  const batches: GpuInstanceBatchDiagnostic[] = []
  for (const node of document.getRoot().listNodes()) {
    const extension = node.getExtension<InstancedMesh>('EXT_mesh_gpu_instancing')
    if (!extension) continue
    const attributes = extension.listAttributes()
    const instances = attributes[0]?.getCount() ?? 0
    batches.push({
      node: loadedNames.get(node) ?? '',
      instances,
      drawCalls: meshDrawCalls(node.getMesh()),
      semantics: extension.listSemantics(),
    })
  }
  return batches
}

function materialEvidenceFailure(source: string, detail: string): never {
  throw new Error(
    `Blendlink refused the final GLB because selected Website Material "${source}" ` +
    `${detail} Re-run Preview; if this persists, disable the changing optimizer stage ` +
    'and report the compiler mismatch.',
  )
}

function closeFactor(
  actual: readonly number[],
  expected: readonly number[],
  tolerance = 1e-6,
): boolean {
  return actual.length === expected.length
    && actual.every((value, index) => Math.abs(value - expected[index]!) <= tolerance)
}

interface Vec2Evidence {
  hash: string
  distinctValues: number
  min: [number, number]
  max: [number, number]
}

interface MaterialPrimitiveEntry {
  mesh: Mesh
  meshIndex: number
  primitive: Primitive
  primitiveIndex: number
}

type UvGeometryAssociation = NonNullable<
  MaterialCompilationEvidence['gltfEvidence'][number]['uvGeometryAssociation']
>

const UV_TRIANGLE_DIGEST_BYTES = 32
const UV_TRIANGLE_SORT_CHUNK_RECORDS = 65_536
const UV_TRIANGLE_DOMAIN = Buffer.from(
  'blendlink:uv-geometry-triangle:v1\0',
  'utf8',
)
const UV_ASSOCIATION_DOMAIN = Buffer.from(
  'blendlink:uv-geometry-association:v1\0',
  'utf8',
)

function vec2Evidence(accessors: Accessor[], sourceMaterial: string): Vec2Evidence {
  const distinct = new Map<string, [number, number]>()
  const element: number[] = []
  for (const accessor of accessors) {
    if (accessor.getType() !== 'VEC2') {
      materialEvidenceFailure(sourceMaterial, `changed an attested UV accessor to ${accessor.getType()}.`)
    }
    for (let index = 0; index < accessor.getCount(); index += 1) {
      accessor.getElement(index, element)
      const roundedU = Math.fround(element[0]!)
      const roundedV = Math.fround(element[1]!)
      const u = roundedU === 0 ? 0 : roundedU
      const v = roundedV === 0 ? 0 : roundedV
      if (!Number.isFinite(u) || !Number.isFinite(v)) {
        materialEvidenceFailure(sourceMaterial, 'contains a non-finite final UV value.')
      }
      distinct.set(`${u},${v}`, [u, v])
    }
  }
  const values = [...distinct.values()].sort((left, right) =>
    left[0] - right[0] || left[1] - right[1])
  if (!values.length) materialEvidenceFailure(sourceMaterial, 'lost every attested UV value.')
  const bytes = Buffer.alloc(values.length * 8)
  const minimum: [number, number] = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY]
  const maximum: [number, number] = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY]
  values.forEach((value, index) => {
    bytes.writeFloatLE(value[0], index * 8)
    bytes.writeFloatLE(value[1], index * 8 + 4)
    minimum[0] = Math.min(minimum[0], value[0])
    minimum[1] = Math.min(minimum[1], value[1])
    maximum[0] = Math.max(maximum[0], value[0])
    maximum[1] = Math.max(maximum[1], value[1])
  })
  return {
    hash: createHash('sha256').update(bytes).digest('hex'),
    distinctValues: values.length,
    min: minimum,
    max: maximum,
  }
}

interface DigestCursor {
  fd: number
  digest: Buffer
}

function pushDigestCursor(heap: DigestCursor[], cursor: DigestCursor): void {
  heap.push(cursor)
  let index = heap.length - 1
  while (index > 0) {
    const parent = Math.floor((index - 1) / 2)
    if (Buffer.compare(heap[parent]!.digest, cursor.digest) <= 0) break
    heap[index] = heap[parent]!
    index = parent
  }
  heap[index] = cursor
}

function popDigestCursor(heap: DigestCursor[]): DigestCursor {
  const first = heap[0]!
  const tail = heap.pop()!
  if (heap.length === 0) return first
  let index = 0
  while (true) {
    const left = index * 2 + 1
    if (left >= heap.length) break
    const right = left + 1
    const child = right < heap.length
        && Buffer.compare(heap[right]!.digest, heap[left]!.digest) < 0
      ? right
      : left
    if (Buffer.compare(heap[child]!.digest, tail.digest) >= 0) break
    heap[index] = heap[child]!
    index = child
  }
  heap[index] = tail
  return first
}

/**
 * Hash a multiset of fixed SHA-256 records with bounded memory. Sorting the
 * 32-byte records preserves a normal cryptographic hash rather than replacing
 * it with a commutative XOR/sum accumulator that loses multiplicity or weakens
 * the attestation. Large receivers spill sorted runs into one owned temp
 * directory and merge them sequentially.
 */
function hashSortedTriangleDigests(
  digests: Iterable<Buffer>,
  associationHeader: Buffer,
): { hash: string; triangleCount: number } {
  let triangleCount = 0
  let chunk: Buffer[] = []
  let temporaryDirectory: string | undefined
  const chunkPaths: string[] = []
  const flushChunk = (): void => {
    if (chunk.length === 0) return
    temporaryDirectory ??= mkdtempSync(join(tmpdir(), 'blendlink-material-attestation-'))
    chunk.sort(Buffer.compare)
    const path = join(temporaryDirectory, `run-${chunkPaths.length}.bin`)
    writeFileSync(path, Buffer.concat(chunk))
    chunkPaths.push(path)
    chunk = []
  }

  try {
    for (const digest of digests) {
      if (digest.byteLength !== UV_TRIANGLE_DIGEST_BYTES) {
        throw new Error(`UV triangle digest has ${digest.byteLength} bytes; expected 32.`)
      }
      chunk.push(digest)
      triangleCount += 1
      if (chunk.length >= UV_TRIANGLE_SORT_CHUNK_RECORDS) flushChunk()
    }

    const hash = createHash('sha256')
      .update(UV_ASSOCIATION_DOMAIN)
      .update(associationHeader)
    const countBytes = Buffer.alloc(8)
    countBytes.writeBigUInt64LE(BigInt(triangleCount))
    hash.update(countBytes)

    if (chunkPaths.length === 0) {
      chunk.sort(Buffer.compare)
      for (const digest of chunk) hash.update(digest)
      return { hash: hash.digest('hex'), triangleCount }
    }

    flushChunk()
    const cursors: DigestCursor[] = []
    const openDescriptors: number[] = []
    try {
      for (const path of chunkPaths) {
        const fd = openSync(path, 'r')
        openDescriptors.push(fd)
        const cursor = { fd, digest: Buffer.allocUnsafe(UV_TRIANGLE_DIGEST_BYTES) }
        const bytes = readSync(fd, cursor.digest, 0, UV_TRIANGLE_DIGEST_BYTES, null)
        if (bytes !== UV_TRIANGLE_DIGEST_BYTES) {
          throw new Error(`Sorted UV attestation run ${path} is truncated.`)
        }
        pushDigestCursor(cursors, cursor)
      }
      while (cursors.length > 0) {
        const cursor = popDigestCursor(cursors)
        hash.update(cursor.digest)
        const bytes = readSync(
          cursor.fd,
          cursor.digest,
          0,
          UV_TRIANGLE_DIGEST_BYTES,
          null,
        )
        if (bytes === UV_TRIANGLE_DIGEST_BYTES) {
          pushDigestCursor(cursors, cursor)
        } else if (bytes !== 0) {
          throw new Error('Sorted UV attestation run ended with a partial digest.')
        }
      }
    } finally {
      for (const fd of openDescriptors) closeSync(fd)
    }
    return { hash: hash.digest('hex'), triangleCount }
  } finally {
    if (temporaryDirectory) {
      rmSync(temporaryDirectory, { recursive: true, force: true })
    }
  }
}

function compareTriangleRotations(
  record: Buffer,
  leftStart: number,
  rightStart: number,
): number {
  const cornerBytes = 14
  for (let offset = 0; offset < 3; offset += 1) {
    const left = ((leftStart + offset) % 3) * cornerBytes
    const right = ((rightStart + offset) % 3) * cornerBytes
    const comparison = Buffer.compare(
      record.subarray(left, left + cornerBytes),
      record.subarray(right, right + cornerBytes),
    )
    if (comparison !== 0) return comparison
  }
  return 0
}

function canonicalTriangleRotation(record: Buffer): Buffer {
  let start = 0
  if (compareTriangleRotations(record, 1, start) < 0) start = 1
  if (compareTriangleRotations(record, 2, start) < 0) start = 2
  if (start === 0) return record
  const result = Buffer.allocUnsafe(record.byteLength)
  const cornerBytes = 14
  for (let offset = 0; offset < 3; offset += 1) {
    const source = ((start + offset) % 3) * cornerBytes
    record.copy(result, offset * cornerBytes, source, source + cornerBytes)
  }
  return result
}

function canonicalPositionCode(value: number): number {
  const clamped = Math.min(1, Math.max(-1, value))
  const magnitude = Math.floor(Math.abs(clamped) * 8_191 + 0.5)
  return clamped < 0 ? -magnitude : magnitude
}

function* uvGeometryTriangleDigests(
  entries: MaterialPrimitiveEntry[],
  texCoord: number,
  association: UvGeometryAssociation,
  sourceMaterial: string,
): Generator<Buffer> {
  const grids = new Map(association.positionGrids.map((grid) => [grid.mesh, grid]))
  if (grids.size !== association.positionGrids.length) {
    materialEvidenceFailure(sourceMaterial, 'contains duplicate position-grid evidence.')
  }
  for (const grid of grids.values()) {
    if (grid.bits !== 14
        || grid.offset.length !== 3
        || grid.offset.some((value) => !Number.isFinite(value))
        || !Number.isFinite(grid.scale)
        || grid.scale < 0) {
      materialEvidenceFailure(sourceMaterial, 'contains malformed position-grid evidence.')
    }
  }

  for (const { meshIndex, primitiveIndex, primitive } of entries) {
    if (primitive.getMode() !== 4) {
      materialEvidenceFailure(
        sourceMaterial,
        `changed generated primitive ${meshIndex}:${primitiveIndex} from TRIANGLES mode.`,
      )
    }
    const grid = grids.get(meshIndex)
    if (!grid) {
      materialEvidenceFailure(
        sourceMaterial,
        `has no source position grid for generated mesh ${meshIndex}.`,
      )
    }
    const position = primitive.getAttribute('POSITION')
    const uv = primitive.getAttribute(`TEXCOORD_${texCoord}`)
    if (!position || !uv || uv.getCount() !== position.getCount()) {
      materialEvidenceFailure(
        sourceMaterial,
        `has missing or count-mismatched final TEXCOORD_${texCoord} data.`,
      )
    }
    const componentType = position.getComponentType()
    const quantizedPosition = (
      componentType === Accessor.ComponentType.SHORT
      && position.getNormalized()
    )
    const floatPosition = (
      componentType === Accessor.ComponentType.FLOAT
      && !position.getNormalized()
    )
    if (!quantizedPosition && !floatPosition) {
      materialEvidenceFailure(
        sourceMaterial,
        `changed POSITION to unsupported component type ${componentType}/` +
        `normalized=${position.getNormalized()}.`,
      )
    }
    const indices = primitive.getIndices()?.getArray()
    const renderedCount = indices?.length ?? position.getCount()
    if (renderedCount === 0 || renderedCount % 3 !== 0) {
      materialEvidenceFailure(
        sourceMaterial,
        `has ${renderedCount} rendered corners instead of complete triangles.`,
      )
    }
    const header = Buffer.alloc(16)
    header.writeUInt32LE(meshIndex, 0)
    header.writeUInt32LE(primitiveIndex, 4)
    header.writeUInt32LE(primitive.getMode(), 8)
    header.writeUInt32LE(texCoord, 12)
    const positionElement: number[] = []
    const uvElement: number[] = []
    for (let triangle = 0; triangle < renderedCount; triangle += 3) {
      const record = Buffer.allocUnsafe(42)
      let byteOffset = 0
      for (let corner = 0; corner < 3; corner += 1) {
        const vertex = Number(indices?.[triangle + corner] ?? triangle + corner)
        if (!Number.isInteger(vertex) || vertex < 0 || vertex >= position.getCount()) {
          materialEvidenceFailure(
            sourceMaterial,
            `has an out-of-range rendered vertex ${vertex}.`,
          )
        }
        position.getElement(vertex, positionElement)
        uv.getElement(vertex, uvElement)
        for (let component = 0; component < 3; component += 1) {
          const source = positionElement[component]!
          if (!Number.isFinite(source)) {
            materialEvidenceFailure(sourceMaterial, 'contains a non-finite final POSITION value.')
          }
          const normalized = quantizedPosition
            ? source
            : grid.scale > 0
              ? (source - grid.offset[component]!) / grid.scale
              : 0
          record.writeInt16LE(canonicalPositionCode(normalized), byteOffset)
          byteOffset += 2
        }
        for (let component = 0; component < 2; component += 1) {
          const source = uvElement[component]!
          if (!Number.isFinite(source)) {
            materialEvidenceFailure(sourceMaterial, 'contains a non-finite final UV value.')
          }
          const rounded = Math.fround(source)
          record.writeFloatLE(rounded === 0 ? 0 : rounded, byteOffset)
          byteOffset += 4
        }
      }
      yield createHash('sha256')
        .update(UV_TRIANGLE_DOMAIN)
        .update(header)
        .update(canonicalTriangleRotation(record))
        .digest()
    }
  }
}

function uvGeometryAssociationEvidence(
  entries: MaterialPrimitiveEntry[],
  texCoord: number,
  association: UvGeometryAssociation,
  sourceMaterial: string,
): { hash: string; triangleCount: number } {
  if (association.algorithm !== 'mesh-position14-uv-triangles-v1') {
    materialEvidenceFailure(
      sourceMaterial,
      `uses unsupported UV geometry algorithm ${association.algorithm}.`,
    )
  }
  const grids = [...association.positionGrids].sort((left, right) =>
    left.mesh - right.mesh)
  const header = Buffer.alloc(8 + grids.length * 40)
  header.writeUInt32LE(texCoord, 0)
  header.writeUInt32LE(grids.length, 4)
  grids.forEach((grid, index) => {
    const offset = 8 + index * 40
    header.writeUInt32LE(grid.mesh, offset)
    header.writeDoubleLE(grid.offset[0], offset + 4)
    header.writeDoubleLE(grid.offset[1], offset + 12)
    header.writeDoubleLE(grid.offset[2], offset + 20)
    header.writeDoubleLE(grid.scale, offset + 28)
    header.writeUInt32LE(grid.bits, offset + 36)
  })
  try {
    return hashSortedTriangleDigests(
      uvGeometryTriangleDigests(entries, texCoord, association, sourceMaterial),
      header,
    )
  } catch (error) {
    if (error instanceof Error
        && error.message.startsWith('Blendlink refused the final GLB')) {
      throw error
    }
    materialEvidenceFailure(
      sourceMaterial,
      `could not verify its geometry-associated UV evidence: ` +
      `${error instanceof Error ? error.message : String(error)}.`,
    )
  }
}

/** Re-attest Python's stock-glTF material proof against the final Document.
 * This runs after resizing, KTX2, and optional Meshopt transforms, so evidence
 * in the manifest always describes the bytes that are actually published. */
export function verifyMaterialCompilationEvidence(
  document: Document,
  compilation: MaterialCompilationEvidence,
): void {
  if ((compilation as { schemaVersion?: unknown }).schemaVersion !== 1) {
    throw new Error(
      `Blendlink refused material compilation evidence schemaVersion ` +
      `${String((compilation as { schemaVersion?: unknown }).schemaVersion)} is unsupported; ` +
      'expected 1. Re-run Preview with this Blendlink version to regenerate the evidence.',
    )
  }
  if (compilation.attestationModel !== undefined
      && compilation.attestationModel !== 'primitive-corner-v1') {
    throw new Error(
      `Blendlink refused material compilation attestation model ` +
      `${String(compilation.attestationModel)}; expected primitive-corner-v1. ` +
      'Re-run Preview with this Blendlink version to regenerate the evidence.',
    )
  }
  const currentAttestation = compilation.attestationModel === 'primitive-corner-v1'
  const root = document.getRoot()
  const materials = root.listMaterials()
  const nodes = root.listNodes()
  const meshes = root.listMeshes()

  const privateSemantics = [...new Set(meshes.flatMap((mesh) =>
    mesh.listPrimitives().flatMap((primitive) =>
      primitive.listSemantics().filter((semantic) => semantic.startsWith('_BLENDLINK_WEB_')))))]
  if (privateSemantics.length) {
    materialEvidenceFailure(
      compilation.gltfEvidence[0]?.sourceMaterial ?? 'unknown',
      `leaked compiler-private attributes ${privateSemantics.join(', ')}.`,
    )
  }

  for (const evidence of compilation.gltfEvidence) {
    const matches = materials.filter((material) =>
      material.getName() === evidence.generatedMaterial)
    if (matches.length !== 1) {
      materialEvidenceFailure(
        evidence.sourceMaterial,
        `resolved to ${matches.length} generated materials after final transforms.`,
      )
    }
    if (materials.some((material) => material.getName() === evidence.sourceMaterial)) {
      materialEvidenceFailure(evidence.sourceMaterial, 'also shipped its source/fallback material.')
    }
    const material = matches[0] as Material
    const emittedUnlit = Boolean(material.getExtension('KHR_materials_unlit'))
    if (evidence.surfaceResponse !== undefined
        && (evidence.surfaceResponse === 'unlit') !== evidence.unlit) {
      materialEvidenceFailure(
        evidence.sourceMaterial,
        `contains contradictory surfaceResponse=${evidence.surfaceResponse} ` +
        `and unlit=${String(evidence.unlit)} evidence.`,
      )
    }
    if (emittedUnlit !== evidence.unlit) {
      materialEvidenceFailure(
        evidence.sourceMaterial,
        evidence.unlit
          ? 'lost KHR_materials_unlit.'
          : 'unexpectedly gained KHR_materials_unlit.',
      )
    }
    if (!evidence.unlit) {
      if (evidence.metallicFactor === undefined
          || evidence.roughnessFactor === undefined) {
        materialEvidenceFailure(
          evidence.sourceMaterial,
          'has lit surface evidence without metallicFactor and roughnessFactor.',
        )
      }
      if (Math.abs(material.getMetallicFactor() - evidence.metallicFactor) > 1e-6) {
        materialEvidenceFailure(
          evidence.sourceMaterial,
          `changed metallicFactor from ${evidence.metallicFactor} ` +
          `to ${material.getMetallicFactor()}.`,
        )
      }
      if (Math.abs(material.getRoughnessFactor() - evidence.roughnessFactor) > 1e-6) {
        materialEvidenceFailure(
          evidence.sourceMaterial,
          `changed roughnessFactor from ${evidence.roughnessFactor} ` +
          `to ${material.getRoughnessFactor()}.`,
        )
      }
    }
    if (!closeFactor(material.getBaseColorFactor(), evidence.baseColorFactor)) {
      materialEvidenceFailure(
        evidence.sourceMaterial,
        `changed baseColorFactor from [${evidence.baseColorFactor.join(', ')}] ` +
        `to [${material.getBaseColorFactor().join(', ')}].`,
      )
    }
    if (material.getAlphaMode() !== (evidence.alphaMode ?? 'OPAQUE')) {
      materialEvidenceFailure(
        evidence.sourceMaterial,
        `changed alphaMode from ${evidence.alphaMode ?? 'OPAQUE'} to ${material.getAlphaMode()}.`,
      )
    }
    if (material.getDoubleSided() !== evidence.doubleSided) {
      materialEvidenceFailure(evidence.sourceMaterial, 'changed its double-sided contract.')
    }

    const primitiveEntries: MaterialPrimitiveEntry[] = meshes.flatMap((mesh, meshIndex) =>
      mesh.listPrimitives().flatMap((primitive, primitiveIndex) =>
        primitive.getMaterial() === material
          ? [{ mesh, meshIndex, primitive, primitiveIndex }]
          : []))
    if (primitiveEntries.length !== evidence.primitiveCount) {
      materialEvidenceFailure(
        evidence.sourceMaterial,
        `changed generated primitive count from ${evidence.primitiveCount} ` +
        `to ${primitiveEntries.length}.`,
      )
    }
    const expectedMeshes = new Set<Mesh>()
    const bindingEvidence = evidence.bindingPrimitives ?? []
    const bindingEvidenceByName = new Map(
      bindingEvidence.map((item) => [item.binding, item]),
    )
    if (bindingEvidenceByName.size !== bindingEvidence.length) {
      materialEvidenceFailure(
        evidence.sourceMaterial,
        'contains duplicate Object[slot] primitive evidence.',
      )
    }
    if (currentAttestation && (
      bindingEvidence.length !== evidence.bindings.length
      || evidence.bindings.some((binding) => !bindingEvidenceByName.has(binding))
      || bindingEvidence.some((item) => !evidence.bindings.includes(item.binding))
    )) {
      materialEvidenceFailure(
        evidence.sourceMaterial,
        'has incomplete Object[slot] primitive evidence.',
      )
    }
    for (const binding of evidence.bindings) {
      const parsed = /^(.*)\[(\d+)\]$/u.exec(binding)
      if (!parsed) {
        materialEvidenceFailure(evidence.sourceMaterial, `has invalid binding evidence ${binding}.`)
      }
      const objectName = parsed[1]!
      const occurrences = nodes.filter((node) =>
        node.getName() === objectName && node.getMesh() !== null)
      if (!occurrences.length) {
        materialEvidenceFailure(evidence.sourceMaterial, `lost binding occurrence ${binding}.`)
      }
      const expectedBinding = bindingEvidenceByName.get(binding)
      const actualBindingOccurrences: Array<{ mesh: number; primitives: number[] }> = []
      for (const occurrence of occurrences) {
        const mesh = occurrence.getMesh() as Mesh
        expectedMeshes.add(mesh)
        const meshIndex = meshes.indexOf(mesh)
        const primitives = mesh.listPrimitives()
          .map((primitive, index) => primitive.getMaterial() === material ? index : -1)
          .filter((index) => index >= 0)
        actualBindingOccurrences.push({ mesh: meshIndex, primitives })
        if (!primitives.length) {
          materialEvidenceFailure(
            evidence.sourceMaterial,
            `binding occurrence ${binding} no longer uses the generated material.`,
          )
        }
      }
      if (currentAttestation) {
        if (!expectedBinding) {
          materialEvidenceFailure(
            evidence.sourceMaterial,
            `has no emitted primitive evidence for binding occurrence ${binding}.`,
          )
        }
        const normalizeOccurrences = (
          items: Array<{ mesh: number; primitives: number[] }>,
        ): Array<{ mesh: number; primitives: number[] }> => items.map((item) => ({
          mesh: item.mesh,
          primitives: [...item.primitives].sort((left, right) => left - right),
        })).sort((left, right) => {
          if (left.mesh !== right.mesh) return left.mesh - right.mesh
          if (left.primitives.length !== right.primitives.length) {
            return left.primitives.length - right.primitives.length
          }
          for (let index = 0; index < left.primitives.length; index += 1) {
            if (left.primitives[index] !== right.primitives[index]) {
              return left.primitives[index]! - right.primitives[index]!
            }
          }
          return 0
        })
        const expected = normalizeOccurrences(expectedBinding.occurrences)
        const actual = normalizeOccurrences(actualBindingOccurrences)
        if (JSON.stringify(actual) !== JSON.stringify(expected)) {
          materialEvidenceFailure(
            evidence.sourceMaterial,
            `binding occurrence ${binding} changed emitted primitive ownership ` +
            `from ${JSON.stringify(expected)} to ${JSON.stringify(actual)}.`,
          )
        }
      }
    }
    const primitiveMeshes = new Set(primitiveEntries.map((entry) => entry.mesh))
    if (primitiveMeshes.size !== expectedMeshes.size
        || [...primitiveMeshes].some((mesh) => !expectedMeshes.has(mesh))) {
      materialEvidenceFailure(evidence.sourceMaterial, 'changed generated mesh ownership.')
    }

    const baseColorTexture = material.getBaseColorTexture()
    if (evidence.transport === 'image') {
      const textureInfo = material.getBaseColorTextureInfo()
      if (!baseColorTexture || !textureInfo) {
        materialEvidenceFailure(evidence.sourceMaterial, 'lost its selected base-color image.')
      }
      if (!evidence.imageSha256 || !evidence.imageMime
          || !evidence.imageWidth || !evidence.imageHeight
          || evidence.texCoord === undefined || !evidence.uvHash
          || evidence.uvDistinctValues === undefined
          || !evidence.uvMin || !evidence.uvMax || !evidence.sampler) {
        materialEvidenceFailure(evidence.sourceMaterial, 'has incomplete image/UV evidence.')
      }
      const image = baseColorTexture.getImage()
      const actualHash = image
        ? createHash('sha256').update(image).digest('hex')
        : null
      if (actualHash !== evidence.imageSha256
          || baseColorTexture.getMimeType() !== evidence.imageMime) {
        materialEvidenceFailure(
          evidence.sourceMaterial,
          `changed selected image bytes or MIME from ${evidence.imageMime}/${evidence.imageSha256} ` +
          `to ${baseColorTexture.getMimeType() || 'unknown'}/${actualHash || 'missing'}.`,
        )
      }
      const imageSize = baseColorTexture.getSize()
      if (!imageSize || imageSize[0] !== evidence.imageWidth || imageSize[1] !== evidence.imageHeight) {
        materialEvidenceFailure(
          evidence.sourceMaterial,
          `changed image dimensions from ${evidence.imageWidth}x${evidence.imageHeight} ` +
          `to ${imageSize ? `${imageSize[0]}x${imageSize[1]}` : 'unknown'}.`,
        )
      }
      const actualSampler = {
        magFilter: textureInfo.getMagFilter() ?? 9729,
        minFilter: textureInfo.getMinFilter() ?? 9987,
        wrapS: textureInfo.getWrapS(),
        wrapT: textureInfo.getWrapT(),
      }
      if (actualSampler.magFilter !== evidence.sampler.magFilter
          || actualSampler.minFilter !== evidence.sampler.minFilter
          || actualSampler.wrapS !== evidence.sampler.wrapS
          || actualSampler.wrapT !== evidence.sampler.wrapT) {
        materialEvidenceFailure(
          evidence.sourceMaterial,
          `changed image sampler from ${JSON.stringify(evidence.sampler)} ` +
          `to ${JSON.stringify(actualSampler)}.`,
        )
      }
      if (textureInfo.getTexCoord() !== evidence.texCoord) {
        materialEvidenceFailure(
          evidence.sourceMaterial,
          `changed image texCoord from ${evidence.texCoord} to ${textureInfo.getTexCoord()}.`,
        )
      }
      const uvAccessors: Accessor[] = []
      for (const { primitive } of primitiveEntries) {
        const uv = primitive.getAttribute(`TEXCOORD_${evidence.texCoord}`)
        const position = primitive.getAttribute('POSITION')
        if (!uv || !position || uv.getCount() !== position.getCount()) {
          materialEvidenceFailure(
            evidence.sourceMaterial,
            `has missing or count-mismatched final TEXCOORD_${evidence.texCoord} data.`,
          )
        }
        uvAccessors.push(uv)
      }
      if (currentAttestation) {
        if (!evidence.uvGeometryAssociation) {
          materialEvidenceFailure(
            evidence.sourceMaterial,
            'has no geometry-associated UV evidence.',
          )
        }
        const finalAssociation = uvGeometryAssociationEvidence(
          primitiveEntries,
          evidence.texCoord,
          evidence.uvGeometryAssociation,
          evidence.sourceMaterial,
        )
        if (finalAssociation.hash !== evidence.uvGeometryAssociation.hash
            || finalAssociation.triangleCount
              !== evidence.uvGeometryAssociation.triangleCount) {
          materialEvidenceFailure(
            evidence.sourceMaterial,
            `changed TEXCOORD_${evidence.texCoord} corner association after final transforms.`,
          )
        }
      } else {
        const finalUv = vec2Evidence(uvAccessors, evidence.sourceMaterial)
        if (finalUv.hash !== evidence.uvHash
            || finalUv.distinctValues !== evidence.uvDistinctValues
            || !closeFactor(finalUv.min, evidence.uvMin, 1e-7)
            || !closeFactor(finalUv.max, evidence.uvMax, 1e-7)) {
          materialEvidenceFailure(
            evidence.sourceMaterial,
            `changed TEXCOORD_${evidence.texCoord} numeric evidence after final transforms.`,
          )
        }
      }
    } else if (evidence.transport === 'channels') {
      // MTL-BAKE-001 carriers: every texture slot must match its planned
      // bake exactly — bytes, dimensions, texCoord, and wrap — and no
      // unplanned slot may ship. The Python compiler attested the same
      // contract pre-optimization; this re-proves it after final
      // transforms.
      const bakeTextures = evidence.materialBake?.textures
      if (!bakeTextures) {
        materialEvidenceFailure(
          evidence.sourceMaterial,
          'has channels transport without material-bake texture evidence.',
        )
      }
      const slots = [
        {
          kind: 'baseColor' as const,
          texture: baseColorTexture,
          info: material.getBaseColorTextureInfo(),
        },
        {
          kind: 'orm' as const,
          texture: material.getMetallicRoughnessTexture(),
          info: material.getMetallicRoughnessTextureInfo(),
        },
        {
          kind: 'normal' as const,
          texture: material.getNormalTexture(),
          info: material.getNormalTextureInfo(),
        },
        {
          kind: 'emissive' as const,
          texture: material.getEmissiveTexture(),
          info: material.getEmissiveTextureInfo(),
        },
      ]
      for (const { kind, texture, info } of slots) {
        const planned = bakeTextures[kind]
        if (!planned) {
          if (texture) {
            materialEvidenceFailure(
              evidence.sourceMaterial,
              `gained an unplanned baked ${kind} texture.`,
            )
          }
          continue
        }
        if (!texture || !info) {
          materialEvidenceFailure(
            evidence.sourceMaterial,
            `lost its baked ${kind} texture.`,
          )
        }
        const image = texture.getImage()
        const actualHash = image
          ? createHash('sha256').update(image).digest('hex')
          : null
        if (actualHash !== planned.imageSha256
            || texture.getMimeType() !== planned.imageMime) {
          materialEvidenceFailure(
            evidence.sourceMaterial,
            `changed baked ${kind} image bytes or MIME from ` +
            `${planned.imageMime}/${planned.imageSha256} to ` +
            `${texture.getMimeType() || 'unknown'}/${actualHash || 'missing'}.`,
          )
        }
        const imageSize = texture.getSize()
        if (!imageSize || imageSize[0] !== planned.imageWidth
            || imageSize[1] !== planned.imageHeight) {
          materialEvidenceFailure(
            evidence.sourceMaterial,
            `changed baked ${kind} image dimensions from ` +
            `${planned.imageWidth}x${planned.imageHeight}.`,
          )
        }
        if (info.getTexCoord() !== planned.texCoord) {
          materialEvidenceFailure(
            evidence.sourceMaterial,
            `changed baked ${kind} texCoord from ${planned.texCoord} ` +
            `to ${info.getTexCoord()}.`,
          )
        }
        if (info.getWrapS() !== planned.wrap || info.getWrapT() !== planned.wrap) {
          materialEvidenceFailure(
            evidence.sourceMaterial,
            `changed baked ${kind} sampler wrap from ${planned.wrap} to ` +
            `${info.getWrapS()}/${info.getWrapT()}.`,
          )
        }
      }
    } else if (baseColorTexture) {
      materialEvidenceFailure(evidence.sourceMaterial, 'gained an unexpected base-color texture.')
    }

    if (evidence.surfaceFactorization) {
      const factorization = evidence.surfaceFactorization
      if (factorization.model !== 'selected-intrinsic-static-shade-floor-v1'
          || factorization.textureOwnership !== 'sharedBaseAndEmissive'
          || JSON.stringify(factorization.exactTerms)
            !== JSON.stringify(['selectedIntrinsic', 'staticShadeFloor'])
          || JSON.stringify(factorization.approximateTerms)
            !== JSON.stringify(['shaderToRgbDirectResponseAsMetallicRoughness'])) {
        materialEvidenceFailure(
          evidence.sourceMaterial,
          `contains unsupported static shade-floor proof ${factorization.model}.`,
        )
      }
      if (evidence.transport !== 'image' || evidence.unlit
          || evidence.textureNormalization?.model !== 'stock-gltf-shared-texture-v1'
          || !Number.isInteger(evidence.sharedTextureIndex)
          || !evidence.emissiveFactor || !evidence.emissiveImageSha256
          || !evidence.emissiveImageMime || !evidence.emissiveImageWidth
          || !evidence.emissiveImageHeight || !evidence.emissiveSampler
          || evidence.emissiveTexCoord === undefined || !evidence.emissiveUvHash
          || evidence.emissiveUvDistinctValues === undefined
          || !evidence.emissiveUvMin || !evidence.emissiveUvMax
          || !evidence.emissiveUvGeometryAssociation) {
        materialEvidenceFailure(
          evidence.sourceMaterial,
          'has incomplete shared Base Color/Emission factorization evidence.',
        )
      }
      if (!closeFactor(
        evidence.baseColorFactor.slice(0, 3),
        factorization.baseColorFactor,
        1e-6,
      ) || !closeFactor(evidence.emissiveFactor, factorization.emissiveFactor, 1e-6)) {
        materialEvidenceFailure(
          evidence.sourceMaterial,
          'has contradictory static shade-floor factor evidence.',
        )
      }
      if (evidence.imageSha256 !== evidence.emissiveImageSha256
          || evidence.imageMime !== evidence.emissiveImageMime
          || evidence.imageWidth !== evidence.emissiveImageWidth
          || evidence.imageHeight !== evidence.emissiveImageHeight
          || evidence.texCoord !== evidence.emissiveTexCoord
          || evidence.uvHash !== evidence.emissiveUvHash
          || JSON.stringify(evidence.sampler) !== JSON.stringify(evidence.emissiveSampler)
          || evidence.uvGeometryAssociation?.hash
            !== evidence.emissiveUvGeometryAssociation.hash
          || evidence.uvGeometryAssociation?.triangleCount
            !== evidence.emissiveUvGeometryAssociation.triangleCount) {
        materialEvidenceFailure(
          evidence.sourceMaterial,
          'does not prove one identical selected-intrinsic image, sampler, and UV field.',
        )
      }
      const emissiveTexture = material.getEmissiveTexture()
      const emissiveInfo = material.getEmissiveTextureInfo()
      if (!baseColorTexture || !emissiveTexture || !emissiveInfo
          || emissiveTexture !== baseColorTexture) {
        materialEvidenceFailure(
          evidence.sourceMaterial,
          'no longer shares one Texture object between Base Color and Emission.',
        )
      }
      if (material.listExtensions().length || emissiveInfo.listExtensions().length
          || material.getBaseColorTextureInfo()!.listExtensions().length) {
        materialEvidenceFailure(
          evidence.sourceMaterial,
          'gained a material or TextureInfo extension outside the stock carrier proof.',
        )
      }
      if (!closeFactor(material.getEmissiveFactor(), evidence.emissiveFactor, 1e-6)) {
        materialEvidenceFailure(
          evidence.sourceMaterial,
          `changed emissiveFactor from [${evidence.emissiveFactor.join(', ')}] ` +
          `to [${material.getEmissiveFactor().join(', ')}].`,
        )
      }
      const finalEmissiveSampler = {
        magFilter: emissiveInfo.getMagFilter() ?? 9729,
        minFilter: emissiveInfo.getMinFilter() ?? 9987,
        wrapS: emissiveInfo.getWrapS(),
        wrapT: emissiveInfo.getWrapT(),
      }
      if (JSON.stringify(finalEmissiveSampler) !== JSON.stringify(evidence.emissiveSampler)
          || emissiveInfo.getTexCoord() !== evidence.emissiveTexCoord) {
        materialEvidenceFailure(
          evidence.sourceMaterial,
          'changed the shared Emission sampler or texCoord after final transforms.',
        )
      }
    } else if (
      // The channels branch above owns emissive-slot verification for
      // MTL-BAKE-001 carriers (planned bake or refused-unplanned).
      evidence.transport !== 'channels'
      && material.getEmissiveTexture()
    ) {
      materialEvidenceFailure(
        evidence.sourceMaterial,
        'gained an unexpected emissive texture.',
      )
    }

    const hasColor0 = primitiveEntries.every(({ primitive }) =>
      primitive.getAttribute('COLOR_0') !== null)
    const expectedColor0 = evidence.color0 ?? evidence.transport === 'vertexColor'
    if (hasColor0 !== expectedColor0) {
      materialEvidenceFailure(evidence.sourceMaterial, 'changed COLOR_0 presence.')
    }
    if (evidence.transport === 'vertexColor') {
      const finalMin = evidence.color0Min?.map(() => Number.POSITIVE_INFINITY)
      const finalMax = evidence.color0Max?.map(() => Number.NEGATIVE_INFINITY)
      for (const { primitive } of primitiveEntries) {
        const color = primitive.getAttribute('COLOR_0')
        const position = primitive.getAttribute('POSITION')
        if (!color || !position || color.getCount() !== position.getCount()) {
          materialEvidenceFailure(
            evidence.sourceMaterial,
            'has missing or count-mismatched final COLOR_0 data.',
          )
        }
        if (evidence.color0Type && color.getType() !== evidence.color0Type) {
          materialEvidenceFailure(
            evidence.sourceMaterial,
            `changed COLOR_0 from ${evidence.color0Type} to ${color.getType()}.`,
          )
        }
        if (finalMin && finalMax) {
          if (color.getElementSize() !== finalMin.length) {
            materialEvidenceFailure(
              evidence.sourceMaterial,
              'changed final COLOR_0 component count.',
            )
          }
          const element: number[] = []
          for (let index = 0; index < color.getCount(); index += 1) {
            color.getElement(index, element)
            for (let component = 0; component < finalMin.length; component += 1) {
              const value = element[component]!
              if (!Number.isFinite(value)) {
                materialEvidenceFailure(
                  evidence.sourceMaterial,
                  'contains a non-finite final COLOR_0 value.',
                )
              }
              finalMin[component] = Math.min(finalMin[component]!, value)
              finalMax[component] = Math.max(finalMax[component]!, value)
            }
          }
        }
      }
      if (evidence.color0Min && evidence.color0Max && finalMin && finalMax) {
        const tolerance = evidence.color0Tolerance ?? 1e-5
        if (!closeFactor(finalMin, evidence.color0Min, tolerance)
            || !closeFactor(finalMax, evidence.color0Max, tolerance)) {
          materialEvidenceFailure(
            evidence.sourceMaterial,
            `changed COLOR_0 numeric range from ` +
            `[${evidence.color0Min.join(', ')}]..[${evidence.color0Max.join(', ')}] to ` +
            `[${finalMin.join(', ')}]..[${finalMax.join(', ')}].`,
          )
        }
      }
    }
  }
}

/** Prove the selected-field carrier against the current Document, then return
 * the exact Texture objects that carry compiler-attested image bytes. Callers
 * use object identity rather than display names so duplicate or empty texture
 * names cannot redirect an exact-byte protection rule. */
export function verifiedMaterialCompilationImageTextures(
  document: Document,
  compilation: MaterialCompilationEvidence,
): Texture[] {
  verifyMaterialCompilationEvidence(document, compilation)
  const materials = document.getRoot().listMaterials()
  return [...new Set(compilation.gltfEvidence
    .filter((evidence) => evidence.transport === 'image')
    .map((evidence) => materials.find((material) =>
      material.getName() === evidence.generatedMaterial)!.getBaseColorTexture()!))]
}

/**
 * Compile Blender-side evidence and exported-glTF facts into one portable
 * diagnostic contract. The manifest and tests cross this seam; callers never
 * need to reproduce LOD threshold or draw-call reasoning.
 */
export function compileSceneDiagnostics(
  document: Document,
  vocabulary: Vocabulary,
  blender?: BlenderSceneDiagnostics,
  cameraRecipe?: PresentationCameraRecipe,
): SceneDiagnostics {
  if (blender?.materialCompilation) {
    verifyMaterialCompilationEvidence(document, blender.materialCompilation)
  }
  const exportedNodes = sourceNodeByName(document)
  const loadedNames = allocateLoadedNodeNames(document)
  const groups = (blender?.instances ?? []).map((group): InstanceSourceDiagnostic => {
    const members = group.members.map((member) => ({
      ...member,
      loadedName: exportedNodes.get(member.name)
        ? (loadedNames.get(exportedNodes.get(member.name)!) ?? '')
        : '',
    }))
    const nodes = group.members.map((member) => exportedNodes.get(member.name))
    const reasons = [...group.reasons]
    if (nodes.some((node) => !node)) {
      reasons.push('one or more source members are not present in the exported GLB')
    }
    const meshes = new Set(nodes.map((node) => node?.getMesh())
      .filter((mesh): mesh is Mesh => mesh !== null && mesh !== undefined))
    if (nodes.every(Boolean) && meshes.size !== 1) {
      reasons.push('exported members no longer share one mesh (a bake, modifier, or UV split made them unique)')
    }
    const actualDraws = nodes.every(Boolean)
      ? nodes.reduce((sum, node) => sum + meshDrawCalls(node!.getMesh()), 0)
      : group.drawCallsSeparate
    const instancedDraws = meshes.size === 1
      ? meshDrawCalls([...meshes][0] ?? null)
      : group.drawCallsInstanced
    return {
      ...group,
      members,
      eligible: group.eligible && reasons.length === 0,
      reasons,
      drawCallsSeparate: actualDraws,
      drawCallsInstanced: instancedDraws,
      drawCallsSaved: Math.max(0, actualDraws - instancedDraws),
    }
  })
  const current = groups.reduce((sum, group) => sum + group.drawCallsSeparate, 0)
  const batched = groups.reduce(
    (sum, group) => sum + (group.eligible ? group.drawCallsInstanced : group.drawCallsSeparate),
    0,
  )
  const procedural = blender?.procedural ?? []
  const materials = (blender?.materials ?? [])
    .map((material) => ({
      ...material,
      reasons: [...material.reasons],
      usedBy: [...material.usedBy].sort((a, b) => a.localeCompare(b)),
      ...(material.cyclesAppearance
        ? {
            cyclesAppearance: {
              ...material.cyclesAppearance,
              blockers: [...material.cyclesAppearance.blockers],
            },
          }
        : {}),
      ...(material.channels
        ? {
            channels: {
              ...material.channels,
              channels: material.channels.channels.map((entry) => ({
                ...entry,
                ...(entry.spaces ? { spaces: [...entry.spaces] } : {}),
                ...(entry.uvMaps ? { uvMaps: [...entry.uvMaps] } : {}),
                ...(entry.reasons ? { reasons: [...entry.reasons] } : {}),
                ...(Array.isArray(entry.value)
                  ? { value: [...entry.value] }
                  : {}),
              })),
            },
          }
        : {}),
      ...(material.materialCompilation?.channels
        ? {
            materialCompilation: {
              ...material.materialCompilation,
              channels: {
                ...material.materialCompilation.channels,
                channels: material.materialCompilation.channels.channels.map(
                  (entry) => ({
                    ...entry,
                    ...(entry.reasons ? { reasons: [...entry.reasons] } : {}),
                    ...(entry.uvMaps ? { uvMaps: [...entry.uvMaps] } : {}),
                    ...(Array.isArray(entry.value)
                      ? { value: [...entry.value] }
                      : {}),
                    // The attached IR is carried intentionally, not
                    // incidentally: a deep copy keeps the manifest report
                    // independent of the sidecar object graph.
                    ...(entry.tslIr
                      ? {
                          tslIr: JSON.parse(
                            JSON.stringify(entry.tslIr),
                          ) as typeof entry.tslIr,
                        }
                      : {}),
                  }),
                ),
              },
            },
          }
        : {}),
    }))
    .sort((a, b) => a.material.localeCompare(b.material))
  const materialCompilation = blender?.materialCompilation
    ? {
        ...blender.materialCompilation,
        loweredMaterials: [...blender.materialCompilation.loweredMaterials],
        generatedMaterials: [...blender.materialCompilation.generatedMaterials],
        gltfEvidence: blender.materialCompilation.gltfEvidence.map((item) => ({
          ...item,
          bindings: [...item.bindings],
          ...(item.color0Min ? { color0Min: [...item.color0Min] } : {}),
          ...(item.color0Max ? { color0Max: [...item.color0Max] } : {}),
          ...(item.uvMin ? { uvMin: [...item.uvMin] as [number, number] } : {}),
          ...(item.uvMax ? { uvMax: [...item.uvMax] as [number, number] } : {}),
          ...(item.sampler ? { sampler: { ...item.sampler } } : {}),
          ...(item.surfaceFactorization
            ? {
                surfaceFactorization: {
                  ...item.surfaceFactorization,
                  shadeColor: [...item.surfaceFactorization.shadeColor] as [
                    number, number, number, number,
                  ],
                  baseColorFactor: [...item.surfaceFactorization.baseColorFactor] as [
                    number, number, number,
                  ],
                  emissiveFactor: [...item.surfaceFactorization.emissiveFactor] as [
                    number, number, number,
                  ],
                  exactTerms: [...item.surfaceFactorization.exactTerms] as [
                    'selectedIntrinsic', 'staticShadeFloor',
                  ],
                  approximateTerms: [
                    ...item.surfaceFactorization.approximateTerms,
                  ] as ['shaderToRgbDirectResponseAsMetallicRoughness'],
                },
              }
            : {}),
          ...(item.textureNormalization
            ? { textureNormalization: { ...item.textureNormalization } }
            : {}),
          ...(item.emissiveFactor
            ? {
                emissiveFactor: [...item.emissiveFactor] as [
                  number, number, number,
                ],
              }
            : {}),
          ...(item.emissiveSampler
            ? { emissiveSampler: { ...item.emissiveSampler } }
            : {}),
          ...(item.emissiveUvMin
            ? { emissiveUvMin: [...item.emissiveUvMin] as [number, number] }
            : {}),
          ...(item.emissiveUvMax
            ? { emissiveUvMax: [...item.emissiveUvMax] as [number, number] }
            : {}),
          ...(item.emissiveUvGeometryAssociation
            ? {
                emissiveUvGeometryAssociation: {
                  ...item.emissiveUvGeometryAssociation,
                  positionGrids: item.emissiveUvGeometryAssociation.positionGrids.map(
                    (grid) => ({
                      ...grid,
                      offset: [...grid.offset] as [number, number, number],
                    }),
                  ),
                },
              }
            : {}),
          ...(item.bindingPrimitives
            ? {
                bindingPrimitives: item.bindingPrimitives.map((binding) => ({
                  binding: binding.binding,
                  occurrences: binding.occurrences.map((occurrence) => ({
                    mesh: occurrence.mesh,
                    primitives: [...occurrence.primitives],
                  })),
                })),
              }
            : {}),
          ...(item.uvGeometryAssociation
            ? {
                uvGeometryAssociation: {
                  ...item.uvGeometryAssociation,
                  positionGrids: item.uvGeometryAssociation.positionGrids.map((grid) => ({
                    ...grid,
                    offset: [...grid.offset] as [number, number, number],
                  })),
                },
              }
            : {}),
          ...(item.materializationEvidence
            ? {
                materializationEvidence: {
                  ...item.materializationEvidence,
                  rgbMin: [...item.materializationEvidence.rgbMin] as [
                    number, number, number,
                  ],
                  rgbMax: [...item.materializationEvidence.rgbMax] as [
                    number, number, number,
                  ],
                  sourceLayoutIssues: [
                    ...item.materializationEvidence.sourceLayoutIssues,
                  ],
                  ...(item.materializationEvidence.uvRepairStrategies
                    ? {
                        uvRepairStrategies: [
                          ...item.materializationEvidence.uvRepairStrategies,
                        ],
                      }
                    : {}),
                },
              }
            : {}),
        })),
    }
    : undefined
  const authoredOrthographicAspect = compileAuthoredOrthographicAspectEvidence(
    document,
    cameraRecipe,
  )
  // Explicit, field-by-field copy: the manifest report must not alias the
  // sidecar object graph, and a field nobody named here is a field nobody
  // meant to persist.
  const shapeKeys = blender?.shapeKeys
    ? (() => {
        const objects = blender.shapeKeys
          .map((record): ShapeKeyTransportDiagnostic => ({
            ...record,
            containerModifiers: [...record.containerModifiers],
            ...(record.restoredBy ? { restoredBy: [...record.restoredBy] } : {}),
            keys: record.keys.map((key) => ({
              ...key,
              ...(key.valueRange
                ? { valueRange: [...key.valueRange] as [number, number] }
                : {}),
            })),
            frameRange: [...record.frameRange] as [number, number],
          }))
          .sort((a, b) => a.object.localeCompare(b.object))
        return {
          objects,
          dropped: objects.filter(
            (record) => record.keys.some((key) => key.transport === 'frozen'),
          ).length,
          basisSourced: objects.filter(
            (record) => record.positionSource === 'basis',
          ).length,
          warnings: objects
            .filter((record) => record.severity === 'warn')
            .map((record) => record.message),
          refusals: objects
            .filter((record) => record.severity === 'refuse')
            .map((record) => record.message),
        }
      })()
    : undefined
  const skinApproximation = blender?.skinApproximation
    ? (() => {
        const objects = blender.skinApproximation
          .map((record): SkinApproximationDiagnostic => ({
            ...record,
            modifiers: record.modifiers.map((modifier) => ({ ...modifier })),
          }))
          .sort((a, b) => a.object.localeCompare(b.object))
        return {
          objects,
          preserveVolume: objects.filter((record) => record.preserveVolume).length,
          boneEnvelopes: objects.filter((record) => record.boneEnvelopes).length,
          warnings: objects
            .filter((record) => record.severity === 'warn')
            .map((record) => record.message),
        }
      })()
    : undefined
  return {
    lod: compileLods(document, vocabulary, loadedNames),
    instances: {
      groups,
      gpuBatches: compileGpuBatches(document, loadedNames),
      eligibleGroups: groups.filter((group) => group.eligible).length,
      estimatedDrawCallsCurrent: current,
      estimatedDrawCallsIfEligibleBatched: batched,
      estimatedDrawCallsSaved: current - batched,
    },
    procedural: {
      objects: procedural,
      blockers: procedural.filter((item) => item.blocking).length,
      topologyChanging: procedural.filter((item) => item.topology === 'changing').length,
      cacheCandidates: procedural.filter((item) => item.route === 'Cache').length,
    },
    materials: {
      records: materials,
      exact: materials.filter((item) => item.status === 'exact').length,
      approximated: materials.filter((item) => item.status === 'approximated').length,
      needsBake: materials.filter((item) => item.status === 'needsBake').length,
      cyclesAppearanceBlocked: materials.filter(
        (item) => item.cyclesAppearance?.status === 'blocked',
      ).length,
    },
    ...(materialCompilation ? { materialCompilation } : {}),
    ...(shapeKeys ? { shapeKeys } : {}),
    ...(skinApproximation ? { skinApproximation } : {}),
    // Carried explicitly, like every other diagnostics field: a producer that
    // predates the check omits it entirely, and an empty array from a producer
    // that has it is the evidence the check ran.
    ...(blender?.frozenDeformers
      ? {
          frozenDeformers: {
            objects: blender.frozenDeformers,
            blockers: blender.frozenDeformers.length,
          },
        }
      : {}),
    ...(authoredOrthographicAspect
      ? { camera: { authoredOrthographicAspect } }
      : {}),
  }
}
