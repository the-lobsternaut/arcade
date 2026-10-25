"""assets/pack.bin - every portrait, every clip and all of the dialog in one file.

The pack is where these live, on disk as well as in the game: there are no loose avatar files
between edits. To change something, unpack it, edit, pack it again.

    python3 tools/packassets.py pack        # build pack.bin and remove the loose sources
    python3 tools/packassets.py unpack      # write the sources back out so you can edit them
    python3 tools/packassets.py list        # what is in the pack

tools/addportrait.py does the whole cycle for you when adding or replacing an avatar.

Layout - a magic, a JSON table of contents, then the payloads end to end:

    "FTD1"             4 bytes
    u32 little endian  length of the table of contents
    table of contents  utf-8 JSON  { "<name>": [offset, length, "<mime>"], ... }
    payloads           concatenated, offsets relative to the end of the table

One request fetches the lot and the loader slices it into blobs, so the game never asks for an
individual avatar again.
"""
import json, pathlib, shutil, struct, subprocess, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
PACK = ROOT / 'assets' / 'pack.bin'
SRC = ROOT / 'assets' / 'portraits'          # only exists while unpacked
DIALOG = ROOT / 'assets' / 'dialog.json'     # only exists while unpacked
MAGIC = b'FTD1'


def read():
    raw = PACK.read_bytes()
    if raw[:4] != MAGIC:
        sys.exit('not a pack: %s' % PACK)
    n = struct.unpack('<I', raw[4:8])[0]
    return raw, 8 + n, json.loads(raw[8:8 + n])


def pack():
    entries, blobs, off = {}, [], 0

    def add(name, data, mime):
        nonlocal off
        entries[name] = [off, len(data), mime]
        blobs.append(data)
        off += len(data)

    if not DIALOG.exists():
        sys.exit('no %s - run "unpack" first, edit, then pack again' % DIALOG.relative_to(ROOT))
    dialog = DIALOG.read_bytes()
    json.loads(dialog)                                  # refuse to ship dialog that will not parse
    add('dialog', dialog, 'application/json')

    man_path = SRC / 'index.json'
    man = json.loads(man_path.read_text()) if man_path.exists() else {}
    add('manifest', json.dumps(man, sort_keys=True).encode(), 'application/json')

    for cid in sorted(man):
        for fname, key, mime in (('full.webp', 'portrait/', 'image/webp'),
                                 ('full.mp4', 'video/', 'video/mp4')):
            f = SRC / cid / fname
            if f.exists():
                add(key + cid, f.read_bytes(), mime)

    toc = json.dumps(entries, sort_keys=True, separators=(',', ':')).encode()
    PACK.write_bytes(MAGIC + struct.pack('<I', len(toc)) + toc + b''.join(blobs))

    # the pack is the storage, so the loose copies go
    if SRC.exists():
        shutil.rmtree(SRC)
    if DIALOG.exists():
        DIALOG.unlink()
    subprocess.run([sys.executable, str(ROOT / 'tools' / 'stamp.py')], check=True)
    print('pack.bin: %d entries, %d KB' % (len(entries), PACK.stat().st_size // 1024))


def unpack():
    raw, base, toc = read()
    SRC.mkdir(parents=True, exist_ok=True)
    for k, (o, l, m) in toc.items():
        data = raw[base + o: base + o + l]
        if k == 'dialog':
            DIALOG.write_bytes(data)
        elif k == 'manifest':
            (SRC / 'index.json').write_bytes(data)
        else:
            kind, cid = k.split('/', 1)
            d = SRC / cid
            d.mkdir(parents=True, exist_ok=True)
            (d / ('full.mp4' if kind == 'video' else 'full.webp')).write_bytes(data)
    print('unpacked %d entries' % len(toc))


def main(argv):
    cmd = argv[0] if argv else 'list'
    if cmd == 'pack':
        pack()
    elif cmd == 'unpack':
        unpack()
    elif cmd == 'list':
        _, _, toc = read()
        for k in sorted(toc):
            o, l, m = toc[k]
            print('%-26s %9d bytes  %s' % (k, l, m))
        print('\n%d entries, %d KB' % (len(toc), PACK.stat().st_size // 1024))
    else:
        sys.exit(__doc__)


if __name__ == '__main__':
    main(sys.argv[1:])
