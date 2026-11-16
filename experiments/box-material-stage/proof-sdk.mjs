import{assertCandidateSdk}from'./candidate-sdk.mjs'
import{assertIntegratedSdk}from'./integrated-sdk.mjs'
// The old patch/guard remains the default. Only a newly declared512 capture or
// explicitly requested integrated diagnostic routes to the new frozen profile.
export function assertProofSdk(options={}){return process.argv.includes('--target-width=512')||process.argv.includes('--visual-diagnostic')||process.argv.includes('--profile=integrated43840')?assertIntegratedSdk(options):assertCandidateSdk(options)}
