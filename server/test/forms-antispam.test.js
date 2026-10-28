'use strict';
/**
 * Защита форм от спама (28.10.2026): пример «я человек» с одноразовым токеном, пауза 3 секунды,
 * лимиты за сутки на лицевой счёт и на адрес, строгая проверка полей показаний.
 * Запуск: `npm test` в папке server.
 *
 * Сервер поднимается настоящим процессом, заявки пишутся во временную папку (SITE_DATA_DIR).
 * Разные «адреса» жителей изображаются заголовком X-Forwarded-For — на боевом сервере его ставит nginx.
 * Данные выдуманные.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { createFormCheck } = require('../form-check');

const servers = [];

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

async function startServer(extraEnv = {}) {
  const port = await freePort();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'site-forms-'));
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: {
      ...process.env, PORT: String(port), HOST: '127.0.0.1', SITE_DATA_DIR: dataDir, ADMIN_USER: 'admin', ADMIN_PASS: 'proverka',
      BILLING_TOKEN: '', FORM_CHECK_SECRET: 'proverochnyi-sekret-dlya-testa', FORM_CHECK_MIN_MS: '0',
      FORM_LIMIT_ACCOUNT_DAY: '', FORM_LIMIT_IP_DAY: '', ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i += 1) {
    try {
      await fetch(`${base}/api/content`);
      servers.push({ child, dataDir });
      return { base, dataDir };
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  child.kill();
  throw new Error(`сервер не поднялся:\n${log}`);
}

let site; // без паузы 3 с — проверяются пример, лимиты и поля
let slow; // с обычной паузой 3 с

before(async () => {
  [site, slow] = await Promise.all([startServer(), startServer({ FORM_CHECK_MIN_MS: '' })]);
});

after(() => {
  for (const { child, dataDir } of servers) {
    child.kill();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

let ipSeq = 0;
/** Новый «адрес жителя» для каждой проверки — чтобы лимит на адрес не мешал соседним проверкам. */
function newIp() { ipSeq += 1; return `10.0.${Math.floor(ipSeq / 250)}.${(ipSeq % 250) + 1}`; }

async function getCheck(base) {
  const res = await fetch(`${base}/api/form-check`);
  assert.equal(res.status, 200);
  return res.json();
}

function answerOf(question) {
  const [, a, b] = /^Сколько будет (\d) \+ (\d)\?$/.exec(question);
  return String(Number(a) + Number(b));
}

async function solved(base) {
  const { question, token } = await getCheck(base);
  return { checkToken: token, checkAnswer: answerOf(question) };
}

const READING = {
  account: '100200', fio: 'Петров Пётр Петрович', address: 'ул. Проверочная, д. 2, кв. 7', meterNumber: 'ГВ-0002',
  valueHeat: '', valueWater: '123,450', phone: '+7 900 000-00-01', email: '', comment: '', consent: 'on',
};

async function post(base, url, fields, ip) {
  const res = await fetch(`${base}${url}`, {
    method: 'POST',
    body: new URLSearchParams(fields),
    headers: { Accept: 'application/json', 'X-Forwarded-For': ip || newIp() },
  });
  return { status: res.status, body: await res.json() };
}

function readingsInFile(dataDir) {
  const file = path.join(dataDir, 'readings.ndjson');
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

/* ---------------- Пример и токен — сам механизм, с подменёнными часами ---------------- */

test('пример: верный ответ принимается один раз, повторно тот же токен — нет', () => {
  let now = 1_000_000;
  const fc = createFormCheck({ secret: 's', minMs: 3000, now: () => now });
  const { question, token } = fc.issue();
  assert.match(question, /^Сколько будет \d \+ \d\?$/);
  now += 5000;
  assert.deepEqual(fc.verify(token, answerOf(question)), { ok: true });
  assert.deepEqual(fc.verify(token, answerOf(question)), { ok: false, reason: 'used' });
});

test('пример: ответа в токене нет; неверный ответ отклоняется и гасит токен', () => {
  let now = 1_000_000;
  const fc = createFormCheck({ secret: 's', minMs: 3000, now: () => now });
  const { question, token } = fc.issue();
  const payload = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString('utf8'));
  assert.deepEqual(Object.keys(payload).sort(), ['h', 'id', 't']);
  now += 5000;
  const wrong = String(Number(answerOf(question)) + 1);
  assert.deepEqual(fc.verify(token, wrong), { ok: false, reason: 'wrong' });
  assert.deepEqual(fc.verify(token, answerOf(question)), { ok: false, reason: 'used' }, 'перебирать ответы по одному токену нельзя');
  const next = fc.issue();
  now += 5000;
  assert.deepEqual(fc.verify(next.token, 'семь'), { ok: false, reason: 'wrong' });
});

