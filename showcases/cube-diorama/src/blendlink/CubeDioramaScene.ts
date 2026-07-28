import {
  installThreeCompiledScene,
  type InstallThreeCompiledSceneOptions,
  type InstalledThreeCompiledScene,
} from 'blendlink/three'
import { cubeDiorama as compiledScene } from '../generated/cubeDiorama.gen'
import { createBakedScene } from '../generated/cubeDiorama.baked'

export type CubeDioramaSceneOptions = Omit<
  InstallThreeCompiledSceneOptions,
  'descriptor' | 'createBakedScene'
>

/** Blendlink generated this integration once; it is application-owned and
 * safe to edit. Call update() in the website frame loop and dispose() when
 * the route or scene is removed. */
export function installCubeDioramaScene(
  options: CubeDioramaSceneOptions,
): Promise<InstalledThreeCompiledScene> {
  return installThreeCompiledScene({
    ...options,
    descriptor: compiledScene,
    createBakedScene,
  })
}
