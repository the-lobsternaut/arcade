"""Generate a seamlessly tileable water normal map.

The shipped waternormals.webp does not wrap: its edge-to-edge step is about 1.8x a
typical neighbour step, and because that discontinuity runs dead straight along every
tile boundary the eye picks it out as a grid no matter how the octaves are rotated.
This builds the height field from *periodic* value noise - the lattice index wraps with
a modulo, so the left edge is the right edge by construction - and takes the normal from
wrapped central differences, so the result tiles exactly.
"""
import math, zlib, struct, random

N = 512
random.seed(20241024)

def lattice(freq, seed):
    g = [[random.random() for _ in range(freq)] for _ in range(freq)]
    return g

def smooth(t):
    return t * t * (3 - 2 * t)

def noise_layer(freq, seed):
    """Periodic value noise: indices wrap mod freq, so the field is seamless at N."""
    g = lattice(freq, seed)
    out = [[0.0] * N for _ in range(N)]
    cell = N / freq
    for y in range(N):
        fy = y / cell
        j0 = int(fy) % freq; j1 = (j0 + 1) % freq
        ty = smooth(fy - int(fy))
        for x in range(N):
            fx = x / cell
            i0 = int(fx) % freq; i1 = (i0 + 1) % freq
            tx = smooth(fx - int(fx))
            a = g[j0][i0] + (g[j0][i1] - g[j0][i0]) * tx
            b = g[j1][i0] + (g[j1][i1] - g[j1][i0]) * tx
            out[y][x] = a + (b - a) * ty
    return out

# octaves: amplitude falls as frequency rises, the way a real sea carries chop on swell.
# Every frequency divides 512, so each octave wraps on its own and so does the sum.
OCT = [(4, 1.00), (8, 0.55), (16, 0.30), (32, 0.17), (64, 0.09), (128, 0.05)]
H = [[0.0] * N for _ in range(N)]
for freq, amp in OCT:
    layer = noise_layer(freq, freq)
    for y in range(N):
        row = H[y]; lr = layer[y]
        for x in range(N):
            row[x] += lr[x] * amp

# normalise the height field to 0..1
lo = min(min(r) for r in H); hi = max(max(r) for r in H)
rng = (hi - lo) or 1.0
for y in range(N):
    row = H[y]
    for x in range(N):
        row[x] = (row[x] - lo) / rng

# normal from wrapped central differences. STRENGTH sets how steep the waves read;
# the shader scales it again through uNScale.
STRENGTH = 2.6
px = bytearray()
for y in range(N):
    px.append(0)  # PNG filter byte: none
    ym = H[(y - 1) % N]; yp = H[(y + 1) % N]; yc = H[y]
    for x in range(N):
        dx = (yc[(x + 1) % N] - yc[(x - 1) % N]) * STRENGTH
        dy = (yp[x] - ym[x]) * STRENGTH
        nx, ny, nz = -dx, -dy, 1.0
        inv = 1.0 / math.sqrt(nx * nx + ny * ny + nz * nz)
        px.append(int(max(0, min(255, round((nx * inv * 0.5 + 0.5) * 255)))))
        px.append(int(max(0, min(255, round((ny * inv * 0.5 + 0.5) * 255)))))
        px.append(int(max(0, min(255, round((nz * inv * 0.5 + 0.5) * 255)))))

def chunk(tag, data):
    return (struct.pack('>I', len(data)) + tag + data
            + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff))

png = (b'\x89PNG\r\n\x1a\n'
       + chunk(b'IHDR', struct.pack('>IIBBBBB', N, N, 8, 2, 0, 0, 0))
       + chunk(b'IDAT', zlib.compress(bytes(px), 9))
       + chunk(b'IEND', b''))

out = '/Users/lobsternaut/software/arcade/forktail/assets/tex/waternormals.png'
open(out, 'wb').write(png)
print('wrote', out, len(png), 'bytes')

# prove it wraps: compare the edge-to-edge step against a typical interior step
def step(a, b):
    return sum(abs(a[i] - b[i]) for i in range(2)) / 1.0
def row(y):
    o = (y * (N * 3 + 1)) + 1
    return [px[o + x * 3: o + x * 3 + 3] for x in range(N)]
tot_wrap = tot_in = 0
for y in range(N):
    r = row(y)
    tot_wrap += step(r[0], r[N - 1])
    tot_in += step(r[200], r[201])
print('horizontal wrap step %.2f vs interior %.2f' % (tot_wrap / N, tot_in / N))
cols_w = cols_i = 0
r0, rl, ra, rb = row(0), row(N - 1), row(200), row(201)
for x in range(N):
    cols_w += step(r0[x], rl[x]); cols_i += step(ra[x], rb[x])
print('vertical   wrap step %.2f vs interior %.2f' % (cols_w / N, cols_i / N))
