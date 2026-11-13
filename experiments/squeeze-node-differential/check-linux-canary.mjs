import {readFile,writeFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {assertSqueezeLinuxCanary} from './protocol.mjs'
const directory=resolve(process.argv[2])
const json=async name=>JSON.parse(await readFile(join(directory,name),'utf8'))
const suite=await json('suite-software.json'),references=await json('references.json')
const reports={raw:await json('browser-raw-software.json'),final:await json('browser-final-software.json')}
assertSqueezeLinuxCanary({suite,references,reports})
await writeFile(join(directory,'canary-receipt.json'),JSON.stringify({proofRole:'PRODUCTION_NATIVE_CANARY',casesPerApiAndPath:suite.productionCases,sourceProfile:'linux-x86_64-llvmpipe20-opengl-v1',native:references.backend},null,2))
console.log('BLENDLINK_SQUEEZE_LINUX_CANARY_PASSED')
