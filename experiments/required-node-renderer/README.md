# Required material renderer: actual Final proof

A Blender5.2.0 EEVEE material connects Magic Factor to Roughness while Base Color
is the portable constant `[.125,.25,.5]`. Before the contract fix, the actual
Final GLB loads with `roughness=1`, no roughness map, and a successful legacy
carrier check that never fetches its sidecar. The independent native scalar
witness varies from about .156 to .931. This demonstrates a lost material
channel; it is not a new Magic kernel or whole-lighting parity claim.

Fresh exports declare exact required op/model selectors in a versioned
`live-material-programs-v1` mesh marker. The legacy reader matches actual
source-material programs across all channels before refusing. The CPU audit
checks every actual binding, its declaration, companion bytes, and the real
channel builder. Old Squeeze declarations, normal/camera gates, and the old
unmarked portable no-fetch path remain covered by focused tests. Radial is not
registered by this change.

The proof uses actual Final output and GLTFLoader. After the fix the same Magic
source and exact program sidecar produce the same installed Roughness values
on both recorded Metal APIs, while legacy now fetches once and refuses by name.
The mixed-material source exports one mesh with two primitives; its marker
unions Magic and Squeeze selectors. Each loaded primitive refuses for its own
matched program, both node materials install, and disposal restores their
original material/callback ownership. This is renderer-contract evidence,
not additional source-backend or numeric-node coverage.

Build only the intended isolated checkout, with Node24 and the qualified
Blender5.2 binary:

```sh
npm run build --workspace blendlink
BLENDLINK_REQUIRED_RENDERER_EVIDENCE="$PWD/artifacts/verification-magic-roughness" \
  "$BLENDLINK_BLENDER" --background --factory-startup --python-exit-code 1 \
  --python experiments/required-node-renderer/magic_roughness.py
BLENDLINK_REQUIRED_RENDERER_EVIDENCE="$PWD/artifacts/verification-magic-roughness" \
  "$BLENDLINK_BLENDER" --background --factory-startup --python-exit-code 1 \
  --python experiments/required-node-renderer/multi_material.py
node packages/blendlink/dist/cli.js export \
  --blend artifacts/verification-magic-roughness/MagicRoughness.blend \
  --out artifacts/verification-magic-roughness/website
node packages/blendlink/dist/cli.js export \
  --blend artifacts/verification-magic-roughness/MagicSqueezeMulti.blend \
  --out artifacts/verification-magic-roughness/multi-website
node experiments/required-node-renderer/run-magic.mjs --expect-required
node experiments/required-node-renderer/run-multi.mjs
```

Without `--expect-required`, the single-material runner intentionally asserts
the historical bug and belongs to a baseline checkout. Existing before-fix
artifacts are preserved separately; do not overwrite them with fixed output.
Each positive runner freezes the built runtime and browser fixture before
launch. Reports and relative file hashes are bound by
[`proof-receipt.json`](proof-receipt.json). The before-fix research capture
predates the committed browser-fixture snapshot mechanism; its actual native,
Final and runtime bytes remain preserved and are not relabeled as a newer run.
