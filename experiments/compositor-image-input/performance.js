import { unzlibSync } from 'three/addons/libs/fflate.module.js'
import { buildSourceCompositor } from '@image-compositor'
import { decodeStaticCompositorImage, prepareStaticCompositorImages } from '@image-static-input'

const pause = () => new Promise(resolve => setTimeout(resolve, 0))

/** Measurement only: the isolated phase reproduction is not an implementation
 * used by rendering. Actual decode/build/render timings call production code. */
export async function imagePerformanceProof(url, renderer, quad, material, target, compare, flip) {
  const start = performance.now(), reference = await (await fetch(url)).json()
  const program = reference.program, record = Object.values(program.images)[0]
  const tasks = [], observer = new PerformanceObserver(list => tasks.push(...list.getEntries().map(entry =>
    ({ startTime: entry.startTime, duration: entry.duration }))))
  observer.observe({ entryTypes: ['longtask'] })
  await pause()
  const phases = {}, mark = name => {
    const end = performance.now();phases[name] = end - phaseStart;phaseStart = end
  }
  let phaseStart = performance.now()
  const binary = atob(record.data);mark('atobMs')
  const encoded = Uint8Array.from(binary, value => value.charCodeAt(0));mark('callbackBase64CopyMs')
  const indexed = new Uint8Array(binary.length)
  for(let index=0;index<binary.length;index++)indexed[index]=binary.charCodeAt(index)
  mark('indexedBase64CopyMs')
  let nativeBase64Ms = null
  if(typeof Uint8Array.fromBase64==='function'){
    const before = performance.now(), native = Uint8Array.fromBase64(record.data)
    nativeBase64Ms=performance.now()-before
    if(native.length!==encoded.length||native.some((value,index)=>value!==encoded[index]))throw new Error('Native base64 conversion changes bytes')
  }
  phaseStart=performance.now()
  const raw=unzlibSync(encoded,{out:new Uint8Array(record.decodedBytes+1)});mark('inflateMs')
  let a=1,b=0
  for(let offset=0;offset<raw.length;offset+=5552){
    const end=Math.min(offset+5552,raw.length)
    for(let index=offset;index<end;index++){a+=raw[index];b+=a}
    a%=65521;b%=65521
  }
  mark('adler32Ms')
  const checksum=((b<<16)|a)>>>0
  if(checksum!==new DataView(encoded.buffer).getUint32(encoded.length-4))throw new Error('Phase checksum mismatch')
  const values=new Float32Array(raw.buffer,raw.byteOffset,record.decodedBytes/4)
  if(values.some(value=>!Number.isFinite(value)))throw new Error('Nonfinite phase data')
  mark('callbackFiniteScanMs')
  for(let index=0;index<values.length;index++)if(!Number.isFinite(values[index]))throw new Error('Nonfinite phase data')
  mark('indexedFiniteScanMs')
  await pause()
  const cancellation=new AbortController(),scheduled=performance.now()
  let dispatched
  const cancelTask=new Promise(resolve=>setTimeout(()=>{dispatched=performance.now();cancellation.abort();resolve()},0))
  const beforeDecode=performance.now(),decoded=decodeStaticCompositorImage(record),decodeMs=performance.now()-beforeDecode
  const returnedBeforeCancelDispatch=!cancellation.signal.aborted
  await cancelTask
  // Verification must not inflate the scheduled-cancel measurement itself.
  const actualBits=new Uint32Array(decoded.buffer,decoded.byteOffset,decoded.length),wantedBits=new Uint32Array(values.buffer,values.byteOffset,values.length)
  if(actualBits.length!==wantedBits.length)throw new Error('Profile sequence differs from production decode')
  for(let index=0;index<actualBits.length;index++)if(actualBits[index]!==wantedBits[index])throw new Error('Profile sequence differs from production decode')
  const runs=[]
  for(let run=0;run<3;run++){
    await pause()
    const texturesBefore=renderer.info.memory.textures,begin=performance.now()
    const prepared=await prepareStaticCompositorImages(program)
    const preparationMs=performance.now()-begin,statistics={...prepared.statistics}
    const buildStart=performance.now()
    const built=buildSourceCompositor(program,()=>{throw new Error('Static image unexpectedly requested a render pass')},{preparedImages:prepared})
    prepared.dispose()
    const buildMs=performance.now()-buildStart
    try{
      material.fragmentNode=built.node;material.needsUpdate=true;renderer.setRenderTarget(target);quad.render(renderer)
      const pixels=await renderer.readRenderTargetPixelsAsync(target,0,0,reference.width,reference.height)
      const readyMs=performance.now()-begin,maximum=compare(pixels,reference.expected,flip)
      if(maximum>2e-5)throw new Error('Performance run differs from native: '+maximum)
      runs.push({run,preparationMs,statistics,buildMs,readyMs,maximum,texturesBefore})
    }finally{
      material.fragmentNode=null;material.needsUpdate=true;built.dispose()
      if(runs.at(-1)?.run===run)runs.at(-1).texturesAfterDispose=renderer.info.memory.textures
      if(renderer.info.memory.textures!==texturesBefore)throw new Error('Image reapply leaked GPU textures')
    }
  }
  await pause();await pause();observer.disconnect()
  return {scope:'local warmed renderer/SDK; deliberately synchronous phase/compatibility benchmarks followed by actual async preparation and builds; first1080p upload then reapplications; GPU readback included, fetch excluded',
    width:record.width,height:record.height,decodedBytes:record.decodedBytes,compressedBytes:encoded.length,
    isolatedPhaseReproduction:phases,nativeBase64Ms,decodeMs,
    scheduledCancelDispatchDelayMs:dispatched-scheduled,returnedBeforeCancelDispatch,runs,
    longTasks:tasks.filter(entry=>entry.startTime>=start)}
}

