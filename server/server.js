'use strict';
/**
 * МУП «Борисоглебские теплосети» — сервер сайта.
 *
 * Задачи: отдать статику, принять три типа заявок (показания ПУ, обращения
 * граждан, документы на договор), вести ленту отключений и новостей.
 *
 * Хранилище — файлы NDJSON. Это осознанный выбор: при потоке порядка сотен
 * заявок в месяц СУБД добавляет только стоимость и точку отказа на VPS с 1 ГБ.
 * Каждая запись пишется одной строкой, файл переносится обычным копированием.
 */

const express = require('express');
const multer = require('multer');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

require('dotenv').config({ path: path.join(__dirname, '.env') });

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
// SITE_DATA_DIR — только для проверочного скрипта (server/test): заявки пишутся во временную папку, а не в рабочую
const DATA_DIR = process.env.SITE_DATA_DIR ? path.resolve(process.env.SITE_DATA_DIR) : path.join(__dirname, 'data');
// при проверке и вложения заявок пишутся во временную папку, рядом с заявками
const UPLOAD_DIR = process.env.SITE_DATA_DIR ? path.join(DATA_DIR, 'uploads') : path.join(__dirname, 'uploads');
const CONTENT_FILE = path.join(DATA_DIR, 'content.json');

function generateDevPassword() {
  const pass = crypto.randomBytes(6).toString('base64url');
  console.warn(
    '\n[admin] ADMIN_PASS не задан — сгенерирован временный пароль на это включение:\n' +
    `[admin]   логин: admin   пароль: ${pass}\n` +
    '[admin] Для боевого сервера задайте ADMIN_USER и ADMIN_PASS в .env — иначе\n' +
    '[admin] пароль будет новым при каждом перезапуске.\n');
  return pass;
}

const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || generateDevPassword();

/* Проверка «я человек» в формах (см. form-check.js). Секрет подписи — FORM_CHECK_SECRET из .env.
 * Не задан — берётся случайный на это включение: выданные примеры перестают приниматься после перезапуска. */
const { createFormCheck } = require('./form-check');

function formCheckSecret() {
  const s = (process.env.FORM_CHECK_SECRET || '').trim();
  if (s) return s;
  console.warn('[forms] FORM_CHECK_SECRET не задан — ключ проверки форм сгенерирован на это включение.\n'
    + '[forms] Примеры, выданные до перезапуска, после него не примутся. Для боевого сервера задайте ключ в .env.');
  return crypto.randomBytes(32).toString('hex');
}

// FORM_CHECK_MIN_MS и FORM_LIMIT_* — для проверочного скрипта (server/test) и на случай,
// если лимиты понадобится поправить без правки кода. Обычно не задаются.
const envInt = (name, def) => (/^\d+$/.test(process.env[name] || '') ? Number(process.env[name]) : def);
const FORM_CHECK_MIN_MS = envInt('FORM_CHECK_MIN_MS', 3000);
const LIMIT_ACCOUNT_DAY = envInt('FORM_LIMIT_ACCOUNT_DAY', 3); // заявок с показаниями на один лицевой счёт за сутки
const LIMIT_IP_DAY = envInt('FORM_LIMIT_IP_DAY', 10); // заявок всех видов с одного адреса за сутки
const formCheck = createFormCheck({ secret: formCheckSecret(), minMs: FORM_CHECK_MIN_MS });

const MAX_FILE_MB = 10;
const MAX_FILES = 10;
const ALLOWED_EXT = new Set(['.pdf', '.jpg', '.jpeg', '.png', '.heic', '.doc', '.docx', '.xls', '.xlsx', '.rtf', '.odt']);

for (const dir of [DATA_DIR, UPLOAD_DIR]) fs.mkdirSync(dir, { recursive: true });

/* ------------------------------------------------------------------ */
/* Хранилище                                                           */
/* ------------------------------------------------------------------ */

/* Запись в файл заявок — по очереди. Смена статуса переписывает файл целиком, и новая заявка,
 * дописанная между чтением и записью, пропала бы. С программой начислений статусы меняются
 * сами (раз в 10 минут), поэтому все записи одного файла идут друг за другом. */
const fileQueues = new Map();
function withFileLock(kind, fn) {
  const prev = fileQueues.get(kind) || Promise.resolve();
  const run = prev.catch(() => undefined).then(fn);
  fileQueues.set(kind, run.catch(() => undefined));
  return run;
}

/** Дописать заявку. Номер заявки случайный (4 цифры на день): если такой уже есть в файле, берётся другой —
 *  программа начислений узнаёт показание по номеру, и два показания с одним номером слились бы в одно.
 *  Проверка и запись — под одной очередью. Возвращает номер, под которым заявка записана. */
function appendRecord(kind, record, guard) {
  return withFileLock(kind, async () => {
    const file = path.join(DATA_DIR, `${kind}.ndjson`);
    let raw = '';
    try { raw = await fsp.readFile(file, 'utf8'); } catch (err) { if (err.code !== 'ENOENT') throw err; }
    // guard — проверка лимита по уже записанным заявкам; под той же очередью, чтобы две
    // одновременные отправки не прошли лимит обе. Вернула ошибку — заявка не пишется.
    const refused = guard ? guard(parseLines(raw)) : null;
    if (refused) throw Object.assign(new Error(refused.message), { code: 'FORM_LIMIT', field: refused.field });
    for (let i = 0; i < 50 && raw.includes(`"ticket":${JSON.stringify(record.ticket)}`); i += 1) record.ticket = makeTicket(kind);
    await fsp.appendFile(file, JSON.stringify(record) + '\n', 'utf8');
    return record.ticket;
  });
}

/** Переписать записи файла заявок: change(row) правит строку на месте и возвращает true, если правил.
 *  Пишется во временный файл и подменяется — оборванная запись не портит заявки. Возвращает число правленых. */
function updateRecords(kind, change) {
  return withFileLock(kind, async () => {
    const file = path.join(DATA_DIR, `${kind}.ndjson`);
    let raw;
    try { raw = await fsp.readFile(file, 'utf8'); } catch (err) { if (err.code === 'ENOENT') return 0; throw err; }
    let changed = 0;
    const out = raw.split('\n').filter(Boolean).map((line) => {
      try {
        const row = JSON.parse(line);
        if (change(row)) { changed += 1; return JSON.stringify(row); }
        return line;
      } catch { return line; }
    }).join('\n') + '\n';
    if (changed > 0) {
      const tmp = `${file}.tmp`;
      await fsp.writeFile(tmp, out, 'utf8');
      await fsp.rename(tmp, file);
    }
    return changed;
  });
}

function parseLines(raw) {
  const rows = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try { rows.push(JSON.parse(line)); } catch { /* повреждённая строка — пропускаем */ }
  }
  return rows;
}

