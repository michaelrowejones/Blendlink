# Needle behavioral baseline audit

- Initial audit date: 2026-07-22
- Baseline identity consolidated: 2026-07-23
- Selected-material/lightmap runtime re-audit: 2026-07-24
- Imported texture-sampling re-audit: 2026-07-25
- Blendlink comparison target: package `0.8.0`, Three `0.184.0`, React Three
  Fiber `9.6.1` (supported peer range `>=9 <10`), React/ReactDOM `19.0.0`
  (supported peer range `>=19 <20`)
- Scope: bake planning, material context, UV allocation, cache invalidation,
  visibility, export, loading, lifecycle, deployment, and Components
- Method: static inspection of the exact local Needle sources plus existing
  differential fixtures and official platform documentation

## Decision

Needle is Blendlink's required behavioral baseline, not a source-code donor or
an engine boundary to reproduce. For every behavior-level change, Blendlink
must do one of four things:

1. match Needle's proven behavior;
2. improve it for a named artist outcome or Blendlink product boundary and
   prove the improvement with a focused differential fixture;
3. record a real gap and keep the claim out of **Verified**; or
4. record that Needle has no analogue.

The durable audit mechanism is a **content-identified source baseline plus a
behavior matrix and differential tests**. A version-only checklist is
insufficient: two installations can report the same add-on version while their
actual files differ. Copying Needle implementation snapshots into Blendlink
would create license and drift risks and would test code identity instead of
artist-visible outcomes. This note summarizes behavior only; no Needle
implementation text was copied.

The permanent rule lives in [`AGENTS.md`](../AGENTS.md) and the execution gate
lives in [`TECHNIQUE_LEDGER.md`](TECHNIQUE_LEDGER.md). This note is the pinned
comparison inventory that those rules point to.

## Evidence language and current-run boundary

- **Shipped**: production code exists.
- **Prototype**: bounded experimental code/evidence exists outside the
  production contract.
- **Future**: researched direction without a production claim.

Evidence is separate from implementation state:

- **Fixture verified** means the named differential fixture passed on its
  recorded toolchain; the row must name the fixture or test and scope the claim
  to what that seam observes.
- **Aggregate verified** means the exact command, last-pass date, and toolchain
  are recorded. A prior pass is historical evidence, not proof of the current
  dirty worktree.
- **Pending current run** means the fixture exists but has not passed against
  the current implementation/package. It must not support a release claim.

Older matrix cells use **Implemented** as a synonym for **Shipped** and
**Verified** as shorthand for fixture-level evidence. Read both under the
scoped definitions above; migrate a row to explicit implementation/evidence
wording whenever it changes.

The relation is stated separately:

- **Match**: same behavioral approach.
- **Improvement**: intentional deviation with a stronger evidenced outcome.
- **Gap**: Needle currently provides an outcome Blendlink does not.
- **No analogue**: no comparable Needle path was found in the inspected source.
- **Boundary**: the approaches differ because Blendlink leaves the route,
  Canvas, framework, loading presentation, analytics, and deployment with the
  application.

## Exact baseline identity

The audited add-on is the reproducible cache at:

```text
C:\Users\micha\Documents\GitHub\MichaelRoweJonesSite\.cache\needle-spike\addon\Needle Engine Exporter for Blender
```

The audited runtime is:

```text
C:\Users\micha\Documents\GitHub\blendlink\experiments\needle-spike\node_modules\@needle-tools\engine
```

| Baseline element | Audited identity |
| --- | --- |
| Add-on acquisition archive | `needle-blender-plugin-1.4.2.zip`, 401,971 bytes; SHA-256 `d947ab298f6c6e47591321ba462c8b21ada2229bc640262cad9998564a0e745a` |
| Needle Blender add-on | `1.4.2`; `__init__.py` SHA-256 `980226a628182e9e0b1d443c0e294f799162c76e06c5f599dacc20c614a8c96e` |
| Needle lightmapping implementation | `lightmapping/lightmapping.py` SHA-256 `4e69f0934d9329b2d8480b097baa1d903aa31bed9337c7a2ae0630cbc900b4f1` |
| Needle packer implementation | `lightmapping/lightmapping_pack.py` SHA-256 `242aad7a29c177ac566ad519425ec55cb0376805d02197a0519107a761801cd3` |
| Needle runtime | `@needle-tools/engine` `5.1.7`; `package.json` SHA-256 `15632e6e97f72044defa51db8e703c3c1583c2316c58dd4de10c35c5e6ff4b06` |
| Needle lightmap shader/registry runtime | `src/engine/engine_lightdata.ts` SHA-256 `9ef66efa71b66a0a02dbdb2160cd0285c4cb409b589d7471f9a6380c5a7c2e59`; the clean Engine `5.1.4` fixture contains the same bytes, but this does not promote the overall stack beyond `integration=mixed-source` |
| Needle Three runtime | npm alias `@needle-tools/three@0.169.19`; nested `package.json` SHA-256 `17bdbf08346fcbab12c79ca75847a0e90f26be57a0faac241a4a3564faa9e463` |
| Progressive loader | `@needle-tools/gltf-progressive` `3.6.0-beta.2`; nested `package.json` SHA-256 `f8f4719e15f4c1fddff01a9cf3efa8cfc5276652093e53509f6582da005ed900` |
| Add-on-selected build pipeline | `@needle-tools/gltf-build-pipeline` `3.0.0`; `package.json` SHA-256 `c5d25e13d4d17e3a8d7fa2695ca404a824d85fae36eb16a90ad5cd7cc3c0077e`; bundled CLI SHA-256 `73afd7b8fdacf74717577e22bfb899ce080ca00bcc4ccdcf6dbfaad52bb144d1` |
| Build-pipeline acquisition | npm tarball SHA-256 `e45acae0c743b72f196aeebb37d9a0b492e619339da08f7d4f9c1a0976371089`; README SHA-256 `329be3b100f984f83f7a20b0b20418adc3da59ff1709beacd9365e9b3270b9f0`; changelog SHA-256 `62d7f00ff478c5b93a71660893ca8ec5912825bfef8bb2ca4832e26bcc345801` |
| Historical generated-spike pipeline | `@needle-tools/gltf-build-pipeline` `1.2.2`; `package.json` SHA-256 `a8000057d8b93c479ccdcc9cc2f0c1aec76d62f097a8fb909127a56f99700f8d`; retained only to explain the old spike lock, not used as evidence for add-on 1.4.2 Auto Compress |
| Generated spike dependency lock | `package-lock.json` SHA-256 `88e6ea94015fa4706a4708df899a0327e74aae0b1c1be1da86cda67dd1d37f38` |
| Add-on-selected clean dependency fixture | `package.json` SHA-256 `41753af69993e942ded85003cddd81f861cc0eb215b28fd42653a73aba89debc`; `package-lock.json` SHA-256 `70b4564d2a569b78e0fd47c9f33e6d5ba87a747717b9c898790b451d5b7febd5`; 482-package `npm ci` replay plus `npm ls --all` passed on 2026-07-23 |

### Integration-coherence boundary

The broad identity inventory remains `integration=mixed-source`. It
deliberately retains the historical Engine `5.1.7` spike, exact add-on `1.4.2`
sources, the clean Engine `5.1.4` dependency fixture, the separately acquired
build pipeline `3.0.0`, and focused runtime/browser fixtures. A coherent named
cell must not promote all of those paths as one runnable stack.

The historical spike declares Engine `5.1.4` and Helper `2.0.0`, but its
installed tree contains Engine `5.1.7` and Helper `1.4.0`; the latter brings
build pipeline `1.2.2`. In contrast, the pinned add-on `1.4.2` explicitly
invokes `@needle-tools/gltf-build-pipeline@3.0.0 transform`, so the historical
tree's `npm ls` correctly exits with `ELSPROBLEMS`.

A new isolated dependency fixture closes the package-resolution prerequisite:
[`experiments/needle-coherent-addon-1.4.2`](../experiments/needle-coherent-addon-1.4.2/README.md)
locks the add-on-selected declarations, replays with `npm ci`, and passes
`npm ls --all` over 482 installed packages. Its direct resolutions are Engine
`5.1.4`, project Three alias `0.169.21`, `@types/three` `0.169.0`, Helper
`2.0.0`, Component Compiler `3.0.20`, and build pipeline `3.0.0`. Engine
`5.1.4` also installs a nested exact Three `0.169.19`, so this is a clean npm
tree but not a single-copy Three tree.

One named cell now closes a coherent **official Preview** path without
overstating the licensed production path:

```text
integration:splash-official-preview=coherent
```

[`experiments/needle-splash-official-preview`](../experiments/needle-splash-official-preview/README.md)
contains the exact generated package/config shape, a clean installed tree,
Engine `5.1.4`, Vite `8.0.3`, the add-on-exported uncompressed Splash GLB and
EXR, the official Needle Vite plugin/build-info path, and a named Chrome/WebGL2
browser differential. `npm ls --all` exits `0`. The browser passed page, exact
asset graph, loading, authored-camera, Canvas, WebGL, nonblank, and relevant
error assertions. Its screenshot is byte-identical to the superseded mixed-host
capture, so the visual finding is unchanged: all three complete Eevee-relative
Splash gates remain red.

| Official Preview input/evidence | SHA-256 |
| --- | --- |
| Generated `package.json` | `c808e760808b96fc87b0ff8a2be6b346e844a204976c16aaf85fcedf80844ec2` |
| Exact lock | `a3c5b7c3102414fdc1b7d1a07859816c38525c0e1b647ce0c90341558e40d322` |
| Official `vite.config.js` | `38831f1bb7f23b086c0f096f3dbd165b1f61e0eb8b9e1ebeb0b71af295e9e573` |
| Engine `5.1.4` package | `522f0a5aa64c22fe76a5d7c6fd0f039fce396eb841324512862c0d704bcacb38` |
| Engine `5.1.4` bundle | `c6fefdeda5137b38a611c587bca9c93f9f56068ffdf88c0d2b2d3bd0a1bae261` |
| Vite `8.0.3` package | `a6e1e3371949bbc440444b6503c4ab206386d1eca5cf51caecd28283aaa0631d` |
| Exported `scene.glb` | `ba66cf5c974bf5fb14740e42225de5030174e9ecbe2731d74b7ad0fb38660da9` |
| Exported `forest.exr` | `bdf2298244affa0f85509380fd130ac6d4dfaa3c856df065998f7f4c1a93dc0d` |
| Passed browser evidence JSON | `aa6045b86588b48ea0e8153c7c440fe03a3bf3bb191ba0ca840c18b3d8bba06c` |
| Browser screenshot | `54e30ecaa0342611122288efbf6ffe9c7440709d6d613c67adf77d37fe0efcbc` |
| Red visual-differential evidence JSON | `ac538adc31de0a7d4446c54890cdbaa2907793484c91f112f94b2f573f0d5e9d` |

This named cell is intentionally Preview-only. The official development build
reported that the licensed production pipeline was skipped. A valid JWT,
`@needle-tools/gltf-build-pipeline@3.0.0 transform`, and the resulting
production browser differential remain **Pending**. The clean tree also
contains project `@needle-tools/three` `0.169.21` and Engine-nested
`@needle-tools/three` `0.169.19`; clean does not mean single-copy Three.

The additive machine-readable model was chosen after comparing two designs:

1. promoting the single global `integration.status` to `coherent`, which would
   falsely bless the historical and independently acquired paths; and
2. adding a named integration with its own scope, clean-tree root, pinned
   browser evidence, artifacts, and limitations.

The second design is used because it preserves locality and makes the smallest
truthful claim. The verifier runs `npm ls --all` for each named root, requires a
content-identified browser evidence JSON with `passed: true`, and checks that
the Markdown review surface includes the named status.

Separately, one bounded runtime-only differential executes the exact Engine
`5.1.4` stack in Chromium. It reuses the exact Blendlink-produced neutral GLB
and Blender dependency-graph oracle, proves the file has no
`NEEDLE_components`, loads it through `<needle-engine src autoplay>`,
exercises the runtime-created Needle `Animation` component's public
play/pause/time/update surface, renders through Needle `Context`, and verifies
teardown. Across the same nine samples it matches the Blendlink-side maxima:
position `6.729e-8`, quaternion `7.765e-4 rad`, morph `5.960e-8`, and
skinned-point Hausdorff `1.174e-5`. This closes the **runtime** side of
`NDL-ANM-001`, not add-on/build-pipeline coherence. The evidence is
[`experiments/needle-animation-runtime-differential`](../experiments/needle-animation-runtime-differential/).

The fixture also proves two behavior boundaries. Metadata-free Needle autoplay
chooses one of three independent clips randomly; coordinating all three needs
explicit non-exclusive calls through the component API. Blendlink's authored
Start All is deterministic. Loaded objects, the SkinnedMesh, and the component
mixer are Engine-nested-Three instances rather than project-Three instances.
One duck-typed `Vector3` target worked, but this is not general cross-copy safety
evidence.

Per-package source conclusions, each clean-tree result, and the named Preview
cell remain valid only at their recorded scopes. They do not establish an
authenticated production result. The pinned build pipeline is CLI-only and
requires JWT `--auth-token`; source inspection is not an executed transform.
Any differential that depends on production transform output remains
**Pending coherent production integration** until that exact lock transforms
the same export and completes a new named browser gate. The verifier keeps the
global and named statuses separate so correct hashes from different scopes
cannot silently masquerade as one end-to-end stack.

