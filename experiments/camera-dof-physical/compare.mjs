/** Display-PNG observations; no threshold or fidelity qualification. */
import sharp from 'sharp'
import {readFile,writeFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {createHash} from 'node:crypto'
const reference='/tmp/scenetoweb-impact-native-reference-r2/native.png',root=resolve(process.argv[2]),sha=b=>createHash('sha256').update(b).digest('hex')
const source=await sharp(reference).removeAlpha().raw().toBuffer({resolveWithObject:true})
const regions={fullFrame:[0,0,1280,720],foreground:[0,580,1280,720],focusObject:[290,80,1010,570]},rows=[]
for(const backend of ['webgpu','webgl2'])for(const variant of ['sharp','dof']){
 const path=join(root,backend+'-'+variant+'.png'),actual=await sharp(path).removeAlpha().raw().toBuffer({resolveWithObject:true})
 if(source.info.width!==1280||source.info.height!==720||actual.info.width!==1280||actual.info.height!==720||source.info.channels!==3||actual.info.channels!==3)throw Error('Controlled1280x720RGBextent required')
 const metrics={}
 for(const[name,[x0,y0,x1,y1]]of Object.entries(regions)){
  let absolute=0,square=0,count=0
  for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++)for(let c=0;c<3;c++){
   const index=(y*1280+x)*3+c,delta=(actual.data[index]-source.data[index])/255
   absolute+=Math.abs(delta);square+=delta*delta;count++
  }
  metrics[name]={rgbMae:absolute/count,rgbRmse:Math.sqrt(square/count)}
 }
 rows.push({backend,variant,imageSha256:sha(await readFile(path)),metrics})
}
const report={role:'Display-encoded full-frame/region difference observations; lighting and material differences confound isolated DOF assessment',referenceSha256:sha(await readFile(reference)),regions,rows,sceneAcceptance:false,supportCredit:0,fidelityQualified:false}
await writeFile(join(root,'display-differences.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'})
console.log(JSON.stringify(rows.map(r=>({backend:r.backend,variant:r.variant,metrics:r.metrics}))))
