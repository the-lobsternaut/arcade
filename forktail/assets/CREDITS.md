# Asset credits: Fork-Tailed Devil

Every image in this folder is original. Each one was made for this project with an AI image generator (Grok Bot's GenerateImage tool) in October 2026, then cut out and processed by `tools/process_assets.py`. No Capcom assets, logos, sprites or music are used, and no third-party photos are included.

| File | Content | Source |
| --- | --- | --- |
| player.webp | P-38-style twin-boom fighter, top-down, nose up | AI-generated, magenta-key cutout |
| zero.webp, zero_red.webp | Zero-style fighters (green and red liveries), nose up (rotated to fly nose-down in game) | AI-generated, magenta/green-key cutout |
| bomber.webp | twin-engine bomber, top-down | AI-generated, magenta-key cutout |
| heavy.webp | 4-engine heavy bomber (stage boss) | AI-generated, magenta-key cutout |
| destroyer.webp, battleship.webp, bossShip.webp | warships with empty barbettes (turrets are separate rotating sprites) | AI-generated, magenta-key cutout |
| turret_big.webp, turret_aa.webp | main gun turret / AA mount, pivot-centred | AI-generated, magenta-key cutout |
| medal.webp | brass POW medallion (enamel and letters are drawn in code) | AI-generated, magenta-key cutout |
| ocean.webp | deep-ocean aerial texture, made seamless by offset cross-blending | AI-generated |
| island1-3.webp | tropical island, atoll, volcanic island (alpha from ocean-colour distance) | AI-generated |
| cloud1-4.webp | cumulus clouds (alpha from luminance) | AI-generated |
| fireball.webp, smoke.webp, splash.webp, nuke.webp | explosion, smoke, water splash, top-down nuclear blast | AI-generated, luminance-keyed |

Generated originals are not shipped. The processing pipeline (chroma key with spill unmixing, matte erosion, trimming, premultiplied Lanczos downscaling, WebP export) is in `tools/process_assets.py`.
The HUD, bullets, bomb, glow and foam particles are drawn in code. Sound effects are synthesized at runtime with WebAudio.

## 3D (added in the 3D rebuild)
| Asset | Source | License |
| --- | --- | --- |
| `js/vendor/three.webgpu.min.js`, `three.core.min.js`, `three.tsl.min.js`, `SkyMesh.js` (three.js r176, WebGPU build) | https://threejs.org | MIT |
| `assets/tex/map_world.webp` (campaign map) | rasterized from **Natural Earth** 1:50m land polygons (naturalearthdata.com) with `tools/maptex.py` | public domain |
| `assets/tex/*.webp`, `assets/meta3d.js` (aircraft/ship relief textures + heightmaps) | derived from the AI-generated sprites above | project |
| Ocean, sky, clouds, particles, islands geometry | procedural shaders / geometry in `js/render3d.js` | project |


## Music
All 7 loops and 2 stingers in `assets/music/` are original compositions made for this project by `tools/music/render.py`.
- 1940s instruments: rendered with **FluidSynth** using the **FluidR3_GM** SoundFont by Frank Wen (MIT license).
- Drum & bass layer (breaks, reese and sub bass, risers, vinyl crackle): synthesized in numpy/scipy.
- Loudness was measured with pyloudnorm (MIT) and the files encoded to AAC with ffmpeg.

No samples from commercial recordings are used.

## Characters and history
All named people are fictional composites. Historical notes in the dossier summarize public history. No real Axis insignia or war flags are depicted; nation badges use plain colour stripes, with Axis badges in neutral gunmetal.

## Characters (2D portraits)
Characters are drawn by `js/portraits.js` as layered 2D portraits on a canvas: `hair_back`, `body`,
an optional pose arm, `hair_front`, then brows / eyes / mouth and an overlay. Blink, breath, hair
sway, mouth cycling while talking and a parallax tilt are all driven by the engine, so the nine
expressions are combinations of a handful of small parts rather than nine separate drawings.

Art goes in `assets/portraits/<id>/<part>.webp` and is picked up through
`assets/portraits/index.json` - see `assets/portraits/README.md` for the canvas, anchors and part
list. Any part with no artwork is generated procedurally from that character's `look` in
`js/story.js` (hair, skin, eye and lip colour, the three uniform colours, cap, headset, tattoo,
midriff), so the game runs with no portrait art at all.

The previous 3D character system (Quaternius "Ultimate Modular Women/Men" CC0 GLBs rendered with
GLTFLoader + SkeletonUtils + meshopt) was removed along with its assets and loaders.

## Coastlines

Level maps (`js/terrain.js`) are built from OpenStreetMap `natural=coastline` data:
stitched, projected into playfield units and simplified by `tools/coastline.py`.

Map data © OpenStreetMap contributors, available under the Open Database Licence (ODbL).
https://www.openstreetmap.org/copyright
