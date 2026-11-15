# Canonical shader kernel bridge pilot

Research only: no production changes, Blender parity, saved Final credit or node support.

Blender’s canonical shader tool lowered Gradient, Checker and White Noise without kernel-body edits. The bridge imports six native entrypoints, reads dependencies from compiler metadata, uses exact Blender compatibility macros, and delegates preprocessing to clang. Naga 30.0.2 validates GLSL 450 → WGSL and emits GLSL ES 300. Three calls generated functions through `wgslFn`/`glslFn` and shared `CodeNode` libraries. A strictly checked, disposable stage envelope satisfies Naga’s entrypoint requirement.

All 64 draws completed across Metal/SwiftShader × WebGPU/WebGL2. Pixel-center calibration is exact. All **14,336 primary words match between GLSL and WGSL within each adapter profile**. Independent Checker and split-U32 hash controls are exact.

The complete numerical gate **failed**: radial Gradient has four violating words per tuple, maximum 14 ULP on Metal and 16 ULP on SwiftShader. Maximum absolute error is `5.960464477539063e-8`. Both `abs ≤ 2^-20` and `ULP ≤ 8` were required; gates remain unchanged. Other finite analytic checks pass. These are JavaScript analytic references, not Blender outputs. Wrappers measure RGB and Fac; original Color alpha is not independently measured.

Direct desktop GLSL failed WebGL2 typing rules. Naga’s typed ES round trip resolves those conversions without handwritten arithmetic substitutions. Earlier adapter/parser and interpolated-UV calibration failures remain retained in `evidence.json`; the final input fixture uses `screenCoordinate / 8` without changing kernels.

Standalone tool build: 24.63 seconds. Final lowering/translation/validation commands: 0.188 seconds. Maximum installed shader size: 24,676 bytes WGSL, 27,056 bytes ES. Per-tuple compilation totals were 39–569 ms; CPU submission and readback timings are separate in `closed.json`. These are local diagnostics, not GPU timings or measured engineering speedups.

## Reproduce

Use existing repository dependencies. `build-tools.py` creates only an isolated tool directory; its Naga bottle is macOS arm64-specific.

```sh
python3 experiments/shader-kernel-bridge-pilot/build-tools.py --blender-source /path/to/pinned/blender --out /tmp/new-tools
python3 experiments/shader-kernel-bridge-pilot/generate.py --blender-source /path/to/pinned/blender --shader-tool /tmp/new-tools/shader_tool --naga /tmp/new-tools/naga/naga-cli/30.0.2/bin/naga --out /tmp/new-generated
node experiments/shader-kernel-bridge-pilot/run.mjs /tmp/new-generated /tmp/new-metal metal
node experiments/shader-kernel-bridge-pilot/run.mjs /tmp/new-generated /tmp/new-software software
node experiments/shader-kernel-bridge-pilot/verify.mjs /tmp/new-generated /tmp/new-metal /tmp/new-software /tmp/new-closed.json
```

The reader deliberately writes a failed result and exits nonzero. Retained replay inputs are `/tmp/scenetoweb-shader-kernel-build/{generated-r4,browser-r4-metal,browser-r4-software}`; replay must match `closed.json` byte-for-byte. Coordinate GPU work before rerunning captures.

## Limits and licenses

This adapter supports three pure libraries and known compiler output grammar. It does not solve resource bindings, symbol collisions across libraries, source defaults, derivative contexts, CPU MF translation or broader numerical equivalence. No runtime compiler or additional render pass is introduced.

Blender kernel/compiler sources are `GPL-2.0-or-later`. Generated derivatives retain GPL attribution. `sources.json` preserves exact upstream headers and SHA-256 pins; Blender’s complete license is `doc/license/GPL-license.txt`. Separate Naga MIT/Apache-2.0 and Three MIT notices are pinned in the receipt. This records provenance, not legal advice.