test('пример: через 30 минут токен просрочен; подделанный или чужой токен не принимается', () => {
  let now = 1_000_000;
  const fc = createFormCheck({ secret: 's', minMs: 3000, now: () => now });
  const { question, token } = fc.issue();
  now += 30 * 60 * 1000 + 1;
  assert.deepEqual(fc.verify(token, answerOf(question)), { ok: false, reason: 'expired' });

  const fresh = fc.issue();
  now += 5000;
  const [payload, sig] = fresh.token.split('.');
  const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  const forged = Buffer.from(JSON.stringify({ ...data, t: data.t - 10 * 60 * 1000 })).toString('base64url');
  assert.deepEqual(fc.verify(`${forged}.${sig}`, answerOf(fresh.question)), { ok: false, reason: 'invalid' });
  const other = createFormCheck({ secret: 'drugoi', now: () => now }).issue();
  now += 5000;
  assert.deepEqual(fc.verify(other.token, answerOf(other.question)), { ok: false, reason: 'invalid' });
  assert.deepEqual(fc.verify('', '7'), { ok: false, reason: 'missing' });
  assert.deepEqual(fc.verify('мусор', '7'), { ok: false, reason: 'invalid' });
});

test('пример: ответ быстрее 3 секунд после выдачи — «слишком быстро»', () => {
  let now = 1_000_000;
  const fc = createFormCheck({ secret: 's', minMs: 3000, now: () => now });
  const { question, token } = fc.issue();
  now += 2000;
  assert.deepEqual(fc.verify(token, answerOf(question)), { ok: false, reason: 'too-fast' });
});

/* ---------------- Сервер: форма показаний ---------------- */

test('GET /api/form-check — пример и токен, без кеширования', async () => {
  const res = await fetch(`${site.base}/api/form-check`);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const body = await res.json();
  assert.match(body.question, /^Сколько будет \d \+ \d\?$/);
  assert.equal(typeof body.token, 'string');
  assert.deepEqual(Object.keys(body).sort(), ['question', 'token']);
});

test('показания: с верным ответом принимаются; без примера, с неверным и повторным — ошибка у поля и новый пример', async () => {
  const before = readingsInFile(site.dataDir).length;
  const check = await solved(site.base);
  const ok = await post(site.base, '/api/readings', { ...READING, account: '700001', valueWater: '000123,4', ...check });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.match(ok.body.ticket, /^ПУ-\d{6}-\d{4}$/);

  const again = await post(site.base, '/api/readings', { ...READING, account: '700002', ...check });
  assert.equal(again.status, 400);
  assert.ok(again.body.errors.checkAnswer);
  assert.match(again.body.check.question, /^Сколько будет/);

  const noCheck = await post(site.base, '/api/readings', { ...READING, account: '700003' });
  assert.equal(noCheck.status, 400);
  assert.match(noCheck.body.errors.checkAnswer, /Впишите ответ/);

  const fresh = await getCheck(site.base);
  const wrong = await post(site.base, '/api/readings', {
    ...READING, account: '700004', checkToken: fresh.token, checkAnswer: String(Number(answerOf(fresh.question)) + 1),
  });
  assert.equal(wrong.status, 400);
  assert.match(wrong.body.errors.checkAnswer, /неверный/);
  assert.ok(wrong.body.check.token && wrong.body.check.token !== fresh.token, 'выдан новый пример');

  // новый пример из ответа об ошибке подходит для следующей попытки
  const retry = await post(site.base, '/api/readings', {
    ...READING, account: '700004', checkToken: wrong.body.check.token, checkAnswer: answerOf(wrong.body.check.question),
  });
  assert.equal(retry.status, 200, JSON.stringify(retry.body));

  const rows = readingsInFile(site.dataDir);
  assert.equal(rows.length, before + 2);
  assert.deepEqual(rows.slice(-2).map((r) => r.account), ['700001', '700004']);
});

test('показания: ошибка в полях не тратит пример — после исправления тот же пример подходит', async () => {
  const check = await solved(site.base);
  const bad = await post(site.base, '/api/readings', { ...READING, account: '12ab5', ...check });
  assert.equal(bad.status, 400);
  assert.ok(bad.body.errors.account);
  const good = await post(site.base, '/api/readings', { ...READING, account: '700010', ...check });
  assert.equal(good.status, 200, JSON.stringify(good.body));
});

