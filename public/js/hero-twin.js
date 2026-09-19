/* МУП БГО ВО «Борисоглебские теплосети» — вариант 4 первого экрана.
   «Цифровой двойник»: объёмный город — дома, улицы, река, железная
   дорога. Город свой, его строит программа (makeCity), это не карта и не
   чужие данные. Камера из вида сверху наклоняется в объём и медленно
   облетает город. То в одном, то в другом квартале загорается тепло:
   улицы и дома теплеют, в окнах зажигается свет, потом квартал остывает.
   Места выбираются случайно. Мышь на сцену не влияет.

   WebGL без библиотек, ничего не скачивает.

   Не запускается (остаётся спокойный фон из CSS), если нет WebGL, включена
   экономия трафика, устройство совсем слабое или включена версия для
   слабовидящих. Если человек просил уменьшить движение или видеокарты нет —
   один неподвижный кадр. */
(function () {
  'use strict';

  var hero = document.querySelector('[data-twin]');
  if (!hero) return;
  var canvas = hero.querySelector('canvas[data-scene]');
  if (!canvas || !window.requestAnimationFrame || !window.Float32Array) return;

  var root = document.documentElement;
  function mq(q) { return !!(window.matchMedia && window.matchMedia(q).matches); }
  if (navigator.connection && navigator.connection.saveData) return;
  if ((navigator.hardwareConcurrency || 4) <= 2 && (navigator.deviceMemory || 4) <= 2) return;
  var still = mq('(prefers-reduced-motion: reduce)');
  var coarse = mq('(pointer: coarse)') || window.innerWidth < 768;

  // Версия для слабовидящих включена ещё до загрузки — сцену не готовим,
  // пока человек её не выключит.
  var visionAtLoad = false;
  try {
    var saved = JSON.parse(localStorage.getItem('bgts-vision'));
    visionAtLoad = !!(saved && saved.on);
  } catch (e) { /* приватный режим */ }
  if (visionAtLoad) {
    var waiter = new MutationObserver(function () {
      if (root.getAttribute('data-vision') !== 'on') { waiter.disconnect(); load(); }
    });
    waiter.observe(root, { attributes: true, attributeFilter: ['data-vision'] });
  } else {
    load();
  }

  function load() {
    var lite = coarse || window.innerWidth < 900;
    // Город строится после первой отрисовки страницы, чтобы не задерживать её
    var later = window.requestIdleCallback || function (fn) { return setTimeout(fn, 60); };
    later(function () { boot(makeCity(lite), lite); });
  }

  /* ---------- Город ---------- */

  // Свой город, а не карта: улицы, кварталы и дома строит программа по
  // случайным числам с постоянным зерном, поэтому он всегда одинаковый.
  // Похож на уездный город с сеткой кварталов: центр с многоэтажками,
  // частный сектор с сараями во дворах, промзона у железной дороги,
  // река на западе, мост и дороги за город. Координаты — метры от центра,
  // x — восток, y — север.
  function makeCity(lite) {
    var seed = 20260919;
    function rnd() {
      seed = (seed + 0x6D2B79F5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    function range(a, b) { return a + (b - a) * rnd(); }

    var R = lite ? 1150 : 1700; // радиус застройки, м
    var city = { buildings: [], roads: [], water: [], rails: [] };

    function riverU(v) { return -R * 0.84 + 120 * Math.sin(v / 430 + 0.6) + 48 * Math.sin(v / 150 + 1.3); }
    function railV(u) { return -R * 0.52 + u * 0.06; }
    // Старая дорога наискосок через сетку кварталов
    var DK = 0.62;
    var DB = 150;
    var DN = Math.sqrt(1 + DK * DK);
    function diag(u, v) { return Math.abs(v - DK * u - DB) / DN; }

    function free(u, v, half) {
      if (u < riverU(v) + 38 + half) return false;
      if (Math.abs(v - railV(u)) < 40 + half) return false;
      if (diag(u, v) < 14 + half) return false;
      return u * u + v * v < R * R * 1.08;
    }
    function rect(u, v, w, d, h) {
      if (!free(u, v, Math.max(w, d) * 0.5)) return;
      var a = u - w / 2; var b = u + w / 2; var c = v - d / 2; var e = v + d / 2;
      city.buildings.push({ ring: [a, c, b, c, b, e, a, e], h: h, d: 0 });
    }

    /* Улицы: сетка с неровным шагом, каждая четвёртая — широкая */
    var xs = [];
    var ys = [];
    var q;
    for (q = -R - 420; q <= R + 420; q += range(142, 168)) xs.push(q);
    for (q = -R - 420; q <= R + 420; q += range(108, 126)) ys.push(q);
    function major(i) { return i % 4 === 2; }
    var ROADR = R + 260;

    function addRoad(points, isMajor) {
      if (points.length < 4) return;
      var pts = [];
      var d = 0;
      for (var k = 0; k < points.length; k += 2) {
        if (k) d += Math.sqrt(Math.pow(points[k] - points[k - 2], 2) + Math.pow(points[k + 1] - points[k - 1], 2));
        pts.push(points[k], points[k + 1], d);
      }
      city.roads.push({ major: isMajor ? 1 : 0, pts: pts });
    }
    function roadOk(u, v) {
      return u * u + v * v < ROADR * ROADR && u > riverU(v) + 30;
    }

    var i, j, cur;
    // Улицы с севера на юг: у железной дороги обрываются, кроме широких
    for (i = 0; i < xs.length; i++) {
      cur = [];
      for (j = 0; j < ys.length; j++) {
        var u = xs[i]; var v = ys[j];
        var crossesRail = j > 0 && (ys[j - 1] - railV(u)) * (v - railV(u)) < 0;
        if (!roadOk(u, v) || (crossesRail && !major(i))) { addRoad(cur, major(i)); cur = []; if (!roadOk(u, v)) continue; }
        cur.push(u, v);
      }
      addRoad(cur, major(i));
    }
    // Улицы с запада на восток: вдоль путей не идут
    for (j = 0; j < ys.length; j++) {
      cur = [];
      for (i = 0; i < xs.length; i++) {
        var uu = xs[i]; var vv = ys[j];
        if (!roadOk(uu, vv) || Math.abs(vv - railV(uu)) < 34) { addRoad(cur, major(j)); cur = []; continue; }
        cur.push(uu, vv);
      }
      addRoad(cur, major(j));
    }
    // Диагональ, мост через реку и дороги за город
    cur = [];
    for (q = -R; q <= R; q += 60) {
      var dv = DK * q + DB;
      if (roadOk(q, dv)) cur.push(q, dv); else { addRoad(cur, true); cur = []; }
    }
    addRoad(cur, true);
    var bridgeV = ys[Math.floor(ys.length / 2) + 1];
    addRoad([-R * 1.9, bridgeV + 40, riverU(bridgeV) - 60, bridgeV, R * 0.2, bridgeV], true);
    [22, 68, 118, 205, 250, 318].forEach(function (deg) {
      var a = deg * Math.PI / 180;
      var pts = [];
      for (var rr = R * 0.9; rr <= R * 2.2; rr += 120) {
        var wob = Math.sin(rr / 260 + deg) * 40;
        pts.push(Math.cos(a) * rr - Math.sin(a) * wob, Math.sin(a) * rr + Math.cos(a) * wob);
      }
      addRoad(pts, true);
    });

    /* Кварталы */
    for (i = 0; i < xs.length - 1; i++) {
      for (j = 0; j < ys.length - 1; j++) {
        var u0 = xs[i] + (major(i) ? 11 : 7);
        var u1 = xs[i + 1] - (major(i + 1) ? 11 : 7);
        var v0 = ys[j] + (major(j) ? 11 : 7);
        var v1 = ys[j + 1] - (major(j + 1) ? 11 : 7);
        var uc = (u0 + u1) / 2;
        var vc = (v0 + v1) / 2;
        var r = Math.sqrt(uc * uc + vc * vc);
        if (r > R * (0.9 + 0.14 * rnd())) continue; // рваный край города
        if (u0 < riverU(vc) + 60) continue;
        var nearRail = Math.abs(vc - railV(uc));
        if (nearRail < 70) continue;
        var roll = rnd();
        if (roll < 0.05) continue; // сквер
        if (r < R * 0.26) centerBlock(u0, u1, v0, v1);
        else if (nearRail < 300 && r > R * 0.3 && roll < 0.42) industryBlock(u0, u1, v0, v1);
        else if (r < R * 0.62 && roll < 0.2) flatsBlock(u0, u1, v0, v1);
        else houseBlock(u0, u1, v0, v1, r > R * 0.75);
      }
    }

    // Центр: сплошные фасады в 2–4 этажа, иногда большое здание во дворе
    function centerBlock(u0, u1, v0, v1) {
      var x;
      var w;
      for (x = u0 + 2; x < u1 - 10; x += w + (rnd() < 0.6 ? 0 : range(2, 5))) {
        w = Math.min(range(14, 32), u1 - 2 - x);
        var d1 = range(11, 16);
        rect(x + w / 2, v0 + d1 / 2 + 1, w, d1, range(7, 14));
        var d2 = range(11, 16);
        rect(x + w / 2, v1 - d2 / 2 - 1, w, d2, range(7, 14));
      }
      for (x = v0 + 20; x < v1 - 28; x += w + range(2, 6)) {
        w = Math.min(range(14, 26), v1 - 20 - x);
        rect(u0 + 7.5, x + w / 2, 13, w, range(7, 12));
        rect(u1 - 7.5, x + w / 2, 13, w, range(7, 12));
      }
      if (rnd() < 0.4) rect((u0 + u1) / 2, (v0 + v1) / 2, range(30, 48), range(20, 30), range(12, 19));
    }

    // Пятиэтажки и девятиэтажки
    function flatsBlock(u0, u1, v0, v1) {
      var len = Math.min(u1 - u0 - 18, range(55, 86));
      var floors = rnd() < 0.25 ? 9 : 5;
      for (var v = v0 + 16; v + 8 < v1 - 10; v += range(32, 40)) {
        rect(u0 + 9 + len / 2, v, len, range(12, 14), floors * 3.1 + 1.2);
      }
      if (u1 - u0 - len > 34) rect(u1 - 14, (v0 + v1) / 2, 13, Math.min(v1 - v0 - 20, range(40, 64)), 5 * 3.1 + 1.2);
      if (rnd() < 0.5) rect(u0 + 22, v1 - 16, 28, 16, 6.5);
    }

    // Промзона у путей: большие корпуса
    function industryBlock(u0, u1, v0, v1) {
      var mid = (u0 + u1) / 2;
      [[u0, mid], [mid, u1]].forEach(function (half) {
        if (rnd() < 0.2) return;
        var w = (half[1] - half[0]) * range(0.55, 0.88);
        var d = (v1 - v0) * range(0.4, 0.82);
        rect((half[0] + half[1]) / 2, v0 + 8 + d / 2 + range(0, v1 - v0 - d - 16), w, d, range(6, 12));
      });
    }

    // Частный сектор: дома вдоль улиц, сараи и бани во дворах
    function houseBlock(u0, u1, v0, v1, sparse) {
      var skip = sparse ? 0.3 : 0.12;
      function lot(cu, cv, alongU, inward) {
        if (rnd() < skip) return;
        var w = range(8, 12.5);
        var d = range(8.5, 13);
        var s = range(3, 7);
        var h = rnd() < 0.14 ? range(6.2, 7.6) : range(3.2, 5.2);
        var off = s + d / 2;
        if (alongU) rect(cu + range(-2, 2), cv + inward * off, w, d, h);
        else rect(cu + inward * off, cv + range(-2, 2), d, w, h);
        if (rnd() < 0.5) {
          var back = s + d + range(5, 11);
          var sw = range(4, 6.5);
          var sd = range(4, 7);
          if (alongU) rect(cu + range(-5, 5), cv + inward * back, sw, sd, range(2.4, 3.2));
          else rect(cu + inward * back, cv + range(-5, 5), sd, sw, range(2.4, 3.2));
        }
      }
      var L;
      var x;
      for (x = u0 + 3; x + 18 <= u1 - 3; x += L) { L = range(19, 26); lot(x + L / 2, v0, true, 1); }
      for (x = u0 + 3; x + 18 <= u1 - 3; x += L) { L = range(19, 26); lot(x + L / 2, v1, true, -1); }
      for (x = v0 + 28; x + 18 <= v1 - 28; x += L) { L = range(19, 26); lot(u0, x + L / 2, false, 1); }
      for (x = v0 + 28; x + 18 <= v1 - 28; x += L) { L = range(19, 26); lot(u1, x + L / 2, false, -1); }
    }

    // Вокзал у путей
    rect(160, railV(160) + 54, 92, 18, 11);

    /* Река и железная дорога */
    var river = [];
    for (q = -R * 1.9; q <= R * 1.9; q += 50) river.push(riverU(q), q);
    city.water.push({ w: 60, pts: river });
    var rail = [];
    for (q = -R * 2.2; q <= R * 2.2; q += 100) rail.push(q, railV(q));
    city.rails.push({ w: 0, pts: rail });
    [-14, -7, 7, 14].forEach(function (off) {
      var track = [];
      for (q = -420; q <= 640; q += 60) track.push(q, railV(q) + off);
      city.rails.push({ w: 0, pts: track });
    });

    return city;
  }

  /* Треугольники крыши: «отрезание ушей», контур против часовой стрелки */
  function triangulate(ring) {
    var n = ring.length / 2;
    if (n < 3) return [];
    if (n === 3) return [0, 1, 2];
    var idx = [];
    var i;
    for (i = 0; i < n; i++) idx.push(i);
    var tris = [];
    var guard = 0;
    while (idx.length > 3 && guard++ < n * 4) {
      var cut = false;
      for (i = 0; i < idx.length; i++) {
        var a = idx[(i + idx.length - 1) % idx.length];
        var b = idx[i];
        var c = idx[(i + 1) % idx.length];
        var ax = ring[a * 2]; var ay = ring[a * 2 + 1];
        var bx = ring[b * 2]; var by = ring[b * 2 + 1];
        var cx = ring[c * 2]; var cy = ring[c * 2 + 1];
        if ((bx - ax) * (cy - ay) - (by - ay) * (cx - ax) <= 0) continue; // вогнутый угол
        var inside = false;
        for (var j = 0; j < idx.length && !inside; j++) {
          var p = idx[j];
          if (p === a || p === b || p === c) continue;
          var px = ring[p * 2]; var py = ring[p * 2 + 1];
          var d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
          var d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
          var d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
          inside = !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
        }
        if (inside) continue;
        tris.push(a, b, c);
        idx.splice(i, 1);
        cut = true;
        break;
      }
      if (!cut) break;
    }
    for (i = 1; i < idx.length - 1; i++) tris.push(idx[0], idx[i], idx[i + 1]);
    return tris;
  }

  /* Буфер вершин с кусками по 65 тысяч — индексы Uint16 есть везде */
  function Mesh(stride) {
    this.stride = stride;
    this.parts = [];
    this.v = [];
    this.i = [];
    this.count = 0;
  }
  Mesh.prototype.room = function (verts) {
    if (this.count + verts > 65000) this.flush();
  };
  Mesh.prototype.vert = function () {
    for (var k = 0; k < arguments.length; k++) this.v.push(arguments[k]);
    return this.count++;
  };
  Mesh.prototype.flush = function () {
    if (this.count) this.parts.push({ v: new Float32Array(this.v), i: new Uint16Array(this.i) });
    this.v = [];
    this.i = [];
    this.count = 0;
  };

  /* ---------- Сцена ---------- */

  function boot(city, lite) {
    var gl = canvas.getContext('webgl', {
      alpha: false, antialias: true, depth: true, stencil: false,
      powerPreference: 'low-power', preserveDrawingBuffer: false,
    });
    if (!gl || !gl.getExtension('OES_standard_derivatives')) return;
    // Видеокарты нет и WebGL рисует процессор — показываем один неподвижный кадр
    var dbg = gl.getExtension('WEBGL_debug_renderer_info');
    var gpu = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : '';
    if (/swiftshader|llvmpipe|software|basic render/i.test(gpu)) still = true;

    var LIGHT = norm2([-0.55, 0.62]); // свет с юго-запада, по земле (x, z)
    function norm2(v) { var l = Math.sqrt(v[0] * v[0] + v[1] * v[1]); return [v[0] / l, v[1] / l]; }
    function seedOf(x, y) { var s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453; return s - Math.floor(s); }

    // Дома: стены, крыши и светящиеся рёбра. В дробной части aD — случайное
    // число дома: по нему в разных домах в разное время загорается свет.
    var walls = new Mesh(7); // pos3, shade, seed, h, u
    var edges = new Mesh(6); // pos3, seed, h, kind
    var spotPool = []; // центры домов — отсюда выбираются места, где загорится тепло
    var LIFT = 1.35; // дома чуть выше настоящих — иначе с высоты птичьего полёта объёма не видно
    city.buildings.forEach(function (b) {
      var r = b.ring;
      var n = r.length / 2;
      var hh = b.h * LIFT;
      var seed = seedOf(r[0], r[1]) * 0.98;
      var ds = b.d + seed;
      if (r[0] * r[0] + r[1] * r[1] < (lite ? 1100 : 1450) * (lite ? 1100 : 1450)) spotPool.push([r[0], -r[1]]);
      walls.room(n * 4 + n);
      var u = 0;
      for (var i = 0; i < n; i++) {
        var j = (i + 1) % n;
        var ax = r[i * 2]; var ay = r[i * 2 + 1];
        var bx = r[j * 2]; var by = r[j * 2 + 1];
        var ex = bx - ax; var ey = by - ay;
        var len = Math.sqrt(ex * ex + ey * ey) || 1;
        // внешняя нормаль в мировых осях (x — восток, z — юг)
        var nx = ey / len; var nz = ex / len;
        var shade = Math.max(0, nx * LIGHT[0] + nz * LIGHT[1]);
        var s = 0.32 + 0.68 * shade;
        var a0 = walls.vert(ax, 0, -ay, s, ds, hh, u);
        var b0 = walls.vert(bx, 0, -by, s, ds, hh, u + len);
        var b1 = walls.vert(bx, hh, -by, s, ds, hh, u + len);
        var a1 = walls.vert(ax, hh, -ay, s, ds, hh, u);
        walls.i.push(a0, b0, b1, a0, b1, a1);
        u += len;
      }
      var first = walls.count;
      for (var q = 0; q < n; q++) walls.vert(r[q * 2], hh, -r[q * 2 + 1], 1, ds, hh, -1);
      var tris = triangulate(r);
      for (var t = 0; t < tris.length; t++) walls.i.push(first + tris[t]);

      edges.room(n * 4);
      var tall = hh >= 8;
      for (var e = 0; e < n; e++) {
        var f = (e + 1) % n;
        var p0 = edges.vert(r[e * 2], hh, -r[e * 2 + 1], ds, hh, 0);
        var p1 = edges.vert(r[f * 2], hh, -r[f * 2 + 1], ds, hh, 0);
        edges.i.push(p0, p1);
        if (tall) {
          var g0 = edges.vert(r[e * 2], 0, -r[e * 2 + 1], ds, hh, 1);
          var g1 = edges.vert(r[e * 2], hh, -r[e * 2 + 1], ds, hh, 1);
          edges.i.push(g0, g1);
        }
      }
    });
    walls.flush();
    edges.flush();
    if (!spotPool.length) return;

    // Улицы — светящиеся ленты; в тёплом квартале по ним бегут огоньки
    var roads = new Mesh(6); // x, z, side, d, major, along
    city.roads.forEach(function (rd) {
      var p = rd.pts;
      var n = p.length / 3;
      var w = rd.major ? 9 : 5.5;
      roads.room(n * 4);
      var along = 0;
      for (var i = 0; i < n - 1; i++) {
        var ax = p[i * 3]; var ay = p[i * 3 + 1]; var ad = p[i * 3 + 2];
        var bx = p[i * 3 + 3]; var by = p[i * 3 + 4]; var bd = p[i * 3 + 5];
        var ex = bx - ax; var ey = by - ay;
        var len = Math.sqrt(ex * ex + ey * ey) || 1;
        var ox = (-ey / len) * w; var oy = (ex / len) * w;
        var v0 = roads.vert(ax + ox, -(ay + oy), 1, ad, rd.major, along);
        var v1 = roads.vert(ax - ox, -(ay - oy), -1, ad, rd.major, along);
        var v2 = roads.vert(bx + ox, -(by + oy), 1, bd, rd.major, along + len);
        var v3 = roads.vert(bx - ox, -(by - oy), -1, bd, rd.major, along + len);
        roads.i.push(v0, v1, v2, v1, v3, v2);
        along += len;
      }
    });
    roads.flush();

    // Реки и железная дорога — ленты по земле
    var water = new Mesh(5); // x, z, side, along, kind
    function ribbon(line, kind, w) {
      var p = line.pts;
      var n = p.length / 2;
      water.room(n * 4);
      var along = 0;
      for (var i = 0; i < n - 1; i++) {
        var ax = p[i * 2]; var ay = p[i * 2 + 1];
        var bx = p[i * 2 + 2]; var by = p[i * 2 + 3];
        var ex = bx - ax; var ey = by - ay;
        var len = Math.sqrt(ex * ex + ey * ey) || 1;
        var ox = (-ey / len) * w; var oy = (ex / len) * w;
        var v0 = water.vert(ax + ox, -(ay + oy), 1, along, kind);
        var v1 = water.vert(ax - ox, -(ay - oy), -1, along, kind);
        var v2 = water.vert(bx + ox, -(by + oy), 1, along + len, kind);
        var v3 = water.vert(bx - ox, -(by - oy), -1, along + len, kind);
        water.i.push(v0, v1, v2, v1, v3, v2);
        along += len;
      }
    }
    city.water.forEach(function (w) { ribbon(w, 0, w.w / 2); });
    city.rails.forEach(function (r) { ribbon(r, 1, 3); });
    water.flush();

    // Земля: один большой квадрат, сетку рисует шейдер
    var ground = new Mesh(2);
    var G = 6000;
    ground.vert(-G, -G); ground.vert(G, -G); ground.vert(G, G); ground.vert(-G, G);
    ground.i.push(0, 1, 2, 0, 2, 3);
    ground.flush();

    /* ---------- Шейдеры ---------- */

    var HEAD = [
      '#ifdef GL_FRAGMENT_PRECISION_HIGH',
      'precision highp float;',
      '#else',
      'precision mediump float;',
      '#endif',
    ].join('\n');
    var COMMON = [
      'uniform mat4 uVP;',
      'uniform vec3 uEye;',
      'uniform float uTime;',
      'uniform float uGrow;',     // дома «вырастают» при появлении
      'uniform vec2 uFade;',      // край модели: начало и конец растворения, м
      'uniform vec2 uFog;',       // дымка по расстоянию от камеры, м
      'uniform vec4 uSpot[4];',   // тёплые кварталы: x, z, радиус, сила
      'uniform float uFront[4];', // яркость фронта, пока квартал разгорается
      'float fogOf(vec3 w){',
      '  float f = smoothstep(uFog.x, uFog.y, distance(uEye, w));',
      '  return max(f, smoothstep(uFade.x, uFade.y, length(w.xz)));',
      '}',
      'float heatAt(vec2 p){',
      '  float h = 0.0;',
      '  for (int i = 0; i < 4; i++) {',
      '    float d = distance(p, uSpot[i].xy);',
      '    h = max(h, uSpot[i].w * (1.0 - smoothstep(uSpot[i].z * 0.7, uSpot[i].z + 1.0, d)));',
      '  }',
      '  return h;',
      '}',
      'float frontAt(vec2 p){',
      '  float f = 0.0;',
      '  for (int i = 0; i < 4; i++) {',
      '    float k = (distance(p, uSpot[i].xy) - uSpot[i].z) / 45.0;',
      '    f = max(f, uFront[i] * exp(-k * k));',
      '  }',
      '  return f;',
      '}',
      // Отдельные дома по всему городу изредка вспыхивают сами по себе
      'float twinkle(float seed){ return pow(max(0.0, sin(uTime * 0.21 + seed * 61.0)), 30.0); }',
      'float growOf(vec2 p){ float delay = clamp(length(p) / 1800.0, 0.0, 1.0) * 0.45; return smoothstep(delay, delay + 0.55, uGrow); }',
    ].join('\n');
    var BG = 'const vec3 BG = vec3(0.027, 0.070, 0.113);';

    var progs = {};

    progs.ground = program(
      [HEAD, COMMON, 'attribute vec2 aPos; varying vec3 vW;',
        'void main(){ vW = vec3(aPos.x, 0.0, aPos.y); gl_Position = uVP * vec4(vW, 1.0); }'].join('\n'),
      ['#extension GL_OES_standard_derivatives : enable', HEAD, COMMON, BG,
        'varying vec3 vW;',
        'void main(){',
        '  vec2 p = vW.xz;',
        '  vec2 g = abs(fract(p / 100.0 - 0.5) - 0.5) / fwidth(p / 100.0);',
        '  float line = 1.0 - min(min(g.x, g.y), 1.0);',
        '  float r = length(p);',
        '  vec3 c = BG + vec3(0.030, 0.075, 0.105) * (1.0 - smoothstep(0.0, 2400.0, r));',
        '  c += vec3(0.16, 0.36, 0.50) * line * 0.30;',
        '  float heat = heatAt(p);',
        '  c += vec3(0.50, 0.22, 0.07) * heat * 0.16;',
        '  c += vec3(1.0, 0.62, 0.30) * frontAt(p) * 0.45;',
        '  gl_FragColor = vec4(mix(c, BG, fogOf(vW)), 1.0);',
        '}'].join('\n'),
      ['aPos']
    );

    progs.water = program(
      [HEAD, COMMON, 'attribute vec2 aPos; attribute float aSide; attribute float aAlong; attribute float aKind;',
        'varying vec3 vW; varying float vSide; varying float vAlong; varying float vKind;',
        'void main(){ vW = vec3(aPos.x, 0.2, aPos.y); vSide = aSide; vAlong = aAlong; vKind = aKind;',
        '  gl_Position = uVP * vec4(vW, 1.0); }'].join('\n'),
      [HEAD, COMMON,
        'varying vec3 vW; varying float vSide; varying float vAlong; varying float vKind;',
        'void main(){',
        '  float e = abs(vSide);',
        '  vec3 c;',
        '  if (vKind < 0.5) {',
        '    float bank = smoothstep(0.7, 0.95, e) * (1.0 - smoothstep(0.95, 1.0, e));',
        '    float s = 0.5 + 0.5 * sin(vAlong * 0.045 - uTime * 1.1 + sin(vAlong * 0.011) * 3.0);',
        '    c = vec3(0.020, 0.090, 0.110) * (1.0 - e * 0.6) + vec3(0.18, 0.62, 0.68) * bank * 0.55 + vec3(0.05, 0.22, 0.26) * s * (1.0 - e) * 0.35;',
        '  } else {',
        '    float sleeper = step(0.55, fract(vAlong / 3.0));',
        '    c = vec3(0.30, 0.26, 0.24) * (0.35 + 0.35 * sleeper) * (1.0 - smoothstep(0.6, 1.0, e));',
        '  }',
        '  gl_FragColor = vec4(c * (1.0 - fogOf(vW)), 1.0);',
        '}'].join('\n'),
      ['aPos', 'aSide', 'aAlong', 'aKind']
    );

    progs.roads = program(
      [HEAD, COMMON, 'attribute vec2 aPos; attribute float aSide; attribute float aD; attribute float aMajor; attribute float aAlong;',
        'varying vec3 vW; varying float vSide; varying float vD; varying float vMajor;',
        'void main(){ vW = vec3(aPos.x, 0.4, aPos.y); vSide = aSide; vD = aD; vMajor = aMajor;',
        '  gl_Position = uVP * vec4(vW, 1.0); }'].join('\n'),
      [HEAD, COMMON,
        'varying vec3 vW; varying float vSide; varying float vD; varying float vMajor;',
        'void main(){',
        '  float core = 1.0 - smoothstep(0.15, 1.0, abs(vSide));',
        '  float heat = heatAt(vW.xz);',
        '  vec3 c = vec3(0.13, 0.32, 0.48) * (0.55 + 0.45 * vMajor);',
        '  c = mix(c, vec3(0.62, 0.30, 0.11) * (0.7 + 0.3 * vMajor), heat);',
        '  float flow = smoothstep(0.82, 1.0, fract((vD - uTime * 70.0) / 55.0)) * heat;',
        '  c += vec3(1.0, 0.66, 0.36) * flow * 0.55;',
        '  c += vec3(1.0, 0.86, 0.62) * frontAt(vW.xz) * 1.4;',
        '  gl_FragColor = vec4(c * core * (1.0 - fogOf(vW)), 1.0);',
        '}'].join('\n'),
      ['aPos', 'aSide', 'aD', 'aMajor', 'aAlong']
    );

    progs.walls = program(
      [HEAD, COMMON, 'attribute vec3 aPos; attribute float aShade; attribute float aD; attribute float aH; attribute float aU;',
        'varying vec3 vW; varying float vShade; varying float vHeat; varying float vFlash; varying float vU; varying float vSeed; varying float vH; varying float vFogK;',
        'void main(){',
        '  float g = growOf(aPos.xz);',
        '  vW = vec3(aPos.x, aPos.y * g, aPos.z);',
        '  vShade = aShade; vU = aU; vH = aH * g;',
        '  vSeed = fract(aD);',
        '  vHeat = max(heatAt(aPos.xz), twinkle(vSeed) * 0.6);',
        '  vFlash = frontAt(aPos.xz);',
        '  vFogK = fogOf(vW);',
        '  gl_Position = uVP * vec4(vW, 1.0);',
        '}'].join('\n'),
      [HEAD, COMMON, BG,
        'varying vec3 vW; varying float vShade; varying float vHeat; varying float vFlash; varying float vU; varying float vSeed; varying float vH; varying float vFogK;',
        'float hash(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }',
        'void main(){',
        '  vec3 base = vec3(0.050, 0.098, 0.145);',
        '  vec3 c;',
        '  if (vU >= 0.0) {',
        '    c = base * (0.55 + 0.75 * vShade);',
        '    float fy = vW.y / 4.2; float fx = vU / 3.3;',
        '    vec2 cell = vec2(floor(fx), floor(fy));',
        '    vec2 f = vec2(fract(fx), fract(fy));',
        '    float win = step(0.28, f.x) * step(f.x, 0.72) * step(0.32, f.y) * step(f.y, 0.78) * step(vW.y, vH - 0.6);',
        '    float rnd = hash(cell + vSeed * 97.0);',
        '    float lit = step(1.0 - mix(0.16, 0.66, vHeat), rnd);',
        '    float far = 1.0 - smoothstep(700.0, 1700.0, distance(uEye, vW));',
        '    vec3 wc = mix(vec3(0.42, 0.62, 0.86) * 0.45, vec3(1.0, 0.74, 0.42), vHeat);',
        '    c += win * lit * wc * (0.45 + 0.55 * rnd) * far;',
        '    c += vec3(0.95, 0.45, 0.16) * vHeat * 0.10 * (1.0 - vW.y / max(vH, 1.0));',
        '  } else {',
        '    c = base * 1.35 + vec3(0.85, 0.40, 0.15) * vHeat * 0.12;',
        '  }',
        '  c += vec3(1.0, 0.78, 0.5) * vFlash * 0.32;',
        '  gl_FragColor = vec4(mix(c, BG, vFogK), 1.0);',
        '}'].join('\n'),
      ['aPos', 'aShade', 'aD', 'aH', 'aU']
    );

    progs.edges = program(
      [HEAD, COMMON, 'attribute vec3 aPos; attribute float aD; attribute float aH; attribute float aKind;',
        'varying vec3 vW; varying float vHeat; varying float vFlash; varying float vKind;',
        'void main(){',
        '  float g = growOf(aPos.xz);',
        '  vW = vec3(aPos.x, aPos.y * g, aPos.z);',
        '  vHeat = max(heatAt(aPos.xz), twinkle(fract(aD)) * 0.6);',
        '  vFlash = frontAt(aPos.xz); vKind = aKind;',
        '  gl_Position = uVP * vec4(vW, 1.0);',
        '}'].join('\n'),
      [HEAD, COMMON,
        'varying vec3 vW; varying float vHeat; varying float vFlash; varying float vKind;',
        'void main(){',
        '  vec3 c = mix(vec3(0.26, 0.58, 0.82) * 0.75, vec3(1.0, 0.56, 0.22) * 0.9, vHeat);',
        '  c += vec3(1.0, 0.88, 0.66) * vFlash * 1.1;',
        '  float a = mix(0.62, 0.34, vKind) * (1.0 - fogOf(vW));',
        '  gl_FragColor = vec4(c * a, 1.0);',
        '}'].join('\n'),
      ['aPos', 'aD', 'aH', 'aKind']
    );

    for (var pk in progs) if (!progs[pk]) return;

    function program(vsSrc, fsSrc, attrs) {
      function sh(type, src) {
        var s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
      }
      var vs = sh(gl.VERTEX_SHADER, vsSrc);
      var fs = sh(gl.FRAGMENT_SHADER, fsSrc);
      if (!vs || !fs) return null;
      var p = gl.createProgram();
      gl.attachShader(p, vs);
      gl.attachShader(p, fs);
      attrs.forEach(function (name, i) { gl.bindAttribLocation(p, i, name); });
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) return null;
      var u = {};
      var count = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
      for (var i = 0; i < count; i++) {
        var info = gl.getActiveUniform(p, i);
        var name = info.name.replace(/\[0\]$/, '');
        u[name] = gl.getUniformLocation(p, name);
      }
      return { p: p, u: u };
    }

    /* ---------- Буферы ---------- */

    function upload(mesh, layout) {
      return mesh.parts.map(function (part) {
        var vb = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, vb);
        gl.bufferData(gl.ARRAY_BUFFER, part.v, gl.STATIC_DRAW);
        var ib = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, part.i, gl.STATIC_DRAW);
        return { vb: vb, ib: ib, n: part.i.length, layout: layout, stride: mesh.stride };
      });
    }
    var geo = {
      ground: upload(ground, [2]),
      water: upload(water, [2, 1, 1, 1]),
      roads: upload(roads, [2, 1, 1, 1, 1]),
      walls: upload(walls, [3, 1, 1, 1, 1]),
      edges: upload(edges, [3, 1, 1, 1]),
    };
    var maxAttrs = 5;

    function drawGeo(list, mode) {
      list.forEach(function (g) {
        gl.bindBuffer(gl.ARRAY_BUFFER, g.vb);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, g.ib);
        var off = 0;
        for (var a = 0; a < maxAttrs; a++) {
          if (a < g.layout.length) {
            gl.enableVertexAttribArray(a);
            gl.vertexAttribPointer(a, g.layout[a], gl.FLOAT, false, g.stride * 4, off * 4);
            off += g.layout[a];
          } else {
            gl.disableVertexAttribArray(a);
          }
        }
        gl.drawElements(mode, g.n, gl.UNSIGNED_SHORT, 0);
      });
    }

    /* ---------- Камера ---------- */

    function perspective(fovy, aspect, near, far, sx, sy) {
      var f = 1 / Math.tan(fovy / 2);
      var nf = 1 / (near - far);
      return [f / aspect, 0, 0, 0, 0, f, 0, 0, -sx, -sy, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0];
    }
    function lookAt(eye, at) {
      var zx = eye[0] - at[0]; var zy = eye[1] - at[1]; var zz = eye[2] - at[2];
      var zl = Math.sqrt(zx * zx + zy * zy + zz * zz); zx /= zl; zy /= zl; zz /= zl;
      var xx = zz; var xy = 0; var xz = -zx; // up = (0,1,0) × z
      var xl = Math.sqrt(xx * xx + xz * xz) || 1; xx /= xl; xz /= xl;
      var yx = zy * xz - zz * xy; var yy = zz * xx - zx * xz; var yz = zx * xy - zy * xx;
      return [
        xx, yx, zx, 0,
        xy, yy, zy, 0,
        xz, yz, zz, 0,
        -(xx * eye[0] + xy * eye[1] + xz * eye[2]),
        -(yx * eye[0] + yy * eye[1] + yz * eye[2]),
        -(zx * eye[0] + zy * eye[1] + zz * eye[2]), 1,
      ];
    }
    function mul(a, b) {
      var o = new Array(16);
      for (var c = 0; c < 4; c++) {
        for (var r = 0; r < 4; r++) {
          o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
        }
      }
      return o;
    }

    var W = 1;
    var H = 1;
    var quality = 1;
    var wide = true;

    function resize() {
      var r = hero.getBoundingClientRect();
      var dpr = window.devicePixelRatio || 1;
      var px = (coarse ? Math.min(dpr, 1.5) : Math.min(dpr, 1.25)) * quality;
      W = Math.max(1, r.width);
      H = Math.max(1, r.height);
      wide = W >= 980;
      var w = Math.max(1, Math.round(W * px));
      var h = Math.max(1, Math.round(H * px));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      gl.viewport(0, 0, w, h);
      if (!running) render(lastNow);
    }

    /* ---------- Движение ---------- */

    var DEG = Math.PI / 180;
    var cam = { vp: null, eye: [0, 0, 0] };
    var scrollK = 0;

    function ease(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
    function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

    function camera(t) {
      var intro = still ? 1 : ease(clamp01(t / 3.4));
      var yaw = (-34 + 34 * intro) * DEG + (still ? 0 : t * 1.5 * DEG);
      var elev = (80 - (wide ? 53 : 48) * intro) * DEG - scrollK * 8 * DEG;
      var dist = (3500 - 1400 * intro - scrollK * 380) * (wide ? 1 : 1.15);
      var tx = wide ? 160 : 0;
      var tz = wide ? 40 : 60;
      var ce = Math.cos(elev);
      var eye = [tx + dist * ce * Math.sin(yaw), dist * Math.sin(elev), tz + dist * ce * Math.cos(yaw)];
      cam.eye = eye;
      var proj = perspective(36 * DEG, W / H, 20, 14000, wide ? 0.2 : 0, wide ? -0.2 : -0.46);
      cam.vp = mul(proj, lookAt(eye, [tx, 0, tz]));
    }

    // Тёплые кварталы: появляются в случайных местах, разгораются, остывают
    var spots = [];
    var nextSpawn = 1.3;
    var lastPick = null;
    var spotU = new Float32Array(16);
    var spotF = new Float32Array(4);

    // Место выбираем там, где город хорошо виден: не под текстом и не у
    // самого горизонта, и подальше от предыдущего
    function onScreen(p) {
      var m = cam.vp;
      if (!m) return true;
      var cx = m[0] * p[0] + m[8] * p[1] + m[12];
      var cy = m[1] * p[0] + m[9] * p[1] + m[13];
      var cw = m[3] * p[0] + m[11] * p[1] + m[15];
      if (cw <= 0) return false;
      var x = cx / cw * 0.5 + 0.5;
      var y = 0.5 - cy / cw * 0.5;
      return wide ? x > 0.46 && x < 0.97 && y > 0.36 && y < 0.95 : x > 0.08 && x < 0.92 && y > 0.58 && y < 0.97;
    }
    function pick() {
      var fallback = null;
      for (var tries = 0; tries < 24; tries++) {
        var p = spotPool[(Math.random() * spotPool.length) | 0];
        var far = !lastPick || Math.abs(p[0] - lastPick[0]) + Math.abs(p[1] - lastPick[1]) > 520;
        if (far && !fallback) fallback = p;
        if (far && onScreen(p)) return (lastPick = p);
      }
      return (lastPick = fallback || spotPool[(Math.random() * spotPool.length) | 0]);
    }
    function spawn(t) {
      var p = pick();
      spots.push({ x: p[0], z: p[1], t0: t, R: (lite ? 220 : 260) + Math.random() * (lite ? 300 : 440), life: 6.5 + Math.random() * 3 });
      if (spots.length > 4) spots.shift();
    }
    // Для неподвижного кадра — три уже прогретых квартала
    function settle(t) {
      spots = [0.17, 0.53, 0.81].map(function (k, i) {
        var p = spotPool[Math.floor(k * (spotPool.length - 1))];
        return { x: p[0], z: p[1], t0: t - 3 - i * 0.7, R: lite ? 380 : 520, life: 1e6 };
      });
      nextSpawn = t + 1.5;
    }
    function updateSpots(t) {
      if (!still) {
        while (t >= nextSpawn) {
          spawn(nextSpawn);
          nextSpawn += 1.6 + Math.random() * 1.6;
        }
      }
      spots = spots.filter(function (s) { return t - s.t0 < s.life; });
      for (var i = 0; i < 4; i++) {
        var s = spots[i];
        if (!s) {
          spotU[i * 4] = -1e5; spotU[i * 4 + 1] = -1e5; spotU[i * 4 + 2] = 0; spotU[i * 4 + 3] = 0;
          spotF[i] = 0;
          continue;
        }
        var age = t - s.t0;
        var g = 1 - Math.pow(1 - clamp01(age / 2.2), 3);
        var a = clamp01(age / 0.35) * clamp01((s.life - age) / 2.4);
        spotU[i * 4] = s.x; spotU[i * 4 + 1] = s.z; spotU[i * 4 + 2] = s.R * g; spotU[i * 4 + 3] = a;
        spotF[i] = (1 - g) * a;
      }
    }

    function setCommon(pr, t) {
      var u = pr.u;
      gl.useProgram(pr.p);
      if (u.uVP) gl.uniformMatrix4fv(u.uVP, false, cam.vp);
      if (u.uEye) gl.uniform3f(u.uEye, cam.eye[0], cam.eye[1], cam.eye[2]);
      if (u.uTime) gl.uniform1f(u.uTime, t);
      if (u.uGrow) gl.uniform1f(u.uGrow, still ? 1 : clamp01((t - 0.5) / 2.6));
      if (u.uFade) gl.uniform2f(u.uFade, lite ? 950 : 1250, lite ? 1320 : 1760);
      if (u.uFog) gl.uniform2f(u.uFog, 1600, 5200);
      if (u.uSpot) gl.uniform4fv(u.uSpot, spotU);
      if (u.uFront) gl.uniform1fv(u.uFront, spotF);
    }

    var t0 = performance.now();
    var lastNow = t0;

    function render(now) {
      var t = (now - t0) / 1000;
      lastNow = now;
      if (still) t = 30;
      camera(t);
      updateSpots(t);

      gl.clearColor(0.027, 0.070, 0.113, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

      // Земля, реки и улицы — без глубины, светятся сложением
      gl.disable(gl.DEPTH_TEST);
      gl.depthMask(false);
      gl.disable(gl.BLEND);
      setCommon(progs.ground, t);
      drawGeo(geo.ground, gl.TRIANGLES);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      setCommon(progs.water, t);
      drawGeo(geo.water, gl.TRIANGLES);
      setCommon(progs.roads, t);
      drawGeo(geo.roads, gl.TRIANGLES);

      // Дома — непрозрачные, с глубиной
      gl.disable(gl.BLEND);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.depthMask(true);
      gl.enable(gl.POLYGON_OFFSET_FILL);
      gl.polygonOffset(1, 1);
      setCommon(progs.walls, t);
      drawGeo(geo.walls, gl.TRIANGLES);
      gl.disable(gl.POLYGON_OFFSET_FILL);

      // Рёбра домов — поверх, сложением
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.depthMask(false);
      setCommon(progs.edges, t);
      drawGeo(geo.edges, gl.LINES);
      gl.depthMask(true);
    }

    function onScroll() {
      var r = hero.getBoundingClientRect();
      scrollK = clamp01(-r.top / Math.max(1, r.height));
    }
    if (!still) window.addEventListener('scroll', onScroll, { passive: true });

    /* ---------- Цикл ---------- */

    var FRAME_MS = coarse ? 1000 / 30 : 1000 / 60;
    var running = false;
    var raf = 0;
    var lastFrame = 0;
    var visible = true;
    var slow = 0;
    var frames = 0;

    try {
      if (localStorage.getItem('bgts-scene-stopped') === '1') canvas.setAttribute('data-stopped', '');
    } catch (e) { /* приватный режим */ }

    function stoppedByUser() { return canvas.hasAttribute('data-stopped'); }
    function blocked() {
      return still || stoppedByUser() || !visible || document.hidden || root.getAttribute('data-vision') === 'on';
    }
    function loop(now) {
      raf = requestAnimationFrame(loop);
      var gap = now - lastFrame;
      if (gap < FRAME_MS - 1) return;
      lastFrame = now;
      render(now);
      if (gap < 250) {
        frames++;
        if (gap > FRAME_MS * 1.6) slow++;
        if (frames >= 90) {
          if (slow > 45 && quality > 0.6) { quality *= 0.8; resize(); }
          frames = 0;
          slow = 0;
        }
      }
    }
    function start() {
      if (running || blocked()) return;
      running = true;
      lastFrame = 0;
      lastNow = performance.now();
      raf = requestAnimationFrame(loop);
    }
    function stop() {
      running = false;
      cancelAnimationFrame(raf);
    }
    function sync() { if (blocked()) stop(); else start(); }

    // Неподвижный кадр и остановленная заранее сцена — город уже собран,
    // три квартала прогреты
    if (still) settle(30);
    else if (stoppedByUser()) { t0 = performance.now() - 30000; settle(30); }

    resize();
    render(performance.now());
    hero.classList.add('is-live');
    sync();

    new MutationObserver(sync).observe(canvas, { attributes: true, attributeFilter: ['data-stopped'] });
    new MutationObserver(function () {
      sync();
      if (root.getAttribute('data-vision') !== 'on') resize();
    }).observe(root, { attributes: true, attributeFilter: ['data-vision'] });
    document.addEventListener('visibilitychange', sync);
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        visible = entries[0].isIntersecting;
        sync();
      }).observe(hero);
    }
    if ('ResizeObserver' in window) new ResizeObserver(function () { resize(); }).observe(hero);
    else window.addEventListener('resize', resize);

    canvas.addEventListener('webglcontextlost', function (e) {
      e.preventDefault();
      stop();
      hero.classList.remove('is-live');
    });
  }
})();
