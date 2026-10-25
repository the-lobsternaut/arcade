/* Fork-Tailed Devil - save system: local autosave, versioned export/import, optional server sync (server.py /api/save). */
window.SKY = window.SKY || {};
(function (S) {
  'use strict';
  const FORMAT = 'pacific-skies-save', VERSION = 4;
  const K_RUN = 'sky1943.run', K_DOSSIER = 'sky1943.dossier', K_HI = 'sky1943.hi', K_SET = 'sky1943.settings', K_SLOT = 'sky1943.slot', K_STAMP = 'sky1943.savedAt';
  const ls = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} },
  };
  const J = (s, d) => { try { const v = JSON.parse(s); return v === null || v === undefined ? d : v; } catch (e) { return d; } };
  const listeners = [];
  const SV = {
    FORMAT, VERSION, online: null, lastStatus: '', slot: ls.get(K_SLOT) || 'pilot1',
    on(fn) { listeners.push(fn); },
  };
  function status(msg, kind) { SV.lastStatus = msg; for (const f of listeners) try { f(msg, kind); } catch (e) {} }

  // ---- dossier (persists across campaigns)
  SV.dossier = () => J(ls.get(K_DOSSIER), []);
  SV.addDossier = (id) => { const d = SV.dossier(); if (d.indexOf(id) < 0) { d.push(id); ls.set(K_DOSSIER, JSON.stringify(d)); return true; } return false; };
  SV.settings = () => J(ls.get(K_SET), {});
  SV.saveSettings = (o) => { ls.set(K_SET, JSON.stringify(Object.assign(SV.settings(), o))); };

  // ---- bundle
  function bundle() {
    const G = S.game;
    const run = G && G.exportRun ? G.exportRun() : J(ls.get(K_RUN), null);
    return {
      format: FORMAT, version: VERSION, savedAt: new Date().toISOString(),
      run: run || null, dossier: SV.dossier(), settings: SV.settings(),
      hiscore: parseInt(ls.get(K_HI) || '0', 10) || 0,
    };
  }
  SV.bundle = bundle;
  // ---- validation + migration (v3 = bare run object from the first hangar build)
  function migrate(o) {
    if (!o || typeof o !== 'object') throw new Error('Not a save file');
    if (!o.format && o.version === 3 && Array.isArray(o.tech)) o = { format: FORMAT, version: 3, savedAt: new Date(0).toISOString(), run: o, dossier: [], settings: {}, hiscore: 0 };
    if (o.format !== FORMAT) throw new Error('Not a Fork-Tailed Devil save');
    if (typeof o.version !== 'number' || o.version > VERSION) throw new Error('Save is from a newer version (' + o.version + ')');
    if (o.version < 4) { // v3 -> v4: campaign map fields
      if (o.run) { o.run.done = o.run.done || {}; o.run.level = o.run.level || 0; o.run.played = o.run.played || 0; o.run.met = o.run.met || []; o.run.version = 3; }
      o.version = 4;
    }
    const r = o.run;
    if (r !== null && r !== undefined) {
      const ok = typeof r === 'object' && typeof r.merit === 'number' && Array.isArray(r.tech) && r.gun && r.bomb && typeof r.copilot === 'string' && Array.isArray(r.unlocked) && Array.isArray(r.wing);
      if (!ok) throw new Error('Save run data is damaged');
      r.merit = Math.max(0, Math.min(1e7, Math.round(r.merit)));
      r.tech = r.tech.filter((t) => typeof t === 'string').slice(0, 64);
      r.done = r.done && typeof r.done === 'object' ? r.done : {};
      r.met = Array.isArray(r.met) ? r.met.filter((t) => typeof t === 'string') : [];
    }
    if (!Array.isArray(o.dossier)) o.dossier = [];
    o.dossier = o.dossier.filter((t) => typeof t === 'string').slice(0, 100);
    if (!o.settings || typeof o.settings !== 'object') o.settings = {};
    o.hiscore = Math.max(0, parseInt(o.hiscore, 10) || 0);
    return o;
  }
  SV.migrate = migrate;
  function apply(o) {
    o = migrate(o);
    const G = S.game;
    if (o.run) { ls.set(K_RUN, JSON.stringify(o.run)); if (G && G.importRun) G.importRun(o.run); } else ls.del(K_RUN);
    const d = SV.dossier(); for (const id of o.dossier) if (d.indexOf(id) < 0) d.push(id); ls.set(K_DOSSIER, JSON.stringify(d));
    ls.set(K_SET, JSON.stringify(o.settings));
    const hi = Math.max(o.hiscore, parseInt(ls.get(K_HI) || '0', 10) || 0); ls.set(K_HI, String(hi));
    ls.set(K_STAMP, o.savedAt || new Date().toISOString());
    if (S.audio && S.audio.applySettings) S.audio.applySettings(o.settings);
    return o;
  }
  SV.apply = apply;

  // ---- export / import files
  SV.exportFile = function () {
    const b = bundle(), d = new Date();
    const name = 'pacific-skies-save-' + d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0') + '.json';
    const blob = new Blob([JSON.stringify(b, null, 1)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    return name;
  };
  SV.importText = function (txt) { let o; try { o = JSON.parse(txt); } catch (e) { throw new Error('File is not valid JSON'); } return apply(o); };
  SV.importFile = (file) => new Promise((res, rej) => {
    if (!file) return rej(new Error('No file'));
    if (file.size > 2 * 1024 * 1024) return rej(new Error('File too large'));
    const fr = new FileReader(); fr.onload = () => { try { res(SV.importText(String(fr.result))); } catch (e) { rej(e); } }; fr.onerror = () => rej(new Error('Could not read file')); fr.readAsText(file);
  });

  // ---- server sync
  const api = (p) => 'api/' + p;
  const okSlot = (s) => /^[A-Za-z0-9_-]{1,32}$/.test(s);
  SV.setSlot = (s) => { s = String(s || '').trim(); if (!okSlot(s)) return false; SV.slot = s; ls.set(K_SLOT, s); return true; };
  function fetchT(url, opt, ms) {
    const c = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const t = setTimeout(() => c && c.abort(), ms || 4000);
    return fetch(url, Object.assign({ cache: 'no-store', signal: c ? c.signal : undefined }, opt || {})).finally(() => clearTimeout(t));
  }
  SV.probe = function () {
    if (location.protocol === 'file:') { SV.online = false; return Promise.resolve(false); }
    return fetchT(api('saves'), {}, 2500).then((r) => { SV.online = r.ok; return r.ok; }, () => { SV.online = false; return false; });
  };
  SV.listSlots = () => fetchT(api('saves')).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  SV.pushServer = function (slot) {
    slot = slot || SV.slot;
    const b = bundle(); ls.set(K_STAMP, b.savedAt);
    if (SV.online === false) { status('Offline, saved locally', 'local'); return Promise.resolve(false); }
    return fetchT(api('save?slot=' + encodeURIComponent(slot)), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) })
      .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); SV.online = true; status('Saved to server', 'server'); return true; })
      .catch(() => { SV.online = false; status('Offline, saved locally', 'local'); return false; });
  };
  SV.pullServer = function (slot) {
    slot = slot || SV.slot;
    return fetchT(api('save?slot=' + encodeURIComponent(slot))).then((r) => { if (r.status === 404 || r.status === 204) return null; if (!r.ok) throw new Error('HTTP ' + r.status); SV.online = true; return r.json(); });
  };
  SV.loadServer = (slot) => SV.pullServer(slot).then((o) => { if (!o) throw new Error('No save in slot "' + (slot || SV.slot) + '"'); return apply(o); });
  // autosave: local always (game.js writes the run), then server when reachable
  let pending = 0;
  SV.autosave = function (why) {
    ls.set(K_STAMP, new Date().toISOString());
    clearTimeout(pending);
    if (why === 'background') return SV.pushBeacon();
    pending = setTimeout(() => SV.pushServer(), 300);
  };
  SV.pushBeacon = function () { // page going to background: sendBeacon cannot PUT, so POST
    if (SV.online === false || !navigator.sendBeacon) { status('Offline, saved locally', 'local'); return false; }
    try { const ok = navigator.sendBeacon(api('save?slot=' + encodeURIComponent(SV.slot)), new Blob([JSON.stringify(bundle())], { type: 'application/json' })); if (ok) status('Saved to server', 'server'); return ok; } catch (e) { return false; }
  };
  // at startup: is there a newer server save than the local one?
  SV.checkNewer = function () {
    return SV.probe().then((on) => {
      if (!on) { status('Offline, saved locally', 'local'); return null; }
      return SV.pullServer().then((o) => {
        if (!o || !o.savedAt) return null;
        const local = ls.get(K_STAMP) || '';
        const hasLocal = !!ls.get(K_RUN);
        if (!hasLocal || o.savedAt > local) return o.run ? o : null;
        return null;
      }, () => null);
    });
  };
  S.saves = SV;
})(window.SKY);
