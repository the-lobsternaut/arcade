# Tetris (3D)

A 3D Tetris game in the browser, built with plain HTML, CSS, and JavaScript and rendered with [three.js](https://threejs.org/) (bundled locally in `vendor/`). There's no build step and nothing loads from a CDN, so you can serve the folder as-is, for example on GitHub Pages.

![Gameplay](screenshot.png)

## Play locally

ES modules don't load over `file://`, so run any static server from this folder:

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

## Controls

### Keyboard

| Key | Action |
| --- | --- |
| ← / → | Move left / right (hold to auto-repeat) |
| ↓ | Soft drop |
| Space | Hard drop |
| ↑ or X | Rotate clockwise |
| Z (or Ctrl) | Rotate counter-clockwise |
| C or Shift | Hold piece |
| P or Esc | Pause / resume |
| Enter | Start / restart |
| V | Cycle camera presets (Front → Angled → Dramatic) |
| I / K | Orbit camera up / down (hold to repeat) |
| J / L | Orbit camera left / right (hold to repeat) |
| = / - (or numpad + / −) | Zoom in / out |
| R or 0 | Reset camera to head-on |
| M | Sound on / off |
| F | Toggle full screen (where supported) |

### Mouse (camera)

- **Right-drag**, **middle-drag** or **Alt + left-drag** on the board orbits the camera, up to ±60° left/right and ±45° up/down.
- The **mouse wheel** or a **trackpad pinch** zooms (within limits).
- Right-clicking the board doesn't open the browser's menu.

### Touch (phones and tablets)

- **Buttons:** ◀ ▼ ▶ move and soft drop (hold to repeat). ⟲ ⟳ rotate. ⤓ hard drops.
- **Gestures on the board:**
  - Tap to rotate.
  - Drag sideways to move.
  - Drag down to soft drop.
  - Flick down to hard drop.
  - Flick up to hold.
- **Two fingers:** drag to orbit the camera, pinch to zoom. One-finger gestures always control the game.
- Tap the **Hold** box to hold. The ❚❚ button pauses, ♪ turns sound on or off, and ◈ opens the camera panel.

### Camera panel (◈)

A small panel at the top of the board. It has:

- ◀ ▶ ▲ ▼ to orbit (hold to repeat)
- − / + to zoom
- **Front**, **Angled** and **Dramatic** presets
- **Reset** to go back to head-on

Camera moves are smoothly animated. The game always starts with the camera **head-on (Front)**; a previous view isn't restored.

## Full screen on mobile

- **Android / iPad / desktop:** tap **⛶** (or press **F**) to go full screen using the Fullscreen API. On phones it also tries to lock the screen to portrait.
- **iPhone:** Safari has no Fullscreen API. Use **Share → Add to Home Screen**; the game then opens full screen like an app. A one-time hint suggests this, and it stops showing once you dismiss it.
- When the game is installed as an app, the ⛶ button is hidden. The game always fills the screen (`100dvh`, safe-area insets) with no scrolling, rubber-banding, or double-tap zoom.

## Features

- 10×20 board and the 7 standard tetrominoes, using **SRS rotation with the full wall-kick tables** (including the I piece's own kicks)
- **7-bag** randomizer, **hold** piece, **5-piece next preview**, and a translucent **ghost** piece
- Soft drop scores 1 point per cell and hard drop scores 2 per cell. **Lock delay** is 0.5 s and resets up to 15 times when you move or rotate.
- Line clears score Single 100, Double 300, Triple 500, and Tetris 800, multiplied by the level. A back-to-back Tetris is worth ×1.5, and combos add a bonus.
- The level goes up every 10 lines, with gravity speeds based on the official guidelines
- Pause (the game also pauses itself when the tab is hidden), game over and restart. The **high score is saved in localStorage**.
- The 3D scene has:
  - Beveled, lit, shadow-casting cubes, drawn with instanced meshes so it stays fast on phones
  - A metallic well with neon edges
  - A perspective camera that starts head-on. You can orbit and zoom it, or pick a preset; the Angled and Dramatic presets sway gently.
- When you clear lines, the rows flash, the cubes burst out toward the camera, and the camera shakes. The rows above slide down smoothly.
- The layout adapts to the screen and works on an iPhone: in portrait the stats sit in a compact top bar, and on-screen buttons appear on touch devices.
- Small sound effects made with WebAudio, which you can mute

## Files

```
index.html          page + import map ("three" -> ./vendor/three.module.min.js), PWA/iOS meta tags
manifest.webmanifest  web app manifest (fullscreen, portrait, icons)
icons/              icon-192.png, icon-512.png, apple-touch-icon.png (180)
style.css           layout / theme (responsive)
js/game.js          pure game logic (no DOM): SRS, bag, scoring, lock delay
js/render3d.js      three.js scene: well, instanced blocks, ghost, particles, camera
js/main.js          input (keyboard, touch buttons, swipes), HUD, previews, sound, loop
vendor/             three.js r170 (MIT) + RoundedBoxGeometry + RoomEnvironment addons
```
