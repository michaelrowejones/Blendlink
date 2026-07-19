/** The owned baked-composition recipe (shadcn model): written ONCE into the
 * user's genDir beside the generated module, then it is THEIRS — sync never
 * overwrites it. It carries the shader-injection code a median three.js
 * user cannot be expected to hand-roll from MANIFEST.md alone. */

export function renderBakedRecipe(exportName: string): string {
  return `/* Generated once by blendlink — this file is YOURS to edit and will not
 * be overwritten. Runtime contract: blendlink docs/MANIFEST.md.
 *
 * Composes a baked scene: base state atlas + additive light-group layers,
 * in linear space, with per-atlas-group textures. Works with vanilla
 * three.js or React Three Fiber (call from useEffect/useMemo on the
 * loaded scene root).
 */
import * as THREE from 'three'
import { ${exportName} } from './${exportName}.gen'

type GroupedUrl = Record<string, string>
type GroupedLayer = Record<string, { url: string; maxValue: number }>

/** Flat single-atlas entries and multi-atlas maps normalize to group→value. */
function statesByGroup(entry: string | GroupedUrl): GroupedUrl {
  return typeof entry === 'string' ? { main: entry } : entry
}
function layersByGroup(
  entry: { url: string; maxValue: number } | GroupedLayer,
): GroupedLayer {
  return 'url' in entry && typeof entry.url === 'string'
    ? { main: entry as { url: string; maxValue: number } }
    : (entry as GroupedLayer)
}

const loader = new THREE.TextureLoader()
function loadAtlas(url: string): THREE.Texture {
  const texture = loader.load(url)
  // Baked atlases are sRGB-encoded PNGs sampled through glTF UVs.
  texture.colorSpace = THREE.SRGBColorSpace
  texture.flipY = false
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping
  return texture
}

/** Which atlas group a mesh belongs to: the exporter stamps
 * blendlink_atlas on the NODE, and multi-primitive meshes surface it on an
 * ancestor — so walk up (a lesson learned the hard way). */
function groupOf(object: THREE.Object3D): string {
  for (let current: THREE.Object3D | null = object; current; current = current.parent) {
    const tagged = current.userData?.blendlink_atlas
    if (typeof tagged === 'string') return tagged
  }
  return 'main'
}

interface PatchedEntry {
  material: THREE.MeshBasicMaterial
  group: string
  layerUniforms: Map<string, { map: { value: THREE.Texture | null }; tint: { value: THREE.Color }; strength: { value: number } }>
}

/**
 * Wire a loaded baked scene:
 *   const baked = createBakedScene(gltf.scene)
 *   baked.setLightGroup('lamp', { strength: 0.8, color: '#ffd9a0' })
 *   baked.setState('night')
 */
export function createBakedScene(root: THREE.Object3D) {
  const lightGroups = (${exportName}.lightGroups ?? {}) as Record<
    string,
    { url: string; maxValue: number } | GroupedLayer
  >
  const groupNames = Object.keys(lightGroups)
  const patched: PatchedEntry[] = []

  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return
    const material = object.material
    if (!(material instanceof THREE.MeshBasicMaterial)) return
    const group = groupOf(object)
    const layerUniforms: PatchedEntry['layerUniforms'] = new Map()
    for (const name of groupNames) {
      const layer = layersByGroup(lightGroups[name]!)[group]
      if (!layer) continue
      const texture = loadAtlas(layer.url)
      layerUniforms.set(name, {
        map: { value: texture },
        tint: { value: new THREE.Color(1, 1, 1).multiplyScalar(layer.maxValue) },
        strength: { value: 0 },
      })
    }
    if (layerUniforms.size > 0) {
      // Inject the additive layers into the unlit shader, in LINEAR space
      // (sRGB decode happens at sampling; output encode at the end).
      const entries = [...layerUniforms.entries()]
      material.onBeforeCompile = (shader) => {
        let index = 0
        let samplers = ''
        let adds = ''
        for (const [, uniforms] of entries) {
          shader.uniforms['blLayerMap' + index] = uniforms.map
          shader.uniforms['blLayerTint' + index] = uniforms.tint
          shader.uniforms['blLayerStrength' + index] = uniforms.strength
          samplers +=
            'uniform sampler2D blLayerMap' + index + ';\\n' +
            'uniform vec3 blLayerTint' + index + ';\\n' +
            'uniform float blLayerStrength' + index + ';\\n'
          adds +=
            '  diffuseColor.rgb += texture2D(blLayerMap' + index + ', vMapUv).rgb' +
            ' * blLayerTint' + index + ' * blLayerStrength' + index + ';\\n'
          index += 1
        }
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <map_pars_fragment>', '#include <map_pars_fragment>\\n' + samplers)
          .replace('#include <map_fragment>', '#include <map_fragment>\\n' + adds)
      }
      material.needsUpdate = true
    }
    patched.push({ material, group, layerUniforms })
  })

  const stateCache = new Map<string, Map<string, THREE.Texture>>()
  function texturesFor(stateName: string): Map<string, THREE.Texture> | null {
    const states = (${exportName}.states ?? {}) as Record<string, string | GroupedUrl>
    const entry = states[stateName]
    if (entry === undefined) return null
    let cached = stateCache.get(stateName)
    if (!cached) {
      cached = new Map(
        Object.entries(statesByGroup(entry)).map(([group, url]) => [group, loadAtlas(url)]),
      )
      stateCache.set(stateName, cached)
    }
    return cached
  }

  return {
    /** Swap every material onto a state's atlases (instant; for day/night
     * crossfades, call this at the midpoint of your own opacity/exposure
     * tween, or extend the patch with a second map + mix uniform). */
    setState(name: string): boolean {
      const textures = texturesFor(name)
      if (!textures) return false
      for (const entry of patched) {
        const texture = textures.get(entry.group)
        if (texture) {
          entry.material.map = texture
          entry.material.needsUpdate = false
        }
      }
      return true
    },
    /** Drive one interactive light: strength 0..1+, optional color tint. */
    setLightGroup(
      name: string,
      options: { strength?: number; color?: THREE.ColorRepresentation } = {},
    ): boolean {
      let found = false
      for (const entry of patched) {
        const uniforms = entry.layerUniforms.get(name)
        if (!uniforms) continue
        found = true
        if (options.strength !== undefined) uniforms.strength.value = options.strength
        if (options.color !== undefined) {
          const layer = layersByGroup(
            (${exportName}.lightGroups as Record<string, GroupedLayer | { url: string; maxValue: number }>)[name]!,
          )[entry.group]
          uniforms.tint.value.set(options.color).multiplyScalar(layer?.maxValue ?? 1)
        }
      }
      return found
    },
    lightGroupNames: groupNames,
  }
}
`
}
