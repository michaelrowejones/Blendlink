# Image Coordinates Pixel proof

This isolated port introduces an explicit `INT_VECTOR2` field only for fresh Blender 5.3 Pixel outputs. Existing serialized `VECTOR` values remain three-component. Native references cover direct RGBA, padded float3, reroutes, and artist node groups; no scalar/int or float2 conversion is admitted.

The first domain is a direct full-frame Render Layers Image with square pixels, no borders, no spatial or neighborhood operations, and physical dimensions from 1 to 8192. Actual renderer size and image size must agree, including DPR. Dynamic resize reuses the same built program and saved-Final pipeline. Source profile is the measured Blender 5.3.0 `02f0899d78e3` macOS arm64 CPU and Metal compositor settings. This is a partial node port.

`capture.mjs CPU|GPU` creates native references and four actual saved Final exports per source setting using fresh owned Python caches. `run.mjs --built [--final]` tests both actual APIs on the selected `BLENDLINK_TEST_PROFILE=metal|software`. The browser calibrates row orientation using an independent image-load pattern before evaluating coordinates, compares Float32 words, checks invalid schema refusals, and tests resize/DPR transitions. Final resource controls draw the actual imported PBR scene before installing the pipeline, then require three disposal/reapply cycles to restore the exact renderer-owned DFG lookup cache object and preserve source materials/callbacks.

Raw artifacts are ignored machine-local files under `artifacts/verification-image-coordinates`; the tracked receipt links their hashes. Run `verify.mjs` to close the complete matrix against current native, emitted runtime, immutable browser snapshots, saved scene, fixture and asset pins. No full-node coverage or broad performance claim is made.

After a coordinated build, replay the closed serial GPU matrix:

```sh
PATH=/tmp/mrj-tooling:$PATH node experiments/compositor-image-coordinates/matrix.mjs artifacts/verification-image-coordinates
```

This command performs no build or workflow trigger. GPU ownership must be held for its native and browser phases. Every tested render uses an actual one-shot renderer animation-loop frame: Three's FRAME-scoped scene pass must advance before a resized image is checked. Frame IDs are recorded and required to increase; direct repeated render calls outside the animation loop are not a valid resize test.
