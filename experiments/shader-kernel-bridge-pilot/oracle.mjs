// Independent host reference for this finite compiler experiment, not Blender parity.
const scratch=new ArrayBuffer(4),f32=new Float32Array(scratch),u32=new Uint32Array(scratch);
export const f=Math.fround;
export const word=x=>{f32[0]=x;return u32[0];};
export const number=x=>{u32[0]=x;return f32[0];};
const rot=(x,k)=>((x<<k)|(x>>>(32-k)))>>>0;
export function hashWords(words){
 let a=(0xdeadbeef+words.length*4+13)>>>0,b=a,c=a;
 a=(a+words[0])>>>0;
 if(words.length>1)b=(b+words[1])>>>0;
 if(words.length>2)c=(c+words[2])>>>0;
 if(words.length===4){
  a=(a-c)>>>0;a=(a^rot(c,4))>>>0;c=(c+b)>>>0;
  b=(b-a)>>>0;b=(b^rot(a,6))>>>0;a=(a+c)>>>0;
  c=(c-b)>>>0;c=(c^rot(b,8))>>>0;b=(b+a)>>>0;
  a=(a-c)>>>0;a=(a^rot(c,16))>>>0;c=(c+b)>>>0;
  b=(b-a)>>>0;b=(b^rot(a,19))>>>0;a=(a+c)>>>0;
  c=(c-b)>>>0;c=(c^rot(b,4))>>>0;b=(b+a)>>>0;
  a=(a+words[3])>>>0;
 }
 c=((c^b)-rot(b,14))>>>0;a=((a^c)-rot(c,11))>>>0;b=((b^a)-rot(a,25))>>>0;
 c=((c^b)-rot(b,16))>>>0;a=((a^c)-rot(c,4))>>>0;b=((b^a)-rot(a,14))>>>0;c=((c^b)-rot(b,24))>>>0;
 return c;
}
const normalized=values=>f(f(hashWords(values.map(word)))/4294967296);
export function expected(id,[x,y,z,w]){
 if(id.startsWith('gradient-')){
  const mode=Number(id.slice(9));let value;
  if(mode===0)value=x;
  else if(mode===1)value=f(Math.max(x,0)**2);
  else if(mode===2){const r=Math.min(Math.max(x,0),1),t=f(r*r);value=f(f(3*t)-f(f(2*t)*r));}
  else if(mode===3)value=f(f(x+y)*.5);
  else if(mode===4)value=f(f(f(Math.atan2(y,x))/f(f(Math.PI)*2))+.5);
  else {let r=f(Math.max(f(f(.999999)-f(Math.sqrt(f(f(f(x*x)+f(y*y))+f(z*z))))),0));value=mode===5?f(r*r):r;}
  value=Math.min(Math.max(value,0),1);return[value,value,value,value];
 }
 if(id.startsWith('checker')){
  const v=[x,y,z].map(v=>Math.abs(Math.floor(f(f(f(v*3)+f(.000001))*f(.999999)))));
  const check=((v[0]%2)===(v[1]%2))===Boolean(v[2]%2);
  return check?[.125,.25,.5,1]:[.875,.625,.375,0];
 }
 if(id==='hash-words'){const h=hashWords([x,y,z,w].map(word));return[h&65535,h>>>16,0,1];}
 const dim=['one','two','three','four'].indexOf(id.slice(6))+1;
 if(dim===1)return[normalized([w]),normalized([w,1]),normalized([w,2]),normalized([w])];
 if(dim===2)return[normalized([x,y]),normalized([x,y,1]),normalized([x,y,2]),normalized([x,y])];
 if(dim===3)return[normalized([x,y,z]),normalized([x,y,z,1]),normalized([x,y,z,2]),normalized([x,y,z])];
 if(dim===4)return[normalized([x,y,z,w]),normalized([z,x,w,y]),normalized([w,z,y,x]),normalized([x,y,z,w])];
 throw Error('Unknown case '+id);
}
