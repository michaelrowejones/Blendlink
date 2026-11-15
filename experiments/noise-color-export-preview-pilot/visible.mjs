import sharp from'sharp'
/** Display visualization only. Reference pixels come from native EXR32, never candidate pixels. */
export function nativeDisplayBytes(raw,width,height){
 const values=new Float32Array(raw.buffer,raw.byteOffset,raw.byteLength/4),bytes=Buffer.alloc(width*height*4)
 for(let y=0;y<height;y++)for(let x=0;x<width;x++)for(let c=0;c<4;c++){const source=((height-1-y)*width+x)*4+c;bytes[(y*width+x)*4+c]=Math.round(Math.max(0,Math.min(1,values[source]))*255)}return bytes
}
export async function makeReferencePng(raw,width,height){return sharp(nativeDisplayBytes(raw,width,height),{raw:{width,height,channels:4}}).png().toBuffer()}
export async function checkVisibleCanvas(png,nativeRaw,width,height){
 const {data,info}=await sharp(png).ensureAlpha().raw().toBuffer({resolveWithObject:true});if(info.width!==width||info.height!==height||info.channels!==4)throw Error('Visible canvas physical extent differs from validated source')
 const reference=new Float32Array(nativeRaw.buffer,nativeRaw.byteOffset,nativeRaw.byteLength/4),limit=1/255+2**-10;let maxAbsoluteError=0,violations=0,alphaDifferences=0
 for(let y=0;y<height;y++)for(let x=0;x<width;x++)for(let c=0;c<4;c++){const actual=data[(y*width+x)*4+c],expected=reference[((height-1-y)*width+x)*4+c];if(c===3){if(actual!==255)alphaDifferences++}else{const difference=Math.abs(actual/255-Math.max(0,Math.min(1,expected)));maxAbsoluteError=Math.max(maxAbsoluteError,difference);if(difference>limit)violations++}}
 return{source:'actual-default-canvas-toDataURL',width,height,comparedChannels:data.length,maxAbsoluteError,limit,violations,alphaDifferences,gate:'one RGBA8 quantization byte plus unchanged2^-10 float gate; Raw identity, no fitted gamma/orientation'}
}
