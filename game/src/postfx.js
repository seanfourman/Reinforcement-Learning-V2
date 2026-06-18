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
    0.7, // strength — a touch more glow/atmosphere
    0.6, // radius
    0.75 // threshold — emissives (crystals, pedestal) bloom
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

  // per-theme bloom: emissive-heavy themes (the neon city) need a gentler pass
  // and a higher threshold or the whole scene blows out to white.
  const BLOOM_DEFAULT = { strength: 0.7, radius: 0.6, threshold: 0.75 };
  function setBloom(opts) {
    const { strength, radius, threshold } = { ...BLOOM_DEFAULT, ...(opts || {}) };
    bloom.strength = strength;
    bloom.radius = radius;
    bloom.threshold = threshold;
  }

  return { composer, setSize, setBloom };
}