/** Actual post-pipeline installation from the pinned Final payload, retaining
 * a usable prior pipeline throughout cancellation and replacement preparation. */
export async function imagePipelinePerformanceProof(create, render, renderer) {
  const longTasks=[],observer=new PerformanceObserver(list=>longTasks.push(...list.getEntries().map(entry=>({startTime:entry.startTime,duration:entry.duration}))))
  observer.observe({entryTypes:['longtask']})
  let heartbeat=true,previous,maximumRafGapMs=0,frames=0,good
  const gaps=[],preparationIntervals=[]
  const frame=now=>{if(!heartbeat)return;if(previous!==undefined){maximumRafGapMs=Math.max(maximumRafGapMs,now-previous);gaps.push({from:previous,to:now,duration:now-previous})}previous=now;frames++;requestAnimationFrame(frame)}
  requestAnimationFrame(frame)
  await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))
  const started=performance.now(),runs=[]
  try {
    for(let run=0;run<3;run++){
      const begin=performance.now(),candidate=await create(),preparedAt=performance.now(),prepareMs=preparedAt-begin
      preparationIntervals.push([begin,preparedAt])
      const texturesBefore=good?renderer.info.memory.textures:null
      try{
        candidate.finalize()
        const finalizedAt=performance.now()
        const maximum=await render(candidate),readyMs=performance.now()-begin
        if(maximum>2e-5)throw new Error('Actual prepared Final pipeline differs from native '+maximum)
        runs.push({run,prepareMs,finalizeMs:finalizedAt-preparedAt,renderReadyMs:performance.now()-finalizedAt,readyMs,maximum,
          preparationInterval:[begin,preparedAt],texturesBefore})
        if(!good)good=candidate
      }finally{if(candidate!==good){candidate.dispose();if(renderer.info.memory.textures!==texturesBefore)throw new Error('Image replacement leaked GPU textures')}}
      if(run===0){
        const before=renderer.info.memory.textures,controller=new AbortController(),cancelStart=performance.now()
        let cancelDispatch
        const timer=setTimeout(()=>{cancelDispatch=performance.now();controller.abort()},16)
        let aborted=false
        try{const unexpected=await create(controller.signal);unexpected.dispose();throw new Error('Cancelled image attempt unexpectedly installed')}
        catch(error){if(error.name!=='AbortError')throw error;aborted=true}
        finally{clearTimeout(timer)}
        const rejectionMs=performance.now()-cancelStart
        const maximum=await render(good)
        if(maximum>2e-5||renderer.info.memory.textures!==before)throw new Error('Cancelled preparation changed last-good pixels or GPU resources')
        runs.push({cancelled:aborted,cancelDispatchMs:cancelDispatch-cancelStart,rejectionMs,lastGoodMaximum:maximum,texturesBefore:before,texturesAfter:renderer.info.memory.textures})
      }
    }
    await pause();await pause()
    const preparationLongTasks=longTasks.filter(task=>preparationIntervals.some(([from,to])=>task.startTime>=from&&task.startTime<to))
    const preparationRafGaps=gaps.filter(gap=>preparationIntervals.some(([from,to])=>gap.from>=from&&gap.to<=to))
    return {pipeline:good,timings:{scope:'actual pinned1080p Final GLB post-pipeline; async CPU preparation then finalize/upload/render/readback; canceled replacement keeps last-good pipeline',runs,maximumRafGapMs,
      maximumPreparationRafGapMs:Math.max(0,...preparationRafGaps.map(gap=>gap.duration)),preparationLongTasks,frames,longTasks:longTasks.filter(entry=>entry.startTime>=started)}}
  }catch(error){good?.dispose();throw error}
  finally{heartbeat=false;observer.disconnect()}
}

