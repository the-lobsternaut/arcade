"""Draw the app icons from the same shape the game draws on its title screen.

    python3 tools/makeicons.py

The mark is the name made literal: a devil's tail sweeping up into a barb, and the barb is a
twin-boom empennage - two fins with the tailplane across them. "Fork-tailed devil" is what the
Luftwaffe called a P-38, so the joke and the aircraft are the same shape.

The control points below are the ones in js/src/g8_render.js devilMark. Keep them in step, or the
icon on the home screen stops being the logo on the title screen.

Everything here is polygons, so it rasterises with a scanline fill and no image library: sample the
tail's centreline, offset it either side by a width that tapers, and the fins and tailplane are
flat shapes in a frame rotated to wherever the tail ended up pointing. Supersampled for the edges.
"""
import math, pathlib, struct, zlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
TAIL_C = [(14, 97), (38, 86), (26, 62), (54, 32)]       # matches devilMark
SL, SPLAY = 32.0, 0.58                                   # barb length and splay
BG = (0x10, 0x1b, 0x30)
FG = (0xe9, 0xc8, 0x77)
SS = 4                                                   # supersampling factor


def bez(t):
    u = 1 - t
    a, b, c, d = u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t
    return (a * TAIL_C[0][0] + b * TAIL_C[1][0] + c * TAIL_C[2][0] + d * TAIL_C[3][0],
            a * TAIL_C[0][1] + b * TAIL_C[1][1] + c * TAIL_C[2][1] + d * TAIL_C[3][1])


def shapes():
    """The mark as a list of polygons in the 0..100 authoring box."""
    out = []
    # the tail: centreline offset either side by a width that tapers toward the barb
    left, right = [], []
    for i in range(45):
        t = i / 44.0
        x, y = bez(t)
        x2, y2 = bez(min(1.0, t + 0.01))
        x0, y0 = bez(max(0.0, t - 0.01))
        dx, dy = x2 - x0, y2 - y0
        m = math.hypot(dx, dy) or 1.0
        dx, dy = dx / m, dy / m
        w = (12 * (1 - t) * (1 - t) + 3.4 * (1 - t) + 2.4) / 2
        left.append((x - dy * w, y + dx * w))
        right.append((x + dy * w, y - dx * w))
    out.append(left + right[::-1])

    # the barb, in a frame aligned to where the tail is pointing so it reads as attached
    tx, ty = bez(1.0)
    px, py = bez(0.96)
    ang = math.atan2(ty - py, tx - px)
    ca, sa = math.cos(ang), math.sin(ang)
    def Q(u, v):
        return (tx + u * ca - v * sa, ty + u * sa + v * ca)
    ex, ey = math.cos(SPLAY) * SL, math.sin(SPLAY) * SL
    for s in (1, -1):
        out.append([Q(*p) for p in [(-2, s * 3.2), (ex * 0.46, s * (ey * 0.46 + 3.8)),
                                    (ex, s * ey), (ex * 0.72, s * (ey * 0.72 - 2.2)), (1, s * 0.2)]])
    bx, by = ex * 0.47, ey * 0.47
    out.append([Q(*p) for p in [(bx - 2.2, -by - 1.1), (bx + 2.2, -by - 1.1),
                                (bx + 2.2, by + 1.1), (bx - 2.2, by + 1.1)]])
    return out


def coverage(px, cx, cy, r):
    """Fraction of each pixel the mark covers, by scanline-filling at SS times the resolution."""
    n = px * SS
    polys = []
    for poly in shapes():
        polys.append([((cx + (x - 50) * r / 50) * SS, (cy + (y - 50) * r / 50) * SS) for x, y in poly])
    hits = bytearray(n * n)
    for poly in polys:
        ys = [p[1] for p in poly]
        for sy in range(max(0, int(min(ys))), min(n, int(max(ys)) + 1)):
            yc = sy + 0.5
            xs = []
            for i in range(len(poly)):
                x1, y1 = poly[i]
                x2, y2 = poly[(i + 1) % len(poly)]
                if (y1 <= yc < y2) or (y2 <= yc < y1):
                    xs.append(x1 + (yc - y1) * (x2 - x1) / (y2 - y1))
            xs.sort()
            for i in range(0, len(xs) - 1, 2):
                for sx in range(max(0, int(xs[i])), min(n, int(xs[i + 1]) + 1)):
                    if xs[i] <= sx + 0.5 < xs[i + 1]:
                        hits[sy * n + sx] = 1
    cov = [0.0] * (px * px)
    for y in range(px):
        for x in range(px):
            c = 0
            for j in range(SS):
                row = (y * SS + j) * n + x * SS
                for i in range(SS):
                    c += hits[row + i]
            cov[y * px + x] = c / (SS * SS)
    return cov


def png(path, px, cov):
    raw = bytearray()
    for y in range(px):
        raw.append(0)
        for x in range(px):
            a = cov[y * px + x]
            for ch in range(3):
                raw.append(int(BG[ch] + (FG[ch] - BG[ch]) * a + 0.5))
    def chunk(tag, data):
        return (struct.pack('>I', len(data)) + tag + data
                + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff))
    out = (b'\x89PNG\r\n\x1a\n'
           + chunk(b'IHDR', struct.pack('>IIBBBBB', px, px, 8, 2, 0, 0, 0))
           + chunk(b'IDAT', zlib.compress(bytes(raw), 9))
           + chunk(b'IEND', b''))
    path.write_bytes(out)


def main():
    for px, name in ((512, 'icon-512.png'), (192, 'icon-192.png'), (180, 'apple-touch-icon.png')):
        cov = coverage(px, px * 0.50, px * 0.53, px * 0.42)
        p = ROOT / 'icons' / name
        png(p, px, cov)
        print('%-22s %d x %d  %d KB' % (name, px, px, p.stat().st_size // 1024))


if __name__ == '__main__':
    main()
