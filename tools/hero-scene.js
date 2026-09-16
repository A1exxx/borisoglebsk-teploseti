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
 * Запуск: node tools/hero-scene.js  → печатает <svg> в stdout.
 * Результат вставлен в src/pages/index.html между метками HERO-SCENE.
 */

const W = 1600;
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

function windowAt(x, y, w, h) {
  windows.push({ x, y, w, h });
}

for (const b of buildings) {
  if (b.type === 'house') {
    const top = GROUND - 40;
    shapes.push(`<path class="bld" d="M${b.x} ${GROUND}V${top}L${b.x + b.w / 2} ${top - 24}L${b.x + b.w} ${top}V${GROUND}Z"/>`);
    windowAt(b.x + 14, top + 12, 13, 13);
    windowAt(b.x + b.w - 27, top + 12, 13, 13);
  } else if (b.type === 'low') {
    const top = GROUND - 64;
    shapes.push(`<rect class="bld" x="${b.x}" y="${top}" width="${b.w}" height="64"/>`);
    shapes.push(`<path class="edge" d="M${b.x - 4} ${top}H${b.x + b.w + 4}"/>`);
    for (let row = 0; row < 2; row++) {
      for (let col = 0; col < 4; col++) {
        windowAt(b.x + 14 + col * 27, top + 12 + row * 26, 13, 14);
      }
    }
  } else if (b.type === 'block') {
    const top = GROUND - 112;
    shapes.push(`<rect class="bld" x="${b.x}" y="${top}" width="${b.w}" height="112"/>`);
    shapes.push(`<path class="edge" d="M${b.x - 3} ${top}H${b.x + b.w + 3}"/>`);
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

const svg = `<svg class="hero__scene u-decor" viewBox="0 0 ${W} 220" preserveAspectRatio="xMidYMax slice" aria-hidden="true" focusable="false">
    <defs>
      <radialGradient id="heroGlow" cx="50%" cy="100%" r="60%">
        <stop offset="0" stop-color="#e8783c" stop-opacity=".34"/>
        <stop offset="1" stop-color="#e8783c" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <ellipse cx="${BOILER_CX}" cy="220" rx="620" ry="170" fill="url(#heroGlow)"/>
    <g class="steam">
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
    <path class="pulse pulse--r" pathLength="1000" d="${right}"/>
  </svg>`;

process.stdout.write(svg + '\n');
