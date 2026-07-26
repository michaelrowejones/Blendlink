# Needle raw-HTML and static-site parity audit (2026)

**Audit date:** 2026-07-23
**Scope:** Needle's raw HTML/Vanilla project workflow and asset/base-path
behavior versus Blendlink `connect`, project setup, and `publish`.
**Implementation status:** research and interface design only. No production
behavior was changed by this note.

## Executive conclusion

Raw HTML/no-package support belongs inside Blendlink's product scope. A solo
developer's existing static page is a legitimate website framework choice, and
supporting it strengthens the promise that the website owns its route, Canvas,
layout, loading presentation, analytics, and deployment.

Blendlink should adopt Needle's **breadth** here, but not copy Needle's complete
mechanism:

- recognize an existing root `index.html` without requiring `package.json`;
- leave the page byte-for-byte untouched;
- emit a small application-owned ESM binding and print the exact import/mount
  call;
- copy a content-identified, package-built browser runtime into a dedicated
  same-origin Blendlink namespace instead of depending on an unversioned CDN;
- require the application to pass an existing `HTMLCanvasElement`; never create
  a route, Canvas, overlay, or application layout;
- resolve the compiler-owned graph from the binding module's `import.meta.url`
  by default, with the existing explicit absolute CDN override;
- distinguish a static site's legitimate **no build step** from
  `--assets-only`, so post-compile verification and an optional browser smoke
  can still run; and
- never clear or claim a shared application `assets/` directory.

The recommended internal seam is one deep **website-host module** used by
connect, preview, and publish, with two real adapters: the current Node-package
host and a static-HTML host. Detection, owned-path guards, binding generation,
browser-runtime packaging, build disposition, and failure explanations belong
behind that interface.

This is the current `NDL-WF-006` gap. It remains **Gap / Future / Pending** until
the differential fixtures below pass. Source inspection is not implementation
evidence.

## Evidence and source identity

`npm run verify:needle-baseline` passed on 2026-07-23:

```text
BLENDLINK_NEEDLE_BASELINE_VERIFIED 68 files, 5 version identities (2026-07-23)
```

The inspected inventory pins:

- Needle Blender add-on `1.4.2`;
- `@needle-tools/engine` `5.1.7`;
- Needle's Three fork `0.169.19`;
- `@needle-tools/gltf-progressive` `3.6.0-beta.2`; and
- `@needle-tools/gltf-build-pipeline` `1.2.2`.

The source paths below are normalized relative to the roots in
[`needle-baseline.json`](needle-baseline.json). Hashes are SHA-256 of the exact
inspected bytes.

