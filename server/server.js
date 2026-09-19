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
const DATA_DIR = path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(__dirname, 'uploads');
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

const MAX_FILE_MB = 10;
const MAX_FILES = 10;
const ALLOWED_EXT = new Set(['.pdf', '.jpg', '.jpeg', '.png', '.heic', '.doc', '.docx', '.xls', '.xlsx', '.rtf', '.odt']);

for (const dir of [DATA_DIR, UPLOAD_DIR]) fs.mkdirSync(dir, { recursive: true });

/* ------------------------------------------------------------------ */
/* Хранилище                                                           */
/* ------------------------------------------------------------------ */

function appendRecord(kind, record) {
  const line = JSON.stringify(record) + '\n';
  return fsp.appendFile(path.join(DATA_DIR, `${kind}.ndjson`), line, 'utf8');
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
function respond(req, res, { ok, ticket, message, errors, backTo }) {
  if (wantsJSON(req)) {
    return res.status(ok ? 200 : 400).json({ ok, ticket, message, errors });
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

app.get(/^\/(?:[\w-]+(?:\.html)?)?$/, async (req, res, next) => {
  const name = req.path === '/' ? 'index' : req.path.slice(1).replace(/\.html$/, '');
  const file = `${name}.html`;
  if (!PAGE_FILES.has(file)) return next();
  try {
    let html = withAnnouncement(await pageHtml(file), publicContent(await readContent()).announcement);
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

/* ---------- Показания приборов учёта ---------- */

// upload.none() разбирает multipart без файлов: страховка на случай, если
// форму отправят как FormData.
app.post('/api/readings', formLimiter, express.urlencoded({ extended: false }), upload.none(), async (req, res) => {
  const b = req.body || {};
  if (clean(b.website)) return respond(req, res, { ok: true, ticket: makeTicket('readings'), message: 'Показания приняты' }); // honeypot

  const data = {
    account: clean(b.account, 30),
    fio: clean(b.fio, 150),
    address: clean(b.address, 250),
    meterNumber: clean(b.meterNumber, 40),
    valueHeat: clean(b.valueHeat, 20),
    valueWater: clean(b.valueWater, 20),
    phone: clean(b.phone, 25),
    email: clean(b.email, 100),
    comment: cleanMultiline(b.comment, 1000),
    consent: b.consent === 'on' || b.consent === 'true' || b.consent === '1',
  };

  const errors = {};
  if (!data.account) errors.account = 'Укажите номер лицевого счёта';
  if (!data.address) errors.address = 'Укажите адрес помещения';
  if (!data.valueHeat && !data.valueWater) errors.valueHeat = 'Введите хотя бы одно показание';
  for (const key of ['valueHeat', 'valueWater']) {
    if (data[key] && !/^\d{1,9}([.,]\d{1,4})?$/.test(data[key])) {
      errors[key] = 'Показание вводится цифрами, например 1245,300';
    }
  }
  if (!data.phone) errors.phone = 'Укажите телефон для обратной связи';
  else if (!RE_PHONE.test(data.phone)) errors.phone = 'Проверьте номер телефона';
  if (data.email && !RE_EMAIL.test(data.email)) errors.email = 'Проверьте адрес электронной почты';
  if (!data.consent) errors.consent = 'Без согласия на обработку персональных данных заявка не принимается';

  if (Object.keys(errors).length) {
    return respond(req, res, { ok: false, errors, message: 'Проверьте заполнение формы', backTo: '/pokazaniya.html' });
  }

  const ticket = makeTicket('readings');
  await appendRecord('readings', {
    ticket, kind: 'readings', createdAt: new Date().toISOString(), status: 'new',
    ip: req.ip, ...data,
  });
  respond(req, res, { ok: true, ticket, message: 'Показания приняты и переданы в абонентский отдел' });
});

/* ---------- Обращения граждан (59-ФЗ) ---------- */

app.post('/api/appeals', formLimiter, upload.array('files', MAX_FILES), async (req, res) => {
  const b = req.body || {};
  if (clean(b.website)) return respond(req, res, { ok: true, ticket: makeTicket('appeals'), message: 'Обращение принято' });

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

  if (Object.keys(errors).length) {
    return respond(req, res, { ok: false, errors, message: 'Проверьте заполнение формы', backTo: '/obrashcheniya.html' });
  }

  const files = (req.files || []).map((f) => ({
    name: f._displayName || f.originalname,
    stored: path.relative(UPLOAD_DIR, f.path).replace(/\\/g, '/'),
    size: f.size,
  }));

  const ticket = makeTicket('appeals');
  await appendRecord('appeals', {
    ticket, kind: 'appeals', createdAt: new Date().toISOString(), status: 'new',
    ip: req.ip, ...data, files,
  });
  respond(req, res, { ok: true, ticket, message: 'Обращение зарегистрировано. Срок рассмотрения — 30 дней со дня регистрации' });
});

/* ---------- Заявка на заключение договора ---------- */

app.post('/api/contracts', formLimiter, upload.array('files', MAX_FILES), async (req, res) => {
  const b = req.body || {};
  if (clean(b.website)) return respond(req, res, { ok: true, ticket: makeTicket('contracts'), message: 'Заявка принята' });

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

  if (Object.keys(errors).length) {
    // Загруженные файлы отклонённой заявки не храним.
    if (req._uploadDir) fsp.rm(req._uploadDir, { recursive: true, force: true }).catch(() => {});
    return respond(req, res, { ok: false, errors, message: 'Проверьте заполнение формы', backTo: '/dogovor.html' });
  }

  const files = (req.files || []).map((f) => ({
    name: f._displayName || f.originalname,
    stored: path.relative(UPLOAD_DIR, f.path).replace(/\\/g, '/'),
    size: f.size,
  }));

  const ticket = makeTicket('contracts');
  await appendRecord('contracts', {
    ticket, kind: 'contracts', createdAt: new Date().toISOString(), status: 'new',
    ip: req.ip, ...data, files,
  });
  respond(req, res, { ok: true, ticket, message: 'Заявка и документы приняты. Специалист свяжется с вами в течение 3 рабочих дней' });
});

/* ---------- Публичный контент ---------- */

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
      pinned: Boolean(n.pinned),
    })) : [],
  };
  await writeContent(content);
  res.json({ ok: true });
});

app.post('/api/admin/status', express.json(), async (req, res) => {
  const { kind, ticket, status } = req.body || {};
  if (!['readings', 'appeals', 'contracts'].includes(kind)) return res.status(400).json({ ok: false });
  const file = path.join(DATA_DIR, `${kind}.ndjson`);
  let raw = '';
  try { raw = await fsp.readFile(file, 'utf8'); } catch { return res.status(404).json({ ok: false }); }
  const out = raw.split('\n').filter(Boolean).map((line) => {
    try {
      const row = JSON.parse(line);
      if (row.ticket === ticket) row.status = clean(status, 20) || 'new';
      return JSON.stringify(row);
    } catch { return line; }
  }).join('\n') + '\n';
  await fsp.writeFile(file, out, 'utf8');
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ */
/* Ошибки                                                              */
/* ------------------------------------------------------------------ */

app.use((err, req, res, next) => {
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
