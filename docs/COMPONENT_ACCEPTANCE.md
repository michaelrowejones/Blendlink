# Portable component acceptance record

**Evidence date:** 2026-07-23  
**Public renderer baseline:** `WebGLRenderer`  
**Catalog decision:** all 21 first-party adapters are **Preview**

This record separates an implemented adapter from an observed artist-to-browser
result. A green presence check means that the real Blender-authored record
survived serialization, compilation, generated typing, R3F installation, and a
production-browser render. It does not by itself establish aesthetic quality,
every-field correctness, accessibility, temporal stability, or a mobile GPU
budget.

## Ground truth

- Before reinstall, Blender loaded a mixed/stale `0.8.0` extension containing
  only 2 scene entries and 8 object entries. Its runtime tree differed from the
  repository in 16 files and omitted 5. The exact path, fingerprints, and
  screenshots are in [the installed add-on audit](research-installed-component-ui-2026.md).
- The clean installed production fixture recorded on 2026-07-21 contained the
  original 11 scene effects plus 8 object behaviors. That historical headless
  run reported `total=19`, `preview=19`, and `production=0`.
- The source catalog now contains 21 unique first-party types after adding
  Shadow Catcher and Contact Shadows. Because Contact Shadows can target either
  Scene or Object, raw target-menu counts are 12 Scene and 10 Object; those
  counts must not be added to infer unique types.
- The retained deterministic `ComponentLab.blend` fixture now serializes all 21
  unique records through the installed add-on. The normal compiler emits a
  schema-v3 manifest, generated TypeScript, one animation, and the compact
  fixture GLB. The 2026-07-23 production Next dogfood gate observes `21/21`,
  the `12 scene / 9 object` catalog, installed Contact Shadows, and the Shadow
  Catcher `mask` mode through the real generated R3F scene.
- The site owns the non-public route, Canvas, loading/failure/retry UI,
  navigation policy, DOM accessibility affordance, and deployment. Blendlink
  remains a package/compiler rather than a route or application framework.

## Acceptance matrix

Legend: **Yes** is observed in the cited integrated path; **Source/test** is
lower-level evidence; **Gap** means the requested evidence has not been
collected. `Pixel delta` is only an effectiveness/presence gate.

| Component | Live Blender UI | Serialize / compile | Published R3F browser | Strongest observed result | Important remaining evidence | Status |
| --- | --- | --- | --- | --- | --- | --- |
| Bloom | Yes | Yes | Yes | 8.2035% pixel delta; HDR stack position observed | HDR/LDR reference matrix, emissive selection, exposure/alpha, reviewed default, physical GPU cost | Preview |
| Vignette | Yes | Yes | Yes | 49.3849% delta; restrained authored default visible | Flat-field/tint/softness oracles, transparent alpha, aspect/DPR review | Preview |
| Chromatic Aberration | Yes | Yes | Yes | 2.5611% delta; radial record in post-LDR stack | Channel-centroid oracle, transparency, desktop/mobile DPR stability | Preview |
| Pixelation | Yes | Yes | Yes | 2.7697% delta; geometry-aware path installed | Exact CSS-block/DPR matrix, depth/normal edge oracle, transparent alpha render | Preview |
| Contrast-Adaptive Sharpen | Yes | Yes | Yes | 0.3151% delta; bounded five-tap approximation | Step/noise/halo oracle, reviewed strength, physical GPU timing; not reference FidelityFX CAS | Preview |
| Tilt Shift | Yes | Yes | Yes | 7.0490% delta; pre-tone-map order observed | Focus-plane/camera-motion oracle, edge artifacts, host-selected High policy and GPU timing | Preview |
| Ambient Occlusion | Yes | Yes | Yes | 0.2018% delta; N8AO pass and SMAA order observed | Nonblack tint render, orthographic/glass/depth/noise matrix, target-device cost | Preview |
| Outline | Yes | Yes | Yes | 1.6151% delta after ALPHA-blend fix; exact custom object/camera layer masks survive depth/mask renders, a thrown render, and disposal | Selected/hidden/X-Ray matrix, thickness across DPR, transparency and moving camera | Preview |
| Color Grade | Yes | Yes | Yes | Nonidentity authored LUT: 27.7620% delta, MAE 1.237386 | Intensity sweep, tetrahedral comparison, color-space reference, CORS/authenticated load failures | Preview |
| Depth of Field | Yes | Yes | Yes | 1.1100% delta; object focus record resolved | Depth ladder, moving target/camera, foreground/background and transparent-edge oracles | Preview |
| Kuwahara Painterly Filter | Yes | Yes | Yes | 0.3177% delta; bounded single-pass approximation | Reviewed edge/direction references, animated temporal stability, quality matrix, real mobile GPU budgets | Preview |
| Keep Visible Through Objects | Yes | Yes | Yes | Blocker reached opacity 0.18; shared/multi-material and overlapping-owner restoration pass in browser harness | Skinned/instanced/transparent/moving occluders, longer camera sequence | Preview |
| Open Link on Click | Yes | Yes | Yes | Authored intent reached host callback; URL parsing rejects whitespace-prefixed `javascript:`; nearer occluder blocks activation | Required semantic-control contract, keyboard/focus/screen-reader/mobile coverage, router/analytics policy | Preview |
| Emphasize on Hover | Yes | Yes | Yes | Scale reached 1.20 and restored; nearer occluder blocks activation | Keyboard/focus equivalent, touch design, reduced motion, competing animation ownership | Preview |
| Start Hidden | Yes | Yes | Yes | Hidden at ready; overlapping owners retain state until final disposal | Animation/visibility-authority policy and repeated Preview-swap evidence | Preview |
| Look At Object | Yes | Yes | Yes | World-direction dot to target greater than 0.99; overlapping owners restore correctly | `keepUp=false`, nonuniform parent detection, animated parent/target matrix | Preview |
| Play Animation on Click | Yes | Yes | Yes | Exported clip changed pose after trusted click; mixer calls `uncacheRoot()` on disposal | Keyboard semantics, loops/speed UI coverage, repeated-install memory profile | Preview |
| Audio Source | Yes | Yes | Yes | Positional audio attached; linear-distance parameters and load cleanup verified | Normal-browser autoplay block/resume state, audible device and mobile/Safari evidence | Preview |
| Play Audio on Click | Yes | Yes | Yes | Trusted click changed the attached source to `isPlaying` | Keyboard semantics, blocked-context retry, toggle/overlap and audible-output matrix | Preview |
| Shadow Catcher | Source/headless | Yes | Yes, plus focused Three Chrome | The generated 21-component R3F lab reports authored `mask`; focused pixels prove 2,473 partial-alpha Mask pixels, 2,648 for descendant Group, depth-only Occluder change, 54,600 nonzero-RGB Additive pixels, and layer/material restoration | Actual pinned-Needle side-by-side pixels, alpha-tested coverage, cross-browser/device and physical GPU cost | Preview |
| Contact Shadows | Source/headless | Yes | Yes, plus actual pinned-Needle differential | The generated 21-component R3F lab reports the installed runtime target. Settled differential masks are byte-identical at `512 x 512` (MAE/RMSE/max `0`, Pearson `1`), with five draws each; Static performs `5` then `0/120`, omits unused depth/stencil, and preserves application camera layers | Auto-fit/backface/alpha-cutout browser matrices, context-loss pixels, mobile/physical GPU timing, baked/AO conflict matrix | Preview |

