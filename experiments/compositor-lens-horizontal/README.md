# Classroom horizontal Lens Distortion: bounded 5.3 CPU port

The original Classroom graph contains `Lens Distortion` in
`compositor:Compositing Nodetree`, with Type Horizontal, raw Float32 Dispersion
`.20000000298023224`, positive-zero Distortion and false Jitter/Fit. Its input
is `Mix.004.Result_Color`, and output feeds `Blur.001.Image`.

This port implements the operator first on a terminal direct Render Layers
Image. It does not yet admit the original preceding Mix/Ghosts or downstream
Blur graph. Classroom remains blocked. The closed owned-family adapter and
`mac-53` profile now schedule one fresh source/native/Final/installed transaction
through `scripts/test-node-port.mjs`. Manifest lifecycle declares that required
transaction; it does not itself grant support. A fresh frozen full transaction now
passes, as recorded below. The earlier pilots remain historical zero-credit evidence.

The native CPU kernel samples red/blue at positive/negative normalized offsets,
retains the original green texel, and averages the three sampled alphas. The
authored dispersion times the native factor five is exactly one pixel after
Float32 rounding. Native `(x+.5)/width` ordering is retained; Translate's
reciprocal-based mapping would not establish the same NPOT weights.

The port reuses the qualified Displace CPU bilinear staging, the existing
Map Value integer-significand exact division-by-three helper, shared owned
RTT/table lifetimes, FRAME producer scheduler, native subprocess archive and
runtime snapshot helpers. It owns one RGBA32F input target (maximum 64 MiB logical
color data), three RGBA32F mapping tables (384 KiB persistent CPU data/nominal GPU
texture bytes), and two private zero uniforms. Mapping regeneration is
O(width+height); warm frames do not upload new maps. Driver/storage overhead,
caller source rendering and the outer output target are separate costs.

Source policy is an actual no-render/no-GPU Blender check with positive original
controls, rerouted output, wrong/linked/animated controls, wrong producers,
downstream consumers, budget refusal and a late raw-input mutation.

## Historical prototype pilots

The independent CPU sampling pilot uses the existing `NativeCompositorReference`
helper, with native copy controls and actual Lens nodes. It stores eight renders
across 8×8, 13×9, 17×13 and 26×18, with signed/HDR colors and varied alpha. Saved
source scenes precede the private native Image injection; that injection earns no
new Image-source or scene-beauty credit.

The browser sampling pilot imports the production builder from a fresh source-
matched runtime snapshot. Its direct texture oracle, resize, guard and ownership
checks are research. The separate public pilot exports four original saved
sources, captures the actual installed HalfFloat scene-pass input on all four
tuples, evaluates those exact words with native CPU copy/Lens controls, then
compares public installed linear/display output using the existing same-frame
probe. These pilots do not constitute the trusted complete node-port transaction.
Every run retains actual API identity; a fallback cannot impersonate WebGPU.

Historical independently closed pilot results: eight sampling-oracle renders,
48 sampling frames / 41,760 exact words, four saved-original Final exports,
32 actual-input native renders, and 48 installed cases / 41,760 exact linear
words. All 41,760 separate display words meet the unchanged Raw projection gate;
1,134 display words differ with maximum clamped absolute error
`7.450580596923828e-9`, exact alpha and no nonfinite-class differences. Caller
restoration passes. Sampling runs own four textures and release all four.

The first Metal sampling run retained 16 alpha-only one-ULP errors because GPU
constant division by three became reciprocal multiplication. Reusing the
existing exact integer-significand Map Value helper fixes that stage without
changing the native oracle or a tolerance. Earlier source-policy legacy-node
construction, empty export script-census, snapshot dependency and evidence-route
failures remain zero-credit namespaces; none was an SDK arithmetic fix.

Run in fresh output directories, using the pinned Blender and current built SDK:

```sh
node experiments/compositor-lens-horizontal/policy.mjs artifacts/lens-policy-fresh
node experiments/compositor-lens-horizontal/capture-native.mjs artifacts/lens-native-fresh
node experiments/compositor-lens-horizontal/compare-cpu.mjs \
  artifacts/verification-lens-horizontal-native-r1 /tmp/lens-cpu-replay.json
node experiments/compositor-lens-horizontal/run-browser.mjs \
  artifacts/verification-lens-horizontal-native-r1 /tmp/lens-metal-fresh metal
node experiments/compositor-lens-horizontal/run-browser.mjs \
  artifacts/verification-lens-horizontal-native-r1 /tmp/lens-software-fresh software
```

For saved Final/public evidence, run `export.mjs NATIVE FRESH_OUTPUT`, then
`run-browser.mjs NATIVE FRESH_OUTPUT metal|software baseline FINAL` for each
profile. `capture-public.mjs METAL_BASELINE SOFTWARE_BASELINE FRESH_OUTPUT`
creates same-pixel native references. Finally run
`run-browser.mjs NATIVE FRESH_OUTPUT metal|software compare FINAL PUBLIC_NATIVE`
for both profiles. `verify-pilot.mjs` and `verify-public.mjs` independently close
the archived native/source/runtime/readback files; their usage strings list the
exact required inputs. These individual pilot-reader statuses retain zero support credit; formal
qualification closes their raw readbacks plus the complete control matrix separately.