| Source ID | Exact source | SHA-256 | Relevant behavior |
| --- | --- | --- | --- |
| `addon-general-utils` | `utils.py` | `bde57c1d21818a9e40645afdc3c51b7f58dde1f3ef72b5c4c4c9fd665adddc30` | `webProjectExists()` requires `package.json`, while `getIsVanillaJsProject()` independently recognizes root `index.html` (`58-80`). Template copying removes and replaces the target directory (`178-191`), guarded elsewhere to empty targets. |
| `addon-project-panel` | `panels_project.py` | `b3cdc2981e48d5bd50fb3ecf255fc51c3e4035c687a84fbbd4276985514541d0` | An `index.html`-only project gets Export, Preview, Stop, and Open actions and returns before package/build UI (`466-481`). Empty directories can choose Generate HTML Project (`495-517`). |
| `addon-web-operators` | `operators_web.py` | `6a07ce69c396a0dbfeafea841b475e06786c9d1e266e8f9f7223cdbf5ece1f91` | Vanilla preview exports then starts Needle's static HTTP server (`154-175`). Project generation accepts only a missing/empty directory, copies the selected template, then calls the package-oriented `needle.start_server` path (`219-289`). |
| `addon-web-project-utils` | `utils_web_project.py` | `a59ca4ffbf965460cc6eda0574066ef8c6631bab100506f80308787599e64437` | Reading project config creates `needle.config.json` when absent; defaults are `dist`, `assets`, `src/scripts`, and `src/codegen` (`419-477`). Package builds select a package script and run install/build (`356-416`). |
| `addon-blender-export` | `blender_export.py` | `6272997cfb4f1d740ea33a7c2512983b9993dedf93c9c8240ca0ff7f82925d77` | Main output is deliberately `scene.glb` (`132-138`). The ordinary export resolves the configured assets directory, deletes its loose top-level files, and writes there (`296-323`). |
| `addon-vanilla-template` | `templates/vanilla/index.html` | `a7fd8540b65013b2ba19bd1ac914e439975ca54b2be71cec7dc8031610d371d9` | Full-page `<needle-engine src="assets/scene.glb">` plus an **unversioned** unpkg engine URL (`23-27`). |
| `addon-vite-template-package` | `templates/vite/package.json` | `6c4a4db9e052c5f27435df408bf8f2b6690686653811dd1dda1dc208daf0508b` | The add-on template itself declares engine `5.0.3`, distinct from the content-pinned installed engine `5.1.7`. |
| `engine-web-component` | `src/engine/webcomponents/needle-engine.ts` | `66e71697676b0cc115139946e5987bd4b7b97a303671b9c0cad365081d0daa68` | Creates a shadow-root Canvas (`337-345`), owns the default loading view and events (`577-709`), and reads one or more `src` strings (`839-865`). |
| `engine-context` | `src/engine/engine_context.ts` | `84a02111e67f81b67beb023455de175c8567933a04949889b51a0cb38cafb509` | Reuses the web component's shadow-root Canvas and creates/owns its renderer (`666-704`). |
| `engine-loaders` | `src/engine/engine_loaders.ts` | `3df0fbf23e1d36451cc7827fdbc26bb8c4a594d91dfd358526aca4b8ef6d9a73` | Gives `GLTFLoader` a resource path derived from the loaded glTF URL (`155-180`) and resolves user URLs against the current page when diagnosing `file:` loading (`333-339`). |
| `engine-utils` | `src/engine/engine_utils.ts` | `adb259462e2d859aaca599d2f191c6cdfaf3eb86d4fc92e6b181ca45ba77cb3c` | Resolves serialized companion URLs relative to their source asset directory (`380-429`). |
| `engine-vite-copyfiles` | `plugins/vite/copyfiles.js` | `a53513a43f69439b6f7b23cd78ebe74b3c9915142f0986095e6cb8e94b0a06c1` | Reads the configured source assets directory, clears build `dist/assets` at build start, and recursively copies into stable output `assets` (`54-63`, `116-128`). |
| `engine-vite-config` | `plugins/vite/config.js` | `d0207db1ce17a7a58b15cd14ef1de032744701491a6d5167bfe230a1e5871990` | Reads `needle.config.json` and exposes stable build/assets conventions. |
| `generated-vite-config` | `vite.config.js` | `e34507308cc0781dd917777c57e94e09abe8ae92871081e4888dc74a8c470554` | Uses Vite `base: "./"` (`12`), making generated bundle references relocatable with the HTML output. |
| `engine-next-plugin` | `plugins/next/next.js` | `947cd6a36dd59e099af8b0e36833ad946d53c6df0c7f10dd1b2958579ab82459` | Defaults Next to static export, unoptimized images, and `dist`; it contains no scene-URL `basePath` or `assetPrefix` rewriter (`45-64`). |

Current platform documentation corroborates, but does not replace, the pinned
source:

