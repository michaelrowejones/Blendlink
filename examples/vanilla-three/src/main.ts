// A complete minimal Blendlink consumer: the website owns the renderer,
// canvas, and frame loop; the generated module owns scene installation,
// presentation camera, states, components, and playback.
// `src/blendlink/HeroScene.ts` and `src/generated/` are produced by
// `blendlink connect` (or the CI gate) — see examples/README.md.
import * as THREE from 'three'
import { WebGPURenderer } from 'three/webgpu'
import { installHeroScene } from './blendlink/HeroScene'

// WebGPURenderer renders on native WebGPU where available and falls back
// to WebGL2 on its own. On the WebGPU family, Blendlink's installer also
// applies any published TSL material programs automatically; a classic
// THREE.WebGLRenderer remains fully supported and renders the shipped
// baked carriers.
const renderer = new WebGPURenderer({ antialias: true })
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
await renderer.init()
document.body.appendChild(renderer.domElement)

const scene = new THREE.Scene()
const installed = await installHeroScene({ scene, renderer })

window.addEventListener('resize', () => {
  installed.resize(window.innerWidth, window.innerHeight)
})

const clock = new THREE.Clock()
renderer.setAnimationLoop(() => {
  const delta = clock.getDelta()
  // The only two per-frame calls Blendlink needs: update() drives authored
  // animation/controls/LODs, render() selects the artist-authored
  // post-processing chain or plain renderer.render().
  installed.update(delta)
  installed.render(delta)
})
