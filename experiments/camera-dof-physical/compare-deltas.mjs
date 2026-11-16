/** Signed DOF effect deltas; removes fixed baselines, not nonlinear lighting coupling. */
import sharp from 'sharp'
import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {createHash} from 'node:crypto'
const arguments_=process.argv.slice(2),outputIndex=arguments_.indexOf('--out')
const inputArguments=outputIndex<0?arguments_:arguments_.slice(0,outputIndex)
if(inputArguments.length<2||(outputIndex>=0&&outputIndex!==arguments_.length-2))throw Error('Use compare-deltas.mjs NATIVE_OFF_DIRECTORY WEB_CAPTURE... [--out NEW_OUTPUT_DIRECTORY]')
const offRoot=resolve(inputArguments[0]),webRoots=inputArguments.slice(1).map(p=>resolve(p)),outputRoot=outputIndex<0?offRoot:resolve(arguments_[outputIndex+1]),sha=b=>createHash('sha256').update(b).digest('hex')
if(outputIndex>=0)await mkdir(outputRoot)
const nativeOn='/tmp/scenetoweb-impact-native-reference-r2/native.png',nativeOff=join(offRoot,'native-dof-off.png'),pins=[]
async function pixels(path){const bytes=await readFile(path),{data,info}=await sharp(bytes).removeAlpha().raw().toBuffer({resolveWithObject:true});if(info.width!==1280||info.height!==720||info.channels!==3)throw Error('Expected1280x720RGB');pins.push({path,sha256:sha(bytes)});return data}
const on=await pixels(nativeOn),off=await pixels(nativeOff),regions={fullFrame:[0,0,1280,720],foreground:[0,580,1280,720],focusObject:[290,80,1010,570]},rows=[]
for(const root of webRoots)for(const backend of ['webgpu','webgl2']){
 const sharpImage=await pixels(join(root,backend+'-sharp.png')),candidate=await pixels(join(root,backend+'-dof.png')),metrics={}
 for(const[name,[x0,y0,x1,y1]]of Object.entries(regions)){
  let abs=0,square=0,nativeAbs=0,nativeSquare=0,webAbs=0,webSquare=0,dot=0,count=0
  for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++)for(let c=0;c<3;c++){
   const i=(y*1280+x)*3+c,n=(on[i]-off[i])/255,w=(candidate[i]-sharpImage[i])/255,d=w-n
   abs+=Math.abs(d);square+=d*d;nativeAbs+=Math.abs(n);nativeSquare+=n*n;webAbs+=Math.abs(w);webSquare+=w*w;dot+=n*w;count++
  }
  metrics[name]={deltaMae:abs/count,deltaRmse:Math.sqrt(square/count),nativeEffectMae:nativeAbs/count,webEffectMae:webAbs/count,
   normalizedMaeVsNoDof:nativeAbs?abs/nativeAbs:null,cosineSimilarity:nativeSquare&&webSquare?dot/Math.sqrt(nativeSquare*webSquare):null}
 }
 rows.push({capture:root,backend,metrics})
}
const producer=await readFile(import.meta.filename),report={role:'Signed display-encoded nativeOn-nativeOff vs candidate-sharp effect deltas; nonlinear material/light/display coupling remains, no qualification threshold',producerSha256:sha(producer),regions,pins,rows,sceneAcceptance:false,supportCredit:0,fidelityQualified:false}
await writeFile(join(outputRoot,'delta-producer.mjs'),producer,{flag:'wx'});await writeFile(join(outputRoot,'dof-delta-observations.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'})
console.log(JSON.stringify(rows))
