/* МУП БГО ВО «Борисоглебские теплосети» — вариант 3 первого экрана.
   «Изотермы» — линии одинаковой температуры, как на тепловой карте.
   Поле медленно поднимается, как тёплый воздух; тёплый угол внизу справа,
   прохладный — под текстом. Курсор работает как источник тепла, щелчок
   или касание пускает тепловую волну. Один фрагментный шейдер на WebGL,
   без библиотек.

   Не запускается (остаётся спокойный фон из CSS), если нет WebGL, включена
   экономия трафика, устройство совсем слабое или включена версия для
   слабовидящих. Если человек просил уменьшить движение, рисуется один
   неподвижный кадр. */
(function () {
  'use strict';

  var hero = document.querySelector('[data-iso]');
  if (!hero) return;
  var canvas = hero.querySelector('canvas[data-scene]');
  var copy = hero.querySelector('.hero__in > div:first-child');
  if (!canvas || !copy || !window.requestAnimationFrame) return;

  var root = document.documentElement;
  function mq(q) { return !!(window.matchMedia && window.matchMedia(q).matches); }
  if (navigator.connection && navigator.connection.saveData) return;
  if ((navigator.hardwareConcurrency || 4) <= 2 && (navigator.deviceMemory || 4) <= 2) return;
  var still = mq('(prefers-reduced-motion: reduce)');

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
    var gl = canvas.getContext('webgl', {
      alpha: false, antialias: false, depth: false, stencil: false,
      powerPreference: 'low-power', preserveDrawingBuffer: false,
    });
    // Без производных линии не сгладить — тогда лучше спокойный фон
    if (!gl || !gl.getExtension('OES_standard_derivatives')) return;

    /* ---------- Шейдер ---------- */

    var VERT = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.0,1.0);}';

    var FRAG = [
      '#extension GL_OES_standard_derivatives : enable',
      '#ifdef GL_FRAGMENT_PRECISION_HIGH',
      'precision highp float;',
      '#else',
      'precision mediump float;',
      '#endif',
      'uniform vec2 uRes;',      // размер холста, px
      'uniform float uPx;',      // пикселей холста в одном CSS-пикселе
      'uniform vec2 uView;',     // размер первого экрана, CSS px
      'uniform float uTime;',
      'uniform float uScale;',   // размер «пятен» поля, CSS px
      'uniform float uLevels;',  // линий на единицу температуры
      'uniform vec2 uOrigin;',   // откуда расходятся линии при появлении
      'uniform float uReveal;',  // радиус появления, CSS px
      'uniform vec4 uSrc[4];',   // источники тепла: x, y, радиус, сила; [0] — курсор
      'uniform vec4 uWave[3];',  // волны от щелчка: x, y, радиус, сила
      'uniform vec4 uCalm;',     // прямоугольник текста: x0, y0, x1, y1
      'uniform float uCalmMin;', // насколько тише линии под текстом
      // Хеш без синуса (Dave Hoskins, MIT) — стабилен на мобильных GPU
      'vec2 hash2(vec2 p){',
      '  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));',
      '  p3 += dot(p3, p3.yzx + 33.33);',
      '  return fract((p3.xx + p3.yz) * p3.zy) * 2.0 - 1.0;',
      '}',
      'float gnoise(vec2 p){',
      '  vec2 i = floor(p); vec2 f = fract(p);',
      '  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);',
      '  float a = dot(hash2(i), f);',
      '  float b = dot(hash2(i + vec2(1.0, 0.0)), f - vec2(1.0, 0.0));',
      '  float c = dot(hash2(i + vec2(0.0, 1.0)), f - vec2(0.0, 1.0));',
      '  float d = dot(hash2(i + vec2(1.0, 1.0)), f - vec2(1.0, 1.0));',
      '  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);',
      '}',
      'const mat2 ROT = mat2(1.6, 1.2, -1.2, 1.6);',
      'float fbm(vec2 p){',
      '  float s = 0.0; float a = 0.5;',
      '  for (int i = 0; i < 3; i++) { s += a * gnoise(p); p = ROT * p; a *= 0.5; }',
      '  return s;',
      '}',
      // Палитра: прохладный синий → песочный → тёплый оранжевый → терракота
      'vec3 ramp(float x){',
      '  vec3 c0 = vec3(0.114, 0.388, 0.667);',
      '  vec3 c1 = vec3(0.420, 0.600, 0.765);',
      '  vec3 c2 = vec3(0.745, 0.620, 0.500);',
      '  vec3 c3 = vec3(0.886, 0.494, 0.243);',
      '  vec3 c4 = vec3(0.690, 0.259, 0.071);',
      '  if (x < 0.25) return mix(c0, c1, x * 4.0);',
      '  if (x < 0.5) return mix(c1, c2, x * 4.0 - 1.0);',
      '  if (x < 0.75) return mix(c2, c3, x * 4.0 - 2.0);',
      '  return mix(c3, c4, x * 4.0 - 3.0);',
      '}',
      'float field(vec2 p){',
      '  vec2 q = p / uScale;',
      '  vec2 rise = vec2(0.0, uTime * 0.045);', // узор уходит вверх, как тёплый воздух
      '  vec2 w = vec2(fbm(q + rise + vec2(1.7, 9.2)), fbm(q * 1.1 + rise * 1.3 + vec2(8.3, 2.8)));',
      '  float t = fbm(q + 1.7 * w + rise * 0.6) * 1.15;',
      '  vec2 uv = p / uView;',
      '  t += (uv.x * 0.62 + uv.y * 0.38) * 0.95 - 0.36;', // теплее к правому нижнему углу
      '  for (int i = 0; i < 4; i++) {',
      '    vec2 d = p - uSrc[i].xy;',
      '    t += uSrc[i].w * exp(-dot(d, d) / (uSrc[i].z * uSrc[i].z));',
      '  }',
      '  for (int i = 0; i < 3; i++) {',
      '    float r = length(p - uWave[i].xy) - uWave[i].z;',
      '    t += uWave[i].w * exp(-r * r / 2600.0);',
      '  }',
      '  return t;',
      '}',
      // Подсветка там, где человек «греет» поле: у курсора и на гребне волны
      'float glow(vec2 p){',
      '  vec2 d = p - uSrc[0].xy;',
      '  float g = uSrc[0].w * 1.7 * exp(-dot(d, d) / (uSrc[0].z * uSrc[0].z * 2.4));',
      '  for (int i = 0; i < 3; i++) {',
      '    float r = length(p - uWave[i].xy) - uWave[i].z;',
      '    g += uWave[i].w * 2.2 * exp(-r * r / 9000.0);',
      '  }',
      '  return clamp(g, 0.0, 1.0);',
      '}',
      'void main(){',
      '  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uPx;',
      '  float t = field(p);',
      '  float v = t * uLevels;',
      '  float fw = fwidth(v);',
      '  float f = fract(v);',
      '  float dist = min(f, 1.0 - f) / max(fw, 1e-4);', // до ближайшей линии, px холста
      '  float k = floor(v + 0.5);',
      '  float major = 1.0 - step(0.5, mod(k + 400.0, 4.0));', // каждая четвёртая — основная
      '  float halfW = mix(0.5, 0.9, major) * uPx;',
      '  float cov = clamp(halfW + 0.5 - dist, 0.0, 1.0);',
      '  cov *= 1.0 - smoothstep(0.3, 0.65, fw);', // где линии сгущаются — не рябит
      '  float x = clamp(t * 0.55 + 0.3, 0.0, 1.0);',
      '  vec3 tint = ramp(x);',
      '  vec3 paper = mix(vec3(0.957, 0.969, 0.980), vec3(0.985, 0.962, 0.938), smoothstep(0.35, 1.0, x));',
      '  vec3 col = mix(paper, tint, 0.035 + 0.075 * x);', // лёгкая тепловая заливка
      // Под текстом линии тише, чтобы читалось
      '  vec2 o = max(max(uCalm.xy - p, p - uCalm.zw), 0.0);',
      '  float g = glow(p);',
      '  float calm = max(mix(uCalmMin, 1.0, smoothstep(0.0, 170.0, length(o))), g * 0.9);',
      '  float grow = 1.0 - smoothstep(uReveal - 360.0, uReveal, length(p - uOrigin));',
      '  float a = min(1.0, cov * mix(0.5, 0.9, major) * calm * grow * (1.0 + 0.7 * g));',
      '  vec3 ink = mix(tint * 0.8, ramp(min(1.0, x + 0.3)) * 0.86, g);', // у курсора линии теплее
      '  col = mix(col, ink, a);',
      '  col += (hash2(gl_FragCoord.xy).x * 0.5) / 255.0;', // без полос на градиенте
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
    ['uRes', 'uPx', 'uView', 'uTime', 'uScale', 'uLevels', 'uOrigin', 'uReveal', 'uSrc', 'uWave', 'uCalm', 'uCalmMin'].forEach(function (name) {
      U[name] = gl.getUniformLocation(prog, name);
    });

    /* ---------- Размеры ---------- */

    var coarse = mq('(pointer: coarse)') || window.innerWidth < 768;
    var FRAME_MS = coarse ? 1000 / 30 : 1000 / 60; // на телефоне 30 кадров — бережёт батарею
    var quality = 1;
    var W = 1;
    var H = 1;
    var reach = 1; // от точки появления до дальнего угла, CSS px

    function resize() {
      var r = hero.getBoundingClientRect();
      var dpr = window.devicePixelRatio || 1;
      var px = (coarse ? Math.min(dpr, 2) * 0.75 : Math.min(dpr, 1.5)) * quality;
      W = Math.max(1, r.width);
      H = Math.max(1, r.height);
      var w = Math.max(1, Math.round(W * px));
      var h = Math.max(1, Math.round(H * px));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      gl.viewport(0, 0, w, h);
      gl.uniform2f(U.uRes, w, h);
      gl.uniform1f(U.uPx, w / W);
      gl.uniform2f(U.uView, W, H);
      gl.uniform1f(U.uScale, Math.max(240, Math.min(560, Math.min(W, H) * 0.62)));
      gl.uniform1f(U.uLevels, coarse ? 7 : 8);
      // На телефоне текст занимает почти весь экран — там линии приглушаем меньше
      gl.uniform1f(U.uCalmMin, W < 980 ? 0.38 : 0.2);

      // Текст с запасом: под ним линии тише
      var c = copy.getBoundingClientRect();
      var pad = 28;
      gl.uniform4f(U.uCalm, c.left - r.left - pad, c.top - r.top - pad, c.right - r.left + pad, c.bottom - r.top + pad);

      origin = [W * 0.9, H * 1.02];
      gl.uniform2f(U.uOrigin, origin[0], origin[1]);
      reach = Math.sqrt(origin[0] * origin[0] + origin[1] * origin[1]) + 400;
      if (!running) draw(lastNow);
    }

    /* ---------- Тепло: фон, курсор, волны ---------- */

    var origin = [0, 0];
    var src = new Float32Array(16);
    var waves = new Float32Array(12);
    var pulses = []; // { x, y, t }

    // Курсор: позиция догоняет мышь плавно, сила растёт от движения и гаснет
    var ptr = { x: -9999, y: -9999, tx: -9999, ty: -9999, amp: 0, boost: 0, inside: false };

    function heroPoint(e) {
      var r = hero.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    }

    if (!still) {
      if (mq('(hover: hover) and (pointer: fine)')) {
        hero.addEventListener('pointermove', function (e) {
          if (e.pointerType !== 'mouse') return;
          var p = heroPoint(e);
          if (!ptr.inside) { ptr.x = p[0]; ptr.y = p[1]; }
          var dx = p[0] - ptr.tx;
          var dy = p[1] - ptr.ty;
          if (ptr.inside) ptr.boost = Math.min(0.42, ptr.boost + Math.sqrt(dx * dx + dy * dy) * 0.0022);
          ptr.tx = p[0];
          ptr.ty = p[1];
          ptr.inside = true;
          wake();
        }, { passive: true });
        hero.addEventListener('pointerleave', function () { ptr.inside = false; });
      }
      // Щелчок или касание — тепловая волна (не по кнопкам и ссылкам).
      // click, а не pointerdown: прокрутка пальцем волну не пускает.
      hero.addEventListener('click', function (e) {
        if (e.target.closest && e.target.closest('a, button, input, select, textarea, label')) return;
        var p = heroPoint(e);
        pulses.push({ x: p[0], y: p[1], t: clock() });
        if (pulses.length > 3) pulses.shift();
        wake();
      }, { passive: true });
    }

    function clock() { return (performance.now() - t0) / 1000; }

    function update(t, dt) {
      // Фоновые источники — тёплый угол; медленно «дышат»
      var R = Math.min(W, H);
      var s = [
        W * (0.86 + 0.035 * Math.sin(t * 0.11)), H * (0.92 + 0.04 * Math.cos(t * 0.083)), R * 0.46, 0.5,
        W * (1.02 + 0.03 * Math.cos(t * 0.07 + 1.3)), H * (0.42 + 0.05 * Math.sin(t * 0.06)), R * 0.36, 0.34,
        W * (0.56 + 0.05 * Math.sin(t * 0.05 + 2.1)), H * (1.08 + 0.02 * Math.cos(t * 0.09)), R * 0.4, 0.3,
      ];
      for (var i = 0; i < 12; i++) src[i + 4] = s[i];

      var k = 1 - Math.exp(-dt * 9); // догоняет за ~0,3 с
      ptr.x += (ptr.tx - ptr.x) * k;
      ptr.y += (ptr.ty - ptr.y) * k;
      ptr.boost *= Math.exp(-dt * 1.6);
      var target = ptr.inside ? 0.42 + ptr.boost : 0;
      ptr.amp += (target - ptr.amp) * (1 - Math.exp(-dt * 3.2));
      src[0] = ptr.x;
      src[1] = ptr.y;
      src[2] = coarse ? 120 : 150;
      src[3] = ptr.amp;

      for (var j = 0; j < 3; j++) {
        var pl = pulses[j];
        var age = pl ? t - pl.t : 99;
        waves[j * 4] = pl ? pl.x : -9999;
        waves[j * 4 + 1] = pl ? pl.y : -9999;
        waves[j * 4 + 2] = age * 340;
        waves[j * 4 + 3] = pl ? 0.62 * Math.exp(-age * 1.05) : 0;
      }
      pulses = pulses.filter(function (q) { return t - q.t < 4; });
    }

    /* ---------- Кадр ---------- */

    var t0 = performance.now();
    var lastNow = t0;
    var introStart = -1;

    // Кнопку «Остановить анимацию» main.js подключает позже этого скрипта —
    // сохранённый выбор читаем сами, чтобы не мелькнуло начало анимации.
    try {
      if (localStorage.getItem('bgts-scene-stopped') === '1') canvas.setAttribute('data-stopped', '');
    } catch (e) { /* приватный режим */ }
    // Линии расходятся из тёплого угла один раз; если сцена уже остановлена —
    // сразу целиком
    var introDone = still || stoppedByUser();

    function draw(now) {
      var t = (now - t0) / 1000;
      var dt = Math.min(0.1, Math.max(0, (now - lastNow) / 1000));
      lastNow = now;
      var reveal = reach;
      if (!introDone) {
        if (introStart < 0) introStart = t;
        var e = Math.min(1, (t - introStart) / 2.6);
        reveal = reach * (1 - Math.pow(1 - e, 3));
        if (e >= 1) introDone = true;
      }
      update(still ? 18 : t, dt);
      gl.uniform1f(U.uTime, still ? 18 : t);
      gl.uniform1f(U.uReveal, reveal);
      gl.uniform4fv(U.uSrc, src);
      gl.uniform4fv(U.uWave, waves);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    var running = false;
    var raf = 0;
    var lastFrame = 0;
    var visible = true;
    var slow = 0;
    var frames = 0;

    function stoppedByUser() { return canvas.hasAttribute('data-stopped'); }
    function blocked() {
      return still || stoppedByUser() || !visible || document.hidden || root.getAttribute('data-vision') === 'on';
    }

    function loop(now) {
      raf = requestAnimationFrame(loop);
      var gap = now - lastFrame;
      if (gap < FRAME_MS - 1) return;
      lastFrame = now;
      draw(now);
      // Если устройство не успевает, дважды снижаем разрешение холста
      if (gap < 250) {
        frames++;
        if (gap > FRAME_MS * 1.6) slow++;
        if (frames >= 90) {
          if (slow > 45 && quality > 0.65) { quality *= 0.8; resize(); }
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

    resize();
    draw(performance.now());
    hero.classList.add('is-live');
    sync();

    new MutationObserver(sync).observe(canvas, { attributes: true, attributeFilter: ['data-stopped'] });
    new MutationObserver(function () {
      sync();
      if (root.getAttribute('data-vision') !== 'on') resize(); // вернулись из версии для слабовидящих
    }).observe(root, { attributes: true, attributeFilter: ['data-vision'] });
    document.addEventListener('visibilitychange', sync);
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        visible = entries[0].isIntersecting;
        sync();
      }).observe(hero);
    }
    if ('ResizeObserver' in window) {
      var ro = new ResizeObserver(function () { resize(); });
      ro.observe(hero);
      ro.observe(copy);
    } else {
      window.addEventListener('resize', resize);
    }
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(resize);

    canvas.addEventListener('webglcontextlost', function (e) {
      e.preventDefault();
      stop();
      hero.classList.remove('is-live'); // вернётся спокойный фон из CSS
    });
  }
})();
