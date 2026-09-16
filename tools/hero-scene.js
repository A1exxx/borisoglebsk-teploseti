'use strict';
/**
 * Генератор сцены для главного экрана: котельная, дома и теплотрасса.
 *
 * Зачем отдельный скрипт: окон больше сотни, и у каждого своя задержка
 * «загорания» — она зависит от расстояния до котельной, чтобы казалось,
 * что тепло доходит до домов по очереди. Руками такое не поддержать.
 * Случайность детерминированная: при повторном запуске разметка та же,
 * и в git не появляется ложных изменений.
 *
 * Запуск: node tools/hero-scene.js [--thermal]  → печатает <svg> в stdout.
 *   без флага   — вариант 1: полоса 1600×220 под текстом первого экрана;
 *   --thermal   — вариант 2: сцена 1600×560 со схемой трасс над городом.
 *                 Геометрия трасс и домов выгружается в data-network и
 *                 data-buildings: из неё public/js/hero-thermal.js строит
 *                 карту свечения для шейдера — совпадение по построению.
 * Результат вставлен в src/pages/index.html между метками HERO-SCENE.
 */

const THERMAL = process.argv.includes('--thermal');
const W = 1600;
const H = THERMAL ? 560 : 220;
const DY = H - 220; // город всегда внизу сцены
const GROUND = 204;
const PIPE_Y = 196;
const LOOP_TOP = 170;
const BOILER_CX = 684;

