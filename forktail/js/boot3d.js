/* Fork-Tailed Devil - WebGL boot: loads three.js modules lazily; falls back to the Canvas-2D renderer when WebGL is missing or fails. */
const S = window.SKY;
const field = document.getElementById('field');
function webglOK() {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch (e) { return false; }
}
// Carry this file's own ?v= onto the modules it pulls in. index.html stamps a content hash on
// every script tag, but a dynamic import is a separate request the stamp never reached, so the
// renderer could stay cached at an old version while everything around it updated.
const V = (import.meta.url.split('?')[1] || '').replace(/^v=/, '');
const q = V ? '?v=' + V : '';
const params = new URLSearchParams(location.search);
if (params.get('r') === '2d' || !webglOK()) field.classList.add('no3d');
else {
  import('./render3d.js' + q).then((m) => {
    try {
      const r = m.createRenderer(document.getElementById('gl'), S);
      S.r3d = r; S.game.r3d = r; if (S.relayout) S.relayout();
    } catch (e) { console.warn('WebGL renderer failed, using 2D', e); field.classList.add('no3d'); return; }
  }).catch((e) => { console.warn('WebGL modules failed, using 2D', e); field.classList.add('no3d'); });
}
// portraits are Canvas-2D, so they work with or without WebGL
import('./portraits.js' + q).then((c) => { try { S.chars = c.createChars(S); } catch (e) { console.warn('portraits unavailable', e); } }).catch((e) => console.warn(e));
// the campaign map keeps its own small WebGL context, so it loads even when the game runs the 2D renderer (?r=2d)
if (webglOK()) {
  import('./map3d.js' + q).then((c) => { try { S.map3d = c.createMap(S); if (S.ui && S.ui.open && S.ui.open.classList.contains('map') && S.ui.openMap) S.ui.openMap(); } catch (e) { console.warn('3D map unavailable', e); } }).catch((e) => console.warn(e));
}
