// Read an existing receipt; never starts a build, Blender, browser or hosted job.
import { readFile } from 'node:fs/promises'
import { diagnoseNodePortTimings } from './lib/node-port-timings.mjs'

if (process.argv.length !== 3) {
  console.error('Usage: npm run nodes:diagnose -- <verification-report.json>')
  process.exitCode = 2
} else {
  try {
    const report = JSON.parse(await readFile(process.argv[2], 'utf8'))
    console.log(JSON.stringify(diagnoseNodePortTimings(report), null, 2))
  } catch (error) {
    console.error('Cannot diagnose node-port report: ' + error.message)
    process.exitCode = 1
  }
}
