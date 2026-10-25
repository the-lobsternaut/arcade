/* Fork-Tailed Devil - real coastlines for the battles.

   Levels used to scroll two random island sprites past. These are the actual places, laid out in
   playfield coordinates: x across the 270-unit field, y increasing north, so a map is drawn the
   way the player flies over it.

   A map is polygons, not a picture. The renderer triangulates each one once in these coordinates
   and then maps the vertices through the camera every frame, so the land sits exactly where the
   gameplay says it does at any camera tilt - a ship moored off a point is off that point whether
   you are looking straight down or along the deck.

   `at` is the scroll distance when the map's y=0 crosses the bottom of the screen. Pearl is 0:
   you are over the harbour from the first second, which is the whole point of that one.

   These are hand-authored from the real layout rather than traced from survey data. The shapes
   are right - the channel, Ford Island in the middle of the basin, the three lochs, the Waipio
   Peninsula between West and Middle - but do not navigate by them. */

export const MAPS = {
  // Pearl Harbor, 7 Dec 1941. Flying north up the channel from the open sea: the harbour mouth,
  // then the basin opens out with Ford Island in the middle of it and Battleship Row along its
  // south-east shore, where the moorings actually were.
  pearl: {
    at: 150,   // the mouth is ahead of you at the first frame, the basin a few seconds north
    name: 'Pearl Harbor',
    // One landmass. The channel splits the south shore but the two sides join again across the
    // north, so the coast is a single path: west shore, up the channel, round the basin and all
    // three lochs, back down the far bank, and out around the outside.
    land: [[
      [-30, 86], [118, 86], [117, 150], [115, 196],
      [96, 206], [74, 230], [62, 262], [58, 300],          // basin, west side
      [46, 320], [40, 362], [48, 410], [64, 426],          // West Loch
      [82, 414], [90, 372], [86, 330], [98, 314],          // Waipio Peninsula, west side and tip
      [106, 332], [110, 374], [120, 426],                  // Middle Loch, west shore
      [142, 442], [162, 430], [166, 386], [158, 338], [152, 310],
      [164, 296],                                          // point between Middle and East Loch
      [176, 318], [194, 350], [214, 384], [232, 392],      // East Loch
      [238, 360], [226, 320], [208, 288], [198, 262],
      [194, 230], [178, 208], [154, 198],                  // basin, east side
      [152, 150], [150, 86],                               // channel, east bank
      [300, 86], [300, 468], [250, 498], [202, 516], [152, 506], [104, 520], [48, 500], [-30, 482],
    ]],
    // Ford Island, in the middle of the basin.
    isles: [[
      [102, 250], [116, 240], [140, 236], [162, 240], [174, 250],
      [170, 264], [150, 272], [124, 272], [106, 264],
    ]],
    // Battleship Row: moored along Ford Island's south-east shore, burning when you arrive.
    wrecks: [
      { x: 112, y: 280, a: 0.22, s: 1.0 },
      { x: 130, y: 284, a: 0.18, s: 1.1 },
      { x: 148, y: 283, a: 0.14, s: 1.0 },
      { x: 164, y: 278, a: 0.10, s: 0.9 },
    ],
  },
};

export function mapFor(levelId) {
  return MAPS[levelId] || null;
}
