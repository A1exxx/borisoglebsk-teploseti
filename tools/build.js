'use strict';
/**
 * Сборка статических страниц: src/pages/*.html + src/layout.html -> public/*.html
 *
 * Зачем: шапка, меню, подвал и реквизиты предприятия должны жить в одном месте.
 * Иначе смена телефона диспетчерской превращается в правку одиннадцати файлов.
 *
 * Запуск: node tools/build.js
 * Зависимостей нет.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const PAGES = path.join(SRC, 'pages');
// Демо-сборка пишет в отдельную папку, чтобы не задеть рабочий public/
const OUT = process.env.SITE_OUT ? path.resolve(process.env.SITE_OUT) : path.join(ROOT, 'public');

const crypto = require('crypto');

const data = JSON.parse(fs.readFileSync(path.join(SRC, 'data.json'), 'utf8'));

// Демо-сборка (tools/build-demo.js): полоса «демо-версия», запрет индексации
// и базовый путь для GitHub Pages. Обычная сборка эти переменные не задаёт.
const DEMO = process.env.SITE_DEMO === '1';
const BASE = (process.env.SITE_BASE || '').replace(/\/+$/, '');
// Варианты оформления в демо: ссылки полные, чтобы withBase() их не трогал;
// скрипт подставляет в них ту же страницу, что открыта сейчас.
const DEMO_ROOT = 'https://a1exxx.github.io/borisoglebsk-teploseti';
const DEMO_VARIANT = process.env.SITE_DEMO_VARIANT || '1';
const DEMO_VARIANTS = [['1', '', 'Вариант 1'], ['2', '/v2', 'Вариант 2'], ['3', '/v3', 'Вариант 3'], ['4', '/v4', 'Вариант 4']];
const DEMO_SWITCH = DEMO_VARIANTS.map(([id, sub, label]) =>
  `<a href="${DEMO_ROOT}${sub}/" data-variant-base="/borisoglebsk-teploseti${sub}"${id === DEMO_VARIANT ? ' aria-current="page"' : ''}>${label}</a>`
).join('');
const DEMO_BANNER = `<div class="demo-banner" role="note">
  <div class="wrap">
    <strong>Демо-версия нового оформления.</strong>
    <span>Формы здесь не работают. Официальный сайт — <a href="https://borisoglebskteplo.ru/">borisoglebskteplo.ru</a></span>
    <nav class="demo-banner__switch" aria-label="Варианты оформления">${DEMO_SWITCH}</nav>
  </div>
</div>`;

/** Абсолютные ссылки вида /css/… на GitHub Pages ведут мимо папки проекта. */
function withBase(html) {
  return BASE ? html.replace(/(\s(?:href|src|action)=")\/(?!\/)/g, `$1${BASE}/`) : html;
}

/** Короткий хеш файла — подставляется в ссылку как ?v=…
 *  Статика отдаётся с длинным сроком кеширования, поэтому без этого
 *  правка стилей неделю не доезжала бы до посетителей. */
function assetHash(relPath) {
  try {
    const buf = fs.readFileSync(path.join(OUT, relPath));
    return crypto.createHash('sha1').update(buf).digest('hex').slice(0, 8);
  } catch {
    return '0';
  }
}

data.assets = {
  css: assetHash(path.join('css', 'style.css')),
  js: assetHash(path.join('js', 'main.js')),
  thermal: assetHash(path.join('js', 'hero-thermal.js')),
};
const layout = fs.readFileSync(path.join(SRC, 'layout.html'), 'utf8');

/** Достаёт значение по пути «contacts.dispatcher.value». */
function pick(obj, dotted) {
  return dotted.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

const missing = new Set();

/** Незаполненные реквизиты подсвечиваем, а не прячем: так их видно на странице. */
function renderValue(value, keyPath) {
  if (value === undefined || value === null) {
    missing.add(keyPath);
    return `<span class="todo">не задано: ${keyPath}</span>`;
  }
  const str = String(value);
  if (str.includes('???')) {
    missing.add(keyPath);
    return `<span class="todo" title="Заполнить в src/data.json">${str.replace(/\?\?\?/g, 'уточняется')}</span>`;
  }
  return str;
}

/** {{@contacts.email}} — контакт ссылкой: mailto для почты, tel для телефона.
 *  Пока значение не заполнено, ссылки нет: набирать «уточняется» бессмысленно. */
function renderContact(dotted) {
  const item = pick(data, dotted);
  if (!item || typeof item !== 'object') {
    missing.add(dotted);
    return `<span class="todo">не задано: ${dotted}</span>`;
  }
  const value = String(item.value ?? '');
  if (!value || value.includes('???')) {
    missing.add(dotted + '.value');
    return '<span class="todo" title="Заполнить в src/data.json">уточняется</span>';
  }
  let href = item.href;
  if (!href) {
    href = value.includes('@')
      ? 'mailto:' + value
      : 'tel:' + value.replace(/[^\d+]/g, '');
  }
  // Телефон не должен переноситься по строкам: «8» отрывалась от остального номера.
  const shown = value.includes('@') ? value : value.replace(/ /g, '\u00a0');
  return `<a href="${href}">${shown}</a>`;
}

function fill(template, extra = {}) {
  return template
    .replace(/\{\{@([\w.]+)\}\}/g, (full, key) => renderContact(key))
    .replace(/\{\{([\w.]+)\}\}/g, (full, key) => {
      if (Object.prototype.hasOwnProperty.call(extra, key)) return extra[key] ?? '';
      const value = pick(data, key);
      return renderValue(value, key);
    });
}

/** Front-matter в начале файла страницы: title / description / crumbs. */
function parsePage(raw) {
  const meta = {};
  let body = raw;
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (match) {
    for (const line of match[1].split(/\r?\n/)) {
      const idx = line.indexOf(':');
      if (idx === -1) continue;
      meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    }
    body = raw.slice(match[0].length);
  }
  return { meta, body };
}

function crumbsHtml(title) {
  if (!title) return '';
  return `<div class="crumbs">
  <div class="wrap">
    <ol>
      <li><a href="/">Главная</a></li>
      <li><span aria-current="page">${title}</span></li>
    </ol>
  </div>
</div>`;
}

/** Синтаксис клиентского скрипта проверяем до сборки: одна опечатка в нём
 *  тихо отключает разом и проверку форм, и версию для слабовидящих. */
function checkClientScript() {
  const file = path.join(OUT, 'js', 'main.js');
  try {
    new Function(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    console.error('');
    console.error('ОШИБКА в public/js/main.js: ' + err.message);
    console.error('Сборка остановлена: со сломанным скриптом сайт теряет все интерактивные функции.');
    console.error('');
    process.exit(1);
  }
}

checkClientScript();

fs.mkdirSync(OUT, { recursive: true });

const SITE_URL = `https://${data.site.domain}`;
// Страницы, которых не должно быть в поиске: служебные и технические.
const NOINDEX = new Set(['spasibo.html', '404.html']);

const built = [];
const indexable = [];
for (const file of fs.readdirSync(PAGES).filter((f) => f.endsWith('.html')).sort()) {
  const raw = fs.readFileSync(path.join(PAGES, file), 'utf8');
  const { meta, body } = parsePage(raw);

  const canonPath = file === 'index.html' ? '/' : `/${file}`;
  const canonical = SITE_URL + canonPath;

  const html = fill(layout, {
    title: meta.title || 'Страница',
    description: meta.description || '',
    canonical,
    robots: DEMO ? 'noindex, nofollow' : NOINDEX.has(file) ? 'noindex, follow' : 'index, follow',
    demoAttr: DEMO ? ` data-demo="1"${BASE ? ` data-base="${BASE}"` : ''}` : '',
    demoBanner: DEMO ? DEMO_BANNER : '',
    ogImage: `${SITE_URL}/img/logo-512.png`,
    crumbs: meta.crumbs === 'no' ? '' : crumbsHtml(meta.crumbs || meta.title),
    content: fill(body),
  });

  fs.writeFileSync(path.join(OUT, file), withBase(html), 'utf8');
  built.push(`${file} (${Math.round(Buffer.byteLength(html) / 1024)} КБ)`);
  if (!NOINDEX.has(file)) indexable.push(canonPath);
}

/* robots.txt и карта сайта: генерируются вместе со страницами, чтобы список
   разделов не расходился с тем, что реально собрано. */
fs.writeFileSync(
  path.join(OUT, 'robots.txt'),
  (DEMO
    ? ['User-agent: *', 'Disallow: /', '']
    : ['User-agent: *', 'Allow: /', 'Disallow: /admin', 'Disallow: /api/', '', `Sitemap: ${SITE_URL}/sitemap.xml`, '']
  ).join('\n'),
  'utf8'
);

// Демо-копию поисковикам не показываем — карта сайта ей не нужна
if (!DEMO) {
  const today = new Date().toISOString().slice(0, 10);
  const urls = indexable
    .map((p) => `  <url>\n    <loc>${SITE_URL}${p}</loc>\n    <lastmod>${today}</lastmod>\n  </url>`)
    .join('\n');
  fs.writeFileSync(
    path.join(OUT, 'sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
    'utf8'
  );
  built.push(`robots.txt, sitemap.xml (${indexable.length} адресов)`);
} else {
  built.push('robots.txt (демо: индексация запрещена)');
}

console.log(`Собрано страниц: ${built.length}`);
built.forEach((b) => console.log('  ' + b));

if (missing.size) {
  console.log('\nНезаполненные реквизиты (правятся в src/data.json):');
  [...missing].sort().forEach((k) => console.log('  ' + k));
}
