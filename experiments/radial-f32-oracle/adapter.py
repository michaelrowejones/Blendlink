# SPDX-License-Identifier: MIT
"""Independent raw-source assembly: aliases/dependencies only, no kernel rewrite."""
import hashlib,re
from pathlib import Path
sha=lambda data:hashlib.sha256(data).hexdigest()

def assemble(directory):
 directory=Path(directory);shared=(directory/'gpu_shader_material_radial_tiling_shared.glsl').read_text();base=(directory/'gpu_shader_math_base.bsl.hh').read_text();constants=(directory/'gpu_shader_math_constants.bsl.hh').read_text()
 # Select exact native scalar helper declarations+bodies. Their scalar types
 # already are GLSL-compatible; preserve byte sequences without substituting math.
 square=re.search(r'float square\(float v\)\n\{.*?\n\}',base,re.S).group(0)
 atan2=re.search(r'float _atan2\(float y, float x\)\n\{.*?\n\}\n#define atan2 _atan2',base,re.S).group(0)
 assert square=='float square(float v)\n{\n  return v * v;\n}'
 assert atan2=='float _atan2(float y, float x)\n{\n  return atan(y, x);\n}\n#define atan2 _atan2'
 aliases='#define float2 vec2\n#define float3 vec3\n#define float4 vec4\n'
 license_header='/* Native math helper declarations: Blender Authors2023, GPL-2.0-or-later; unchanged bodies. */\n'
 # Unchanged constants/header and entire shared GLSL file retain their native
 # copyright/license comments and default GLSL adaptation macros.
 source=aliases+constants+'\n'+license_header+square+'\n'+atan2+'\n'+shared+'\n'
 kernel='''void main(){vec4 inputValue=texelFetch(oracle_input,ivec2(int(gl_FragCoord.x),0),0);fragColor=calculate_out_variables(true,false,bool(inputValue.w),inputValue.z,1.0,inputValue.xy);}'''
 diagnostic=aliases+constants+'\n'+license_header+square+'\n'+atan2+'\nvoid main(){vec2 coord=texelFetch(oracle_input,ivec2(int(gl_FragCoord.x),0),0).xy;fragColor=vec4(_atan2(coord.y,coord.x),sqrt(square(coord.x)+square(coord.y)),0.0,1.0);}'
 # Source-operand diagnostics reproduce the exact regular-branch statements.
 # Separate observable programs can affect optimizer choices; these are NOT
 # instrumentation of the compiled main function's actual registers.
 regular_head=shared.split('if (fractf(r_gon_sides) == float(0.0)) {',1)[1].split('    if (r_gon_roundness == float(0.0)) {',1)[0]
 macros=shared[:shared.index('/* Naming convention')]
 prefix=aliases+constants+'\n'+license_header+square+'\n'+atan2+'\n'+macros
 setup='vec4 inputValue=texelFetch(oracle_input,ivec2(int(gl_FragCoord.x),0),0);vec2 coord=inputValue.xy;float r_gon_sides=inputValue.z;'
 angle=prefix+'\nvoid main(){'+setup+regular_head+'fragColor=vec4(x_axis_A_coord,segment_divider_A_next_segment_divider,x_axis_A_coord / segment_divider_A_next_segment_divider,segment_id);}'
 phase=prefix+'\nvoid main(){'+setup+regular_head+'''float r_gon_parameter = fabsf(segment_divider_A_angle_bisector - segment_divider_A_coord);
 if (segment_divider_A_coord < segment_divider_A_angle_bisector) { r_gon_parameter *= -float(1.0); }
 float raw_phase=r_gon_parameter;
 if (bool(inputValue.w)) { r_gon_parameter /= segment_divider_A_angle_bisector; }
 if ((coord.x == float(0.0)) && (coord.y == float(0.0))) { r_gon_parameter = float(0.0); }
 if (bool(inputValue.w)) { r_gon_parameter = float(0.5) * r_gon_parameter + float(0.5); }
 fragColor=vec4(segment_divider_A_coord,segment_divider_A_angle_bisector,raw_phase,r_gon_parameter);}'''
 return {'kernel':source+kernel,'diagnostic':diagnostic,'angle':angle,'phase':phase,'input':'void main(){fragColor=texelFetch(oracle_input,ivec2(int(gl_FragCoord.x),0),0);}',
  'pins':{'rawSharedSha256':sha(shared.encode()),'rawSharedBytes':len(shared.encode()),'squareDeclarationSha256':sha(square.encode()),'atan2DeclarationSha256':sha(atan2.encode()),'constantHeaderSha256':sha(constants.encode()),'aliasesSha256':sha(aliases.encode()),'assembledKernelSha256':sha((source+kernel).encode()),'diagnosticSha256':sha(diagnostic.encode()),'regularSourceStatementsSha256':sha(regular_head.encode()),'angleDiagnosticSha256':sha(angle.encode()),'phaseDiagnosticSha256':sha(phase.encode())},
  'adaptation':'Entire shared GLSL source unmodified; external float2/3/4 ABI aliases, exact native constant header and scalar square/_atan2 declarations; default GLSL macros. Direct calculate_out_variables(true,false,normalize,Sides,1,coord), raw returnRGBA. No arithmetic-body rewrite, no generated TSL candidate used.'}
