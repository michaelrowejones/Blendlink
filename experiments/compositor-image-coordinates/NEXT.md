# Coordinate prerequisites and next work

Uniform/Normalized FLOAT_VECTOR2 fields and explicit RGBA/padded-float3 edges have now qualified in the separate compositor-float-coordinates receipt. Default/linked Gradient and Checker fields have their own independently bounded/exact contracts in compositor-texture-fields. Pixel scalar, integer-midpoint and Boolean edges are the next expansion under qualification in the Pixel matrix. Floating scalar/integer casts, transformed origins and wider domains still need their own proofs. The source notes below explain the floating producer already implemented; they are not pending basic ports.

The floating producer uses fresh `FLOAT_VECTOR2`, never a reinterpretation of existing `VECTOR` as width two. Its qualified conversions are field-to-RGBA `(x,y,0,1)` and padded float3 `(x,y,0)` on the same full-frame domain as Pixel. Floating scalar averaging, integer casts, translated origins and neighborhood consumers need their own evidence.

The pinned native CPU implementation uses these ordered operations, independently of the shading engine:

- Normalized: `coordinates = float2(data_offset + texel) + 0.5`, then divide each component by the corresponding display dimension.
- Uniform: make the same half-pixel coordinates, subtract `display_size / 2`, divide by the larger display dimension, then multiply by two.

Native GPU shader grouping must be inspected and captured separately before asserting exact equality. Non-power-of-two extents, portrait/landscape, odd/even centers and real DPR transitions are necessary counterexamples. Reuse the Pixel full-frame admission and actual PassNode lifecycle controls. Pixel's integer bins are not evidence for floating division/FMA behavior.

The artist payoff is the implicit default Vector input of Gradient and Checker: Blender's compositor requests uniform image coordinates there. The defaults now share that producer, with exact domain provenance and separate consumer-output proofs through saved Final scenes. Next expansions must carry independent precision budgets through compositions and preserve branch boundaries, including after resize. No render-to-texture pass is needed for the coordinate field.
