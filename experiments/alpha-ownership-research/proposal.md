# Explicit Alpha ownership: scoped interoperability proposal

Source/design only. No SDK changes or GPU/native jobs. Installed upstream Three is 0.184.0; exact local primary source and SDK byte pins are in [sources.json](sources.json). The initial Vertex Alpha named refusal remains necessary until a separate installed-material proof closes.

## Actual upstream ordering

NodeMaterial.setupDiffuseColor forms its color from an explicit colorNode, or materialColor if absent. It multiplies the complete result by COLOR_0 when vertexColors is enabled, assigns diffuseColor, then multiplies its alpha by opacityNode (or materialOpacity when no explicit node exists). Alpha testing, alpha hashing and the opaque-alpha override occur afterward.

materialColor must not be assumed alpha-free: its fallback includes material.color multiplied by the material.map sample, which can carry RGBA. VertexColorNode requests vec4. Thus simply disabling COLOR_0 alpha would still leave texture-carrier or explicit colorNode alpha multiplying the owned opacity. Conversely, setting final alpha after super.setupDiffuseColor is too late: the wrong earlier alpha may already have discarded the fragment.

The existing installer copies actual source material properties, including maps and vertexColors, into the clone. It should retain that behavior for unrelated programs. The new behavior is opt-in only when a qualified new VertexAlpha expression owns the Alpha channel and an actual opacityNode was built. Do not infer ownership merely from the presence of any opacityNode, a material name, or a VertexAlpha expression used in Roughness/Emission.

## Smallest candidate

Construct private MeshStandardNodeMaterial / MeshPhysicalNodeMaterial subclasses only for that opt-in installation. Override the public setupDiffuseColor method, using a common small helper rather than copying Three's complete shader body.

Before calling the unchanged superclass method, supply a temporary colorNode whose alpha is exact one and disable its implicit vertexColors multiplication. Build its RGB by explicit ownership:

- Without a complete supplied program colorNode, use `vec4(materialColor).rgb`, multiplied by `vertexColor().rgb` only if the original vertexColors flag and actual color attribute apply. This preserves source color factors, maps and native RGB vertex-color fallback while dropping their alpha contribution.
- With a complete supplied program colorNode, use `vec4(originalColorNode).rgb` directly. Do not reapply the shipped carrier's map, factor or vertex color: the program owns complete RGB. This is a scoped explicit-channel ownership rule, not a rewrite of all existing color programs.

Set the temporary node to `vec4(rgb,1)`, call super.setupDiffuseColor, and restore the clone's original colorNode / vertexColors properties in `finally`. The superclass retains instance/batch RGB handling, opacity-node evaluation, alpha test/hash and opaque treatment. It must receive the correct alpha before those operations. No source material, texture, geometry or global Three prototype is modified; no texture is created to strip alpha.

Use distinct stable subclass type/cache tags plus an explicit color-ownership cache discriminator. A clone with the same input nodes as an ordinary material must not reuse the ordinary multiplied-alpha shader. The temporary changes happen synchronously during graph setup and must be restored even on builder failure. The superclass captures the temporary node in its statement stack; verify emitted graphs do not lazily re-read the restored colorNode property. Keep the generic installer unchanged unless the new ownership option is explicitly selected.

This rule intentionally leaves old non-VertexAlpha programs unchanged. It also leaves the existing generic RGB-only behavior untouched outside this opt-in path. Source-specific carrier refusal remains for unsupported or ambiguous material contexts until proven.

## Bounded actual-GPU intermediate probe

Use the real installer/properties and the real Three material setup, with a test-only `outputNode=diffuseColor`. NodeMaterial's normal setup calls setupDiffuseColor before applying this public late output override. This exposes the actual diffuse RGBA after its alpha rules without comparing EEVEE transparency dithering, lighting or beauty. Do not use fragmentNode to replace the setup body, an independent hand-written multiply shader, or a fake builder result.

Set transparent=true, blending=NoBlending, tone mapping off and a Float32 RGBA/NoColorSpace target. That prevents blending and the opaque-alpha override from hiding the value. Use a small constant-valued raw Float32 scalar attribute with 0.1 and 1/3 controls, plus source RGB chosen from exact dyadic factors. Keep the mesh static and uninstanced to match the initial VertexAlpha domain. Run actual WebGPU and WebGL2, with API attestation. A direct raw-attribute output control separately captures the physical scalar interpolation; this ownership probe adds no new native interpolation claim.

The small matrix should include:

1. Vertex RGBA carrier and explicit Alpha node: original material shows carrier-alpha multiplication; owned material equals the raw scalar exactly once, with fallback RGB unchanged.
2. Texture RGBA carrier, with and without vertex RGBA: owned alpha ignores both carrier alpha factors while fallback material.color × map.rgb × vertex RGB remains correct. Include source opacity/alphaMap values to demonstrate that explicit opacity already owns those factors.
3. Complete program colorNode carrying a non-one alpha and an explicit Alpha node: output RGB equals the complete node's RGB, and alpha equals the scalar once. No implicit carrier multiplication.
4. Standard and Physical material variants; ordinary non-opt-in materials retain their old output/cache behavior. Reuse one renderer to catch shader-cache aliasing.
5. Separate alpha-test canary: threshold0.2 discards scalar0.1 and retains scalar1/3. This detects a too-late alpha repair. Keep alphaHash/coverage out of the initial numeric probe rather than relying on stochastic beauty.
6. Repeated installation/disposal preserves original material properties, maps, buffer data, callbacks and texture ownership; temporary clone properties restore after successful compilation and an induced builder failure.

Predeclare exact scalar/control word equality and exact dyadic RGB controls. If physical interpolation differs from the stored scalar, record it separately using the direct attribute control; do not widen an ownership tolerance after failure. The earlier native VertexAlpha field proof remains separate. No support or original-scene acceptance follows from this source proposal.

## Retained actual-material GPU pilot

[The research receipt](pilot.json) records 64 actual material case-runs and 16,384 compared Float32 words, all exact, on both actual WebGPU and WebGL2 through Apple M5 Pro Metal. Thirty-two cases per API cover Standard/Physical, raw scalar 0.1/1/3, legacy and owned vertex-RGBA/texture-RGBA, combined carriers, complete program colorNode, alphaTest0.2 and opaque behavior. Legacy controls show the extra carrier-alpha product; scoped owned variants produce alpha once, preserve fallback dyadic RGB or complete owned RGB, apply alpha testing before output and retain opaque alpha1. Clone graph properties restore after real compilation and a deliberately throwing shared setup callback; original material properties/maps stay unchanged and the installer does not dispose the source texture. Distinct actual shader cache tags separate ordinary/owned and complete/fallback variants.

This is not a closed saved-Final qualification: selected source pins and first-pixel/count observations are retained, while independent full raw readback archives and software-profile evidence are absent. Native EEVEE interpolation/dithering and authored-scene appearance are separate. The current production refusal is not removed by this pilot.

The actual installer was changed only in the isolated checkout to accept a research constructor factory. Its complete property-copy and slot-installation body otherwise ran unchanged. The SDK file has been restored before committing research. `installer-factory.patch` plus original/transformed hashes in `pilot.json` retains the exact two-line research seam. It must not become the production public API. To replay in an isolated checkout at the recorded source base, apply the retained patch, run `node experiments/alpha-ownership-research/run.mjs <fresh-artifact-directory>` with Node24, then reverse the patch. Do not apply it to the user's active production tree.