- Needle documents that its web component works in raw HTML and can be loaded
  from a CDN without a bundler:
  [Web Integration & Frameworks](https://engine.needle.tools/docs/html.html).
- Needle documents `assets/` as integration-managed and directs custom
  application assets to `include/`:
  [Needle project structure](https://engine.needle.tools/docs/explanation/core-concepts/project-structure.html).
- Vite documents that `base: "./"` makes generated references relative to each
  output file:
  [Vite production public base](https://vite.dev/guide/build.html#public-base-path).
- The HTML Standard defines relative URL parsing from the document base URL,
  including the first applicable `<base href>`:
  [HTML document base URLs](https://html.spec.whatwg.org/multipage/urls-and-fetching.html#document-base-urls).
- Next documents that `basePath` is a build-time application prefix and that
  `assetPrefix` does **not** prefix files in `public/`:
  [Next `basePath`](https://nextjs.org/docs/app/api-reference/config/next-config-js/basePath),
  [Next `assetPrefix`](https://nextjs.org/docs/app/api-reference/config/next-config-js/assetPrefix).

## What Needle actually does

### Existing raw HTML project

Needle does not treat raw HTML as a package project. Instead it has a parallel
recognition branch:

1. a package project exists only when root `package.json` exists;
2. a Vanilla project exists when root `index.html` exists;
3. the project panel detects the latter and exposes Export Scene, Preview
   Scene, Stop Preview, and Open Directory;
4. Preview exports the scene and starts a static HTTP server rooted at that
   directory; and
5. the panel returns before the package install/build controls.

The add-on does not parse or patch an existing `index.html`. The developer is
responsible for putting `<needle-engine>` in the page. That is the most
important behavior to match: recognize the host and preserve its page.

The raw path is not mutation-free. Resolving the assets directory creates
`needle.config.json` when absent. Export owns the integration-managed assets
directory and deletes its loose top-level files before writing the new export.
Needle's official project-structure contract explicitly reserves `assets/` for
the integration.

### Generated raw HTML project

For an empty directory, Generate HTML Project copies a full-page template. The
template:

```html
<script type="module"
  src="https://unpkg.com/@needle-tools/engine/dist/needle-engine.min.js"></script>
<needle-engine src="assets/scene.glb" camera-controls></needle-engine>
```

That is an extremely small interface, but it has three properties Blendlink
should not inherit:

1. the runtime URL is not version-pinned;
2. `<needle-engine>` creates its own shadow-root Canvas and renderer; and
3. the engine owns the default loading view, subject to its own customization
   rules.

The audited generator also calls `needle.start_server`, not
`needle.start_vanilla_server`, immediately after copying either template.
Source inspection therefore does not establish a successful first-launch path
for the package-free template. The separate panel branch clearly supports
subsequent Vanilla export/preview.

### Asset and deployment addressing

Needle uses locality as its primary deployment rule:

- raw HTML requests `assets/scene.glb` relative to the document base URL;
- Vite output uses `base: "./"` and places copied scene assets at
  `dist/assets`;
- glTF companions are resolved relative to the loaded scene URL; and
- full HTTPS scene URLs are accepted by the runtime.

This works well when HTML, runtime chunks, scene, and companions move together.
It is sensitive to page nesting and authored `<base>` for the root
`assets/scene.glb` reference. Moving a page from `/portfolio/index.html` to
`/portfolio/gallery/index.html` changes that root scene request unless the
author changes the URL or supplies a base.

The audited Next plugin configures the framework build but does not solve
general scene URL prefixing. That agrees with Next's current platform contract:
`assetPrefix` covers `/_next/static`, not arbitrary `public/` files.

## Current Blendlink behavior

The current working tree was inspected at Git `9966b01ae9ba07ec33fcd87ffac3c0abe4f5e7a3`
plus the repository's existing uncommitted work.

### Connect/project setup

`packages/blendlink/src/projectSetup.ts` currently exposes:

```ts
type WebsiteStack =
  | 'new-three-vite'
  | 'three'
  | 'react-three-fiber'
```

The behavior is deliberately safe:

- existing `package.json` must declare a supported `three` or R3F/React pair
  before any integration mutation (`205-229`);
- no `package.json` means `new-three-vite` (`550-555`);
- an existing `index.html`, `tsconfig.json`, `src/main.ts`, or
  `src/style.css` is then treated as an incomplete scaffold collision and
  rejected before setup (`560-570`);
- existing package sites receive one tiny application-owned scene association
  and no application component is edited (`365-454`, `615-640`); and
- an actually empty directory receives the complete Vite starter (`238-331`).

This is correct preservation behavior, but it leaves `NDL-WF-006` open:
Blendlink cannot yet distinguish “existing static website” from “unsafe
partial Vite scaffold.”

The generated `.ts` association imports `three`, `blendlink/three`, the typed
descriptor, and the baked recipe. It is intentionally appropriate for a
package/bundler project and is not directly executable by a no-package browser.

### Publish

`packages/blendlink/src/publish.ts` compiles Final, verifies, runs the
application's package build, verifies again, and optionally runs the declared
smoke. Without `package.json`, it fails loudly and recommends
`--assets-only` (`68-88`, `208-233`).

`--assets-only` is not an adequate raw-site parity path because it also
unconditionally skips the browser smoke (`244-251`). A static HTML host has a
real deployment artifact even when no build is necessary; “not applicable”
must not be conflated with “the caller opted out of application verification.”

### Asset addressing

Blendlink is already stronger in several dimensions:

- `runtimeAssetGraph` identifies the complete compiler-owned runtime graph;
- `compiledSceneAssetUrls()` enumerates the GLB and declared companions;
- `assetBaseUrl` can be an origin-rooted application base path or an absolute
  CDN root;
- only compiler-owned requests are rewritten; and
- query strings and fragments are preserved.

The current resolver intentionally rejects ambiguous relative bases such as
`"./"`. That is correct for a general Next/R3F caller but leaves no automatic
relocation path for a raw static binding. The binding can solve this without
weakening the resolver: pass the absolute URL produced by
`new URL("./", import.meta.url)`.

## Capability record

| ID | Capability | Needle | Blendlink | Relation | Implementation | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| `NDL-WF-006` | Attach an existing root-HTML/no-package site | Recognizes root `index.html`; exports/previews without rewriting it | Rejects it as an incomplete scaffold | **Gap** | **Future** | Needle baseline verifier passed 2026-07-23. No Blendlink acceptance fixture exists. |
| `NDL-WF-007` | Static host publish without an application build | Raw panel exposes export/preview but no package build transaction | Only `--assets-only`, which also skips smoke | **Gap** | **Future** | Exact source inspection; publish differential pending. |
| `NDL-ASSET-007` | Relocatable static scene root | Document-relative root GLB plus GLB-relative companions; Vite uses relative base | Explicit origin-root/CDN rebasing exists, but no static binding supplies a module-relative default | **Boundary / proposed Improvement** | **Future** | `assetUrls.test.ts` covers explicit bases; packed relocation fixture pending. |
| `NDL-DIAG-005` | Reproducible package-free runtime identity | Shipped raw template imports an unversioned unpkg runtime | No package-free runtime yet | **Proposed Improvement** | **Future** | Exact Needle template/source identity only; packed same-origin runtime and no-remote-request evidence pending. |

The “proposed Improvement” rows are design decisions, not verified claims.
They must not be promoted until the named browser/package fixtures pass.

## Designs considered

### Design A — copy Needle's custom-element handoff

Generate or ask the user to add:

```html
<script type="module" src="...blendlink-browser.js"></script>
<blendlink-scene src="..."></blendlink-scene>
```

**Strengths**

- smallest developer-facing interface;
- familiar to raw HTML authors;
- one element can hide renderer, resize, loading, and disposal.

**Why it is rejected**

- Needle's analogous element creates the Canvas in its shadow root;
- a full element naturally owns layout and default loading presentation;
- replacing the site's Canvas ownership contradicts the explicit Blendlink
  product boundary; and
- a runtime CDN dependency weakens offline, CSP, and reproducibility behavior.

This design reaches surface parity by giving up a core ownership promise.

### Design B — patch the existing HTML automatically

Detect a page, insert a Canvas and module script, and preserve an annotated
region on later connects.

**Strengths**

- apparent one-click result;
- can remain renderer-agnostic behind the inserted bootstrap.

**Why it is rejected**

- deciding which page, Canvas, insertion point, CSP nonce, module ordering, and
  teardown policy to own is equivalent to owning application structure;
- robust round-tripping across hand-written HTML, formatters, templates, and
  server-side includes is a shallow and failure-prone interface;
- a parse/write can alter bytes even when semantics appear unchanged; and
- multi-page sites make route choice ambiguous.

This would exceed the user's authorization for an application-owned site.

### Design C — static host adapter plus explicit ESM mount

Recognize the static host, generate one stable application-owned binding, copy
the package-built browser runtime and compiler-owned scene modules, and print a
manual two-line mount call.

Example application code:

```js
import { mountHeroScene } from './blendlink/HeroScene.mjs'

const canvas = document.querySelector('#hero-scene')
const hero = await mountHeroScene({ canvas, onLoadStateChange })
```

The generated-once binding would remain deliberately small:

```js
import { mountStaticCompiledScene } from './runtime/runtime-<identity>.mjs'
import {
  descriptor,
  createBakedScene,
} from './generated/hero.scene.mjs'

export function mountHeroScene(options) {
  return mountStaticCompiledScene({
    ...options,
    descriptor,
    createBakedScene,
    assetBaseUrl:
      options.assetBaseUrl ?? new URL('./', import.meta.url),
  })
}
```

The compiler-owned `hero.scene.mjs` can change atomically while the
application-owned `HeroScene.mjs` remains stable. Exact file names are
illustrative and must be settled by a prototype; the ownership split is the
contract.

**Strengths**

- route, page, Canvas element, layout, loading UI, analytics, and deployment
  remain application-owned;
- no application package install or bundler is required;
- a same-origin, content-identified runtime is reproducible and CSP-friendlier
  than an unversioned remote script;
- module-relative default addressing survives an unknown deployment prefix
  after the binding has loaded;
- the existing runtime lifecycle and presentation seams remain reusable; and
- a returned handle gives explicit retry/state/control/dispose ownership.

**Costs and constraints**

- Blendlink must package a browser-safe runtime graph with its own pinned
  internal bundler; the site must not need that tool;
- bundle size, license notices, source maps, and runtime deduplication need a
  packed-package test;
- the package-free path cannot promise TypeScript checking;
- the first implementation should own one renderer per mounted static binding
  while accepting the site's Canvas; injection of an arbitrary external Three
  renderer is a separate advanced adapter, not initial parity; and
- KTX2/worker CSP constraints remain real and must be reported, not hidden.

**Decision:** pursue Design C.

Requiring the developer to convert the page into a Vite/package project is the
current fallback, not a fourth parity design. It preserves type safety but does
not close the raw-HTML capability gap.

## Recommended deep module

### Seam

Create a package-owned `websiteHost` module. Its public-to-the-package
interface should stay close to:

```ts
interface WebsiteHost {
  readonly kind: 'node-package' | 'static-html'
  connect(input: WebsiteConnectionInput): Promise<WebsiteSetupResult>
  preview(input: WebsitePreviewInput): Promise<WebsitePreviewResult>
  build(input: WebsiteBuildInput): WebsiteBuildResult
}

function openWebsiteHost(root: string): WebsiteHost
```

`projectSetup`, connected Preview, and `publish` call this interface. They do
not inspect `package.json`/`index.html`, choose output ownership, synthesize
commands, or special-case “no build” themselves.

This is a real seam because there are two production adapters:

- **Node-package adapter:** current Three/R3F package detection, package
  scripts, package manager, user-owned renderer integration, and build command.
- **Static-HTML adapter:** root `index.html` recognition, static preview server,
  browser-runtime packaging, generated ESM binding, no-build disposition, and
  optional smoke.

The implementation should use an internal pure planner plus a guarded apply
transaction. That internal seam enables byte-preservation/collision tests
without making planned file lists part of the caller's interface.

### Why this is deep

Deleting the module would redistribute host detection, path ownership, output
layout, runtime packaging, dev-server selection, build/no-build policy, error
wording, and verification ordering across setup, preview, publish, and Blender
UI. Keeping those decisions behind three operations produces leverage and
locality.

Do not add a generic pluggable “framework adapter” registry. Two concrete
adapters justify this seam; hypothetical frameworks do not.

### Static output ownership

For a newly connected static site with no existing Blendlink config, use one
dedicated served namespace, for example:

```text
blendlink/
  HeroScene.mjs                 # generated once; application-owned
  runtime/
    runtime-<package-id>.mjs    # package-owned, content-identified
    THIRD_PARTY_NOTICES.txt
  generated/
    hero.scene.mjs              # compiler-owned, atomically replaced
  models/
    ...complete scene graph...  # compiler-owned
```

This avoids Needle's whole shared-`assets/` ownership. The real layout must be
validated against static hosts that reject hidden paths, so a dot directory is
not recommended by default.

An ownership marker must list the exact generated paths and creator version.
Reconnect may update only marker-owned compiler files. A pre-existing
unmarked `blendlink/` path is a loud collision, not an overwrite target.

An existing `blendlink.config.mjs` remains authoritative. If its `outDir` or
`genDir` cannot be served/imported by the static host, connect must explain the
exact path mismatch rather than silently reshape executable configuration.

## Failure contract

Detection and all blockers must run before mutation.

| Condition | Required outcome |
| --- | --- |
| Valid `package.json` exists | Use the current Node-package adapter, even when `index.html` also exists. |
| No package; readable regular root `index.html` exists | Select `static-html`; hash the page and preserve its bytes. |
| Neither package nor HTML; current starter guard paths absent | Keep the current new Three/Vite starter behavior. |
| Neither package nor HTML; unrelated nonempty/incomplete scaffold | Refuse exactly as today; do not guess static ownership. |
| Malformed package | Refuse as today; do not fall through to static HTML. |
| Unmarked collision in the static Blendlink namespace | Refuse before creating config, output directories, or bindings; name every conflicting path. |
| Existing generated-once binding | Preserve it exactly; update only compiler-owned imports/targets behind its stable path. |
| Static Canvas missing, zero-sized, detached, or already mounted incompatibly | Reject with the selector/element and remedy; never create or resize CSS layout to hide the problem. |
| Static host has no build step | Return `status: "not-required"` (or an equally distinct typed state), run second artifact verification, and still run configured browser smoke. |
| Browser runtime packaging fails | Preserve the last good runtime/scene graph and surface bundler output tail; do not leave a partial module graph. |
| Module-relative default is insufficient because assets are on a CDN | Require explicit absolute `assetBaseUrl` and retain caller-owned headers/credentials/CORS policy. |

The static binding should accept the same stable loading/presentation facts as
the package adapters and return one idempotent handle with `dispose()`. An
optional `AbortSignal` is useful for route teardown, but claims about stopping
network/decoder work remain limited by the existing loader ownership contract.

## Differential fixture plan

### 1. Static recognition and byte ownership

Add `projectSetup.staticHtml.test.ts`:

1. create `index.html`, application JS/CSS/images, and a selected `.blend`;
2. record SHA-256 for every application file;
3. connect and require `kind: "static-html"`;
4. require no `package.json`, no edited HTML, and no writes outside the
   declared Blendlink namespace/config;
5. verify the generated binding imports the actual configured scene module;
6. reconnect and require byte-identical application files and binding; and
7. place an unmarked output collision and prove the entire operation fails
   before any other mutation.

This fixture must independently fail today's new-Vite classification and an
HTML-patching implementation.

### 2. Static publish ordering

Add `publish.staticHtml.test.ts` through the shared website-host seam:

```text
compile Final
→ verify
→ build status not-required
→ verify again
→ optional application smoke
```

Assert that:

- no package-manager command runs;
- smoke still runs;
- first verification failure prevents all later steps;
- packaging/build-disposition failure prevents smoke;
- second verification failure reports changed artifacts; and
- `--assets-only` remains a distinct explicit opt-out and still skips smoke.

### 3. Packed no-package consumer

Add `scripts/test-static-html-consumer.mjs` to the portable consumer gate:

- install/invoke the packed Blendlink tarball from a separate runner, while the
  website fixture itself has no `package.json` or `node_modules`;
- connect, compile a small real scene, and serve only the static website;
- assert no requests to unpkg, jsDelivr, or another runtime CDN;
- assert runtime identity and third-party notices came from the packed package;
- assert every `compiledSceneAssetUrls()` entry returns `200` with expected
  bytes/hash;
- assert Ready, a nonzero Canvas, live WebGL, and nonblank pixels; and
- assert cleanup stops the frame loop and releases the mount.

This is the proof for `NDL-DIAG-005`; a unit test cannot establish it.

### 4. Unknown-prefix and nested-page relocation

Serve the exact same emitted directory at:

- `/`;
- `/portfolio/`; and
- `/deep/unknown/prefix/`.

Also load from a nested application page and from a page with an authored
`<base href>`. Once the binding module loads, all compiler-owned requests must
derive from its module URL, not the page URL. Record every request URL and fail
on a root `/models` escape or any `404`.

For the Needle side of the differential, serve the exact pinned Vanilla
template and pinned engine bytes locally at two page depths. Demonstrate that
its authored `assets/scene.glb` follows the HTML document base, while glTF
companions follow the scene URL. Do not depend on the live unpkg tag in this
test.

### 5. CDN/CORS and CSP

Run the static page and graph on separate loopback origins:

- success with explicit absolute `assetBaseUrl` and correct ACAO;
- loud CORS failure without ACAO;
- caller-owned credentials/header loader case, if supported by the selected
  static runtime interface;
- same-origin runtime under `script-src 'self'` with no remote script request;
- required KTX2 under allowed and blocked worker policy, preserving the
  existing `worker-src blob:` diagnosis.

Local loopback evidence must remain labeled local; it is not deployed-CDN
proof.

### 6. Regression gates

Before promoting `NDL-WF-006`:

```text
npm run verify:needle-baseline
npm run test:full
npm run test:consumer
npm run test:package
<new packed static-HTML browser fixture>
git diff --check
```

The flagship Node/Next dogfood publish and browser suite must also remain green.
Raw support must not weaken package-site renderer/version validation or mutate
the dogfood route.

## Current evidence state

On 2026-07-23, with Node `24.15.0`, npm `11.12.1`, and Vitest `3.2.7`:

```text
npm exec --workspace blendlink -- vitest run \
  src/projectSetup.test.ts src/publish.test.ts src/assetUrls.test.ts

3 test files passed
30 tests passed
```

This verifies the current guarded setup, package publish ordering, and explicit
base/CDN URL resolver. It does **not** verify raw static acceptance, a browser
bundle, unknown-prefix relocation, no-build smoke, or deployed CDN behavior.

## Product boundary

This capability fits Blendlink only under these constraints:

- no cloud dependency;
- no proprietary application engine;
- no complete-site generation for an existing page;
- no route or HTML rewrite;
- no Canvas creation;
- no imposed loading screen or analytics;
- no deployment/upload ownership; and
- no claim that a local static smoke proves production headers or CDN policy.

The result should feel like the existing package integrations: substantial
compiler, loader, preparation, render-loop, and cleanup complexity behind one
small scene binding, with the website still visibly in charge.
