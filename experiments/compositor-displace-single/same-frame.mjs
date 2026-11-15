/* SPDX-License-Identifier: MIT */
/** Queue both readbacks synchronously in the same animation callback. Awaiting
 * the first map/fence before the probe lets NodeFrame advance and redraws the
 * borrowed scene pass, so it cannot prove the installed frame's linear output. */
export async function sampleInstalledFrame({frame,render,read,probe,frameId,drawCalls}){
 let installedDraw,probeDraws,probeFrame,displayRead,linearRead
 await frame(()=>{
  const before=drawCalls();render();installedDraw={frame:frameId(),draws:drawCalls()-before}
  displayRead=read();probeDraws=probe();probeFrame=frameId();linearRead=read()
 })
 const[display,linear]=await Promise.all([displayRead,linearRead])
 return{installedDraw,probeDraws,probeFrame,display,linear}
}
