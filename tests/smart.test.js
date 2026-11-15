'use strict';
// Умный подбор совпадений без ИИ, «Мои близкие» с QR-кодом, заявки за границей, проверка скрытой приметы в чате, листовка.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const net = require('node:net');
const path = require('node:path');
const M = require('../server/match');

const ROOT = path.join(__dirname, '..');
const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.unref(); s.on('error', rej); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); }); });

/* ---------------- чистые правила подбора ---------------- */
const today = new Date().toISOString().slice(0, 10);
const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
const app = (o) => Object.assign({ kind: 'lost', category: 'animals', lat: 56.8407, lng: 60.6151, event_date: today, title: '', features: '', description: '', details: '{}', ids: '{}', country: '' }, o);

describe('Подбор совпадений: правила', () => {
  it('одинаковый номер чипа — точное совпадение, разный — пары нет', () => {
    const l = app({ species: 'Собака', ids: JSON.stringify({ chip: '643 094 100 123 456' }) });
    const f = app({ kind: 'found', species: 'Собака', ids: JSON.stringify({ chip: '643094100123456' }), lat: 56.9, lng: 60.7 });
    const r = M.matchInfo(l, f);
    assert.equal(r.score, 100, JSON.stringify(r));
    assert.ok(r.reasons.some((x) => x.k === 'id'), 'причина — номер');
    assert.equal(M.matchInfo(l, Object.assign({}, f, { ids: JSON.stringify({ chip: '643094100999999' }) })).score, 0);
  });
  it('IMEI: хватает последних 6+ цифр; ФИО в документе — с опечаткой', () => {
    assert.equal(M.cmpId('serial', '35-209900-176148-1', '761481'), 'same');
    assert.equal(M.cmpId('serial', '352099001761481', '352099001761499'), 'diff');
    assert.equal(M.cmpId('doc_name', 'Иванов Иван Петрович', 'Иванов Иван'), 'same');
    assert.equal(M.cmpId('doc_name', 'Иванова Мария', 'Иваново Мария'), 'same', 'одна опечатка');
    assert.equal(M.cmpId('doc_name', 'Иванов Иван', 'Петров Пётр'), 'diff');
  });
  it('синонимы, падежи и близкие цвета находят пару; другой вид животного — нет', () => {
    const l = app({ species: 'Собака', title: 'Пропал пёс', features: 'рыжий, в красном ошейнике', details: JSON.stringify({ breed: 'Такса', color: 'рыжий' }) });
    const f = app({ kind: 'found', species: 'Собака', title: 'Найдена собачка', features: 'рыжая такса с красным ошейником', details: JSON.stringify({ breed: 'такса', color: 'рыжая' }), lat: 56.845, lng: 60.62 });
    const r = M.matchInfo(l, f);
    assert.ok(r.score >= M.STRONG, JSON.stringify(r));
    const ks = r.reasons.map((x) => x.k);
    assert.ok(ks.includes('breed') && ks.includes('color'), ks.join(','));
    assert.equal(M.matchInfo(l, Object.assign({}, f, { species: 'Кошка' })).score, 0);
  });
  it('находка раньше пропажи и разная страна — пары нет', () => {
    const l = app({ species: 'Кошка', details: JSON.stringify({ color: 'чёрный' }), event_date: today });
    const f = app({ kind: 'found', species: 'Кошка', details: JSON.stringify({ color: 'чёрный' }), event_date: daysAgo(3) });
    assert.equal(M.matchInfo(l, f).score, 0);
    assert.equal(M.matchInfo(Object.assign({}, l, { country: 'TR' }), Object.assign({}, f, { event_date: today })).score, 0);
  });
  it('радиус поиска растёт с каждым днём; пожилой человек уходит не так далеко, как транспорт', () => {
    const l = app({ category: 'people', person_age: 40 });
    const f = app({ kind: 'found', category: 'people' });
    assert.ok(M.allowedKm(l, f, 5, {}, {}) > M.allowedKm(l, f, 0, {}, {}));
    const old = app({ category: 'people', person_age: 80 });
    assert.ok(M.allowedKm(old, f, 1, {}, {}) < M.allowedKm(l, f, 1, {}, {}));
    assert.ok(M.allowedKm(l, f, 0, { transport: 'train' }, {}) >= 1000);
  });
  it('слишком далеко — совпадение не сильное', () => {
    const l = app({ species: 'Собака', details: JSON.stringify({ breed: 'Такса', color: 'рыжий' }) });
    const f = app({ kind: 'found', species: 'Собака', details: JSON.stringify({ breed: 'Такса', color: 'рыжий' }), lat: 55.75, lng: 37.62 }); // Москва
    assert.ok(M.matchInfo(l, f).score < M.STRONG);
  });
});

