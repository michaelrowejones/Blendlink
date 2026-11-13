# Next useful field prerequisite

After Pixel passes its integrated checkpoint, add an explicit fresh `VECTOR2` representation for the two floating outputs. Never reinterpret existing `VECTOR` as width two. Initially qualify only field-to-RGBA `(x,y,0,1)` and padded float3 `(x,y,0)` conversions on the same full-frame domain as Pixel. Scalar averaging, integer casts, translated origins and neighborhood consumers need their own evidence.

The pinned native CPU implementation uses these ordered operations, independently of the shading engine:

- Normalized: `coordinates = float2(data_offset + texel) + 0.5`, then divide each component by the corresponding display dimension.
- Uniform: make the same half-pixel coordinates, subtract `display_size / 2`, divide by the larger display dimension, then multiply by two.

Native GPU shader grouping must be inspected and captured separately before asserting exact equality. Non-power-of-two extents, portrait/landscape, odd/even centers and real DPR transitions are necessary counterexamples. Reuse the Pixel full-frame admission and actual PassNode lifecycle controls. Pixel's integer bins are not evidence for floating division/FMA behavior.

The artist payoff is the implicit default Vector input of Gradient and Checker: Blender's compositor requests uniform image coordinates there. Once the uniform field and explicit width conversion are proved, route those defaults through this shared producer instead of treating them as zero literals. Require exact domain provenance, and prove gradient/checker outputs on an independent texture pattern through saved Final scenes. This would unlock common unlinked artist graphs without adding a render-to-texture pass for the coordinate field.
