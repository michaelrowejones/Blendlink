# Blender nodes on the web

The target is to preserve the artist's authored shading and compositing while
making Blender-to-web publishing automatic. Complete Blender node parity is
not implemented. The [native coverage inventory](node-coverage/README.md)
records available node types, modes, socket schemas, implementation limits,
and remaining work separately for Blender 4.2, 5.2 and 5.3.

EEVEE is the visual reference for new live shading ports where applicable.
Cycles generally uses material/channel baking or Bake Appearance, according to
the intended result. Existing verified Cycles ports remain available within
their documented domains. Compositor CPU/GPU differences are tested separately
from the scene renderer. See the [live fidelity decision](adr/0007-eevee-live-fidelity-and-cycles-baking.md).

## What happens when you preview or export

Use the normal **Preview Website** and **Export Website Folder** actions.
Eligible material channel graphs that remain live compile to Three.js node
programs automatically. Simple PBR/direct-image inputs can keep their portable
carrier, while Bake Appearance captures the whole surface. Artists do not need
to insert a Website Color marker to enable automatic translation. The Material
Fidelity card reports the route for each channel before publishing:

- **Live program:** a supported graph evaluates in the browser. Surface
  lighting still comes from the browser renderer and the exported scene.
- **Portable material:** supported glTF/PBR properties and textures transfer
  through the normal material carrier.
- **Static channel bake:** an eligible graph evaluates in Blender into a
  texture for one material channel. Other channels can remain live.
- **Appearance capture:** an artist-selected whole-surface capture stores a
  static rendered look. It includes lighting in the capture.
- **Refused:** the current graph cannot preserve its required behavior through
  an evidenced route. Diagnostics identify the channel, artist node, and reason.

A static bake is useful preservation, but it is not a live node port. Keyed
parameters, drivers, view-dependent inputs, light queries, or unsupported
coordinates cannot be made live by capturing one frame.

Preview Studio and standalone exports initialize `WebGPURenderer` automatically.
Live programs work on its WebGPU backend and its WebGL2 fallback. Existing site
integrations need the same renderer family to install live programs. An
integration using legacy `WebGLRenderer` keeps the portable/baked carrier.
When a material's base color exists only in its live program, legacy renderer
installation explains the missing capability and stops. Preview and export use
the required node renderer automatically.

Final validation checks shipped program bytes against their manifest identity
and validates the live base-color expression against the actual mesh inputs.
A material name or marker alone cannot excuse a missing color carrier. Programs
whose required dependencies cannot be validated still need a portable/baked
carrier for publication. External images are resolved against the shipped
bytes, manifest identity, decoded dimensions and color space. Per-object
properties resolve against the actual exported scene owner; shared geometry
does not make distinct objects inherit each other's properties.

## Shading and compositing have different contracts

Material graphs feed supported physical material channels. Translating a
shader's color algebra does not reproduce every Cycles BSDF, light interaction,
volume, displacement, or ray query. A live color texture and a complete
path-traced surface are different amounts of renderer functionality.

Compositing evaluates the authored reachable image graph before the separate
display transform. Supported graphs preserve their groups, socket bindings,
factor inputs, and alpha semantics. The image graph must build successfully as
a whole; an unsupported effect is reported rather than omitted. The current
render-pass resolver does not reproduce every native render layer, AOV, or
Cryptomatte source. Animated compositor parameters require additional live
transport and currently refuse.

Blender versions matter. For example, legacy Color Balance applies its
Lift/Gamma/Gain controls through a different color model than modern socket-based
Color Balance. Legacy compositor rounding also differs at negative half values.
The exporter records these distinctions for the browser runtime.

The HDR audit reproduced amplified CPU Difference Key and Luminance Key
Image-output errors with authored alpha `2^60`. Fresh CPU Difference Key now
uses a separately qualified exact model within its documented parameter domain;
the previous serialized model remains compatible. Fresh Luminance Key now
preserves this boundary within its measured Mac CPU profiles, including
tiny-value behavior and final RGBA products. Unmeasured CPU/compiler profiles
retain explicit legacy v1 precision and do not gain that HDR guarantee.
Separate Linux/Windows native qualification remains pending; experimental
kernel trials cannot promote production admission. Ordinary-value comparisons
do not certify this boundary. These are partial ports, and complete node
parity remains unfinished.