async function readRecords(kind, limit = 500) {
  const file = path.join(DATA_DIR, `${kind}.ndjson`);
  let raw;
  try {
    raw = await fsp.readFile(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  const rows = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try { rows.push(JSON.parse(line)); } catch { /* повреждённая строка — пропускаем */ }
  }
  return rows.reverse().slice(0, limit);
}

const CONTENT_DEFAULT = {
  announcement: null,
  outages: [],
  news: [],
};

async function readContent() {
  try {
    const raw = await fsp.readFile(CONTENT_FILE, 'utf8');
    return { ...CONTENT_DEFAULT, ...JSON.parse(raw) };
  } catch (err) {
    if (err.code === 'ENOENT') return { ...CONTENT_DEFAULT };
    throw err;
  }
}

async function writeContent(data) {
  const tmp = CONTENT_FILE + '.tmp';
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  await fsp.rename(tmp, CONTENT_FILE);
}

// Телефоны и режим работы: вписываются в панели управления и подставляются
// в готовые страницы при отдаче. Пересобирать сайт для этого не нужно.
const CONTACTS_FILE = path.join(DATA_DIR, 'contacts.json');

async function readContacts() {
  try {
    return JSON.parse(await fsp.readFile(CONTACTS_FILE, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw err;
  }
}

async function writeContacts(data) {
  const tmp = CONTACTS_FILE + '.tmp';
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  await fsp.rename(tmp, CONTACTS_FILE);
}

/* ------------------------------------------------------------------ */
/* Утилиты                                                             */
/* ------------------------------------------------------------------ */

const PREFIX = { readings: 'ПУ', appeals: 'ОБ', contracts: 'ДГ' };

function makeTicket(kind) {
  const d = new Date();
  const stamp = `${String(d.getDate()).padStart(2, '0')}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getFullYear()).slice(2)}`;
  const rnd = crypto.randomInt(1000, 9999);
  return `${PREFIX[kind] || 'ЗВ'}-${stamp}-${rnd}`;
}

function clean(value, maxLen = 500) {
  if (value === undefined || value === null) return '';
  return String(value).replace(/\s+/g, ' ').trim().slice(0, maxLen);
}

function cleanMultiline(value, maxLen = 5000) {
  if (value === undefined || value === null) return '';
  return String(value).replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').trim().slice(0, maxLen);
}

const RE_PHONE = /^\+?[\d\s().-]{10,20}$/;
const RE_EMAIL = /^[^@\s]+@[^@\s.]+\.[^@\s]{2,}$/;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Сегодняшняя дата по Москве, «ГГГГ-ММ-ДД»: сервер живёт по UTC. */
function moscowToday() {
  return new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
}

/** Дата и время из панели приходят без часового пояса — это московское время. */
function moscowTime(value) {
  const v = String(value || '').trim();
  if (!v) return NaN;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return Date.parse(`${v}T23:59:59+03:00`);
  return Date.parse(/(Z|[+-]\d\d:?\d\d)$/i.test(v) ? v : `${v}+03:00`);
}

/** Ссылка «Подробнее» в объявлении: только свой путь или https-адрес. */
function safeLink(value) {
  const v = String(value || '').trim();
  if (/^\/(?!\/)/.test(v) || /^https:\/\//i.test(v)) return v;
  return '';
}

/**
 * Контент для посетителей. Объявление после даты «показывать до» не
 * показывается. Работа, у которой прошёл плановый срок окончания, считается
 * завершённой — в панели она остаётся как была, чтобы при продлении работ
 * было достаточно поменять дату.
 */
function publicContent(content) {
  const a = content.announcement;
  const announcement = a && a.text && (!a.until || a.until >= moscowToday()) ? a : null;
  const now = Date.now();
  const outages = (content.outages || []).map((o) => {
    if (o.status === 'done') return o;
    const end = moscowTime(o.end);
    return Number.isFinite(end) && end < now ? { ...o, status: 'done' } : o;
  });
  return { ...content, announcement, outages };
}

function wantsJSON(req) {
  return req.xhr
    || req.get('X-Requested-With') === 'fetch'
    || (req.get('Accept') || '').includes('application/json');
}

/**
 * Referer присылает клиент, и он может указывать на чужой сайт. Возвращаем только
 * путь внутри своего домена — иначе форма превращается в открытый редирект.
 */
function safeBackTo(req) {
  const host = req.get('Host') || '';
  try {
    const u = new URL(req.get('Referer') || '', `https://${host}`);
    return u.host === host ? u.pathname + u.search : '/';
  } catch {
    return '/';
  }
}

/** Один ответ для JS-клиента и для браузера без JS. */
function respond(req, res, { ok, ticket, message, errors, backTo, check, status }) {
  if (wantsJSON(req)) {
    return res.status(ok ? 200 : (status || 400)).json({ ok, ticket, message, errors, check });
  }
  if (ok) {
    // Текст благодарности страница берёт по виду заявки, а не из адреса:
    // иначе по ссылке с чужим текстом его показал бы официальный сайт.
    const q = new URLSearchParams({ ticket: ticket || '' });
    return res.redirect(303, `/spasibo.html?${q}`);
  }
  const q = new URLSearchParams({ error: message || 'Проверьте заполнение формы' });
  return res.redirect(303, `${backTo}?${q}#form`);
}

/** Грубый ограничитель частоты: защищает формы от накрутки, память не растёт. */
function rateLimit({ windowMs, max }) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [key, item] of hits) if (now > item.reset) hits.delete(key);
  }, windowMs).unref();

  return (req, res, next) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    let item = hits.get(ip);
    if (!item || now > item.reset) {
      item = { count: 0, reset: now + windowMs };
      hits.set(ip, item);
    }
    item.count += 1;
    if (item.count > max) {
      return respond(req, res, {
        ok: false,
        message: 'Слишком много обращений за короткое время. Повторите отправку через несколько минут.',
        backTo: safeBackTo(req),
      });
    }
    next();
  };
}

/* ------------------------------------------------------------------ */
/* Загрузка файлов                                                     */
/* ------------------------------------------------------------------ */

const storage = multer.diskStorage({
  destination(req, file, cb) {
    if (!req._uploadDir) {
      req._uploadDir = path.join(UPLOAD_DIR, new Date().toISOString().slice(0, 7), crypto.randomUUID());
      fs.mkdirSync(req._uploadDir, { recursive: true });
    }
    cb(null, req._uploadDir);
  },
  filename(req, file, cb) {
    // Имена приходят от пользователя — оставляем только безопасные символы.
    const original = Buffer.from(file.originalname, 'latin1').toString('utf8');
    const ext = path.extname(original).toLowerCase();
    const base = path.basename(original, ext).replace(/[^\p{L}\p{N}\s._-]/gu, '').slice(0, 60).trim() || 'file';
    file._displayName = base + ext;
    cb(null, `${Date.now()}-${crypto.randomInt(100, 999)}-${base}${ext}`.replace(/\s+/g, '_'));
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_MB * 1024 * 1024, files: MAX_FILES, fields: 40 },
  fileFilter(req, file, cb) {
    const original = Buffer.from(file.originalname, 'latin1').toString('utf8');
    const ext = path.extname(original).toLowerCase();
    if (!ALLOWED_EXT.has(ext)) {
      return cb(new Error(`Формат «${ext || 'без расширения'}» не принимается. Допустимы PDF, JPG, PNG, DOC, DOCX, XLS, XLSX.`));
    }
    cb(null, true);
  },
});

/* ------------------------------------------------------------------ */
/* Документы сайта: загружаются в панели управления                    */
/* ------------------------------------------------------------------ */

const DOCS_DIR = path.join(DATA_DIR, 'docs');
const DOCS_FILE = path.join(DATA_DIR, 'docs.json');
fs.mkdirSync(DOCS_DIR, { recursive: true });

// Разделы сайта, куда можно положить документ из панели. Ключи r_* — категории
// раскрытия информации по постановлению Правительства РФ от 26.01.2023 № 110:
// документ встаёт внутрь своей категории на странице «Раскрытие информации»
// и заменяет там пометку о сроке публикации.
const DOC_SECTIONS = {
  ustav: 'О предприятии — учредительные документы',
  raskrytie: 'Раскрытие информации — в конце страницы',
  tarify: 'Тарифы',
  zakupki: 'Закупки — положение, план, приказы',
  tipovye: 'Типовые документы — образцы договоров и бланки',
  korrupciya: 'Противодействие коррупции — политика, кодекс, формы',
  prochee: 'Прочие документы',
  r_obshchaya: 'а) Общая информация об организации',
  r_ceny: 'б) Цены (тарифы) на регулируемые товары и услуги',
  r_pokazateli: 'в) Бухгалтерская отчётность',
  r_zarplata: 'в) Зарплата директора и главного бухгалтера',
  r_nadezhnost: 'г) Показатели надёжности и качества обслуживания',
  r_invest: 'д) Инвестиционная программа',
  r_tehvozm: 'е) Наличие технической возможности подключения',
  r_usloviya: 'ж) Условия поставки товаров и оказания услуг',
  r_podklyuchenie: 'з) Порядок технологических действий при подключении',
  r_zakupki: 'и) Способы приобретения товаров, работ и услуг',
  r_predlozhenie: 'к) Предложение об установлении цен (тарифов)',
};

