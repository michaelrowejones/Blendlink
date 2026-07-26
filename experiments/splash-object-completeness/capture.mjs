import { runBrowserEvidence } from '../../artifacts/release-dogfood/browser-evidence.mjs'

await runBrowserEvidence({
  root: import.meta.dirname,
  viteRoot: new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
  configLoader: 'runner',
  port: 4192,
  cases: [
    {
      id: 'splash-opacity-baseline',
      path: '/?variant=baseline',
      outputStem: 'browser-opacity-baseline',
      viewport: { width: 1200, height: 600 },
    },
    {
      id: 'splash-opacity-opaque-alpha',
      path: '/?variant=opaque-alpha',
      outputStem: 'browser-opacity-opaque-alpha',
      viewport: { width: 1200, height: 600 },
    },
  ],
})