test('ловушка заполнена — ответ «принято», но ничего не записано', async () => {
  const before = readingsInFile(site.dataDir).length;
  const res = await post(site.base, '/api/readings', { ...READING, account: '700020', website: 'http://spam', ...(await solved(site.base)) });
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.match(res.body.ticket, /^ПУ-/);
  assert.equal(readingsInFile(site.dataDir).length, before);
});

test('слишком быстро (меньше 3 секунд после примера) — ответ «принято», но ничего не записано; через 3 секунды — принимается', async () => {
  const fast = await solved(slow.base);
  const res = await post(slow.base, '/api/readings', { ...READING, account: '700030', ...fast });
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(readingsInFile(slow.dataDir).length, 0);

  const human = await solved(slow.base);
  await new Promise((r) => setTimeout(r, 3100));
  const ok = await post(slow.base, '/api/readings', { ...READING, account: '700031', ...human });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(readingsInFile(slow.dataDir).length, 1);
  // быстрый токен погашен: тот же пример после паузы не принимается
  const reuse = await post(slow.base, '/api/readings', { ...READING, account: '700032', ...fast });
  assert.equal(reuse.status, 400);
});

test('лимит на лицевой счёт: не больше 3 заявок за сутки, с любых адресов', async () => {
  for (let i = 0; i < 3; i += 1) {
    const res = await post(site.base, '/api/readings', { ...READING, account: '800001', ...(await solved(site.base)) });
    assert.equal(res.status, 200, JSON.stringify(res.body));
  }
  const fourth = await post(site.base, '/api/readings', { ...READING, account: '800001', ...(await solved(site.base)) });
  assert.equal(fourth.status, 400);
  assert.match(fourth.body.errors.account, /уже 3 раза/);
  // другой счёт с того же устройства — можно
  const other = await post(site.base, '/api/readings', { ...READING, account: '800002', ...(await solved(site.base)) });
  assert.equal(other.status, 200);
});