Build and 1,853 unit tests pass (seven optional skips), along with 110 release-policy
checks, 236 pipeline passes (three platform skips), eleven Python audits and
29 focused Lens/Displace/Map Value guards. These were candidate-stage checks and did not change capability or versioned
coverage records.

To regenerate qualification, run the registered saved-source/export/installed matrix
against the combined frozen source through the shared runner and independent
closed reader:

```sh
node scripts/test-node-port.mjs compositor-lens-horizontal --profile mac-53 \
  --blender /Applications/Blender.app/Contents/MacOS/Blender \
  --evidence artifacts/verification-lens-horizontal-fresh
```

The complete transaction requires all four
Metal/SwiftShader × WebGPU/WebGL2 tuples, saved-original Final preservation,
actual FRAME producer orientation, viewport/DPR resize, cancellation, detached
preparation, repeat installation and saved-original disposal/epoch failures.
Historical pilot success cannot satisfy this transaction. Predeclare numerical
gates and retain failed namespaces. The fresh qualification below passes this
complete control matrix; metadata credits only its bounded partial scope.


## Frozen full qualification

On frozen source `b3b8495c7397a95b46adf6ba3cc5d0b8b56f739c`, the shared
`mac-53` transaction in
`/tmp/scenetoweb-v1-qualified-lens/artifacts/verification-lens-horizontal-formal-joint-r2`
qualified with stable inputs and production evidence. Both automatic closes,
a third replay and the independent root replay are byte-identical: receipt SHA256
`8b1e29336d6bbc311aebe15d0f983dcdbe42396958c7d7f484871a9e83ef6953`.
The [qualified evidence record](qualified-evidence.json) pins source, runtime,
input digest, commands and archived paths. Manifest/reader status does not
automatically promote a node. The reviewed capability map credits only Blender
5.3 as **partial**; 4.2/5.2 remain unsupported.

Four source graphs and four saved-original Final exports produced 20 native
same-pixel cases / 40 CPU renders. Metal and SwiftShader each exercised actual
WebGPU and WebGL2. All 48 installed cycles / 41,760 primary linear words and the
separate 48 direct sampling frames / 41,760 words match unchanged native RGBA
words exactly. The independent display audit retains 1,134 word differences,
maximum clamped RGB error `7.450580596923828e-9`, exact alpha and nonfinite
classes under the unchanged `3e-5` Raw projection gate; display is not bit-exact.
Eight unique actual Python prefixes close native, source-policy and Final archives.
Source-policy two positive / fourteen refusal controls earn no numerical credit.

The physical resize/DPR sequence `[1, 1.25, 1, 2]` runs for three cycles on each
of four tuples. Twenty guard refusals cover the pixel budget before allocation,
mismatched/offset/scissored output targets and source extent; each recovers with
no oversized owned allocation. Four saved-original renderer disposal cases each
destroy four physical handles exactly once. Four detached preparations and four
cancellations verify disposal/AbortError and caller restoration. Ordinary
installation disposal retains its separate zero-live-owned-handle assertion.
Formal R1 remains failed: the observer conflated manager bookkeeping after saved
renderer disposal with direct native-handle destruction. The isolated b3 observer
fix measures those handles and preserves ordinary-dispose assertions; fresh R2
reruns all numerical and lifecycle gates without widening them.

The scope is one **terminal direct Render Layers Image → Horizontal Lens** with
raw dispersion `.2f` (`0x3e4ccccd`), positive-zero Distortion and false Jitter/Fit.
Only pinned Blender 5.3.0 build `02f0899d78e3`, macOS arm64 CPU compositor
AUTO/FULL requests qualify; numeric references capture FULL. Source and physical
output extents must be 4..8192, square-pixel zero-origin full frame and at most
4,194,304 pixels. Linked/animated controls, other modes/dispersion, arbitrary
finite/computed/transformed producers, upstream Mix/Ghosts, downstream Blur,
chained Lens nodes, borders/crop, mismatched domains, GPU compositor and other
native profiles remain refused/unqualified. The private same-pixel Image oracle
grants zero source Image, Render Layers beauty, EEVEE material,
Cycles-versus-Three or whole-scene appearance credit. **Original Classroom is
still blocked and not accepted.** Its actual `Mix.004 → Lens → Blur.001` branch
is outside this terminal slice. The target/table costs above are bounded resource
accounting, not an FPS benchmark.

Replay from the frozen checkout (readers write auxiliary evidence files, so run
sequentially):

```sh
PATH=/tmp/scenetoweb-apply-tooling:$PATH \
  node experiments/compositor-lens-horizontal/verify.mjs \
  artifacts/verification-lens-horizontal-formal-joint-r2/proof \
  /tmp/scenetoweb-lens-horizontal-root-close.json
```
