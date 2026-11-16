# Custom corner frame transport pilot

CPU-only Blender 5.3.0 build 02f0899d78e3 / glTF exporter 5.3.43. This is an API/accessor viability result, with **zero node/frame/render/scene support credit**. No renderer, native GPU work or source saves were used.

The immutable original Archviz file (`9f636b2e1a59b3d181f90caf1b1703658eeadebad57f3c6207737d2fe3ffd85e`) supplies evaluated Walls and Plane.021 through `bpy.data.meshes.new_from_object(..., preserve_all_data_layers=True)`. These are owned Main meshes. Only private material bindings and four CORNER attributes change; source/evaluated polygons, loop triangles, normals and UVs are never triangulated, reconstructed or assigned custom normals.

The custom attributes are `_STW_FRAME_N` (original corner normals), `_STW_FRAME_T` (explicit dummy dyadic payload, **not a computed tangent**), `_STW_FRAME_SIGN` (known +/-1 payload), and `_STW_CORNER` (diagnostic original loop ID). Each private mesh uses a neutral PBR material. The tiny two-triangle control contains shared points, discontinuous normals and a UV seam. Both Z-up and Y-up exports use `export_attributes=True`.

All six isolated GLBs close successfully in `/tmp/scenetoweb-corner-frame-transport-r2`:

| Mesh | Original vertices | Exported vertices | Original triangles | n-gons | Built-in TANGENT |
| --- | ---: | ---: | ---: | ---: | --- |
| Walls | 1500 | 5489 | 2731 | 5 | absent |
| Plane.021 | 1270 | 4444 | 2198 | 0 | present |
| seam | 4 | 6 | 2 | 0 | present |

- All 159024 custom Float32 words are byte-exact. All 59634 independently recomputed SNORM10 normal components preserve the source trunc(F32(normal*511)) values. This is CPU storage/packing equivalence, not observation of native GPU packed attributes.
- Custom FLOAT_VECTOR attributes remain **raw Blender XYZ**, including under export_yup=True. Built-in POSITION instead follows x,z,-y. Runtime consumers must explicitly distinguish these semantics.
- The diagnostic loop ID forces per-corner vertex splitting. Every original oriented loop-triangle multiset is identical after reading actual GLB indices and loop IDs. Built-in NORMAL is present in this neutral PBR test; the known Walls built-in tangent omission remains. No custom dummy tangent is promoted to an actual Mikk frame.
- Private positions, polygons, loop triangles, normals and UV words remain unchanged across attribute attachment and export. Original mesh snapshots and original .blend bytes also remain unchanged.
- Transported original normals independently match the earlier frozen source datasets in `/tmp/scenetoweb-archviz-tangent-cpu-r2` byte-for-byte; these are not the previously differing n-gon proxy normals.

The raw producer/reference/GLBs and guarded launcher archive are retained externally, pinned by `evidence.json`. `read.mjs` independently validates that archive, decodes actual GLB buffer views/accessors (including stride), checks raw fields/indices/axis semantics and refuses extra meshes. Built-in POSITION comparisons are exact finite values after the declared basis mapping; signed-zero word differences are reported separately (observed0). Custom frame words have a strict raw-word gate.

The initial r1 capture is retained as a failed scene-isolation control: `use_selection=True` alone exported four selected original-scene meshes as well. The independent reader refuses its 5-mesh GLBs. r2 adds only `use_active_scene=True`; the original/private geometry is unchanged.

```
node experiments/corner-frame-transport/run.mjs ORIGINAL_BLEND NEW_DIRECTORY
node experiments/corner-frame-transport/read.mjs NEW_DIRECTORY/capture NEW_CLOSED_JSON
```

Next step: supply independently qualified source-normal Mikk tangent/sign data through these exact attributes, verify Three's actual BufferAttribute semantics and owned lifetime, then compare a native NormalMap field. Current unique corner IDs/dummy payloads deliberately prevent welding and add storage; this is not a production packing/performance policy.
