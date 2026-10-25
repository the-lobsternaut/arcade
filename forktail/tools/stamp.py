"""Stamp a content hash onto every local asset URL in index.html.

GitHub Pages serves with `cache-control: max-age=600` and the script tags carried no version,
so a browser that had the page open kept running the old JS after a deploy - which looks exactly
like the deploy not happening. index.html itself still expires in ten minutes, but once it is
refetched the ?v= on each asset forces every changed file to be refetched with it.
"""
import hashlib, pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
INDEX = ROOT / 'index.html'

# every local file the page pulls in, in a fixed order so the hash is deterministic.
# assets/pack.bin is in here because js/boot.js fetches it with this same ?v= on it: leave it out
# and adding an avatar changes no hash, the pack comes from cache, and the new art is never seen.
TRACKED = sorted(
    p for p in list(ROOT.glob('js/*.js')) + list(ROOT.glob('js/vendor/*.js'))
      + list(ROOT.glob('assets/*.js')) + list(ROOT.glob('assets/music/*.js'))
      + list(ROOT.glob('assets/pack.bin'))
      + [ROOT / 'style.css']
    if p.is_file()
)

h = hashlib.sha256()
for p in TRACKED:
    h.update(p.relative_to(ROOT).as_posix().encode())
    h.update(p.read_bytes())
ver = h.hexdigest()[:10]

# version.txt is what an installed copy polls to notice a new build, so it is deliberately NOT in
# TRACKED: it cannot contain the hash of a set of files that includes itself, and it must be
# fetched unstamped or it would be as stale as the thing it is meant to detect.
(ROOT / 'version.txt').write_text(ver + '\n')

html = INDEX.read_text()
# the running page needs to know which build it is; everything else is stamped, this is declared
if re.search(r'<meta name="build" content="[^"]*">', html):
    html = re.sub(r'<meta name="build" content="[^"]*">', '<meta name="build" content="%s">' % ver, html)
else:
    html = html.replace('<meta charset="utf-8">', '<meta charset="utf-8">\n<meta name="build" content="%s">' % ver, 1)
# add or replace ?v=... on local src/href attributes (skip absolute URLs and data: URIs)
def stamp(m):
    attr, url = m.group(1), m.group(2)
    if url.startswith(('http://', 'https://', 'data:', '//', '#')):
        return m.group(0)
    base = url.split('?', 1)[0]
    return '%s="%s?v=%s"' % (attr, base, ver)

new = re.sub(r'\b(src|href)="([^"]+)"', stamp, html)
if new != html:
    INDEX.write_text(new)
print('version', ver, '-', len(TRACKED), 'files tracked', '-', 'index.html updated' if new != html else 'already current')
