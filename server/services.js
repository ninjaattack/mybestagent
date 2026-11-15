'use strict';
// Сервисы: уведомления (в платформе / push / e-mail), SMS, подбор совпадений, гео, уровни пользователей.
// E-mail уходит через SMTP (SMTP_URL), SMS — через SMS.ru (SMSRU_API_ID). Каждое сообщение пишется в журнал
// «Исходящие» (без одноразовых кодов) со статусом доставки. Без провайдера (только при локальной разработке)
// сообщение лишь записывается в журнал.
const fs = require('fs');
const path = require('path');
const webpush = require('web-push');
const nodemailer = require('nodemailer');
const { all, get, run, DATA_DIR } = require('./db');
const { toEn } = require('./i18n');
const MAIL = require('./mail');
const M = require('./match');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

/* ---------- VAPID для push ---------- */
const vapidFile = path.join(DATA_DIR, 'vapid.json');
let vapid;
if (process.env.VAPID_PUBLIC && process.env.VAPID_PRIVATE) {
  vapid = { publicKey: process.env.VAPID_PUBLIC, privateKey: process.env.VAPID_PRIVATE };
} else if (fs.existsSync(vapidFile)) {
  vapid = JSON.parse(fs.readFileSync(vapidFile, 'utf8'));
} else {
  vapid = webpush.generateVAPIDKeys();
  fs.writeFileSync(vapidFile, JSON.stringify(vapid));
}
webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:support@my-bestagent.ru', vapid.publicKey, vapid.privateKey);

/* ---------- SSE: события в реальном времени ---------- */
const streams = new Map(); // userId -> Set(res)
function addStream(userId, res) {
  if (!streams.has(userId)) streams.set(userId, new Set());
  const set = streams.get(userId);
  if (set.size >= 5) { const old = set.values().next().value; set.delete(old); try { old.end(); } catch (e) { /* закрыт */ } } // не больше 5 вкладок
  set.add(res);
  return () => { const s = streams.get(userId); if (s) { s.delete(res); if (!s.size) streams.delete(userId); } };
}
function emit(userId, event, data) {
  const s = streams.get(userId);
  if (!s) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of s) { try { res.write(payload); } catch (e) { /* соединение закрыто */ } }
}
// Выход из аккаунта или блокировка — закрываем все открытые потоки пользователя
function dropStreams(userId) { const s = streams.get(userId); if (!s) return; streams.delete(userId); for (const r of s) { try { r.end(); } catch (e) { /* закрыт */ } } }
setInterval(() => { for (const s of streams.values()) for (const r of s) { try { r.write(': ping\n\n'); } catch (e) {} } }, 25000).unref();