All add-on references below resolve relative to the pinned add-on directory and
all runtime/plugin references resolve relative to the pinned engine directory.
The following table content-identifies every Needle implementation file cited
by this matrix; a same-version file with a different hash is a different
baseline and must not inherit these conclusions.

| Cited Needle source | SHA-256 |
| --- | --- |
| add-on `lightmapping/lightmapping_common.py` | `9108d701addb1f1c4f13f05fc1df64b37c653e861623d2db69738f6363fa112a` |
| add-on `extensions/NEEDLE_lightmaps.py` | `3831dd545261fdd4fa5e5fca9ad98ae7912a0939ea2758bb737b74eae4376a77` |
| add-on `utils_blender.py` | `c4165224511b93f9f50a7ffc4018f3704be64babc9ee09a3cb23325d98e95f92` |
| add-on `blender_export.py` | `6272997cfb4f1d740ea33a7c2512983b9993dedf93c9c8240ca0ff7f82925d77` |
| add-on `component_registry.py` | `9430b1445e4ca26d46a0798212b3f00333bbe478191a56cac67bf1eb07632ffa` |
| add-on `component_types.py` | `7a504b4c59dc7b54153e4cf2bec0573ed347c5ec701c28611cfb3941fc9d7133` |
| add-on `extensions/NEEDLE_components.py` | `e543cb43130fcb9672879dec44fcd9aebbc31bfa3764610fb40828116754e97a` |
| add-on `panels_project.py` | `b3cdc2981e48d5bd50fb3ecf255fc51c3e4035c687a84fbbd4276985514541d0` |
| add-on `panels_viewport.py` | `6f6f6804f8544d79281bf3d8fcab6ea9d62c98a22c2ef08472212a1b9711005d` |
| add-on `operators_web.py` | `6a07ce69c396a0dbfeafea841b475e06786c9d1e266e8f9f7223cdbf5ece1f91` |
| add-on `utils_web_project.py` | `a59ca4ffbf965460cc6eda0574066ef8c6631bab100506f80308787599e64437` |
| add-on `settings_scene.py` | `6e02da2ab32558fb042f0000c863bc6631176458ceb06534d9afcd5061dfd063` |
| add-on `external_process.py` | `a3698c2343f4207344f65155ebb35b274fafa29f875d3ce505ea0a7530fda0b9` |
| add-on `utils_npm.py` | `23eb59a19af03ee5aad0985d764dfffac9b7c4d4167e2ef3654a7a76d364d8d3` |
| add-on `utils_system_requirements.py` | `0e02677470292795f63e09c31b8a6918da1d80dd814675a8840e20588101b6ec` |
| add-on `utils_tools.py` | `62583080cceaea7a88666b3e092db7737e6ef69e792702fc505e4ffac6302134` |
| add-on `utils_version_warnings.py` | `36a1a352df24cc07c7983b9139b3246d593b49493086a77222612c5481812c87` |
| add-on `utils_debug.py` | `899d7ba9832c57e956d7320b90056e49b2ba959dcfea8346ce5021ba7dc30c6a` |
| add-on `component_utils.py` | `9b42d25d4fd4cc62b55e1b067706229189158962e35430c44b3a85c604ddbbd5` |
| add-on `utils.py` | `bde57c1d21818a9e40645afdc3c51b7f58dde1f3ef72b5c4c4c9fd665adddc30` |
| add-on `templates/vite/package.json` | `6c4a4db9e052c5f27435df408bf8f2b6690686653811dd1dda1dc208daf0508b` |
| add-on `templates/vanilla/index.html` | `a7fd8540b65013b2ba19bd1ac914e439975ca54b2be71cec7dc8031610d371d9` |
| add-on `extensions/NEEDLE_components_postprocess.py` | `90cdd4fbd883858816d36ea1605e75fd820c4bcac2e8d8c87e76a465eb1ce031` |
| add-on `extensions/NEEDLE_components_export.py` | `f6483da9ae55bbb142f4afc519a6db8c3147da370f481db02073ef13cc4610e6` |
| add-on `extensions/skybox_utils.py` | `cbeb3ccbe8cdd018514e5de874c0b3e555a0958c4a1e22a0eafe90396fc5e09c` |
| add-on `operators_reflectionprobe.py` | `a085bdfedc88baac932a1e6da8ca5eddaedf5800173f9ff025db561c5e35b5a4` |
| add-on `panels_object.py` | `89dbb640ce3326915de768773e9ed7443a5f1778ed37b418437d757abff279ec` |
| add-on `data/builtin.component.json` | `d32f28bc6beb4379dcce1b12e114c389f56e493e4e0820123c9a500dfb867382` |
| add-on `data/components.needle.json` | `e531d19815efb0a4ffb13ea561309952cde565ae39e327c77e6b487674c566c3` |
| engine `src/engine/webcomponents/needle-engine.ts` | `66e71697676b0cc115139946e5987bd4b7b97a303671b9c0cad365081d0daa68` |
| engine `src/engine/engine_context.ts` | `84a02111e67f81b67beb023455de175c8567933a04949889b51a0cb38cafb509` |
| engine `src/engine/engine_time.ts` | `5f0c54b980930c98aa1eb207dd71f2ce57ed0496e034bccccb36813cafbb3963` |
| engine `src/engine/engine_loaders.ts` | `3df0fbf23e1d36451cc7827fdbc26bb8c4a594d91dfd358526aca4b8ef6d9a73` |
| engine `src/engine/engine_loaders.gltf.ts` | `5fa4bf5a04b982d66b2f2975ed4b4f9e3cdbc21883df8fdcce9155c27ac28288` |
| engine `src/engine/engine_addressables.ts` | `0eb7f7b3535235b0a49ac436f6d2a35d7282ce9e05d0c045de57b206d9606d83` |
| engine `src/engine/extensions/NEEDLE_lightmaps.ts` | `000794aa7421d6b3d73d76c546f0af68ffde784f7d2ee10c1308e1c4d89922e7` |
| engine `src/engine/engine_lightdata.ts` | `9ef66efa71b66a0a02dbdb2160cd0285c4cb409b589d7471f9a6380c5a7c2e59` |
| engine `src/engine-components/RendererLightmap.ts` | `0c2b96f12d22dd000a0c92c185b1685cd48af72b8f5b8f8569f703be7e889bd7` |
| engine `src/engine/extensions/NEEDLE_components.ts` | `295d820116bd9e019e3f7b02c83a0269611d24ea88a22c0675652d8347dad8d5` |
| engine `src/engine/engine_gltf_builtin_components.ts` | `44aa5d8ea4d98606ca8f6e26b5d8feeeb134d693e0b23c3dd72b0d07c51e4836` |
| engine `components.needle.json` | `ac733436d61185ff7234bda04d2f2c762193b4c70731655231c08b9b3d041966` |
| engine `src/engine-components/Component.ts` | `6f5801d7ee26fd987ad05b48a2999eb52e7144cf01e8f2433288708cad1f54dc` |
| engine `src/engine-components/Light.ts` | `7ceb0827f6d49e94ea350b438cf7374bd23cf07473e13569355866b40820823e` |
| engine `src/engine-components/Camera.ts` | `75e9531c33e936bfd16cdac6f65cddd4c6d1cfdd6d287ade25534e852a5a1946` |
| engine `src/engine-components/OrbitControls.ts` | `82b4efa6f6206a32cf2a1c92f367e71b6d4346d6fb785e121d2501edb6a32171` |
| engine `src/engine-components/ContactShadows.ts` | `e4bd8398c59d47ad3bd2eef66625b03c14f260e678d27a332a8ad73d4c17733b` |
| engine `src/engine-components/ShadowCatcher.ts` | `af0b0fea08e92cee701b618613975b6412eb7a0b80642312a25ce01bba4b740b` |
| engine `src/engine-components/Fog.ts` | `600bb920e70dbaa45f24fee196823d1330ef30754886a165b81537bad8c6051d` |
| engine `src/engine-components/ReflectionProbe.ts` | `02505478fdf0cfbb5e756864d4016dd38fe5536c221955dc907f97b4e187d836` |
| engine `src/engine-components/Renderer.ts` | `c77ede6eee371ccce367281e22c77aacfdce4fd9d57c23d3d67ca9fa6ec0e159` |
| engine `src/engine-components/VideoPlayer.ts` | `5307ddd7a03938d32ee46bf5fb13fa5bb7bd1666231f7b096d6111904711249a` |
| engine `src/engine-components/Skybox.ts` | `ef981296e6ceaeb792feb8c433df7cd48740bacf090f77ea693e42cda86876b5` |
| engine `src/engine-components/GroundProjection.ts` | `30abd50cd872c62d59d0b6e3cfaefb3f7701145f7820c4b6532197827e9e9627` |
| engine `src/engine/engine_camera.fit.ts` | `bc77b6fc284dd471902e5760dcf797e3bff567f1de58d96e35e8bb53ffd1630b` |
| engine `src/engine/extensions/NEEDLE_lighting_settings.ts` | `b3aca7337fa4bfde8f9424483945f747e401fa4ba54135d7a9cbc352af609a1c` |
| engine `src/engine/engine_scenelighting.ts` | `8a01815980eee222f1b2cbf03f5c2ecec5b36e3a4ccaa858af5ee302939ff9b5` |
| engine `src/engine/extensions/NEEDLE_materialx.ts` | `bb8f82a1372a877aafb261138f74a3e8bca541c530396d3856912844e5b58896` |
| engine `plugins/vite/copyfiles.js` | `a53513a43f69439b6f7b23cd78ebe74b3c9915142f0986095e6cb8e94b0a06c1` |
| engine `plugins/vite/config.js` | `d0207db1ce17a7a58b15cd14ef1de032744701491a6d5167bfe230a1e5871990` |
| engine `plugins/vite/reload.js` | `b9e51536beeecd5fd53720390e9f58e4cb2f04ed7bc14a2d1fddf1737b255e08` |
| engine `plugins/next/next.js` | `947cd6a36dd59e099af8b0e36833ad946d53c6df0c7f10dd1b2958579ab82459` |
| engine `plugins/common/buildinfo.js` | `18218dc81a790741f20d94261835366287708756c0d60c689192a867947bda63` |
| engine `src/engine/engine_utils.ts` | `adb259462e2d859aaca599d2f191c6cdfaf3eb86d4fc92e6b181ca45ba77cb3c` |
| engine `src/engine-components/Animator.ts` | `0a9b5961ed22f0f887f503c46cc09e5823b3dd3d3650ed28a0727f1fe1757e7d` |
| engine `src/engine-components/AnimatorController.ts` | `c353b604e24898d4520fd888ca180e3aeaa275d9ce06f35d09b0907ad00a91a9` |
| engine `src/engine-components/timeline/PlayableDirector.ts` | `fc653989c22dd0fb67a33cccda23172525b37e8f089ce3c74d82146324954854` |
| engine `src/engine-components/timeline/TimelineTracks.ts` | `8d5af1239372e2bdb172cde04cff5705209a92fadc21014e8fb34ed85f7f294c` |
| engine `src/engine-components/LODGroup.ts` | `15ecec557441b51fa4a8cf997a90fb83382dcdc958bb71ead12c7798fd3000ab` |
| engine `src/engine/engine_lods.ts` | `3c9e3131cfda7d228048ab7c124a746b5dd73fa7d88ae23de10eff9be19f30f3` |
| engine `src/engine/engine_create_objects.ts` | `50f550db8c99743df32be28fd40fbc8da2b49325849a61200f017be2cb4c3b62` |
| progressive runtime `gltf-progressive.js` | `e830db8d2212985ccfe0d74f1821c66015867944c80bb20489f16dd5d3ad5c95` |
| progressive runtime `README.md` | `306537020733e7d25546f035540f9a70597acd8d2a8ab571842127aea769de49` |
| add-on `extensions/animationhandler.py` | `24044aeaa630ba98ff00707b54d018f2a8d904cf8fd57dc0adcfecc41b5ddb89` |
| add-on `types/timeline/timeline_serializer.py` | `abb192ec043192ef58cfce6621d6ca8c96b7e37f1071304a7884f87ac09eac06` |
| add-on `types/animation/animator.py` | `2f93a1f0727c7c148ca8cd9870e0956ee73dc6a6659e322e53f243e9fbadd936` |
| add-on `types/animation/animator_nodes.py` | `c8ca7f0607b8fd7bc1e3392924d46faef27871d5bd37de875a5b2d852eab089e` |
| add-on `types/animation/animator_transition.py` | `a1986fc2db23d8251af407d981c27ac14b2c17f21a0adf2006476661cc1eb8c8` |
| add-on `types/animation/animator_conditions.py` | `6a59d48ae95d9d33d47ddf7148614f8114208e41112613844a5cb1dfcfed17b9` |
| add-on `extensions/NEEDLE_progressive.py` | `73e48c91a8f7e6992b81a33a7bdd18b24a790b2c7081a1d9a97c46cdf7f828c3` |
| engine `src/engine-components/Animation.ts` | `e2d49582ac429b8a40a48c9b1bca767dc38184c9cd6a38c762142b18ab8155f4` |
| engine `src/engine-components/export/usdz/extensions/behavior/BehaviourComponents.ts` | `4e990aa6887f922b0478aefce4cbc535631a0a7a9573de7b8b0c9a3d685161b1` |
| engine `src/engine-components/timeline/TimelineModels.ts` | `4364c157ef1fb740d3e6acc9f49475c60882d18f7c474119ad110c3efd69eb1c` |
| engine `src/engine/engine_animation.ts` | `ffefe5c590222a3de63098df4206840b74f230de9ecad0a48f643458c3d5cb65` |
| engine `src/engine/extensions/NEEDLE_progressive.ts` | `6ab2807c7fbeab2c02b32958cf8170ae75534dd9ab20006e1d5a06d89505483f` |
| engine `src/engine/extensions/extensions.ts` | `d99b7661810e9efc74cf526377f49bcac004fa2a785a4433e65066a39e930d9a` |
| progressive runtime `lib/extension.js` | `67df9318da7e85a1fdd8d71d2ceb1f0610e436ed25e0bb4f049ca26b69cfb1fc` |
| progressive runtime `lib/lods.manager.js` | `7f2dd20751b647f9216b58bf2aca7bf1ffc67b2445282417f472ddd5bd5916d2` |
| progressive runtime `lib/lods.promise.js` | `ab06eea380778bda711cde130eeca2eaa841becdfa195875aa72d1fc8fdb0609` |
| progressive runtime `lib/loaders.js` | `cc49d4f269eea7328fe183d0f96f9deb2a43d6098d0655f96d3450e338f813d6` |
| progressive runtime `lib/index.js` | `0c7be8572277df12f7289ef4aebbb32d06f4d738bb79610abea6428f466f9104` |
| progressive runtime `lib/utils.internal.js` | `3b33db457f8cd1d7ea622e481a8554aaf32eed2d52aba1abd1f797cb288db483` |
| progressive runtime `lib/utils.js` | `ac31ce16bb16705f804bb38c69719e782840a944f6bf9d21ffbadfca042c1fc0` |
| progressive runtime `lib/worker/loader.mainthread.js` | `2f8dd2c40705c51642ccfc836ecdc15e2df6df96fb69b05511a9a14720df1489` |
| progressive runtime `lib/worker/gltf-progressive.worker.js` | `1fbd5d6ead633e8908ddb248ab51a62d4ab279cf5d0dd072fadf3d86615709b6` |
| coherent dependency fixture `package.json` | `41753af69993e942ded85003cddd81f861cc0eb215b28fd42653a73aba89debc` |
| coherent dependency fixture `package-lock.json` | `70b4564d2a569b78e0fd47c9f33e6d5ba87a747717b9c898790b451d5b7febd5` |
| generated spike `vite.config.js` | `e34507308cc0781dd917777c57e94e09abe8ae92871081e4888dc74a8c470554` |
| generated spike `src/App.tsx` | `7e94f5c02e0431900df7219f809433835b344cf5fb18fb34a2ffdd9df681c568` |

