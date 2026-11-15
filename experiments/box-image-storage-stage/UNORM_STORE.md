# One CPU normalized-store correction

The separate `mip-model-unorm-store.mjs` changes one numerical modeling choice from frozen `09b5310`: it removes `Math.fround` around the multiply by 255 inside normalized-byte conversion. The original Float32 input, paired mip reductions, shared-sRGB intermediate semantics, image inputs and comparison bound remain unchanged. Every file present in `09b5310` remains byte-identical; [NOTICE.md](./NOTICE.md) adds upstream NVIDIA/Blender attribution without rewriting captured source or hashes.

The old expression could manufacture a half tie which did not exist in its Float32 input. For example, `Float32(0.5/255)` is `0.0019607844296842813`. Multiplying that input by 255 without another rounding gives `0.5000000295694917`, above the half threshold. The additional Float32 rounding produces exactly `0.5`, then ties-to-even selects byte 0 instead of byte 1. Native `imageStore` delegates to typed `texture->write`; the pinned source does not explicitly insert a Float32 multiply by 255. Thus this extra numerical step was an unproven model assumption, not a required source operation.

The revised conversion is still a **CPU typed-store hypothesis**. Its success on the captured samples does not establish all hardware normalized-store semantics. No native/GPU job, mip upload, tolerance change or production SDK edit was made.

Against the existing independent native filtered-LOD captures, the paired model now passes **all eleven sampled Non-Color normal-image LODs 0–10**, each with 64 source-authored coordinates (2,816 words in total), at the unchanged `2^-10` bound. Maximum error is 0.0002862812; LOD 10 remains exact. Previously failed odd LODs 1,3,5,7 had 34,39,19,26 component violations respectively; all now have zero. Previously passing even levels remain passing.

The sRGB image results are unchanged and still fail LODs 1–10. In particular, the current CPU model uses mathematical transfer functions and approximates typed GPU operations; pinned BSL uses Float32 constants, explicit reciprocal/multiply operations and native GPU `pow`, followed by typed storage/filtering. Those remaining operations need their own justified candidate and independent qualification. This pass stops after the single normalized-store correction rather than selecting another approximation from the existing answers.

The model/report scripts are separate additive files. `/tmp/scenetoweb-box-unorm-store-model-r2.json` records current model hashes and every result, and `unorm-store-evidence.json` pins it, the original report, native source and typed-write source. Earlier CPU attempt `/tmp/scenetoweb-box-unorm-store-model-r1.json` is retained; r2 adds the harness license header, with identical numerical results.

```sh
PATH=/tmp/scenetoweb-apply-tooling:$PATH node experiments/box-image-storage-stage/model-check-unorm-store.mjs /tmp/scenetoweb-box-storage-native-r3 /tmp/scenetoweb-box-unorm-store-replayed.json
BOX_STORAGE_NATIVE=/tmp/scenetoweb-box-storage-native-r3 PATH=/tmp/scenetoweb-apply-tooling:$PATH node --test experiments/box-image-storage-stage/unorm-store.test.mjs
```

Two CPU tests check the false-tie example and the full pinned PNG/raw-reference comparison. They require all normal-image levels to pass while preserving identical failing sRGB results and zero support credit. A complete node or scene port still requires the remaining sRGB/typed primitives, an actual custom-mip browser comparison, derivative/anisotropic BOX sampling, and full Mapping/NormalMap Final/installed material proof. Support, installed-scene and full Archviz credit remain zero.
