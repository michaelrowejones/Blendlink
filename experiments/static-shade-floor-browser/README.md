# Static shade-floor generated-carrier browser gate

This one-command differential asks the real Blender 5.2 material compiler
fixture to retain its final normalized GLB, then loads those exact bytes with
Three's `GLTFLoader` in Chromium.

It independently proves:

- final GLB Base Color and Emission reference one Texture index;
- the browser fetched the same SHA-256-attested GLB bytes;
- Three creates a `MeshStandardMaterial` whose `map === emissiveMap`;
- with no light, the exact emissive static floor remains visibly nonblank; and
- enabling a Directional Light adds a measurable ordinary-PBR direct term.

Run:

```powershell
npm.cmd run test:static-shade-floor-browser
```

The direct-light term is intentionally an approximation of the authored
Shader-to-RGB ramp. The gate does not claim that the broader Blender 4 Splash
`DPM.002` response matches the bounded production recognizer.
