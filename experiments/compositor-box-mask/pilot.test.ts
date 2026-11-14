import{it,expect}from'vitest'
import{readFileSync}from'node:fs'
import{join,resolve}from'node:path'
import{createHash}from'node:crypto'
import{boxMaskIntervals,boxMaskValues,type BoxMaskSettings}from'../../packages/blendlink/src/tslCompositorBoxMask.js'
const directory=process.env.SCENETOWEB_BOX_MASK_REFERENCES
it.skipIf(!directory)('matches actual native CPU words using production integer intervals',()=>{
 const root=resolve(directory!),report=JSON.parse(readFileSync(join(root,'qualification.json'),'utf8'));expect(report.status).toBe('CAPTURED_COMPOSITOR_BOX_MASK');expect(report.cases).toHaveLength(JSON.parse(readFileSync(new URL('./cases.json',import.meta.url),'utf8')).length)
 let words=0
 for(const row of report.cases){const pixelBytes=readFileSync(join(root,row.pixelFile)),programBytes=readFileSync(join(root,row.programFile));const sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex');expect(sha(pixelBytes)).toBe(row.pixelSha256);expect(sha(programBytes)).toBe(row.programSha256)
  const program=JSON.parse(programBytes.toString()),box=program.ops.find((op:any)=>op.kind==='box-mask'),p=box.properties,s:BoxMaskSettings={operation:p.box_mask_operation,position:p.box_mask_position,size:p.box_mask_size,mask:p.box_mask_mask,value:p.box_mask_value},bounds=boxMaskIntervals(row.width,row.height,s),values=boxMaskValues(s),expected=new Float32Array(row.width*row.height*4)
  for(let y=0;y<row.height;y++)for(let x=0;x<row.width;x++){const inside=x>=bounds[0]&&x<=bounds[1]&&y>=bounds[2]&&y<=bounds[3],v=values[inside?0:1],index=(y*row.width+x)*4;expected[index]=expected[index+1]=expected[index+2]=v;expected[index+3]=1}
  const actual=new Uint32Array(pixelBytes.buffer,pixelBytes.byteOffset,pixelBytes.length/4),expectedWords=new Uint32Array(expected.buffer);for(let i=0;i<actual.length;i++)expect(actual[i],`${row.case} word${i}`).toBe(expectedWords[i]);words+=actual.length
 }
 console.log('SCENETOWEB_BOX_MASK_NATIVE_EXACT',JSON.stringify({cases:report.cases.length,words,refusals:report.refusals.length,scalarReads:report.scalarReadCycles}))
})