// Детерминированный генератор (mulberry32)
let seed = 36040867;
function rnd() {
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

const r1 = (n) => Math.round(n * 10) / 10;

// Застройка слева направо: частный дом, двухэтажка, пятиэтажка, котельная
const buildings = [
  { x: 30, w: 72, type: 'house' },
  { x: 138, w: 196, type: 'block' },
  { x: 356, w: 72, type: 'house' },
  { x: 464, w: 124, type: 'low' },
  { x: 618, w: 132, type: 'boiler' },
  { x: 786, w: 196, type: 'block' },
  { x: 1018, w: 124, type: 'low' },
  { x: 1164, w: 72, type: 'house' },
  { x: 1272, w: 196, type: 'block' },
  { x: 1490, w: 72, type: 'house' },
];

const shapes = [];
const windows = [];
const footprints = []; // контуры зданий в координатах сцены — для шейдера

function windowAt(x, y, w, h) {
  windows.push({ x, y, w, h });
}

for (const b of buildings) {
  if (b.type === 'house') {
    const top = GROUND - 40;
    shapes.push(`<path class="bld" d="M${b.x} ${GROUND}V${top}L${b.x + b.w / 2} ${top - 24}L${b.x + b.w} ${top}V${GROUND}Z"/>`);
    footprints.push([[b.x, GROUND], [b.x, top], [b.x + b.w / 2, top - 24], [b.x + b.w, top], [b.x + b.w, GROUND]]);
    windowAt(b.x + 14, top + 12, 13, 13);
    windowAt(b.x + b.w - 27, top + 12, 13, 13);
  } else if (b.type === 'low') {
    const top = GROUND - 64;
    shapes.push(`<rect class="bld" x="${b.x}" y="${top}" width="${b.w}" height="64"/>`);
    shapes.push(`<path class="edge" d="M${b.x - 4} ${top}H${b.x + b.w + 4}"/>`);
    footprints.push([[b.x, GROUND], [b.x, top], [b.x + b.w, top], [b.x + b.w, GROUND]]);
    for (let row = 0; row < 2; row++) {
      for (let col = 0; col < 4; col++) {
        windowAt(b.x + 14 + col * 27, top + 12 + row * 26, 13, 14);
      }
    }
  } else if (b.type === 'block') {
    const top = GROUND - 112;
    shapes.push(`<rect class="bld" x="${b.x}" y="${top}" width="${b.w}" height="112"/>`);
    shapes.push(`<path class="edge" d="M${b.x - 3} ${top}H${b.x + b.w + 3}"/>`);
    footprints.push([[b.x, GROUND], [b.x, top], [b.x + b.w, top], [b.x + b.w, GROUND]]);
    for (let row = 0; row < 5; row++) {
      for (let col = 0; col < 7; col++) {
        windowAt(b.x + 14 + col * 25.5, top + 10 + row * 20, 12, 11);
      }
    }
  } else if (b.type === 'boiler') {
    const top = GROUND - 56;
    shapes.push(`<rect class="bld" x="${b.x}" y="${top}" width="${b.w}" height="56"/>`);
    // труба котельной — сужается кверху
    shapes.push(`<path class="bld" d="M${b.x + 98} ${top}L${b.x + 101} 50H${b.x + 113}L${b.x + 116} ${top}Z"/>`);
    shapes.push(`<path class="edge" d="M${b.x + 99} 62H${b.x + 115}M${b.x + 100} 74H${b.x + 114}"/>`);
    footprints.push([[b.x, GROUND], [b.x, top], [b.x + b.w, top], [b.x + b.w, GROUND]]);
    footprints.push([[b.x + 98, top], [b.x + 101, 50], [b.x + 113, 50], [b.x + 116, top]]);
    // ворота и окно топки
    shapes.push(`<rect class="bld" x="${b.x + 16}" y="${GROUND - 34}" width="30" height="34"/>`);
    shapes.push(`<rect class="fire" x="${b.x + 60}" y="${top + 14}" width="26" height="14" rx="1.5"/>`);
  }
}

// Окна: у каждого задержка по расстоянию до котельной; часть остаётся тёмной
const winMarkup = [];
let twinkles = 0;
for (const w of windows) {
  const cx = w.x + w.w / 2;
  winMarkup.push(`<rect class="win" x="${r1(w.x)}" y="${w.y}" width="${w.w}" height="${w.h}"/>`);
  if (rnd() < 0.17) continue; // дома никого — окно тёмное
  const dist = Math.abs(cx - BOILER_CX) / (W - BOILER_CX);
  const delay = r1(0.5 + dist * 3.4 + rnd() * 0.35);
  const opacity = r1(0.6 + rnd() * 0.3);
  let cls = rnd() < 0.3 ? 'w w2' : 'w';
  if (twinkles < 9 && rnd() < 0.09) { cls += ' tw'; twinkles++; }
  winMarkup.push(`<rect class="${cls}" style="--d:${delay}s;--o:${opacity}" x="${r1(w.x)}" y="${w.y}" width="${w.w}" height="${w.h}"/>`);
}

// Теплотрасса с П-образными компенсаторами
const right = `M750 ${PIPE_Y}H758V${LOOP_TOP}H778V${PIPE_Y}H990V${LOOP_TOP}H1010V${PIPE_Y}H1244V${LOOP_TOP}H1264V${PIPE_Y}H${W}`;
const left = `M618 ${PIPE_Y}H456V${LOOP_TOP}H436V${PIPE_Y}H130V${LOOP_TOP}H110V${PIPE_Y}H0`;

// Опоры трубы на прямых участках
const supports = [];
for (let x = 40; x < W; x += 64) {
  const nearLoop = [110, 130, 436, 456, 758, 778, 990, 1010, 1244, 1264].some((lx) => Math.abs(lx - x) < 14);
  const inBoiler = x > 612 && x < 756;
  if (!nearLoop && !inBoiler) supports.push(`M${x} ${PIPE_Y + 3}V${GROUND}`);
}

const cityMarkup = `<g class="steam">
      <circle cx="728" cy="44" r="8"/><circle cx="728" cy="44" r="9"/><circle cx="728" cy="44" r="7"/>
    </g>
    <g>
      ${shapes.join('\n      ')}
    </g>
    <g>
      ${winMarkup.join('\n      ')}
    </g>
    <path class="ground" d="M0 ${GROUND}H${W}"/>
    <path class="support" d="${supports.join('')}"/>
    <path class="pipe" d="${left}"/>
    <path class="pipe" d="${right}"/>
    <path class="pipe-line" d="${left}"/>
    <path class="pipe-line" d="${right}"/>
    <path class="pulse pulse--glow pulse--l" pathLength="1000" d="${left}"/>
    <path class="pulse pulse--l" pathLength="1000" d="${left}"/>
    <path class="pulse pulse--glow pulse--r" pathLength="1000" d="${right}"/>
    <path class="pulse pulse--r" pathLength="1000" d="${right}"/>`;

if (!THERMAL) {
  const svg = `<svg class="hero__scene u-decor" viewBox="0 0 ${W} 220" preserveAspectRatio="xMidYMax slice" aria-hidden="true" focusable="false">
    <defs>
      <radialGradient id="heroGlow" cx="50%" cy="100%" r="60%">
        <stop offset="0" stop-color="#e8783c" stop-opacity=".34"/>
        <stop offset="1" stop-color="#e8783c" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <ellipse cx="${BOILER_CX}" cy="220" rx="620" ry="170" fill="url(#heroGlow)"/>
    ${cityMarkup}
  </svg>`;
  process.stdout.write(svg + '\n');
  process.exit(0);
}

/* ---------- Вариант 2: схема трасс и данные для шейдера ---------- */

const shift = (pts) => pts.map(([x, y]) => [x, y + DY]);
const seg = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);