## How a port earns support

The native inventory creates the nodes in isolated Blender processes and
records available modes and socket layouts. A reviewed capability map links
each implemented route to compiler and runtime code. New native nodes and modes
remain visible until reviewed; their names alone do not imply support.

Numerical gates compare actual native float pixels with the production Three.js
builder on both WebGPU and WebGL2. They check negative/HDR values, alpha,
boundaries, zero ranges, clamping, and named refusals where applicable. Native
references are kept separate from browser results. EEVEE material evaluation,
including its constant and shader stages, is the live fidelity target. Existing
CPU Cycles reference tests remain labeled as CPU evidence; additional
Cycles-only behavior generally belongs to the bake workflow.

Some functions use sampled lookup tables. A port that reproduces Blender's own
native table is distinguished from an additional sampling approximation.
Approximate routes record their limits and provenance; graphs exceeding the
accepted table or channel budget refuse that live route.
The [shader differential experiment](../experiments/tsl-node-differential/README.md)
and [native compositor experiment](../experiments/native-compositor-differential/README.md)
document the reproducible gates.

Blackbody and Wavelength have separate Cycles and EEVEE evaluation models.
Their exported working-space matrices follow the source OCIO configuration.
Legacy Cycles can use different transforms for constant-folded and shader
inputs; EEVEE uses a native color table when an input cannot be folded. Material
tables use half-float storage before Blender 5.3 and full-float storage in 5.3.
These are node semantics, separate from render-target quantization. The
[spectral differential experiment](../experiments/spectral-node-differential/README.md)
checks native 4.2, 5.2 and 5.3 graphs on both browser backends, including linked
inputs, endpoints, and constant procedural inputs. Unknown native folding
semantics refuse instead of silently choosing a different color function.

Legacy shader Combine HSV and Separate HSV are live on EEVEE 4.2.0 only.
They expose H/S/V components without an Alpha socket. Blender 5.2/5.3 removes
these classes and upgrades an actual older file to modern Color nodes in HSV
mode; that migration is verified separately from numeric support. Cycles uses
baking. The [legacy HSV experiment](../experiments/legacy-shader-hsv/README.md)
records native Metal and four browser API checks, independent carrier
calibration, and saved-file migration evidence. Fresh native OpenGL qualification
remains pending; Metal measurements do not qualify another native backend.

Run `npm run test:node-parity` with Blender and the version-matched Playwright
Chromium installed to regenerate native CPU references and compare the built
runtime on both browser backends. Linux CI runs this gate against Blender 4.2
and 5.2; local development also exercises 5.3.

These gates prove the listed fixtures and declared parameter domains. They do
not certify all combinations of arbitrary graphs, every browser/device, or
whole-scene pixel parity with Blender.

## Work toward full coverage

The inventory groups remaining work into common pointwise operations, missing
modes of existing nodes, procedural textures and coordinates, spatial image
effects and render passes, surface/light/volume behavior, and animated/media
graph execution. Prioritize operations that preserve the most authored scenes,
while maintaining explicit fallback and diagnostic behavior at every stage.
See the [ranked coverage batches](node-coverage/README.md#remaining-work-by-batch)
for the current list. Multiplayer and XR remain outside this work.

## Source render UV selection

Fresh Texture Coordinate UV, an unnamed UV Map and an unlinked Image Texture
Vector input use the source mesh's **active render** UV layer. Edit selection
does not change that binding. Shared materials may use different render slots
on different owners; each owner exports an explicit name/channel contract and
receives the corresponding live material variant. Named maps keep their names.

The source layer must fit in the first four exported UV channels. Missing,
stale or nonfinite attributes refuse with the carrier retained. Hybrid channel
baking preserves the source selection while adding its private atlas layer.
Older serialized unnamed `uv` expressions retain their TEXCOORD_0 behavior;
fresh owner-bound expressions use `uv_active`, which requires an explicit binding.