[`needle-baseline.json`](needle-baseline.json) is the machine-readable identity
for these paths, hashes, and versions. `npm run verify:needle-baseline` checks
the local source bytes, package versions, this Markdown review surface, and a
live `npm ls --all --json` over the exact add-on-selected dependency fixture.
It also compares the pinned add-on and runtime Component catalogs after
excluding documentation-only comments: both currently contain 146 unique names
with the same source, class, category/group, inheritance, flags, and child
property shape. Their raw bytes differ because the `WebXR.useXRAnchor` help
text differs; XR remains outside Blendlink's product boundary, but the drift is
retained in the separately pinned hashes rather than hidden by the normalized
check. It is deliberately separate from `test:full` because a portable
Blendlink clone does not require Needle sources. Its success proves source
freshness, clean package-tree resolution, and the recorded integration status;
only `integration=coherent` plus a named end-to-end gate could prove a runnable
combined stack. Re-audit when any pinned bytes, package,
runtime/build/Three version, source location, or acquisition artifact changes.
Passing the identity and clean-tree checks alone does not prove a behavioral or
browser outcome.

## Coverage register

This is the current audited matrix, not a claim that every existing Blendlink
feature has already received an exact Needle source comparison. The permanent
`AGENTS.md` gate applies to all behavior-level changes, including families not
yet consolidated here.

| Behavior family | Coverage in this audit | Required next action |
| --- | --- | --- |
| Native baking, receiver context, atlas packing, gutters, denoise/save ownership, cache invalidation | Audited below with focused Blender differentials and the [Blender 5.2 evaluated-UV trace](research-blender-uv-evaluation-determinism-2026.md) | Resolve or explicitly scope the evaluated-Bevel UV stability seam before any byte-reproducible whole-plan claim, then rebuild and visually compare Cube pixels before promoting demo-level fidelity or timing claims. |
| Direct/Collection visibility, export scope, glTF transaction | Audited below; occurrence-aware Collection Instance export remains a loud gap | Add Holdout/Indirect Only policy and occurrence materialization evidence before claiming full Blender render-scope parity. |
| Runtime loading, cancellation, preparation, ready/presented state, Strict Mode, render loop, disposal, scene replacement | Audited below and in the linked runtime note | Complete the delayed-resource Chromium matrix, real ReactDOM Strict Effects fixture, and sequential transition coordinator. |
| Asset graph, base path/CDN, decoder/CSP, production smoke, application build ownership | Audited below and in the linked deployment note | Content-address the publication directory and run the packed Next/Vite subpath, CDN, CORS, and strict-CSP browser matrix. |
| Component serialization, transactional lifecycle, interaction and postprocessing ownership | Architecture and current shipped records audited below | Maintain a per-requested-behavior catalog ledger; do not infer Needle catalog parity from adapter extensibility. |
| Project setup, Preview Studio, save-driven workflow, add-on UI and diagnostics | Source-identified comparison is consolidated below. Existing-site/managed-package workflow is stronger and known-issue upper bounds are jointly enforced; raw-HTML/no-package integration remains open. | Add a raw-HTML connection fixture without weakening existing-site ownership, and require the current workflow/UI regression gates before promoting source inspection to current-run evidence. |
| Material preservation/compiler routes beyond bake context | Stock glTF, active-graph diagnosis, and explicit materialization routes are consolidated below; MaterialX and universal Eevee-surface parity remain gaps. | Audit each new material route against Needle exporter/build/runtime handling and a Blender-to-browser visual fixture; never infer parity from extension presence. |
| Cameras, responsive composition, Eevee/area lights, worlds/environment, fog, shadows, reflection probes | Source-identified comparison is consolidated below. Area-light handling, explicit camera ownership, reachable World analysis, fog restoration, and transactional probes are stronger. Ground Projection and Contact Shadows now have focused implementations under current browser comparison; Shadow Catcher ships a source-matched Preview adapter with focused Chromium effectiveness/lifecycle evidence. | Keep unproved visual/performance claims explicit. Eevee remains the source of truth for the main render and material/lighting bakes; the artist approved Cycles panoramic capture as a narrow offline reflection-probe exception on 2026-07-23. |
| Animation, NLA sequencing, armatures/morphs, timeline events | Source behavior is audited and split into stable `NDL-ANM-*`, `NDL-NLA-*`, and `NDL-TLN-*` capabilities. The production Blendlink and actual Needle Engine runtime paths now match the same Blender transform, two-bone skin, morph, clip, render, and disposal oracle across nine times. Blendlink additionally ships a bounded application transport and deterministic Start All; the single-track NLA compiler remains separately evidenced. | The Needle result is runtime-only over Blendlink's neutral GLB. Keep the authenticated add-on/build transform in `NDL-BASE-001`, add a focused same-input NLA timing/blending differential, retain coordinated multi-object NLA as a Gap, and retain the full Animator/timeline engine as a Boundary. |
| Mesh/texture optimization, LOD/progressive delivery, performance budgets, WebGPU | Exact add-on 1.4.2 and build-pipeline 3.0.0 sources are identified; stable `NDL-LOD-*` and `NDL-PRG-*` capabilities now separate authored LOD, generated companions, projected-density refinement, atomic atlas promotion, progressive cache ownership, and the application-owned render loop. The package inventory is still `integration=mixed-source`; the coherent Splash cell is Preview-only. | First pass the coherent authenticated production-transform gate. Then require decoded geometry/texture evidence, GPU/presented-frame browser measurements, cancellation/cache tests, and same-camera LOD transitions before any “better” claim. |
| WebXR, networking, cloud, hosted deployment, application UI/framework | Deliberate product boundary | Record **Boundary** or **Out of scope**; do not import engine breadth into Blendlink. |

## Executive findings

1. **Separate-object native baking is the right baseline.** Needle attaches a
   temporary target Image Texture to the actual materials, selects all
   receivers, and invokes one Blender bake while the receivers remain separate.
   Blendlink now matches this, preserving Object Attribute, Object Info,
   generated/object coordinates, transforms, material slots, and ray context.
2. **Blendlink's strongest proven improvements are deeper cache dependencies,
   multi-link collection visibility, exact failure/rollback behavior, and
   application-owned runtime integration.** These should remain deviations,
   not be simplified to Needle's narrower implementations.
3. **Needle's runtime cancellation is not a complete network/decode abort.** Its
   web component aborts an attempt token and destroys late results, while the
   GLTF loader call does not receive that signal and Addressables contains an
   explicit abort TODO. Blendlink's private `LoadingManager.abort()` path is an
   improvement only for loaders that implement abort; application-owned loads
   are still truthfully abandon-and-late-dispose. Three r184 also coalesces
   same-URL `FileLoader` work across managers by URL alone: a private manager
   cannot abort a request another manager initiated, and can abort a later
   application subscriber when the private request initiated the shared work.
   Managers are therefore policy owners, not process-wide request namespaces.
4. **`compileAsync()` is a shader-preparation barrier, not a complete
   GPU-texture/readiness proof.** Needle catches its failures and continues;
   Blendlink rejects and rolls back after installing camera, environment,
   baked state, lights, probes, and Components. Neither approach alone proves a
   nonblank first presented frame or complete texture upload.
5. **Blendlink has a deterministic runtime request-graph fingerprint, but not a
   content-addressed published scene directory.** Immutable caching for the
   whole scene directory remains Future work. Generated TypeScript/manifest
   files are intentionally outside the browser request graph and also need an
   explicit release identity if the directory itself becomes content-addressed.
6. **The largest remaining lifecycle gaps are production detached R3F
   preparation/commit, a truly Suspense-aware resource, mounted demand-loop
   evidence, and a sequential scene-transition coordinator.** The current
   effect-started adapter hides its children until ready but cannot make an
   ancestor Suspense boundary wait. A real Chromium prototype now proves
   detached staging is the correct presentation boundary under a competing
   renderer; the production adapter split is not yet shipped.
7. **Needle has much broader Component catalog and engine lifecycle breadth.**
   Blendlink's smaller portable record plus explicit adapter model is a better
   product boundary and has atomic rollback, but catalog breadth must remain a
   separate, honest gap rather than being called parity.
8. **The current Cube MaxRects plans pass capacity but not exact whole-plan
   determinism.** Two fresh plans measured `0.2439..0.2460` occupancy and
   `0.9660..0.9701` target achievement, while their layout hashes differed.
   The first divergence is Blender 5.2 evaluated UV output on 16 Bevel
   receivers; the pure allocator remains deterministic for exact rectangle
   input. Retained browser captures still predate this pipeline and remain
   historical integration evidence only. Current Cube pixels, Final wall time,
   and visual-error metrics must be regenerated before supporting a fidelity
   claim.

## Behavioral matrix: bake compiler