// Группы для выпадающего списка в панели: человек выбирает раздел глазами,
// поэтому категории раскрытия собраны отдельно от обычных страниц.
const DOC_GROUPS = [
  { title: 'Страницы сайта', keys: ['ustav', 'tarify', 'zakupki', 'tipovye', 'korrupciya', 'raskrytie', 'prochee'] },
  {
    title: 'Раскрытие информации — категории постановления № 110',
    keys: ['r_obshchaya', 'r_ceny', 'r_pokazateli', 'r_zarplata', 'r_nadezhnost', 'r_invest',
      'r_tehvozm', 'r_usloviya', 'r_podklyuchenie', 'r_zakupki', 'r_predlozhenie'],
  },
];

async function readDocs() {
  try {
    const list = JSON.parse(await fsp.readFile(DOCS_FILE, 'utf8'));
    return Array.isArray(list) ? list : [];
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

async function writeDocs(list) {
  const tmp = DOCS_FILE + '.tmp';
  await fsp.writeFile(tmp, JSON.stringify(list, null, 2), 'utf8');
  await fsp.rename(tmp, DOCS_FILE);
}

// Картинки объявлений: сотрудник загружает их в панели, файл кладётся рядом
// с документами, но в свою папку — объявления живут отдельно от документов
// раскрытия и удаляются вместе с объявлением.
const NEWS_DIR = path.join(DATA_DIR, 'news');
fs.mkdirSync(NEWS_DIR, { recursive: true });

const NEWS_IMG_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const NEWS_FILE_RE = /^[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$/;

const newsImageUpload = multer({
  storage: multer.diskStorage({
    destination(req, file, cb) { cb(null, NEWS_DIR); },
    filename(req, file, cb) {
      const original = Buffer.from(file.originalname, 'latin1').toString('utf8');
      cb(null, `${crypto.randomUUID()}${path.extname(original).toLowerCase()}`);
    },
  }),
  limits: { fileSize: 8 * 1024 * 1024, files: 1, fields: 4 },
  fileFilter(req, file, cb) {
    const original = Buffer.from(file.originalname, 'latin1').toString('utf8');
    const ext = path.extname(original).toLowerCase();
    if (!NEWS_IMG_EXT.has(ext)) {
      return cb(new Error('Для объявления подходит картинка JPG, PNG или WEBP.'));
    }
    cb(null, true);
  },
});

const docUpload = multer({
  storage: multer.diskStorage({
    destination(req, file, cb) { cb(null, DOCS_DIR); },
    filename(req, file, cb) {
      const original = Buffer.from(file.originalname, 'latin1').toString('utf8');
      file._displayName = original;
      // Имя на диске случайное: файл отдаётся по ссылке /files/<id>, а имя
      // для скачивания берётся из названия, которое ввели в панели.
      cb(null, `${crypto.randomUUID()}${path.extname(original).toLowerCase()}`);
    },
  }),
  limits: { fileSize: 25 * 1024 * 1024, files: 1, fields: 10 },
  fileFilter(req, file, cb) {
    const original = Buffer.from(file.originalname, 'latin1').toString('utf8');
    const ext = path.extname(original).toLowerCase();
    if (!ALLOWED_EXT.has(ext)) {
      return cb(new Error(`Формат «${ext || 'без расширения'}» не принимается. Допустимы PDF, JPG, PNG, DOC, DOCX, XLS, XLSX.`));
    }
    cb(null, true);
  },
});

function fileSize(bytes) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} МБ` : `${Math.max(1, Math.round(bytes / 1024))} КБ`;
}

// Метка <div data-docs="раздел">…</div> заменяется списком загруженных документов.
// Текст внутри метки — то, что видно, пока документов нет: например, пометка
// «срок раскрытия — до 30 апреля». Внутри метки допустимы только простые теги
// без вложенных <div>: подстановка ищет первый закрывающий </div>.
// Метка с data-docs-status получает ещё и зелёную пометку «Раскрыто» —
// её ставят у категорий раскрытия, где состояние важно показать явно.
function withDocs(html, docs) {
  return html.replace(/<div data-docs="([\w-]+)"([^>]*)>([\s\S]*?)<\/div>/g, (full, section, attrs, fallback) => {
    const list = docs.filter((d) => d.section === section);
    if (!list.length) return fallback;
    const badge = attrs.includes('data-docs-status')
      ? '<p class="badge badge--ok badge--dot">Раскрыто</p>'
      : '';
    // data-docs-title — заголовок в отдельной карточке: появляется вместе с первым
    // документом и исчезает, если все документы убрали из раздела.
    const titled = /data-docs-title="([^"]*)"/.exec(attrs);
    const items = list.map((d) => {
      const ext = String(d.ext || '').replace('.', '').toUpperCase();
      const icon = ext === 'PDF' ? 'i-pdf' : 'i-doc';
      const added = d.uploaded ? new Date(d.uploaded).toLocaleDateString('ru-RU') : '';
      return `<li><a class="doc" href="/files/${escapeHtml(d.id)}">`
        + `<span class="doc__ico"><svg class="ico" aria-hidden="true"><use href="/img/icons.svg#${icon}"></use></svg></span>`
        + '<span class="doc__body">'
        + `<span class="doc__title">${escapeHtml(d.title)}</span>`
        + `<span class="doc__meta"><span>${escapeHtml(ext)} · ${escapeHtml(fileSize(d.size || 0))}</span>`
        + (added ? `<span>добавлен ${escapeHtml(added)}</span>` : '')
        + '</span></span></a></li>';
    }).join('');
    const body = `${badge}<ul class="doclist">${items}</ul>`;
    return titled
      ? `<div class="card mt-5"><h3>${escapeHtml(titled[1])}</h3>${body}</div>`
      : body;
  });
}

/* ------------------------------------------------------------------ */
/* Приложение                                                          */
/* ------------------------------------------------------------------ */

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  next();
});

app.use(express.urlencoded({ extended: false, limit: '256kb' }));
app.use(express.json({ limit: '256kb' }));

/* ---------- Страницы: объявление и номер заявки вставляет сервер ---------- */

// Полоса объявления приходит уже в странице: раньше она появлялась после
// загрузки и сдвигала весь первый экран вниз. Заодно её видят поисковики.
// Номер заявки на «Заявка отправлена» тоже ставит сервер — встроенный скрипт
// блокировала защита сайта (CSP), и без JavaScript номер не был виден.
const PAGE_FILES = new Set(fs.readdirSync(PUBLIC_DIR).filter((f) => f.endsWith('.html')));
const pageCache = new Map();

async function pageHtml(file) {
  if (process.env.NODE_ENV === 'production' && pageCache.has(file)) return pageCache.get(file);
  const html = await fsp.readFile(path.join(PUBLIC_DIR, file), 'utf8');
  pageCache.set(file, html);
  return html;
}

const ANNOUNCE_OPEN = '<div class="alertbar alertbar--info" id="announcement" hidden>';

function withAnnouncement(html, a) {
  if (!a || !a.text || !html.includes(ANNOUNCE_OPEN)) return html;
  const level = ['info', 'warn', 'danger'].includes(a.level) ? a.level : 'info';
  let out = html
    .replace(ANNOUNCE_OPEN, () => `<div class="alertbar alertbar--${level}" id="announcement">`)
    .replace('<span data-announce-text></span>', () => `<span data-announce-text>${escapeHtml(a.text)}</span>`);
  const link = safeLink(a.link);
  if (link) out = out.replace('<a data-announce-link href="#" hidden>', () => `<a data-announce-link href="${escapeHtml(link)}">`);
  return out;
}

const TICKET_RE = /^(ПУ|ОБ|ДГ|ЗВ)-\d{6}-\d{4}$/;
const THANKS = {
  ПУ: 'Показания приняты и переданы в абонентский отдел.',
  ОБ: 'Обращение зарегистрировано. Срок рассмотрения — 30 дней со дня регистрации.',
  ДГ: 'Заявка и документы приняты. Специалист свяжется с вами в течение 3 рабочих дней.',
};

function withTicket(html, value) {
  const ticket = String(value || '').trim();
  if (!TICKET_RE.test(ticket)) return html;
  const thanks = THANKS[ticket.slice(0, 2)] || 'Заявка принята и передана специалисту.';
  return html
    .replace('<p id="ticket-line" hidden>', '<p id="ticket-line">')
    .replace('id="ticket-value" style="font-size:1.3rem"></strong>', () => `id="ticket-value" style="font-size:1.3rem">${escapeHtml(ticket)}</strong>`)
    .replace('<p id="message-line">Заявка принята и передана специалисту.</p>', () => `<p id="message-line">${escapeHtml(thanks)}</p>`);
}

// Контакты в готовых страницах помечены атрибутами data-contact (ссылка:
// телефон, почта) и data-contact-text (режим работы). Здесь подставляем то,
// что вписали в панели управления.
const CONTACT_LINKS = ['dispatcher', 'reception', 'subscribers', 'accounting', 'email', 'emailDocs'];
const CONTACT_TEXTS = ['hours', 'hoursShort', 'receptionDays'];

function contactLink(key, raw) {
  const value = String(raw || '').trim();
  if (!value) return null;
  const href = value.includes('@') ? `mailto:${value}` : `tel:${value.replace(/[^\d+]/g, '')}`;
  // Телефон не должен переноситься по строкам: «8» отрывается от номера.
  const shown = value.includes('@') ? value : value.replace(/ /g, ' ');
  return `<a href="${escapeHtml(href)}" data-contact="${key}">${escapeHtml(shown)}</a>`;
}

function withContacts(html, contacts) {
  if (!contacts) return html;
  let out = html;
  for (const key of CONTACT_LINKS) {
    const rendered = contactLink(key, contacts[key]);
    if (!rendered) continue;
    out = out.replace(new RegExp(`<(a|span)\\b[^>]*data-contact="${key}"[^>]*>[\\s\\S]*?</\\1>`, 'g'), () => rendered);
  }
  for (const key of CONTACT_TEXTS) {
    const value = String(contacts[key] || '').trim();
    if (!value) continue;
    out = out.replace(
      new RegExp(`<span\\b[^>]*data-contact-text="${key}"[^>]*>[\\s\\S]*?</span>`, 'g'),
      () => `<span data-contact-text="${key}">${escapeHtml(value)}</span>`,
    );
  }
  return out;
}

app.get(/^\/(?:[\w-]+(?:\.html)?)?$/, async (req, res, next) => {
  const name = req.path === '/' ? 'index' : req.path.slice(1).replace(/\.html$/, '');
  const file = `${name}.html`;
  if (!PAGE_FILES.has(file)) return next();
  try {
    let html = withAnnouncement(await pageHtml(file), publicContent(await readContent()).announcement);
    html = withContacts(html, await readContacts());
    html = withDocs(html, await readDocs());
    if (file === 'spasibo.html') html = withTicket(html, req.query.ticket);
    res.setHeader('Cache-Control', 'no-cache');
    res.type('html').send(html);
  } catch (err) {
    next(err);
  }
});

app.use(express.static(PUBLIC_DIR, {
  extensions: ['html'],
  setHeaders(res, filePath) {
    if (/\.(css|js|svg|woff2?|png|jpe?g|ico)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=604800');
    } else if (filePath.endsWith('.pdf')) {
      res.setHeader('Cache-Control', 'public, max-age=86400');
    } else {
      res.setHeader('Cache-Control', 'no-cache');
    }
  },
}));

const formLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 25 });

/* ---------- Защита форм от спама ----------
 * 1) скрытое поле-ловушка website: человек его не видит и не заполняет;
 * 2) пример на сложение от сервера с подписанным одноразовым токеном (form-check.js), живёт 30 минут;
 * 3) форма, отправленная быстрее 3 секунд после получения примера, — бот;
 * 4) лимиты за сутки: заявок с одного адреса и показаний на один лицевой счёт.
 * Боту (ловушка, слишком быстро) отвечаем «принято», но ничего не пишем — чтобы он не подстраивался.
 * Счётчики лимитов — по самим файлам заявок за последние 24 часа, поэтому перезапуск их не обнуляет. */

const DAY_MS = 24 * 3600 * 1000;
const FORM_KINDS = ['readings', 'appeals', 'contracts'];

const CHECK_MESSAGES = {
  missing: 'Пример для проверки не загрузился. Обновите страницу и решите пример.',
  invalid: 'Пример не принят. Решите новый пример — он над этим полем.',
  used: 'Пример не принят. Решите новый пример — он над этим полем.',
  expired: 'Пример устарел: с его получения прошло больше 30 минут. Решите новый пример — он над этим полем.',
  wrong: 'Ответ неверный. Посчитайте новый пример — он над этим полем.',
};
const CHECK_FAILED = 'Решите пример внизу формы и отправьте ещё раз.';
const IP_LIMIT = 'С этого подключения за сутки отправлено слишком много заявок. Повторите завтра или позвоните нам — телефоны в разделе «Контакты».';

function publicCheck() {
  const { question, token } = formCheck.issue();
  return { question, token };
}

/** Новый пример для формы: страница берёт его при открытии и после каждой отправки. */
app.get('/api/form-check', rateLimit({ windowMs: 10 * 60 * 1000, max: 120 }), (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(publicCheck());
});

/** Бот: заполнена ловушка или форма отправлена быстрее, чем человек успел бы её заполнить. */
function looksLikeBot(b) {
  if (clean(b.website)) return true;
  const token = clean(b.checkToken, 1000);
  const issued = formCheck.parse(token);
  if (issued && Date.now() - issued.t < FORM_CHECK_MIN_MS) {
    formCheck.verify(token, b.checkAnswer); // гасим токен
    return true;
  }
  return false;
}

/** Ответ на пример не вписан — ошибка у поля вместе с остальными; пример при этом не тратится. */
function requireCheckAnswer(b, errors) {
  if (!clean(b.checkAnswer, 10)) errors.checkAnswer = 'Впишите ответ на пример — одно число';
}

/** Проверить ответ на пример. null — всё верно; иначе ошибка у поля и новый пример. */
function humanCheckFailed(b) {
  const result = formCheck.verify(clean(b.checkToken, 1000), clean(b.checkAnswer, 10));
  if (result.ok) return null;
  return { errors: { checkAnswer: CHECK_MESSAGES[result.reason] || CHECK_MESSAGES.invalid }, check: publicCheck() };
}

/** Сколько заявок всех видов пришло с этого адреса за последние сутки. */
async function ipCountToday(ip) {
  const since = Date.now() - DAY_MS;
  let n = 0;
  for (const kind of FORM_KINDS) {
    for (const row of await readRecords(kind, Infinity)) {
      if (row.ip === ip && Date.parse(row.createdAt) >= since) n += 1;
    }
  }
  return n;
}

/** Общие проверки перед записью: пример и лимит по адресу. null — можно писать. */
async function formGuard(req, b) {
  const failed = humanCheckFailed(b);
  if (failed) return { message: CHECK_FAILED, ...failed };
  if (await ipCountToday(req.ip) >= LIMIT_IP_DAY) return { message: IP_LIMIT };
  return null;
}

/** Отклонённая заявка с файлами: загруженное не храним. */
function dropUploads(req) {
  if (req._uploadDir) fsp.rm(req._uploadDir, { recursive: true, force: true }).catch(() => {});
}

const RE_ACCOUNT = /^\d{5,12}$/;
// Показание: цифры с табло (ведущие нули допустимы), не больше трёх знаков после запятой, не больше 999 999.
const RE_READING = /^\d{1,9}([.,]\d{1,3})?$/;
const READING_MAX = 999999;

function readingError(value) {
  if (!RE_READING.test(value)) return 'Показание вводится цифрами, не больше трёх цифр после запятой, например 1245,300';
  if (Number(value.replace(',', '.')) > READING_MAX) return 'Показание не может быть больше 999 999 — проверьте, нет ли лишней цифры';
  return null;
}

/* ---------- Показания приборов учёта ---------- */

// upload.none() разбирает multipart без файлов: страховка на случай, если
// форму отправят как FormData.
app.post('/api/readings', formLimiter, express.urlencoded({ extended: false }), upload.none(), async (req, res, next) => {
  const b = req.body || {};
  if (looksLikeBot(b)) return respond(req, res, { ok: true, ticket: makeTicket('readings'), message: 'Показания приняты' });

  const data = {
    account: clean(b.account, 30).replace(/\s+/g, ''),
    fio: clean(b.fio, 150),
    address: clean(b.address, 250),
    meterNumber: clean(b.meterNumber, 40),
    valueHeat: clean(b.valueHeat, 20).replace(/\s+/g, ''),
    valueWater: clean(b.valueWater, 20).replace(/\s+/g, ''),
    phone: clean(b.phone, 25),
    email: clean(b.email, 100),
    comment: cleanMultiline(b.comment, 1000),
    consent: b.consent === 'on' || b.consent === 'true' || b.consent === '1',
  };

  const errors = {};
  if (!data.account) errors.account = 'Укажите номер лицевого счёта';
  else if (!RE_ACCOUNT.test(data.account)) errors.account = 'Номер лицевого счёта — только цифры, от 5 до 12. Он напечатан в верхней части квитанции';
  if (!data.address) errors.address = 'Укажите адрес помещения';
  if (!data.valueHeat && !data.valueWater) errors.valueHeat = 'Введите хотя бы одно показание';
  for (const key of ['valueHeat', 'valueWater']) {
    const bad = data[key] && readingError(data[key]);
    if (bad) errors[key] = bad;
  }
  if (!data.phone) errors.phone = 'Укажите телефон для обратной связи';
  else if (!RE_PHONE.test(data.phone)) errors.phone = 'Проверьте номер телефона';
  if (data.email && !RE_EMAIL.test(data.email)) errors.email = 'Проверьте адрес электронной почты';
  if (!data.consent) errors.consent = 'Без согласия на обработку персональных данных заявка не принимается';
  requireCheckAnswer(b, errors);

  if (Object.keys(errors).length) {
    return respond(req, res, { ok: false, errors, message: 'Проверьте заполнение формы', backTo: '/pokazaniya.html' });
  }

  try {
    const refused = await formGuard(req, b);
    if (refused) return respond(req, res, { ok: false, ...refused, backTo: '/pokazaniya.html' });

    const since = Date.now() - DAY_MS;
    const ticket = await appendRecord('readings', {
      ticket: makeTicket('readings'), kind: 'readings', createdAt: new Date().toISOString(), status: 'new',
      ip: req.ip, ...data,
    }, (rows) => {
      const sameAccount = rows.filter((r) => String(r.account || '').replace(/\s+/g, '') === data.account
        && Date.parse(r.createdAt) >= since).length;
      return sameAccount >= LIMIT_ACCOUNT_DAY
        ? { field: 'account', message: `По этому лицевому счёту за сутки показания передавали уже ${LIMIT_ACCOUNT_DAY} раза. Чтобы исправить их, позвоните в абонентский отдел` }
        : null;
    });
    respond(req, res, { ok: true, ticket, message: 'Показания приняты и переданы в абонентский отдел' });
  } catch (err) {
    if (err.code !== 'FORM_LIMIT') return next(err);
    respond(req, res, { ok: false, errors: { [err.field]: err.message }, message: err.message, backTo: '/pokazaniya.html' });
  }
});

/* ---------- Обращения граждан (59-ФЗ) ---------- */

app.post('/api/appeals', formLimiter, upload.array('files', MAX_FILES), async (req, res, next) => {
  const b = req.body || {};
  if (looksLikeBot(b)) {
    dropUploads(req);
    return respond(req, res, { ok: true, ticket: makeTicket('appeals'), message: 'Обращение принято' });
  }

  const data = {
    topic: clean(b.topic, 80),
    fio: clean(b.fio, 150),
    address: clean(b.address, 250),
    phone: clean(b.phone, 25),
    email: clean(b.email, 100),
    replyBy: clean(b.replyBy, 20) || 'email',
    postAddress: clean(b.postAddress, 250),
    message: cleanMultiline(b.message, 5000),
    consent: b.consent === 'on' || b.consent === 'true' || b.consent === '1',
  };

  const errors = {};
  // 59-ФЗ, ст. 7: обязательны ФИО, адрес для ответа, суть обращения.
  if (!data.fio) errors.fio = 'Укажите фамилию, имя и отчество — этого требует статья 7 Федерального закона № 59-ФЗ';
  if (!data.message || data.message.length < 20) errors.message = 'Опишите суть обращения — не менее 20 символов';
  if (!data.topic) errors.topic = 'Выберите тему обращения';
  if (data.replyBy === 'email') {
    if (!data.email) errors.email = 'Укажите адрес электронной почты для ответа';
    else if (!RE_EMAIL.test(data.email)) errors.email = 'Проверьте адрес электронной почты';
  } else if (!data.postAddress) {
    errors.postAddress = 'Укажите почтовый адрес для ответа';
  }
  if (data.phone && !RE_PHONE.test(data.phone)) errors.phone = 'Проверьте номер телефона';
  if (!data.consent) errors.consent = 'Без согласия на обработку персональных данных обращение не регистрируется';
  requireCheckAnswer(b, errors);

  if (Object.keys(errors).length) {
    dropUploads(req);
    return respond(req, res, { ok: false, errors, message: 'Проверьте заполнение формы', backTo: '/obrashcheniya.html' });
  }

  try {
    const refused = await formGuard(req, b);
    if (refused) {
      dropUploads(req);
      return respond(req, res, { ok: false, ...refused, backTo: '/obrashcheniya.html' });
    }

    const files = (req.files || []).map((f) => ({
      name: f._displayName || f.originalname,
      stored: path.relative(UPLOAD_DIR, f.path).replace(/\\/g, '/'),
      size: f.size,
    }));

    const ticket = await appendRecord('appeals', {
      ticket: makeTicket('appeals'), kind: 'appeals', createdAt: new Date().toISOString(), status: 'new',
      ip: req.ip, ...data, files,
    });
    respond(req, res, { ok: true, ticket, message: 'Обращение зарегистрировано. Срок рассмотрения — 30 дней со дня регистрации' });
  } catch (err) {
    next(err);
  }
});

/* ---------- Заявка на заключение договора ---------- */

app.post('/api/contracts', formLimiter, upload.array('files', MAX_FILES), async (req, res, next) => {
  const b = req.body || {};
  if (looksLikeBot(b)) {
    dropUploads(req);
    return respond(req, res, { ok: true, ticket: makeTicket('contracts'), message: 'Заявка принята' });
  }

  const data = {
    applicantType: clean(b.applicantType, 20) || 'individual',
    purpose: clean(b.purpose, 60),
    fio: clean(b.fio, 200),
    orgName: clean(b.orgName, 250),
    inn: clean(b.inn, 12),
    objectAddress: clean(b.objectAddress, 250),
    account: clean(b.account, 30),
    phone: clean(b.phone, 25),
    email: clean(b.email, 100),
    comment: cleanMultiline(b.comment, 3000),
    consent: b.consent === 'on' || b.consent === 'true' || b.consent === '1',
  };

  const errors = {};
  if (!data.objectAddress) errors.objectAddress = 'Укажите адрес объекта теплоснабжения';
  if (!data.phone) errors.phone = 'Укажите контактный телефон';
  else if (!RE_PHONE.test(data.phone)) errors.phone = 'Проверьте номер телефона';
  if (!data.email) errors.email = 'Укажите электронную почту — на неё придёт проект договора';
  else if (!RE_EMAIL.test(data.email)) errors.email = 'Проверьте адрес электронной почты';

  if (data.applicantType === 'legal') {
    if (!data.orgName) errors.orgName = 'Укажите наименование организации';
    if (!data.inn) errors.inn = 'Укажите ИНН';
    else if (!/^\d{10}$|^\d{12}$/.test(data.inn)) errors.inn = 'ИНН состоит из 10 цифр для юридического лица или 12 для ИП';
  } else if (!data.fio) {
    errors.fio = 'Укажите фамилию, имя и отчество';
  }
  if (!data.consent) errors.consent = 'Без согласия на обработку персональных данных заявка не принимается';
  if (!req.files || req.files.length === 0) errors.files = 'Приложите копии документов по списку выше';
  requireCheckAnswer(b, errors);

  if (Object.keys(errors).length) {
    // Загруженные файлы отклонённой заявки не храним.
    dropUploads(req);
    return respond(req, res, { ok: false, errors, message: 'Проверьте заполнение формы', backTo: '/dogovor.html' });
  }

  try {
    const refused = await formGuard(req, b);
    if (refused) {
      dropUploads(req);
      return respond(req, res, { ok: false, ...refused, backTo: '/dogovor.html' });
    }

    const files = (req.files || []).map((f) => ({
      name: f._displayName || f.originalname,
      stored: path.relative(UPLOAD_DIR, f.path).replace(/\\/g, '/'),
      size: f.size,
    }));

    const ticket = await appendRecord('contracts', {
      ticket: makeTicket('contracts'), kind: 'contracts', createdAt: new Date().toISOString(), status: 'new',
      ip: req.ip, ...data, files,
    });
    respond(req, res, { ok: true, ticket, message: 'Заявка и документы приняты. Специалист свяжется с вами в течение 3 рабочих дней' });
  } catch (err) {
    next(err);
  }
});

/* ---------- Публичный контент ---------- */

// Документы, добавленные в панели, доступны всем по короткой ссылке.
// Картинка объявления. Имя файла задаёт сервер при загрузке, поэтому проверка
// по шаблону исключает выход за пределы папки.
app.get('/files/news/:name', (req, res) => {
  if (!NEWS_FILE_RE.test(req.params.name)) return res.status(404).end();
  const target = path.resolve(NEWS_DIR, req.params.name);
  if (!target.startsWith(NEWS_DIR + path.sep)) return res.status(400).end();
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.sendFile(target, (err) => { if (err && !res.headersSent) res.status(404).end(); });
});

app.get('/files/:id', async (req, res) => {
  const docs = await readDocs();
  const item = docs.find((d) => d.id === req.params.id);
  if (!item) return res.status(404).end();
  const target = path.resolve(DOCS_DIR, item.file);
  if (!target.startsWith(DOCS_DIR + path.sep)) return res.status(400).end();
  // Имя для скачивания — понятное название из панели, а не случайный код.
  const name = `${String(item.title).replace(/[^\p{L}\p{N}\s._-]/gu, '').trim() || 'dokument'}${item.ext || ''}`;
  res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(name)}`);
  res.sendFile(target, (err) => { if (err && !res.headersSent) res.status(404).end(); });
});

