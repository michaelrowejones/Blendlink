# Bounded next-original audition

Source checkpoint `a1684d3a`: keep **Archviz and Impact Fracture** selected for
porting. This bounded search downloaded three relevant official originals,
about50MB of archives/source combined, with no render, bake, GPU work, source
save or asset redistribution. **No additional positive is recommended yet.**
The existing corpus selection and acceptance fields are unchanged.

| Original | Source/license evidence | Actual bounded result |
| --- | --- | --- |
| Cube Diorama | Official Blender Studio demo, CC0-1.0; embedded README says CC-0 | 61 objects; broad procedural material library. Real Final plan returns structured exit1: Floor's exact8,388,608 render SIMPLE-subdivision triangles exceed the2,000,000 static normal-receiver budget. It would need a separately reviewed export receiver/optimization route, not a silent source subdivision edit. |
| Race Spaceship | Official README and embedded credits: CC-BY, Alessandro Chiffi/ONdata Studio; license version unspecified | 55 objects,13 reachable shader/compositor kinds, no particles. Two real structured needs-bake materials remain. Authored animated camera has DOF enabled; Standard gamma.410058/exposure.502901 and three enabled view layers require their own presentation contract. Lower node count does not remove the camera fidelity bottleneck. |
| Racing Car/Pokedstudio splash | Official demo page labels CC-BY-SA; version unspecified; no embedded README recovered | 306 objects,30 particle systems,46 reachable shader/compositor kinds and86 material outputs. Authored camera DOF is off, but particle, displacement, SSS and shader scope is broad. Plan deliberately not attempted after this census; it is not a bounded product positive. |

Mr. Elephant was rejected **before downloading69MB**: its official README says
CC-BY-ND, limited to sharing as a demo. It is unsuitable for this derivative web
export qualification. Existing BMW/Barcelona downloads were not re-auditioned;
their previously recorded license/scope uncertainty remains intact.

Race Spaceship's two planner problems are `black.004` on Cube.009 (Object
coordinates plus stock material property limitations) and `Material.007` on
eight objects (terminal Add Shader plus Emission and stock property limitations).
This is a plausible later product-port target, but is deferred while authored
DOF remains unqualified. No default values, source camera, shader branches or
objects were removed to get a passing plan.

The typed image inventory also records a missing `fx3_Panels_Bump2.jpg` used by
black.001. Conservative graph reachability includes every assigned source slot.
The additional actual source census shows Cube.013 has2847 authored polygons,
all slot0; black.001 is slot3, with only Subsurf as a render modifier. This is
evidence for an unused authored slot, **not a broad no-missing-dependencies
claim**, nor a source material deletion. The original slot and missing path
remain recorded.

`docs/release-scene-auditions.json` appends these results without overwriting
historical auditions. Each new entry pins its original source/inventory, exact
archive acquisition where applicable, planner error and current selection
status. Downloaded originals and full local inventories stay in ignored
`artifacts/v1-simple-original`; no source assets enter Git.

`census.py` is a reusable read-only source census. It records camera/animation,
presentation, actual per-view-layer publishing visibility, raw material polygon
counts, modifiers and typed image references. It deliberately does **not**
evaluate geometry, equate viewport with render topology, render, bake or save.
It preserves its producer beside each new report and verifies the original
whole-file SHA after inspection. `receipt.json` pins reports, logs, helper and
imported source modules; historical first-census producer bytes are retained.

```sh
blender --background --factory-startup --disable-autoexec --threads 2 ORIGINAL.blend \
  --python-exit-code 1 \
  --python experiments/release-scene-corpus/inventory.py -- NEW_INVENTORY.json
blender --background --factory-startup --disable-autoexec --threads 2 ORIGINAL.blend \
  --python-exit-code 1 \
  --python experiments/release-scene-audition-pilot/census.py -- NEW_CENSUS.json
node packages/blendlink/dist/cli.js plan --blend ORIGINAL.blend --json
```

Both attempted source-original plans returned valid structured JSON and exit1.
All three source inventory hashes close; both census originals remain unchanged.
The immutable acquisition helper's five regression tests pass. These are source
audition findings, not Final export, browser, performance or visual acceptance.

Primary provenance: [official Blender demo page](https://www.blender.org/download/demo-files/),
[Cube Diorama archive directory](https://download.blender.org/demo/asset-bundles/cube-diorama/),
[Cube Diorama license listing](https://extensions.blender.org/asset-libraries/cube-diorama/),
[Race Spaceship README](https://download.blender.org/demo/eevee/race_spaceship/README.txt),
[Racing Car archive directory](https://download.blender.org/demo/test/),
[Mr. Elephant restriction](https://download.blender.org/demo/eevee/mr_elephant/README.txt).
The main demo HTML returned403 to direct fetch; official search-index text and
the downloadable archive/README plus embedded source texts supplied the cited
provenance. No unspecified CC-BY/CC-BY-SA version is relabeled as4.0.
