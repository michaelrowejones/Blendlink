# Exhaustive uint32 normalization CPU research

All **4,294,967,296** uint32 inputs matched raw Float32 words between the
integer RN-even law below and the independent C++ expression
`float(u) / float(UINT32_MAX)`. The retained owned run used Apple clang 21,
C++20, `-O3 -fno-fast-math -ffp-contract=off -pthread`, eight disjoint ranges,
and took **0.669161708 seconds** inside the process (0.818697 seconds including
process startup). This is CPU research with **zero live-node, Blender, GPU or
saved-Final credit**. It does not establish the behavior of dynamic uint casts
in any shader compiler or backend.

For `u > 0`, let `shift = max(floor(log2(u)) - 23, 0)` (0 through 8), and
`mant = u >> shift`. When `shift > 0`, increment `mant` exactly when the
discarded remainder exceeds half, or equals half and `mant` is odd. Return
`float(mant) * bitcastFloat((95 + shift) << 23)`. Zero follows the shift-zero
path without evaluating a negative shift or `clz(0)`.

The rounded mantissa is at most 2^24 and therefore converts exactly; the scale
is exactly 2^(shift-32). No result is subnormal. This is precisely the
nearest-even rounding of `u / 2^32`. Under binary32 nearest-even,
`float(UINT32_MAX)` is 2^32 (word `0x4f800000`); dividing a rounded uint by this
power of two is exact. Thus the reference expression has the same rounding
law. Both computations remain separately present in the compiled worker loop:
the reference is AArch64 `ucvtf s0, w11, #32`, while the proposed law uses
`clz`, integer shifts/remainder/tie tests, exact mantissa conversion and `fmul`.
The loop compares both raw words and records independent sums and shift counts.

The runner requires IEEE binary32 at compile time, tests `FE_TONEAREST` in
main and each worker before/after scanning, and never calls an FPU-mode setter.
The shift histogram is exactly
`[2^24,2^24,2^25,2^26,2^27,2^28,2^29,2^30,2^31]`.
Mismatches are zero; both word sums are `4521614024961425408`.

Run in a fresh output directory:

```sh
python3 experiments/uint32-f32-exhaustive/run.py --out artifacts/verification-uint32-f32-new
```

The runner compiles and copies its owned source, emits assembly, bounds the
exhaustive process at 115 seconds, and refuses a partial census, changed source
or compiler bytes, mismatches, changed rounding mode, or incomplete strata.
[evidence.json](./evidence.json) pins the actual compiler, source, runner,
executable, assembly and raw output SHA256s. The complete captured executable
and assembly remain in the recorded private worktree artifact directory; the
repository retains reproducible source and the compact measured receipt.
No SDK, Blender installation, fixture, coverage or support metadata was changed.
