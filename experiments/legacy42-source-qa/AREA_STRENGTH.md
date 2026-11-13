# Native Area strength qualification

This is a Blender source-contract check, not a browser radiometric or general
transformed-light fidelity claim. The existing Three RectAreaLight mapping,
shape restrictions, shadow policy and unit conversion are unchanged.

The pinned [4.2 EEVEE source](https://github.com/blender/blender/blob/v4.2.0/source/blender/draw/engines/eevee_next/eevee_light.cc)
multiplies light color by `energy` in `Light::sync` and divides rectangular
radiance by pi times world area in `Light::shape_radiance_get`.
[4.2 RNA](https://github.com/blender/blender/blob/v4.2.0/source/blender/makesrna/intern/rna_light.cc)
has no separate `exposure` or `normalize` property. The adapter qualifies those
absences only for actual `(4, 2, 0)`, supplying zero exposure and normalized
power. Present fields, even malformed ones, remain authoritative. Other missing
schemas are refused. Modern fields and the stock exporter remain unchanged.

Run from the repository root with an isolated user resource directory:

```sh
BLENDER_USER_RESOURCES=/tmp/blendlink-area-user \
BLENDLINK_QA_AREA_REFERENCE=/tmp/blendlink-area-reference \
"$BLENDLINK_BLENDER" --background --factory-startup -t 1 \
  --python-exit-code 1 \
  --python experiments/legacy42-source-qa/area-strength-reference.py

BLENDER_USER_RESOURCES=/tmp/blendlink-area-profile-user \
"$BLENDLINK_BLENDER" --background --factory-startup -t 1 \
  --python-exit-code 1 \
  --python packages/blender-addon/tests/area_strength_profile_check.py
```

The render independently integrates irradiance at the center of a white
Lambertian plane from a finite rectangle. The five common cases vary area,
power, object scale and scene unit scale; modern versions add unnormalized and
exposure controls. A low EEVEE light threshold isolates normalization from the
separate, energy-dependent influence fade. The original default-threshold
observation is retained as research; it is not silently fitted or represented
as the normalization result. The center integral allowance is 0.2%, covering
EEVEE's finite-area lighting approximation; it is not a node pixel budget.
Power times four, modern normalization times area, exposure times two, and
scene-unit invariance are checked separately with exact center ratios.

Actual native 4.2.0 / 5.2.0 / 5.3.0 pass all five / seven / seven cases. The
center errors are below 0.1%; centers agree across those profiles. Full images
are retained with SHA-256 but are **not** asserted identical across versions.
No browser pixels are used to choose light parameters.

Local receipts in the isolated QA worker are `artifacts/area-strength-strict-42`,
`-52`, `-53` (32-bit EXR, RGBA32f, hashes and reference JSON), with process logs
at `/tmp/blendlink-legacy42-area-strict-{42,52,53}.log`. The focused native RNA
and source-preservation checks also passed all three versions.
