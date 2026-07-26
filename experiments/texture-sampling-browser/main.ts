import * as THREE from 'three'
import {
  installThreeTextureSampling,
} from '../../packages/blendlink/src/threeTextureSampling.ts'

declare global {
  interface Window {
    __blendlinkTextureSamplingEvidence?: Record<string, unknown>
  }
}

function checkerTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 256
  const context = canvas.getContext('2d')
  if (!context) throw new Error('2D canvas is unavailable')
  for (let y = 0; y < 16; y += 1) {
    for (let x = 0; x < 16; x += 1) {
      context.fillStyle = (x + y) % 2 === 0 ? '#f6efe2' : '#25344a'
      context.fillRect(x * 16, y * 16, 16, 16)
    }
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.generateMipmaps = true
  return texture
}

async function main() {
  const renderer = new THREE.WebGLRenderer({ antialias: false })
  renderer.setSize(64, 64, false)
  document.body.append(renderer.domElement)
  const gl = renderer.getContext()
  const extension = gl.getExtension('EXT_texture_filter_anisotropic')
  if (!extension) throw new Error('EXT_texture_filter_anisotropic is unavailable')

  const texture = checkerTexture()
  const root = new THREE.Mesh(
    new THREE.PlaneGeometry(),
    new THREE.MeshBasicMaterial({ map: texture }),
  )
  const max = renderer.capabilities.getMaxAnisotropy()
  const nativeAnisotropy = () => {
    renderer.initTexture(texture)
    const properties = renderer.properties.get(texture) as {
      __webglTexture?: WebGLTexture
    }
    if (!properties.__webglTexture) throw new Error('Three did not allocate a WebGL texture')
    gl.bindTexture(gl.TEXTURE_2D, properties.__webglTexture)
    return gl.getTexParameter(
      gl.TEXTURE_2D,
      extension.TEXTURE_MAX_ANISOTROPY_EXT,
    ) as number
  }

  const authored = {
    property: texture.anisotropy,
    native: nativeAnisotropy(),
  }
  const balanced = installThreeTextureSampling(root, renderer, 4)
  const balancedApplied = {
    report: balanced.report,
    property: texture.anisotropy,
    native: nativeAnisotropy(),
  }
  const quality = installThreeTextureSampling(root, renderer, 'renderer-max')
  const qualityApplied = {
    report: quality.report,
    property: texture.anisotropy,
    native: nativeAnisotropy(),
  }
  quality.dispose()
  const balancedResumed = {
    property: texture.anisotropy,
    native: nativeAnisotropy(),
  }
  balanced.dispose()
  const authoredRestored = {
    property: texture.anisotropy,
    native: nativeAnisotropy(),
  }

  window.__blendlinkTextureSamplingEvidence = {
    ready: true,
    threeRevision: THREE.REVISION,
    rendererMaxAnisotropy: max,
    authored,
    balancedApplied,
    qualityApplied,
    balancedResumed,
    authoredRestored,
    renderer: {
      version: gl.getParameter(gl.VERSION),
      vendor: gl.getParameter(gl.VENDOR),
      renderer: gl.getParameter(gl.RENDERER),
    },
  }
}

main().catch((error) => {
  window.__blendlinkTextureSamplingEvidence = {
    ready: false,
    error: error instanceof Error ? error.stack ?? error.message : String(error),
  }
  throw error
})
