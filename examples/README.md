# Blendlink examples

Working consumers that compile against Blendlink's generated bindings in CI.
Each example is a real minimal project — the same shape `blendlink connect`
scaffolds — whose `src/blendlink/` and `src/generated/` modules are produced
by the CLI, not hand-written.

| Example | Stack | Entry |
| --- | --- | --- |
| [`vanilla-three`](vanilla-three) | TypeScript + Vite + three | [`src/main.ts`](vanilla-three/src/main.ts) |
| [`react-three-fiber`](react-three-fiber) | React 19 + @react-three/fiber 9 | [`src/main.tsx`](react-three-fiber/src/main.tsx) |

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
