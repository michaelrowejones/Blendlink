/* SPDX-License-Identifier: MIT */
import * as TSL from 'three/tsl'
import {Vector2} from 'three'
import type{TslIrExpression,TslExpression}from'./tslNodeRecipe.js'
import{calculate_out_variables}from'./tslRadialRegularNative.js'
import{guardRadialMetalNode}from'./tslMetalRendererGuard.js'
const{bool,float,uniform,vec2,vec3}=TSL as unknown as Record<string,(...args:any[])=>any>
export const RADIAL_COORDINATES_MODEL='regular-full-roundness-segment-coordinates-webgl2-m5pro-v1',RADIAL_COORDINATES_PROFILE='darwin-arm64-53-eevee-metal-m5pro-radial-coordinates-v1'
const INPUT='literal-vector2-f32-normal-plus-zero-v1',BOUNDARY='blender53-shader-float2-padded-v1'
const record=(v:unknown):v is TslIrExpression=>!!v&&typeof v==='object'&&!Array.isArray(v)
const number=(v:unknown,bounded=true):v is number=>typeof v==='number'&&Number.isFinite(v)&&Math.fround(v)===v&&!Object.is(v,-0)&&(v===0||Math.abs(v)>=2**-126)&&Math.abs(v)<=(bounded?2:3.4028234663852886e38)
export function radialCoordinateInput(x:TslIrExpression,depth=0,work={nodes:0}):boolean{
 if(!record(x)||depth>16||++work.nodes>128)return false
 if(x.op==='native_vector2')return Object.keys(x).sort().join()==='input,model,op'&&x.model===BOUNDARY&&record(x.input)&&radialCoordinateInput(x.input,depth+1,work)
 if(x.op==='const_vec3')return Object.keys(x).sort().join()==='op,value'&&Array.isArray(x.value)&&x.value.length===3&&[0,1,2].every(i=>Object.hasOwn(x.value as any[],i)&&number((x.value as any[])[i],i<2))
 return false
}
export function buildTslRadialCoordinates(x:TslIrExpression,build:(x:TslIrExpression)=>TslExpression,fail:(m:string)=>never):TslExpression{
 const sides=x.sides,roundness=x.roundness,vector=x.vector
 if(x.op!=='radial_segment_coordinates'||x.model!==RADIAL_COORDINATES_MODEL||x.sourceProfile!==RADIAL_COORDINATES_PROFILE||JSON.stringify(x.nativeVersion)!=='[5,3,0]'||x.nativeBuild!=='02f0899d78e3'||x.sourceEngine!=='EEVEE'||x.nativeGpuBackend!=='METAL'||x.inputModel!==INPUT||x.outputModel!=='native-float3-phase-radius-zero-v1'||typeof x.normalize!=='boolean'||!record(sides)||Object.keys(sides).sort().join()!=='op,value'||sides.op!=='const_float'||![3,8,12].includes(Number(sides.value))||typeof sides.value!=='number'||!record(roundness)||Object.keys(roundness).sort().join()!=='op,value'||roundness.op!=='const_float'||roundness.value!==1||!record(vector)||vector.op!=='native_vector2'||vector.model!==BOUNDARY||!radialCoordinateInput(vector)||Object.keys(x).some(k=>!['op','model','sourceProfile','nativeVersion','nativeBuild','sourceEngine','nativeGpuBackend','inputModel','outputModel','normalize','sides','roundness','vector'].includes(k)))return fail('Radial Tiling Segment Coordinates requires its measured EEVEE-Metal schema, literal Sides3/8/12 and Roundness1, and explicit bounded float2 input; other branches are unqualified')
 // Literal boundary projection is exact. Upload the unchanged f32 values as
 // uniforms, matching the independently tested variable-input native stage.
 let literal=vector
 while(literal.op==='native_vector2')literal=literal.input as TslIrExpression
 const xy=(literal.value as number[]).slice(0,2)
 const coordinate=uniform(new Vector2(xy[0]!,xy[1]!))
 const raw=calculate_out_variables(bool(true),bool(false),uniform(x.normalize,'bool'),uniform(sides.value,'float'),float(1),coordinate)
 return guardRadialMetalNode(vec3(raw.y,raw.x,0))as TslExpression
}
