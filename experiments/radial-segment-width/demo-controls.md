# Corrected official Radial demo controls

A fresh read-only Blender5.3 RNA probe corrects the earlier inference that the
official demo needs fractional Sides. Its **Map Range is STEPPED, Steps1,
clamp=false**. Both material instances set Scale2, Inner Ring Sides3, Outer Ring
Sides8, Ring Limit.5 and Roundness1. Radial Normalize is true and Segment
Coordinates is consumed. No source math or original asset was changed.

The pinned GPU `map_range_stepped` implementation gives, for radius `r`:

```
map = 4 + 4*floor(2*r)
sides = map > 4 ? map : 3
```

Object coordinates have no alternate object and `from_instancer=false`; the two
planar meshes have no modifiers or shape keys, with identity scale. After the
authored Scale2 their XY bounds are ±1.000370979309082 and ±1.0028247833251953,
so `r <= 1.4164743705041178 < 1.5`. Therefore the authored continuous field selects
**Sides3,8,12**:3 below radius.5,8 from.5 to1,12 above1. The unclamped stepped
range explains12 in the corners despite the exposed Outer Ring Sides8 control.
Rounding near the transition circles can change which integer is selected; it
cannot turn this expression into fractional Sides.

The active Radial branch is consequently **regular full-roundness**, with native
Segment Coordinates depending on `atan2`, radius and sector classification. The
larger fractional circular branch remains useful broader research, but is not
required by these particular authored controls. The existing Width-only port
still refuses computed Sides and has no Segment Coordinates implementation; this
correction earns no new node, numeric, Final or official-scene acceptance credit.

[demo-controls.json](./demo-controls.json) pins the original CC0 source, native
version/build, complete focused control/topology snapshot hash and raw receipt.
The source of the stepped expression is Blender's pinned
[GPU implementation](https://raw.githubusercontent.com/blender/blender/02f0899d78e374b63e7181d9061e1f7ab03419cc/source/blender/gpu/shaders/material/gpu_shader_material_map_range.bsl.hh).