| Outcome | Needle behavior | Blendlink behavior and relation | Status and differential evidence |
| --- | --- | --- | --- |
| Receiver participation | Meshes opt into `NEEDLE_isLightmapped`; nonparticipants are render-hidden. Lights separately opt in and must be viewport-visible. [N-B1] | Static/dynamic/automatic routing plus state-aware receiver membership. **Improvement**, because artists need not manually configure ordinary portable scenes, while explicit roles remain available. | **Verified** by headless role/state checks. Retain a fixture with an automatic static receiver, forced dynamic receiver, hidden contributor, and state-hidden collection. |
| Material and object context | Adds a temporary active Image Texture node to each actual material, selects separate receivers, and makes one native `bpy.ops.object.bake` call. It does not join the source receivers. [N-B1] | Same native multi-object approach in `bakelib.py`; every receiver remains a real object. **Match**, with stronger cleanup and diagnostics. | **Verified** by the registered `__Blendlink Context Red/Green` headless fixture: two objects sharing one material produce distinct Object Attribute/Object Info colors; the joined control fails; graphs, selection, viewport state, and collection state restore. |
| Bake semantics | One `COMBINED` bake includes Emit, Direct, Indirect, Color, Diffuse, and Transmission; Glossy is omitted. [N-B1] | Explicit Appearance and Lighting outputs plus light groups/states. Appearance may flatten a result; Lighting preserves live PBR and uses a distinct UV channel. **Improvement**, but only within each declared semantic route. | **Implemented** and covered by the two-state baked e2e. Cross-engine parity for glossy, transmission, alpha, and emissive mixtures remains a differential matrix, not a universal Verified claim. |
| Cross-receiver contribution | Every eligible receiver stays render-visible while only the target set is selected, allowing cross-object shadows and bounce. [N-B1] | Matches this receiver/contributor split and also preserves every standard Cycles ray-visibility switch. **Improvement**. | **Verified** in the native multi-object headless fixture. Add a two-atlas control proving that a receiver can contribute bounce without receiving the current atlas. |
| Atlas allocation | Makes one AABB-sized proxy quad per receiver, packs the separate proxy objects without rotation, then applies each proxy rectangle as a scale/offset to that receiver's local lightmap UVs. Its mesh list originates in a Python `set`, and Blender's box sort is explicitly non-deterministic. [N-B2] | Keeps Needle's two-level fixed-orientation ownership shape, but derives receiver sizes from Blendlink's weighted local UV layouts and uses a package-owned MaxRects outer allocator. Receiver-local islands, artist density, pinned ownership, capacity checks, and exact triangle/island diagnostics remain intact. **Measured improvement** at the allocator seam. | **Verified at the pure-allocator seam** for exact rectangle inputs by the focused pack/gutter fixture: input-order determinism, 1.38x scale versus a shelf control, exact 20px edge / 36px inter-owner gutters after float32 storage, and a 4:1 requested area ratio. Two actual 38-receiver Cube plans reached `0.9660..0.9701` target achievement and `0.2439..0.2460` occupancy, but their atlas hashes differed because Blender 5.2 evaluated Bevel UVs differed first. Do not promote the pure-allocator result to a byte-reproducible compiler claim. [Evaluated-UV trace](research-blender-uv-evaluation-determinism-2026.md) |
| Native bake gutter | Reserves `2 × bake margin + 4 px` between receiver rectangles so two local EXTEND bands cannot collide; rotation is disabled. [N-B2] | Uses the same lower bound via `required_bake_gutter_px()` and blocks insufficient authored gutters. **Match**, with stronger explicit validation. | **Verified** by the registered exact 3 px → 10 px assertion, independent padding bands, receiver-edge checks, and pinned same-/cross-owner gutter fixtures. |
| Local unwrap | Smart-projects receivers and then performs multi-object proxy packing. [N-B2] | Preserves authored/pinned UV ownership where valid, derives UVs otherwise, and refuses overlap, collapse, and insufficient gutters. **Improvement** for artist ownership and loud failures. | **Verified** for pinned/collapsed/gutter cases. **Future** for exact fresh-process evaluated-Bevel stability: fixed grids and guarded ULP buckets retained hash drift; tested Needle-style Smart Project variants either broke the 20px gutter proof or fell below `0.95` target density. A global-CONCAVE candidate improved both the tiny hero and Cube plan while preserving continuous measured spacing, but remains **Prototype** until rasterized per-receiver ownership, EXTEND writes, containment/crossings, pins, and adversarial geometry are proved. No production canonicalizer or shape-interleaving pack was promoted. [Evaluated-UV trace](research-blender-uv-evaluation-determinism-2026.md) |
| UV reuse key | Hashes counts, vertex positions, object scale, lightmap scale, resolution, and object count. It does not include the complete material/light/world/external dependency graph. [N-B2] | Bake fingerprints include settings, object attributes/index, material and nested node data, ray visibility, lights, collection/view-layer state, external bytes, and collection instances; volatile sequence/UDIM dependencies refuse reuse. **Improvement**. | **Verified** by the registered fingerprint matrix for ID-property arrays, Object Index, authored reserved node names, lights, external bytes, View Layers, and viewport-hidden Collection Instance sources. Its unrelated-camera control must remain reusable. |
| Incremental/partial bake | Unwrap reuse is cached. Experimental selected/view-only baking exists, but prior-lightmap copy/merge code is commented in the audited source. [N-B1, N-B2] | Per-state/per-light-group/per-atlas fingerprints reuse exact prior artifacts, with artifact hashes and loud invalidation reasons. Every job identity is captured before any bake executes, preventing rebuild/reuse ordering from changing later fingerprints. **Improvement**. | **Verified** by the 2026-07-23 two-state baked e2e: first build, camera-only `2/2` reuse, selective dependency invalidation, missing/corrupt prior artifact repair, target-16 refusal, and separate Lighting output pass. |
| GPU selection | Requests Cycles GPU and falls back to CPU. Preview/High apply short time limits and opinionated denoise/performance settings. [N-B1, N-B3] | Resolves GPU/CPU explicitly, reports selected backend/device class and measured duration, and keeps profile settings in the bake plan. **Improvement** in truthfulness. | **Implemented**; real Blender/toolchain gates exercise GPU-capable paths when available. Preserve CPU fallback coverage and compare equal-sample output before claiming quality superiority. |
| Denoising and saved bytes | Uses Cycles denoising presets, converts a float lightmap to RGBM, saves/repacks PNG, and creates hidden temporary geometry so the stock glTF exporter embeds the texture. The result is then identified by `NEEDLE_lightmaps` and decoded by an engine-owned global Three shader-chunk patch; it is not an ordinary base-color texture. [N-B3, N-B4, N-R5] | `bakelib.py` owns deterministic Standard/None/0 saves, optional denoising, alpha coverage, constant post-loss background, and delivery variants. Lighting and Appearance remain explicit rather than one RGBM semantic. **Improvement/Boundary**. | **Verified** for save ownership/color settings and baked e2e composition. Direct RGBM-versus-Blendlink HDR error/size comparisons are not yet a universal quality result. |
| Cleanup and failure | Restores render settings, lights, object visibility, temporary nodes/actions, selection, and progress in `finally`; individual undo-action failures are logged so later cleanup continues. [N-B1] | Uses reverse-order owned cleanup and surfaces aggregate failures; disposable stages avoid borrowing artist save state. **Improvement**. | **Verified** by graph/selection/visibility restoration and private-save-stage evidence. Add fault injection after each bake phase when changing this transaction. |

## Behavioral matrix: visibility and export

| Outcome | Needle behavior | Blendlink behavior and relation | Status and differential evidence |
| --- | --- | --- | --- |
| Collection visibility | `objectIsVisibleInViewport()` rejects an object when any linked collection is hidden or resolves to a hidden layer collection by name. [N-V1] | Canonical render visibility is identity/path-aware: a multi-linked object is visible when any reachable membership path is render-visible. **Improvement**, matching Blender's effective any-visible-path behavior. | **Verified** by the registered shared-child hidden+visible-path headless fixture and the 22-case pixel probe. Retain two same-named nested collections and one object linked through visible and hidden paths. |
| Export exclusion | Temporarily unlinks `dontExport` objects and descendants from all collections, exports, then relinks them. [N-X1] | Namespaced roles/vocabulary produce an explicit compiled scope in a staged transaction; final GLB audit catches optimizer/export drift. **Improvement**. | **Verified** by vocabulary conformance on TypeScript and headless Python plus compiled-artifact tests. Continue testing parent/child and collection-instance boundaries. |
| glTF exporter | Calls Blender's stock exporter with `COMPAT` lighting conversion, applied modifiers, animations, and Needle extensions. [N-X1] | Also relies on Blender's official exporter, then applies bounded optimization/verification and generated typed bindings. **Match** at the serializer boundary; **Improvement** in final-document attestation. | **Verified** by packed consumer builds, real toolchains, and decoded final-GLB checks in the aggregate gate; rerun after current changes. |
| Export transaction | Creates `needle.lock`, changes the active scene/mode, writes scene GLBs, and restores state. A root export clears loose files from its assets directory. [N-X1] | Stages compiler-owned artifacts and replaces the publication set only after verification; unrelated application files remain outside compiler ownership. **Improvement**. | **Implemented/Verified** by publication integrity tests. Add a crash/failure fixture proving the last good directory remains loadable. |
| Save-driven iteration | A `save_post` handler schedules export after 0.5 seconds and can save again when export dirties the file. [N-A1] | Connected Preview is save-driven, but the explicit connection, route, server, and site build remain application-owned. **Boundary**. | **Verified** by preview/watch/project-setup tests and dogfood. Keep recursion/coalescing and failed-update-retains-last-good browser evidence. |
| Multiple exported scenes | Writes `scene.glb` for the main scene and named GLBs for scene dependencies. [N-X1] | Compiles named site scenes and preserves stable IDs/types per scene; simultaneous global presentation in one Canvas is deliberately constrained at runtime. **Boundary**. | **Implemented**. Add a project fixture with two compiled scenes sharing external source assets and verify independent publication graphs. |

## Behavioral matrix: browser runtime and lifecycle

| Outcome | Needle behavior | Blendlink behavior and relation | Status and differential evidence |
| --- | --- | --- | --- |
| Loading UI ownership | `<needle-engine>` owns a default loading overlay and emits `loadstart`, repeated `progress`, and `loadfinished`; production customization is tied to its component/licensing rules. [N-R1] | Exposes stable progress, ready, failure, retry-key, and presentation seams without rendering a loading screen. The website owns UI and analytics. It does **not** yet expose a production preload API, and generic installation failures are not truthfully classifiable as recoverable without structured causes. **Boundary/Improvement** for UI ownership; preload/recoverability remain gaps. | **Implemented** for progress/ready/failure/retry/presentation with unit and dogfood coverage. Add a public contract test that swaps loading UI without importing internal runtime types. |
| Load customization | Creates GLTF loaders and configures shared Draco/KTX2/Meshopt machinery; the ordinary path does not expose a caller-owned `LoadingManager` at the web-component seam. [N-R3] | Accepts a private or application-owned GLTF loader/manager, URL modifier, KTX2 loader, Meshopt decoder, headers/credentials through caller-owned loader policy, and shared progress. **Improvement**. | **Implemented** and unit-tested for ownership. A real cross-origin authenticated loader fixture remains Future evidence. |
| Cancellation | Aborts an attempt controller, checks the signal between files/progress callbacks, and destroys late results. The signal is not passed into `loadSync`; Addressables says resource abort is still TODO. [N-R1, N-R2, N-R4] | Private manager-backed attempts call Three `LoadingManager.abort()` and also gate/late-dispose. Blendlink never invokes an application-owned manager, but Three's URL-only in-flight coalescing means separate managers are not isolated request namespaces. Nonabortable/coalesced work is abandoned and disposed after settlement. Attempt identity also suppresses manager progress delivered after a replacement starts. **Improvement**, with a narrower truthful guarantee. | **Verified** for late-result gating/rollback and direct manager ownership: focused `threeRuntime.test.ts` spies prove repeated cancellation invokes the private attempt manager exactly once and never invokes an application-owned manager. `reactThreeFiber.test.ts` drives Three r184's real `FileLoader.itemEnd()`-after-abort sequence and proves attempt-1 progress cannot regress attempt 2. A registered r184 differential proves both cross-manager same-URL ownership orders and the collision above. **Future** browser proof: delay GLB, KTX2, HDR, and worker responses independently and record which network/decode work actually stops. |
| Preload | Addressables `preload()` fetches an `ArrayBuffer`; it does not decode or upload the complete scene. [N-R4] | The research design distinguishes network/decoded/prepared/presented ownership and refuses to call `useGLTF.preload` GPU-ready, but no production prepared-resource lease or public preload API exists. **Gap** in current Blendlink integration, with a clearer Future contract. | **Future**. Prototype ref-counted prepared resources and measure download, decode, texture upload, compile, and first nonblank frame separately before exposing the API. |
| Shader preparation | Creates Components, then calls `renderer.compileAsync`; errors are caught and warned, so loading proceeds. [N-R3] | Configures baked state, environment, camera, lights, probes, Components, and post stack before `compileAsync`; rejection or cancellation rolls the installation back. **Improvement**. | **Verified** by the named `threeRuntime.test.ts` compile rejection and cancellation rollback cases. Real WebGL upload/nonblank evidence remains distinct. |
| Ready semantics | `ready` means the engine has rendered its first frame. [N-R1] | Installation readiness and first completed R3F presentation are separate facts; children mount only after installation is ready. **Improvement** in observability. | **Implemented**. A mounted browser fixture must still prove that presentation fires after an actually visible frame under slow textures and postprocessing. |
| React Suspense | No R3F analogue; Needle owns a web component and its loading lifecycle. | The R3F adapter still starts preparation in an Effect, so ancestor Suspense cannot observe that work. Atomic visibility is supplied independently by private preparation plus synchronous layout commit. **No analogue / remaining React cache gap**. | **Future**: a shared cached attempt-scoped resource whose render-time read throws a stable promise, with reference-counted ownership and Strict Mode-safe disposal. The shipped one-attempt prepared handle is renderer-bound and is not that cache. |
| Strict Mode and atomic visibility | Needle uses create IDs, context clearing, attempt abort, and late destruction during reload; it stops its engine-owned loop during context setup. React Strict Mode is not its lifecycle model. [N-R1, N-R2] | Attempts serialize per Canvas, prepare an exclusively owned root on a private Scene, then synchronously commit root/presentation/camera/Components/host ownership from a layout effect with reverse rollback. Blendlink cannot stop the website-owned loop, so detached preparation is the product-boundary equivalent. **Boundary / Improvement**. | Fifteen coordinator cases and five atomic Three cases verify stale rejection, exact-once commit, rollback, resource retention, and parented-root refusal. The 2026-07-24 production-source Chrome 150/ANGLE SwiftShader differential records partial frames `5 / 9 / 0 / 0` for live/root-hidden/detached/production under a priority-2 application renderer and identity-checks the committed Scene/camera delivered to the marked adapter. It observes two ReactDOM Strict-root setups but one R3F scene setup. Synthetic loader/basic material, external decoder/postprocessing pixels, physical GPU, and cross-browser evidence remain Pending. |
| Render loop | Owns a continuous `renderer.setAnimationLoop`; three consecutive loop exceptions stop it. [N-R2] | Application/R3F owns the loop. `requiresContinuousFrames` is conservative: running playback, interactive controls, LODs, or active Component updates keep demand mode awake; proven static scenes may settle. **Improvement/Boundary**. | **Verified** by active/idle Component contracts and mounted production Chromium for static Manual idle plus animation acquire/settle/reacquire. Controls, LOD, audio, arbitrary custom adapters, and the combined matrix remain Future. |
| Slow/background frame time | Engine 5.1.7 clamps clock delta to `0.1` seconds before time accumulation and passes the clamped value to its composer. `PlayAnimationOnClick` starts authored animation from a pointer action. [N-R8] | Blendlink starts a newly active runtime at delta zero because the prior Canvas interval predates activation, then caps only Blendlink-owned R3F update/composer time at `0.1`; it does not alter the website clock or exact low-level playback API. **Match / Improvement**. | **Verified** by an always-loop unit regression and the production Next/SwiftShader dogfood route: a programmable 1.5-second rAF hold exceeds the 1.041667-second LoopOnce clip yet a visible intermediate rotation is observed. The pre-fix probe measured first delta `0.829`, then `0.427`, and reproduced an invisible completed action. |
| Resource disposal | Context clear destroys the scene/addressables and resets systems; full dispose also stops the loop and disposes an owned renderer. [N-R2] | Private one-call loads dispose scene geometry, materials, textures, skeletons, KTX2 ownership, Components, probes, lights, listeners, and renderer mutations; already-loaded cache resources remain caller-owned. **Improvement/Boundary**. | **Verified** by private-versus-application ownership and rollback unit tests. Add WebGL allocation counters to a repeated mount/unmount browser loop. |
| Multiple scenes in one renderer | A `src` replacement clears the current Context and loads the replacement; simultaneous global scenes are not the normal web-component model. [N-R1, N-R2] | One compiled scene per Canvas is the current contract because camera, environment, look, lights, and composer are global. A sequential transition coordinator can stage then swap without recreating Canvas; simultaneous global ownership is out of scope. **Match in exclusivity / Boundary in host ownership**. | **Implemented contract; Future coordinator**. Differential test: A → B → A under delayed load/failure, proving last-good retention, one camera/composer, and complete A/B disposal. |