app.get('/api/content', async (req, res) => {
  const content = publicContent(await readContent());
  res.setHeader('Cache-Control', 'no-cache');
  res.json(content);
});

/* ------------------------------------------------------------------ */
/* Панель управления                                                   */
/* ------------------------------------------------------------------ */

/** Сравнение фиксированной длины: хеш уравнивает буферы, поэтому логин
 *  и пароль любой длины и с любыми символами не ломают timingSafeEqual. */
function sameSecret(a, b) {
  const ha = crypto.createHash('sha256').update(String(a ?? ''), 'utf8').digest();
  const hb = crypto.createHash('sha256').update(String(b ?? ''), 'utf8').digest();
  return crypto.timingSafeEqual(ha, hb);
}

// Подбор пароля: после 10 неверных попыток с одного адреса вход закрыт на 15 минут.
// Запрос без пароля (первое окно входа в браузере) попыткой не считается.
const ADMIN_MAX_FAILS = 10;
const ADMIN_LOCK_MS = 15 * 60 * 1000;
const adminFails = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [ip, item] of adminFails) if (now > item.reset) adminFails.delete(ip);
}, ADMIN_LOCK_MS).unref();

function requireAdmin(req, res, next) {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  let fails = adminFails.get(ip);
  if (fails && now > fails.reset) { adminFails.delete(ip); fails = null; }
  if (fails && fails.count >= ADMIN_MAX_FAILS) {
    res.setHeader('Retry-After', String(Math.ceil((fails.reset - now) / 1000)));
    return res.status(429).type('text/plain; charset=utf-8').send('Слишком много неудачных попыток входа. Повторите через 15 минут.');
  }
  const header = req.get('Authorization') || '';
  const [scheme, encoded] = header.split(' ');
  if (scheme === 'Basic' && encoded) {
    const decoded = Buffer.from(encoded, 'base64').toString('utf8');
    const sep = decoded.indexOf(':');
    const user = sep === -1 ? decoded : decoded.slice(0, sep);
    const pass = sep === -1 ? '' : decoded.slice(sep + 1);
    if (sameSecret(user, ADMIN_USER) && sameSecret(pass, ADMIN_PASS)) {
      adminFails.delete(ip);
      return next();
    }
    if (!fails) { fails = { count: 0, reset: now + ADMIN_LOCK_MS }; adminFails.set(ip, fails); }
    fails.count += 1;
    if (fails.count >= ADMIN_MAX_FAILS) console.warn(`[admin] ${ip}: ${ADMIN_MAX_FAILS} неверных паролей подряд — вход закрыт на 15 минут`);
  }
  // Значение заголовка передаётся по HTTP как ASCII — кириллица в realm
  // приводит к ошибке «Invalid character in header content».
  res.setHeader('WWW-Authenticate', 'Basic realm="MUP Borisoglebskie teploseti - admin"');
  res.status(401).type('text/plain; charset=utf-8').send('Требуется авторизация');
}

