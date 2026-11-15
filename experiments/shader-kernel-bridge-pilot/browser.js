import * as THREE from 'three';
import {WebGPURenderer, NodeMaterial, QuadMesh} from 'three/webgpu';
import {glsl, wgsl, glslFn, wgslFn, screenCoordinate, vec3, vec4, float, floor} from 'three/tsl';

window.bridgePilot = async ({backend: wanted, modules, contract}) => {
  const webgl = wanted === 'webgl2';
  const renderer = new WebGPURenderer({forceWebGL: webgl, antialias: false});
  const result = {backend: wanted, status: 'running', rows: [], errors: [], supportCredit: 0};
  window.bridgeFailureSnapshot = result;
  await renderer.init();
  const actual = renderer.backend.isWebGPUBackend ? 'webgpu' : 'webgl2';
  if (actual !== wanted) throw Error('Actual API fallback');
  const gl = renderer.backend.gl, debug = gl?.getExtension('WEBGL_debug_renderer_info');
  const info = renderer.backend.device?.adapterInfo;
  result.gpu = webgl ? {vendor: gl.getParameter(debug?.UNMASKED_VENDOR_WEBGL ?? gl.VENDOR), renderer: gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER)} : {vendor: info?.vendor, architecture: info?.architecture, description: info?.description, device: info?.device};
  renderer.debug.onShaderError = (g,p,v,f) => result.errors.push([g.getProgramInfoLog(p),g.getShaderInfoLog(v),g.getShaderInfoLog(f)].filter(Boolean).join('\n'));
  renderer.backend.device?.addEventListener('uncapturederror',e=>result.errors.push(String(e.error)));
  renderer.setSize(8,8); renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  const functions = {};
  for (const [family, module] of Object.entries(modules)) {
    const library = (webgl ? glsl : wgsl)(webgl ? module.glslLibrary : module.wgslLibrary);
    functions[family] = Object.fromEntries(Object.entries(webgl ? module.glslFunctions : module.wgslFunctions).map(([name,source])=>[name,(webgl ? glslFn : wgslFn)(source,[library])]));
  }
  // Fragment pixel centers divided by exact 8 give dyadic inputs without a
  // raster-interpolated varying. The independent reader still derives row flip.
  const coordinate=screenCoordinate.div(8);
  const p = vec3(coordinate.x.mul(4).sub(2),coordinate.y.mul(4).sub(2),coordinate.x.add(coordinate.y).sub(1));
  const grid = vec3(floor(coordinate.x.mul(8)).sub(4),floor(coordinate.y.mul(8)).sub(4),0);
  const w = coordinate.x.mul(2).sub(0.75);
  try {
    for (const id of contract.caseIds) {
      const row = {case: id, status: 'running'}; result.rows.push(row);
      const material = new NodeMaterial(); material.blending = THREE.NoBlending; material.depthTest=false; material.depthWrite=false;
      if (id === 'input') material.fragmentNode = vec4(p,w);
      else if (id === 'grid-input') material.fragmentNode=vec4(grid,w);
      else if (id.startsWith('gradient-')) material.fragmentNode = functions.gradient.bridge_gradient(p,float(Number(id.slice(9))));
      else if (id.startsWith('checker')) material.fragmentNode=functions.checker.bridge_checker(id==='checker'?p:grid,float(3));
      else if (id==='hash-words') material.fragmentNode=functions.white_noise.bridge_hash_words(p,w);
      else material.fragmentNode=functions.white_noise['bridge_white_'+id.slice(6)](p,w);
      const target = new THREE.RenderTarget(8,8,{type:THREE.FloatType,format:THREE.RGBAFormat,depthBuffer:false});
      target.texture.colorSpace=THREE.NoColorSpace;
      const quad = new QuadMesh(material);
      const device=renderer.backend.device; device?.pushErrorScope('validation');
      try {
        const start=performance.now(); let timeout;
        const shaders=await Promise.race([renderer.debug.getShaderAsync(quad,quad.camera,quad),new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('Compile ceiling exceeded')),contract.limits.maximumCompileMsPerCase)})]).finally(()=>clearTimeout(timeout));
        row.compileMs=performance.now()-start;
        row.vertexShader=shaders.vertexShader; row.fragmentShader=shaders.fragmentShader;
        row.fragmentBytes=new TextEncoder().encode(shaders.fragmentShader).length;
        if(row.fragmentBytes>contract.limits.maximumFragmentShaderBytes)throw Error('Shader byte ceiling exceeded');
        renderer.setRenderTarget(target);
        const drawStart=performance.now(); quad.render(renderer); row.drawSubmissionMs=performance.now()-drawStart;
        const readStart=performance.now(), pixels=await renderer.readRenderTargetPixelsAsync(target,0,0,8,8); row.readbackMs=performance.now()-readStart;
        if(!(pixels instanceof Float32Array))throw Error('Float32 output required');
        const stride=pixels.length===256?8:actual==='webgpu'&&pixels.length===480?16:0;
        if(!stride)throw Error('Unknown padded readback layout');
        row.words=[]; const words=new Uint32Array(pixels.buffer,pixels.byteOffset,pixels.length);
        for(let y=0;y<8;y++)for(let x=0;x<8;x++)for(let c=0;c<4;c++)row.words.push(words[(y*stride+x)*4+c]);
        row.status='compiled-and-drawn';
      } catch(error) { row.status='failed'; row.error=String(error); }
      const validation=await device?.popErrorScope(); if(validation){row.status='failed';row.validation=validation.message;}
      renderer.setRenderTarget(null); target.dispose(); material.dispose();
      row.remainingTextures=renderer.info.memory.textures;
      row.remainingRenderTargets=renderer.info.memory.renderTargets;
      if(row.status==='failed'||row.remainingTextures!==0||row.remainingRenderTargets!==0)throw Error('Case failed: '+id+' '+JSON.stringify({error:row.error,validation:row.validation,textures:row.remainingTextures,targets:row.remainingRenderTargets}));
    }
    if(result.errors.length)throw Error('GPU validation diagnostics');
    result.status='COMPILED_AND_DRAWN';
    return result;
  } finally { renderer.dispose(); }
};
