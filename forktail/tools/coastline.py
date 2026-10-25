"""Turn a real coastline into a playfield map.

    curl -A "forktail-dev/1.0" --data-urlencode \
      'data=[out:json][timeout:60];(way["natural"="coastline"](S,W,N,E););out geom;' \
      https://overpass-api.de/api/interpreter -o p3.json
    python3 tools/coastline.py        # writes the polygon blocks for js/terrain.js

Stitches the OSM ways into runs, projects them into playfield units (aspect preserved),
simplifies with Douglas-Peucker, and separates closed rings as islands. LON0/LAT0/OX/OY
frame the result; run it, look at the printed bbox, and nudge them until the feature you
care about sits where you want it on the 270-wide field.

Map data (c) OpenStreetMap contributors, ODbL.
"""
import json, math

d = json.load(open('p3.json'))
ways = [w['geometry'] for w in d['elements'] if w.get('geometry')]
P = lambda g: (round(g['lon'], 7), round(g['lat'], 7))
segs = [[P(p) for p in g] for g in ways]
changed = True
while changed:
    changed = False
    for i in range(len(segs)):
        if not segs[i]: continue
        for j in range(len(segs)):
            if i == j or not segs[j]: continue
            a, b = segs[i], segs[j]
            if a[-1] == b[0]:  a.extend(b[1:]); segs[j] = []; changed = True
            elif a[-1] == b[-1]: a.extend(b[::-1][1:]); segs[j] = []; changed = True
            elif a[0] == b[-1]: segs[i] = b[:-1] + a; segs[j] = []; changed = True
            elif a[0] == b[0]:  segs[i] = b[::-1][:-1] + a; segs[j] = []; changed = True
segs = [s for s in segs if len(s) > 3]

# ---- projection: the harbour across the 270-unit field, north up, aspect preserved
LON0, LON1 = -158.015, -157.930          # the window the harbour sits in
LATC = 21.36
MPD_LON = 111320 * math.cos(math.radians(LATC))
MPD_LAT = 110540
MPU = (LON1 - LON0) * MPD_LON / 270.0    # metres per playfield unit
LAT0 = 21.330
OX, OY = -43.0, 145.0                    # slide the harbour into the middle of the field
def proj(p):
    return ((p[0] - LON0) * MPD_LON / MPU + OX, (p[1] - LAT0) * MPD_LAT / MPU + OY)

def rdp(pts, eps):
    if len(pts) < 3: return pts
    dmax, idx = 0.0, 0
    x1, y1 = pts[0]; x2, y2 = pts[-1]
    dx, dy = x2 - x1, y2 - y1
    L2 = dx*dx + dy*dy or 1e-9
    for i in range(1, len(pts) - 1):
        x, y = pts[i]
        t = max(0.0, min(1.0, ((x-x1)*dx + (y-y1)*dy) / L2))
        d = math.hypot(x - (x1 + t*dx), y - (y1 + t*dy))
        if d > dmax: dmax, idx = d, i
    if dmax <= eps: return [pts[0], pts[-1]]
    return rdp(pts[:idx+1], eps)[:-1] + rdp(pts[idx:], eps)

X0, X1, Y0, Y1 = -40, 310, -40, 620      # a little overscan past the field

# every open run is a stretch of mainland coast; take them all, west to east, and join
opens = [s for s in segs if s[0] != s[-1]]
runs = []
for r in opens:
    q = [proj(p) for p in r]
    if q[0][0] > q[-1][0]: q = q[::-1]
    q = [p for p in q if X0 - 80 <= p[0] <= X1 + 80 and p[1] <= Y1]
    if len(q) > 3: runs.append(q)
runs.sort(key=lambda q: q[0][0])
band = []
for q in runs: band.extend(q)
main = max(segs, key=len)
band = rdp(band, 1.0)
# close it across the top: everything north of the coast is Oahu
land = band + [(band[-1][0], Y1), (X0, Y1)] if band else []
if land: land.append((X0, band[0][1]))

isles = []
for s in segs:
    if s is main or s[0] != s[-1]: continue
    q = [proj(p) for p in s]
    xs = [p[0] for p in q]; ys = [p[1] for p in q]
    if min(xs) < X0 or max(xs) > X1 or min(ys) < Y0 or max(ys) > Y1: continue
    area = abs(sum(q[i][0]*q[(i+1) % len(q)][1] - q[(i+1) % len(q)][0]*q[i][1] for i in range(len(q)))) / 2
    if area < 12: continue
    isles.append((area, rdp(q, 0.8)))
isles.sort(reverse=True, key=lambda t: t[0])

def fmt(poly, per=6):
    out, line = [], []
    for i, (x, y) in enumerate(poly):
        line.append('[%.1f, %.1f]' % (x, y))
        if len(line) == per: out.append('      ' + ', '.join(line) + ','); line = []
    if line: out.append('      ' + ', '.join(line) + ',')
    return '\n'.join(out)

xs=[p[0] for p in band]; ys=[p[1] for p in band]
print('coast bbox x %.0f..%.0f  y %.0f..%.0f' % (min(xs), max(xs), min(ys), max(ys)))
print('MAINLAND points:', len(land))
for a, p in isles: print('  isle area %.0f  points %d  centre (%.0f, %.0f)' % (
    a, len(p), sum(q[0] for q in p)/len(p), sum(q[1] for q in p)/len(p)))

open('pearl_land.txt','w').write(fmt(land))
open('pearl_isles.txt','w').write('\n    ], [\n'.join(fmt(p) for _, p in isles))
