# Release scene selection and node backlog

The source-owned [shortlist](../../docs/release-scene-corpus.json) and
[node backlog](../../docs/release-scene-node-backlog.json) make demo-driven
porting explicit. They contain source inventory, not successful exports or
node-support promotions. No downloaded scene or texture is redistributed.

## Audition order

| Original official scene | Authored source | Conservative reachable shader/compositor kinds | Current 5.3 catalog categories | Decision |
| --- | --- | --- | --- | --- |
| Archviz by Marek Moravec | EEVEE; 156 scene objects; CC0 | 15 | 2 supported, 9 partial, 2 unsupported, 2 structural | Selected first live porting target; prove the complete scene before accepting it |
| Classroom by Christophe Seux | Cycles; 304 scene objects; CC0 | 58 | 13 supported, 30 partial, 7 unsupported, 8 structural | Provisional bake candidate; complexity review required |
| Lone Monk by Carlo Bergonzini / Monorender | Cycles; 1,368 scene objects; CC-BY version unresolved | 50 | 11 supported, 28 partial, 5 unsupported, 6 structural | Provisional; complexity and exact redistribution license unresolved |

These counts describe existing catalog classifications, not scene qualification.
All used modes and graph combinations remain pending. The complete shortlist is
not frozen; it must not turn three large conventional scenes into a hidden unlimited
1.0 commitment. There are 73 distinct reachable shader/compositor kinds across
these three candidates. The complete 92-kind authored inventory also preserves
unreachable nodes and separate geometry modifier nodes.

Classroom references three Render Layers scenes, includes an 8,000-particle HALO
dust source and a substantial compositor. Lone Monk includes 6,000 HAIR collection
instances and uses Particle Info, Light Path and Sky. These dependencies need
deliberate scene-level routes; baking a camera image does not qualify live ports.
Archviz's embedded historic README mentions carpet hair, but the current 5.3
inventory finds no particle systems. Preserve that distinction.

The first actual missing catalog routes are Light Path and Environment Texture
in Archviz. Shared larger-scene gaps include Lens Distortion and Sky. Other
audition gaps are Bokeh Image, Normalize, Glass, Translucent, Displacement,
Dilate/Erode and Particle Info. A world/environment route may belong to scene
preparation rather than a material shader opcode; verify the actual authored
use before implementing a second path.

BMW and Barcelona were also inspected locally. BMW's current official download
has no embedded license, and the author's current portfolio does not supply a
recovered grant. Barcelona's exact CC-BY version remains unresolved. Neither
is declared CC0 or selected merely to make a smaller positive corpus. The
original Cube Diorama, Mandelbrot and Radial Tiling stress receipts remain in
their existing corpus, with their original failure statuses intact.

## Reproduce source acquisition and inspection

Acquire only the hash-pinned HTTPS originals into this checkout's ignored cache:

```sh
python3 experiments/release-scene-corpus/fetch.py \
  --directory artifacts/v1-corpus/sources
```

`--scene archiviz` (or either other ID) limits acquisition. Existing cached
download bytes must match. ZIP members are checked for traversal/symlinks before
extraction; linked libraries and images stay beside the original source. Fresh
extraction is staged and validated before an atomic directory rename. Cached
members are checked against the archive without writes: changed/missing sources
or sidecars refuse and retain their bytes instead of being repaired. Concurrent
fresh extraction refuses through an exclusive lock; failed staging cleans up.

Open each file with Blender 5.3 build `02f0899d78e3`, auto-execution disabled,
without rendering, baking or saving. For example:

```sh
/Applications/Blender.app/Contents/MacOS/Blender \
  --background --factory-startup --disable-autoexec --threads 2 \
  artifacts/v1-corpus/sources/archiviz.blend \
  --python experiments/release-scene-corpus/inventory.py -- \
  artifacts/v1-corpus/inventories/archiviz-final.json
```

Use each manifest `sourcePath` and `inventoryFile` for the other two sources.
Then independently recompute reachability, validate source/build/discovery pins,
and emit the source-owned backlog:

```sh
python3 experiments/release-scene-corpus/backlog.py \
  --inventory-dir artifacts/v1-corpus/inventories \
  --output /tmp/release-scene-node-backlog.json
python3 -m unittest discover -s experiments/release-scene-corpus -p '*_test.py'
```

The initial source inventory took approximately 4.6 seconds for Archviz,
1.2 seconds for Lone Monk and 1.8 seconds for Classroom on the local macOS arm64
Blender 5.3 host, including process startup. Those are source-inspection times,
not export, render, port-authoring or scene-acceptance timings. All source hashes
were unchanged; render/save/bake calls were zero. Backlog regeneration is
byte-identical. Fourteen focused CPU tests cover unused versus reachable modes,
group interfaces and distinct instances, branch retention, recursion refusal,
pin/usage tampering, zero support credit, archive safety, immutable cached sources
and sidecars, and interrupted extraction cleanup.

## Discovery boundaries

The inventory traverses typed socket identifiers through nested groups and back
to each instance's parent inputs. It keeps both branches and all material slots,
follows explicit Render Layers scene dependencies and collection/particle
instance objects, and inventories render-enabled Geometry Nodes modifiers in a
separate domain. Full authored usage and conservative reachable usage are
reported independently, including distinct mode sets. Raw local reports retain
socket defaults, scalar settings, curve/ramp points, image settings, owners,
links, group dependencies and source closure hashes for fixture construction.

Reachability is conservative linkage discovery, not proof that every branch or
socket affects a pixel. Collection visibility, engine-specific active-output
selection and evaluated geometry/instances are not semantically reduced.
Sources with drivers are loaded with auto-execution disabled. Input links and
expressions still need the real compiler's admission and native/browser proof.
Historical read-only inventories remain separate from new numerical evidence.

Prioritize shared scene dependencies first, then remaining used nodes/modes.
Authored-but-unreachable kinds remain visible in the backlog and are lower
priority. Geometry modifier kinds are separate evaluated-ingest work, never
silently counted as shader/compositor ports. No raw inventory, catalog category,
native class creation or successful bake can change a support status.
