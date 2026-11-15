# Finite Image Info semantics

Research only; no new runtime/support qualification. A fresh guarded native
Blender5.3 CPU transaction rendered25 tiny source-owned graphs with gpu.init
explicitly denied (canary proved, measured calls reset to zero). Its source and
native archive pins are retained by evidence.json; native-semantics.json records
all pixel hashes and exact observed words. The initial controller-path failure
is retained separately and earns no qualification.

Pinned ImageInfo skips input type conversion and realization. Dimensions is
`domain.realize_transformation().data_size`; Resolution is original
`domain.data_size`. Location/Rotation/Scale decompose the original transform.
Single values instead allocate default remaining outputs; they are not finite
images. These definitions must not be reduced to universal texture dimensions.

The actual identity controls are Blank5x3, Blank rawSize(0,-2)→effective1x1,
generated Float32 Image7x4, and packed byte PNG3x5. For those only,
Dimensions=Resolution=the finite producer size; Location and Rotation are+0,
Scale=(1,1). They stay independent of the13x9 render extent. Crucially, the
unadmitted native Blank5x3→Transform Scale2 control produces Dimensions(10,6),
Resolution(5,3), Scale(2,2). It is a negative domain-generalization control,
not a transformed-image port.

Blank explicitly allocates Domain(max(Size,1)). CachedImage initializes the
native finite buffer domain and applies display/data offsets only when the
ImBuf has a display window. Existing admitted generated float and ordinary
sRGB PNG static Image profiles exclude float-file display windows. Reuse their
loader/payload limits and deduplication; no new image decode or synthesized
full-frame image is needed for identity metadata. No PBR/EEVEE/Cycles plate,
GPU compositor, other native build or all-Image-format parity is claimed.

## Candidate source/runtime checkpoint

The isolated candidate adds a separate `finite-identity-image-info-v1` model;
the existing Render Layers profile retains its live texture-size semantics.
Finite data size comes from the existing validated static-image payload or
Blank Image effective Size. Source context and actual producer binding/size
are checked before/after dependency capture and at extraction close; the
existing used-topology guard starts before reading dependencies. Late root,
frame, storage/binding, group/reroute and output-context changes refuse.

Blank is still a finite producer. Only its direct terminal route or a closed
metadata graph can leave that boundary: one producer, native Image Info
outputs, and existing Value/Separate XYZ/Combine Color/Math consumers, all
contributing, at most64ops. Producer Color cannot escape through a conversion
or an unrelated branch. Image Info outputs allocate native single values and
drop the finite input canvas. Scalar/Boolean/other-width metadata casts,
transformed/computed/Alpha producer inputs and arbitrary consumers remain
unqualified. Groups/reroutes use the existing typed boundary.

Nineteen guarded positive controls include all five outputs, typed group,
reroute, actual aspect arithmetic and a compound summary using Dimensions.X,
Resolution.Y, Rotation and Scale.X for both producers, plus unchanged-close.
Eighteen refusal controls include before-snapshot and EOF mutations. Actual
render/GPU guard canaries refuse, then measured source-policy attempts stay0.
`source-policy.json` pins the complete original report and guarded archive.
The early policy fixture failures and their original namespaces remain
retained; none earns runtime qualification.

Twenty-six focused host tests pass, including the unchanged Render Layers,
Blank and static-image suites, actual extracted source JSON, forged schema/
topology refusals, prepared-payload ownership/dedup and retained Blank frame/
epoch validation even for constant metadata. TypeScript checking passes.
Blank metadata constructs no realization texture/RTT; static Image metadata
uses the existing one-payload decoder/texture lifetime. These are scoped host
observations, not total public-install or GPU cost measurements.

No Final export or browser numerical qualification has run for this new
model. A subsequent fresh proof must render the actual authored finite source
graphs and export their saved scenes, archive/recompute actual GPU words, and
check actual installed output/resize/lifecycle on four tuples. Exact metadata
lanes remain separate from any inherited bounded Math consumer contract.

## Next proof and bounded Metal diagnostic

The predeclared plan has21nativegraphs (20finite metadata and one independent
literal calibration), eight saved sources (seven production), and therefore
116raw/Final browser primarycases acrossfourtuples (108production). Exact
primary words are29,696total/27,648production, with67,584words in264planned
primary/repeat/reinstalled readbacks. The19/18source-policy census is separate
from those numerical graphs. Blank8192×1 and PNG4096×1 check max-axis metadata;
Float1×1 and raw BlankSize(0,-2) distinguish real finite images from single values.

`metal-pilot.json` retains the first fresh bounded diagnostic:21nativeCPU
references, eight saved sources, and actual Metal WebGPU/WebGL2 raw output.
All10,752primary and21,504all-read GPU words match the predeclared table.
A separate CPU pass independently recomputes every readback and matches each
observed source-sized DataTexture's raw hash to the actual decoded payload.
The actual compiled constant Blank-metadata root refuses a bad viewport then
recovers on the ordinary repeated draw onbothAPIs.

The forwarding backend observer canary observes a real physical upload/handle/
sampled binding. By contrast, the metadata-only static image cases construct
one actual CPU DataTexture/buffer each but create/upload/bind0physical GPU
payload textures/samplers. Blank metadata constructs0such CPU objects. The
maximum-axis PNG still decodes65,536CPU bytes; no domain-only/header-only
optimization is claimed. These are scoped fixture observations, not total
renderer/public-install cost or source image-pixel equivalence. The new observer
module, actual backend/Texture source files and archived GPU words are pinned.

This remains a zero-support diagnostic: it didnot export the eight saved scenes
through Final or run the Software profile. Full suite entrypoint after a fresh
frozen build and coordinated lease:

```sh
SCENETOWEB_SWITCH_EVIDENCE=artifacts/verification-finite-image-info-fresh \
 node experiments/static-switch-family/suite.mjs --built --finite-image-info
```

Default static selectors, mono Switch View and Integer Vector3 keep their
original case sets and report schemas. This additive variant reuses their
transaction/native/export/runtime/archive machinery rather than a copied proof
framework; new evidence does not refresh their historical receipts.
