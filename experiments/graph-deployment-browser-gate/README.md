# Graph-addressed deployment browser gate

Status: **packed production-module / local browser evidence**, 2026-07-24.

Run from the Blendlink repository:

```powershell
node experiments/graph-deployment-browser-gate/run.mjs
```

The runner builds the current package, creates a real npm tarball, extracts
that tarball into isolated consumers, publishes one exact scene graph with the
packed production `sceneAssetGraph` and `scenePublication` Modules, derives
the host cache policy from packed `assetUrls`, and then exercises it in Chromium
through:

1. a Vite production build with `base: '/portfolio/'`;
2. a Next 16.2.6 production build with `basePath: '/portfolio'`; and
3. a separate-origin local CDN fixture.

The scene is a valid binary glTF containing a textured triangle. Its texture is
an external PNG, so `GLTFLoader` has to resolve and decode a companion request.
The graph also contains all four files in Blendlink's Basis runtime closure.
The browser fetches those files through the packed package's
`createCompiledAssetUrlModifier`.

## Question and selected design

Can an application-owned host expose a complete graph at
`models/<scene>/<full-sha256>/...`, rebase that graph under a framework path or
CDN with the current public runtime interface, and truthfully grant immutable
caching only to the digest directory?

The selected design keeps graph identity, sealing, activation records, URL
resolution, and the exact immutable-prefix policy in deep package-owned
Modules, while host behavior stays behind ordinary static-host adapters. Vite,
Next, and the CDN do not become runtime branches in Blendlink. The website
still owns the framework, route, base path, header installation, and CDN.

## Evidence

The generated [`output/evidence.json`](output/evidence.json) records:

- exact Node, npm, Blendlink tarball, Vite, Next, React, Three, Playwright, and
  Chromium versions;
- the exact packed production module paths, activation record, graph-addressed
  scene URL, and derived immutable-prefix policies;
- the graph fingerprint and every graph entry;
- every observed asset response URL, status, `Cache-Control`, CORS, and content
  type;
- the URL modifier's input/output pairs;
- the Vite and Next production build results;
- negative header probes for the mutable pointer, a stable path, a 63-hex
  directory, and a 64-character non-hex directory.

The generated
[`output/graph-deployment-browser-gate.png`](output/graph-deployment-browser-gate.png)
captures the final Next/CDN browser cell.

The gate fails unless:

- Vite requests the full graph beneath `/portfolio/`;
- Next requests it beneath the production `basePath`, never `/models/...`;
- the CDN requests the same graph beneath its configured absolute root;
- `GLTFLoader` parses the GLB and decodes the external PNG;
- every Basis closure file is fetched;
- every digest-directory response is
  `public, max-age=31536000, immutable`;
- no mutable or malformed-digest route receives `immutable`; and
- cross-origin responses authorize the exact application origin with
  `Vary: Origin`.

## Needle baseline

This is capability `NDL-DEP-002`: relation **No analogue**, implementation
**Shipped**, evidence **Verified local browser gate**. It is not a claim about
a coherent Needle end-to-end stack. The exact audited Needle Engine 5.1.7
sources remain:

| Normalized source path | SHA-256 | Observed behavior |
| --- | --- | --- |
| `node_modules/@needle-tools/engine/plugins/vite/copyfiles.js` | `a53513a43f69439b6f7b23cd78ebe74b3c9915142f0986095e6cb8e94b0a06c1` | Recursively copies to a stable assets directory. |
| `node_modules/@needle-tools/engine/plugins/vite/config.js` | `d0207db1ce17a7a58b15cd14ef1de032744701491a6d5167bfe230a1e5871990` | Uses the conventional stable assets output. |
| `node_modules/@needle-tools/engine/plugins/next/next.js` | `947cd6a36dd59e099af8b0e36833ad946d53c6df0c7f10dd1b2958579ab82459` | Supplies Next integration but no general scene-graph `basePath`/CDN resolver. |
| `node_modules/@needle-tools/engine/plugins/common/buildinfo.js` | `18218dc81a790741f20d94261835366287708756c0d60c689192a867947bda63` | Inventories individual build hashes without making one permanent graph directory. |

Run `npm run verify:needle-baseline` before using that comparison. The pinned
inventory is still `integration=mixed-source`, so the Needle comparison remains
source-attributed rather than an end-to-end differential. This gate proves the
packed Blendlink production publication Modules across local production Vite,
Next, and second-origin browser cells.

## Primary-source constraints

- Next documents `basePath` as build-time configuration and says manually
  authored public-file URLs must include it:
  <https://nextjs.org/docs/app/api-reference/config/next-config-js/basePath>
- Next automatically prefixes `headers()` matchers with `basePath`, and checks
  those rules before public files:
  <https://nextjs.org/docs/app/api-reference/config/next-config-js/headers>
- Next serves ordinary public files with `Cache-Control: public, max-age=0`
  because their names may change:
  <https://nextjs.org/docs/app/api-reference/file-conventions/public-folder>
- Vite rewrites build assets for `base`; dynamically constructed public URLs
  must use the statically replaced `import.meta.env.BASE_URL`:
  <https://vite.dev/guide/build>
- Vite copies `public/` files without content hashing:
  <https://vite.dev/guide/assets.html>
- A response that varies an explicit CORS origin must also vary on `Origin`:
  <https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS>
- RFC 9111 makes the target URI part of the cache key. A changed graph must
  therefore receive a changed digest URI:
  <https://www.rfc-editor.org/rfc/rfc9111.html#section-2>

## Deliberate limitations

- The CDN is a second loopback origin, not a deployed edge network.
- The Vite adapter is a minimal static server around a production build. Vite
  itself does not configure production response headers.
- The Next case uses `next build` plus the production server, not static export.
- The Basis files are fetched and header/CORS checked, but this fixture has no
  KTX2 texture and therefore does not claim a decoder/transcode or worker gate.
- `GLTFLoader` decodes the external PNG, but no renderer uploads it to a
  physical GPU. GPU readiness remains a separate lifecycle claim.
- The fixture proves anonymous CORS (`credentials: 'omit'`) for exact local
  origins. It does not prove credentialed CORS, custom headers, signed URLs, or
  a real CDN configuration.
- The gate exercises production graph construction, sealing, activation-record,
  URL, and cache-policy Modules from the npm tarball, but does not run Blender or
  the full `blendlink sync` pipeline.
- `current.json` is an explicitly mutable negative-header control. Blendlink's
  production activation point remains its generated module/manifest; the gate
  does not claim a separate runtime pointer protocol.
