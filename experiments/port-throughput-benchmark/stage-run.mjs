import{readFile}from'node:fs/promises'
import{createHash}from'node:crypto'
import{measureStage}from'./stages.mjs'
const[stage,method,trial,out,...argv]=process.argv.slice(2),bytes=await readFile(new URL('./plan.json',import.meta.url)),plan=JSON.parse(bytes)
if(!out||argv[0]!=='--')throw Error('Usage: stage-run.mjs STAGE METHOD TRIAL FRESH_OUTPUT -- COMMAND [ARGS]')
const result=await measureStage({stage,method,trial:Number(trial),attempt:Number(process.env.SCENETOWEB_STAGE_ATTEMPT??1),output:out,argv:argv.slice(1),cwd:process.cwd(),budgetMs:plan.stageBudgetsMs[stage],planSha256:createHash('sha256').update(bytes).digest('hex')});console.log(JSON.stringify(result,null,2));if(result.exitCode!==0||result.timedOut||result.error)process.exitCode=1
