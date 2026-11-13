// Proof-only bridge; the SDK and authored native programs remain unchanged.
import {runNodePortBlenderBridge} from './lib/node-port-python.mjs'
try{process.exitCode=await runNodePortBlenderBridge(process.argv.slice(2))}
catch(error){console.error('BLENDLINK_PROOF_NATIVE_LAUNCH_FAILED '+error.stack);process.exitCode=1}
