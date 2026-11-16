import assert from'node:assert/strict'
// Predeclared field profiles only.512x32 preserves the saved16:1 projection;
// this is not a512-square artist-view or whole-scene release qualification.
export function fieldProfile(targetWidth=128){
 assert.ok(targetWidth===128||targetWidth===512,'Undeclared BOX field target width')
 const sizes=targetWidth===512?[[64,4],[128,8],[512,32]]:[[64,4],[128,8]],control=targetWidth===512?[512,32]:[128,8]
 return{targetWidth,sizes,control,nativeRows:sizes.length*9,rowsPerApi:sizes.length*12+27,numericRows:sizes.length*48,numericWords:sizes.reduce((n,[w,h])=>n+w*h,0)*4*4*3*4}
}
export function targetArgument(value){assert.ok(value===undefined||value==='--target-width=512','Undeclared BOX field target argument');return fieldProfile(value===undefined?128:512)}
