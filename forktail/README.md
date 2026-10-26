# Fork-Tailed Devil

An original vertical-scrolling WWII air-combat shooter, a fan tribute in the spirit of the 1987 arcade classic. It isn't affiliated with Capcom.

It's a static site: no build step and no network dependencies at runtime. The game renders in 3D with three.js (vendored in `js/vendor`) from a tilted near-top-down camera, while the game logic stays 2D. Without WebGL it falls back to the original Canvas-2D renderer automatically; you can also force that with `?r=2d`, and `?q=0..3` pins the graphics quality.

## Running

```
python3 server.py --port 8091 --bind 0.0.0.0     # static files + save API (stdlib only)
# or any static server, e.g. python3 -m http.server 8000 (saves then stay local-only)
```

## Controls
| Keyboard | Action |
| --- | --- |
| Arrows / WASD | move |
| Space / Z | fire (hold) and drop bombs in BOMBS mode |
| Q / Tab | switch GUNS / BOMBS mode |
| X / Shift | loop (free, dodges everything, short recovery) |
| P / Esc | pause |
| M | mute all sound, B toggles music only |
| F | fullscreen |
| Enter | start; any key or tap skips briefing cards |

Touch: drag anywhere to fly (the plane moves relative to your finger), and fire is automatic while touching. The LOOP and MODE buttons sit bottom-right; a two-finger tap also loops.

## Systems
- **Armor is the only bar.** It drops when you are hit and is restored by REPAIR kits, which are the only thing that drops in a mission - everything else you carry was bought in the hangar. Battle damage shows at 70%, 45% and 20% armor (smoke, fire, wobble) on the player and on enemies. There is no fuel: it was a second clock running against you that you could not act on, and the only honest answer to it was a yellow can.
- **Weapon modes.** GUNS and BOMBS each have their own power-up family (gun: spread / laser / shotgun / auto-gun / gun-up; bomb: cluster / napalm / torpedo / rapid / N-bomb). Power-ups are permanent for the run and level 1 to 3; picking up the same type levels it up.
- **N-bomb:** 50x bomb damage, radius = 1/3 of the screen width, vaporises every enemy bullet, sinks ships, never hurts you. It has a long flash, 3D shockwave rings, a mushroom cloud and camera shake.
- **POW pacing:** random drops need a 7 s gap and a supply drop guarantees one about every 12.5 s, so you get one roughly every 10 to 15 s.
- **Bosses** have 3 phases, destructible parts and telegraphed attacks (red circles and lines): a battleship (turrets then bridge), a heavy bomber (engines, dorsal/tail guns) and a carrier (AA, then elevators launching fighters, then the island).
- **Hangar** after each battle. Spend Merit on the TECH TREE (ARMOR / GUNS / BOMBS / SUPPORT), pick a COPILOT (you stay the pilot; the copilot gives a passive bonus), and hire up to 2 WINGMEN.
- **Campaign map** (WebGL war-room table, Natural Earth coastlines). Battles you have won get medals and flight arcs, available ones pulse, and undiscovered ones stay under fog. Replays pay reduced Merit. Bonus European theaters unlock after Midway and Rabaul.
- **Boss briefings:** before each boss an Allied guest radios a tip for that boss type and an Axis guest taunts you. Mission controller Lt. Vivian "HALO" Hale gets the last word: jealous after an Allied guest, fiery after an Axis one. Cards slide in with radio static, auto-close, and are skipped with a tap or key.
- **Dossier:** every guest you meet is added, with a historical note.

## Saves
- Autosave to localStorage after every battle, hangar purchase, and whenever the app is backgrounded.
- **SAVE / LOAD** on the title screen: export/import a versioned file `pacific-skies-save-YYYYMMDD.json` (format `pacific-skies-save`, version 4; older v3 runs are migrated).
- With `server.py` the game also syncs to the server slot (default `pilot1`). A chip shows "Saved to server" or "Offline, saved locally", and on start you're asked if the server has a newer save.
- API: `GET /api/saves`, `GET /api/save?slot=NAME` (204 when empty), `PUT|POST /api/save?slot=NAME`. Slot names are `[A-Za-z0-9_-]{1,32}`; the body limit is 2 MB; writes are atomic; the last 5 versions are kept in `saves/backups/`. Path traversal and directory listing are refused.

## Characters
A character is one painted portrait, or a short clip, living in `assets/pack.bin` (`js/portraits.js`). The engine adds what the art cannot: a slow breath, a parallax tilt, and for a clip, playback driven by whether she actually has a line to deliver. Only one is on screen at a time.

**A character with no portrait does not appear and does not speak.** No badge, no stand-in, no card. Where that line still has to reach you, HALO says it - she reads a copilot's file, names the wingman who went down, and is the only voice in the air. Nothing is hard-coded to her: every surface asks whether the speaker has a portrait and takes the other path if not, so anyone starts talking for herself the moment her art lands in the pack. See `docs/avatars.md` for adding one.

