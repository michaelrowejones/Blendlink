// Exact Float32 input-word research census. No implicit renderer coordinates.
import {writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'
const scalar=new Float32Array(1),word=new Uint32Array(scalar.buffer)
export const f32word=value=>{scalar[0]=value;return word[0]}
export const wordf32=value=>{word[0]=value;return scalar[0]}
const next=(value,direction)=>{if(value===0)return wordf32(direction<0?0x80000001:1);const bits=f32word(value);return wordf32(bits+((value>0)===(direction>0)?1:-1))}
export function regularCases(){const rows=[]
 for(const sides of [3,8,12]){const points=new Map(),add=(family,x,y)=>{const xy=[f32word(x),f32word(y)],key=xy.join(':');if(!points.has(key))points.set(key,{family,xy})}
  for(const x of [0,-0])for(const y of [0,-0])add('signed-zero-origin',x,y)
  for(const x of [-2,-1,0,1,2])for(const y of [-2,-1,0,1,2])add('dyadic-grid',x,y)
  for(const [x,y]of [[.1234567,.8765432],[-.2345679,.5678912],[.5,.125],[-.5,.125],[.125,-.5],[-.125,-.5]])add('ordinary-and-dyadic',x,y)
  // Every sector cut, plus first/last bisector. Neighbor input words expose branch risk;
  // they are controls rather than a seam exclusion or artist-input repair.
  for(let k=0;k<sides;k++){const angle=2*Math.PI*k/sides,x=Math.fround(Math.cos(angle)),y=Math.fround(Math.sin(angle));add('sector-nearby',x,y);add('sector-nearby',next(x,-1),y);add('sector-nearby',next(x,1),y);add('sector-nearby',x,next(y,-1));add('sector-nearby',x,next(y,1))}
  for(const k of [0,sides-1]){const angle=Math.PI*(2*k+1)/sides;add('bisector',Math.cos(angle),Math.sin(angle))}
  for(const normalize of [false,true])for(const point of points.values())rows.push({case:'s'+sides+'-'+(normalize?'normalized':'raw')+'-'+rows.length,sides,roundness:1,normalize,inputWords:[...point.xy,f32word(sides),f32word(normalize?1:0)],family:point.family})
 }
 return rows
}
if(process.argv[1]&&resolve(process.argv[1])===import.meta.filename){const cases=regularCases();await writeFile(resolve(process.argv[2]),JSON.stringify({schemaVersion:1,stage:'regular-radial-exact-input-research',cases},null,2)+'\n');console.log(JSON.stringify({cases:cases.length,perSides:[3,8,12].map(sides=>({sides,cases:cases.filter(row=>row.sides===sides).length}))}))}
