# CPU compositor White Noise fields

The Blender 5.3 compositor now has a qualified partial route for a White Noise
node's native unlinked Vector input. Leave Vector unlinked for Uniform image
coordinates; 2D, 3D and 4D Value/Color are covered within the declared context.
The 4D W input uses the existing raw normal Float32/+0 fixed-copy rules.
The shader route and older Blender versions keep their existing scopes.

[Evidence](./evidence.json) records a fresh automatic pipeline transaction at
source `7c50dedfe84a941ede17297d909682d63355c738`: 54 production graphs, eight
actual saved Finals, 248 browser cases and 7,943,520 primary Float32 words with
zero differences across Metal/SwiftShader WebGPU/WebGL2. Nine additional native
coordinate/domain controls are separate from runtime node credit. The receipt
also closes 336 resize frames, 96 installation cycles and eight actual saved
renderer-dispose controls. This is not an all-ports or future-checkout proof.

One shared R32F axis table per built pipeline provides exact native coordinate
words. It uses at most 64 KiB of CPU data/logical GPU texels, one texture binding
and two unfiltered loads. Valid extent changes cost O(width + height); warm
frames do not rebuild or upload the table. Integer ties-to-even normalization
avoids backend differences in wide uint-to-float conversion. All 70 original
NodeRecipe function declarations remain byte-identical to the earlier published
checkpoint; two small hash delegates were added.

Every measured Final cycle allocated/uploaded zero **axis** textures during
preparation/commit and one on first live rendering. These counters exclude PMREM
and all other installation work. Source, binding, schema, version, viewport,
DPR, renderer and allocation-epoch guards remain active, including when a
terminal consumer is constant. Physical GPU allocation bytes are not claimed.

The qualified context is Blender 5.3.0 `02f0899d78e3`, macOS arm64, CPU
compositor, AUTO/FULL precision, square pixels and full-frame zero-origin
physical extents 4..8192. Linked coordinate fields, borders/crops, image or
render-pass producers, spatial consumers, unaccounted registered effects,
animated source trees, Blender GPU/EEVEE shader equivalence and general scene
lighting remain unqualified. Display proof uses Raw/exposure zero. Exact node
outputs do not certify arbitrary amplified/discontinuous downstream graphs.
Native Image Info observations do not extend that node's runtime admission.

Original failed transactions remain separate. The next27 full run exposed
unowned preview-world PMREM resources; its failure receives no full qualification
credit. The next29 and next30 successes retain their own source snapshots.
Historical fixed-input proofs remain under `../compositor-white-noise`.

```sh
PATH=/tmp/mrj-tooling:$PATH node scripts/test-node-port.mjs compositor-white-noise-default-field --profile mac-53 --blender /Applications/Blender.app/Contents/MacOS/Blender --evidence artifacts/verification-white-field-FRESH
```

The manifest owns the complete guarded native/export/browser matrix and invokes
the strict reader again with a fresh whole-program emit. It never promotes
coverage automatically or reuses numerical proof from the source watcher.
