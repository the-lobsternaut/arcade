#!/usr/bin/env python3
"""Fork-Tailed Devil - static file server + save API (Python 3 standard library only).

Usage:  python3 server.py --port 8091 --bind 0.0.0.0 [--root DIR] [--saves DIR]

  GET  /api/saves             -> {"slots":[{"slot","savedAt","mtime","size","backups"}]}
  GET  /api/save?slot=NAME    -> stored JSON (204 No Content if the slot is empty)
  PUT  /api/save?slot=NAME    -> store JSON body (max 2 MB). POST is accepted too (navigator.sendBeacon).
Slot names: 1-32 chars of A-Z a-z 0-9 _ -. Writes are atomic (temp file + os.replace); the last 5 versions are kept in saves/backups/.
"""
import argparse, datetime, http.server, json, os, re, shutil, socketserver, sys, tempfile, threading, urllib.parse

WRITE_LOCK = threading.Lock()  # serialize writes + backup rotation across request threads

MAX_BODY = 2 * 1024 * 1024
KEEP_BACKUPS = 5
SLOT_RE = re.compile(r'^[A-Za-z0-9_-]{1,32}$')
MIME = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
    '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
    '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream',
    '.m4a': 'audio/mp4', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
}
NO_CACHE = ('.html', '.js', '.mjs', '.css', '.webmanifest')


