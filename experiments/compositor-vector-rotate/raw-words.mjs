/* SPDX-License-Identifier: MIT */
/** Remove raw arrays from a report object without deleting numeric word counts. */
export function takeRawWords(sample){
 const values=sample.rawWords??(Array.isArray(sample.words)?sample.words:undefined)
 if(values===undefined)return undefined
 if(!Array.isArray(values)||![...values].every(word=>Number.isSafeInteger(word)&&word>=0&&word<=0xffffffff))throw Error('Pilot raw word array is invalid')
 delete sample.rawWords
 if(Array.isArray(sample.words))delete sample.words
 return values
}