app.use('/admin', requireAdmin);
app.use('/api/admin', requireAdmin);

app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin', 'index.html')));
app.use('/admin', express.static(path.join(__dirname, 'admin')));

app.get('/api/admin/records/:kind', async (req, res) => {
  const kind = req.params.kind;
  if (!['readings', 'appeals', 'contracts'].includes(kind)) return res.status(404).json({ ok: false });
  res.json({ ok: true, items: await readRecords(kind) });
});

// маршрут выгрузки заявок для программы — раньше общего «/api/admin/export/:kind.csv»: иначе его имя попало бы в :kind
/* ---------- Заявки на договор для программы начислений (25.10.2026) ----------
 * «Скачать заявки на договор»: файл для Excel и для загрузки в «Теплобиллинг» (раздел «Юридические лица» → «Заявки с сайта»).
 * Колонки — по-русски и в том порядке, который ждёт программа; IP-адрес и приложенные файлы в выгрузку не входят. Отбор
 * ?status=new — только новые заявки. Ячейки, начинающиеся с = + - @, гасятся апострофом, как в общей выгрузке. */
const APPLICANT_LABELS = { legal: 'организация', individual: 'гражданин' };
const PURPOSE_LABELS = {
  new: 'Заключить новый договор',
  change: 'Внести изменения в действующий договор',
  reassign: 'Переоформить договор на нового собственника',
  terminate: 'Расторгнуть договор',
};
const STATUS_LABELS = { new: 'новая', work: 'в работе', done: 'обработана' };
const CONTRACT_EXPORT_COLUMNS = [
  ['Номер заявки', (r) => r.ticket],
  ['Дата заявки', (r) => moscowTime(r.createdAt)],
  ['Кто подаёт', (r) => APPLICANT_LABELS[r.applicantType] || r.applicantType],
  ['Цель заявки', (r) => PURPOSE_LABELS[r.purpose] || r.purpose],
  ['Наименование организации', (r) => (r.applicantType === 'legal' ? r.orgName : '')],
  ['ИНН', (r) => (r.applicantType === 'legal' ? r.inn : '')],
  ['ФИО заявителя или контактного лица', (r) => r.fio],
  ['Адрес объекта', (r) => r.objectAddress],
  ['Лицевой счёт или номер договора', (r) => r.account],
  ['Телефон', (r) => r.phone],
  ['Электронная почта', (r) => r.email],
  ['Комментарий', (r) => r.comment],
  ['Статус на сайте', (r) => STATUS_LABELS[r.status || 'new'] || r.status],
];

function moscowTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  // «25.10.2026 10:15» по московскому времени: так дата читается в Excel и в программе
  const parts = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d);
  const get = (t) => (parts.find((p) => p.type === t) || {}).value || '';
  return `${get('day')}.${get('month')}.${get('year')} ${get('hour')}:${get('minute')}`;
}

function csvCell(v) {
  const s = String(v ?? '').replace(/\r?\n/g, ' ');
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

app.get('/api/admin/export/contracts-for-billing.csv', async (req, res) => {
  const onlyNew = req.query.status === 'new';
  const rows = (await readRecords('contracts', 100000)).filter((r) => !onlyNew || (r.status || 'new') === 'new');
  const csv = [CONTRACT_EXPORT_COLUMNS.map(([title]) => csvCell(title)).join(';'), ...rows.map((r) => CONTRACT_EXPORT_COLUMNS.map(([, get]) => csvCell(get(r))).join(';'))].join('\r\n');
  const day = moscowTime(new Date().toISOString()).slice(0, 10).split('.').reverse().join('-');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="zayavki-na-dogovor-${day}${onlyNew ? '-novye' : ''}.csv"`);
  res.send('\uFEFF' + csv); // BOM — чтобы Excel открыл кириллицу
});

app.get('/api/admin/export/:kind.csv', async (req, res) => {
  const kind = req.params.kind;
  if (!['readings', 'appeals', 'contracts'].includes(kind)) return res.status(404).end();
  const rows = await readRecords(kind, 100000);
  const cols = [...rows.reduce((set, row) => {
    Object.keys(row).forEach((k) => { if (k !== 'files') set.add(k); });
    return set;
  }, new Set())];
  // Заявку присылает кто угодно. Excel выполняет ячейку, начинающуюся с = + - @,
  // поэтому такие значения гасим апострофом — иначе выгрузка атакует того, кто её открыл.
  const esc = (v) => {
    const s = String(v ?? '');
    const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  const csv = [cols.join(';'), ...rows.map((r) => cols.map((c) => esc(r[c])).join(';'))].join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${kind}.csv"`);
  res.send('﻿' + csv); // BOM — чтобы Excel открыл кириллицу
});

