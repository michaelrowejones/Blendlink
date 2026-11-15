# Blank Image finite-domain prototype

This is a bounded partial port for the pinned Blender 5.3 CPU compositor Blank Image. The native node always creates a finite texture, including when its Color is constant. The candidate retains that domain instead of treating the output as a global single value. Image Info, Image Coordinates, mixed graphs, linked Color/Size, animation and GPU-authored compositor sources remain outside the candidate admission.

The native Size input is `NodeSocketIntVectorPixel2D`. Actual stored signed Int32 values use Blender's `max(Size, 1)` rule before checking each extent against 8192 and the image against 4,194,304 pixels. Color is read as raw stored Float32 words: positive zero or positive normal values from 2^-16 through 16, with alpha at most one. Negative unlinked colors are clamped by RNA; the earlier linked signed/HDR research controls do not grant source admission.

The virtual-load optimization changes only the input texel load in the existing modern CPU finite-window realizer. Its coordinate maps, neighbor selection, rounding stages and weights remain shared. This preserves the tiny native Float32 fringes found around unequal odd image domains. It does not use a new integer rectangle approximation or a serialized pixel payload.

At the native default size of 1920 × 1080, the prototype avoids a 33,177,600-byte constant source RTT and its fill draw. It still owns two 256 × 32 RGBA32F mapping textures: 262,144 logical data bytes in total. This is a measured allocation and draw-count result, not an FPS benchmark or a claim of zero physical memory cost.

`pilot-receipt.json` retains the closed raw feasibility result: 11 actual freshly extracted programs, four actual API/profile tuples and 19,744 primary native comparison words with zero differences. First draws used one pass and two mapping uploads; unchanged physical extents and DPR changes made no further uploads. Invalid viewport attempts refused before mapping changes, valid recovery kept exact pixels, and disposal restored the physical texture census to zero. The independent reader checks the complete built runtime/vendor/fixture archive against current independently emitted JavaScript.

There is **no saved Final, public installer, category promotion, larger physical resize or saved-renderer-disposal credit** in this pilot. The native pixel references came from the separately closed CPU research capture, with newly extracted source programs and explicit reference hashes. The original pilot closure is retained verbatim; `close-pilot.mjs` adds a second CPU-only closure with the correctly derived runtime fingerprint and exact case census.

The source policy uses a fresh guarded Python prefix, denies GPU initialization and performs no render. It passes six positive layouts/settings with three repeated reads each, plus 18 refusal controls. These include verified stored negative-zero/subnormal words, groups and reroutes, and changes to source Color, Size, frame, mute, group mute and reroute links during extraction. The first failed policy attempt asserted a nonexistent JSON field and is retained with zero credit.

Run from the repository root with Node 24 and the pinned Blender installation:

```sh
PATH=/tmp/mrj-tooling:$PATH node experiments/compositor-blank-image/policy.mjs artifacts/verification-blank-image-policy-NEW
PATH=/tmp/mrj-tooling:$PATH npm run build --workspace=scenetoweb
PATH=/tmp/mrj-tooling:$PATH node experiments/compositor-blank-image/pilot.mjs artifacts/verification-blank-image-raw-pilot-NEW
PATH=/tmp/mrj-tooling:$PATH node experiments/compositor-blank-image/close-pilot.mjs artifacts/verification-blank-image-raw-pilot-NEW
```

The pilot requires the retained `artifacts/verification-blank-image-cpu-r2` native research capture. Every output namespace must be new. GPU execution must hold the team's serial rendering lease.

## Full qualification scaffold

The full matrix uses a jointly frozen SDK and declares 26 CPU reference frames and eight saved sources. The cases retain native defaults and ordinary raw Float32 colors (including 0.1 and one third), odd and portrait windows, grouped/rerouted producers, zero alpha, all-zero color, native Size clamping, identity domains and maximum thin source/output extents. Each saved source has independent native references for physical resize and DPR changes.

`capture.mjs` runs source policy and validates every actual native program before exporting any Final. It verifies the complete authored Python/addon source census against the installed built copies before `syncAll`. `run.mjs` archives the actual built runtime, vendor bytes, browser fixtures and generated descriptor. The browser uses the public `startThreeCompiledScenePreparation(...).promise` / `commit()` path with default prewarming, cancellation, uncommitted disposal, three installation cycles and caller scene/material/callback/renderer-state restoration.

