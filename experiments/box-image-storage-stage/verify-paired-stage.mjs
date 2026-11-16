// SPDX-License-Identifier: GPL-3.0-or-later
import { resolve } from 'node:path'
import { writeFile } from 'node:fs/promises'
import { closePaired } from './paired-check.mjs'
import { assertPairedStage } from './paired-stage-gate.mjs'
const [native, browser, producer, output] = process.argv.slice(2)
if (!output) throw Error('Use NATIVE_DIRECTORY BROWSER_DIRECTORY EXACT_PRODUCER_CHECKOUT NEW_REPORT')
const closed = await closePaired(resolve(native), resolve(browser), resolve(producer))
const accepted = assertPairedStage(closed)
await writeFile(resolve(output), JSON.stringify({ ...accepted, closed }, null, 2) + '\n', { flag: 'wx' })
console.log(JSON.stringify(accepted))
