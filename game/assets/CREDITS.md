# Asset credits

All third-party assets below are **CC0 (public domain)** — free for any use,
no attribution required. Listed here only as good practice.

## HDRI environments  (assets/hdri/)
- `modern_buildings_night_2k.hdr` — "Modern Buildings Night" by Poly Haven (CC0)
  https://polyhaven.com/a/modern_buildings_night
  Used by the Neon City round as image-based lighting + skybox (see
  `src/themes/city.js` `env`, loaded in `src/main.js`).

## 3D models  (assets/models/city/)
- `building-*.glb`, `low-detail-building-*.glb`, `Textures/colormap.png` —
  "City Kit (Commercial)" by Kenney (CC0)
  https://kenney.nl/assets/city-kit-commercial
  The Neon City round places these as the in-play buildings + surrounding
  skyline (night-tinted at load time in `src/themes/city.js`).

Loaders vendored to match three r184: `vendor/three/addons/loaders/GLTFLoader.js`
(+ `utils/BufferGeometryUtils.js`, `utils/SkeletonUtils.js`) and
`loaders/HDRLoader.js` (RGBELoader was renamed to HDRLoader in r180).