Actual Final frames are measured twice: the normal installed Raw display is audited under the repository's existing clamp-to-[0,1] absolute 3e-5 projection contract, with alpha words and finite classes exact; a test-only quad then reads the **same actual installed pipeline's pre-display compositor node** into RGBA32F. Every recorded linear readback is archived independently and must match the native CPU words exactly. The reader recomputes display differences from separately archived display bytes; it never treats the display audit as a general bit-exactness claim.

The matrix also checks first/warm/resize mapping uploads, unchanged table identities, invalid viewport and over-budget recovery, no source RTT, and physical mapping-handle retirement exactly once after saved original renderer disposal. Complete pipeline caches are compared against an independently rendered no-compositor baseline; a known DFG cache is tracked by actual identity, not merely by count.

Only after the joint SDK integration/build and a serial rendering lease:

```sh
PATH=/tmp/mrj-tooling:$PATH node experiments/compositor-blank-image/matrix.mjs artifacts/verification-blank-image-JOINT
```

The inexpensive source-only assembly check may run earlier through a fresh guarded prefix:

```sh
PATH=/tmp/mrj-tooling:$PATH node experiments/compositor-blank-image/capture-source.mjs artifacts/verification-blank-image-source-NEW
```

The shared contract preflight and family schema tests cover omitted/extra/reordered cases, wrong source types, input-key order, duplicate lifecycle IDs and forged metrics. Schema fixtures grant no numerical credit. The first source-only setup attempt stopped before extraction because the temporary launcher used `/tmp` while its source census used canonical `/private/tmp`; the reference fixture now resolves every source path before pinning it. That failed archive is retained with zero credit.

## Qualified joint source snapshot

`evidence.json` retains the exact closed receipt from `verification-blank-image-next50-joint`, using the frozen joint SDK. The full proof passed: 26 native CPU renders, eight actual saved Final exports, 136 browser cases, 1,153,408 primary words and 4,036,800 independently archived pre-display Float32 words with zero differences. It also closed 272 resize frames, 96 committed installation cycles and 10 distinct guarded Python prefixes. A second independent reader run produced a byte-identical receipt.

The actual Raw display audit is separate: 224,640 words, 568 word differences, maximum absolute error 1.1920928955078125e-7 and maximum clamped absolute error 2.9802322387695312e-8. Alpha words and finite classes had zero differences. These observations satisfy the predeclared projection contract and do not turn it into a bit-exact display claim.

All four observed tuples (Apple Metal and SwiftShader, each with actual WebGPU and WebGL2) passed default public preparation/commit, cancellation, uncommitted disposal, physical resize/DPR, reapply and source/caller ownership checks. Each saved-dispose control observed two distinct original physical mapping handles, with individual destroy counts `[1, 1]`. The source/runtime fingerprint is `203d6afbad8e259bf816d765b390116758454d6016dfbb49fef41eb9b4da23c8`.

This qualifies only the stated terminal static CPU producer slice. Image Info, Image Coordinates, scene mixing, spatial/pointwise consumers, linked controls, native GPU authoring, shader/material equivalence and other version/build/host profiles remain unqualified. Earlier raw pilots and failed setup attempts retain their original zero-Final/zero-support credit and source lineage. Other ports keep their separate proof snapshots.

## Fresh automatic transaction

The registered `compositor-blank-image` manifest was subsequently executed from a fresh namespace. It performed its own clean/build, all native references, eight Final exports, all four actual API/profile tuples and two independent closed readers. The outer report closed `qualified` with `workspaceStable: true`, `productionCredit: true` and `supportPromotion: false`; category review remains separate.

`evidence.json` now links the exact current receipt in `evidence-next51-automatic.json`. The two automatic reader outputs were byte-identical. The runtime fingerprint is `9d64b4e4f40f0e795a5594e20d5115c94df8740cd1fd6afd54449cb0fed81a69`. Counts and numerical gates remain unchanged. The previous manual qualification is retained verbatim as `evidence-next50-manual.json` with its original `203d6a…` fingerprint; it has not been rewritten to appear current.