## Behavioral matrix: animation, authored LOD, and progressive delivery

This family has an additional evidence boundary. The pinned files below prove
the behavior of exact packages, but the inventory remains
`integration=mixed-source`. The named coherent Splash Preview cell did not run
the authenticated production transform or emit progressive companions. Until
`NDL-BASE-001` passes at that production scope, no row may claim that add-on
1.4.2, build pipeline 3.0.0, an Engine runtime, and the progressive runtime
exported, transformed, and rendered one supported application together.

| ID / outcome | Needle behavior | Blendlink behavior and relation | Status and required differential |
| --- | --- | --- | --- |
| `NDL-ANM-001` transform, armature, and morph deformation | Engine animation uses Three `AnimationMixer`/actions and an Animator/AnimatorController lifecycle over imported clips. Metadata-free autoplay randomly starts one imported clip; explicit non-exclusive play coordinates several. [N-ANM1] | Ordinary glTF clips, typed clip names, Three mixer consumption, and deterministic authored First/Named/All startup are shipped. **Match / Improvement** at the runtime seam. | Both production Chromium paths use the same Blendlink GLB and Blender oracle at five keys plus four subframes. Blendlink and actual Needle Engine 5.1.4 both stay within position `6.729e-8`, quaternion `7.765e-4 rad`, morph `5.960e-8`, and skinned-point Hausdorff `1.174e-5`, with nonblank rendering and teardown. The Needle fixture uses the actual web component, runtime-created `Animation`, public playback API, and `Context`; it is runtime-only because the GLB did not pass through Needle's authenticated build pipeline. |
| `NDL-ANM-002` developer animation transport | The Needle `Animation` component exposes clip play, pause, action time, mixer update, and broader engine-owned animation state; Animator adds crossfade/parameters. [N-ANM1] | A bounded renderer-neutral `play`, `playAll`, `pause`, authored-seconds `seek`, replayable `stop`, serialized state/subscription, and continuous-frame signal now spans ordinary clips and the supported NLA sequence. The public animation object is a frozen facade; the R3F ready handle exposes it while Blendlink keeps mixer/update/disposal ownership. **Match / Improvement**. | Real-Three tests prove Manual control, deterministic Start All, once settling, ping-pong seek parity, finite zero-duration Repeat/Ping-Pong, ordered reentrant/throwing observers, sampled-NLA liveness, invalidation, replay, and terminal disposal. The 2026-07-23 production-dist ReactDOM/R3F 9.6.1/Three 0.184 Chromium 150 demand gate proves a nonblank initial idle frame, first-wake animation time zero after 1.35 seconds dormant, play/resume, zero tail renders after pause/completion settles, immediate seeked pose/pixels, replayable stop, stale-handle rejection, exact-once disposal, and no later renders. It exposed and fixed the Ready invalidation race and dormant clock jump. No Animator parameters, crossfade graph, or engine state machine is claimed. |
| `NDL-NLA-001` bounded single-track NLA sequence | Needle's normal export/runtime path can play imported clips and its broader Animator/timeline systems orchestrate them; the inspected stack does not establish Blendlink's exact Blender-NLA strip subset. [N-ANM1, N-TLN1] | One real Blender NLA track is compiled into an explicitly supported strip subset with loud rejection of unsupported semantics. **Match candidate** for the bounded job. | Compiler/runtime implementation is shipped. A pinned-Needle same-input timing/deformation comparison is Pending, so the evidence state remains Partial. |
| `NDL-NLA-002` coordinated multi-object NLA | Engine-owned Animator and timeline systems can coordinate multiple object/component outputs. [N-ANM1, N-TLN1] | The current contract intentionally selects one real Blender NLA track. **Gap** for artist scenes requiring coordinated object-local tracks. | Future: define one shared clock and ownership model, then prove a same-`.blend` browser sequence. |
| `NDL-TLN-001` full Animator/timeline engine | `PlayableDirector` and timeline tracks cover animation, audio, signals/markers, activation, and control tracks in an engine-owned lifecycle. [N-TLN1] | Blendlink exports typed marker metadata but does not dispatch a complete timeline, audio/control graph, or visual state machine. **Boundary**. | A full Animator/PlayableDirector clone is Out of scope because the website/runtime owns application state and orchestration. |
| `NDL-TLN-002` marker crossing/subscription | Needle marker and signal tracks execute inside `PlayableDirector`. [N-TLN1] | Blendlink publishes static typed marker metadata but no forward/reverse crossing, seek/replay, ordering, cancellation, or subscription contract. **Gap**. | Add a small application-owned dispatcher only for a demonstrated dogfood interaction; DOM, analytics, and state remain site-owned. |
| `NDL-LOD-001` artist-authored distance LOD | `LODGroup` and the context LOD manager own runtime level selection and renderer integration. [N-LOD1] | Rename-stable authored chains, strict ordering/origin diagnostics, exact inactive/active cost, hysteresis, non-reparenting install, and reversible cleanup are shipped. **Match candidate**. | Same-camera switch-distance, transform, animation, material identity, cleanup, and draw-cost differential is Pending. |
| `NDL-PRG-001` generated companion graph | Build pipeline 3.0.0 defaults `textures.lods` and `meshes.lods` to true, emits an embedded low tier plus content-identified image/mesh GLB companions, and records hashes/density in its bundled CLI. [N-PRG1] | No general generated progressive mesh/texture companion graph ships. **Gap**. | The CLI requires JWT authentication. A coherent authenticated transform of one named asset, decoded geometry/texture inspection, deterministic graph identity, and production browser consumption are required before design adoption. |
| `NDL-PRG-002` projected-density refinement | The progressive runtime selects mesh and texture levels by render-list projected density/device pixel ratio, queues requests, and plugs into renderer updates. [N-PRG2] | Blendlink has composition diagnostics, authored distance LOD, and atlas delivery tiers, but no general on-demand density selector. **Gap**. | Future browser gate must cross deterministic density thresholds under camera/DPR changes and record request, decoded, GPU, and presented states independently. |
| `NDL-PRG-003` atomic baked-atlas promotion | Progressive runtime swaps individual mesh/texture resources as requests settle. [N-PRG2] | A complete embedded baked-atlas bootstrap stays visible while the complete selected full-resolution active set stages, passes through `renderer.initTexture` on the default prewarm path, and commits synchronously. **No direct Needle analogue found** for this scene-wide atomic route. | Unit/integration evidence is current. `initTexture` is not GPU completion or presented-frame evidence; a visibly mixed-frame Chromium rejection gate remains Pending. |
| `NDL-PRG-004` progressive cancellation/cache ownership | Runtime coalesces/queues loads, ignores stale slot requests, weakly retains low-resolution resources, reference-counts textures, and exposes explicit cache disposal. No abort signal was found at the inspected progressive request seam. [N-PRG2] | No package-owned progressive companion cache exists. Existing scene-load cancellation does not prove progressive request abortion. **Gap**. | Future design needs attempt generations, per-consumer leases, retry, late-result disposal, cache ownership, and truthful network/decode cancellation tests. |
| `NDL-PRG-005` render-loop/loading presentation ownership | Needle's context and LOD manager own continuous renderer integration. [N-LOD1, N-PRG2] | The application owns the Canvas, loop, and loading UI; Blendlink exposes readiness and a conservative `requiresContinuousFrames` signal. **Boundary**. | Production browser evidence covers true static Manual idle, animation acquire/settle/reacquire, slow-frame postprocessed Components, first presentation, and one marked two-phase custom adapter. Controls, LOD, broader audio/postprocessing matrices, untrusted adapters, and physical devices remain Pending. |

## Behavioral matrix: assets, deployment, and production verification

| Outcome | Needle behavior | Blendlink behavior and relation | Status and differential evidence |
| --- | --- | --- | --- |
| Vite asset location | Generated spike uses `base: "./"`, references `assets/scene.glb`, and copies the configured source assets directory into stable `dist/assets`. [N-D1, N-D2] | Compiler-owned URLs can be rebased beneath an origin-rooted Next/Vite base path or an absolute CDN root while preserving queries/fragments. **Improvement**. | **Verified** by `assetUrls.test.ts`, including base paths, CDNs, queries, and fragments. Add a production browser matrix for `/`, `/subpath/`, and a second-origin CDN. |
| Next integration | Needle's plugin defaults to static export, unoptimized images, `dist`, transpilation, and worker rules; no general `basePath`/`assetPrefix` scene rebasing was found in the audited plugin. [N-D3] | Does not own Next configuration; the application supplies `assetBaseUrl`/loader policy and Blendlink rebases only compiler-owned requests. **Boundary/Improvement**. | **Implemented** and dogfooded. Verify Next `basePath`, `assetPrefix`, and reverse-proxy combinations in packed consumer fixtures. |
| Runtime request graph | Stable assets are copied and the build pipeline may localize/compress external content; no complete deterministic graph digest was found. [N-D2] | SHA-256 graph covers the staged GLB, compiler companions, and required Basis runtime files using normalized case-safe paths, roles, lengths, and bytes. **Improvement / no Needle analogue found**. | **Verified** by `sceneAssetGraph.test.ts` and publication integrity tests. External Component media remains application-owned by design. |
| Content-addressed directory | Uses stable `assets` names; no directory identity or immutable-cache contract was found. [N-D2] | Graph identity exists, but output still uses a stable publication directory and cache-busting asset URLs. Generated module/manifest files are outside the browser graph. **No analogue / shared gap**. | **Future**: publish `scene/<graph-sha256>/...`, make every dependency relative to that root, atomically update the generated binding, then test immutable headers only on the digest directory. |
| GLB companions | Runtime extensions load embedded/pointer lightmaps and progressive KTX2/other texture forms through glTF machinery. A GLB can still legally reference external resources. [N-R5] | Enumerates all compiler-declared request URLs and graph companions: atlases/variants, environment, probes, state/light-group textures, and Basis files. **Improvement** in explicit closure. | **Implemented/Verified** at graph/typegen level. Add a deliberately external-buffer/image GLB fixture because GLB does not itself guarantee single-file closure. |
| Decoder/CSP behavior | Engine configures Draco/KTX2/Meshopt and the Next plugin adds worker handling; no generic application production smoke classifier was found. [N-R3, N-D3] | Publishes Basis runtime files, watches `securitypolicyviolation`, and emits an artist-readable `worker-src blob:` KTX2 diagnosis while leaving CSP policy with the site. **Improvement/Boundary**. | **Verified** by `threeRuntimeCsp.test.ts`; real strict-CSP Chromium with KTX2/Meshopt workers remains required production evidence. |
| Browser smoke | Generated project/browser preview is the expected verification surface; no optional application-declared post-build gate was found in the inspected paths. | `publish` can run an application-owned browser smoke after build and post-build artifact verification. The evidence classifier distinguishes HTTP/request, CORS, CSP, decoder, console/page, zero-size Canvas, WebGL, context loss, visibly empty pixels, and service-worker interference. **Improvement / no Needle analogue found**. | **Verified** at classifier/order/unit level by `browserSmokeEvidence.test.ts` and `publish.test.ts`. Dogfood Playwright is the real browser gate; generic adapter documentation and strict-CSP/CDN fixtures remain work. |
| Build ownership | Needle plugins generate and configure much of the web project/build. [N-D1–N-D3] | Runs the website's existing build and optional declared smoke; Blendlink never owns the route, Canvas, framework, or deployment. **Boundary**. | **Verified** by publish tests and the Next dogfood workflow. Preserve loud failure when no declared build exists rather than silently generating a site. |

