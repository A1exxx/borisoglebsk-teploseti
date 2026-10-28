'use strict';
/**
 * Проверка адресов для программы начислений (27.10.2026): GET /api/billing/readings и
 * POST /api/billing/readings/:ticket/status. Запуск: `npm test` в папке server.
 *
 * Сервер поднимается настоящим процессом на свободном порту, заявки пишутся во временную папку
 * (SITE_DATA_DIR) — рабочие данные не трогаются. Данные выдуманные.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');

const TOKEN = 'proverochnyi-klyuch-dlya-testa-0123456789';
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

async function startServer(extraEnv) {
  const port = await freePort();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'site-billing-'));
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', SITE_DATA_DIR: dataDir, ADMIN_USER: 'admin', ADMIN_PASS: 'proverka', BILLING_TOKEN: '',
      // защита форм здесь не проверяется (она — в forms-antispam.test.js): без паузы 3 с и без суточного лимита на адрес
      FORM_CHECK_MIN_MS: '0', FORM_LIMIT_IP_DAY: '1000', ...extraEnv },
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

const auth = { Authorization: `Bearer ${TOKEN}` };
let site;
let siteOff;

before(async () => {
  site = await startServer({ BILLING_TOKEN: TOKEN });
  siteOff = await startServer({});
});

after(() => {
  for (const { child, dataDir } of servers) {
    child.kill();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

/** Пример «я человек» с сервера и верный ответ на него. */
async function solvedCheck(base) {
  const { question, token } = await (await fetch(`${base}/api/form-check`)).json();
  const [, a, b] = /(\d+) \+ (\d+)/.exec(question);
  return { checkToken: token, checkAnswer: String(Number(a) + Number(b)) };
}

async function submitReading(base, fields) {
  const body = new URLSearchParams({
    ...(await solvedCheck(base)),
    account: '100200', fio: 'Иванов Иван Иванович', address: 'ул. Проверочная, д. 1, кв. 5', meterNumber: 'ГВ-0001',
    valueHeat: '', valueWater: '123,450', phone: '+7 900 000-00-00', email: 'proverka@example.ru', comment: 'проверка', consent: 'on',
    ...fields,
  });
  const res = await fetch(`${base}/api/readings`, { method: 'POST', body, headers: { Accept: 'application/json' } });
  assert.equal(res.status, 200, await res.clone().text());
  return (await res.json()).ticket;
}

test('ключ не задан — адресов для программы нет (404), даже с ключом в заголовке', async () => {
  const res = await fetch(`${siteOff.base}/api/billing/readings`, { headers: auth });
  assert.equal(res.status, 404);
  const mark = await fetch(`${siteOff.base}/api/billing/readings/ПУ-1/status`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: '{"status":"transferred"}' });
  assert.equal(mark.status, 404);
});

test('без ключа и с неверным ключом — 401', async () => {
  assert.equal((await fetch(`${site.base}/api/billing/readings`)).status, 401);
  assert.equal((await fetch(`${site.base}/api/billing/readings`, { headers: { Authorization: 'Bearer neverno' } })).status, 401);
  assert.equal((await fetch(`${site.base}/api/billing/readings`, { headers: { Authorization: `Basic ${TOKEN}` } })).status, 401);
  const mark = await fetch(`${site.base}/api/billing/readings/ПУ-1/status`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"status":"transferred"}' });
  assert.equal(mark.status, 401);
});

