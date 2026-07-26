# Contact Shadows: pinned Needle differential browser evidence

- Evidence date: 2026-07-23
- Fixture: `experiments/contact-shadows-differential-browser/`
- Raw report: `artifacts/contact-shadows-differential-browser-2026/evidence.json`
- Visual artifact:
  `artifacts/contact-shadows-differential-browser-2026/contact-shadows-differential-grid.png`
- Production changes made by this workstream: none

## Result

The settled WebGL mask from Blendlink is byte-for-byte identical to the mask
from the actual pinned Needle Engine `ContactShadows` class for the controlled
manual-volume fixture:

```text
512 x 512 RGBA8 raw target
alpha MAE:        0
alpha RMSE:       0
maximum error:    0
Pearson:          1
nonzero pixels:   30,548 in each implementation
alpha sum:        1,323,260 in each implementation
composite pixels darkened: 1,225 in each implementation
```

Both implementations performed the same five top-level auxiliary renders and
five observed GL draw submissions:

```text
depth capture -> horizontal wide -> vertical wide
              -> horizontal narrow -> vertical narrow
```

This promotes the controlled manual-volume algorithm from source-derived
similarity to real-browser differential evidence. It does **not** establish
parity for auto-fit, backface-only geometry, below-ground occlusion, every
material family, WebGPU, or a physical GPU.

Blendlink also produced three independently failing improvements over the
pinned Needle implementation:

1. A static Blendlink installation performed five auxiliary renders on its
   first frame and zero across 120 unchanged host frames. Three continuous
   frames performed `[5, 5, 5]`. Actual Needle `onBeforeRender()` performed
   `[5, 5, 5]` with its default `manualUpdate=false`.
2. Needle's two default render targets have `depthBuffer=true`; Blendlink's
   two targets have both `depthBuffer=false` and `stencilBuffer=false`.
   At `512 x 512`, this prevents two unused depth-renderbuffer allocations
   while preserving identical raw pixels. The browser-chosen depth format and
   driver memory are not inferred. This is configuration/allocation evidence,
   not a GPU-speed claim.
3. With an application camera using only layer 6, Needle's hard-coded layer-2
   display plane produced zero darkened pixels. Blendlink retained the camera
   mask (`64`) on its owned display plane and produced the same 1,225 shadow
   pixels without mutating the camera.

The exclusion cell also verifies Blendlink's public-API policy:

- a transparent caster produced zero regional mask sum;
- an opaque control produced `1,323,260`; and
- a material with `allowOverride=false` produced zero.

Pinned Needle also excluded the transparent caster, but the
`allowOverride=false` source produced a `1,198,370` regional mask sum. That is
recorded as observed behavior; it should not be generalized to every custom
material without more fixtures.

## What actually ran

The Needle side is not a reimplementation. The fixture imports the installed
runtime class from:

```text
experiments/needle-spike/node_modules/@needle-tools/engine/
  lib/engine-components/ContactShadows.js
```

It constructs the installed `Context` with an externally owned renderer,
Scene, and camera. The evidence asserts all three identities and
`isManagedExternally=true`, then invokes the real component lifecycle and
`onBeforeRender()` path. The complete Needle web component and generated glTF
loader are deliberately outside this narrow differential.

Needle creates its private helper hierarchy during its first auxiliary pass.
In the immediate external-context path, that helper has not received a world
matrix update yet. The fixture records this first setup mask separately
(`alphaMean=95.7743`, all `262,144` pixels nonzero), updates the new hierarchy,
and compares the settled second pass. This is a reproducible observation, but
not yet a universal Needle defect claim because the complete web-component
main-loop ordering is outside this fixture.

## Source identity

| Source | Version | SHA-256 |
| --- | --- | --- |
| Needle Engine | `5.1.7` | package identity in `docs/needle-baseline.json` |
| Needle `src/engine-components/ContactShadows.ts` | `5.1.7` | `e4bd8398c59d47ad3bd2eef66625b03c14f260e678d27a332a8ad73d4c17733b` |
| Needle compiled `lib/engine-components/ContactShadows.js` | `5.1.7` | `23857e9563de47c2d5cedf9635bbcf33fcad637bbf7b2c37c118ff31295189fd` |
| Needle Three fork | `0.169.19` / revision `169.19` | package identity in `docs/needle-baseline.json` |
| Blendlink | `0.8.0` | local production build |
| Blendlink `dist/threeContactShadows.js` | `0.8.0` | recorded in the run report because it changes with the build |
| Blendlink Three | `0.184.0` / revision `184` | installed package |

The pinned inventory gate remained the source-identity authority:

```text
npm run verify:needle-baseline
BLENDLINK_NEEDLE_BASELINE_VERIFIED 68 files, 5 version identities (2026-07-23)
```

## Exact browser gate

```text
node experiments/contact-shadows-differential-browser/run.mjs
BLENDLINK_CONTACT_SHADOWS_DIFFERENTIAL_PASSED needleDraws=5 blendlinkDraws=5 maskPearson=1.000000 staticLater=0
```

Toolchain recorded by the report:

- Chrome `150.0.7871.129`;
- WebGL 2 through ANGLE/Vulkan SwiftShader;
- `400 x 300`, DPR 1 application canvases;
- `512 x 512` contact targets; and
- no page, fixture, or console errors.

Constructing Needle's real Context imports loader infrastructure even though
the fixture loads no assets. To remain offline, the runner serves the pinned
local Three r169 Draco and Basis bytes for those unrelated preload requests
and supplies empty CSS for the Context menu's two UI-font requests. Those
substitutions do not participate in Contact Shadows rendering and are
recorded in the report.

## Capability status supported by this fixture

Implementation and evidence remain separate; the production state belongs in
the technique ledger.

| Capability ID | Narrow result | Relation supported | Evidence state |
| --- | --- | --- | --- |
| `NDL-CS-002` | Manual-volume five-pass WebGL mask | **Match** | **Verified** for this browser fixture: exact raw alpha and composite metrics |
| `NDL-CS-003` | Static idle policy | **Improvement** | **Verified**: Blendlink `5 then 0/120`; continuous and Needle default `[5,5,5]` |
| `NDL-CS-006` | Omit unused depth attachments | **Improvement** | **Verified allocation**: Needle `true`, Blendlink `false`; no GPU-time claim |
| `NDL-CS-009` | Respect application camera layers without mutation | **Improvement** | **Verified**: layer-6 camera, Needle `0`, Blendlink `1,225` darkened pixels |
| `NDL-CS-010` | Exclude `allowOverride=false` through public material ownership | **Improvement** | **Verified** for the named fixture; broader custom-material matrix pending |

## Remaining differential work

- Auto-fit with visible, hidden, instanced, skinned, and parent-transformed
  renderables.
- Front-only versus double-sided open geometry.
- Below-ground occluder on and off.
- Alpha-test and alpha-hash casters rather than transparent-only exclusion.
- Failure injection and exact renderer-state restoration in a real renderer.
- Context loss/restore and repeated install/dispose resource baselines.
- Integrated R3F demand Canvas and post-processing host paths.
- Physical integrated/mobile GPUs with
  `EXT_disjoint_timer_query_webgl2` before any GPU-speed claim.
- A freshly packed Blendlink consumer rather than the local `dist` build.
