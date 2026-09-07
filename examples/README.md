# Blendlink examples

Working consumers that compile against Blendlink's generated bindings in CI.
Each example is a real minimal project — the same shape `blendlink connect`
scaffolds — whose `src/blendlink/` and `src/generated/` modules are produced
by the CLI, not hand-written.

| Example | Stack | Entry |
| --- | --- | --- |
| [`vanilla-three`](vanilla-three) | TypeScript + Vite + three | [`src/main.ts`](vanilla-three/src/main.ts) |
| [`react-three-fiber`](react-three-fiber) | React 19 + @react-three/fiber 9 | [`src/main.tsx`](react-three-fiber/src/main.tsx) |

## Try one with your own scene

Copy one example folder to a separate directory and save your scene as
`assets/hero.blend` there. These example imports expect the scene name `hero`.
Follow [the first-scene guide](../docs/FIRST_SCENE.md) to install the local
compiler/add-on, prepare the scene, connect that folder, and install the local
archive. Do this before running `npm install` in the copied example; the
declared registry version is a release placeholder while the project is private.
Then run `npx blendlink compile --preview` and `npm run dev` from your copy.

Both examples use WebGPURenderer. An existing WebGL site can keep its renderer;
the R3F example's `gl` prop is optional for that case. The R3F component uses
the scene's authored playback and lighting instead of assuming particular clip,
state, or light-group names.

## How the CI gate works

```bash
npm run test:examples
```

copies each example into a temp directory, installs the workspace-built
`blendlink` package, runs `setupWebsiteProject` + `blendlink typegen` against
a deterministic GLB to produce the generated modules the example imports,
then runs `tsc` and `vite build`. The committed source therefore always
compiles against the bindings the *current* compiler generates — drift fails
CI, not a user.

The generated `src/blendlink/` and `src/generated/` directories are not
committed; run the gate (or `blendlink connect` with your own `.blend`) to
produce them locally before opening an example in an editor.