### Where anyone speaks
One card, one place. A radio call, the mission objectives and a boss briefing are the same shape in the same spot - across the top of the field, portrait on the left, text beside it - and the hangar, dossier and victory screens all put the portrait top left with the line next to it. Nothing speaks from the bottom of the screen, and nothing speaks on a timer: in the air HALO calls damage, a lost wingman and the target going down, and that is all. The card is its own dismiss button: the text panel slides out from behind the portrait, and a tap on either sends the pair back off the left edge.

## Extending
- Nations / guests and levels live in `assets/pack.bin`, not in a source file - unpack it with `python3 tools/packassets.py unpack`, edit `assets/dialog.json`, pack it again (`docs/avatars.md`). `GUESTS` entries are name, rank, role, theaters `th`, `lines`, `note`, `q` (HALO's quip), `look`; allied lines that mention a boss's parts are matched to that boss automatically. `LEVELS` entries are `after` ids that unlock it, `theme`, enemy `mix`, `boss`, `obj` and tied `nations`. `js/story.js` is the logic that reads them; map coordinates live in `COORD` in `js/map3d.js`.
- Game logic sources are `js/src/g1..g9*.js`. Rebuild with `cd js/src && cat g1_data.js g2_state.js g3_spawn.js g4_player.js g5_enemies.js g6_combat.js g7_flow.js g8_render.js g9_debug.js > ../game.js`. That is plain concatenation; nothing is compiled.
- Music: `python3 tools/music/render.py [ids]` (needs fluidsynth, the FluidR3_GM soundfont, numpy, scipy, mido, pyloudnorm and ffmpeg) re-renders `assets/music/*.m4a` and `tracks.js`.
- Debug hooks: `SKY.game.debug` in the console (info, skipToBoss, drop(type), setWeapon, nuke, completeLevels(n), gotoHangar, gotoMap, killBoss, ...).

## Music
Original drum & bass x 1940s big band. Every track was composed and rendered for this project; loops are seamless (the intro plays once, then the body loops) and normalized to about -14 LUFS.

| id | title | BPM | loop end | description |
| --- | --- | --- | --- | --- |
| title | Victory Rolls | 172 | 27.907 s | Title theme, 172 BPM, D minor. A muted-trumpet fanfare and sax answer over a rolling two-step break and a warm reese; the hook arrives after a 4-bar brass intro. |
| stage1 | Pacific Jump | 174 | 46.8966 s | Stage loop A, 174 BPM, E minor. Liquid DnB: swung clarinet lead, walking upright bass doubling the sub, piano comping, bright ride. |
| stage2 | Bomber's Moon | 172 | 47.4419 s | Stage loop B, 172 BPM, A minor (Phrygian flavour). Darker neuro-style reese, muted trumpet and tenor sax over a tight, ghost-note break. |
| stage3 | Flak Alley | 175 | 46.6286 s | Stage loop C, 175 BPM, C minor. Jump-up energy: big-band brass stabs, trumpet/trombone call-and-response, bouncing two-note bass. |
| boss1 | Battleship Row | 174 | 46.8966 s | Boss theme A, 174 BPM, G minor. Heavy: brass-section ostinato, timpani hits, distorted reese and a relentless stepper break. |
| boss2 | Divine Wind | 175 | 46.6286 s | Boss theme B, 175 BPM, B-flat minor. Tense tremolo strings and violin lead over a halftime-into-full-time break, swelling brass. |
| hangar | Ready Room | 170 | 25.4118 s | Hangar / campaign map, 170 BPM felt as 85, F major. Chilled liquid halftime: vibraphone and alto sax, brushed break, upright bass, crackly 78 rpm tone. |
| sting_clear | Mission Accomplished | 172 | 4.203 s | Victory stinger: brass fanfare resolving to D major, cymbal swell (about 4 s). |
| sting_gameover | Missing in Action | 172 | 5.016 s | Game-over stinger: descending muted trumpet over a low string chord and a fading break (about 5 s). |

## Flight model

Two modes, switchable on the title screen and remembered between sessions.

**2D** - the classic top-down shooter. Every aircraft sits on one plane; altitude is decoration.

**3D** - altitude is a real axis. `E` climbs, `C` dives (0 to 7,800 ft on the tape at the right edge).
On touch, hold the steering finger still for a moment and then slide up or down - a quick drag still
steers as normal, and a second finger is still the loop-roll.

| | behaviour |
| --- | --- |
| Guns | only reach targets within 15 units of your own height - climb into the fighters or you miss |
| Bombs | ballistic: fall time scales with release altitude, so the higher you are the further ahead you release |
| Torpedoes | always run on the water, whatever height you drop from |
| Fighters | patrol high, around 55-66 |
| Bombers | mid, around 35-45 |
| Ships | sea level |

Flying low makes bombing accurate and puts you inside ship AA. Flying high keeps you clear of the
guns but leaves the ships almost impossible to hit.
