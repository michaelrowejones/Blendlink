import families from './mask-families.json' with {type:'json'}
export function sceneMaskProofFamily(name='ellipse'){if(!Object.hasOwn(families,name))throw Error('Unknown scene-mask proof family: '+name);return Object.freeze({...families[name]})}
export const sceneMixBrowserStatuses=Object.freeze({baseline:'CAPTURED_ELLIPSE_SCENE_BASELINES',compare:'PASSED_ELLIPSE_SCENE_FINAL_PROOF'})
export const sceneMixExtents=Object.freeze([{width:13,height:9,pixelRatio:1},{width:18,height:26,pixelRatio:2}])