Rigid Body and Collider are not additional runtime components.
Their UI is explicitly labeled **Export Designations**: Blender authors typed
portable intent, while the website chooses Rapier or another simulation runtime.

## Browser evidence and limits

The effect isolation test uses the generated descriptor and GLB. A baseline
installs the eight object records; each effect case installs those eight plus
one exact Blender-authored scene record. Because entering the composer path
itself changes pixels, an identity-LUT control derived from the generated Color
Grade record supplies the same-pipeline reference. A pass requires a visible
canvas, the authored component ID in the resolved post stack, more than 0.01%
changed pixels, and RGB MAE above 0.01. Repeat-control noise was zero.

This Chrome/ANGLE/SwiftShader run proves shader/runtime effectiveness and catches
zero-output or blank-canvas regressions. It is not evidence of mobile speed or
visual correctness. The source audit and selected fixes are in
[the visual-effects research note](research-component-visual-effects-2026.md);
the machine report and PNGs are emitted by the dogfood site's
`e2e/blendlink-component-effects.visual.spec.ts`.

The behavior path has two layers: a plain-Three real-browser diagnostic harness
for security, input, overlap, failure, and disposal; and the exported production
R3F lab for all nine object-targeted records. See
[the behavior/accessibility audit](research-component-behaviors-accessibility-2026.md).
The R3F host supplies a real DOM link for Open URL and explicitly states that
the remaining Canvas click/hover actions do not yet have automatic keyboard
semantics.

## What is implemented versus still required

Implemented and verified in this pass:

- installed-content fingerprinting, catalog-count diagnostics, and rejection of
  same-version stale/mixed add-on installs;
- discoverable labeled catalog actions and truthful Preview/support badges;
- real Blender-to-generated-GLB-to-R3F component lab and production publish
  for the expanded 21-component fixture (the original 19 plus Contact Shadows
  and Shadow Catcher);
- isolated rendered presence evidence for all 11 effects;
- URL, full-root occlusion, shared mutation leases, material restoration, and
  mixer cleanup fixes for behaviors;
- source-proven Outline, LUT intensity, AO tint, Bloom fallback/default,
  Pixelation alpha, and Kuwahara-description corrections.

Still gaps, not silently accepted:

- a recorded manual add/edit/disable/copy/paste/remove/save-close-reopen cycle for
  every individual type in Blender;
- same-scene connected Preview-versus-published pixel agreement for all effects;
- effect-specific reviewed references, disabled-state restoration frames,
  transparent canvases, animated cameras, mobile dimensions, and DPR 1/2/3;
- plain-Three rendered effect screenshots separate from the shared installer's
  R3F path;
- Firefox/Safari/iOS/Android, screen-reader/switch-control, and audible audio;
- initial compile/first-use timings, steady-state passes/frame time/render-target
  memory, combined-stack cost, and physical-device Low/Balanced/High budgets.

Those gaps are why every adapter remains Preview. All 21 now share one
production generated-scene presence path; Shadow Catcher additionally has a
focused browser pixel path, and Contact Shadows additionally has an actual
pinned-Needle mask differential. Presence still does not promote either
component beyond Preview without the remaining visual/device matrices above.
