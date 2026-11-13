# Actual Final image binding and coordinate proof

The native fixture saves 11 real material graphs using two shared, patterned
129×129 PNGs plus a small embedded image. Cases include multiple external
images per Principled/Emission channel, independent Linear/Closest samplers,
negative exact integer coordinates, signed zero, adjacent negative texels,
named authored UV attributes, UV math, and mixed embedded/external sampling.
Private Cycles emission copies measure the native channel values without
changing the saved source graphs.

The Final test runs the actual compiler, publication pipeline and audit. It
checks exact shipped PNG bytes, hashes, dimensions and image table bindings,
all material programs, source-file preservation, and `verifyAll`. The browser
uses the actual Final GLB via GLTFLoader and the production material installer,
reads the installed channel directly, and requires 11 applications, no skips,
and exactly two shared external image fetches on both browser backends. The
2e-6 tolerance is absolute; no fitted pixel correction is applied.

The source proof caught two previously cancelling orientation defects: glTF
UV attributes use the opposite V convention from the Blender graph, while PNG
decoded rows are top-down. Production binding converts UV values into Blender
coordinates before authored graph math. External bitmap decoding flips image
rows into the same bottom-up convention as embedded DataTexture sampling.
Native negative-integer Closest selection happens before sampling orientation.
The CPU Final auditor uses the same row convention. Constant and modified UV
cases prevent those two errors from hiding by cancelling each other.

```sh
BLENDLINK_MULTI_IMAGE_FIXTURE=artifacts/verification-multi-image/native53 \
  /Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \
  --python-exit-code 13 --python packages/blender-addon/tests/multi_image_program_check.py

BLENDLINK_MULTI_IMAGE_NATIVE=artifacts/verification-multi-image/native53 \
BLENDLINK_MULTI_IMAGE_BUILT=1 \
  npm exec --yes --package=node@24 -- node packages/blendlink/scripts/run-vitest.mjs \
  experiments/multi-image-differential/export.test.ts

BLENDLINK_MULTI_IMAGE_NATIVE=artifacts/verification-multi-image/native53 \
  npm exec --yes --package=node@24 -- node experiments/multi-image-differential/run.mjs --built
```

Set `BLENDLINK_MULTI_IMAGE_BLENDER` for another executable during Final export.
Omit `BLENDLINK_MULTI_IMAGE_BUILT` and `--built` for source testing. Built browser
mode requires built Final export and the shared whole-program emission equality
guard before copying immutable production modules and maps. It never rebuilds
shared dist. Native versions 4.2, 5.2 and 5.3 have retained evidence under
`artifacts/verification-multi-image/`.
