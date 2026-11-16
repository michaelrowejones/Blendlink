// SPDX-License-Identifier: Apache-2.0
// Trusted maintainer-built preview1 command; no compiler is needed to run it.
import { WASI } from 'node:wasi'
import { readFile } from 'node:fs/promises'
const wasi = new WASI({ version: 'preview1', args: ['scenetoweb-mikk-oracle'], env: {}, preopens: {}, returnOnExit: true })
const module = await WebAssembly.compile(await readFile(process.argv[2]))
const instance = await WebAssembly.instantiate(module, wasi.getImportObject())
process.exitCode = wasi.start(instance)
