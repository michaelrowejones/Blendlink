# Native Vector Transform channel proof

The fixture measures all 27 World/Object/Camera × Point/Vector/Normal combinations plus an independent color control on two authored owners sharing one noncentered mesh. Frames 1 and 3 include animated transforms, reflected axes, a nonuniform parent, and a scaled/sheared camera. It saves separate Cycles and EEVEE sources. Actual Final publication exports each source in both glTF Y-up and Blender Z-up. The browser loads those real GLBs, exact pinned material programs, and the actual exported camera through GLTFLoader and installs the production materials. It reads the installed Base Color channel directly, independent of a browser light rig.

Each native version has 448 cells per browser backend: 4 Final scenes × 2 frames × 2 owners × 28 cells. Cycles comparisons use 2e-6 absolute tolerance. EEVEE additionally permits one final native half-float ULP, calibrated by the independent color control. No per-node or per-pixel fitted offset is used. Object and camera matrices are independently compared with native Blender matrices.

Native normal semantics are explicit in the program. Cycles passes an identity Normal transform through and otherwise normalizes inverse-transpose results. EEVEE always normalizes; camera legs use direction matrices. EEVEE before 5.2 also uses direction matrices for object legs, whereas 5.2+ uses inverse-transpose object legs. Camera magnitudes are removed while reflections are preserved. The active browser camera remains live context. No exported camera snapshot substitutes for it.

The supported domain requires finite float32 matrices and the selected inverses. Normalization currently requires a verified nonzero literal normal. Generated/GPU instances, 5.3 Light space, undefined normalization, and nonidentity transforms feeding bounded procedural frequency analysis refuse explicitly. These are channel-function proofs, not full lighting/BSDF pixel parity.

```sh
BLENDLINK_VECTOR_TRANSFORM_REFERENCES=artifacts/verification-vector-transform/native53 \
  /Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \
  --python-exit-code 13 --python packages/blender-addon/tests/vector_transform_check.py

BLENDLINK_VECTOR_TRANSFORM_NATIVE=artifacts/verification-vector-transform/native53 \
BLENDLINK_VECTOR_TRANSFORM_BUILT=1 \
  npm exec --yes --package=node@24 -- node packages/blendlink/scripts/run-vitest.mjs \
  experiments/vector-transform-differential/export.test.ts

npm exec --yes --package=node@24 -- node experiments/vector-transform-differential/run.mjs \
  artifacts/verification-vector-transform/native53 --built
```

Set `BLENDLINK_VECTOR_TRANSFORM_BLENDER` for other native executables. Omit `BLENDLINK_VECTOR_TRANSFORM_BUILT` and `--built` to test source. Built mode requires actual built Final export plus independently derived whole-program TypeScript emission equality, then snapshots immutable production bytes and maps. It refuses stale dependencies even when an entry file's timestamp looks fresh.

`camera_axes_check.py` separately proves camera, animated camera child, static nested camera, and unrelated object world matrices in both bases. The production correction changes animation outputs only: raw-Z camera quaternion correction; Y-up camera scale-axis correction; and Y-up camera-child translation/rotation correction. Static node/matrix transforms remain exact. Shared output accessors/samplers are copied before transformation. CUBICSPLINE quaternion derivatives receive the same linear multiplication without normalization. Matrix-authored animation targets, ambiguous hierarchies, and unverified storage refuse.

```sh
BLENDLINK_CAMERA_AXES_REFERENCES=artifacts/verification-vector-transform/camera53 \
  /Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \
  --python-exit-code 13 --python packages/blender-addon/tests/camera_axes_check.py
npm exec --yes --package=node@24 -- node experiments/vector-transform-differential/check-camera.mjs \
  artifacts/verification-vector-transform/camera53
```

The latter repeats those matrix comparisons using the actual Three GLTFLoader and AnimationMixer. The fixture has been run on Blender 4.2, 5.2 and 5.3. Evidence lives under `artifacts/verification-vector-transform/`.
