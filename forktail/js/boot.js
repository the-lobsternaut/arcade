/* Fork-Tailed Devil - fetches assets/pack.bin, then starts the game.

   Every avatar, every clip and all of the dialog live in one file. The game's scripts are classic
   and run top to bottom, and story.js wants its tables the moment it is parsed, so the pack has to
   be in hand before any of them run - which is why the page loads this and this loads the rest.

   Pack layout: "FTD1", a u32 little-endian table-of-contents length, the table as JSON
   ({ name: [offset, length, mime] }, offsets relative to the end of the table), then the payloads
   end to end. Slices become blobs on demand, so nothing is copied until something asks for it. */
(function () {
  'use strict';
  window.SKY = window.SKY || {};
  const S = window.SKY;
  const meta = document.querySelector('meta[name="build"]');
  const q = meta && meta.content ? '?v=' + meta.content : '';
  const SCRIPTS = ['assets/music/tracks.js', 'js/audio.js', 'assets/meta.js', 'assets/meta3d.js',
                   'js/sprites.js', 'js/story.js', 'js/saves.js', 'js/game.js', 'js/ui.js',
                   'js/main.js', 'js/update.js'];

  function openPack(buf) {
    const u8 = new Uint8Array(buf), dv = new DataView(buf);
    if (u8[0] !== 70 || u8[1] !== 84 || u8[2] !== 68 || u8[3] !== 49) throw new Error('not a pack');
    const n = dv.getUint32(4, true), dec = new TextDecoder();
    const toc = JSON.parse(dec.decode(u8.subarray(8, 8 + n))), base = 8 + n;
    const urls = {};
    const slice = (k) => { const e = toc[k]; return e ? u8.subarray(base + e[0], base + e[0] + e[1]) : null; };
    return {
      has: (k) => !!toc[k],
      keys: () => Object.keys(toc),
      json: (k) => { const b = slice(k); return b ? JSON.parse(dec.decode(b)) : null; },
      // one object URL per entry, made the first time it is wanted and kept for the page's life
      url: (k) => {
        if (urls[k]) return urls[k];
        const e = toc[k]; if (!e) return null;
        return (urls[k] = URL.createObjectURL(new Blob([slice(k)], { type: e[2] })));
      },
    };
  }

  function run(i) {
    if (i >= SCRIPTS.length) {
      const m = document.createElement('script');
      m.type = 'module'; m.src = 'js/boot3d.js' + q;
      document.head.appendChild(m);
      return;
    }
    const el = document.createElement('script');
    el.src = SCRIPTS[i] + q;
    el.onload = () => run(i + 1);
    el.onerror = () => { console.error('failed to load', SCRIPTS[i]); run(i + 1); };
    document.head.appendChild(el);
  }

  fetch('assets/pack.bin' + q)
    .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error('pack ' + r.status))))
    .then((buf) => { S.pack = openPack(buf); })
    .catch((e) => { console.error('asset pack unavailable', e); S.pack = null; })
    .then(() => run(0));
})();