## Behavioral matrix: Components and interactivity

| Outcome | Needle behavior | Blendlink behavior and relation | Status and differential evidence |
| --- | --- | --- | --- |
| Authoring schema | Loads component schemas and dynamically creates Blender RNA PropertyGroups/panels, including custom types and unknown-component preservation. [N-C1, N-C2] | Namespaced, versioned portable records use a curated schema with renderer capabilities, fallbacks, cost, conflicts, target readiness, batch editing, and validation. **Boundary/Improvement** in portability and feedback. | **Verified** for schema validation, copy/paste, stable IDs, and add-on/archive behavior. Needle's catalog breadth remains a separate Gap. |
| References and serialization | Serializes object/component references as GUIDs into `NEEDLE_components`; runtime resolves data and places built-ins in object `userData`. Per-component errors may log and continue. [N-C2, N-R6] | Serializes stable object/component IDs in generated descriptors and requires an explicit adapter for unknown types. Missing targets/adapters fail with the exact component and supplied capability context. **Improvement** in loudness and application ownership. | **Verified** by component/typegen/Three adapter tests. Retain rename, duplication, deleted target, unknown extension JSON, and stale-version fixtures. |
| Runtime lifecycle | Broad engine-owned `Component` lifecycle includes enable/start/update/render/disable/destroy and shared engine services. [N-R7] | Renderer-neutral lifecycle plus Three adapters expose only owned update/fixed-update/resize/render/quality/dispose work; the application remains free to own React/DOM/analytics. **Boundary**. | **Implemented/Verified** for the shipped lifecycle. Lifecycle breadth is intentionally smaller; do not claim Needle catalog parity. |
| Atomic failure | Component load/import paths commonly report an individual error and continue with remaining data. [N-R6] | `installRuntimeComponents()` installs transactionally and reverse-disposes every earlier adapter if a later adapter fails; aggregate rollback failures remain loud. **Improvement**. | **Verified** by `componentRuntime.test.ts` and `threeComponents.test.ts`. Add one browser fault-injection adapter after audio/post allocations. |
| Interactivity | Needle supplies a broad engine catalog and owns picking, input, physics, audio, UI, lifecycle, and renderer services. | A small shared interaction service, Web Audio coordinator, accessibility hooks, and explicit behavior adapters support common website scenes without becoming a proprietary engine. The site owns DOM, navigation, analytics, focus policy, and consent UI. **Boundary; breadth Gap**. | **Implemented** with unit and Chromium dogfood evidence for current mouse/keyboard/audio behaviors. Touch, pen, mobile/WebKit autoplay, assistive technology, and broader catalog acceptance remain Future. |
| Postprocessing/effects | Broad engine Components configure engine-owned rendering effects. | Curated artist-authored post records install into one package-owned pmndrs pipeline only when required; otherwise the site renderer remains direct. **Boundary/Improvement** in deterministic ownership, not catalog breadth. | **Verified** for current effect ordering/cleanup; visual thresholds for outlines, transparency, moving cameras, LUT interpolation, and device quality remain per-effect acceptance work. |

## Capability register: workflow, UI, and diagnostics

Static inspection proves what the pinned Needle files do. It does not turn a
historical Blendlink test into current-worktree evidence, so every row below
names that distinction explicitly.

| ID | Capability and observed comparison | Relation | Implementation | Evidence |
| --- | --- | --- | --- | --- |
| NDL-WF-001 | Needle can generate and manage its own Vite/Vanilla project; Blendlink connects an application-owned project or provisions a private Preview Studio without taking route/framework ownership. [N-WF1] | **Boundary / Improvement** | **Shipped** | Needle source identity verified 2026-07-22. Blendlink `projectSetup` and packed-consumer gates: **Pending current run**. |
| NDL-WF-002 | Needle exposes browser preview plus a separate install/server ceremony; Blendlink uses one subscribed first-build/save-update path and retains the last good scene when a rebuild fails. [N-WF1, N-WF2] | **Improvement** | **Shipped** | Needle source identity verified 2026-07-22. Blendlink preview/add-on headless gates: **Pending current run**. |
| NDL-WF-003 | Needle installs/starts through package scripts and a fixed-port liveness path; Blendlink reuses only an identity-proven server, supports configured URLs, and does not require a network install on every preview. [N-WF2, N-WF3] | **Improvement** | **Shipped** | Static differential verified 2026-07-22; process/project-setup regressions: **Pending current run**. |
| NDL-WF-004 | Needle owns generated-project build commands; Blendlink runs the website's declared build and optional smoke gate after compiler verification. [N-WF1, N-WF3] | **Boundary** | **Shipped** | `publish.test.ts` and Next dogfood workflow exist; **Pending current run**. |
| NDL-WF-005 | Needle's reload plugin and add-on watcher coordinate generated-project refresh; Blendlink serializes save updates through its own last-good connected-preview seam. [N-WF2, N-WF4] | **Improvement** | **Shipped** | Needle source identity verified 2026-07-22; save-burst/single-flight regression: **Pending current run**. |
| NDL-WF-006 | Needle ships a raw `templates/vanilla/index.html` path that does not require a package project. Blendlink's guarded existing-site setup currently treats a conflicting root `index.html` as unsafe instead of adopting that project. [N-WF3] | **Gap** | **Future** | Pinned source verifies Needle breadth; no Blendlink raw-HTML acceptance fixture exists. Required differential: existing static site, preserved HTML ownership, generated scene module, build/smoke or a loud unsupported result. |
| NDL-UI-001 | Needle duplicates its project panel in the 3D sidebar and Scene Properties and performs periodic checks from panel polling; Blendlink keeps one compact workflow surface and canonical Scene/Object/Material ownership. [N-WF1] | **Boundary / Improvement** | **Shipped** | Static UI comparison verified 2026-07-22; interactive Blender UI acceptance: **Pending current run**. |
| NDL-UI-002 | Both make preview/build status artist-visible; Blendlink adds structured progress, cancellation, separate logs, and last-good failure state without hiding the application URL. [N-WF1, N-WF2] | **Improvement** | **Shipped** | Existing add-on headless and dogfood browser scenarios named; **Pending current run**. |
| NDL-UI-003 | Needle names conflicting objects by hierarchy path and caches the lookup; Blendlink's validation seam is cached and should preserve the same source-identifying explanation. [N-WF1, N-WF5] | **Match** | **Shipped** | Static comparison verified 2026-07-22; retain a duplicate-name/nested-hierarchy conflict fixture, **Pending current run**. |
| NDL-DIAG-001 | Needle's advertised, accepted, and template toolchain versions can diverge; Blendlink derives compatibility and artist-facing text from one contract. [N-WF3, N-DIAG1] | **Improvement** | **Shipped** | Drift is source-verified. Blendlink shared-contract regressions: **Pending current run**. |
| NDL-DIAG-002 | Needle has version-warning utilities with source-audited predicate/text drift; Blendlink requires every known issue to have a non-empty, ordered upper bound in both TypeScript and Python. [N-DIAG1] | **Improvement** | **Shipped** | 2026-07-23: `knownIssues.test.ts` 4/4, `ownership_known_issues_test.py` 7/7, and the installed-add-on headless/archive gate all pass; absent/empty and reversed `maxExclusive` values fail loudly. |
| NDL-DIAG-003 | Needle's process helper can hide non-debug stderr and lacks a structured exit result; Blendlink streams progress, retains output tails, trusts sentinel/artifacts, and kills the Windows process tree. [N-WF2] | **Improvement** | **Shipped** | Existing `invoke` and add-on process tests named; **Pending current run**. |
| NDL-DIAG-004 | Needle performs filesystem/subprocess/tool checks from UI-adjacent paths and has open-ended polling/single-flight weaknesses; Blendlink moves work behind subscribed background operations with explicit ownership. [N-WF1, N-WF2, N-DIAG1] | **Improvement** | **Shipped** | Static failure-path audit verified 2026-07-22; save storm, cancellation, and teardown gates: **Pending current run**. |
| NDL-DIAG-006 | Needle's ordinary stock-export path has no equivalent pre-export used-material acceptance gate. Blendlink refuses realtime `plan: null` when a used material remains `needsBake`; a named `applicationMaterialAdapter` is the same loud nonblocking developer exception recognized by Final verification, not silent success. [N-X1, N-MAT1] | **Improvement** | **Shipped** | [Blender 2.91 zero-config differential](research-blender-291-zero-config-2026.md): plan/verify policy 7/7 plus real unacknowledged/acknowledged Blender CLI cells pass on 2026-07-24. |
| NDL-GEO-001 | Needle 1.4.2 delegates ordinary geometry to Blender's stock glTF exporter. Installed exporter 5.2.39 expands object/collection depsgraph instances but does not serialize legacy `HAIR/PATH` render geometry; Needle has no inspected path materializer. Blendlink detects the exact render/export scope and refuses before a healthy-looking emitter-only GLB can publish. [N-X1] | Underlying loss **Match**; early named refusal **Improvement** | **Shipped blocker**; complete path adapter **Future** | The focused eight-path stock GLB contains one emitter mesh/primitive, disabling render on the modifier clears the blocker, and the untouched Blender 2.91 source exits `1` for three in-scope systems / 93,000 parents. See the [focused record](research-blender-291-zero-config-2026.md). |

## Capability register: materials and scene presentation

These rows distinguish portable compiler behavior from engine-owned effect
breadth. In particular, the presence of a Needle Component or extension does
not prove visual parity, and a shared Cycles probe implementation does not
match an Eevee-authored source of truth.

### Focused selected-field versus lightmap transport re-audit

The 2026-07-24 source re-audit establishes a narrow but important distinction:

- In add-on `1.4.2`, ordinary scene materials reach Blender's stock glTF
  exporter. The complete extracted add-on search
  `rg -n "bpy\.ops\.object\.bake" "<pinned add-on root>" -g "*.py"` finds one
  native material bake call: the lightmapper's multi-object `COMBINED` bake.
  Its pass set contains Emit together with Direct, Indirect, Color, Diffuse,
  and Transmission. No selected-socket or Emit-only base-color materializer
  was found in the inspected add-on paths. [N-X1, N-B1]
- Needle exports that lighting result as an 8-bit RGBM PNG carried through a
  hidden temporary quad/material and the private `NEEDLE_lightmaps` extension.
  Engine `5.1.7` resolves the texture into a source-scoped registry, applies it
  on `uv1` with a per-object scale/offset, and globally patches Three's lightmap
  shader chunk to multiply RGB by alpha and `8`, convert sRGB to linear, and
  suppress light-probe irradiance when a lightmap is present. The previously
  omitted `engine_lightdata.ts` identity is now pinned above. [N-B4, N-R5]
- Therefore Needle's inclusion of Emit in a combined lightmap is **not** an
  analogue for Blendlink's explicit selected-field route. Blendlink's bounded
  route privately evaluates one artist-selected, static, lighting- and
  view-independent unit-range Color/Value closure, then emits and attests an
  ordinary `KHR_materials_unlit` base-color PNG. The developer-facing
  portability and absence of a private runtime decoder are an **Improvement
  candidate for that scoped route**, not evidence of universal Eevee material
  parity. Shader to RGB, Ambient Occlusion, Light Path, camera/reflection/window
  coordinates, lighting, and Appearance remain outside this exception.
- Implementation state is **Shipped**. The focused Blender transaction fixture
  covers private state restoration, source Mesh/material/UV preservation,
  unit-range refusal, PNG/sampler/UV/GLB attestation, and last-good artifact
  retention. Evidence for the current dirty worktree is **Pending current
  run** via `npm run test:addon-headless`; the Splash packed/browser dogfood
  gate and any new node-graph family are also **Pending current run**.

The broad source identity remains per-package evidence under
`integration=mixed-source`. The separately named coherent Splash Preview cell
does prove one uncompressed export-to-browser visual differential, but it does
not exercise the licensed production transform and cannot promote unrelated
material families.

