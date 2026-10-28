'use strict';
/**
 * Проверка «я человек» для форм сайта (показания, обращения, договор).
 *
 * Сервер выдаёт простой пример на сложение и подписанный токен. Ответ в токене не лежит:
 * в нём только отпечаток HMAC(секрет, номер + ответ), поэтому подобрать ответ по токену нельзя.
 * Токен живёт 30 минут и принимается один раз — использованные номера помнятся до конца срока.
 *
 * Сторонних сервисов и зависимостей нет: только crypto из Node.
 */
const crypto = require('crypto');

const TTL_MS = 30 * 60 * 1000;

function b64(buf) { return Buffer.from(buf).toString('base64url'); }

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/**
 * @param {object} o
 * @param {string} o.secret     ключ подписи
 * @param {number} [o.ttlMs]    срок жизни токена
 * @param {number} [o.minMs]    раньше этого срока после выдачи примера форму заполнить нельзя (бот)
 * @param {() => number} [o.now] часы — подменяются в проверках
 */
function createFormCheck({ secret, ttlMs = TTL_MS, minMs = 3000, now = Date.now }) {
  if (!secret) throw new Error('form-check: нужен секрет');
  const used = new Map(); // номер токена -> когда истекает

  function sign(text) {
    return crypto.createHmac('sha256', secret).update(text).digest('base64url');
  }

  function prune() {
    const t = now();
    for (const [id, exp] of used) if (exp <= t) used.delete(id);
  }
  setInterval(prune, 5 * 60 * 1000).unref();

  /** Новый пример: { question: 'Сколько будет 4 + 3?', token } */
  function issue() {
    const a = crypto.randomInt(1, 10);
    const b = crypto.randomInt(1, 10);
    const id = b64(crypto.randomBytes(12));
    const t = now();
    const h = sign(`answer:${id}:${a + b}`);
    const payload = b64(JSON.stringify({ id, t, h }));
    return { question: `Сколько будет ${a} + ${b}?`, a, b, token: `${payload}.${sign(`token:${payload}`)}` };
  }

  /** Разобрать токен без ответа: подпись, срок. null — подделка или мусор. */
  function parse(token) {
    const [payload, sig, extra] = String(token || '').split('.');
    if (!payload || !sig || extra !== undefined) return null;
    if (!safeEqual(sig, sign(`token:${payload}`))) return null;
    try {
      const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      if (typeof data.id !== 'string' || !Number.isFinite(data.t) || typeof data.h !== 'string') return null;
      return data;
    } catch {
      return null;
    }
  }

  /**
   * Проверить ответ. Возвращает { ok: true } или { ok: false, reason }.
   * reason: 'missing' | 'invalid' | 'expired' | 'used' | 'too-fast' | 'wrong'.
   * Любая попытка с настоящим токеном его гасит — перебрать ответы по одному токену нельзя.
   */
  function verify(token, answer) {
    if (!token) return { ok: false, reason: 'missing' };
    const data = parse(token);
    if (!data) return { ok: false, reason: 'invalid' };
    const t = now();
    if (t - data.t > ttlMs || data.t > t + 60 * 1000) return { ok: false, reason: 'expired' };
    if (used.has(data.id)) return { ok: false, reason: 'used' };
    used.set(data.id, data.t + ttlMs);
    if (t - data.t < minMs) return { ok: false, reason: 'too-fast' };
    const value = String(answer ?? '').trim();
    if (!/^\d{1,3}$/.test(value)) return { ok: false, reason: 'wrong' };
    if (!safeEqual(data.h, sign(`answer:${data.id}:${Number(value)}`))) return { ok: false, reason: 'wrong' };
    return { ok: true };
  }

  return { issue, verify, parse };
}

module.exports = { createFormCheck, TTL_MS };