/* ---------------- API ---------------- */
let srv = null, dataDir = '';
before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mba-smart-'));
  const port = await freePort();
  const env = Object.assign({}, process.env, { PORT: String(port), HOST: '127.0.0.1', DATA_DIR: dataDir, NODE_ENV: 'test', GEOCODER: 'off' });
  const proc = spawn(process.execPath, ['--no-warnings', 'server/index.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; proc.stdout.on('data', (d) => { log += d; }); proc.stderr.on('data', (d) => { log += d; });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 240; i++) {
    try { if ((await fetch(base + '/api/config')).ok) { srv = { proc, base }; return; } } catch (e) { /* стартует */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  proc.kill(); throw new Error('server did not start\n' + log);
});
after(() => {
  if (srv) srv.proc.kill();
  try { fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch (e) { /* файлы ещё заняты */ }
});

function browser() {
  const cookies = new Map();
  const req = async (method, url, body) => {
    const headers = { 'X-Requested-With': 'mba' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (cookies.size) headers.Cookie = [...cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    const r = await fetch(srv.base + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
    for (const c of r.headers.getSetCookie()) { const [pair] = c.split(';'); const i = pair.indexOf('='); cookies.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim()); }
    const ct = r.headers.get('content-type') || '';
    return { status: r.status, headers: r.headers, body: ct.includes('json') ? await r.json() : await r.text() };
  };
  return {
    get: (u) => req('GET', u), post: (u, b = {}) => req('POST', u, b), patch: (u, b = {}) => req('PATCH', u, b), del: (u) => req('DELETE', u),
    async login(target) {
      const r = await req('POST', '/api/auth/request', { target });
      const extra = r.body.isNew ? { name: 'Тест', birthdate: '1990-01-01', consent_pd: true, consent_policy: true } : {};
      const v = await req('POST', '/api/auth/verify', { target, code: r.body.devCode, ...extra });
      assert.equal(v.status, 200, JSON.stringify(v.body));
    }
  };
}
// Пермь — далеко от демо-заявок
const PERM = { lat: 58.0105, lng: 56.2502 };
const base = (o) => Object.assign({ kind: 'lost', category: 'things', event_date: today, contact: '+79990001122', address: 'ул. Ленина, 1', city: 'Пермь', photos: [] }, PERM, o);

describe('Совпадения: номера, голоса, видимость', () => {
  let owner, finder;
  before(async () => { owner = browser(); finder = browser(); await owner.login('sm-owner@example.com'); await finder.login('sm-finder@example.com'); });

  it('IMEI скрыт от посторонних, но находит точное совпадение; «Не то» скрывает пару', async () => {
    const l = await owner.post('/api/applications', base({ title: 'Потерян телефон', details: { thing_type: 'electronics', brand: 'Samsung', color: 'чёрный' }, ids: { serial: '352099001761481' }, secret: 'Трещина в левом верхнем углу, заставка с котом' }));
    assert.equal(l.status, 200, JSON.stringify(l.body));
    assert.deepEqual(l.body.item.ids, { serial: '352099001761481' }, 'автор видит свой номер');
    const pub = await finder.get('/api/applications/' + l.body.item.id);
    assert.equal(pub.body.item.ids, undefined, 'посторонний не видит номер');
    assert.equal(pub.body.item.secret, undefined, 'посторонний не видит скрытую примету');
    assert.deepEqual(pub.body.item.has_ids, ['serial']);
    const f = await finder.post('/api/applications', base({ kind: 'found', title: 'Найден смартфон', details: { thing_type: 'electronics', color: 'серый' }, ids: { serial: '1761481' } }));
    assert.ok(f.body.matches >= 1, JSON.stringify(f.body).slice(0, 300));
    const mine = (await owner.get('/api/applications/' + l.body.item.id)).body.item;
    const m = mine.matches.find((x) => x.id === f.body.item.id);
    assert.ok(m, 'совпадение видно владельцу');
    assert.equal(m.score, 100);
    assert.ok(m.reasons.some((x) => x.k === 'id'));
    // голос «это оно» уходит второй стороне
    assert.equal((await owner.post(`/api/matches/${m.match_id}/vote`, { vote: 'yes' })).status, 200);
    const theirs = (await finder.get('/api/applications/' + f.body.item.id)).body.item.matches.find((x) => x.id === l.body.item.id);
    assert.equal(theirs.their_vote, 'yes');
    const notes = (await finder.get('/api/notifications')).body.items;
    assert.ok(notes.some((n) => /узнал/.test(n.title)), 'нашедшему пришло уведомление');
    // посторонний голосовать не может
    const stranger = browser(); await stranger.login('sm-stranger@example.com');
    assert.equal((await stranger.post(`/api/matches/${m.match_id}/vote`, { vote: 'no' })).status, 404);
    // «Не то» — пара скрыта у обеих сторон
    assert.equal((await finder.post(`/api/matches/${m.match_id}/vote`, { vote: 'no' })).status, 200);
    assert.equal((await finder.get('/api/applications/' + f.body.item.id)).body.item.matches.length, 0);
    assert.equal((await owner.post(`/api/matches/${m.match_id}/vote`, { vote: 'maybe' })).status, 400);
  });

  it('разные номера — пары нет, даже если всё остальное похоже', async () => {
    const l = await owner.post('/api/applications', base({ title: 'Потерян iPhone 13 синий', details: { thing_type: 'electronics', brand: 'Apple', model: 'iPhone 13', color: 'синий' }, ids: { serial: '356938035643809' } }));
    const f = await finder.post('/api/applications', base({ kind: 'found', title: 'Найден iPhone 13 синий', details: { thing_type: 'electronics', brand: 'Apple', model: 'iPhone 13', color: 'синий' }, ids: { serial: '356938035640000' } }));
    const mine = (await owner.get('/api/applications/' + l.body.item.id)).body.item;
    assert.ok(!mine.matches.some((x) => x.id === f.body.item.id), 'разные IMEI — не совпадение');
  });

  it('проверка скрытой приметы в чате: три попытки, сама примета не раскрывается', async () => {
    const l = await owner.post('/api/applications', base({ title: 'Потеряно кольцо', details: { thing_type: 'jewelry', metal: 'золото' }, secret: 'гравировка Навсегда внутри' }));
    const chat = await finder.post(`/api/applications/${l.body.item.id}/chat`);
    assert.equal(chat.status, 200, JSON.stringify(chat.body));
    const c = (await finder.get('/api/chats/' + chat.body.id)).body;
    assert.deepEqual(c.chat.verify, { ok: false, tries: 0, left: 3 });
    assert.ok(!JSON.stringify(c).includes('Навсегда'), 'текст приметы не уходит собеседнику');
    const bad = await finder.post(`/api/chats/${chat.body.id}/verify`, { answer: 'синий камень' });
    assert.equal(bad.body.ok, false); assert.equal(bad.body.verify.left, 2);
    const ok = await finder.post(`/api/chats/${chat.body.id}/verify`, { answer: 'внутри гравировка «навсегда»' });
    assert.equal(ok.body.ok, true, JSON.stringify(ok.body));
    assert.equal(ok.body.message.meta, 'verify_ok');
    assert.equal((await finder.post(`/api/chats/${chat.body.id}/verify`, { answer: 'ещё раз' })).status, 400, 'после успеха проверка закрыта');
    assert.equal((await owner.post(`/api/chats/${chat.body.id}/verify`, { answer: 'гравировка' })).status, 403, 'автор сам себя не проверяет');
    const msgs = (await owner.get('/api/chats/' + chat.body.id)).body.messages;
    assert.deepEqual(msgs.map((m) => m.meta), ['verify_fail', 'verify_ok']);
  });

  it('листовка: QR-код опубликованной заявки — SVG', async () => {
    const l = await owner.post('/api/applications', base({ title: 'Потеряны ключи', details: { thing_type: 'keys', keyring: 'брелок-сова' } }));
    const r = await browser().get(`/api/applications/${l.body.item.id}/qr.svg`);
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /svg/);
    assert.match(r.body, /<svg[\s\S]*<path/);
    assert.equal((await browser().get('/api/applications/999999/qr.svg')).status, 404);
  });
});

describe('Заявка за границей', () => {
  let owner;
  before(async () => { owner = browser(); await owner.login('sm-abroad@example.com'); });
  it('страна сохраняется, RU и мусор отбрасываются; справочник стран в /api/config', async () => {
    const cfg = (await browser().get('/api/config')).body;
    assert.ok(cfg.countries.some((c) => c.code === 'TR' && c.n.length), 'Турция с экстренными номерами');
    assert.ok(cfg.mfa.phone, 'горячая линия МИД');
    const ANT = { lat: 36.8969, lng: 30.7133 };
    const r = await owner.post('/api/applications', base(Object.assign({ title: 'Потерян паспорт', country: 'tr', details: { thing_type: 'documents', doc_kind: 'Загранпаспорт' }, ids: { doc_name: 'Сидоров Алексей' } }, ANT)));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.item.country, 'TR');
    const ru = await owner.post('/api/applications', base({ title: 'Потерян зонт', country: 'RU', details: { thing_type: 'other' } }));
    assert.equal(ru.body.item.country, '');
    const odd = await owner.post('/api/applications', base({ title: 'Потеряна сумка', country: 'XK', details: { thing_type: 'accessories', country_name: 'Косово' } }));
    assert.equal(odd.body.item.country, 'XK', 'страна вне справочника принимается по коду');
    assert.equal(odd.body.item.details.country_name, 'Косово');
    const junk = await owner.post('/api/applications', base({ title: 'Потеряна шапка', country: '<b>', details: { thing_type: 'clothes', country_name: 'X' } }));
    assert.equal(junk.body.item.country, '');
    assert.equal(junk.body.item.details.country_name, undefined);
  });
});

describe('Мои близкие и QR-код', () => {
  let owner, other;
  before(async () => { owner = browser(); other = browser(); await owner.login('sm-ward@example.com'); await other.login('sm-ward-other@example.com'); });

  it('карточка человека требует согласия и кем приходитесь; видна только владельцу', async () => {
    const body = { kind: 'person', name: 'Мария Ивановна', relation: 'relative', birth_year: 1941, sex: 'female', contact: '+79990002233', details: { health: ['dementia'], height: 160 }, qr_on: true, qr_phone: true, qr_note: 'Я могу не помнить адрес' };
    assert.equal((await owner.post('/api/wards', body)).status, 400, 'без согласия нельзя');
    assert.equal((await owner.post('/api/wards', Object.assign({}, body, { relation: '', consent: true }))).status, 400, 'без отношения нельзя');
    const r = await owner.post('/api/wards', Object.assign({}, body, { consent: true }));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const w = r.body.item;
    assert.match(w.qr_url, /\/w\/[\w-]{12,}$/);
    assert.equal((await other.get('/api/wards/' + w.id)).status, 404, 'чужую карточку не видно');
    assert.equal((await owner.get('/api/wards')).body.items.length, 1);
  });

  it('публичная страница QR показывает только разрешённое и принимает сообщение нашедшего', async () => {
    const w = (await owner.get('/api/wards')).body.items[0];
    const token = w.qr_url.split('/w/')[1];
    const anon = browser();
    const pub = await anon.get('/api/w/' + token);
    assert.equal(pub.status, 200);
    assert.equal(pub.body.name, 'Мария Ивановна');
    assert.equal(pub.body.phone, '+79990002233', 'контакт показан, потому что владелец разрешил');
    assert.equal(pub.body.photo, '', 'фото не разрешено');
    assert.ok(!JSON.stringify(pub.body).includes('dementia') && pub.body.birth_year === undefined, 'диагноз и возраст не раскрываются');
    assert.equal((await anon.post(`/api/w/${token}/alert`, {})).status, 400);
    assert.equal((await anon.post(`/api/w/${token}/alert`, { message: 'Сидим на остановке у рынка', contact: '+79995556677', lat: 58.01, lng: 56.25 })).status, 200);
    const full = (await owner.get('/api/wards/' + w.id)).body.item;
    assert.equal(full.alerts.length, 1);
    assert.equal(full.alerts[0].contact, '+79995556677');
    const notes = (await owner.get('/api/notifications')).body.items;
    assert.ok(notes.some((n) => n.type === 'ward'), 'владельцу пришло уведомление');
    const rd = await anon.get('/w/' + token);
    assert.equal(rd.status, 302);
    assert.equal(rd.headers.get('location'), '/#/w/' + token);
  });

  it('новый QR-код отключает старый; SVG доступен только владельцу', async () => {
    const w = (await owner.get('/api/wards')).body.items[0];
    const old = w.qr_url.split('/w/')[1];
    assert.equal((await other.get(`/api/wards/${w.id}/qr.svg`)).status, 404);
    const svg = await owner.get(`/api/wards/${w.id}/qr.svg`);
    assert.equal(svg.status, 200); assert.match(svg.body, /<svg/);
    assert.equal((await owner.post(`/api/wards/${w.id}/qr/reset`)).status, 200);
    assert.equal((await browser().get('/api/w/' + old)).status, 404);
  });

  it('заявка из карточки связывается с ней; на странице QR видно, что человека ищут', async () => {
    const w = (await owner.get('/api/wards')).body.items[0];
    const a = await owner.post('/api/applications', base({ category: 'people', title: 'Пропала Мария Ивановна', person_name: 'Мария Ивановна', person_age: 85, relation: 'relative', confirm_rights: true, ward_id: w.id, details: { sex: 'female', template: 'elderly' } }));
    assert.equal(a.status, 200, JSON.stringify(a.body));
    assert.equal(a.body.item.ward_id, w.id);
    const card = (await owner.get('/api/wards/' + w.id)).body.item;
    assert.equal(card.active_app && card.active_app.id, a.body.item.id);
    // чужую карточку к заявке не привязать
    const b = await other.post('/api/applications', base({ category: 'people', title: 'Пропала Мария Ивановна', person_name: 'Мария Ивановна', person_age: 85, relation: 'relative', confirm_rights: true, ward_id: w.id, details: { sex: 'female' } }));
    assert.ok(b.status !== 200 || !b.body.item.ward_id, 'чужая карточка не привязывается');
  });

  it('карточка питомца: номер чипа хранится, удаление убирает QR', async () => {
    const r = await owner.post('/api/wards', { kind: 'pet', name: 'Буся', species: 'Кошка', contact: '+79990002233', ids: { chip: '643094100123456' }, details: { color: 'трёхцветная' }, qr_on: true });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.item.ids.chip, '643094100123456');
    const token = r.body.item.qr_url.split('/w/')[1];
    const pub = (await browser().get('/api/w/' + token)).body;
    assert.equal(pub.color, 'трёхцветная');
    assert.ok(!JSON.stringify(pub).includes('643094100123456'), 'чип на странице QR не показывается');
    assert.equal((await owner.del('/api/wards/' + r.body.item.id)).status, 200);
    assert.equal((await browser().get('/api/w/' + token)).status, 404);
  });
});
