import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Document, NodeIO } from '@gltf-transform/core'
import { describe, expect, it } from 'vitest'
import { DEFAULT_SCENE_RECIPE, type SceneRecipe } from './sceneRecipe.js'
import { generateSceneModule } from './typegen.js'

const sequence = {
  name: 'Hero Story',
  source: { objectId: 'hero-id', objectName: 'Hero', track: 'Website Story' },
  duration: 1,
  loop: false,
  speed: 1,
  strips: [{
    order: 0, name: 'Reveal Strip', clip: 'Reveal', at: 0, duration: 1,
    clipStart: 0, clipEnd: 1, scale: 1, speed: 1, repeat: 1,
    blend: 'replace' as const, blendIn: 0, blendOut: 0, weight: 1,
    easing: 'linear' as const, extrapolation: 'hold-forward' as const,
    reverse: false, muted: false,
  }],
}

async function writeAnimatedGlb(path: string, duration = 1): Promise<void> {
  const document = new Document()
  const buffer = document.createBuffer()
  const node = document.createNode('Hero').setExtras({ blendlink_id: 'hero-id' })
  document.createScene('Scene').addChild(node)
  const input = document.createAccessor('time')
    .setType('SCALAR')
    .setArray(new Float32Array([0, duration]))
    .setBuffer(buffer)
  const output = document.createAccessor('translation')
    .setType('VEC3')
    .setArray(new Float32Array([0, 0, 0, 1, 0, 0]))
    .setBuffer(buffer)
  const sampler = document.createAnimationSampler().setInput(input).setOutput(output)
  const channel = document.createAnimationChannel()
    .setSampler(sampler)
    .setTargetNode(node)
    .setTargetPath('translation')
  document.createAnimation('Reveal').addSampler(sampler).addChannel(channel)
  writeFileSync(path, await new NodeIO().writeBinary(document))
}

describe('animation sequence generated contract', () => {
  it('validates exported Action clips and emits literal sequence metadata', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'blendlink-nla-sequence-'))
    try {
      const glbPath = join(directory, 'hero.glb')
      await writeAnimatedGlb(glbPath)
      const recipe: SceneRecipe = { ...DEFAULT_SCENE_RECIPE, animationSequence: sequence }
      const generated = await generateSceneModule({
        glbPath, url: '/hero.glb', exportName: 'hero', recipe,
        sidecar: {
          fps: 24, animationSequence: sequence, markers: [], empties: [],
          curves: [], textures: [],
        },
      })
      expect(generated.manifest.recipe?.animationSequence).toEqual(sequence)
      expect(generated.manifest.animationSequence).toEqual(sequence)
      expect(generated.module).toContain('animationSequence: {"name":"Hero Story"')
      expect(generated.module).toContain('"clip":"Reveal"')
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('blocks a stale NLA Action reference or trim before publication', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'blendlink-nla-sequence-invalid-'))
    try {
      const glbPath = join(directory, 'hero.glb')
      await writeAnimatedGlb(glbPath, 0.5)
      const recipe: SceneRecipe = { ...DEFAULT_SCENE_RECIPE, animationSequence: sequence }
      await expect(generateSceneModule({
        glbPath, url: '/hero.glb', exportName: 'hero', recipe,
      })).rejects.toThrow(/trims to 1\.0000s.*0\.5000s/)
      await expect(generateSceneModule({
        glbPath, url: '/hero.glb', exportName: 'hero',
        recipe: {
          ...recipe,
          animationSequence: {
            ...sequence,
            strips: [{ ...sequence.strips[0], clip: 'Missing' }],
          },
        },
      })).rejects.toThrow(/GLB contains: Reveal/)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('refuses recipe/sidecar sequence drift instead of choosing one silently', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'blendlink-nla-sequence-drift-'))
    try {
      const glbPath = join(directory, 'hero.glb')
      await writeAnimatedGlb(glbPath)
      await expect(generateSceneModule({
        glbPath, url: '/hero.glb', exportName: 'hero',
        recipe: { ...DEFAULT_SCENE_RECIPE, animationSequence: sequence },
        sidecar: {
          fps: 24,
          animationSequence: { ...sequence, name: 'Stale Story' },
          markers: [], empties: [], curves: [], textures: [],
        },
      })).rejects.toThrow(/differs between the scene recipe and Blender sidecar/)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
