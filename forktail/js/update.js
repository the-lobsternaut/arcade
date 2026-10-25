/* Fork-Tailed Devil - keeps an installed copy from going stale.

   Every asset carries a content hash, so the moment index.html is refetched the whole build comes
   with it. In a browser tab that happens by itself: Pages serves max-age=600, so ten minutes later
   the page revalidates and the new hashes pull everything down.

   An app on the home screen does not behave like a tab. Backgrounded, it resumes the page it
   already had without touching the network at all, so it can sit on a build from weeks ago until
   someone force-quits it. Nothing is broken; it simply never asks. So the running page asks for
   itself: version.txt is ten bytes and is the one file deliberately left unstamped, because it is
   the thing being polled. */
(function () {
  'use strict';
  const meta = document.querySelector('meta[name="build"]');
  const BUILD = meta ? meta.content : '';
  if (!BUILD) return;
  const SRC = new URL('version.txt', location.href).href;
  const WAIT = 15 * 60 * 1000;
  let found = null, busy = false, banner = null;

  function check() {
    if (busy || found) return;
    busy = true;
    fetch(SRC + '?t=' + Date.now(), { cache: 'no-store' })
      .then((r) => (r.ok ? r.text() : null))
      .then((t) => {
        const v = t && t.trim();
        if (!v || v === BUILD) return;
        // If we already reloaded for this version and are still on the old build, the new
        // index.html has not reached this device yet. Leave it alone rather than reload forever.
        if (new URL(location.href).searchParams.get('u') === v) return;
        found = v;
        const G = window.SKY && window.SKY.game, st = G && G.state && G.state();
        if (st === 'title' || st === 'loading' || !st) apply();   // nothing to interrupt: just take it
        else show();
      })
      .catch(() => {})                                            // offline: ask again later
      .then(() => { busy = false; });
  }

  function show() {
    if (banner) return;
    banner = document.createElement('button');
    banner.className = 'update';
    banner.textContent = 'NEW VERSION — TAP TO UPDATE';
    banner.addEventListener('click', apply);
    document.body.appendChild(banner);
    requestAnimationFrame(() => banner.classList.add('in'));
  }

  function apply() {
    const S = window.SKY;
    try { if (S && S.game && S.game.saveNow) S.game.saveNow(); } catch (e) {}
    try { if (S && S.saves && S.saves.autosave) S.saves.autosave('update'); } catch (e) {}
    // The hash rides on index.html, so index.html is the file that has to come off the network.
    // A new query guarantees that; the rest of the search string is kept so ?r=2d survives.
    const u = new URL(location.href);
    u.searchParams.set('u', found);
    location.replace(u.href);
  }

  setTimeout(check, 4000);
  setInterval(check, WAIT);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
  window.addEventListener('pageshow', check);     // iOS resumes a home-screen app through here
  window.addEventListener('online', check);
  window.SKY_update = { check, build: () => BUILD, pending: () => found };
})();
