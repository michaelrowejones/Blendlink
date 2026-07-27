# Blender's built-in MaterialX export is not a fidelity transport

Status: accepted on 2026-07-27

Blender 5.2 can emit a MaterialX shader network through its USD exporter and
ships MaterialX 1.39.4 as an importable Python module; three.js r184 ships a
`MaterialXLoader` that maps MaterialX onto TSL nodes. That pairing looks like a
ready-made high-fidelity material route, so it was measured before being either
adopted or dismissed. It is rejected as a transport for authored material
intent, because the measurement showed it loses ordinary production content
silently.

## Evidence

Measured against the retained `blender-4.0-splash-120f` derivative (45 used
materials, 27 distinct shader node types) on Blender 5.2.0 LTS. Reproduce with
`experiments/materialx-export-coverage/probe.py`; full result in that
directory's README.

The export reported success — 35 `Material` prims, 31 `NodeGraph` prims, no
error, no warning — while dropping every occurrence of:

| Authored node | Uses |
| --- | --- |
| `ShaderNodeValToRGB` (Color Ramp) | 110 |
| `ShaderNodeTexCoord` / `ShaderNodeMapping` | 86 / 86 |
| `ShaderNodeVertexColor` | 73 |
| `ShaderNodeShaderToRGB` | 33 |
| `ShaderNodeTexVoronoi` | 32 |
| `ShaderNodeAmbientOcclusion` | 31 |
| `ShaderNodeTexImage` | 14 |
| `ShaderNodeFresnel` | 8 |

Noise, Mix, Hue/Saturation, and Bright/Contrast did survive, so the exporter is
substantially more capable than its 2023-era node list — but image textures,
vertex colours, and colour ramps are ordinary production content, not exotic
edge cases.

## Why this is decisive

Blendlink's whole contract is that authored intent is either preserved with
proof or refused with a named remedy. An upstream stage that discards a third of
a scene's shading nodes and still reports success cannot sit inside that
contract; Blendlink would have to re-derive the coverage answer itself to know
what it had shipped, which is the same work as owning the compiler.

## Consequences

- Blender's MaterialX/USD export is not used to carry material intent. It
  remains fine for its actual purpose, Hydra preview.
- Wide material coverage on the current renderer is pursued through the
  **Material bake** (`MTL-BAKE-001`) instead.
- A Blendlink-owned node compiler that constructs MaterialX or TSL documents
  with its own proof discipline is **not** rejected by this decision; it is
  tracked separately as `MTLX-TSL-001` and depends on ADR 0006.
- The conclusion is scoped to the installed Blender version. Re-run the probe
  when Blender's `source/blender/nodes/shader/materialx` parsers gain coverage.
