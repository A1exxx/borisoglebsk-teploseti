'use strict';
/**
 * Демо-копия сайта для показа на GitHub Pages.
 *
 * Рабочий сайт (public/) не трогает: собирает в отдельную папку. В демо
 * вверху полоса «демо-версия», формы не отправляются, поисковикам индексировать
 * запрещено, а блоки «Отключения» и «Новости» берут данные из снимка
 * demo/content.json — на GitHub Pages нет сервера с /api/content.
 *
 * Запуск: node tools/build-demo.js [папка] [--variant 2]
 *   без аргумента — .demo/borisoglebsk-teploseti/
 *   с аргументом  — например, рабочая копия ветки gh-pages
 *   --variant N    — вариант оформления N, адрес …/borisoglebsk-teploseti/vN/
 *                    (вариант 1 — в корне)
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const vIdx = args.indexOf('--variant');
const VARIANT = vIdx !== -1 ? String(args.splice(vIdx, 2)[1] || '1') : '1';
const SUB = VARIANT === '1' ? '' : `/v${VARIANT}`;
const BASE = '/borisoglebsk-teploseti' + SUB;
const OUT = path.resolve(args[0] ? path.join(args[0], SUB) : path.join(ROOT, '.demo', BASE.slice(1)));

fs.mkdirSync(OUT, { recursive: true });

// Статика копией. Постраничные сканы (_scans) в git не лежат и в демо не нужны.
// Шрифты и данные сцены есть не во всех вариантах оформления.
for (const dir of ['css', 'js', 'img', 'docs', 'fonts', 'data']) {
  if (!fs.existsSync(path.join(ROOT, 'public', dir))) continue;
  fs.cpSync(path.join(ROOT, 'public', dir), path.join(OUT, dir), {
    recursive: true,
    filter: (src) => !src.split(path.sep).includes('_scans'),
  });
}

fs.mkdirSync(path.join(OUT, 'api'), { recursive: true });
fs.copyFileSync(path.join(ROOT, 'demo', 'content.json'), path.join(OUT, 'api', 'content'));
// Без этого файла GitHub Pages прогоняет сайт через Jekyll
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');

const result = spawnSync(process.execPath, [path.join(__dirname, 'build.js')], {
  stdio: 'inherit',
  env: { ...process.env, SITE_OUT: OUT, SITE_DEMO: '1', SITE_BASE: BASE, SITE_DEMO_VARIANT: VARIANT },
});
if (result.status === 0) console.log(`\nДемо собрано: ${OUT}`);
process.exit(result.status ?? 1);
