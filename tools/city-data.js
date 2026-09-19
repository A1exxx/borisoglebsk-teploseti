'use strict';
/**
 * Данные для 3D-сцены варианта 4: здания, улицы, реки, железная дорога и
 * дымовые трубы Борисоглебска из OpenStreetMap (© участники OpenStreetMap,
 * лицензия ODbL — ссылка стоит на первом экране).
 *
 * Сайт в OpenStreetMap не ходит: выгрузка делается один раз и сохраняется
 * готовым файлом.
 *
 *   curl --data-urlencode data@tools/city-query.overpassql \
 *        https://overpass-api.de/api/interpreter -o osm.json
 *   node tools/city-data.js osm.json
 *
 * Пишет два файла: public/data/city.bin (для компьютера, радиус 1,75 км) и
 * public/data/city-lite.bin (для телефона: радиус 1,3 км, без сараев).
 *
 * Формат (little-endian, координаты — целые метры от центра, x — восток,
 * y — север):
 *   заголовок: 'BGT1', u16 версия, u16 резерв, f32 широта центра,
 *              f32 долгота центра, u32 домов, u32 улиц, u32 рек, u32 путей,
 *              u32 труб
 *   дом:  u8 вершин, u8 высота (×0,5 м), u16 путь тепла от трубы (м),
 *         i16 x, i16 y, затем (вершин − 1) × (i8 dx, i8 dy)
 *   улица: u16 вершин, u8 класс (0 — жилая, 1 — магистраль), u8 резерв,
 *          вершины × (i16 x, i16 y, u16 путь тепла)
 *   река, путь: u16 вершин, u8 ширина (м), u8 название (1 — Ворона, 2 — Хопёр),
 *               вершины × (i16 x, i16 y)
 *   труба: i16 x, i16 y
 *
 * «Путь тепла» — расстояние по улицам от ближайшей трубы: по нему в сцене
 * бежит тепловая волна. Это иллюстрация, а не схема тепловых сетей.
 */

const fs = require('fs');
const path = require('path');

const SRC = process.argv[2];
if (!SRC) {
  console.error('Укажите файл выгрузки OpenStreetMap: node tools/city-data.js osm.json');
  process.exit(1);
}
const OUT_DIR = path.resolve(__dirname, '..', 'public', 'data');
const LAT0 = 51.3674;
const LON0 = 42.0853;
const KX = Math.cos((LAT0 * Math.PI) / 180) * 111320;
const KY = 110540;

const osm = JSON.parse(fs.readFileSync(SRC, 'utf8'));
const proj = (g) => [(g.lon - LON0) * KX, (g.lat - LAT0) * KY];

/* ---------- Геометрия ---------- */

