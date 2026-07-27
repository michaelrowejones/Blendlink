// A complete minimal Blendlink consumer: the website owns the renderer,
// canvas, and frame loop; the generated module owns scene installation,
// presentation camera, states, components, and playback.
// `src/blendlink/HeroScene.ts` and `src/generated/` are produced by
// `blendlink connect` (or the CI gate) — see examples/README.md.
import * as THREE from 'three'
import { installHeroScene } from './blendlink/HeroScene'

const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
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