| ID | Capability and observed comparison | Relation | Implementation | Evidence |
| --- | --- | --- | --- | --- |
| NDL-MAT-001 | Needle and Blendlink both delegate ordinary portable Principled material serialization to Blender's stock glTF exporter. [N-MAT1] | **Match** | **Shipped** | Real-export material fixtures exist; current aggregate gate: **Pending current run**. |
| NDL-MAT-002 | Needle's utilities/UI inspect a broader set of image nodes; Blendlink follows the active Surface graph and emits portability, payload-collapse, and selected-route evidence. [N-MAT1] | **Improvement** | **Shipped** | Grouped material diagnostics and final-artifact checks exist; current packed/browser gate: **Pending current run**. |
| NDL-MAT-003 | Needle includes a MaterialX runtime extension. Blendlink has no general MaterialX publication/runtime contract. [N-MAT2] | **Gap** | **Future** | Source presence verified only; no differential `.blend`, runtime fixture, supported-subset contract, or browser pixels. |
| NDL-TEX-001 | Pinned Needle ordinary glTF and MaterialX parser textures use anisotropy `4`; selected MaterialX environment targets use renderer maximum. Blendlink's one-call installer-owned, mipmapped material textures default to the same capability-clamped `4`; application-loaded/cache seams default authored and require an explicit ref-counted, conditionally restored lease. [N-TEX1] | **Match / Boundary Improvement** | **Shipped** | Four focused module tests and three installer seam cases pass. Chromium 150 / Three r184 / WebGL2 SwiftShader structurally proves the native sampler sequence `1 → 4 → 16 → 4 → 1`; it does not justify maximum as the default. DOGWALK's exact same-camera 46-texture `1` versus `16` screenshots are Prototype visual evidence; physical-GPU timing/power remains Pending. |
| NDL-MAT-004 | Needle has no selected-socket or Emit-only base-color materializer in the inspected add-on paths. Its sole native material bake is a `COMBINED` lighting bake whose RGBM result requires `NEEDLE_lightmaps` plus an engine shader patch. Blendlink instead materializes one proven intrinsic selected field to an attested stock-glTF unlit base-color PNG; it does not reproduce arbitrary Eevee surfaces. [N-B1, N-B4, N-MAT1, N-R5] | **No analogue / Improvement candidate for the scoped portable route** | **Shipped** for the whitelisted selected-field contract; universal Eevee parity is **Future** | Focused transaction and artifact assertions exist in `material_compiler_check.py`; current `npm run test:addon-headless`, packed Splash browser gate, and each new graph family are **Pending current run**. |
| NDL-MAT-013 | Needle add-on 1.4.2 delegates Blender's canonical camera-ray shadeless graph to stock glTF and accepts the resulting `KHR_materials_unlit`; its default Renderer shadow metadata remains On. Blendlink matches that material transport for the exact package-generated same-image RGBA graph, keeps all near-misses/version drift loud, and carries explicit no-cast intent. [N-X1, N-MAT1, N-SHD1] | Material **Match**; shadow ownership **Improvement** | **Shipped** for the strict fixed-camera card subset | The [focused audit](research-fixed-camera-unlit-card-needle-2026.md) pins Needle, Blender exporter, GLTFLoader, and Renderer hashes. On 2026-07-25 the registered Blender fixture passed exact KHR/BLEND/sidedness/sampler/PNG/extra attestation plus seven independent near-miss/version refusals; exact-package dogfood then passed two-view Eevee card evidence, Final publication, a production Next build, and 21/21 browser smoke with the visible cloud and no-cast extra. |
| NDL-LGT-001 | Needle requests Blender glTF `COMPAT` lighting and does not apply a second runtime scale; Blendlink matches it through a feature-detected canonical policy with stronger diagnostics and real-value assertions. [N-LGT1] | **Match / Improvement** | **Shipped** | Point/Spot/Sun real-GLB and 683x `SPEC` control exist; current full gate: **Pending current run**. |
| NDL-LGT-002 | Needle's runtime rejects unsupported Area/Rectangle/Disc lights. Blendlink supplies a guarded rectangular-area adapter instead of silently pretending `KHR_lights_punctual` supports one. [N-LGT1] | **Improvement** | **Shipped** | Package/unit coverage exists; equal-camera Blender/Chromium area-light pixels and performance gate: **Pending current run**. |
| NDL-CAM-001 | Needle marks implicit cameras as MainCamera candidates; Blendlink chooses one explicit rename-stable presentation camera and fails ambiguous ownership loudly. [N-CAM1] | **Improvement** | **Shipped** | Camera ownership tests exist; current compiler/browser gate: **Pending current run**. |
| NDL-CAM-002 | Needle auto-adds OrbitControls and auto-fit behavior; Blendlink preserves camera framing while leaving controls and responsive composition with the site. [N-CAM1] | **Boundary** | **Shipped** | Unit framing and dogfood responsive scenarios exist; current half/full-width Chromium comparison: **Pending current run**. |
| NDL-CAM-003 | Needle 1.4.2 invokes camera post-processing for every camera; a camera without an explicit component receives `Camera(tag="MainCamera")` and optional `OrbitControls`. That selection path does not consult `bpy.context.scene.camera`, and its own TODO notes the multiple-camera ambiguity. Blendlink's prototype instead considers attested source-active evidence only after explicit presentation and application-owned cameras, and only before a package-created fallback. [N-CAM1] | **Improvement candidate** | **Prototype** | Four precedence cases and the Blender 2.91 `Camera_1` one-to-one stock-GLB mapping pass. No generated manifest or production runtime behavior changed; final artifact attestation remains required. |
| NDL-ENV-001 | Needle scans viewport/World candidates and can mutate viewport background settings; Blendlink resolves only the active reachable World graph and restores application renderer ownership conditionally. [N-ENV1] | **Improvement** | **Shipped** | Existing environment/runtime tests named; disconnected-decoy World differential: **Pending current run**. |
| NDL-ENV-002 | Needle supplies engine-owned Skybox and GroundProjection Components. Blendlink keeps route/renderer ownership with the site while its environment module ships the grounded outcome, compiled-root auto-fit, rotation/intensity, and transactional cleanup. [N-ENV1, N-ENV2] | **Boundary** for sky ownership; **Match / Improvement** for Ground Projection | **Shipped** | The actual pinned Needle 5.1.7 class and Blendlink installer match common/intensity projection within max channel error `6` and both auto-fit the off-origin fixture to `(3, 0.5, 1)` with MAE `0.0556`. Blendlink's raw-equirect rotation works where the pinned Needle branch is a no-op, and its owned resources dispose. A photographic gate justifies retaining resolution 128 over Needle's 64. CubeUV blur/rotation and camera-radius clipping remain Pending; AR is a boundary. |
| NDL-FOG-001 | The audited Needle Fog path is effectively linear and replaces scene fog ownership; Blendlink supports linear/exponential policies and restores the prior owner only when it still owns the installed value. [N-FOG1] | **Improvement** | **Shipped** | Unit ownership/restore cases exist; current renderer gate: **Pending current run**. |
| NDL-SHD-001 | Both preserve ordinary realtime shadow intent; Blendlink additionally exports explicit opt-outs and reports unsupported Blender-only shadow/linking semantics. [N-LGT1, N-SHD1] | **Match / Improvement** | **Shipped** | Real-GLB light/shadow diagnostics exist; current full gate: **Pending current run**. |
| NDL-SHD-002 | Blendlink now exposes opt-in Contact Shadows with Needle's authored outcome controls and matched five-pass WebGL algorithm, while adding explicit Static/Continuous scheduling, transactional state ownership, application-layer preservation, and public material exclusions. It remains opt-in so baked scenes are not silently double-grounded. [N-SHD2] | **Match / Improvement** | **Shipped (Preview)** | The actual pinned Needle 5.1.7 class and Blendlink production module produce byte-identical settled masks and five draws each in Chromium. Blendlink Static renders `5` then `0/120`; Needle default and Blendlink Continuous render five per frame. Integrated R3F dogfood, auto-fit/backface/alpha-cutout matrices, context-loss pixels, and physical/mobile GPU timing remain Pending. |
| NDL-SHD-003 | Needle has ShadowMask, Additive, and Occluder modes. Blendlink implements those material outcomes and adds descendant-group receivers, application-layer preservation, transactional overlapping ownership, conditional restoration, loud shader/target failures, and generated-plane cleanup. [N-SHD3] | **Source-aligned match candidate / Improvement candidate** | **Shipped (Preview)** | Unit/integration coverage plus `artifacts/shadow-catcher-browser-2026/evidence.json` prove Blendlink's partial-alpha Mask pixels, two descendant receivers, depth-without-color Occluder behavior, visible default Additive output, preserved layer masks, and exact conditional restoration in Chromium. The fixture records but does not execute the pinned Needle class; exact side-by-side pixels are required before Match/Improvement promotion, while physical GPU and cross-browser/mobile also remain Pending. |
| NDL-PRB-001 | Needle offers baked/custom probe authoring and runtime texture application; Blendlink adds Runtime/Baked/Custom modes, stable-ID assets, transactional Bake All, byte evidence, staleness, and owned Three/PMREM cleanup. [N-PRB1] | **Improvement** | **Shipped** | Blender 5.2 focused evidence proves exact EXR/source transactions and decoded six-direction orientation. Published/runtime final browser pixels remain Pending; see [the exact probe audit](research-reflection-probe-needle-parity-2026.md). |
| NDL-PRB-002 | Needle and Blendlink use Cycles for offline panoramic reflection-probe capture. A Blender 5.2 differential proves Eevee's panoramic operator reports success while returning one perspective-like face; an Eevee six-face stitcher would add seams and a second projection pipeline. [N-PRB1] | **Boundary / Match** | **Shipped Cycles exception** | The cardinal differential, render/restore/publication tests, and official Cycles camera contract are current. On 2026-07-23 the artist explicitly accepted this narrow exception. It does not apply to scene appearance or lighting bakes. |
| NDL-PRB-003 | Pinned Needle runtime loads/applies a texture; Blendlink additionally offers package-owned one-shot CubeCamera/PMREM capture. [N-PRB1] | **No analogue / Improvement** | **Shipped** | Focused TypeScript success/failure tests prove anchor/resolution/planes, receiver exclusion, and cleanup. The production Chromium fixture proves exact six-face source colors, `0 → 14,434` chromatic final-presentation pixels after PMREM, temporary-resource cleanup, owned-PMREM disposal, and idempotent teardown. Postfilter direction decoding, context loss, physical GPU, and cross-browser evidence remain Pending. |
| NDL-PRB-004 | Blendlink excludes every explicit assigned receiver from offline and runtime capture and includes membership in source identity. Needle hides its probe owner only. [N-PRB1] | **Improvement** | **Shipped** | Real closed-receiver/cardinal Blender fixture, forced-failure restoration, and runtime CubeCamera failure test pass. |
| NDL-PRB-005 | Both request Cycles GPU with CPU fallback; Blendlink centralizes exact-backend selection and restores live-scene preference/device state. [N-PRB1] | **Improvement** | **Shipped** | Current physical evidence is OptiX; CPU and other GPU vendors remain Pending. |
| NDL-PRB-006 | Blendlink refuses a recognized reachable Shader to RGB contributor before offline Cycles probe capture and offers Custom Texture. | **Improvement** | **Shipped known-blocker gate** | Focused Blender fixture passes; the wording explicitly avoids a universal compatibility claim. |

## Deep module ownership that follows from the comparison

The Needle audit reinforces five deep ownership seams. Generated bindings
should remain thin; behavior belongs behind these modules:

1. `packages/blendlink/blender/bakelib.py` owns all bake mechanics, including
   material target attachment, receiver-local packing, fingerprints, saves,
   denoising, alpha/background handling, and restoration.
2. `packages/blendlink/src/sceneAssetGraph.ts` and `assetUrls.ts` own exact
   compiler request identity and deploy-root rebasing. Framework adapters pass
   policy in; they do not reconstruct the graph.
3. `packages/blendlink/src/threeRuntime.ts` owns one atomic load/install attempt,
   its progress, cancellation truth, prewarm, global renderer mutations, and
   reverse disposal. `reactThreeFiber.ts` adapts that seam; it must not grow a
   second loader/runtime implementation.
4. `packages/blendlink/src/componentRuntime.ts` owns portable lifecycle and
   rollback. `threeComponents.ts` owns the renderer-specific adapters and shared
   Three services.
5. `publish.ts` sequences compiler verification, the application's existing
   build, post-build artifact verification, and the optional application-owned
   browser smoke. It does not generate or take ownership of a route.

## Highest-priority remaining differential gates

1. **Real cancellation matrix.** Serve delayed GLB, external buffer/image,
   HDR/EXR, KTX2/Basis worker, Meshopt, probe, audio, and LUT requests. Cancel at
   each phase and record request abort, decode termination, late disposal,
   progress cutoff, and absence of a committed root. Publish results per
   resource; never collapse them into “all loads abort.”
2. **Mounted React 19 resource test.** Under Strict Mode, suspend on one cached
   installation promise, unmount/remount, reject/retry, and prove ref-counted
   cleanup, one global commit, stable progress attempts, and no stale error.
3. **GPU presentation test.** Separate downloaded, decoded, full-quality atlas
   prepared, `compileAsync` resolved, first frame completed, and nonblank pixel
   evidence. Include slow texture upload and postprocessing.
4. **Whole-directory addressing.** Publish the same scene twice, change one
   atlas/decoder companion, and prove that the directory identity changes,
   every internal URL remains inside the new root, the old root stays valid,
   and only digest paths receive immutable cache headers.
5. **Base-path/CDN/CSP matrix.** Build packed Vite and Next consumers under a
   subpath and second-origin CDN with strict CSP. Detect wrong base, CORS,
   missing decoder, worker block, zero-height Canvas, WebGL failure, and visibly
   empty output through the application-declared smoke route.
6. **Sequential scene transition.** Stage B while A remains presented, commit B
   atomically, retain A when B fails, and transition A → B → A without duplicate
   lights, camera/composer ownership, listeners, or GPU allocations.
7. **Component breadth ledger.** For each requested Needle behavior, classify
   it as portable adapter, application callback, compiler feature, or deliberate
   engine/out-of-scope capability. Require an interaction/accessibility/cleanup
   fixture before calling a port complete.

## Source anchors

### Needle add-on

- **N-A1** — `__init__.py:43-61, 330-380`: version identity and delayed
  save-driven export handler.
- **N-B1** — `lightmapping/lightmapping.py:256-516`: receiver/light selection,
  render visibility, GPU fallback, temporary Image Texture nodes, one native
  multi-object bake, progress, and restoration.