/* ---------- E-mail (SMTP) и SMS (SMS.ru) ---------- */
// SMTP_URL, например: smtps://noreply%40my-bestagent.ru:ПАРОЛЬ@mail.hosting.reg.ru:465 (почта домена на reg.ru; подойдёт любой SMTP)
const mailer = process.env.SMTP_URL ? nodemailer.createTransport(process.env.SMTP_URL, { pool: true, maxConnections: 3 }) : null;
const MAIL_FROM = process.env.MAIL_FROM || '«Мой лучший агент» <noreply@my-bestagent.ru>';
const SMSRU = process.env.SMSRU_API_ID || '';
const SMS_API = process.env.SMSRU_API_URL || 'https://sms.ru/sms/send';
const channels = { email: mailer ? 'SMTP' : '', sms: SMSRU ? 'SMS.ru' : '' };
// secret — одноразовый код: адресату уходит полностью, в журнал — замаскированным
const masked = (body, secret) => (secret ? body.split(secret).join('••••••') : body);
const logOut = (channel, to, subject, body, status) => run('INSERT INTO outbox (channel, target, subject, body, status) VALUES (?,?,?,?,?)', channel, to, subject, body, status).lastInsertRowid;
const setOut = (id, status, error = '') => run('UPDATE outbox SET status = ?, error = ? WHERE id = ?', status, String(error).slice(0, 300), id);
// Возвращает Promise: 'sent' — доставлено провайдеру, 'failed' — ошибка, 'logged' — провайдер не подключён.
// body — простой текст или готовое письмо { text, html } из server/mail.js (тогда уходит HTML + текстовая версия)
function sendEmail(to, subject, body, secret) {
  if (!to) return Promise.resolve('failed');
  const text = typeof body === 'string' ? body : body.text, html = typeof body === 'string' ? undefined : body.html;
  const logSubject = masked(subject, secret), logBody = masked(text, secret);
  if (!mailer) { logOut('email', to, logSubject, logBody, 'logged'); return Promise.resolve('logged'); }
  const id = logOut('email', to, logSubject, logBody, 'queued');
  return mailer.sendMail({ from: MAIL_FROM, to, subject, text, ...(html ? { html } : {}) })
    .then(() => { setOut(id, 'sent'); return 'sent'; }, (e) => { setOut(id, 'failed', e.message); console.error('E-mail не отправлен:', e.message); return 'failed'; });
}
function sendSms(to, body, secret) {
  if (!to) return Promise.resolve('failed');
  if (!SMSRU) { logOut('sms', to, '', masked(body, secret), 'logged'); return Promise.resolve('logged'); }
  const id = logOut('sms', to, '', masked(body, secret), 'queued');
  const form = new URLSearchParams({ api_id: SMSRU, to: String(to).replace(/\D/g, ''), msg: body, json: '1' });
  if (process.env.SMSRU_FROM) form.set('from', process.env.SMSRU_FROM);
  return fetch(SMS_API, { method: 'POST', body: form, signal: AbortSignal.timeout(15000) })
    .then((r) => r.json())
    .then((j) => {
      const one = j && j.sms ? Object.values(j.sms)[0] : null;
      if (j && j.status === 'OK' && one && one.status === 'OK') { setOut(id, 'sent'); return 'sent'; }
      throw new Error((one && one.status_text) || (j && j.status_text) || 'SMS.ru: ошибка отправки');
    })
    .catch((e) => { setOut(id, 'failed', e.message); console.error('SMS не отправлено:', e.message); return 'failed'; });
}

/* ---------- Push (без персональных данных) ---------- */
// Группы, которые пользователь включает и выключает в настройках (для всех своих устройств).
const PUSH_KEYS = ['match', 'chat', 'support', 'emergency', 'moderation', 'account'];
const PUSH_GROUP = { match: 'match', registry: 'match', ward: 'emergency', chat: 'chat', support: 'support', emergency: 'emergency',
  moderation: 'moderation', status: 'moderation', role: 'moderation', payment: 'account', points: 'account', family: 'account' };
