import type { FogRecipe } from './sceneRecipe.js'

export interface FogSceneLike {
  fog?: unknown
}

export interface FogCompiledDescriptor {
  fog?: FogRecipe | null
}

export interface CompiledSceneFogOptions {
  /** Construct the renderer-native Fog/FogExp2 object. This explicit seam
   * keeps Three versions and color constructors owned by the website. */
  createFog(recipe: FogRecipe & { mode: 'linear' | 'exponential' }): unknown
}

export interface CompiledSceneFog {
  mode: Exclude<FogRecipe['mode'], 'application'>
  fog: unknown | null
  /** Restores the pre-install scene fog only if no later owner replaced it. */
  dispose(): void
}

/** Apply only explicit scene-owned fog. Application mode is a true no-op. */
export function applyCompiledSceneFog(
  scene: FogSceneLike,
  descriptor: FogCompiledDescriptor,
  options?: CompiledSceneFogOptions,
): CompiledSceneFog | null {
  const recipe = descriptor.fog
  if (!recipe || recipe.mode === 'application') return null
  const previous = scene.fog
  const installed = recipe.mode === 'none' ? null : createFog(recipe, options)
  scene.fog = installed
  let disposed = false
  return {
    mode: recipe.mode,
    fog: installed,
    dispose() {
      if (disposed) return
      disposed = true
      if (scene.fog === installed) scene.fog = previous
    },
  }
}

function createFog(recipe: FogRecipe, options?: CompiledSceneFogOptions): unknown {
  if (!options?.createFog) {
    throw new Error(
      `This Blendlink scene owns ${recipe.mode} fog. Pass createFog(recipe) using ` +
        'Three.Fog or Three.FogExp2; Blendlink will not guess a renderer constructor.',
    )
  }
  const fog = options.createFog(recipe as FogRecipe & { mode: 'linear' | 'exponential' })
  if (fog === undefined || fog === null) {
    throw new Error('createFog(recipe) returned no renderer-native fog object.')
  }
  return fog
}
