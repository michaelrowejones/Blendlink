import {resolve} from 'node:path'
import {preflightBrowserProofContracts} from './lib/browser-proof-contract.mjs'
const root=resolve(import.meta.dirname,'..'),families=process.argv.slice(2)
console.log(JSON.stringify(await preflightBrowserProofContracts(root,families.length?families:undefined)))
