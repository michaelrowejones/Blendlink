// Three.js r184 - Node System

// global
diagnostic( off, derivative_uniformity );


// structs

struct OutputStruct {
	@location( 0 ) color: vec4<f32>
};
var<private> output : OutputStruct;

// uniforms
@binding( 0 ) @group( 1 ) var nodeUniform0 : texture_2d<f32>;
@binding( 1 ) @group( 1 ) var nodeUniform1_sampler : sampler;
@binding( 2 ) @group( 1 ) var nodeUniform1 : texture_2d<f32>;
@binding( 3 ) @group( 1 ) var nodeUniform2 : texture_2d<f32>;

// vars
var<private> nodeVar0 : vec4<f32>;
var<private> nodeVar1 : vec4<f32>;
var<private> nodeVar2 : vec4<f32>;
var<private> nodeVar3 : vec4<f32>;
var<private> nodeVar4 : vec4<f32>;
var<private> nodeVar5 : vec4<f32>;
var<private> nodeVar6 : vec2<i32>;
var<private> nodeVar7 : vec4<f32>;
var<private> nodeVar8 : f32;
var<private> nodeVar9 : f32;
var<private> nodeVar10 : vec4<f32>;
var<private> nodeVar11 : vec2<i32>;
var<private> nodeVar12 : vec4<f32>;
var<private> nodeVar13 : vec4<f32>;
var<private> nodeVar14 : vec2<i32>;
var<private> nodeVar15 : vec4<f32>;
var<private> nodeVar16 : vec4<f32>;
var<private> nodeVar17 : vec2<i32>;
var<private> nodeVar18 : vec4<f32>;
var<private> nodeVar19 : vec4<f32>;

// codes


@fragment
fn main( @location( 0 ) nodeVarying4 : vec2<f32> ) -> OutputStruct {

	// flow
	// code

	nodeVar0 = textureLoad( nodeUniform0, vec2<i32>( ( vec2<i32>( ( nodeVarying4 * vec2<f32>( vec2<i32>( textureDimensions( nodeUniform1, 0 ) ) ) ) ).x % 256 ), ( vec2<i32>( ( nodeVarying4 * vec2<f32>( vec2<i32>( textureDimensions( nodeUniform1, 0 ) ) ) ) ).x / 256 ) ), u32( 0u ) );
	nodeVar1 = nodeVar0;
	nodeVar2 = textureLoad( nodeUniform2, vec2<i32>( ( vec2<i32>( ( nodeVarying4 * vec2<f32>( vec2<i32>( textureDimensions( nodeUniform1, 0 ) ) ) ) ).y % 256 ), ( vec2<i32>( ( nodeVarying4 * vec2<f32>( vec2<i32>( textureDimensions( nodeUniform1, 0 ) ) ) ) ).y / 256 ) ), u32( 0u ) );
	nodeVar3 = nodeVar2;

	if ( ( ( nodeVar1.w * nodeVar3.w ) == 0.0 ) ) {

		nodeVar4 = vec4<f32>( 0.0, 0.0, 0.0, 0.0 );

	} else {

		nodeVar6 = vec2<i32>( i32( nodeVar1.x ), i32( nodeVar3.x ) );

		if ( ( ( ( ( f32( nodeVar6.x ) >= 0.0 ) && ( f32( nodeVar6.y ) >= 0.0 ) ) && ( nodeVar6.x < vec2<i32>( textureDimensions( nodeUniform1, 0 ) ).x ) ) && ( nodeVar6.y < vec2<i32>( textureDimensions( nodeUniform1, 0 ) ).y ) ) ) {

			nodeVar7 = textureLoad( nodeUniform1, clamp( nodeVar6, vec2<i32>( 0, 0 ), ( vec2<i32>( textureDimensions( nodeUniform1, 0 ) ) - vec2<i32>( i32( 1.0 ) ) ) ), u32( 0u ) );
			nodeVar5 = nodeVar7;

		} else {

			nodeVar5 = vec4<f32>( 0.0, 0.0, 0.0, 0.0 );

		}

		nodeVar8 = ( 1.0 - nodeVar1.z );
		nodeVar9 = ( 1.0 - nodeVar3.z );
		nodeVar11 = vec2<i32>( i32( nodeVar1.y ), i32( nodeVar3.x ) );

		if ( ( ( ( ( f32( nodeVar11.x ) >= 0.0 ) && ( f32( nodeVar11.y ) >= 0.0 ) ) && ( nodeVar11.x < vec2<i32>( textureDimensions( nodeUniform1, 0 ) ).x ) ) && ( nodeVar11.y < vec2<i32>( textureDimensions( nodeUniform1, 0 ) ).y ) ) ) {

			nodeVar12 = textureLoad( nodeUniform1, clamp( nodeVar11, vec2<i32>( 0, 0 ), ( vec2<i32>( textureDimensions( nodeUniform1, 0 ) ) - vec2<i32>( i32( 1.0 ) ) ) ), u32( 0u ) );
			nodeVar10 = nodeVar12;

		} else {

			nodeVar10 = vec4<f32>( 0.0, 0.0, 0.0, 0.0 );

		}

		nodeVar14 = vec2<i32>( i32( nodeVar1.x ), i32( nodeVar3.y ) );

		if ( ( ( ( ( f32( nodeVar14.x ) >= 0.0 ) && ( f32( nodeVar14.y ) >= 0.0 ) ) && ( nodeVar14.x < vec2<i32>( textureDimensions( nodeUniform1, 0 ) ).x ) ) && ( nodeVar14.y < vec2<i32>( textureDimensions( nodeUniform1, 0 ) ).y ) ) ) {

			nodeVar15 = textureLoad( nodeUniform1, clamp( nodeVar14, vec2<i32>( 0, 0 ), ( vec2<i32>( textureDimensions( nodeUniform1, 0 ) ) - vec2<i32>( i32( 1.0 ) ) ) ), u32( 0u ) );
			nodeVar13 = nodeVar15;

		} else {

			nodeVar13 = vec4<f32>( 0.0, 0.0, 0.0, 0.0 );

		}

		nodeVar17 = vec2<i32>( i32( nodeVar1.y ), i32( nodeVar3.y ) );

		if ( ( ( ( ( f32( nodeVar17.x ) >= 0.0 ) && ( f32( nodeVar17.y ) >= 0.0 ) ) && ( nodeVar17.x < vec2<i32>( textureDimensions( nodeUniform1, 0 ) ).x ) ) && ( nodeVar17.y < vec2<i32>( textureDimensions( nodeUniform1, 0 ) ).y ) ) ) {

			nodeVar18 = textureLoad( nodeUniform1, clamp( nodeVar17, vec2<i32>( 0, 0 ), ( vec2<i32>( textureDimensions( nodeUniform1, 0 ) ) - vec2<i32>( i32( 1.0 ) ) ) ), u32( 0u ) );
			nodeVar16 = nodeVar18;

		} else {

			nodeVar16 = vec4<f32>( 0.0, 0.0, 0.0, 0.0 );

		}

		nodeVar4 = ( ( ( nodeVar5 * vec4<f32>( ( nodeVar8 * nodeVar9 ) ) ) + ( nodeVar10 * vec4<f32>( ( nodeVar1.z * nodeVar9 ) ) ) ) + ( ( nodeVar13 * vec4<f32>( ( nodeVar8 * nodeVar3.z ) ) ) + ( nodeVar16 * vec4<f32>( ( nodeVar1.z * nodeVar3.z ) ) ) ) );

	}

	nodeVar19 = nodeVar4;

	// result

	output.color = nodeVar19;

	return output;

}
