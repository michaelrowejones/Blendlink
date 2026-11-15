# Native Noise offset arithmetic diagnostic

Research only: no support, Final or EEVEE material credit. This reuses the proven public `FramebufferOracle` RGBA32F surface and the original canonical pre-Naga GPU_METAL library. Hash, normalized hash and `random_vec3_offset` bodies are unchanged.

The retained capture `/tmp/scenetoweb-noise-offset-native-r1` uses Blender 5.3.0 build `02f0899d78e3`, actual Metal on Apple M5 Pro. Nineteen draws comprise five exact storage calibrations, two seed controls, and six stage planes for each of literal and uniform seeds. Each plane is 2×1: seed3 then seed4, XYZ helper lanes and alpha1. Total: 40 calibration words and112 stage/control words. The inner stage took830.50ms; the guarded process took2237ms. Compilation is included, so these are diagnostic wall times rather than steady GPU timings.

Both source forms give identical raw words. Independent host hash, u32 RN-even conversion and normalized unit controls all match. All six original native offsets match explicit native `fma(unit,100,100)`. Only seed3.z distinguishes it from separate rounded multiply/add:

| Stage | Word/value |
| --- | --- |
| Hash | 4011860407 |
| Normalized unit word | 1064247330 |
| Original native offset / explicit native FMA | 1128360077 |
| Separately rounded multiply/add | 1128360078 |

The same result with a uniform seed excludes literal-only constant folding for this witness. It identifies fused arithmetic as the matching model; it does not inspect emitted Metal ISA or establish a general compiler equivalence. The five other seed/lane pairs cannot distinguish the two models. Binary64 host `unit*100+100` is exact before final Float32 rounding for these bounded binary32 inputs. The independent normalized control uses the existing exhaustively proved u32 RN-even law, not the observed native cast.

The generic and GPU_METAL libraries differ only by20 canonically guarded forward declarations; the reader rechecks remaining token identity, all source/tool pins, native binary/owned prefix archive, submitted shaders, raw words, literal/uniform equality and the exact witness. It rejects raw-byte tamper and row-census mutation. GPU lease was released immediately after capture; browser comparisons are a separate Proc-owned diagnostic.

```sh
PATH=/tmp/mrj-tooling:$PATH node experiments/noise-offset-native-diagnostic/run.mjs \
  /tmp/FRESH-native-offset /tmp/scenetoweb-shader-kernel-next-build/generated-r5
PATH=/tmp/mrj-tooling:$PATH node experiments/noise-offset-native-diagnostic/verify.mjs \
  /tmp/scenetoweb-noise-offset-native-r1 \
  /tmp/scenetoweb-shader-kernel-next-build/generated-r5 /tmp/FRESH-offset-close.json
NOISE_OFFSET_NATIVE_CORPUS=/tmp/scenetoweb-noise-offset-native-r1 \
NOISE_OFFSET_NATIVE_GENERATION=/tmp/scenetoweb-shader-kernel-next-build/generated-r5 \
PATH=/tmp/mrj-tooling:$PATH node --test experiments/noise-offset-native-diagnostic/verify.test.mjs
```

The guarded archive binds the original absolute capture script path. Replay the reader in the retained worktree `/tmp/scenetoweb-noise-offset-native-diagnostic`; a different checkout can read the evidence but must not pretend its path was the original invoked script.
