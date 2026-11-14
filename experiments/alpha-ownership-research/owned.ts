import { MeshStandardNodeMaterial, MeshPhysicalNodeMaterial } from 'three/webgpu'
import { materialColor, vertexColor, vec4 } from 'three/tsl'
/** Research only: actual upstream superclass builds all alpha/discard rules. */
export function withOwnedDiffuse(material: any, builder: any, body: () => void): void {
  const originalColor = material.colorNode, originalVertex = material.vertexColors
  let rgb = vec4(originalColor ?? materialColor).rgb
  if (!material.ownsProgramColor && originalVertex && builder.geometry.hasAttribute('color')) rgb = rgb.mul(vertexColor().rgb)
  material.colorNode = vec4(rgb, 1); material.vertexColors = false
  try { body() } finally { material.colorNode = originalColor; material.vertexColors = originalVertex }
}
export class OwnedStandard extends MeshStandardNodeMaterial {
  static get type() { return 'SceneToWebResearchOwnedAlphaStandardV1' }
  constructor(public ownsProgramColor: boolean) { super() }
  setupDiffuseColor(builder: any): void { withOwnedDiffuse(this, builder, () => super.setupDiffuseColor(builder)) }
  customProgramCacheKey(): string { return super.customProgramCacheKey() + ':owned-alpha-v1:' + Number(this.ownsProgramColor) }
}
export class OwnedPhysical extends MeshPhysicalNodeMaterial {
  static get type() { return 'SceneToWebResearchOwnedAlphaPhysicalV1' }
  constructor(public ownsProgramColor: boolean) { super() }
  setupDiffuseColor(builder: any): void { withOwnedDiffuse(this, builder, () => super.setupDiffuseColor(builder)) }
  customProgramCacheKey(): string { return super.customProgramCacheKey() + ':owned-alpha-v1:' + Number(this.ownsProgramColor) }
}
