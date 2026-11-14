# Constant World backgrounds

A qualified partial route preserves direct static Background → World Output
through the default source-presentation Final installer. Five unchanged sources
cover native .8/.05 defaults, dyadic products, zero strength and nonhalf products.
Fifteen EEVEE Metal half-film frames in EXR32 provide the reference. Seven saved
Finals include two authored ownership controls; source opt-out is also tested.
This is visible-background fidelity, with no IBL, whole-lighting, BSDF, HDRI,
Volume, procedural World, Cycles-render or legacy-renderer numerical credit.

[Current evidence](./evidence.json) closes the `ready-owned-pmrem-color-v2`
implementation: all four actual Metal/SwiftShader WebGPU/WebGL2 configurations,
180 browser frame pairs, 60 install cycles and 393,408 words. RGB stays within
the original absolute 2^-10 gate; alpha, black and declared dyadic controls are
exact. General RGB is bounded rather than word-exact: 85,752 linear and 19,056
Raw-display word differences, maximum errors 0.00019532442092895508 and
0.0001220703125. Raw/exposure zero is authored; AgX parity is not inferred.

Node rendering uses `THREE.Color` with the original authored Float32 radiance.
It creates no background texture or geometry and never writes backgroundNode.
Classic rendering retains its cube implementation outside this receipt. Three's
backgroundIntensity is texture-only: a later change does not alter a Color.
The source's Blender Strength is already applied. Actual takeover/intensity
controls preserve later caller Color ownership without claiming equivalence to
the former texture-intensity behavior.

The lighting path explicitly owns public PMREM generation and shares its ready
336×64 HalfFloat CubeUV target across detached and live installation. Every
measured cycle disposes the 32 KiB transient source and generator scratch, then
retires the result target once; adoption keeps it until caller texture disposal.
These are source-generation bytes, not total CPU or physical GPU memory.
Creation histograms record the actual color/depth derivatives and display targets.
All 60 cycles measured 13 preparation draws and zero synchronous commit draws.
In the declared off-camera-mesh fixture, the direct linear background clears
without a scene draw, and Final uses one display-transform quad. Resizing leaves
the ready PMREM version unchanged.

Exact texture identities and host state are restored. Geometry **counts** return
to the independently initialized shared-quad baseline; geometry identity is not
claimed by the full reader. The warm-up is a separate public constant QuadMesh,
strictly before measurement. An AST guard permits only that constant warm-up and
forbids supplying substitute fragment outputs to the World cases.

The [original cube-based evidence](./history/next24r4-evidence.json) remains
byte-identical, including its different preparation/draw/word-difference costs.
Original failed namespaces are preserved. The next30 run exposed a cold shared
fullscreen geometry baseline; next31 stopped before native work on the warm-up
scaffold guard, and next32 rejected the obsolete requirement for a background
mesh draw. The corrected full matrix retains the same native pixel/cleanup
limits and requires exact zero linear/one Final draw costs.

World/World-tree actions, drivers and effective NLA block Final and connected
preview export. Only an explicitly warned private draft may inspect a current
frame. Native engine-target selection, linked Volume refusal and all seven
source recipes are checked before expensive rendering/export. Unrelated ports
are not claimed freshly requalified.

```sh
PATH=/tmp/mrj-tooling:$PATH node experiments/constant-world-background/matrix.mjs artifacts/verification-constant-world-FRESH
```

Run from a frozen built checkout into a new directory. Native archives, actual
generated descriptors, both browser APIs/profiles, resource/adoption controls
and a fresh independent whole-program reader must all close.
