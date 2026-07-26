import { runBrowserEvidence } from '../../artifacts/release-dogfood/browser-evidence.mjs'

await runBrowserEvidence({
  root: import.meta.dirname,
  viteRoot: new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
  configLoader: 'runner',
  port: 4191,
  cases: [
    {
      id: 'splash-runtime-baseline',
      path: '/?variant=baseline',
      outputStem: 'browser-baseline',
      viewport: { width: 1200, height: 600 },
    },
    {
      id: 'splash-runtime-authoring',
      path: '/?variant=authoring',
      outputStem: 'browser-authoring',
      viewport: { width: 1200, height: 600 },
    },
    {
      id: 'splash-runtime-lit',
      path: '/?variant=lit',
      outputStem: 'browser-lit',
      viewport: { width: 1200, height: 600 },
    },
    {
      id: 'splash-runtime-lit-shadow',
      path: '/?variant=lit-shadow',
      outputStem: 'browser-lit-shadow',
      viewport: { width: 1200, height: 600 },
    },
  ],
})
