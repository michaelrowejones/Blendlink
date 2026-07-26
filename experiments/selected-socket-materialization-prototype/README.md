# PROTOTYPE — selected-socket materialization

Status: throwaway evidence. This directory is not imported by Blendlink.

Question: can one artist-selected, Cycles-evaluable intrinsic color socket be
evaluated on a private material/object copy and emitted as an ordinary,
attested stock-glTF unlit texture without changing the source material,
binding, mesh, or `.blend`?

Run:

```powershell
node experiments/selected-socket-materialization-prototype/run.mjs
```

The fixture intentionally places an Eevee-only Shader to RGB branch
*downstream* of the selected Checker Texture color. The private bake connects
only the selected upstream field to Emission. This proves the intended
dependency boundary; it does not claim that Shader to RGB, lighting, AO,
shadows, the view transform, or the compositor were baked.

All bake mechanics come from the canonical
`packages/blendlink/blender/bakelib.py`: native object-context baking,
coverage validation, Standard/None/0 saving, margin/background resolution, and
image publication. The prototype owns only its disposable fixture graph and
GLB assertions.

The fixed 256 px size is an experiment input, not a proposed product default.
Resolution policy, alpha packing, multi-binding ownership, animation, nested
group dependency diagnostics, cache identity, and browser pixels remain
separate production questions.
