# Live scene image + binary Ellipse — feasibility only

A bounded useful extension is feasible. The [retained pilot](receipt.json)
compares an independently drawn actual Three scene image with native CPU
compositor image/Mix operations and then a browser prototype. It implements no
new SDK admission and earns no support, saved Final, native scene-equivalence
or original-demo acceptance credit. Existing production still refuses this
RenderLayers composition.

The owned scene contains lit standard-material geometry, a partly transparent
box, an opaque sphere and transparent background. Two physical sizes13x9 and
17x13 were independently captured on each actual API. The actual Three
ScenePass had its default HalfFloatType target with0 MSAA samples. A separate
Float32 image-address copy fixed readback orientation without consulting a mask
prediction. Raw ScenePass colors were copied to Float32 and hashed. Each API
has its own baseline: small PBR pixel differences between APIs are not hidden
or treated as compositor failure. Observed RGB range was0..0.872071 and alpha
values0,0.375,1; HDR, signed-zero and exceptional inputs were not established.

The fresh guarded Blender5.3 process forced both Cycles and compositor toCPU.
Four actual native Image→EXR32 copy controls preserved2,704 words exactly,
including fractional alpha. The same pixels then fed untouched native
ShaderNodeMix RGBA/MIX with actual Ellipse Mask factors0/1. Image and separate
Alpha routes produced8 native reference images. The native graph uses only
owned fixture Image substitutions; no production node/function is replaced.
The native mask program was extracted separately through the admitted literal
route. The complete RenderLayers graph is not falsely classified as admitted.

A fresh browser context independently redrew the same scene with the same
ScenePass precision and checked its baseline bits before composition. A
prototype TSL binary endpoint select combined the real pass Image or Alpha
with foreground `[.125,.25,.5,.75]`. All8 browser compositions matched5,408
native RGBAFloat32 words with0 differences. The native references came from
Blender's operator, not the browser select's predicted output. This is a small
feasibility pilot rather than a closed production qualification matrix.

## Proposed first production slice

- Exactly one direct current-scene/current-view-layer RenderLayers Image or
  Alpha source, resolved from one renderer-owned current-frame ScenePass. Image
  and Alpha must share the same underlying pass texture and frame. Require
  matching physical dimensions, identity/full-frame domain and square pixels.
- One varying literal Ellipse, initially ADD with Mask0/Value1 and Rotation+0.
  Admit RGBA/MIX with binary factor and one bounded constant foreground first;
  do not broaden existing four-operation masks into arbitrary interpolators.
- Budget actual scene sampler1 + varying row sampler1 + at most6 display LUTs,
  total8. Reject extra registered pre/post effects and other texture producers
  initially. Preserve constant/zero-size scheduling, ownership and resize rules.
- Keep the source profile pinned to5.3 CPU compositor semantics. Renderer scene
  output is a supplied image, not a claim that Three PBR equals Cycles or EEVEE.

Pinned [Mix source](https://raw.githubusercontent.com/blender/blender/02f0899d78e374b63e7181d9061e1f7ab03419cc/source/blender/nodes/shader/nodes/node_shader_mix.cc)
calls native color blending; its [MIX arithmetic](https://raw.githubusercontent.com/blender/blender/02f0899d78e374b63e7181d9061e1f7ab03419cc/source/blender/blenkernel/intern/material.cc)
uses `(1-factor)*A + factor*B` acrossRGBA. A binary endpoint shortcut still
needs explicit exceptional/signed-zero controls before qualification: negative
zero may be canonicalized by native addition, and zero times infinity can yield
NaN. No universal endpoint equivalence follows from this finite pilot. First
close a declared finite input/foreground domain with its exact native behavior;
never silently clamp/repair a source frame to make it match.

Alpha Over is a separate follow-up: translucent foregrounds introduce actual
premultiplication, straight-alpha choice and blend arithmetic. Binary mask
factors do not reduce every Alpha Over case to choosing one input. This pilot
therefore grants it no new scope.

## Staged proof needed before a partial port

1. Add a typed single-pass identity-source contract and closed graph edges,
   with explicit rejection of other scenes/layers/passes, external Images,
   transformed windows, extra effects and sampler overflow. Verify source
   preservation and first-invalid boundaries before rendering.
2. Capture independent actual Three ScenePass baseline pixels per backend and
   profile, at the same half-float precision, with scene state held fixed.
   Validate them against independently drawn baseline frames; no PBR=Cycles
   comparison is used. Include transparency, HDR/signed finite inputs,
   exceptional/refusal controls, shapes near strict edges and live resizes.
3. In a private native reference copy, inject those pinned baseline pixels into
   the owned RenderLayers links using the established image-oracle pattern.
   Keep unmodified native Ellipse/Mix operations and check raw Image-copy
   controls before composition. Save the original authored RenderLayers source
   separately, without saving the injected reference over it.
4. Export that actual original source to saved Final. Load its real GLB and
   presentation through the production pipeline. Independently draw the same
   exported scene/camera before composition, verify its ScenePass precision and
   frame identity, capture/revalidate the baseline, then compare the production
   composited pixels to native CPU image references. Repeat both APIs/profiles,
   DPR/resizes, source/presentation pins, state restoration and disposal.
5. Freeze fixture/runtime/vendor/native inputs and close an independent reader.
   Only that fresh transaction can change capability metadata. Frame-cost
   measurements must exclude proof readback, native conversion and reference
   generation; account for pass/lookup traffic and resource lifetime separately.

No implementation or shader arithmetic was added to the SDK in this experiment.
The retained local launcher identity/progress/logs/raw images are research
artifacts, not an immutable full-family numerical receipt.

## Reproduce locally

Use Node24, the pinned installed Blender and a new directory. The runner owns
only its browser fixtures and output; native launch uses the shared guarded
launcher exactly as in the recorded invocation. Run `run.mjs baseline`, then
`reference.py` in fresh guarded Blender (directory after `--`), then
`run.mjs compare`, then `verify.mjs`, all with the same output directory. Never
substitute predicted mask pixels for native reference renders. Failed paths
must be retained rather than overwritten by later attempts.