function pushPrefs(u) {
  let p = {}; try { p = JSON.parse((u && u.push_prefs) || '{}') || {}; } catch (e) { p = {}; }
  return Object.fromEntries(PUSH_KEYS.map((k) => [k, p[k] !== false]));
}
// Склейка: новое уведомление по тому же чату/заявке/обращению заменяет предыдущее, а не копится стопкой
function pushTag(type, link) {
  const m = String(link || '').match(/#\/(chat|a|support)\/(\d+)/);
  return m ? `${m[1]}-${m[2]}` : type || 'mba';
}
// В тестах адреса https://push.test/… не уходят в интернет: …/gone… отвечает 410 (устройство отписалось), остальные — «доставлено»
const TEST_PUSH = process.env.NODE_ENV === 'test';
// Адрес подписки — только у известных push-сервисов браузеров (https, без порта). Иначе сервер сам отправлял бы
// запросы куда угодно, в том числе на localhost и во внутреннюю сеть (SSRF).
const PUSH_HOSTS = ['fcm.googleapis.com', 'android.googleapis.com', 'updates.push.services.mozilla.com', 'push.services.mozilla.com',
  'push.apple.com', 'notify.windows.com'].concat(TEST_PUSH ? ['push.test'] : []);
function pushHostOk(endpoint) {
  let u; try { u = new URL(String(endpoint)); } catch (e) { return false; }
  if (u.protocol !== 'https:' || u.port !== '' || u.username || u.password) return false;
  return PUSH_HOSTS.some((s) => u.hostname === s || u.hostname.endsWith('.' + s));
}
const pushSend = (sub, body, opts) => {
  if (TEST_PUSH && sub.endpoint.startsWith('https://push.test/')) return sub.endpoint.includes('/gone') ? Promise.reject(Object.assign(new Error('gone'), { statusCode: 410 })) : Promise.resolve({ statusCode: 201 });
  if (!pushHostOk(sub.endpoint)) return Promise.reject(Object.assign(new Error('push host not allowed'), { statusCode: 410 }));
  return webpush.sendNotification(sub, body, opts);
};
// Возвращает { sent, failed, removed }. payload: title, body, url, type, tag
async function sendPush(userId, payload) {
  const subs = all('SELECT * FROM push_subs WHERE user_id = ?', userId);
  const out = { sent: 0, failed: 0, removed: 0 };
  if (!subs.length) return out;
  const type = payload.type || 'info';
  const full = {
    title: payload.title || 'Мой лучший агент', body: payload.body || '', url: payload.url || '/', type,
    tag: payload.tag || pushTag(type, payload.url), icon: '/assets/icon-192.png', badge: '/assets/badge-96.png',
    n: get('SELECT COUNT(*) c FROM notifications WHERE user_id = ? AND read = 0', userId).c, ts: Date.now()
  };
  const urgent = type === 'emergency' || type === 'chat';
  // заголовок Topic не ставим: FCM с ним откладывает доставку обычных уведомлений; склейку делает tag на устройстве
  const opts = { TTL: type === 'emergency' ? 6 * 3600 : 24 * 3600, urgency: urgent ? 'high' : 'normal' };
  await Promise.all(subs.map(async (s) => {
    try {
      await pushSend(JSON.parse(s.data), JSON.stringify(full), opts);
      run("UPDATE push_subs SET last_at = datetime('now'), last_title = ? WHERE id = ?", String(full.title).slice(0, 120), s.id);
      out.sent++;
    } catch (e) {
      // 404/410 — устройство отписалось, адрес больше не нужен. Но только что выданный адрес push-сервис (FCM) иногда
      // ещё не знает несколько секунд — такой не удаляем, а считаем неудачной попыткой
      const fresh = !TEST_PUSH && s.created_at && Date.now() - Date.parse(s.created_at.replace(' ', 'T') + 'Z') < 120e3 && pushHostOk(s.endpoint);
      if ((e.statusCode === 404 || e.statusCode === 410) && !fresh) { run('DELETE FROM push_subs WHERE id = ?', s.id); out.removed++; }
      else { out.failed++; if (!TEST_PUSH) console.error('Push не доставлен:', e.statusCode || '', String(e.body || e.message || e).slice(0, 160)); }
    }
  }));
  return out;
}

/**
 * Уведомление пользователю по всем включённым каналам.
 * title/body в платформе могут быть подробными; в push уходит только обезличенный текст (pushTitle/pushBody).
 */
function notify(userId, { type, title, body = '', link = '', pushTitle, pushBody, email = true }) {
  const user = get('SELECT id, email, lang, notify_push, notify_email, push_prefs, blocked FROM users WHERE id = ?', userId);
  if (!user || user.blocked) return;
  const id = run('INSERT INTO notifications (user_id, type, title, body, link) VALUES (?,?,?,?,?)', userId, type, title, body, link).lastInsertRowid;
  const en = user.lang === 'en', L = en ? toEn : (x) => x; // в БД — русский текст, получателю — на его языке
  emit(userId, 'notification', { id, type, title: L(title), body: L(body), link });
  if (user.notify_push && pushPrefs(user)[PUSH_GROUP[type] || 'account']) {
    sendPush(userId, { type, title: L(pushTitle || 'Мой лучший агент'), body: L(pushBody || 'Новое уведомление'), url: '/' + (link || '') }).catch(() => {});
  }
  if (email && user.notify_email && user.email) { const m = MAIL.notifyMail(en ? 'en' : 'ru', { type, title: L(title), body: L(body), link }); sendEmail(user.email, m.subject, m); }
}

/* ---------- Гео ---------- */
const { distKm } = M;

/* ---------- Подбор совпадений «потерял» ↔ «нашёл» (правила — server/match.js) ---------- */
const { matchInfo, matchScore } = M;
// «Расширенный поиск»: подписчик видит и «возможные» совпадения (35–49 %), в том числе дальше обычного радиуса.
// Для заявок о людях «возможные» видны всем бесплатно — поиск человека не продаём.
const hasPlus = (uid) => !!get("SELECT 1 FROM subscriptions s JOIN tariffs t ON t.id = s.tariff_id WHERE s.user_id = ? AND t.feature = 'search_plus' AND s.until > datetime('now')", uid);
const seesWeak = (app) => app.category === 'people' || hasPlus(app.user_id);
// Короткое объяснение для уведомления: самая сильная причина совпадения
function topReason(reasons) {
  const r = reasons.find((x) => ['id', 'secret', 'same_photo', 'breed', 'clothes', 'brand', 'color'].includes(x.k));
  if (!r) return '';
  const ID = { chip: 'Совпал номер чипа.', tattoo: 'Совпало клеймо.', serial: 'Совпал серийный номер.', doc_name: 'Совпали ФИО в документе.', plate: 'Совпал госномер.' };
  return { id: ID[r.v] || 'Совпал номер.', secret: 'Совпала скрытая примета.', same_photo: 'Совпадает фото.', breed: 'Совпала порода.', clothes: 'Совпала одежда.', brand: 'Совпал бренд.', color: 'Совпал цвет.' }[r.k];
}
function notifyMatch(mine, theirs, score, reasons) {
  // чужая скрытая примета не раскрывается и в уведомлении: ни причиной, ни баллами
  if (theirs.secret && reasons.some((r) => r.k === 'secret')) {
    const r = matchInfo(mine, Object.assign({}, theirs, { secret: '' }));
    if (r.score < M.WEAK) return;
    score = r.score; reasons = r.reasons;
  }
  const why = topReason(reasons);
  notify(mine.user_id, {
    type: 'match',
    title: `Возможное совпадение ${score}%`,
    body: `По вашей заявке «${mine.title}» найдена похожая: «${theirs.title}».` + (why ? ' ' + why : ''),
    link: `#/a/${theirs.id}`,
    pushTitle: 'Возможное совпадение', pushBody: 'По вашей заявке найдено похожее объявление'
  });
}
// Сверяет заявку со всеми опубликованными заявками другой стороны той же категории.
// Новые пары записываются и уведомляются; у существующих обновляются оценка и причины (без повторных уведомлений).
// notified: 0 — не уведомляли, 1 — уведомили как «возможное», 2 — как совпадение.
// Кандидаты — сразу в SQL сужаются тем, что matchInfo всё равно отбросит: страна и дата (находка не раньше
// пропажи больше чем на сутки). Нестандартные даты (не ГГГГ-ММ-ДД) отдаются на проверку в JS, как раньше.
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
function candidates(app) {
  const other = app.kind === 'lost' ? 'found' : 'lost';
  const where = ["status = 'published'", 'kind = ?', 'category = ?', 'user_id != ?'], p = [other, app.category, app.user_id];
  const ctry = app.country && app.country !== 'RU' ? app.country : '';
  if (ctry) { where.push('country = ?'); p.push(ctry); } else where.push("(country IS NULL OR country IN ('', 'RU'))");
  if (ISO_DAY.test(app.event_date || '')) {
    where.push(`(event_date IS NULL OR event_date NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' OR event_date ${app.kind === 'lost' ? ">= date(?, '-1 day')" : "<= date(?, '+1 day')"})`);
    p.push(app.event_date);
  }
  return all(`SELECT * FROM applications WHERE ${where.join(' AND ')}`, ...p);
}
// Существующие пары этой заявки — одним запросом в Map (раньше — отдельный запрос на каждого кандидата)
function pairsOf(app) {
  const col = app.kind === 'lost' ? 'lost_id' : 'found_id', oth = app.kind === 'lost' ? 'found_id' : 'lost_id';
  return new Map(all(`SELECT * FROM matches WHERE ${col} = ?`, app.id).map((m) => [m[oth], m]));
}
function matchOne(app, c, pairs, created) {
  if (app.family_id && c.family_id === app.family_id) return; // заявки одной семьи между собой не сравниваем
  const { score, reasons } = matchInfo(app, c);
  const lost = app.kind === 'lost' ? app : c, found = app.kind === 'lost' ? c : app;
  const ex = pairs.get(c.id);
  if (score < M.WEAK) {
    if (ex && ex.lost_vote !== 'yes' && ex.found_vote !== 'yes') run('DELETE FROM matches WHERE id = ?', ex.id);
    return;
  }
  const level = score >= M.STRONG ? 2 : 1;
  let id, was = 0;
  if (ex) { id = ex.id; was = ex.notified; run("UPDATE matches SET score = ?, reasons = ?, updated_at = datetime('now') WHERE id = ?", score, JSON.stringify(reasons), id); } else {
    // пару мог только что записать параллельный подбор с другой стороны — тогда обновляем её
    run(`INSERT INTO matches (lost_id, found_id, score, reasons) VALUES (?,?,?,?)
      ON CONFLICT(lost_id, found_id) DO UPDATE SET score = excluded.score, reasons = excluded.reasons, updated_at = datetime('now')`, lost.id, found.id, score, JSON.stringify(reasons));
    id = get('SELECT id FROM matches WHERE lost_id = ? AND found_id = ?', lost.id, found.id).id;
  }
  if (ex && (ex.lost_vote === 'no' || ex.found_vote === 'no')) return; // пару уже отклонили — не беспокоим
  if (level > was) {
    run('UPDATE matches SET notified = ? WHERE id = ?', level, id);
    if (level === 2) created.push({ lost, found, score });
    for (const [mine, theirs] of [[lost, found], [found, lost]]) if (level === 2 || seesWeak(mine)) notifyMatch(mine, theirs, score, reasons);
  }
}
function runMatching(app) {
  if (!app || app.status !== 'published') return [];
  const pairs = pairsOf(app), created = [];
  for (const c of candidates(app)) matchOne(app, c, pairs, created);
  if (app.category === 'things') registryCheck(app);
  return created;
}
// То же, но порциями: между порциями сервер успевает отвечать другим пользователям (создание заявки, пересчёт)
const tick = () => new Promise((r) => setImmediate(r));
async function runMatchingAsync(app) {
  if (!app || app.status !== 'published') return [];
  const cands = candidates(app), pairs = pairsOf(app), created = [];
  for (let i = 0; i < cands.length; i++) {
    if (i && i % 200 === 0) await tick();
    matchOne(app, cands[i], pairs, created);
  }
  if (app.category === 'things') registryCheck(app);
  return created;
}
// Найденная вещь с номером или гравировкой сверяется с реестром ценностей: владельцу украденного/потерянного
// предмета приходит уведомление со ссылкой на заявку (один раз на пару)
function registryCheck(app) {
  if (app.kind !== 'found') return;
  let d = {}, ids = {}; try { d = JSON.parse(app.details || '{}'); ids = JSON.parse(app.ids || '{}'); } catch (e) { return; }
  const keys = [ids.serial, d.plate, d.engraving].filter(Boolean).map(M.normId).filter((x) => x.length >= 4);
  if (!keys.length) return;
  for (const v of all("SELECT * FROM valuables WHERE status IN ('stolen','lost') AND user_id != ?", app.user_id)) {
    const serials = String(v.serials || '').split(/[,;\n]/).map(M.normId).filter((x) => x.length >= 4);
    const marks = M.normId(v.marks || '');
    const hit = keys.some((k) => serials.some((s) => s === k || (k.length >= 6 && s.endsWith(k)) || (s.length >= 6 && k.endsWith(s))) || (k.length >= 5 && marks.includes(k)));
    if (!hit || get('SELECT 1 FROM registry_hits WHERE valuable_id = ? AND application_id = ?', v.id, app.id)) continue;
    run('INSERT INTO registry_hits (valuable_id, application_id) VALUES (?,?)', v.id, app.id);
    notify(v.user_id, { type: 'registry', title: 'Ваш предмет из реестра, возможно, нашли', body: `«${v.title}» похож на находку «${app.title}».`, link: `#/a/${app.id}`, pushTitle: 'Предмет из реестра нашли', pushBody: 'Откройте платформу, чтобы узнать подробности' });
  }
}
// Раз в 6 часов: допустимое расстояние растёт со временем, поэтому старые пропажи сверяются заново
// Идёт порциями (runMatchingAsync), не занимая сервер целиком; повторный запуск, пока идёт прошлый, пропускается
let rematching = false;
async function rematchAll() {
  if (rematching) return;
  rematching = true;
  try {
    for (const { id } of all("SELECT id FROM applications WHERE status = 'published' AND kind = 'lost' AND created_at > datetime('now','-120 days')")) {
      const a = get('SELECT * FROM applications WHERE id = ?', id); // заявку могли изменить или закрыть за время пересчёта
      try { await runMatchingAsync(a); } catch (e) { console.error('Подбор совпадений:', e.message); }
      await tick();
    }
  } finally { rematching = false; }
}

/* ---------- Экстренное оповещение по зонам ---------- */
function broadcastEmergency(app) {
  const users = all("SELECT id, zone_lat, zone_lng, zone_radius FROM users WHERE zone_enabled = 1 AND blocked = 0 AND zone_lat IS NOT NULL AND id != ?", app.user_id);
  let n = 0;
  for (const u of users) {
    const d = distKm(u.zone_lat, u.zone_lng, app.lat, app.lng);
    // Получатель — тот, чья зона оповещений пересекается с кругом экстренного поиска.
    if (d != null && d <= (app.emergency_radius || 3) + (u.zone_radius || 0)) {
      notify(u.id, {
        type: 'emergency',
        title: app.category === 'people' ? 'Экстренный поиск человека рядом' : 'Экстренный поиск животного рядом',
        body: `${app.title}. ${app.address || ''}`.trim(),
        link: `#/a/${app.id}`,
        pushTitle: 'Экстренный поиск рядом с вами',
        pushBody: 'Нужна помощь в вашем районе. Откройте платформу, чтобы узнать подробности.',
        email: false
      });
      n++;
    }
  }
  return n;
}

/* ---------- Уровни и скидки ---------- */
const LEVELS = [
  { min: 0, code: 'novice', ru: 'Новичок', en: 'Newcomer', discount: 0 },
  { min: 50, code: 'helper', ru: 'Помощник', en: 'Helper', discount: 5 },
  { min: 150, code: 'agent', ru: 'Агент', en: 'Agent', discount: 10 },
  { min: 400, code: 'best', ru: 'Лучший агент', en: 'Best Agent', discount: 15 }
];
function levelOf(points) { let l = LEVELS[0]; for (const x of LEVELS) if (points >= x.min) l = x; return l; }
function addPoints(userId, delta, reason) {
  run('UPDATE users SET points = MAX(0, points + ?) WHERE id = ?', delta, userId);
  run('INSERT INTO points_log (user_id, delta, reason) VALUES (?,?,?)', userId, delta, reason);
  if (delta > 0) notify(userId, { type: 'points', title: `+${delta} баллов`, body: reason, link: '#/me/rewards', pushTitle: 'Начислены баллы', pushBody: 'Спасибо за помощь!', email: false });
}

module.exports = {
  vapidPublic: vapid.publicKey, addStream, dropStreams, emit, notify, sendEmail, sendSms, sendPush, pushPrefs, pushHostOk, PUSH_KEYS, channels, MAIL,
  distKm, matchScore, matchInfo, runMatching, runMatchingAsync, rematchAll, hasPlus, broadcastEmergency, LEVELS, levelOf, addPoints, BASE_URL
};
