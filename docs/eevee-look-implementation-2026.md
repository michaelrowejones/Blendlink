# EEVEE look implementation

Approved 2026-09-07. Implement the shader/compositor fidelity roadmap, targeting
close EEVEE appearance with interactive scenes. Pixel-identical Cycles transport
is not required. Original artist scenes remain unchanged.

## Work and acceptance

- [x] Align Preview Studio with the generated WebGPU starter. Verify native
  WebGPU and its WebGL2 backend, initial shader failure, recovery and disposal.
- [x] Transport the authored display transform, exposure and look through a
  verified color program. Compare HDR/color samples against Blender.
- [x] Import connected compositor graphs, preserving branches, parameters and
  alpha; start with color/math/mix/alpha/blur/glare and named input passes.
  Compare identical input images against Blender and report unsupported nodes.
  Initial pass providers are Combined, Alpha and opaque Depth.
- [x] Extend live material channels and normal/physical response, with explicit
  supported shader families and EEVEE reference comparisons.
- [x] Automatically use live programs or safe static fields without rewiring
  supported source graphs. Existing object-attribute controls remain live.
- [x] Provide Blender/browser reference comparison and actionable differences
  in Preview Studio, with source camera ownership and a saved-frame comparison.
- [ ] Transport shader/compositor animation curves and parameter-only updates
  through uniforms; cache individual static fields across unrelated graph edits.
- [ ] Extend whole-scene comparison acceptance to moved lights and animation,
  additional render passes/AOVs, Bump and the remaining compositor kernels.

Changes are accepted through real export/browser tests, not node-name coverage.
Existing explicit website presentation choices continue to take precedence.
Any approximation records its source and limits. Runtime failures must retain
the last working preview and remain recoverable.

## Delivered and verified

The reproducible suite at `experiments/eevee-look-differential` regenerates its
Blender references and passes 186 cases across WebGPU and WebGL2 (182 numeric
comparisons, four intentional Fog Glow refusals). Initial shader failures,
failed candidate retention, successful replacement and simulated graphics-loss
recovery pass on both backends. **Retry preview** now recreates a failed renderer
from the current compiled scene without requiring another Blender save. The
unit suite passes 809 tests with two skips; the consumer and package gates pass,
including Vanilla and R3F consumers built from the tarball.
The stylized diorama comparison uses Blender's
active orthographic camera, procedural materials and authored AgX contrast look.

Display programs preserve the original OCIO LUT samples and typed operations;
they do not approximate the entire look with a newly sampled small LUT. Supported
exposure, gamma and white balance are composed before export. Premultiplied
alpha is handled at the display boundary, including alpha-zero emission.

Automatic material fallback uses the established static channel baker only when
EEVEE and Cycles select the same Principled root. A live Alpha channel cannot
accidentally count as the determinism proof for a baked channel. The generated
carrier retains unrelated physical defaults, and export restores the source
material bindings. The hybrid and compositor structure tests pass in Blender
5.1.2 and 5.2 LTS.

## Remaining limits

This is an EEVEE-oriented transfer pipeline, not universal node support. Normal
and AOV compositor passes, Fog Glow/Ghosts/Streaks, nonseparable or extended Blur,
Bump and named/object/world Normal Map, arbitrary OCIO grading operations and
display CurveMapping still need implementations. Procedural World shaders and
renderer-specific indirect lighting are not reconstructed. Animated material or
compositor node trees refuse static translation instead of freezing one frame.

Existing whole-publication and atlas caches continue to operate. The new hybrid
channel path does not yet persist each static field independently across
unrelated material parameter edits. The comparison slider uses browser CSS
compositing; its Difference view is a visual aid, not a calibrated error metric.
Numeric normal-field agreement does not certify matching multi-closure physical
shading. These limits must remain visible when describing fidelity or completion
of the broader roadmap.
