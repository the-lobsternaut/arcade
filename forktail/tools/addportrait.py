"""Drop a finished portrait illustration in for a character.

    python3 tools/addportrait.py <character-id> <image-or-video> [face]

The portrait engine authors layers in a 1024x1536 space; a single finished picture goes in as the
'full' part, which the engine draws on its own with nothing generated over it. This resizes to that
space, writes assets/portraits/<id>/full.webp, records the part in index.json and re-stamps so the
new art is actually fetched instead of served from cache.
"""
import json, pathlib, subprocess, sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

ROOT = pathlib.Path(__file__).resolve().parent.parent
VW, VH = 1024, 1536

def main(cid, src, face=None):
    # the pack is the storage: open it, make the change, seal it again
    import packassets
    if not (ROOT / 'assets' / 'portraits').exists():
        packassets.unpack()
    src = pathlib.Path(src).expanduser()
    if not src.is_file():
        sys.exit('no such image: %s' % src)
    ids = {c['id'] for c in known()}
    if ids and cid not in ids:
        sys.exit('unknown character id %r - known: %s' % (cid, ', '.join(sorted(ids))))
    out = ROOT / 'assets' / 'portraits' / cid
    out.mkdir(parents=True, exist_ok=True)
    dest = out / 'full.webp'
    if src.suffix.lower() in ('.mp4', '.mov', '.webm', '.m4v'):
        return video(cid, src, out, face)
    cw, ch = size(src)
    # Crop to the frame's shape before resizing. Scaling a 0.70 picture into a 0.667 frame squashes
    # every face in it by five percent, which reads as a slightly wrong person rather than as a
    # crop. Too wide loses equal slivers off both sides; too tall loses the bottom, because the
    # head is the part that has to stay.
    args = []
    if abs(cw / ch - VW / VH) > 0.002:
        if cw / ch > VW / VH:
            w = round(ch * VW / VH); args = ['-crop', str((cw - w) // 2), '0', str(w), str(ch)]
        else:
            h = round(cw * VH / VW); args = ['-crop', '0', '0', str(cw), str(h)]
    subprocess.run(['cwebp', '-q', '86'] + args + ['-resize', str(VW), str(VH), str(src), '-o', str(dest)],
                   check=True, capture_output=True)
    if args:
        print('cropped %dx%d -> %sx%s before the resize (frame is %.4f, art was %.4f)'
              % (cw, ch, args[3], args[4], VW / VH, cw / ch))
    # `face` is how far down the picture the eyes sit, 0..1. Only pass it when the head crop misses:
    # the default assumes a figure standing square with her face in the upper fifth, and a posed or
    # turned-away figure sits lower than that.
    record(cid, face)
    __import__('packassets').pack()
    print('%s -> %s (%d KB)' % (cid, dest.relative_to(ROOT), dest.stat().st_size // 1024))

VID_W, VID_H = 640, 960          # the portrait slot is 230 CSS px at most, so this is already oversampled

def video(cid, src, out, face):
    """A clip instead of a picture: the engine plays it while she has a line and parks it on the
    first frame when she does not, so the first frame wants her mouth shut. Audio is dropped - the
    game has its own, and a portrait that talks over it would be unusable."""
    import json as _json
    pr = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0',
                         '-show_entries', 'stream=width,height', '-of', 'json', str(src)],
                        check=True, capture_output=True, text=True)
    st = _json.loads(pr.stdout)['streams'][0]
    cw, ch = st['width'], st['height']
    if cw / ch > VW / VH:
        w = (round(ch * VW / VH) // 2) * 2; crop = 'crop=%d:%d:%d:0' % (w, ch, (cw - w) // 2)
    else:
        h = (round(cw * VH / VW) // 2) * 2; crop = 'crop=%d:%d:0:0' % (cw, h)
    vf = '%s,scale=%d:%d' % (crop, VID_W, VID_H)
    mp4 = out / 'full.mp4'
    subprocess.run(['ffmpeg', '-v', 'error', '-i', str(src), '-an', '-vf', vf,
                    '-c:v', 'libx264', '-profile:v', 'main', '-pix_fmt', 'yuv420p',
                    '-crf', '28', '-preset', 'slow', '-movflags', '+faststart',
                    '-y', str(mp4)], check=True, capture_output=True)
    if has_audio(mp4):
        sys.exit('audio survived the encode - refusing to ship it')
    # a still of the first frame, for a browser that will not play the clip
    still = out / 'full.webp'
    # via PNG: this ffmpeg has no webp encoder, and cwebp is already a dependency
    import tempfile
    with tempfile.TemporaryDirectory() as td:
        png = pathlib.Path(td) / 'f0.png'
        subprocess.run(['ffmpeg', '-v', 'error', '-i', str(src), '-frames:v', '1',
                        '-vf', '%s,scale=%d:%d' % (crop, VW, VH), '-y', str(png)],
                       check=True, capture_output=True)
        subprocess.run(['cwebp', '-q', '86', str(png), '-o', str(still)],
                       check=True, capture_output=True)
    record(cid, face, video=True)
    __import__('packassets').pack()
    print('%s -> %s (%d KB video, %d KB still fallback), audio stripped'
          % (cid, mp4.relative_to(ROOT), mp4.stat().st_size // 1024, still.stat().st_size // 1024))

def has_audio(path):
    out = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'a',
                          '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', str(path)],
                         check=True, capture_output=True, text=True).stdout
    return 'audio' in out

def record(cid, face, video=False):
    man_path = ROOT / 'assets' / 'portraits' / 'index.json'
    man = json.loads(man_path.read_text() or '{}')
    if face is None and not video:
        man[cid] = ['full']
    else:
        e = {'parts': ['full']}
        if face is not None:
            e['face'] = round(face, 3)
        if video:
            e['video'] = True
        man[cid] = e
    man_path.write_text(json.dumps(man, sort_keys=True) + '\n')

def size(path):
    out = subprocess.run(['sips', '-g', 'pixelWidth', '-g', 'pixelHeight', str(path)],
                         check=True, capture_output=True, text=True).stdout
    d = dict(l.strip().split(': ') for l in out.splitlines() if ': ' in l)
    return int(d['pixelWidth']), int(d['pixelHeight'])

def known():
    """Character ids out of js/story.js, so a typo is caught here rather than at runtime."""
    import re
    txt = (ROOT / 'js' / 'story.js').read_text()
    return [{'id': m} for m in re.findall(r"\{\s*id: '([a-z]+)', country:", txt)] + [{'id': 'halo'}]

if __name__ == '__main__':
    if len(sys.argv) not in (3, 4):
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2], float(sys.argv[3]) if len(sys.argv) == 4 else None)