/** Full drawing-buffer proof. UI intervals end at the next animation frame;
 * native readback/comparison and report transport run in later tasks. */
export async function imageViewportPerformanceProof(create, submit, verify, renderer, changePublishedInput) {
  const tasks=[],observer=new PerformanceObserver(list=>tasks.push(...list.getEntries().map(entry=>({startTime:entry.startTime,duration:entry.duration}))))
  observer.observe({entryTypes:['longtask']})
  let good,active=true,verifying=false,previous,frames=0
  const gaps=[],windows=[],runs=[]
  const frame=now=>{
    if(!active)return
    if(previous!==undefined)gaps.push({from:previous,to:now,duration:now-previous})
    previous=now;frames++
    if(good&&!verifying)submit(good)
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
  await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))
  let textureBaseline
  try{
    for(let run=0;run<3;run++){
      await pause()
      window.imageStage='full-viewport-'+run+'-prepare'
      const begin=performance.now(),candidate=await create(),preparedAt=performance.now()
      const prior=good
      try{
        candidate.finalize();good=candidate
        const finalizedAt=performance.now();submit(candidate);const submittedAt=performance.now()
        await new Promise(resolve=>requestAnimationFrame(resolve))
        const nextFrameAt=performance.now()
        const interval={kind:'install',run,begin,preparedAt,finalizedAt,submittedAt,nextFrameAt}
        windows.push(interval)
        // This task boundary keeps readback, native comparison and teardown
        // out of the normal preview's first-frame/long-task interval.
        verifying=true;await pause()
        window.imageStage='full-viewport-'+run+'-verification'
        const verificationStart=performance.now(),maximum=await verify(candidate)
        if(maximum>2e-5)throw new Error('Full viewport differs from native '+maximum)
        prior?.dispose()
        textureBaseline??=renderer.info.memory.textures
        if(renderer.info.memory.textures!==textureBaseline)throw new Error('Full viewport replacement leaked GPU textures')
        runs.push({run,prepareMs:preparedAt-begin,finalizeMs:finalizedAt-preparedAt,frameSubmissionMs:submittedAt-begin,
          nextAnimationFrameMs:nextFrameAt-begin,verificationExcludedMs:performance.now()-verificationStart,maximum,
          textures:renderer.info.memory.textures})
        verifying=false
      }catch(error){if(good===candidate)good=prior;candidate.dispose();throw error}
      if(run===0){
        changePublishedInput?.()
        await pause()
        window.imageStage='full-viewport-cancel'
        const controller=new AbortController(),begin=performance.now();let dispatched
        const timer=setTimeout(()=>{dispatched=performance.now();controller.abort()},16)
        try{const unexpected=await create(controller.signal);unexpected.dispose();throw new Error('Full viewport canceled attempt unexpectedly installed')}
        catch(error){if(error.name!=='AbortError')throw error}
        finally{clearTimeout(timer)}
        const rejectedAt=performance.now();windows.push({kind:'cancel',begin,nextFrameAt:rejectedAt})
        verifying=true;await pause()
        const maximum=await verify(good)
        if(maximum>2e-5||renderer.info.memory.textures!==textureBaseline)throw new Error('Full viewport cancel changed last-good pixels/resources')
        runs.push({cancelled:true,cancelDispatchMs:dispatched-begin,rejectionMs:rejectedAt-begin,lastGoodMaximum:maximum,textures:renderer.info.memory.textures})
        verifying=false
      }
    }
    await pause();await pause()
    const overlaps=(from,to,window)=>from<window.nextFrameAt&&to>window.begin
    const uiTasks=tasks.filter(task=>windows.some(window=>overlaps(task.startTime,task.startTime+task.duration,window)))
    const uiGaps=gaps.filter(gap=>windows.some(window=>gap.from>=window.begin&&gap.to<=window.nextFrameAt))
    return {pipeline:good,timings:{scope:'actual full1920x1080 visible drawing buffer; pinnedGLB/presentation/oracle fetch+hash+calibration complete before timing; normal preview renders during preparation; native Float32 readback/comparison/transport EXCLUDED from UI intervals; nextAnimationFrame is scheduling evidence, not GPU-completion or paint certification',
      drawingBuffer:{width:renderer.domElement.width,height:renderer.domElement.height,
        viewportWidth:innerWidth,viewportHeight:innerHeight,css:renderer.domElement.getBoundingClientRect().toJSON()},runs,windows,frames,
      maximumUiRafGapMs:Math.max(0,...uiGaps.map(gap=>gap.duration)),uiLongTasks:uiTasks}}
  }catch(error){good?.dispose();throw error}
  finally{active=false;observer.disconnect()}
}
