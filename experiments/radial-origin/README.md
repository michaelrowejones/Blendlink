# Exact Radial origin constant

The exact positive-zero origin is now qualified for both actual WebGPU and
WebGL2 through WebGPURenderer on the measured Apple Metal and SwiftShader
profiles. It emits the existing `const_vec3` route before GPU initialization or
hardware attestation. Nonzero coordinates retain the separate M5 Pro WebGL-only
route.

This requires explicit literal Sides **3, 8 or 12**, Roundness **1**, either
Normalize state, pinned Blender 5.3.0 build `02f0899d78e3` EEVEE, and stored
Float32 XY words exactly `[0,0]`. **The native node defaults, Sides 5 and Roundness
0, remain unsupported.** This is not general default-node or default-preview
scene acceptance.

The pinned native source assigns regular/full-roundness radius to
`length(+0,+0)` and explicitly overwrites phase with positive zero at the origin.
Normalize produces `(.5,0,0)`; otherwise radius subtracts one and produces
`(0,-1,0)`. Discarded rotation can remain NaN. No multiplication by zero,
quantization, seam epsilon or output repair is used. Raw RNA Float32 storage
checks prevent negative zero or subnormals from masquerading as the origin.
The channel-boundary vector-mean refusal remains enforced.

The [closed receipt](evidence.json) records six native material settings and six
saved Final sources with direct, group and reroute bindings. The independent
EEVEE atlas supplies 36 component/sign/residue witnesses and two carrier
controls. Raw tuples are asserted first; an authored reversible
`coordinate+(0,1,0)` carrier keeps published colors nonnegative without changing
the native Radial inputs or body. Across all four API/profile combinations,
24 raw and 24 Final case-runs, 72 install/dispose cycles and 12 resize/DPR frames
compare **30,544 Float32 words with zero differences**. Source emission traps GPU
init/platform queries and records zero calls. The [numeric contract](numeric-contract.json)
requires exact words; it adds no approximate tolerance.

There is no Radial shader kernel, uniform, hardware guard or fresh Radial
renderer requirement on this constant route. This proves the portable origin's
library/material-channel behavior, including the default WebGPU API on the
measured profiles. It does not prove a complete Preview Studio session, general
scene appearance, portable nonzero coordinates or unchanged official demo
acceptance.

The union origin and M5 matrices share the recorded 121-input SDK/addon Python
source snapshot fingerprint
`d75965928da3a499c84b9e19128748dc294e52a7b39589f5ad7ffb84645d608b`.
Their own source fixtures remain separately pinned. Their independently emitted
JavaScript runtime fingerprint is
`fc842bc653dd7505aa2c54a0e0ac54dd28131f197f76eb1291484f9c29204959`.
These are explicit lineage statements for those two transactions; older Width
and other node proofs retain their own captured lineages.

After a coordinated source/build freeze:

```sh
node experiments/radial-origin/matrix.mjs artifacts/verification-radial-origin-NEW
```

For only the no-render/no-GPU source policy, add `--policy-only`. That policy
mode alone grants no numerical or Final credit. The driver never rebuilds the
SDK. No shader/compositor node count changes: this extends an existing partial
shader entry only.
