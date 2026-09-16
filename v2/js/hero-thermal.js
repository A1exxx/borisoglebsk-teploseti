/* МУП БГО ВО «Борисоглебские теплосети» — вариант 2 первого экрана.
   Схема теплосети на WebGL: свечение трасс, тепловые импульсы от котельной,
   тепловой сканер по городу, «тёплый» курсор. Без библиотек.

   Геометрия берётся из data-network и data-buildings той же SVG-сцены,
   которая лежит поверх холста, поэтому свечение совпадает с трубами и домами.

   Не запускается — и остаётся статичная SVG-сцена, — если: нет WebGL,
   человек просил уменьшить движение, включена экономия трафика, устройство
   совсем слабое или включена версия для слабовидящих. */
(function () {
  'use strict';

  var hero = document.querySelector('[data-thermal]');
  if (!hero) return;
  var box = hero.querySelector('.hero__thermal');
  var svg = hero.querySelector('svg[data-network]');
  var canvas = hero.querySelector('.hero__canvas');
  if (!box || !svg || !canvas || !window.requestAnimationFrame) return;

  var root = document.documentElement;
  function mq(q) { return !!(window.matchMedia && window.matchMedia(q).matches); }
  if (mq('(prefers-reduced-motion: reduce)')) return;
  if (navigator.connection && navigator.connection.saveData) return;
  if ((navigator.hardwareConcurrency || 4) <= 2 && (navigator.deviceMemory || 4) <= 2) return;

  // Версия для слабовидящих включена ещё до загрузки — сцену не готовим,
  // пока человек её не выключит.
  var visionAtLoad = false;
  try {
    var saved = JSON.parse(localStorage.getItem('bgts-vision'));
    visionAtLoad = !!(saved && saved.on);
  } catch (e) { /* приватный режим */ }
  if (visionAtLoad) {
    var waiter = new MutationObserver(function () {
      if (root.getAttribute('data-vision') !== 'on') { waiter.disconnect(); boot(); }
    });
    waiter.observe(root, { attributes: true, attributeFilter: ['data-vision'] });
  } else {
    boot();
  }

  function boot() {
    var net, footprints;
    try {
      net = JSON.parse(svg.getAttribute('data-network'));
      footprints = JSON.parse(svg.getAttribute('data-buildings'));
    } catch (e) {
      return;
    }

    var gl = canvas.getContext('webgl', {
      alpha: false, antialias: false, depth: false, stencil: false,
      powerPreference: 'low-power', preserveDrawingBuffer: false,
    });
    if (!gl) return;

    /* ---------- Шейдеры ---------- */

    var VERT = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.0,1.0);}';

    var FRAG = [
      '#ifdef GL_FRAGMENT_PRECISION_HIGH',
      'precision highp float;',
      '#else',
      'precision mediump float;',
      '#endif',
      'uniform vec2 uRes;',      // размер холста, px
      'uniform float uBand;',    // высота полосы с городом, px холста
      'uniform float uPx;',      // пикселей холста в одном CSS-пикселе
      'uniform vec2 uSize;',     // размер сцены (1600×560)
      'uniform sampler2D uTex;', // R — трассы, G — путь от котельной, B — дома
      'uniform float uWave;',    // фаза тепловых импульсов 0..1
      'uniform float uScan;',    // положение теплового сканера по X сцены
      'uniform float uNoise;',
      'uniform vec2 uPointer;',
      'uniform float uHeat;',
      'const vec3 BASE = vec3(0.0627, 0.1608, 0.2471);',
      'float hash(vec2 q){return fract(sin(dot(q, vec2(127.1, 311.7))) * 43758.5453);}',
      'float noise(vec2 q){vec2 i=floor(q);vec2 f=fract(q);f=f*f*(3.0-2.0*f);',
      '  return mix(mix(hash(i),hash(i+vec2(1.0,0.0)),f.x),mix(hash(i+vec2(0.0,1.0)),hash(i+vec2(1.0,1.0)),f.x),f.y);}',
      'vec3 thermal(float t){',
      '  t = clamp(t, 0.0, 1.0);',
      '  vec3 c1 = vec3(0.07, 0.42, 0.55);',
      '  vec3 c2 = vec3(0.93, 0.55, 0.23);',
      '  vec3 c3 = vec3(1.0, 0.92, 0.78);',
      '  if (t < 0.45) return mix(BASE, c1, t / 0.45);',
      '  if (t < 0.8) return mix(c1, c2, (t - 0.45) / 0.35);',
      '  return mix(c2, c3, (t - 0.8) / 0.2);',
      '}',
      'void main(){',
      // Координаты сцены: как у SVG в нижней полосе («cover», по центру по X,
      // прижато к низу). Выше полосы dy < 0 — там только сетка и сканер.
      '  float s = max(uRes.x / uSize.x, uBand / uSize.y);',
      '  float dx = gl_FragCoord.x / s + (uSize.x - uRes.x / s) * 0.5;',
      '  float dy = uSize.y - gl_FragCoord.y / s;',
      '  vec2 uv = vec2(dx / uSize.x, dy / uSize.y);',
      '  vec3 tex = texture2D(uTex, uv).rgb;',
      '  vec3 col = BASE;',
      // Точечная сетка, как на экране диспетчера
      '  vec2 cell = mod(gl_FragCoord.xy / uPx, 26.0) - 13.0;',
      '  float dotv = 1.0 - smoothstep(0.55, 1.45, length(cell));',
      '  float band = exp(-abs(dx - uScan) / 70.0);',
      '  float line = exp(-abs(dx - uScan) / 5.0);',
      '  float pr = exp(-length(vec2(dx, dy) - uPointer) / 170.0) * uHeat;',
      '  col += vec3(0.50, 0.76, 0.95) * dotv * (0.06 + 0.26 * band + 0.42 * pr);',
      // Трассы и тепловые импульсы от котельной к домам
      '  float netv = tex.r;',
      '  col += vec3(0.30, 0.64, 0.88) * netv * 0.34;',
      '  float onNet = step(0.03, tex.g);',
      '  float ph = tex.g * 4.0 - uWave * 4.0;',
      '  float w = pow(max(0.0, sin(ph * 6.2831853)), 14.0) * onNet;',
      '  col += thermal(0.78 + 0.22 * w) * netv * w * 1.25;',
      // Дома в «тепловизоре»: мягкий шум и вспышка при проходе сканера
      '  float b = tex.b;',
      '  float n = noise(vec2(dx, dy) * 0.011 + vec2(0.0, uNoise));',
      '  float heat = b * (0.34 + 0.24 * n) + b * band * 0.78;',
      '  col = mix(col, thermal(heat), clamp(b, 0.0, 1.0) * 0.82);',
      '  col += vec3(0.45, 0.80, 1.0) * (line * 0.16 + band * 0.035);',
      '  col += thermal(0.7) * pr * 0.10;',
      // Под текстом слева сверху — спокойнее, чтобы читалось
      '  float calm = (1.0 - smoothstep(0.34, 0.6, uv.x)) * (1.0 - smoothstep(0.32, 0.68, uv.y));',
      '  col = mix(col, BASE, calm * 0.6);',
      '  gl_FragColor = vec4(col, 1.0);',
      '}',
    ].join('\n');

    function shader(type, src) {
      var sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      return gl.getShaderParameter(sh, gl.COMPILE_STATUS) ? sh : null;
    }
    var vs = shader(gl.VERTEX_SHADER, VERT);
    var fs = shader(gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) return;
    var prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
    gl.useProgram(prog);

    // Один треугольник на весь холст
    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    var loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    var U = {};
    ['uRes', 'uBand', 'uPx', 'uSize', 'uTex', 'uWave', 'uScan', 'uNoise', 'uPointer', 'uHeat'].forEach(function (name) {
      U[name] = gl.getUniformLocation(prog, name);
    });

    /* ---------- Карта свечения из геометрии SVG ---------- */

    var TW = 1024;
    var TH = Math.round(TW * net.h / net.w);
    var K = TW / net.w;

    function layer(draw) {
      var c = document.createElement('canvas');
      c.width = TW;
      c.height = TH;
      var x = c.getContext('2d');
      x.scale(K, K);
      draw(x);
      return x.getImageData(0, 0, TW, TH).data;
    }
    function polyline(x, pts) {
      x.beginPath();
      for (var i = 0; i < pts.length; i++) {
        if (i) x.lineTo(pts[i][0], pts[i][1]); else x.moveTo(pts[i][0], pts[i][1]);
      }
    }

    // R: трассы со свечением
    var red = layer(function (x) {
      x.strokeStyle = '#fff';
      x.lineJoin = 'round';
      x.lineCap = 'round';
      x.shadowColor = '#fff';
      x.shadowBlur = 9; // в пикселях текстуры, масштаб на него не влияет
      x.lineWidth = 2.6;
      net.lines.forEach(function (l) { polyline(x, l.pts); x.stroke(); x.stroke(); });
    });

    // G: путь от котельной — по нему бегут импульсы
    var green = layer(function (x) {
      x.lineCap = 'butt';
      x.lineWidth = 14;
      net.lines.forEach(function (l) {
        var d = l.d0;
        for (var i = 1; i < l.pts.length; i++) {
          var a = l.pts[i - 1];
          var b = l.pts[i];
          var len = Math.sqrt((b[0] - a[0]) * (b[0] - a[0]) + (b[1] - a[1]) * (b[1] - a[1]));
          if (!len) continue;
          var g0 = Math.round((0.06 + 0.94 * d / net.max) * 255);
          var g1 = Math.round((0.06 + 0.94 * (d + len) / net.max) * 255);
          var grad = x.createLinearGradient(a[0], a[1], b[0], b[1]);
          grad.addColorStop(0, 'rgb(0,' + g0 + ',0)');
          grad.addColorStop(1, 'rgb(0,' + g1 + ',0)');
          x.strokeStyle = grad;
          x.beginPath();
          x.moveTo(a[0], a[1]);
          x.lineTo(b[0], b[1]);
          x.stroke();
          d += len;
        }
      });
    });

    // B: силуэты домов, слегка размытые
    var blue = layer(function (x) {
      x.fillStyle = '#fff';
      x.shadowColor = '#fff';
      x.shadowBlur = 7;
      footprints.forEach(function (poly) { polyline(x, poly); x.closePath(); x.fill(); });
    });

    var data = new Uint8Array(TW * TH * 4);
    for (var i = 0; i < data.length; i += 4) {
      data[i] = red[i + 3];
      data[i + 1] = green[i + 3] > 140 ? green[i + 1] : 0;
      data[i + 2] = blue[i + 3];
      data[i + 3] = 255;
    }

    var tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, TW, TH, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.uniform1i(U.uTex, 0);
    gl.uniform2f(U.uSize, net.w, net.h);

    /* ---------- Размер холста ---------- */

    var coarse = mq('(pointer: coarse)') || window.innerWidth < 768;
    var FRAME_MS = coarse ? 1000 / 30 : 1000 / 60; // на телефоне 30 кадров — хватает и бережёт батарею
    var pxScale = 1;

    function resize() {
      var r = hero.getBoundingClientRect();
      var band = box.getBoundingClientRect().height;
      var dpr = window.devicePixelRatio || 1;
      pxScale = coarse ? Math.min(dpr, 2) * 0.6 : Math.min(dpr, 1.5) * 0.8;
      var w = Math.max(1, Math.round(r.width * pxScale));
      var h = Math.max(1, Math.round(r.height * pxScale));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      gl.viewport(0, 0, w, h);
      gl.uniform2f(U.uRes, w, h);
      gl.uniform1f(U.uBand, Math.min(h, band * pxScale));
      gl.uniform1f(U.uPx, pxScale);
      if (!running) draw(lastT);
    }

    /* ---------- Курсор греет сетку (только мышь) ---------- */

    var pointer = [-9999, -9999];
    var pointerTarget = [-9999, -9999];
    var heat = 0;
    var heatTarget = 0;
    var lastMove = 0;

    if (mq('(hover: hover) and (pointer: fine)')) {
      hero.addEventListener('pointermove', function (e) {
        var r = hero.getBoundingClientRect();
        var s = Math.max(r.width / net.w, box.getBoundingClientRect().height / net.h);
        pointerTarget = [
          (e.clientX - r.left) / s + (net.w - r.width / s) / 2,
          net.h - (r.bottom - e.clientY) / s,
        ];
        if (heat < 0.01) pointer = pointerTarget.slice();
        heatTarget = 1;
        lastMove = performance.now();
        if (!running) start();
      }, { passive: true });
      hero.addEventListener('pointerleave', function () { heatTarget = 0; });
    }

    /* ---------- Кадр ---------- */

    var t0 = performance.now();
    var lastT = 0;

    function draw(t) {
      lastT = t;
      var scanT = t % 11;
      var scan = scanT < 6.5 ? -300 + (scanT / 6.5) * 2200 : -99999;
      if (performance.now() - lastMove > 1600) heatTarget = 0;
      heat += (heatTarget - heat) * 0.06;
      pointer[0] += (pointerTarget[0] - pointer[0]) * 0.14;
      pointer[1] += (pointerTarget[1] - pointer[1]) * 0.14;
      gl.uniform1f(U.uWave, (t / 6) % 1);
      gl.uniform1f(U.uScan, scan);
      gl.uniform1f(U.uNoise, (t * 0.07) % 100);
      gl.uniform2f(U.uPointer, pointer[0], pointer[1]);
      gl.uniform1f(U.uHeat, heat);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    var running = false;
    var raf = 0;
    var lastFrame = 0;
    var visible = true;

    function stoppedByUser() { return svg.hasAttribute('data-stopped'); }
    function blocked() {
      return stoppedByUser() || !visible || document.hidden || root.getAttribute('data-vision') === 'on';
    }

    function loop(now) {
      raf = requestAnimationFrame(loop);
      if (now - lastFrame < FRAME_MS - 1) return;
      lastFrame = now;
      draw((now - t0) / 1000);
    }
    function start() {
      if (running || blocked()) return;
      running = true;
      raf = requestAnimationFrame(loop);
    }
    function stop() {
      running = false;
      cancelAnimationFrame(raf);
    }
    function sync() { if (blocked()) stop(); else start(); }

    resize();
    draw(0);
    hero.classList.add('is-live');

    // Кнопка «Остановить анимацию», версия для слабовидящих, видимость
    var stored = false;
    try { stored = localStorage.getItem('bgts-scene-stopped') === '1'; } catch (e) { /* приватный режим */ }
    if (!stored) start();

    new MutationObserver(sync).observe(svg, { attributes: true, attributeFilter: ['data-stopped'] });
    new MutationObserver(sync).observe(root, { attributes: true, attributeFilter: ['data-vision'] });
    document.addEventListener('visibilitychange', sync);
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        visible = entries[0].isIntersecting;
        sync();
      }).observe(hero);
    }
    if ('ResizeObserver' in window) {
      var ro = new ResizeObserver(resize);
      ro.observe(hero);
      ro.observe(box);
    } else {
      window.addEventListener('resize', resize);
    }

    canvas.addEventListener('webglcontextlost', function (e) {
      e.preventDefault();
      stop();
      hero.classList.remove('is-live'); // вернётся статичная сцена
    });
  }
})();
