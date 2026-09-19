/* МУП БГО ВО «Борисоглебские теплосети» — вариант 4 первого экрана.
   «Цифровой двойник»: объёмная модель Борисоглебска по данным
   OpenStreetMap — дома, улицы, реки, железная дорога. От настоящих дымовых
   труб по улицам расходится тепловая волна: улицы вспыхивают, дома теплеют,
   в окнах загорается свет. Камера из вида сверху, как на карте, наклоняется
   в объём и медленно облетает город. Под курсором — координаты точки.
   Волна — иллюстрация, а не схема тепловых сетей.

   WebGL без библиотек; данные — готовый файл public/data/city*.bin
   (tools/city-data.js), в OpenStreetMap сайт не ходит.

   Не запускается (остаётся спокойный фон из CSS), если нет WebGL, включена
   экономия трафика, устройство совсем слабое или включена версия для
   слабовидящих. Если человек просил уменьшить движение — один неподвижный
   кадр без облёта. */
(function () {
  'use strict';

  var hero = document.querySelector('[data-twin]');
  if (!hero) return;
  var canvas = hero.querySelector('canvas[data-scene]');
  var labelsBox = hero.querySelector('[data-twin-labels]');
  var coordOut = hero.querySelector('[data-twin-coord]');
  if (!canvas || !window.requestAnimationFrame || !window.fetch || !window.DataView || !window.Float32Array) return;

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
    var base = root.getAttribute('data-base') || '';
    fetch(base + '/data/' + (lite ? 'city-lite.bin' : 'city.bin'), { credentials: 'same-origin' })
      .then(function (r) { if (!r.ok) throw new Error(String(r.status)); return r.arrayBuffer(); })
      .then(function (buf) { boot(parse(buf), lite); })
      .catch(function () { /* нет данных — остаётся фон из CSS */ });
  }

  /* ---------- Данные ---------- */

  function parse(buf) {
    var dv = new DataView(buf);
    var magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
    if (magic !== 'BGT1') throw new Error('city.bin');
    var city = {
      lat0: dv.getFloat32(8, true), lon0: dv.getFloat32(12, true),
      buildings: [], roads: [], water: [], rails: [], sources: [],
    };
    var nB = dv.getUint32(16, true);
    var nR = dv.getUint32(20, true);
    var nW = dv.getUint32(24, true);
    var nL = dv.getUint32(28, true);
    var nS = dv.getUint32(32, true);
    var o = 36;
    var i, k, n;
    for (i = 0; i < nB; i++) {
      n = dv.getUint8(o);
      var h = dv.getUint8(o + 1) / 2;
      var d = dv.getUint16(o + 2, true);
      var x = dv.getInt16(o + 4, true);
      var y = dv.getInt16(o + 6, true);
      o += 8;
      var ring = [x, y];
      for (k = 1; k < n; k++) {
        x += dv.getInt8(o);
        y += dv.getInt8(o + 1);
        ring.push(x, y);
        o += 2;
      }
      city.buildings.push({ ring: ring, h: h, d: d });
    }
    for (i = 0; i < nR; i++) {
      n = dv.getUint16(o, true);
      var road = { major: dv.getUint8(o + 2), pts: [] };
      o += 4;
      for (k = 0; k < n; k++) {
        road.pts.push(dv.getInt16(o, true), dv.getInt16(o + 2, true), dv.getUint16(o + 4, true));
        o += 6;
      }
      city.roads.push(road);
    }
    for (i = 0; i < nW + nL; i++) {
      n = dv.getUint16(o, true);
      var line = { w: dv.getUint8(o + 2), name: dv.getUint8(o + 3), pts: [] };
      o += 4;
      for (k = 0; k < n; k++) {
        line.pts.push(dv.getInt16(o, true), dv.getInt16(o + 2, true));
        o += 4;
      }
      (i < nW ? city.water : city.rails).push(line);
    }
    for (i = 0; i < nS; i++) {
      city.sources.push([dv.getInt16(o, true), dv.getInt16(o + 2, true)]);
      o += 4;
    }
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

    var KX = Math.cos(city.lat0 * Math.PI / 180) * 111320;
    var KY = 110540;
    var LIGHT = norm2([-0.55, 0.62]); // свет с юго-запада, по земле (x, z)
    function norm2(v) { var l = Math.sqrt(v[0] * v[0] + v[1] * v[1]); return [v[0] / l, v[1] / l]; }
    function seedOf(x, y) { var s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453; return s - Math.floor(s); }

    // Дома: стены, крыши и светящиеся рёбра
    var walls = new Mesh(7); // pos3, shade, d+seed, h, u
    var edges = new Mesh(6); // pos3, d, h, kind
    var LIFT = 1.35; // дома чуть выше настоящих — иначе с высоты птичьего полёта объёма не видно
    city.buildings.forEach(function (b) {
      var r = b.ring;
      var n = r.length / 2;
      var hh = b.h * LIFT;
      var seed = seedOf(r[0], r[1]) * 0.98;
      var ds = b.d + seed;
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
        var p0 = edges.vert(r[e * 2], hh, -r[e * 2 + 1], b.d, hh, 0);
        var p1 = edges.vert(r[f * 2], hh, -r[f * 2 + 1], b.d, hh, 0);
        edges.i.push(p0, p1);
        if (tall) {
          var g0 = edges.vert(r[e * 2], 0, -r[e * 2 + 1], b.d, hh, 1);
          var g1 = edges.vert(r[e * 2], hh, -r[e * 2 + 1], b.d, hh, 1);
          edges.i.push(g0, g1);
        }
      }
    });
    walls.flush();
    edges.flush();

    // Улицы — светящиеся ленты; по ним бежит волна
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
    var anchors = [];
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
    var riverNames = { 1: 'р. Ворона', 2: 'р. Хопёр' };
    var nearest = {};
    city.water.forEach(function (w) {
      ribbon(w, 0, w.w / 2);
      if (!riverNames[w.name]) return;
      for (var i = 0; i < w.pts.length; i += 2) {
        var dd = Math.sqrt(w.pts[i] * w.pts[i] + w.pts[i + 1] * w.pts[i + 1]);
        if (!nearest[w.name] || dd < nearest[w.name].dd) nearest[w.name] = { dd: dd, x: w.pts[i], y: w.pts[i + 1] };
      }
    });
    Object.keys(nearest).forEach(function (key) {
      var a = nearest[key];
      if (a.dd < (lite ? 1500 : 2300)) anchors.push({ text: riverNames[key], x: a.x, y: 6, z: -a.y });
    });
    city.rails.forEach(function (r) { ribbon(r, 1, 3); });
    water.flush();

    // Трубы: столбы тёплого света
    var beams = new Mesh(4); // x, z, cx, cy
    city.sources.forEach(function (s) {
      beams.room(4);
      var b0 = beams.vert(s[0], -s[1], -1, 0);
      var b1 = beams.vert(s[0], -s[1], 1, 0);
      var b2 = beams.vert(s[0], -s[1], 1, 1);
      var b3 = beams.vert(s[0], -s[1], -1, 1);
      beams.i.push(b0, b1, b2, b0, b2, b3);
    });
    beams.flush();

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
      'uniform float uFront;',  // сколько метров по улицам прошла волна
      'uniform float uWarm;',   // 1 — город прогрет, 0 — остыл
      'uniform float uFlash;',  // яркость гребня волны
      'uniform float uGrow;',   // дома «вырастают» при появлении
      'uniform vec4 uProbe;',   // точка под курсором: x, z, радиус, сила
      'uniform vec2 uFade;',    // край модели: начало и конец растворения, м
      'uniform vec2 uFog;',     // дымка по расстоянию от камеры, м
      'float fogOf(vec3 w){',
      '  float f = smoothstep(uFog.x, uFog.y, distance(uEye, w));',
      '  return max(f, smoothstep(uFade.x, uFade.y, length(w.xz)));',
      '}',
      'float heatOf(float d){ return smoothstep(d - 90.0, d + 90.0, uFront) * uWarm; }',
      'float flashOf(float d){ float k = (uFront - d) / 75.0; return exp(-k * k) * uFlash; }',
      'float probeOf(vec2 p){ return uProbe.w * (1.0 - smoothstep(uProbe.z * 0.55, uProbe.z, distance(p, uProbe.xy))); }',
      'float growOf(vec2 p){ float delay = clamp(length(p) / 1800.0, 0.0, 1.0) * 0.45; return smoothstep(delay, delay + 0.55, uGrow); }',
    ].join('\n');
    var BG = 'const vec3 BG = vec3(0.027, 0.070, 0.113);';

    var progs = {};

    progs.ground = program(
      [HEAD, COMMON, 'attribute vec2 aPos; varying vec3 vW;',
        'void main(){ vW = vec3(aPos.x, 0.0, aPos.y); gl_Position = uVP * vec4(vW, 1.0); }'].join('\n'),
      ['#extension GL_OES_standard_derivatives : enable', HEAD, COMMON, BG,
        'uniform vec4 uSrc[8]; uniform float uSrcN; uniform float uPulse;',
        'varying vec3 vW;',
        'void main(){',
        '  vec2 p = vW.xz;',
        '  vec2 g = abs(fract(p / 100.0 - 0.5) - 0.5) / fwidth(p / 100.0);',
        '  float line = 1.0 - min(min(g.x, g.y), 1.0);',
        '  float r = length(p);',
        '  vec3 c = BG + vec3(0.030, 0.075, 0.105) * (1.0 - smoothstep(0.0, 2400.0, r));',
        '  c += vec3(0.16, 0.36, 0.50) * line * 0.30;',
        '  for (int i = 0; i < 8; i++) {',
        '    if (float(i) >= uSrcN) break;',
        '    float dd = distance(p, uSrc[i].xy);',
        '    float k = (dd - uPulse * 520.0) / 26.0;',
        '    c += vec3(1.0, 0.55, 0.22) * exp(-k * k) * exp(-uPulse * 0.55) * 0.35 * uWarm;',
        '    c += vec3(1.0, 0.5, 0.2) * exp(-dd / 60.0) * 0.25;',
        '  }',
        '  float pd = distance(p, uProbe.xy);',
        '  c += vec3(0.35, 0.85, 1.0) * (1.0 - smoothstep(0.0, 8.0, abs(pd - uProbe.z))) * uProbe.w * 1.6;',
        '  c += vec3(0.35, 0.85, 1.0) * (1.0 - smoothstep(0.0, 6.0, pd)) * uProbe.w * 1.2;',
        '  c += vec3(0.35, 0.85, 1.0) * (1.0 - smoothstep(0.0, uProbe.z, pd)) * uProbe.w * 0.05;',
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
        '  float heat = heatOf(vD);',
        '  vec3 c = vec3(0.13, 0.32, 0.48) * (0.55 + 0.45 * vMajor);',
        '  c = mix(c, vec3(0.62, 0.30, 0.11) * (0.7 + 0.3 * vMajor), heat);',
        '  float flow = smoothstep(0.82, 1.0, fract((vD - uTime * 70.0) / 55.0)) * heat;',
        '  c += vec3(1.0, 0.66, 0.36) * flow * 0.55;',
        '  c += vec3(1.0, 0.86, 0.62) * flashOf(vD) * 1.5;',
        '  c += vec3(0.35, 0.85, 1.0) * probeOf(vW.xz) * 0.35;',
        '  gl_FragColor = vec4(c * core * (1.0 - fogOf(vW)), 1.0);',
        '}'].join('\n'),
      ['aPos', 'aSide', 'aD', 'aMajor', 'aAlong']
    );

    progs.walls = program(
      [HEAD, COMMON, 'attribute vec3 aPos; attribute float aShade; attribute float aD; attribute float aH; attribute float aU;',
        'varying vec3 vW; varying float vShade; varying float vHeat; varying float vFlash; varying float vU; varying float vSeed; varying float vH; varying float vProbe; varying float vFogK;',
        'void main(){',
        '  float g = growOf(aPos.xz);',
        '  vW = vec3(aPos.x, aPos.y * g, aPos.z);',
        '  vShade = aShade; vU = aU; vH = aH * g;',
        '  float d = floor(aD); vSeed = fract(aD);',
        '  vHeat = heatOf(d); vFlash = flashOf(d); vProbe = probeOf(aPos.xz);',
        '  vFogK = fogOf(vW);',
        '  gl_Position = uVP * vec4(vW, 1.0);',
        '}'].join('\n'),
      [HEAD, COMMON, BG,
        'varying vec3 vW; varying float vShade; varying float vHeat; varying float vFlash; varying float vU; varying float vSeed; varying float vH; varying float vProbe; varying float vFogK;',
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
        '  c += vec3(0.35, 0.85, 1.0) * vProbe * 0.3;',
        '  gl_FragColor = vec4(mix(c, BG, vFogK), 1.0);',
        '}'].join('\n'),
      ['aPos', 'aShade', 'aD', 'aH', 'aU']
    );

    progs.edges = program(
      [HEAD, COMMON, 'attribute vec3 aPos; attribute float aD; attribute float aH; attribute float aKind;',
        'varying vec3 vW; varying float vHeat; varying float vFlash; varying float vKind; varying float vProbe;',
        'void main(){',
        '  float g = growOf(aPos.xz);',
        '  vW = vec3(aPos.x, aPos.y * g, aPos.z);',
        '  vHeat = heatOf(aD); vFlash = flashOf(aD); vKind = aKind; vProbe = probeOf(aPos.xz);',
        '  gl_Position = uVP * vec4(vW, 1.0);',
        '}'].join('\n'),
      [HEAD, COMMON,
        'varying vec3 vW; varying float vHeat; varying float vFlash; varying float vKind; varying float vProbe;',
        'void main(){',
        '  vec3 c = mix(vec3(0.26, 0.58, 0.82) * 0.75, vec3(1.0, 0.56, 0.22) * 0.9, vHeat);',
        '  c += vec3(1.0, 0.88, 0.66) * vFlash * 1.1;',
        '  c += vec3(0.4, 0.9, 1.0) * vProbe * 1.5;',
        '  float a = mix(0.62, 0.34, vKind) * (1.0 - fogOf(vW));',
        '  gl_FragColor = vec4(c * a, 1.0);',
        '}'].join('\n'),
      ['aPos', 'aD', 'aH', 'aKind']
    );

    progs.beams = program(
      [HEAD, COMMON, 'attribute vec2 aPos; attribute vec2 aCorner; uniform vec3 uRight;',
        'varying vec2 vC; varying float vFogK;',
        'void main(){',
        '  vec3 w = vec3(aPos.x, 0.0, aPos.y) + uRight * aCorner.x * 7.0 + vec3(0.0, aCorner.y * 190.0, 0.0);',
        '  vC = aCorner; vFogK = fogOf(w);',
        '  gl_Position = uVP * vec4(w, 1.0);',
        '}'].join('\n'),
      [HEAD, COMMON, 'uniform float uPulse;',
        'varying vec2 vC; varying float vFogK;',
        'void main(){',
        '  float a = pow(1.0 - vC.y, 2.2) * (1.0 - abs(vC.x)) * (0.45 + 0.55 * exp(-uPulse * 0.9));',
        '  gl_FragColor = vec4(vec3(1.0, 0.6, 0.28) * a * 0.8 * (1.0 - vFogK), 1.0);',
        '}'].join('\n'),
      ['aPos', 'aCorner']
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
      beams: upload(beams, [2, 2]),
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
    function invert(m) {
      var inv = new Array(16);
      inv[0] = m[5] * m[10] * m[15] - m[5] * m[11] * m[14] - m[9] * m[6] * m[15] + m[9] * m[7] * m[14] + m[13] * m[6] * m[11] - m[13] * m[7] * m[10];
      inv[4] = -m[4] * m[10] * m[15] + m[4] * m[11] * m[14] + m[8] * m[6] * m[15] - m[8] * m[7] * m[14] - m[12] * m[6] * m[11] + m[12] * m[7] * m[10];
      inv[8] = m[4] * m[9] * m[15] - m[4] * m[11] * m[13] - m[8] * m[5] * m[15] + m[8] * m[7] * m[13] + m[12] * m[5] * m[11] - m[12] * m[7] * m[9];
      inv[12] = -m[4] * m[9] * m[14] + m[4] * m[10] * m[13] + m[8] * m[5] * m[14] - m[8] * m[6] * m[13] - m[12] * m[5] * m[10] + m[12] * m[6] * m[9];
      inv[1] = -m[1] * m[10] * m[15] + m[1] * m[11] * m[14] + m[9] * m[2] * m[15] - m[9] * m[3] * m[14] - m[13] * m[2] * m[11] + m[13] * m[3] * m[10];
      inv[5] = m[0] * m[10] * m[15] - m[0] * m[11] * m[14] - m[8] * m[2] * m[15] + m[8] * m[3] * m[14] + m[12] * m[2] * m[11] - m[12] * m[3] * m[10];
      inv[9] = -m[0] * m[9] * m[15] + m[0] * m[11] * m[13] + m[8] * m[1] * m[15] - m[8] * m[3] * m[13] - m[12] * m[1] * m[11] + m[12] * m[3] * m[9];
      inv[13] = m[0] * m[9] * m[14] - m[0] * m[10] * m[13] - m[8] * m[1] * m[14] + m[8] * m[2] * m[13] + m[12] * m[1] * m[10] - m[12] * m[2] * m[9];
      inv[2] = m[1] * m[6] * m[15] - m[1] * m[7] * m[14] - m[5] * m[2] * m[15] + m[5] * m[3] * m[14] + m[13] * m[2] * m[7] - m[13] * m[3] * m[6];
      inv[6] = -m[0] * m[6] * m[15] + m[0] * m[7] * m[14] + m[4] * m[2] * m[15] - m[4] * m[3] * m[14] - m[12] * m[2] * m[7] + m[12] * m[3] * m[6];
      inv[10] = m[0] * m[5] * m[15] - m[0] * m[7] * m[13] - m[4] * m[1] * m[15] + m[4] * m[3] * m[13] + m[12] * m[1] * m[7] - m[12] * m[3] * m[5];
      inv[14] = -m[0] * m[5] * m[14] + m[0] * m[6] * m[13] + m[4] * m[1] * m[14] - m[4] * m[2] * m[13] - m[12] * m[1] * m[6] + m[12] * m[2] * m[5];
      inv[3] = -m[1] * m[6] * m[11] + m[1] * m[7] * m[10] + m[5] * m[2] * m[11] - m[5] * m[3] * m[10] - m[9] * m[2] * m[7] + m[9] * m[3] * m[6];
      inv[7] = m[0] * m[6] * m[11] - m[0] * m[7] * m[10] - m[4] * m[2] * m[11] + m[4] * m[3] * m[10] + m[8] * m[2] * m[7] - m[8] * m[3] * m[6];
      inv[11] = -m[0] * m[5] * m[11] + m[0] * m[7] * m[9] + m[4] * m[1] * m[11] - m[4] * m[3] * m[9] - m[8] * m[1] * m[7] + m[8] * m[3] * m[5];
      inv[15] = m[0] * m[5] * m[10] - m[0] * m[6] * m[9] - m[4] * m[1] * m[10] + m[4] * m[2] * m[9] + m[8] * m[1] * m[6] - m[8] * m[2] * m[5];
      var det = m[0] * inv[0] + m[1] * inv[4] + m[2] * inv[8] + m[3] * inv[12];
      if (!det) return null;
      for (var i = 0; i < 16; i++) inv[i] /= det;
      return inv;
    }

    var W = 1;
    var H = 1;
    var pxScale = 1;
    var blockers = []; // текст и панель: под ними подписи не показываем
    var quality = 1;
    var wide = true;

    function resize() {
      var r = hero.getBoundingClientRect();
      var dpr = window.devicePixelRatio || 1;
      pxScale = (coarse ? Math.min(dpr, 1.5) : Math.min(dpr, 1.25)) * quality;
      W = Math.max(1, r.width);
      H = Math.max(1, r.height);
      wide = W >= 980;
      blockers = [].map.call(hero.querySelectorAll('.hero__in > *, .hero__hud'), function (el) {
        var b = el.getBoundingClientRect();
        return [b.left - r.left - 16, b.top - r.top - 16, b.right - r.left + 16, b.bottom - r.top + 16];
      });
      var w = Math.max(1, Math.round(W * pxScale));
      var h = Math.max(1, Math.round(H * pxScale));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      gl.viewport(0, 0, w, h);
      if (!running) render(lastNow);
    }

    /* ---------- Движение ---------- */

    var DEG = Math.PI / 180;
    var cam = { yaw: 0, elev: 0, dist: 0, vp: null, inv: null, eye: [0, 0, 0], right: [1, 0, 0] };
    var par = { x: 0, y: 0, tx: 0, ty: 0 };
    var scrollK = 0;
    var probe = { x: 0, z: 0, amp: 0, target: 0, has: false };
    var srcArr = new Float32Array(32);
    city.sources.slice(0, 8).forEach(function (s, i) { srcArr[i * 4] = s[0]; srcArr[i * 4 + 1] = -s[1]; });

    function ease(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
    function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

    var WAVE_START = 1.6;
    var PERIOD = 13;
    function waveAt(t) {
      if (still) return { front: 1e5, warm: 1, flash: 0, pulse: 9 };
      var tau = t - WAVE_START;
      if (tau < 0) return { front: -500, warm: 1, flash: 0, pulse: 9 };
      tau = tau % PERIOD;
      var warm = tau < 9.5 ? 1 : 1 - clamp01((tau - 9.5) / 1.8);
      return { front: tau * 520, warm: warm, flash: tau < 7.5 ? 1 : 0, pulse: tau };
    }

    function camera(t, dt) {
      var intro = still ? 1 : ease(clamp01(t / 3.4));
      var k = 1 - Math.exp(-dt * 3);
      par.x += (par.tx - par.x) * k;
      par.y += (par.ty - par.y) * k;
      cam.yaw = (-34 + 34 * intro) * DEG + (still ? 0 : t * 1.5 * DEG) + par.x * 6 * DEG;
      cam.elev = (80 - (wide ? 53 : 48) * intro) * DEG - scrollK * 8 * DEG + par.y * 3.5 * DEG;
      cam.dist = 3500 - 1400 * intro - scrollK * 380;
      if (!wide) cam.dist *= 1.15;
      var tx = wide ? 160 : 0;
      var tz = wide ? 40 : 60;
      var ce = Math.cos(cam.elev);
      var eye = [tx + cam.dist * ce * Math.sin(cam.yaw), cam.dist * Math.sin(cam.elev), tz + cam.dist * ce * Math.cos(cam.yaw)];
      cam.eye = eye;
      cam.right = [Math.cos(cam.yaw), 0, -Math.sin(cam.yaw)];
      var proj = perspective(36 * DEG, W / H, 20, 14000, wide ? 0.2 : 0, wide ? -0.2 : -0.46);
      cam.vp = mul(proj, lookAt(eye, [tx, 0, tz]));
      cam.inv = null;
    }

    function setCommon(pr, t, wave) {
      var u = pr.u;
      gl.useProgram(pr.p);
      if (u.uVP) gl.uniformMatrix4fv(u.uVP, false, cam.vp);
      if (u.uEye) gl.uniform3f(u.uEye, cam.eye[0], cam.eye[1], cam.eye[2]);
      if (u.uTime) gl.uniform1f(u.uTime, t);
      if (u.uFront) gl.uniform1f(u.uFront, wave.front);
      if (u.uWarm) gl.uniform1f(u.uWarm, wave.warm);
      if (u.uFlash) gl.uniform1f(u.uFlash, wave.flash);
      if (u.uGrow) gl.uniform1f(u.uGrow, still ? 1 : clamp01((t - 0.5) / 2.6));
      if (u.uProbe) gl.uniform4f(u.uProbe, probe.x, probe.z, 150, probe.amp);
      if (u.uFade) gl.uniform2f(u.uFade, lite ? 950 : 1250, lite ? 1320 : 1760);
      if (u.uFog) gl.uniform2f(u.uFog, 1600, 5200);
      if (u.uPulse) gl.uniform1f(u.uPulse, wave.pulse);
    }

    var t0 = performance.now();
    var lastNow = t0;

    function render(now) {
      var t = (now - t0) / 1000;
      var dt = Math.min(0.1, Math.max(0, (now - lastNow) / 1000));
      lastNow = now;
      if (still) t = 30;
      camera(t, dt);
      if (pointer || probe.target) aimProbe(now);
      var wave = waveAt(t);
      probe.amp += (probe.target - probe.amp) * (1 - Math.exp(-dt * 6));

      gl.clearColor(0.027, 0.070, 0.113, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

      // Земля, реки и улицы — без глубины, светятся сложением
      gl.disable(gl.DEPTH_TEST);
      gl.depthMask(false);
      gl.disable(gl.BLEND);
      setCommon(progs.ground, t, wave);
      gl.uniform4fv(progs.ground.u.uSrc, srcArr);
      gl.uniform1f(progs.ground.u.uSrcN, Math.min(8, city.sources.length));
      drawGeo(geo.ground, gl.TRIANGLES);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      setCommon(progs.water, t, wave);
      drawGeo(geo.water, gl.TRIANGLES);
      setCommon(progs.roads, t, wave);
      drawGeo(geo.roads, gl.TRIANGLES);

      // Дома — непрозрачные, с глубиной
      gl.disable(gl.BLEND);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.depthMask(true);
      gl.enable(gl.POLYGON_OFFSET_FILL);
      gl.polygonOffset(1, 1);
      setCommon(progs.walls, t, wave);
      drawGeo(geo.walls, gl.TRIANGLES);
      gl.disable(gl.POLYGON_OFFSET_FILL);

      // Рёбра и столбы света — поверх, сложением
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.depthMask(false);
      setCommon(progs.edges, t, wave);
      drawGeo(geo.edges, gl.LINES);
      setCommon(progs.beams, t, wave);
      gl.uniform3f(progs.beams.u.uRight, cam.right[0], cam.right[1], cam.right[2]);
      drawGeo(geo.beams, gl.TRIANGLES);
      gl.depthMask(true);

      placeLabels();
    }

    /* ---------- Подписи рек и координаты под курсором ---------- */

    var labelEls = [];
    if (labelsBox) {
      anchors.forEach(function (a) {
        var el = document.createElement('span');
        el.className = 'twin-label';
        el.textContent = a.text;
        labelsBox.appendChild(el);
        labelEls.push({ el: el, a: a, x: -1, y: -1, on: null });
      });
    }
    function placeLabels() {
      var m = cam.vp;
      labelEls.forEach(function (l) {
        var a = l.a;
        var cx = m[0] * a.x + m[4] * a.y + m[8] * a.z + m[12];
        var cy = m[1] * a.x + m[5] * a.y + m[9] * a.z + m[13];
        var cw = m[3] * a.x + m[7] * a.y + m[11] * a.z + m[15];
        var on = cw > 0;
        var x = 0;
        var y = 0;
        if (on) {
          x = (cx / cw * 0.5 + 0.5) * W;
          y = (1 - (cy / cw * 0.5 + 0.5)) * H;
          on = x > 24 && x < W - 24 && y > 24 && y < H - 24;
          var lw = l.w || (l.w = l.el.offsetWidth + 8);
          for (var b = 0; on && b < blockers.length; b++) {
            var q = blockers[b];
            if (x + lw > q[0] && x - 8 < q[2] && y > q[1] && y < q[3]) on = false;
          }
        }
        if (on !== l.on) { l.el.style.opacity = on ? '1' : '0'; l.on = on; }
        if (on && (Math.abs(x - l.x) > 0.4 || Math.abs(y - l.y) > 0.4)) {
          l.el.style.transform = 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px)';
          l.x = x;
          l.y = y;
        }
      });
    }

    function fmt(v) { return v.toFixed(4).replace('.', ','); }
    function showCoord(x, z) {
      if (!coordOut) return;
      var lat = city.lat0 + (-z) / KY;
      var lon = city.lon0 + x / KX;
      coordOut.textContent = fmt(lat) + '° с. ш. · ' + fmt(lon) + '° в. д.';
    }
    showCoord(0, 0);

    function groundAt(clientX, clientY) {
      var r = hero.getBoundingClientRect();
      var nx = ((clientX - r.left) / W) * 2 - 1;
      var ny = 1 - ((clientY - r.top) / H) * 2;
      if (!cam.inv) cam.inv = invert(cam.vp);
      var m = cam.inv;
      if (!m) return null;
      function un(z) {
        var x = m[0] * nx + m[4] * ny + m[8] * z + m[12];
        var y = m[1] * nx + m[5] * ny + m[9] * z + m[13];
        var zz = m[2] * nx + m[6] * ny + m[10] * z + m[14];
        var w = m[3] * nx + m[7] * ny + m[11] * z + m[15];
        return [x / w, y / w, zz / w];
      }
      var a = un(-1);
      var b = un(1);
      if (a[1] === b[1]) return null;
      var k = a[1] / (a[1] - b[1]);
      if (k < 0 || k > 1) return null;
      var gx = a[0] + (b[0] - a[0]) * k;
      var gz = a[2] + (b[2] - a[2]) * k;
      if (Math.sqrt(gx * gx + gz * gz) > (lite ? 1400 : 1900)) return null;
      return [gx, gz];
    }

    // Курсор запоминаем, а точку на земле пересчитываем каждый кадр:
    // город медленно вращается, и кольцо должно оставаться под курсором
    var pointer = null;
    var coordAt = 0;
    function aimProbe(now) {
      var g = pointer ? groundAt(pointer[0], pointer[1]) : null;
      probe.target = g ? 1 : 0;
      if (!g) return;
      probe.x = g[0];
      probe.z = g[1];
      if (now - coordAt > 90) { showCoord(g[0], g[1]); coordAt = now; }
    }
    if (!still && mq('(hover: hover) and (pointer: fine)')) {
      hero.addEventListener('pointermove', function (e) {
        if (e.pointerType !== 'mouse') return;
        var r = hero.getBoundingClientRect();
        par.tx = ((e.clientX - r.left) / W - 0.5) * 2;
        par.ty = ((e.clientY - r.top) / H - 0.5) * 2;
        var overText = e.target.closest && e.target.closest('.hero__in > *, .hero__hud');
        pointer = overText ? null : [e.clientX, e.clientY];
        if (!running) { aimProbe(performance.now()); render(performance.now()); }
        wake();
      }, { passive: true });
      hero.addEventListener('pointerleave', function () {
        par.tx = 0;
        par.ty = 0;
        pointer = null;
        probe.target = 0;
        showCoord(0, 0);
      });
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
    function wake() { if (!running) start(); }

    // Остановленную заранее сцену показываем уже собранной
    if (stoppedByUser()) t0 = performance.now() - 30000;

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