// Магистраль в координатах сцены (от котельной в обе стороны)
const trunkRight = shift([[750, PIPE_Y], [758, PIPE_Y], [758, LOOP_TOP], [778, LOOP_TOP], [778, PIPE_Y], [990, PIPE_Y], [990, LOOP_TOP], [1010, LOOP_TOP], [1010, PIPE_Y], [1244, PIPE_Y], [1244, LOOP_TOP], [1264, LOOP_TOP], [1264, PIPE_Y], [W, PIPE_Y]]);
const trunkLeft = shift([[618, PIPE_Y], [456, PIPE_Y], [456, LOOP_TOP], [436, LOOP_TOP], [436, PIPE_Y], [130, PIPE_Y], [130, LOOP_TOP], [110, LOOP_TOP], [110, PIPE_Y], [0, PIPE_Y]]);

// Расстояние вдоль магистрали до точки врезки x (на горизонтальном участке трубы)
function distanceTo(trunk, x) {
  let acc = 0;
  for (let i = 1; i < trunk.length; i++) {
    const a = trunk[i - 1], b = trunk[i];
    const onPipe = a[1] === PIPE_Y + DY && b[1] === PIPE_Y + DY;
    if (onPipe && (x - a[0]) * (x - b[0]) <= 0) return acc + Math.abs(x - a[0]);
    acc += seg(a, b);
  }
  return acc;
}

// Ответвления схемы: от магистрали вверх и в сторону — как на мнемосхеме диспетчерской
const PY = PIPE_Y + DY;
const traces = [
  { trunk: trunkRight, pts: [[900, PY], [900, 400], [940, 360], [1240, 360], [1280, 320], [1280, 180], [1320, 140], [W, 140]] },
  { trunk: trunkRight, pts: [[1130, PY], [1130, 470], [1170, 430], [1380, 430]] },
  { trunk: trunkRight, pts: [[1400, PY], [1400, 500], [1440, 460], [1440, 300], [1480, 260], [W, 260]] },
  { trunk: trunkLeft, pts: [[300, PY], [300, 500], [270, 470], [0, 470]] },
];

const lines = [
  { pts: trunkRight, d0: 0 },
  { pts: trunkLeft, d0: 0 },
  ...traces.map((t) => ({ pts: t.pts, d0: Math.round(distanceTo(t.trunk, t.pts[0][0])) })),
];
let maxDist = 0;
for (const l of lines) {
  let len = l.d0;
  for (let i = 1; i < l.pts.length; i++) len += seg(l.pts[i - 1], l.pts[i]);
  maxDist = Math.max(maxDist, len);
}

const tracePaths = traces.map((t) => `<path class="trace" d="M${t.pts.map((p) => p.join(' ')).join('L')}"/>`);
const nodes = [];
for (const t of traces) {
  t.pts.slice(1).forEach(([x, y], i, arr) => {
    const last = i === arr.length - 1;
    if (last && (x === 0 || x === W)) return; // уходит за край сцены
    nodes.push(last
      ? `<rect class="node node--end" x="${x - 5}" y="${y - 5}" width="10" height="10"/>`
      : `<circle class="node" cx="${x}" cy="${y}" r="3.5"/>`);
  });
}

const network = JSON.stringify({ w: W, h: H, max: Math.round(maxDist), lines });
const footprintsJson = JSON.stringify(footprints.map(shift));

const svg = `<svg class="hero__scene u-decor" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMax slice" aria-hidden="true" focusable="false"
       data-network='${network}'
       data-buildings='${footprintsJson}'>
    <defs>
      <radialGradient id="heroGlow" cx="50%" cy="100%" r="60%">
        <stop offset="0" stop-color="#e8783c" stop-opacity=".34"/>
        <stop offset="1" stop-color="#e8783c" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <ellipse class="glow" cx="${BOILER_CX}" cy="${H}" rx="620" ry="170" fill="url(#heroGlow)"/>
    <g class="schema">
      ${tracePaths.join('\n      ')}
      ${nodes.join('\n      ')}
    </g>
    <g transform="translate(0 ${DY})">
    ${cityMarkup}
    </g>
  </svg>`;

process.stdout.write(svg + '\n');
