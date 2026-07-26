import assert from 'node:assert/strict'

const textureSize = 512
const texels = textureSize * textureSize
const rgba8Bytes = 4
const depth24Bytes = 3
const blurPassesPerRefresh = 4
const textureSamplesPerBlurFragment = 9
const auxiliaryRendersPerRefresh = 1 + blurPassesPerRefresh
const threeTslBlurPassesPerRefresh = 2
const threeTslSigma = 4
const threeTslKernelSize = 3 + (2 * threeTslSigma)
const threeTslSamplesPerBlurFragment = 1 + (2 * (threeTslKernelSize - 1))

function mib(bytes) {
  return bytes / (1024 * 1024)
}

function policyCost(hostFrames, refreshes) {
  return {
    hostFrames,
    refreshes,
    auxiliaryRenders: refreshes * auxiliaryRendersPerRefresh,
    blurTextureSamples:
      refreshes *
      blurPassesPerRefresh *
      texels *
      textureSamplesPerBlurFragment,
  }
}

// Needle creates two default WebGLRenderTargets. Three r184 defaults each
// target to one RGBA8 color attachment plus one DEPTH_COMPONENT24 attachment.
const needleNominalBytes = 2 * texels * (rgba8Bytes + depth24Bytes)

// The depth and blur materials both disable depth testing/writes, so a matching
// WebGL implementation can explicitly omit both unused depth attachments.
const depthlessNominalBytes = 2 * texels * rgba8Bytes

// Three r184's WebGPU/TSL example has one color+depth capture target. Its
// GaussianBlurNode owns two additional depthless color targets.
const threeTslNominalBytes =
  texels * (rgba8Bytes + depth24Bytes) +
  2 * texels * rgba8Bytes

assert.equal(mib(needleNominalBytes), 3.5)
assert.equal(mib(depthlessNominalBytes), 2)
assert.equal(mib(threeTslNominalBytes), 3.75)
assert.equal(threeTslSamplesPerBlurFragment, 21)

const tenSecondsAt60Hz = 600
const continuous = policyCost(tenSecondsAt60Hz, tenSecondsAt60Hz)
const staticOnce = policyCost(tenSecondsAt60Hz, 1)
const tenChanges = policyCost(tenSecondsAt60Hz, 10)

assert.deepEqual(continuous, {
  hostFrames: 600,
  refreshes: 600,
  auxiliaryRenders: 3000,
  blurTextureSamples: 5_662_310_400,
})
assert.deepEqual(staticOnce, {
  hostFrames: 600,
  refreshes: 1,
  auxiliaryRenders: 5,
  blurTextureSamples: 9_437_184,
})
assert.deepEqual(tenChanges, {
  hostFrames: 600,
  refreshes: 10,
  auxiliaryRenders: 50,
  blurTextureSamples: 94_371_840,
})

function snapshot(owner) {
  return structuredClone(owner)
}

function restore(owner, original) {
  for (const key of Object.keys(owner)) delete owner[key]
  Object.assign(owner, structuredClone(original))
}

function refreshTransaction(owner, throwAt) {
  const original = snapshot(owner)
  const stages = ['depth', 'blur-h-1', 'blur-v-1', 'blur-h-2', 'blur-v-2']

  try {
    owner.renderer.target = 'contact-depth'
    owner.renderer.clearAlpha = 0
    owner.renderer.xrEnabled = false
    owner.scene.background = null
    owner.scene.overrideMaterial = 'contact-depth-material'
    owner.scene.matrixWorldAutoUpdate = false
    owner.caster.visible = false

    for (const stage of stages) {
      if (stage === throwAt) throw new Error(`injected ${stage} failure`)
      owner.renderer.target = stage
    }
  } finally {
    restore(owner, original)
  }
}

for (const stage of ['depth', 'blur-h-1', 'blur-v-1', 'blur-h-2', 'blur-v-2']) {
  const owner = {
    renderer: {
      target: 'application-target',
      activeCubeFace: 3,
      activeMipmapLevel: 2,
      clearAlpha: 0.375,
      xrEnabled: true,
      autoClear: false,
    },
    scene: {
      background: 'application-background',
      overrideMaterial: 'application-override',
      matrixWorldAutoUpdate: true,
    },
    caster: { visible: true },
  }
  const original = snapshot(owner)
  assert.throws(() => refreshTransaction(owner, stage), new RegExp(stage))
  assert.deepEqual(owner, original)
}

console.log(JSON.stringify({
  textureSize,
  auxiliaryRendersPerRefresh,
  blurPassesPerRefresh,
  textureSamplesPerBlurFragment,
  threeR184Tsl: {
    auxiliaryRendersPerRefresh: 1 + threeTslBlurPassesPerRefresh,
    blurPassesPerRefresh: threeTslBlurPassesPerRefresh,
    sigma: threeTslSigma,
    samplesPerBlurFragment: threeTslSamplesPerBlurFragment,
    blurTextureSamplesPerRefresh:
      texels *
      threeTslBlurPassesPerRefresh *
      threeTslSamplesPerBlurFragment,
  },
  nominalAttachmentMemoryMiB: {
    needleDefaultTargets: mib(needleNominalBytes),
    explicitDepthlessTargets: mib(depthlessNominalBytes),
    threeR184Tsl: mib(threeTslNominalBytes),
  },
  tenSecondsAt60Hz: {
    continuous,
    staticOnce,
    tenChanges,
  },
  injectedFailureStagesRestored: 5,
}, null, 2))
