/* SPDX-FileCopyrightText: 2024-2025 Blender Authors
 *
 * SPDX-License-Identifier: Apache-2.0 */
// Native source-derived candidate: integer Sides3/8/12 and Roundness1 only.
// Upstream Blender02f0899d78e374b63e7181d9061e1f7ab03419cc; sourceSHA256 adab763a5772baca55f40e9ad0aa0cc1942b8bee87f898fe3e4aaa0601ebeeb3.
// Whole native AST branches selected under validated preconditions; arithmetic unchanged.
// Runtime source/model/input and actualrenderer admission live in tslRadialCoordinates.ts.
// Three.js Transpiler r184

import * as TSL from 'three/tsl'
type NativeNode = any
const { Fn, sqrt, property, atan, float, div, floor, abs, If, vec4 } = TSL as unknown as Record<string, (...args: NativeNode[]) => NativeNode>;

export const square = /*@__PURE__*/ Fn( ( [ x ]: NativeNode[] ) => {

	return x.mul( x );

}, { x: 'float', return: 'float' } );

export const calculate_out_variables = /*@__PURE__*/ Fn( ( [ calculate_r_gon_parameter_field, calculate_max_unit_parameter, normalize_r_gon_parameter, r_gon_sides, r_gon_roundness, coord ]: NativeNode[] ) => {

	const l_coord = sqrt( square( coord.x ).add( square( coord.y ) ) ).toVar();
	const out_variables = property( 'vec4' ).toVar();
	const x_axis_A_coord = atan( coord.y, coord.x ).add( float( coord.y.lessThan( float( 0.0 ) ) ).mul( 6.28318530717958647692 ) ).toVar();
	const segment_divider_A_angle_bisector = div( 3.14159265358979323846, r_gon_sides ).toVar();
	const segment_divider_A_next_segment_divider = float( 2.0 ).mul( segment_divider_A_angle_bisector ).toVar();
	const segment_id = floor( x_axis_A_coord.div( segment_divider_A_next_segment_divider ) ).toVar();
	const segment_divider_A_coord = x_axis_A_coord.sub( segment_id.mul( segment_divider_A_next_segment_divider ) ).toVar();
	const r_gon_parameter = float( 0.0 ).toVar();

	If( true, () => {

		r_gon_parameter.assign( abs( segment_divider_A_angle_bisector.sub( segment_divider_A_coord ) ) );

		If( segment_divider_A_coord.lessThan( segment_divider_A_angle_bisector ), () => {

			r_gon_parameter.mulAssign( float( 1.0 ).negate() );

		} );

		If( normalize_r_gon_parameter, () => {

			r_gon_parameter.divAssign( segment_divider_A_angle_bisector );

		} );

	} );

	out_variables.assign( vec4( l_coord, r_gon_parameter, segment_divider_A_angle_bisector, segment_id.mul( segment_divider_A_next_segment_divider ).add( segment_divider_A_angle_bisector ) ) );

	If( coord.x.equal( float( 0.0 ) ).and( coord.y.equal( float( 0.0 ) ) ), () => {

		out_variables.y.assign( float( 0.0 ) );

	} );

	If( normalize_r_gon_parameter, () => {

		out_variables.y.assign( float( 0.5 ).mul( out_variables.y ).add( float( 0.5 ) ) );

	} ).Else( () => {

		out_variables.x.subAssign( float( 1.0 ) );

	} );

	return out_variables;

}, { calculate_r_gon_parameter_field: 'bool', calculate_max_unit_parameter: 'bool', normalize_r_gon_parameter: 'bool', r_gon_sides: 'float', r_gon_roundness: 'float', coord: 'vec2', return: 'vec4' } );