- **N-B2** — `lightmapping/lightmapping_pack.py:11-224, 335-491`: shallow UV
  hash, receiver proxy rectangles, multi-object packing, `2m + 4px` gutter,
  scale/offset transfer, Smart UV Project, and reuse.
- **N-B3** — `lightmapping/lightmapping_common.py:29-177`: Preview/High/Custom
  Cycles, time-limit, denoise, caustic, light-tree, persistent-data, and texture
  limit settings with restoration.
- **N-B4** — `extensions/NEEDLE_lightmaps.py:168-340`: RGBM PNG conversion,
  temporary hidden quad/material transport, extension emission, and lighting
  settings.
- **N-V1** — `utils_blender.py:15-39`: direct object and collection/layer-name
  viewport visibility.
- **N-X1** — `blender_export.py:37-186, 280-323, 370-508`: export lock and
  transaction, loose-asset cleanup, glTF arguments, `dontExport` unlink/restore,
  and scene dependency GLBs.
- **N-C1** — `component_registry.py` and `component_types.py:956-1093`: schema
  loading and dynamic Blender component types/panels.
- **N-C2** — `extensions/NEEDLE_components.py:137-247, 340-732`: component,
  property, reference, animation, unknown-component, and glTF extension
  serialization/import behavior.
- **N-WF1** — `panels_project.py`, `panels_viewport.py`, `settings_scene.py`,
  and `component_utils.py`: duplicated project surfaces, preview/build
  hierarchy, scene project settings, conflict discovery, and panel-time checks.
- **N-WF2** — `operators_web.py`, `utils_web_project.py`, and
  `external_process.py`: install/start/export sequencing, fixed-port liveness,
  watcher coordination, subprocess output, callbacks, and teardown.
- **N-WF3** — `utils_npm.py`, `utils_system_requirements.py`,
  `templates/vite/package.json`, and `templates/vanilla/index.html`: toolchain
  predicates, managed Vite project identity, and the raw-HTML/no-package path.
- **N-WF5** — `component_utils.py` and `utils.py`: cached component lookup,
  hierarchy paths, and shared add-on utility behavior.
- **N-DIAG1** — `utils_tools.py`, `utils_version_warnings.py`, and
  `utils_debug.py`: tool discovery, version warnings, debug-only reporting, and
  diagnostic behavior.
- **N-MAT1** — `extensions/NEEDLE_components_export.py`,
  `panels_object.py`, and the stock-export path in `blender_export.py`:
  ordinary glTF material export, object material UI, and renderer metadata.
- **N-LGT1** — `extensions/NEEDLE_components_postprocess.py`,
  `extensions/NEEDLE_components_export.py`, and `data/builtin.component.json`:
  Blender-to-component light/camera/tone policy and the authored Light schema.
- **N-CAM1** — `extensions/NEEDLE_components_postprocess.py`: implicit
  MainCamera/OrbitControls injection and camera post-processing.
- **N-ENV1** — `extensions/NEEDLE_components_postprocess.py` and
  `extensions/skybox_utils.py`: World/viewport environment discovery,
  background mutation, skybox settings, and tone/exposure conversion.
- **N-PRB1** — `operators_reflectionprobe.py`, `settings_scene.py`, and
  `data/builtin.component.json`: offline Cycles probe baking, scene settings,
  and reflection-probe authoring schema.

### Needle runtime and build plugins

- **N-R1** — `src/engine/webcomponents/needle-engine.ts:414-432, 536-731,
  1076-1092`: disconnect ownership, abort controller, load/progress/finish
  events, reload, and first-frame-ready semantics.
- **N-R2** — `src/engine/engine_context.ts:870-965, 1141-1435, 1493-1540`:
  clear/dispose, create ID and abort gating, late result destruction, and
  continuous animation loop/error stop.
- **N-R3** — `src/engine/engine_loaders.ts:48-102, 198-331` and
  `engine_loaders.gltf.ts:13-82`: GLTF loader construction, error resolution,
  Draco/KTX2/Meshopt configuration, Components, and caught `compileAsync`.
- **N-TEX1** — coherent Preview Engine `5.1.4`
  `src/engine/engine_loaders.gltf.ts`, engine-nested `@needle-tools/three`
  `0.169.19` `Texture.js` and `GLTFLoader.js`, `@needle-tools/materialx`
  `1.7.1` `loader.three.js` and `materialx.helper.js`, plus pinned
  `@needle-tools/gltf-progressive` `3.6.0-beta.2`: ordinary glTF and MaterialX
  parser texture anisotropy `4`, renderer-maximum MaterialX environment
  targets, and progressive replacement preservation. Exact hashes and the
  Blendlink design differential are in
  `research-texture-sampling-quality-needle-2026.md`.
  Machine-pinned review hashes added by this audit are:
  `0c28f5d27c574e1b2f4f27508bc82e37f78ca06db1278d84ff5dc15f4d1eb50d`
  (`Texture.js`),
  `4aba05147b1ccb01f581979ea44950b60a568e74a5db811df9f5573a2b3521b1`
  (`GLTFLoader.js`),
  `350b1511e8abc756154ea39b17471a56b2079b4396b1ca845f31c3dd184dcfdb`
  (MaterialX package),
  `79e815bf0ba139aac5f5df5eb71cf14c330900dc5315d7341ab155c9120d55c3`
  (MaterialX loader), and
  `ad66ec035a4c39df3dcd8db5f766a7738e80456f784e7bdf14e7867f3ffd5e43`
  (MaterialX helper).
- **N-R4** — `src/engine/engine_addressables.ts:83-153, 291-394`: URL cache and
  deduplication, binary-only preload, unload, and resource-abort TODO.
- **N-R5** — `src/engine/extensions/NEEDLE_lightmaps.ts:37-131`,
  `src/engine/engine_lightdata.ts:28-130`, and
  `src/engine-components/RendererLightmap.ts:14-164`: texture dependencies,
  source-scoped registration, global RGBM lightmap shader decode/light-probe
  suppression, `uv1`, per-object MaterialPropertyBlock scale/offset,
  progressive LOD, and cleanup.
- **N-R6** — `src/engine/extensions/NEEDLE_components.ts:34-269`: runtime
  component reference/data resolution and per-component error continuation.
- **N-R7** — `src/engine-components/Component.ts`: engine-owned Component
  enable/start/update/render/disable/destroy lifecycle and cleanup.
- **N-R8** — `src/engine/engine_time.ts:94-105`,
  `src/engine/engine_context.ts:1898-1907`, and
  `src/engine-components/export/usdz/extensions/behavior/BehaviourComponents.ts:954-999`:
  the 100 ms global delta ceiling, composer delta consumption, and
  pointer-triggered animation activation.
- **N-ANM1** — add-on `extensions/animationhandler.py`,
  `types/animation/animator*.py`, and runtime
  `src/engine-components/Animation.ts`, `Animator.ts`,
  `AnimatorController.ts`, plus `src/engine/engine_animation.ts`: Action/NLA
  staging, Animator authoring, clip transport, state transitions, mixer
  registration, and per-frame update.
- **N-TLN1** — add-on `types/timeline/timeline_serializer.py` and runtime
  `src/engine-components/timeline/PlayableDirector.ts`, `TimelineModels.ts`,
  and `TimelineTracks.ts`: automatic/custom multi-object NLA serialization,
  shared timeline transport, animation/audio/signal/activation/control tracks,
  wrapping, scrubbing, and blending.
- **N-LOD1** — `src/engine-components/LODGroup.ts` and
  `src/engine/engine_lods.ts`: authored distance LOD and progressive-manager
  renderer/context integration.
- **N-PRG1** — add-on `extensions/NEEDLE_progressive.py`,
  `utils_web_project.py`, and exact build-pipeline 3.0.0 bundled CLI
  `dist/cli/index.js`: per-resource authoring, authenticated transform
  invocation, embedded low tiers, companion image/mesh GLBs, hashes, density,
  and simplification.
- **N-PRG2** — `@needle-tools/gltf-progressive` 3.6.0-beta.2
  `lib/extension.js`, `lods.manager.js`, `lods.promise.js`, `loaders.js`,
  `index.js`, utilities, and worker files, plus Engine
  `src/engine/extensions/NEEDLE_progressive.ts`: projected-density selection,
  request queueing, stale-request guards, resource swaps, decoder/worker
  integration, cache ownership, disposal, and standalone/R3F enablement.
- **N-D1** — spike `vite.config.js:12-44` and `src/App.tsx:7`: relative base,
  build output, and stable `assets/scene.glb` reference.
- **N-D2** — `plugins/vite/copyfiles.js:54-138` and `plugins/vite/config.js`:
  stable assets-directory copying.
- **N-D3** — `plugins/next/next.js:22-171`: static export defaults,
  unoptimized images, output directory, transpilation, and worker rules.
- **N-WF4** — `plugins/vite/reload.js`: generated-project browser reload
  behavior.
- **N-MAT2** — `src/engine/extensions/NEEDLE_materialx.ts`: runtime MaterialX
  extension handling.
- **N-CAM1** — `src/engine-components/Camera.ts`,
  `src/engine-components/OrbitControls.ts`, and
  `src/engine/engine_camera.fit.ts`: camera registration, default controls, and
  bounds fitting.
- **N-ENV1** — `src/engine-components/Skybox.ts` and
  `src/engine/engine_scenelighting.ts`: background/environment assignment and
  scene-lighting ownership.
- **N-ENV2** — `src/engine-components/GroundProjection.ts`: engine-owned
  projected-ground environment effect.
- **N-FOG1** — `src/engine-components/Fog.ts`: scene fog installation and
  replacement behavior.
- **N-LGT1** — `src/engine-components/Light.ts` and
  `src/engine/extensions/NEEDLE_lighting_settings.ts`: runtime light kinds,
  unsupported Area/Rectangle/Disc handling, and lighting settings.
- **N-SHD1** — `src/engine-components/Light.ts` and
  `src/engine-components/Renderer.ts`: ordinary shadow and renderer ownership.
- **N-SHD2** — `src/engine-components/ContactShadows.ts`: contact-shadow
  offscreen-render implementation and frame cost.
- **N-SHD3** — `src/engine-components/ShadowCatcher.ts`: shadow-catcher
  compositing implementation.
- **N-PRB1** — `src/engine-components/ReflectionProbe.ts`: runtime texture
  loading, influence/anchor lookup, material-property assignment, and
  registration cleanup. It does not capture the rendered web scene.

### Blendlink evidence anchors

- `packages/blendlink/blender/bakelib.py` and
  `packages/blendlink/blender/export_scene.py:1366-2223, 2887-3576`: receiver
  context, packing/gutters, bake configuration, dependency fingerprints, and
  incremental bake orchestration.
- `packages/blender-addon/weblights.py:297-370`: canonical identity/path-aware
  render visibility.
- `packages/blendlink/src/threeRuntime.ts:147-181, 840-1022, 1029-1573,
  1631-1742`: loader/manager ownership, cancelable attempt, atomic installation,
  prewarm, readiness, frame activity, rollback, and resource disposal.
- `packages/blendlink/src/reactThreeFiber.ts:207-425`: effect-started attempt,
  ready-only children, retry, presentation, render ownership, demand invalidation,
  and cleanup.
- `packages/blendlink/src/sceneAssetGraph.ts`, `assetUrls.ts`, `publish.ts`, and
  `browserSmokeEvidence.ts`: request-graph identity, deploy-root rebasing,
  application build/smoke sequencing, and browser evidence classification.
- `packages/blendlink/src/componentRuntime.ts:163-231` and
  `threeComponents.ts:187-332`: portable lifecycle and atomic Three Component
  installation/rollback.

## Official platform sources

- [Blender object bake operator](https://docs.blender.org/api/current/bpy.ops.object.html#bpy.ops.object.bake)
- [Khronos glTF 2.0 specification](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html)
- [Three.js LoadingManager](https://threejs.org/docs/pages/LoadingManager.html)
- [Three.js WebGLRenderer and `compileAsync`](https://threejs.org/docs/pages/WebGLRenderer.html)
- [React Suspense](https://react.dev/reference/react/Suspense)
- [React `use`](https://react.dev/reference/react/use)
- [React StrictMode](https://react.dev/reference/react/StrictMode)
- [React `useEffect`](https://react.dev/reference/react/useEffect)
- [Vite `base`](https://vite.dev/config/shared-options.html#base)
- [Next.js `basePath`](https://nextjs.org/docs/app/api-reference/config/next-config-js/basePath)
- [Next.js `assetPrefix`](https://nextjs.org/docs/app/api-reference/config/next-config-js/assetPrefix)
- [Needle Vite plugin](https://engine.needle.tools/docs/reference/needle-vite-plugin)
- [Needle technical overview](https://engine.needle.tools/docs/technical-overview)
- [Needle project structure](https://engine.needle.tools/docs/explanation/core-concepts/project-structure.html)

## Maintenance protocol

When Needle changes:

1. capture add-on/runtime/build-pipeline/Three versions and cited-file hashes;
2. diff every cited source seam, including failure and cleanup paths;
3. update only the affected matrix rows;
4. rerun the smallest differential fixtures first, then the relevant aggregate
   Blendlink and dogfood gates;
5. update `TECHNIQUE_LEDGER.md` and `FEATURE_PARITY.md` only after evidence
   changes the user-visible claim; and
6. leave rejected or superseded behavior in the record so it is not
   rediscovered from memory.
