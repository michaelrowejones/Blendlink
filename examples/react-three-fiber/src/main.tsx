// A complete minimal R3F SceneToWeb consumer: the website owns the Canvas,
// route, and React tree; the generated `<HeroScene>` component owns scene
// installation and hands the installed handle to onReady.
// `src/scenetoweb/HeroScene.ts` and `src/generated/` are produced by
// `scenetoweb connect` (or the CI gate) — see examples/README.md.
import { createRoot } from 'react-dom/client'
import { Canvas } from '@react-three/fiber'
import { WebGPURenderer } from 'three/webgpu'
import { HeroScene } from './scenetoweb/HeroScene'

const element = document.querySelector('#root')
if (!element) throw new Error('missing #root element')

createRoot(element).render(
  // The async gl factory hands R3F a WebGPURenderer: native WebGPU where
  // available with automatic WebGL2 fallback, and SceneToWeb's installer
  // applies published TSL material programs on the WebGPU family. A
  // classic WebGLRenderer Canvas (no gl prop) remains fully supported.
  <Canvas
    gl={async (props) => {
      const renderer = new WebGPURenderer(
        props as ConstructorParameters<typeof WebGPURenderer>[0],
      )
      await renderer.init()
      return renderer
    }}
  >
    {/* Start with the scene's authored states and playback. Add onReady or
        child behavior when the website needs to control this specific scene. */}
    <HeroScene />
  </Canvas>,
)