test('лимит на счёт считается по файлу заявок: перезапуск не обнуляет, заявки старше суток не считаются', async () => {
  const file = path.join(site.dataDir, 'readings.ndjson');
  const now = Date.now();
  const rows = [
    { ticket: 'ПУ-010125-1001', account: '800100', createdAt: new Date(now - 25 * 3600 * 1000).toISOString() },
    { ticket: 'ПУ-010125-1002', account: '800100', createdAt: new Date(now - 25 * 3600 * 1000).toISOString() },
    { ticket: 'ПУ-010125-1003', account: '800100', createdAt: new Date(now - 25 * 3600 * 1000).toISOString() },
    { ticket: 'ПУ-010125-1004', account: '800200', createdAt: new Date(now - 3600 * 1000).toISOString() },
    { ticket: 'ПУ-010125-1005', account: '800200', createdAt: new Date(now - 3600 * 1000).toISOString() },
    { ticket: 'ПУ-010125-1006', account: '800200', createdAt: new Date(now - 3600 * 1000).toISOString() },
  ];
  fs.appendFileSync(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const old = await post(site.base, '/api/readings', { ...READING, account: '800100', ...(await solved(site.base)) });
  assert.equal(old.status, 200, 'вчерашние заявки не мешают');
  const recent = await post(site.base, '/api/readings', { ...READING, account: '800200', ...(await solved(site.base)) });
  assert.equal(recent.status, 400, 'заявки, записанные до перезапуска, считаются');
  assert.ok(recent.body.errors.account);
});

// по умолчанию 30 заявок с адреса в сутки (общие адреса мобильных операторов); механизм проверяется на 10 — заданных настройкой
test('лимит на адрес: не больше заданного числа заявок всех видов за сутки (FORM_LIMIT_IP_DAY=10)', async () => {
  const site = await startServer({ FORM_LIMIT_IP_DAY: '10' });
  const ip = '10.99.0.1';
  for (let i = 0; i < 9; i += 1) {
    const res = await post(site.base, '/api/readings', { ...READING, account: `90000${i}`, ...(await solved(site.base)) }, ip);
    assert.equal(res.status, 200, JSON.stringify(res.body));
  }
  const appeal = await post(site.base, '/api/appeals', {
    topic: 'Качество отопления', fio: 'Петров Пётр Петрович', email: 'proverka@example.ru', replyBy: 'email',
    message: 'В квартире холодно уже третий день подряд, прошу проверить.', consent: 'on', ...(await solved(site.base)),
  }, ip);
  assert.equal(appeal.status, 200, JSON.stringify(appeal.body));
  const eleventh = await post(site.base, '/api/readings', { ...READING, account: '900010', ...(await solved(site.base)) }, ip);
  assert.equal(eleventh.status, 400);
  assert.match(eleventh.body.message, /за сутки отправлено слишком много заявок/);
  const otherIp = await post(site.base, '/api/readings', { ...READING, account: '900010', ...(await solved(site.base)) });
  assert.equal(otherIp.status, 200, 'с другого адреса — можно');
});

test('проверка полей показаний: лицевой счёт, показания, согласие — понятные ошибки у полей', async () => {
  const cases = [
    [{ account: '' }, 'account', /Укажите номер лицевого счёта/],
    [{ account: '12a45' }, 'account', /только цифры, от 5 до 12/],
    [{ account: '1234' }, 'account', /от 5 до 12/],
    [{ account: '1234567890123' }, 'account', /от 5 до 12/],
    [{ valueWater: '', valueHeat: '' }, 'valueHeat', /хотя бы одно показание/],
    [{ valueWater: '12,3456' }, 'valueWater', /не больше трёх цифр после запятой/],
    [{ valueWater: '-5' }, 'valueWater', /цифрами/],
    [{ valueWater: '1e5' }, 'valueWater', /цифрами/],
    [{ valueHeat: '1000000' }, 'valueHeat', /больше 999 999/],
    [{ valueHeat: '999999,001' }, 'valueHeat', /больше 999 999/],
    [{ consent: '' }, 'consent', /согласия/],
  ];
  for (const [fields, field, message] of cases) {
    const res = await post(site.base, '/api/readings', { ...READING, account: '700100', ...fields, ...(await solved(site.base)) });
    assert.equal(res.status, 400, JSON.stringify(fields));
    assert.match(res.body.errors[field] || '', message, JSON.stringify(fields));
  }
  // граничные верные значения: 5 и 12 цифр, ноль, 999999, пробелы в номере счёта
  for (const fields of [{ account: '12345', valueWater: '0' }, { account: '123456789012', valueHeat: '999999', valueWater: '' }, { account: '700 101', valueWater: '5,125' }]) {
    const res = await post(site.base, '/api/readings', { ...READING, ...fields, ...(await solved(site.base)) });
    assert.equal(res.status, 200, `${JSON.stringify(fields)}: ${JSON.stringify(res.body)}`);
  }
  assert.equal(readingsInFile(site.dataDir).at(-1).account, '700101');
});

/* ---------------- Обращения и договор — тот же механизм ---------------- */

test('обращения: без примера — ошибка, с верным ответом — принимаются', async () => {
  const appeal = {
    topic: 'Начисления', fio: 'Сидорова Анна Ивановна', email: 'proverka@example.ru', replyBy: 'email',
    message: 'Прошу проверить начисление за отопление за сентябрь.', consent: 'on',
  };
  const no = await post(site.base, '/api/appeals', appeal);
  assert.equal(no.status, 400);
  assert.ok(no.body.errors.checkAnswer);
  const ok = await post(site.base, '/api/appeals', { ...appeal, ...(await solved(site.base)) });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.match(ok.body.ticket, /^ОБ-/);
});

test('договор (с файлами): без примера — ошибка, с верным ответом — принимается', async () => {
  const send = async (extra) => {
    const form = new FormData();
    const fields = {
      applicantType: 'individual', fio: 'Сидоров Иван Иванович', objectAddress: 'ул. Проверочная, д. 3',
      phone: '+7 900 000-00-02', email: 'proverka@example.ru', consent: 'on', ...extra,
    };
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    form.append('files', new Blob(['%PDF-1.4 proverka'], { type: 'application/pdf' }), 'pasport.pdf');
    const res = await fetch(`${site.base}/api/contracts`, { method: 'POST', body: form, headers: { Accept: 'application/json', 'X-Forwarded-For': newIp() } });
    return { status: res.status, body: await res.json() };
  };
  const no = await send({});
  assert.equal(no.status, 400);
  assert.ok(no.body.errors.checkAnswer);
  const ok = await send(await solved(site.base));
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.match(ok.body.ticket, /^ДГ-/);
});
