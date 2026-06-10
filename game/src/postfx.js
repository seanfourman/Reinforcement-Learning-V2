import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { VignetteShader } from 'three/addons/shaders/VignetteShader.js';

export function createPostFX(renderer, scene, camera) {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));

  const bloom = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    0.5, // strength
    0.55, // radius
    0.8 // threshold — only emissives glow
  );
  composer.addPass(bloom);

  const vignette = new ShaderPass(VignetteShader);
  vignette.uniforms.offset.value = 0.95;
  vignette.uniforms.darkness.value = 0.9;
  composer.addPass(vignette);

  composer.addPass(new OutputPass());

  function setSize(w, h, pixelRatio) {
    composer.setPixelRatio(pixelRatio);
    composer.setSize(w, h);
  }

  return { composer, setSize };
}