def make_handler(root, saves):
    backups = os.path.join(saves, 'backups')
    os.makedirs(backups, exist_ok=True)

    class H(http.server.SimpleHTTPRequestHandler):
        server_version = 'ForkTailedDevil/1.0'
        extensions_map = dict(http.server.SimpleHTTPRequestHandler.extensions_map, **MIME)

        def __init__(self, *a, **k):
            super().__init__(*a, directory=root, **k)

        def log_message(self, fmt, *args):
            sys.stderr.write('%s - %s\n' % (self.address_string(), fmt % args))

        # ---- static
        def end_headers(self):
            p = urllib.parse.urlsplit(self.path).path
            if p.startswith('/api/') or p.endswith('/') or p.endswith(NO_CACHE):
                self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
            self.send_header('X-Content-Type-Options', 'nosniff')
            super().end_headers()

        def guess_type(self, path):
            ext = os.path.splitext(path)[1].lower()
            return MIME.get(ext) or super().guess_type(path)

        def list_directory(self, path):
            self.send_error(403, 'Directory listing disabled')
            return None

        def translate_path(self, path):
            p = super().translate_path(path)
            rp = os.path.realpath(p)
            if rp != root and not rp.startswith(root + os.sep):
                return os.path.join(root, '__forbidden__')
            if os.path.relpath(rp, root).split(os.sep)[0] in ('saves',) or os.path.basename(rp) == 'server.py':
                return os.path.join(root, '__forbidden__')
            return p

        # ---- api helpers
        def _json(self, code, obj):
            b = json.dumps(obj).encode('utf-8')
            self.send_response(code)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(b)))
            self.end_headers()
            self.wfile.write(b)

        def _slot(self, q):
            vals = urllib.parse.parse_qs(q).get('slot', ['pilot1'])
            s = vals[0] if vals else ''
            if not SLOT_RE.match(s):
                return None
            path = os.path.realpath(os.path.join(saves, s + '.json'))
            if os.path.dirname(path) != saves:
                return None
            return s, path

        def do_GET(self):
            u = urllib.parse.urlsplit(self.path)
            if u.path == '/api/saves':
                out = []
                for f in sorted(os.listdir(saves)):
                    if not f.endswith('.json'):
                        continue
                    fp = os.path.join(saves, f)
                    st = os.stat(fp)
                    saved = None
                    try:
                        with open(fp, 'r', encoding='utf-8') as fh:
                            saved = json.load(fh).get('savedAt')
                    except Exception:
                        pass
                    name = f[:-5]
                    nb = len([b for b in os.listdir(backups) if b.startswith(name + '.')]) if os.path.isdir(backups) else 0
                    out.append({'slot': name, 'savedAt': saved, 'mtime': datetime.datetime.fromtimestamp(st.st_mtime, datetime.timezone.utc).isoformat(), 'size': st.st_size, 'backups': nb})
                return self._json(200, {'slots': out})
            if u.path == '/api/save':
                sp = self._slot(u.query)
                if not sp:
                    return self._json(400, {'error': 'bad slot name'})
                if not os.path.exists(sp[1]):  # 204: empty slot (not an error for the client)
                    self.send_response(204)
                    self.end_headers()
                    return
                with open(sp[1], 'rb') as fh:
                    b = fh.read()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(b)))
                self.end_headers()
                self.wfile.write(b)
                return
            if u.path.startswith('/api/'):
                return self._json(404, {'error': 'unknown endpoint'})
            return super().do_GET()

        def do_HEAD(self):
            if urllib.parse.urlsplit(self.path).path.startswith('/api/'):
                return self._json(405, {'error': 'method not allowed'})
            return super().do_HEAD()

        def _write_save(self, slot, path, obj):
            try:
                os.makedirs(backups, exist_ok=True)
                if os.path.exists(path):  # rotate backups
                    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
                    shutil.copy2(path, os.path.join(backups, '%s.%s.json' % (slot, stamp)))
                    old = sorted(b for b in os.listdir(backups) if b.startswith(slot + '.'))
                    for b in old[:-KEEP_BACKUPS]:
                        try:
                            os.remove(os.path.join(backups, b))
                        except OSError:
                            pass
            except OSError:
                pass  # a failed backup never blocks the save itself
            fd, tmp = tempfile.mkstemp(prefix='.' + slot + '.', suffix='.tmp', dir=saves)
            try:
                with os.fdopen(fd, 'w', encoding='utf-8') as fh:
                    json.dump(obj, fh, separators=(',', ':'))
                    fh.flush()
                    os.fsync(fh.fileno())
                os.replace(tmp, path)
            except Exception as e:
                try:
                    os.remove(tmp)
                except OSError:
                    pass
                return str(e)
            return None

        def _store(self):
            u = urllib.parse.urlsplit(self.path)
            if u.path != '/api/save':
                return self._json(404, {'error': 'unknown endpoint'})
            sp = self._slot(u.query)
            if not sp:
                return self._json(400, {'error': 'bad slot name'})
            try:
                n = int(self.headers.get('Content-Length') or '-1')
            except ValueError:
                n = -1
            if n < 0:
                return self._json(411, {'error': 'length required'})
            if n > MAX_BODY:
                return self._json(413, {'error': 'save too large (max 2 MB)'})
            raw = self.rfile.read(n)
            try:
                obj = json.loads(raw.decode('utf-8'))
            except Exception:
                return self._json(400, {'error': 'invalid JSON'})
            if not isinstance(obj, dict) or obj.get('format') != 'pacific-skies-save' or not isinstance(obj.get('version'), int):
                return self._json(422, {'error': 'not a pacific-skies-save document'})
            slot, path = sp
            with WRITE_LOCK:
                err = self._write_save(slot, path, obj)
            if err:
                return self._json(500, {'error': 'write failed: %s' % err})
            return self._json(200, {'ok': True, 'slot': slot, 'bytes': len(raw)})

        do_PUT = _store
        do_POST = _store

    return H


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def main():
    ap = argparse.ArgumentParser(description='Fork-Tailed Devil static server + save API')
    ap.add_argument('--port', type=int, default=8091)
    ap.add_argument('--bind', default='0.0.0.0')
    here = os.path.dirname(os.path.realpath(__file__))
    ap.add_argument('--root', default=here)
    ap.add_argument('--saves', default=None, help='save directory (default ROOT/saves)')
    a = ap.parse_args()
    root = os.path.realpath(a.root)
    saves = os.path.realpath(a.saves or os.path.join(root, 'saves'))
    os.makedirs(saves, exist_ok=True)
    httpd = Server((a.bind, a.port), make_handler(root, saves))
    print('Fork-Tailed Devil on http://%s:%d/  (root %s, saves %s)' % (a.bind, a.port, root, saves), flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
