import {
  installThreeCompiledScene,
  type InstallThreeCompiledSceneOptions,
  type InstalledThreeCompiledScene,
} from 'blendlink/three'
import { ellieAnimation as compiledScene } from '../generated/ellieAnimation.gen'
import { createBakedScene } from '../generated/ellieAnimation.baked'

export type EllieAnimationSceneOptions = Omit<
  InstallThreeCompiledSceneOptions,
  'descriptor' | 'createBakedScene'
>

/** Blendlink generated this integration once; it is application-owned and
 * safe to edit. Call update() in the website frame loop and dispose() when
 * the route or scene is removed. */
export function installEllieAnimationScene(
  options: EllieAnimationSceneOptions,
): Promise<InstalledThreeCompiledScene> {
  return installThreeCompiledScene({
    ...options,
    descriptor: compiledScene,
    createBakedScene,
  })
}
