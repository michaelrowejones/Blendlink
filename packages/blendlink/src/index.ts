export { defineConfig, defineScene, loadConfig, resolveConfig } from './config.js'
export type {
  BlendlinkConfig,
  ApplicationMaterialAdapterConfig,
  SceneConfig,
  WebsiteConfig,
  ResolvedConfig,
  ResolvedScene,
  ResolvedWebsite,
} from './config.js'
export {
  discoverBlender,
  BlenderNotFoundError,
  BlenderUnsupportedVersionError,
} from './discover.js'
export type { BlenderInstall } from './discover.js'
export { exportBlend, BlendExportError } from './invoke.js'
export type { ExportSettings, ExportResult } from './invoke.js'
export {
  DEFAULT_SCENE_RECIPE,
  SCENE_RECIPE_SCHEMA_VERSION,
  exportSettingsFromRecipe,
  parseSceneRecipe,
} from './sceneRecipe.js'
export type {
  AtlasRecipe,
  AnimationLoop,
  AnimationStart,
  BackgroundIntent,
  CameraFraming,
  EnvironmentBackground,
  EnvironmentLighting,
  EnvironmentRecipe,
  EnvironmentSource,
  FogMode,
  FogRecipe,
  CameraBehavior,
  CompositionFrameRecipe,
  GeometryOptimization,
  TextureOptimization,
  LightingStateRecipe,
  PresentationCameraRecipe,
  OptimizationRecipe,
  PlaybackRecipe,
  LookRecipe,
  ShadowFilter,
  ShadowPreset,
  ShadowRecipe,
  PresentationMode,
  QualityRecipe,
  ReflectionProbeRecipe,
  ReflectionProbeShape,
  ReflectionProbeSource,
  RecipeDiagnostic,
  SceneRecipe,
  ToneMappingIntent,
} from './sceneRecipe.js'
export {
  startAnimationSequence,
  validateAnimationSequenceClips,
} from './animationSequence.js'
export type {
  AnimationSequenceBlend,
  AnimationSequenceEasing,
  AnimationSequenceExtrapolation,
  AnimationSequenceOptions,
  AnimationSequenceRecipe,
  AnimationSequenceStrip,
  RunningAnimationSequence,
  SequenceActionLike,
  SequenceClipLike,
  SequenceMixerLike,
} from './animationSequence.js'
export {
  CORE_COMPONENT_REGISTRY,
  PORTABLE_COMPONENT_SCHEMA_VERSION,
  SCENE_COMPONENT_TARGET,
  componentDefaults,
  componentDefinition,
  isJsonValue,
  parsePortableComponents,
} from './components.js'
export type {
  ComponentAdapterKind,
  ComponentAdapterSupport,
  ComponentAdapterSupportLevel,
  ComponentCardinality,
  ComponentDiagnostic,
  ComponentFieldMetadata,
  ComponentLifecyclePhase,
  ComponentPortability,
  ComponentRuntimeCapability,
  ComponentRuntimeCost,
  ComponentTargetKind,
  JsonObject,
  JsonPrimitive,
  JsonValue,
  ParsePortableComponentsResult,
  PortableComponentDefinition,
  PortableComponentRecord,
  PortableComponentTarget,
} from './components.js'
export {
  RuntimeComponentDisposalError,
  RuntimeComponentInstallError,
  installRuntimeComponents,
} from './componentRuntime.js'
export type { ThreeAccessibleControl } from './threeInteractions.js'
export type { ThreeAudioControl, ThreeAudioReadiness } from './threeAudio.js'
export {
  BLENDLINK_IMMUTABLE_CACHE_CONTROL,
  compiledSceneImmutableAssetPolicy,
  compiledSceneAssetUrls,
  createCompiledAssetUrlModifier,
  matchesCompiledSceneImmutableAssetPolicy,
  resolveCompiledAssetUrl,
} from './assetUrls.js'
export type {
  CompiledSceneImmutableAssetPolicy,
} from './assetUrls.js'
export type {
  AccessibilityService,
  InstalledRuntimeComponents,
  InteractionService,
  PostEffectDescriptor,
  PostPipelineService,
  QualityService,
  RuntimeAccessibleControl,
  RuntimeComponentAdapter,
  RuntimeComponentAdapterContext,
  RuntimeComponentInstallOperation,
  RuntimeComponentInstallation,
  RuntimeComponentServices,
  RuntimeDiagnostic,
  RuntimeDiagnosticsService,
  RuntimeDisposable,
  RuntimeInteractionTarget,
  RuntimeQuality,
} from './componentRuntime.js'
export { installCompiledSceneCamera } from './cameraControls.js'
export type {
  CameraBounds,
  CameraCompiledDescriptor,
  CameraControlsContext,
  CameraFitReport,
  CameraViewport,
  CompiledSceneCamera,
  InstallCompiledSceneCameraOptions,
  InteractiveCameraControls,
  PresentationCameraLike,
} from './cameraControls.js'
export { applyCompiledSceneFog } from './sceneFog.js'
export type {
  CompiledSceneFog,
  CompiledSceneFogOptions,
  FogCompiledDescriptor,
  FogSceneLike,
} from './sceneFog.js'
export { parseVisualReferenceMatrix, runVisualReferenceAudit } from './visualAudit.js'
export type {
  BrowserCaptureContext,
  RunVisualReferenceAuditOptions,
  VisualAuditAcceptance,
  VisualAuditComparison,
  VisualAuditReport,
  VisualAuditViewport,
  VisualDiffMetrics,
  VisualReferenceMatrix,
} from './visualAudit.js'
export { readBlendHeader } from './blendHeader.js'
export type { BlendHeader } from './blendHeader.js'
export { generateSceneModule } from './typegen.js'
export type { SceneManifest, NodeKind, TypegenOutput, CurveData } from './typegen.js'
export {
  createSceneAssetGraph,
  sceneAssetGraphPath,
  sceneAssetGraphIntegrityProblem,
  KTX2_RUNTIME_GRAPH_PATHS,
} from './sceneAssetGraph.js'
export type {
  SceneAssetGraph,
  SceneAssetGraphEntry,
  SceneAssetGraphIntegrityOptions,
  SceneAssetGraphInput,
  SceneAssetRole,
} from './sceneAssetGraph.js'
export type { SceneRuntimePublication } from './scenePublication.js'
export {
  CAMERA_ASPECT_RELATIVE_TOLERANCE,
  compileAuthoredOrthographicAspectEvidence,
  compileSceneDiagnostics,
} from './sceneDiagnostics.js'
export type {
  AuthoredOrthographicAspectEvidence,
  BlenderSceneDiagnostics,
  CameraCompositionAspectEvidence,
  GpuInstanceBatchDiagnostic,
  InstanceSourceDiagnostic,
  LodChainDiagnostic,
  LodLevelDiagnostic,
  ProceduralDiagnostic,
  SceneDiagnostics,
  TopologySnapshot,
} from './sceneDiagnostics.js'
export {
  RUNTIME_SCENE_DIAGNOSTICS_SCHEMA_VERSION,
  compileRuntimeSceneDiagnostics,
  resolveRuntimeSceneDiagnostics,
} from './runtimeDiagnostics.js'
export type {
  RuntimeSceneDiagnostics,
  RuntimeSceneDiagnosticsDescriptor,
} from './runtimeDiagnostics.js'
export { startCompiledSceneLods } from './lodRuntime.js'
export type {
  CompiledSceneLodOptions,
  CompiledSceneLods,
  LodCompiledDescriptor,
  LodObjectLike,
  LodVectorLike,
} from './lodRuntime.js'
export { applyCompiledSceneInstances } from './instanceRuntime.js'
export type {
  CompiledInstanceBinding,
  CompiledSceneInstanceOptions,
  CompiledSceneInstances,
  InstanceBatchLike,
  InstanceCompiledDescriptor,
  InstanceObjectLike,
  InstanceParentLike,
} from './instanceRuntime.js'
export { parseVocabulary } from './vocabulary.js'
export type {
  Vocabulary,
  ColliderEntry,
  LodChain,
  AnchorEntry,
  PhysicsEntry,
} from './vocabulary.js'
export { isBlockingVerifyIssue, syncAll, syncScene, verifyAll } from './sync.js'
export type { SyncOutcome, VerifyIssue } from './sync.js'
export { compileProject } from './compiler.js'
export { publishWebsiteProject } from './publish.js'
export type {
  PublishWebsiteOptions,
  PublishWebsiteResult,
  WebsiteBuildResult,
} from './publish.js'
export { resolveWebsitePreview, runWebsitePreview } from './preview.js'
export type { WebsitePreviewTarget, RunWebsitePreviewOptions } from './preview.js'
export {
  bindCompiledScene,
  applyCompiledSceneLook,
  applyCompiledSceneEnvironment,
  applyCompiledSceneShadows,
  configureCompiledSceneLoader,
  loadCompiledScene,
  prepareCompiledSceneEnvironment,
  prepareCompiledSceneLook,
  prepareCompiledSceneShadows,
  startCompiledScenePlayback,
} from './runtime.js'
export { optimizeMeshopt, resizeTextures } from './optimizer.js'
export type {
  OptimizationReport,
  TextureResizePolicy,
  TextureResizeResult,
  TextureTransformReport,
} from './optimizer.js'
export {
  analyzeCompiledScenePerformance,
  analyzeManifestPerformance,
  defaultPerformanceBudgets,
  selectTextureResolution,
  updateAdaptiveQuality,
} from './performance.js'
export type {
  AdaptiveQualityState,
  CompiledScenePerformanceReport,
  PerformanceBudgets,
  PerformanceDiagnostic,
  PerformanceTier,
  StaticPerformanceReport,
  TextureResolutionCandidate,
  TextureResolutionRequest,
} from './performance.js'
export { auditCompiledSceneArtifact } from './compiledSceneAudit.js'
export type {
  AuditCompiledSceneArtifactInput,
  CompiledMaterialBindingEvidence,
  CompiledMaterialPayloadEvidence,
  CompiledMaterialPortabilityCoverage,
  CompiledSceneAudit,
  CompiledSceneMeshContributor,
  MaterialPayloadCollapseEvidence,
  MaterialPayloadCollapseFamily,
} from './compiledSceneAudit.js'
export { createRuntimePerformanceMonitor } from './runtimePerformance.js'
export type {
  RuntimeCapability,
  RuntimeDistribution,
  RuntimeFrameMetrics,
  RuntimeGpuTimingMetrics,
  RuntimeLongTaskEntry,
  RuntimeLongTaskMetrics,
  RuntimeLongTaskSubscription,
  RuntimePerformanceEnvironment,
  RuntimePerformanceMonitor,
  RuntimePerformanceMonitorOptions,
  RuntimePerformanceRenderer,
  RuntimePerformanceReport,
  RuntimeRendererMetrics,
  RuntimeResourceMetrics,
  RuntimeResourceTimingEntry,
} from './runtimePerformance.js'
export type {
  AtlasDeliveryEntry,
  AtlasDeliveryReport,
  TextureDeliveryVariant,
} from './atlasDelivery.js'
export { chooseTextureCodec, compressTexturesKtx2, findKtxTool, KTX_SOFTWARE_URL } from './textureCompression.js'
export type {
  TextureCodec,
  TextureCompressionEntry,
  TextureCompressionOverride,
  TextureCompressionPolicy,
  TextureCompressionReport,
  TextureCompressionResult,
} from './textureCompression.js'
export type {
  CompiledSceneLoaderOptions,
  CompiledSceneAnimationClip,
  CompiledSceneAnimationMode,
  CompiledSceneAnimationPhase,
  CompiledSceneAnimationState,
  CompiledSceneAnimationTransport,
  CompiledScenePlayback,
  CompiledScenePlaybackOptions,
  CompiledSceneLook,
  CompiledSceneLookOptions,
  PreparedCompiledSceneLook,
  PreparedCompiledSceneLookState,
  AnimationActionLike,
  AnimationClipLike,
  AnimationMixerLike,
  RendererLookLike,
  CompiledSceneEnvironment,
  CompiledSceneEnvironmentOptions,
  PreparedCompiledSceneEnvironment,
  PreparedCompiledSceneEnvironmentState,
  PreparedCompiledSceneShadows,
  PreparedCompiledSceneShadowsState,
  CompiledSceneShadowOptions,
  CompiledSceneShadowReport,
  EnvironmentTextureLike,
  LightShadowLike,
  RendererShadowsLike,
  SceneEnvironmentLike,
  SceneLookLike,
  CompiledSceneDescriptor,
  AuthoringPreview,
  LoadedSceneLike,
  Object3DLike,
  SceneBindings,
} from './runtime.js'
export {
  applyCompiledSceneReflectionProbes,
  createThreeWebGLReflectionCapture,
} from './reflectionProbes.js'
export type {
  ApplyReflectionProbesOptions,
  CompiledReflectionProbeReport,
  CompiledReflectionProbes,
  ReflectionProbeMaterialLike,
  ReflectionProbeObjectLike,
  ReflectionProbePublishedAsset,
  ReflectionProbeRuntimeContext,
  ReflectionProbeTextureResource,
  ThreeWebGLReflectionCaptureNamespace,
  ThreeWebGLReflectionCaptureOptions,
} from './reflectionProbes.js'
export { installBlenderAddon } from './addon.js'
export { setupWebsiteProject } from './projectSetup.js'
export type { WebsiteSetupOptions, WebsiteSetupResult, WebsiteStack } from './projectSetup.js'
export {
  loadBlenderKnownIssueRegistry,
  matchingBlenderKnownIssues,
  parseBlenderKnownIssueRegistry,
} from './knownIssues.js'
export type {
  BlenderKnownIssue,
  BlenderKnownIssueRegistry,
  KnownIssueSeverity,
} from './knownIssues.js'
export {
  SceneInstallationTransactionError,
  createSceneInstallationCoordinator,
} from './preparedSceneInstallation.js'
export type {
  PreparedSceneInstallation,
  PreparedSceneInstallationState,
  PreparedSceneResource,
  PrepareSceneInstallationOptions,
  ReversibleSceneMutation,
  SceneInstallationCoordinator,
  SceneInstallationTransactionErrorCode,
  ScenePreparationContext,
} from './preparedSceneInstallation.js'
