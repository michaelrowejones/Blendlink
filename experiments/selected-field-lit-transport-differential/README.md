# PROTOTYPE — selected-field surface response

This throwaway differential asks one bounded question:

> When Blendlink materializes an intrinsic color field, should the published
> stock-glTF carrier preserve an ordinary lit surface response instead of
> always becoming `KHR_materials_unlit`?

The fixture contains:

- a procedural red/blue intrinsic field feeding an ordinary Principled BSDF;
- a selected-field receiver partly occluded from a Sun;
- a selected-field caster above a neutral receiver;
- the source Eevee render;
- the same materialized PNG transported as current unlit stock glTF and as
  ordinary metallic-roughness PBR stock glTF; and
- a Chromium differential that independently toggles receiving shadows,
  casting shadows, and direct-light response.

Nothing in this directory is imported by Blendlink. Bake/save mechanics use
the canonical `packages/blendlink/blender/bakelib.py`.

Run:

```powershell
node experiments/selected-field-lit-transport-differential/run.mjs
```

The optional first argument is a `node_modules` directory containing
Playwright. By default the runner uses the MichaelRoweJonesSite installation.

The generated comparison image and machine-readable evidence are written to
`output/`.

Last verified on 2026-07-24 with Blender 5.2.0 LTS, Three 0.184.0, and
Chromium WebGL2 through ANGLE/SwiftShader:

- the current unlit carrier changed `0` pixels when direct light or the
  receiver-only occluder shadow changed;
- the lit carrier changed `148,000` pixels under direct light and `18,249`
  pixels under the occluder shadow;
- both opaque carriers cast the selected object's shadow across `5,944`
  pixels; and
- the Blender lit carrier was much closer to the source Eevee frame
  (`0.017423` normalized RGB RMSE) than the unlit carrier (`0.117074`).

See `output/evidence.json` for source identities, hashes, exact assertions,
and evidence limits.
