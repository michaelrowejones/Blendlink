# Realtime plan material diagnostics differential

This focused fixture proves that a realtime scene with no bake plan does not
turn a used `needsBake` material into `plan: null` success.

```powershell
node experiments/realtime-plan-material-diagnostics/run.mjs
```

The fixture is generated locally. It contains one cube whose active Eevee
surface passes Diffuse through Shader to RGB and an Emission output. Stock
glTF cannot preserve that graph. The expected result is exit code `1` with a
structured `material.used-needs-bake` inspection error.

The same source is also planned through an explicit
`applicationMaterialAdapter`. That developer-owned exception exits `0`, but
both JSON and human output retain the material warning, adapter description,
and application-browser-gate consequence. This matches Final verification's
existing loud, nonblocking acknowledgement instead of turning the exception
into silent success.