app.get('/api/admin/file/*', (req, res) => {
  const rel = decodeURIComponent(req.params[0] || '');
  const target = path.resolve(UPLOAD_DIR, rel);
  if (!target.startsWith(UPLOAD_DIR + path.sep)) return res.status(400).end();
  res.sendFile(target, (err) => { if (err) res.status(404).end(); });
});

app.get('/api/admin/docs', async (req, res) =>
  res.json({ sections: DOC_SECTIONS, groups: DOC_GROUPS, docs: await readDocs() }));

app.post('/api/admin/docs', docUpload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, message: 'Файл не выбран' });
  const section = Object.prototype.hasOwnProperty.call(DOC_SECTIONS, req.body.section) ? req.body.section : 'prochee';
  const title = clean(req.body.title, 200) || req.file._displayName || 'Документ';
  const docs = await readDocs();
  docs.unshift({
    id: path.basename(req.file.filename, path.extname(req.file.filename)),
    title,
    section,
    file: req.file.filename,
    ext: path.extname(req.file.filename).toLowerCase(),
    size: req.file.size,
    uploaded: new Date().toISOString(),
  });
  await writeDocs(docs);
  res.json({ ok: true });
});

app.post('/api/admin/docs/:id/delete', async (req, res) => {
  const docs = await readDocs();
  const item = docs.find((d) => d.id === req.params.id);
  if (!item) return res.status(404).json({ ok: false });
  await writeDocs(docs.filter((d) => d.id !== item.id));
  // Сам файл не удаляем сразу: переносим в подпапку «удалённые», чтобы
  // случайное нажатие в панели не уничтожило документ безвозвратно.
  const trash = path.join(DOCS_DIR, 'udalennye');
  await fsp.mkdir(trash, { recursive: true });
  await fsp.rename(path.join(DOCS_DIR, item.file), path.join(trash, item.file)).catch(() => {});
  res.json({ ok: true });
});

app.get('/api/admin/contacts', async (req, res) => res.json(await readContacts()));

app.post('/api/admin/contacts', express.json({ limit: '64kb' }), async (req, res) => {
  const body = req.body || {};
  const out = {};
  for (const key of [...CONTACT_LINKS, ...CONTACT_TEXTS]) {
    const value = clean(body[key], 160);
    if (value) out[key] = value;
  }
  await writeContacts(out);
  res.json({ ok: true, saved: Object.keys(out).length });
});

app.get('/api/admin/content', async (req, res) => res.json(await readContent()));

app.post('/api/admin/content', express.json({ limit: '512kb' }), async (req, res) => {
  const body = req.body || {};
  const content = {
    announcement: body.announcement && clean(body.announcement.text, 400)
      ? {
        text: clean(body.announcement.text, 400),
        level: clean(body.announcement.level, 10) || 'info',
        link: safeLink(clean(body.announcement.link, 200)),
        // «Показывать до» (включительно); пусто — пока не уберут вручную
        until: /^\d{4}-\d{2}-\d{2}$/.test(clean(body.announcement.until, 10)) ? clean(body.announcement.until, 10) : '',
      }
      : null,
    outages: Array.isArray(body.outages) ? body.outages.slice(0, 200).map((o) => ({
      id: clean(o.id, 40) || crypto.randomUUID(),
      type: clean(o.type, 20) || 'planned',
      status: clean(o.status, 20) || 'active',
      addresses: clean(o.addresses, 600),
      reason: clean(o.reason, 300),
      start: clean(o.start, 40),
      end: clean(o.end, 40),
    })) : [],
    news: Array.isArray(body.news) ? body.news.slice(0, 200).map((n) => ({
      id: clean(n.id, 40) || crypto.randomUUID(),
      date: clean(n.date, 20),
      title: clean(n.title, 200),
      text: cleanMultiline(n.text, 4000),
      // Имя файла картинки: сохраняем только то, что сервер сам и выдал.
      image: NEWS_FILE_RE.test(clean(n.image, 80)) ? clean(n.image, 80) : '',
      pinned: Boolean(n.pinned),
    })) : [],
  };
  await writeContent(content);
  res.json({ ok: true });
});

