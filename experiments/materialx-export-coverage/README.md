# MaterialX export coverage probe

Measures whether Blender's built-in MaterialX shader export is usable as a
**fidelity transport** for Blendlink, or only as a preview convenience.

## Why this exists

Two facts make a Blender → MaterialX → three.js material route look attractive:

- Blender can emit a MaterialX shader network through its USD exporter
  (`generate_materialx_network`), and ships MaterialX **1.39.4** as an importable
  Python module inside Blender 5.2.
- three.js r184 ships `examples/jsm/loaders/MaterialXLoader.js`, which maps
  MaterialX definitions onto TSL nodes.

If that pairing preserved authored graphs faithfully, it would be a far cheaper
route to wide material coverage than baking or an owned node compiler. This
probe measures whether it does.

## Running it

```bash
blender --background --factory-startup <source.blend> --python experiments/materialx-export-coverage/probe.py -- <out-dir>
```

The probe never writes to the source `.blend`. It inventories the shader node
types used by render-visible meshes, exports an ASCII USD/MaterialX network to
`<out-dir>`, and reports which authored node families reached the output.

## Result — 2026-07-27, Blender 5.2.0 LTS

Source: the retained derivative
`artifacts/release-dogfood/blender-4-splash/fixtures/blender-4.0-splash-120f.blend`
(45 used materials, 27 distinct shader node types).

The export **succeeded**: 329,593,244 bytes, 35 `Material` prims, 31 `NodeGraph`
prims, no error and no warning.

Node families that survived:

| Authored node | Uses | MaterialX result |
| --- | --- | --- |
| `ShaderNodeTexNoise` | 51 | `ND_fractal3d_float` |
| `ShaderNodeMix` | 230 | `ND_mix_color3` (93) |
| `ShaderNodeHueSaturation` | 45 | `ND_hsvadjust_color3` |
| `ShaderNodeBrightContrast` | 62 | `ND_clamp_color3FA` |

Node families that were **dropped entirely**:

| Authored node | Uses | MaterialX result |
| --- | --- | --- |
| `ShaderNodeValToRGB` (Color Ramp) | 110 | none |
| `ShaderNodeTexCoord` / `ShaderNodeMapping` | 86 / 86 | none |
| `ShaderNodeVertexColor` | 73 | none |
| `ShaderNodeShaderToRGB` | 33 | none |
| `ShaderNodeTexVoronoi` | 32 | none |
| `ShaderNodeAmbientOcclusion` | 31 | none |
| `ShaderNodeTexImage` | 14 | none |
| `ShaderNodeFresnel` | 8 | none |

## Conclusion

Blender's MaterialX export is a **Hydra preview path, not a fidelity
transport**. It drops node families it cannot express — including image
textures, vertex colors, and colour ramps, which are ordinary production
content rather than exotic edge cases — and reports success anyway.

Silent loss of authored intent is the precise failure mode Blendlink refuses
everywhere else, so this route cannot back a portability claim. Recorded as
[ADR 0005](../../docs/adr/0005-blender-materialx-export-is-not-a-fidelity-transport.md).

This measures the **exporter**, not MaterialX or three.js. A Blendlink-owned
node compiler that constructs its own documents with its own proof discipline
remains open, and is tracked as `MTLX-TSL-001` in the
[technique ledger](../../docs/TECHNIQUE_LEDGER.md).

## Re-run triggers

Re-run and update this file whenever the installed Blender version changes, or
whenever Blender's `source/blender/nodes/shader/materialx` node parsers gain
coverage. The conclusion is version-scoped, not permanent.