function simplify(pts, tol) {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let best = -1;
    let bestD = tol;
    const [ax, ay] = pts[a];
    const [bx, by] = pts[b];
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy);
    for (let i = a + 1; i < b; i++) {
      // у замкнутого контура концы совпадают — тогда меряем до точки
      const d = len < 1e-6
        ? Math.hypot(pts[i][0] - ax, pts[i][1] - ay)
        : Math.abs(dy * pts[i][0] - dx * pts[i][1] + bx * ay - by * ax) / len;
      if (d > bestD) { bestD = d; best = i; }
    }
    if (best !== -1) {
      keep[best] = 1;
      stack.push([a, best], [best, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

function area(ring) {
  let s = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    s += x1 * y2 - x2 * y1;
  }
  return s / 2;
}

function centroid(ring) {
  let x = 0;
  let y = 0;
  for (const p of ring) { x += p[0]; y += p[1]; }
  return [x / ring.length, y / ring.length];
}

/** Высота по этажности, а где её нет — прикидка по площади и форме. */
function heightOf(tags, ring, a) {
  const lv = parseFloat(tags['building:levels']);
  if (lv > 0) return Math.min(60, lv * 3.1 + 1.2);
  const kind = tags.building;
  if (kind === 'apartments' || kind === 'dormitory') return 15.5;
  if (kind === 'church') return 14;
  if (kind === 'garage' || kind === 'garages' || kind === 'shed') return 2.6;
  if (kind === 'storage_tank') return 9;
  if (kind === 'industrial' || kind === 'warehouse') return 8;
  // вытянутый большой дом — скорее всего пятиэтажка
  let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
  for (const [x, y] of ring) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  const w = maxX - minX;
  const h = maxY - minY;
  const aspect = Math.max(w, h) / Math.max(1, Math.min(w, h));
  if (a > 450 && a < 2200 && aspect > 2.3) return 15.5;
  if (a > 2200) return 7.5;
  if (a > 600) return 9;
  if (a > 220) return 6;
  if (a < 45) return 2.6;
  return 4.2;
}

/* ---------- Разбор выгрузки ---------- */

const buildings = [];
const roads = [];
const water = [];
const rails = [];
const sources = [];

for (const el of osm.elements) {
  const t = el.tags || {};
  if (t.man_made === 'chimney') {
    const c = el.center || el;
    if (c.lat) sources.push(proj(c));
    continue;
  }
  if (el.type !== 'way' || !el.geometry) continue;
  const pts = el.geometry.map(proj);
  if (t.building) {
    if (pts.length < 4) continue;
    let ring = pts.slice(0, -1); // без замыкающей вершины
    ring = simplify(ring.concat([ring[0]]), 0.7).slice(0, -1);
    if (ring.length < 3) continue;
    let a = area(ring);
    if (a < 0) { ring.reverse(); a = -a; } // обход против часовой стрелки
    if (a < 12) continue;
    buildings.push({ ring, a, h: heightOf(t, ring, a), c: centroid(ring) });
  } else if (t.highway) {
    const major = /^(trunk|primary|secondary|tertiary)$/.test(t.highway) ? 1 : 0;
    roads.push({ pts, major });
  } else if (t.waterway) {
    const name = t.name === 'Ворона' ? 1 : t.name === 'Хопёр' ? 2 : 0;
    water.push({ pts: simplify(pts, 6), w: 55, name });
  } else if (t.railway) {
    rails.push({ pts: simplify(pts, 3), w: 0 });
  }
}

/* ---------- Путь тепла по улицам от ближайшей трубы ---------- */

const key = (p) => Math.round(p[0] * 2) + ',' + Math.round(p[1] * 2);
const nodes = new Map(); // key -> index
const nodeXY = [];
const adj = [];
function nodeOf(p) {
  const k = key(p);
  let i = nodes.get(k);
  if (i === undefined) {
    i = nodeXY.length;
    nodes.set(k, i);
    nodeXY.push(p);
    adj.push([]);
  }
  return i;
}
for (const r of roads) {
  r.ids = r.pts.map(nodeOf);
  for (let i = 1; i < r.ids.length; i++) {
    const a = r.ids[i - 1];
    const b = r.ids[i];
    const len = Math.hypot(nodeXY[a][0] - nodeXY[b][0], nodeXY[a][1] - nodeXY[b][1]);
    adj[a].push([b, len]);
    adj[b].push([a, len]);
  }
}

// Сетка для поиска ближайшей вершины улицы
const CELL = 60;
const grid = new Map();
nodeXY.forEach((p, i) => {
  const k = Math.floor(p[0] / CELL) + ',' + Math.floor(p[1] / CELL);
  if (!grid.has(k)) grid.set(k, []);
  grid.get(k).push(i);
});
function nearestNode(p, maxRing = 6) {
  const cx = Math.floor(p[0] / CELL);
  const cy = Math.floor(p[1] / CELL);
  let best = -1;
  let bestD = Infinity;
  for (let ring = 0; ring <= maxRing; ring++) {
    for (let gx = cx - ring; gx <= cx + ring; gx++) {
      for (let gy = cy - ring; gy <= cy + ring; gy++) {
        if (Math.max(Math.abs(gx - cx), Math.abs(gy - cy)) !== ring) continue;
        const list = grid.get(gx + ',' + gy);
        if (!list) continue;
        for (const i of list) {
          const d = Math.hypot(nodeXY[i][0] - p[0], nodeXY[i][1] - p[1]);
          if (d < bestD) { bestD = d; best = i; }
        }
      }
    }
    if (best !== -1 && bestD < ring * CELL) break;
  }
  return [best, bestD];
}

const dist = new Float64Array(nodeXY.length).fill(Infinity);
const heap = [];
function push(i, d) {
  heap.push([d, i]);
  let c = heap.length - 1;
  while (c > 0) {
    const p = (c - 1) >> 1;
    if (heap[p][0] <= heap[c][0]) break;
    [heap[p], heap[c]] = [heap[c], heap[p]];
    c = p;
  }
}
function pop() {
  const top = heap[0];
  const last = heap.pop();
  if (heap.length) {
    heap[0] = last;
    let c = 0;
    for (;;) {
      const l = c * 2 + 1;
      const r = l + 1;
      let m = c;
      if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
      if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
      if (m === c) break;
      [heap[m], heap[c]] = [heap[c], heap[m]];
      c = m;
    }
  }
  return top;
}
const liveSources = sources.filter((s) => Math.hypot(s[0], s[1]) < 2400);
for (const s of liveSources) {
  const [n, d] = nearestNode(s, 10);
  if (n !== -1 && d < dist[n]) { dist[n] = d; push(n, d); }
}
while (heap.length) {
  const [d, i] = pop();
  if (d > dist[i]) continue;
  for (const [j, len] of adj[i]) {
    if (d + len < dist[j]) { dist[j] = d + len; push(j, d + len); }
  }
}
// Улицы, до которых по графу не дойти, — по прямой от ближайшей трубы
function fallbackDist(p) {
  let best = Infinity;
  for (const s of liveSources) best = Math.min(best, Math.hypot(s[0] - p[0], s[1] - p[1]) * 1.35);
  return best;
}
nodeXY.forEach((p, i) => { if (!isFinite(dist[i])) dist[i] = fallbackDist(p); });
for (const b of buildings) {
  const [n, d] = nearestNode(b.c, 5);
  b.d = n === -1 ? fallbackDist(b.c) : dist[n] + d;
}

/* ---------- Запись ---------- */

function clipLine(pts, R) {
  // Куски линии внутри круга радиуса R (по вершинам — точности хватает)
  const out = [];
  let cur = [];
  for (const p of pts) {
    if (Math.hypot(p[0], p[1]) <= R) cur.push(p);
    else if (cur.length) { if (cur.length > 1) out.push(cur); cur = []; }
  }
  if (cur.length > 1) out.push(cur);
  return out;
}

function write(file, opt) {
  const chunks = [];
  const bld = buildings.filter((b) => Math.hypot(b.c[0], b.c[1]) <= opt.radius && b.a >= opt.minArea);
  const rd = [];
  for (const r of roads) {
    const withD = r.pts.map((p, i) => [p[0], p[1], dist[r.ids[i]]]);
    for (const part of clipLine(withD, opt.roadRadius)) {
      const simple = simplify(part, 2);
      rd.push({ pts: simple, major: r.major });
    }
  }
  const wt = [];
  for (const w of water) for (const part of clipLine(w.pts, opt.waterRadius)) wt.push({ pts: part, w: w.w, name: w.name });
  const rl = [];
  for (const r of rails) for (const part of clipLine(r.pts, opt.roadRadius)) rl.push({ pts: part, w: 0, name: 0 });
  const src = liveSources.filter((s) => Math.hypot(s[0], s[1]) <= opt.radius);

  const head = Buffer.alloc(36);
  head.write('BGT1', 0, 'ascii');
  head.writeUInt16LE(1, 4);
  head.writeFloatLE(LAT0, 8);
  head.writeFloatLE(LON0, 12);
  head.writeUInt32LE(bld.length, 16);
  head.writeUInt32LE(rd.length, 20);
  head.writeUInt32LE(wt.length, 24);
  head.writeUInt32LE(rl.length, 28);
  head.writeUInt32LE(src.length, 32);
  chunks.push(head);

  const clampI16 = (v) => Math.max(-32768, Math.min(32767, Math.round(v)));
  const clampU16 = (v) => Math.max(0, Math.min(65535, Math.round(v)));

  let verts = 0;
  for (const b of bld) {
    // Длинные стороны делим, чтобы шаг влез в i8
    const ring = [];
    const q = b.ring.map((p) => [Math.round(p[0]), Math.round(p[1])]);
    for (let i = 0; i < q.length; i++) {
      const a = q[i];
      const c = q[(i + 1) % q.length];
      ring.push(a);
      const steps = Math.ceil(Math.max(Math.abs(c[0] - a[0]), Math.abs(c[1] - a[1])) / 120);
      for (let s = 1; s < steps; s++) {
        ring.push([Math.round(a[0] + ((c[0] - a[0]) * s) / steps), Math.round(a[1] + ((c[1] - a[1]) * s) / steps)]);
      }
    }
    // Совпавшие после округления вершины не нужны
    const clean = ring.filter((p, i) => {
      const n = ring[(i + 1) % ring.length];
      return p[0] !== n[0] || p[1] !== n[1];
    });
    if (clean.length < 3 || clean.length > 255) continue;
    const buf = Buffer.alloc(8 + (clean.length - 1) * 2);
    buf.writeUInt8(clean.length, 0);
    buf.writeUInt8(Math.max(1, Math.min(255, Math.round(b.h * 2))), 1);
    buf.writeUInt16LE(clampU16(b.d), 2);
    buf.writeInt16LE(clampI16(clean[0][0]), 4);
    buf.writeInt16LE(clampI16(clean[0][1]), 6);
    for (let i = 1; i < clean.length; i++) {
      buf.writeInt8(clean[i][0] - clean[i - 1][0], 8 + (i - 1) * 2);
      buf.writeInt8(clean[i][1] - clean[i - 1][1], 9 + (i - 1) * 2);
    }
    chunks.push(buf);
    verts += clean.length;
  }
  for (const r of rd) {
    const buf = Buffer.alloc(4 + r.pts.length * 6);
    buf.writeUInt16LE(r.pts.length, 0);
    buf.writeUInt8(r.major, 2);
    r.pts.forEach((p, i) => {
      buf.writeInt16LE(clampI16(p[0]), 4 + i * 6);
      buf.writeInt16LE(clampI16(p[1]), 6 + i * 6);
      buf.writeUInt16LE(clampU16(p[2]), 8 + i * 6);
    });
    chunks.push(buf);
  }
  for (const w of wt.concat(rl)) {
    const buf = Buffer.alloc(4 + w.pts.length * 4);
    buf.writeUInt16LE(w.pts.length, 0);
    buf.writeUInt8(w.w, 2);
    buf.writeUInt8(w.name, 3);
    w.pts.forEach((p, i) => {
      buf.writeInt16LE(clampI16(p[0]), 4 + i * 4);
      buf.writeInt16LE(clampI16(p[1]), 6 + i * 4);
    });
    chunks.push(buf);
  }
  for (const s of src) {
    const buf = Buffer.alloc(4);
    buf.writeInt16LE(clampI16(s[0]), 0);
    buf.writeInt16LE(clampI16(s[1]), 2);
    chunks.push(buf);
  }
  const all = Buffer.concat(chunks);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, file), all);
  console.log(`${file}: ${Math.round(all.length / 1024)} КБ — домов ${bld.length} (вершин ${verts}), улиц ${rd.length}, рек ${wt.length}, путей ${rl.length}, труб ${src.length}`);
}

write('city.bin', { radius: 1750, minArea: 18, roadRadius: 2400, waterRadius: 4200 });
write('city-lite.bin', { radius: 1300, minArea: 40, roadRadius: 1800, waterRadius: 3200 });