// Загрузка картинки объявления. Возвращает имя файла — его панель кладёт
// в объявление и показывает в предпросмотре.
app.post('/api/admin/news-image', (req, res) => {
  newsImageUpload.single('image')(req, res, (err) => {
    if (err) {
      const tooBig = err.code === 'LIMIT_FILE_SIZE';
      return res.status(400).json({
        ok: false,
        error: tooBig ? 'Картинка больше 8 МБ. Уменьшите её и попробуйте снова.' : err.message,
      });
    }
    if (!req.file) return res.status(400).json({ ok: false, error: 'Файл не выбран.' });
    res.json({ ok: true, image: req.file.filename, url: `/files/news/${req.file.filename}` });
  });
});

app.post('/api/admin/status', express.json(), async (req, res) => {
  const { kind, ticket, status } = req.body || {};
  if (!['readings', 'appeals', 'contracts'].includes(kind)) return res.status(400).json({ ok: false });
  const next = clean(status, 20) || 'new';
  // через общую очередь записи: заявка, пришедшая в ту же секунду, не теряется
  await updateRecords(kind, (row) => {
    if (row.ticket !== ticket) return false;
    row.status = next;
    return true;
  });
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ */
/* Показания для программы начислений «Теплобиллинг» (27.10.2026)      */
/* ------------------------------------------------------------------ */
/* Программа сама раз в 10 минут забирает новые показания и после проверки оператором отмечает, приняты они
 * или отклонены. Доступ — только по секретному ключу BILLING_TOKEN из .env (заголовок «Authorization: Bearer …»).
 * Ключ не задан — адресов как будто нет (404). Программе отдаются только поля для лицевого счёта: номер счёта,
 * адрес, прибор, показания, примечание; телефон, почта, ФИО и IP-адрес не отдаются. */
const BILLING_TOKEN = (process.env.BILLING_TOKEN || '').trim();
const BILLING_STATUSES = new Set(['transferred', 'rejected']);

/** Ограничение частоты для программы: ответ JSON, а не переход на страницу формы. */
function jsonRateLimit({ windowMs, max }) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [key, item] of hits) if (now > item.reset) hits.delete(key);
  }, windowMs).unref();
  return (req, res, next) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    let item = hits.get(ip);
    if (!item || now > item.reset) { item = { count: 0, reset: now + windowMs }; hits.set(ip, item); }
    item.count += 1;
    if (item.count > max) {
      res.setHeader('Retry-After', String(Math.ceil((item.reset - now) / 1000)));
      return res.status(429).json({ ok: false, message: 'Слишком много запросов — повторите позже' });
    }
    next();
  };
}

const billingLimiter = jsonRateLimit({ windowMs: 10 * 60 * 1000, max: 300 });

function requireBillingToken(req, res, next) {
  if (!BILLING_TOKEN) return res.status(404).json({ ok: false, message: 'Страница не найдена' });
  const header = req.get('Authorization') || '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  // сравнение за постоянное время (sameSecret): по скорости ответа ключ не подобрать
  if (!match || !sameSecret(match[1].trim(), BILLING_TOKEN)) {
    res.setHeader('WWW-Authenticate', 'Bearer');
    return res.status(401).json({ ok: false, message: 'Нужен ключ доступа' });
  }
  res.setHeader('Cache-Control', 'no-store');
  next();
}

/** Только то, что нужно программе начислений. */
function billingReading(r) {
  return {
    ticket: r.ticket,
    createdAt: r.createdAt,
    account: r.account || '',
    meterNumber: r.meterNumber || '',
    valueHeat: r.valueHeat || '',
    valueWater: r.valueWater || '',
    address: r.address || '',
    comment: r.comment || '',
  };
}

// Новые показания: ещё не отмеченные программой; ?since=<дата ISO> — не раньше этого времени. Старые — первыми, не больше 500.
app.get('/api/billing/readings', billingLimiter, requireBillingToken, async (req, res) => {
  let since = null;
  if (req.query.since !== undefined) {
    since = Date.parse(String(req.query.since));
    if (Number.isNaN(since)) return res.status(400).json({ ok: false, message: 'since — дата и время в формате ISO' });
  }
  const limit = Math.min(Math.max(Number(req.query.limit) || 500, 1), 500);
  const rows = (await readRecords('readings', Infinity))
    .filter((r) => r && r.ticket && !r.billingStatus && (since === null || Date.parse(r.createdAt) >= since))
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
    .slice(0, limit)
    .map(billingReading);
  res.json({ ok: true, items: rows });
});

// Отметка программы: показание принято в лицевой счёт или отклонено с причиной — видно в панели, вкладка «Показания»
app.post('/api/billing/readings/:ticket/status', billingLimiter, requireBillingToken, async (req, res) => {
  const ticket = clean(req.params.ticket, 40);
  const { status, note } = req.body || {};
  if (!BILLING_STATUSES.has(status)) return res.status(400).json({ ok: false, message: 'status — transferred или rejected' });
  const text = clean(note, 300);
  if (status === 'rejected' && !text) return res.status(400).json({ ok: false, message: 'Для отклонения нужна причина (note)' });
  const changed = await updateRecords('readings', (row) => {
    if (row.ticket !== ticket) return false;
    row.billingStatus = status;
    row.billingNote = text;
    row.billingAt = new Date().toISOString();
    return true;
  });
  if (changed === 0) return res.status(404).json({ ok: false, message: 'Заявка не найдена' });
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ */
/* Ошибки                                                              */
/* ------------------------------------------------------------------ */

app.use((err, req, res, next) => {
  // Панель управления ждёт ответ в JSON: перенаправление на «Заявка отправлена»
  // там неуместно — человек должен увидеть причину отказа прямо в панели.
  if (req.path.startsWith('/api/admin/') || req.path.startsWith('/api/billing/')) {
    const message = err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE'
      ? 'Файл больше 25 МБ. Уменьшите размер и попробуйте снова.'
      : (err && err.message) || 'Не удалось выполнить действие';
    console.error('[admin]', err);
    return res.status(400).json({ ok: false, message });
  }
  if (err instanceof multer.MulterError) {
    const map = {
      LIMIT_FILE_SIZE: `Файл больше ${MAX_FILE_MB} МБ. Уменьшите размер и попробуйте снова.`,
      LIMIT_FILE_COUNT: `Можно приложить не более ${MAX_FILES} файлов.`,
    };
    return respond(req, res, { ok: false, message: map[err.code] || 'Не удалось загрузить файл', backTo: safeBackTo(req) });
  }
  if (err && err.message) {
    console.error('[error]', err);
    return respond(req, res, { ok: false, message: 'Не удалось обработать запрос. Попробуйте ещё раз или сообщите в абонентский отдел.', backTo: safeBackTo(req) });
  }
  next(err);
});

app.use((req, res) => {
  res.status(404);
  if (wantsJSON(req)) return res.json({ ok: false, message: 'Страница не найдена' });
  res.sendFile(path.join(PUBLIC_DIR, '404.html'), (err) => { if (err) res.type('text/plain').send('Страница не найдена'); });
});

app.listen(PORT, HOST, () => {
  console.log(`МУП «Борисоглебские теплосети» — сайт запущен`);
  console.log(`  сайт:   http://localhost:${PORT}/`);
  console.log(`  панель: http://localhost:${PORT}/admin  (логин ${ADMIN_USER})`);
});