test('новые показания отдаются без телефона, почты, ФИО и IP; отметка программы убирает показание из выдачи и видна в панели', async () => {
  const first = await submitReading(site.base, {});
  const second = await submitReading(site.base, { account: '100201', valueWater: '', valueHeat: '5,5' });

  const res = await fetch(`${site.base}/api/billing/readings`, { headers: auth });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const text = await res.text();
  for (const secret of ['+7 900', 'proverka@example.ru', 'Иванов', '127.0.0.1']) assert.ok(!text.includes(secret), `в ответе есть «${secret}»`);
  const { items } = JSON.parse(text);
  assert.deepEqual(items.map((i) => i.ticket), [first, second]);
  assert.deepEqual(Object.keys(items[0]).sort(), ['account', 'address', 'comment', 'createdAt', 'meterNumber', 'ticket', 'valueHeat', 'valueWater']);
  assert.equal(items[0].valueWater, '123,450');
  assert.equal(items[0].account, '100200');

  // since — не раньше времени второго показания
  const since = await (await fetch(`${site.base}/api/billing/readings?since=${encodeURIComponent(items[1].createdAt)}`, { headers: auth })).json();
  assert.deepEqual(since.items.map((i) => i.ticket), [second]);
  assert.equal((await fetch(`${site.base}/api/billing/readings?since=вчера`, { headers: auth })).status, 400);

  // отметки: принято и отклонено с причиной; без причины отклонить нельзя; неизвестная заявка — 404
  const post = (ticket, body) => fetch(`${site.base}/api/billing/readings/${encodeURIComponent(ticket)}/status`, {
    method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  assert.equal((await post(first, { status: 'transferred', note: 'лицевой счёт 100200, октябрь 2026' })).status, 200);
  assert.equal((await post(second, { status: 'rejected' })).status, 400);
  assert.equal((await post(second, { status: 'done', note: 'x' })).status, 400);
  assert.equal((await post(second, { status: 'rejected', note: 'квартирные счётчики тепла в расчёте не участвуют' })).status, 200);
  assert.equal((await post('ПУ-000000-0000', { status: 'transferred' })).status, 404);

  const left = await (await fetch(`${site.base}/api/billing/readings`, { headers: auth })).json();
  assert.deepEqual(left.items, []);

  // панель видит отметки программы; телефон и прочее в заявке остались на месте
  const admin = await (await fetch(`${site.base}/api/admin/records/readings`, { headers: { Authorization: `Basic ${Buffer.from('admin:proverka').toString('base64')}` } })).json();
  const byTicket = Object.fromEntries(admin.items.map((r) => [r.ticket, r]));
  assert.equal(byTicket[first].billingStatus, 'transferred');
  assert.equal(byTicket[first].phone, '+7 900 000-00-00');
  assert.equal(byTicket[second].billingStatus, 'rejected');
  assert.equal(byTicket[second].billingNote, 'квартирные счётчики тепла в расчёте не участвуют');
});

test('новая заявка, пришедшая во время отметок, не теряется', async () => {
  const tickets = await Promise.all(Array.from({ length: 5 }, (_, i) => submitReading(site.base, { account: `3000${i}` })));
  const marks = tickets.map((t) => fetch(`${site.base}/api/billing/readings/${encodeURIComponent(t)}/status`, {
    method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'transferred' }),
  }));
  const extra = await Promise.all([submitReading(site.base, { account: '400001' }), submitReading(site.base, { account: '400002' })]);
  for (const res of await Promise.all(marks)) assert.equal(res.status, 200);
  const left = await (await fetch(`${site.base}/api/billing/readings`, { headers: auth })).json();
  assert.deepEqual(left.items.map((i) => i.ticket).sort(), [...extra].sort());
  const lines = fs.readFileSync(path.join(site.dataDir, 'readings.ndjson'), 'utf8').trim().split('\n');
  assert.equal(lines.length, 2 + 5 + 2);
});

test('номер заявки не повторяется: занятый номер заменяется другим', async () => {
  // половина номеров дня уже занята (все чётные): случайный номер попадает в занятый через раз, и без проверки повтор был бы почти сразу
  const d = new Date();
  const stamp = `${String(d.getDate()).padStart(2, '0')}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getFullYear()).slice(2)}`;
  const file = path.join(site.dataDir, 'readings.ndjson');
  const lines = [];
  for (let n = 1000; n < 9999; n += 2) lines.push(JSON.stringify({ ticket: `ПУ-${stamp}-${n}`, billingStatus: 'transferred', createdAt: d.toISOString() }));
  fs.appendFileSync(file, lines.join('\n') + '\n');
  const tickets = [];
  for (let i = 0; i < 8; i += 1) tickets.push(await submitReading(site.base, { account: `60000${i}` }));
  const all = fs.readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l).ticket);
  for (const t of tickets) assert.equal(all.filter((x) => x === t).length, 1, `номер ${t} повторился`);
  // программа получает новые заявки с теми же номерами, что увидел житель
  const left = await (await fetch(`${site.base}/api/billing/readings`, { headers: auth })).json();
  assert.deepEqual(left.items.map((x) => x.ticket).filter((t) => tickets.includes(t)).sort(), [...tickets].sort());
});
