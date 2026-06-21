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

  // --- selective bloom (start-menu only) --------------------------------------
  // The menu's bright key light blows the lit characters out so they dominate the
  // glow. This second pipeline excludes meshes flagged `userData.excludeBloom`
  // (the seated characters) from the bloom while the rest of the cabin still
  // blooms. Two passes keep depth correct and avoid double-brightening the cabin:
  //   bloomComposer: scene with the CHARACTERS blacked out  -> cabin + bloom
  //   finalComposer: scene with the CABIN blacked out (base) -> characters, +bloom
  // Each render still draws every mesh (just some as flat black), so occlusion
  // between characters and cabin stays correct; the black areas are filled in by
  // the other pass. The game keeps using `composer` above, untouched.
  const bloomComposer = new EffectComposer(renderer);
  bloomComposer.renderToScreen = false;
  bloomComposer.addPass(new RenderPass(scene, camera));
  const selBloom = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    0.2,
    0.7,
    0.42
  );
  bloomComposer.addPass(selBloom);

  const mixPass = new ShaderPass(
    new THREE.ShaderMaterial({
      uniforms: {
        baseTexture: { value: null },
        bloomTexture: { value: bloomComposer.renderTarget2.texture },
      },
      vertexShader:
        'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }',
      fragmentShader:
        'uniform sampler2D baseTexture; uniform sampler2D bloomTexture; varying vec2 vUv;' +
        'void main(){ gl_FragColor = texture2D( baseTexture, vUv ) + texture2D( bloomTexture, vUv ); }',
    }),
    'baseTexture'
  );
  const finalComposer = new EffectComposer(renderer);
  finalComposer.addPass(new RenderPass(scene, camera));
  finalComposer.addPass(mixPass);
  finalComposer.addPass(new OutputPass());

  const DARK = new THREE.MeshBasicMaterial({ color: 0x000000 });
  const _saved = [];
  function _darken(test) {
    scene.traverse((o) => {
      if (o.isMesh && o.material !== DARK && test(o)) {
        _saved.push([o, o.material]);
        o.material = DARK;
      }
    });
  }
  function _restore() {
    for (const [o, m] of _saved) o.material = m;
    _saved.length = 0;
  }
  const _isChar = (o) => o.userData && o.userData.excludeBloom;
  function renderSelective() {
    _darken(_isChar); // characters black -> only the cabin feeds the bloom
    bloomComposer.render();
    _restore();
    _darken((o) => !_isChar(o)); // cabin black -> base render is characters only
    finalComposer.render(); // base(characters) + bloom(cabin)
    _restore();
  }

  function setSize(w, h, pixelRatio) {
    composer.setPixelRatio(pixelRatio);
    composer.setSize(w, h);
    bloomComposer.setPixelRatio(pixelRatio);
    bloomComposer.setSize(w, h);
    finalComposer.setPixelRatio(pixelRatio);
    finalComposer.setSize(w, h);
  }

  // per-theme bloom: emissive-heavy themes (the city) need a gentler pass
  // and a higher threshold or the whole scene blows out to white.
  const BLOOM_DEFAULT = { strength: 0.7, radius: 0.6, threshold: 0.75 };
  function setBloom(opts) {
    const { strength, radius, threshold } = { ...BLOOM_DEFAULT, ...(opts || {}) };
    bloom.strength = strength;
    bloom.radius = radius;
    bloom.threshold = threshold;
    selBloom.strength = strength;
    selBloom.radius = radius;
    selBloom.threshold = threshold;
  }

  // toggle the edge vignette (the start menu turns it off for a clean look)
  function setVignette(on) {
    vignette.enabled = on !== false;
  }

  return { composer, renderSelective, setSize, setBloom, setVignette };
}
