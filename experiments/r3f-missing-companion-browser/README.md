# Missing glTF companion browser gate

This production-source Chromium fixture proves a narrow but important loading
contract: Three r184 may resolve `GLTFLoader` after an external image request
fails, but Blendlink's package-owned loader must report **Failed**, never
**Ready**, and must not commit the incomplete root.

Run:

```powershell
npm run test:r3f-missing-companion-browser
```

The fixture serves a valid generated GLB with one external base-color image,
returns HTTP 404 for that image, mounts the production
`createR3FCompiledScene`, and records:

- the real GLB and image responses;
- every application lifecycle phase;
- the exact error type and artist-readable URL/base-path/CDN/CORS guidance;
- the nearest application-owned React Error Boundary;
- any fixture node visible in the live R3F Scene; and
- browser page/console errors.

`evidence.json` content-identifies the fixture and exact Blendlink runtime
source. `missing-companion-browser.png` is regenerated on each passing run.

The guarantee is deliberately limited to Blendlink's private loader/manager.
Blendlink does not overwrite an application-owned `LoadingManager.onError`;
applications that supply authenticated or plugin-configured loaders retain
responsibility for treating their dependency failures as terminal.
