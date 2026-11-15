'use strict';
// «Мои близкие»: заранее заполненные карточки тех, кто может потеряться сам и не сможет попросить о помощи, —
// пожилой родственник, человек с деменцией, ребёнок, питомец. У карточки:
//  • кнопка «Пропал» — заявка собирается из карточки за минуту;
//  • QR-код для браслета, брелока или ошейника: нашедший сканирует его, видит то, что разрешил владелец,
//    и сообщает родным без регистрации (сообщение и, по желанию, место на карте). Контакты владельца
//    не раскрываются, если он сам не разрешил показывать телефон.
// Карточка видна только владельцу и его семейному аккаунту. Сведения о здоровье — особая категория данных:
// заполняет родственник или законный представитель со своим согласием (п. 1 ч. 2 ст. 10 152-ФЗ).
const crypto = require('crypto');
const qrcode = require('qrcode-generator');
const M = require('./match');

const MAX_WARDS = 10;
const newToken = () => crypto.randomBytes(12).toString('base64url');

// SVG с QR-кодом (без внешних сервисов). Уровень коррекции M — читается даже с потёртого брелока.
function qrSvg(text) {
  const q = qrcode(0, 'M'); q.addData(text); q.make();
  const n = q.getModuleCount(), m = 2, size = n + m * 2;
  let path = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) path += `M${c + m} ${r + m}h1v1h-1z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
}

function register(app, d) {
  const { h, needAuth, fail, str, num, audit, rateLimit, get, all, run, tx, S, PHOTO_RE, PERSON_OPTS, PERSON_TEXT, HEALTH, PET_TEXT, BASE } = d;
  const canSee = (w, u) => !!u && (w.user_id === u.id || (w.family_id && u.family_id === w.family_id));
  const own = (id, u) => { const w = get('SELECT * FROM wards WHERE id = ?', Number(id)); if (!w || !canSee(w, u)) fail(404, 'not_found', 'Карточка не найдена'); return w; };
  const qrUrl = (w) => `${BASE}/w/${w.qr_token}`;
  const activeApp = (w) => get("SELECT id, title, status FROM applications WHERE ward_id = ? AND kind = 'lost' AND status IN ('published','pending') ORDER BY id DESC LIMIT 1", w.id) || null;
  function dto(w) {
    return {
      id: w.id, kind: w.kind, name: w.name, relation: w.relation, birth_year: w.birth_year, sex: w.sex, species: w.species,
      details: JSON.parse(w.details || '{}'), ids: JSON.parse(w.ids || '{}'), features: w.features, photos: JSON.parse(w.photos || '[]'),
      home_city: w.home_city, places: w.places, contact: w.contact,
      qr_on: !!w.qr_on, qr_photo: !!w.qr_photo, qr_phone: !!w.qr_phone, qr_note: w.qr_note, qr_url: qrUrl(w),
      family: !!w.family_id, created_at: w.created_at, updated_at: w.updated_at,
      active_app: activeApp(w),
      alerts: all('SELECT id, message, contact, lat, lng, created_at FROM ward_alerts WHERE ward_id = ? ORDER BY id DESC LIMIT 20', w.id)
    };
  }
  function readWard(b, isNew, cur) {
    const o = {};
    const kind = isNew ? (['person', 'pet'].includes(b.kind) ? b.kind : fail(400, 'bad_kind', 'Тип карточки')) : cur.kind;
    if (isNew) o.kind = kind;
    o.name = str(b.name, 80); if (!o.name) fail(400, 'name_required', 'Укажите имя');
    const y = num(b.birth_year), thisYear = new Date().getFullYear();
    if (y != null && (y < 1900 || y > thisYear)) fail(400, 'bad_year', 'Год рождения — от 1900 до текущего');
    o.birth_year = y == null ? null : Math.round(y);
    o.sex = ['male', 'female'].includes(b.sex) ? b.sex : '';
    o.features = str(b.features, 1000);
    o.home_city = str(b.home_city, 80); o.places = str(b.places, 300);
    o.contact = str(b.contact, 120); if (!o.contact) fail(400, 'contact_required', 'Укажите контакт для связи');
    const photos = Array.isArray(b.photos) ? b.photos.filter((p) => typeof p === 'string' && PHOTO_RE.test(p)) : [];
    if (photos.length > 5) fail(400, 'photos_max', 'Не более 5 фото');
    o.photos = JSON.stringify(photos);
    const src = b.details && typeof b.details === 'object' && !Array.isArray(b.details) ? b.details : {};
    const det = {};
    const text = (k, max) => { const v = str(src[k], max); if (v) det[k] = v; };
    if (kind === 'person') {
      o.relation = ['relative', 'legal_rep'].includes(b.relation) ? b.relation : fail(400, 'relation_required', 'Укажите, кем вы приходитесь человеку');
      o.species = '';
      for (const [k, list] of Object.entries(PERSON_OPTS)) if (list.includes(src[k])) det[k] = src[k];
      if (src.height !== '' && src.height != null) { const v = num(src.height); if (v == null || v < 40 || v > 250) fail(400, 'bad_height', 'Рост — от 40 до 250 см'); det.height = Math.round(v); }
      for (const [k, max] of Object.entries(PERSON_TEXT)) text(k, max);
      const health = Array.isArray(src.health) ? HEALTH.filter((x) => src.health.includes(x)) : [];
      if (health.length) det.health = health;
      o.ids = '{}';
    } else {
      o.relation = ''; o.species = str(b.species, 60);
      for (const [k, max] of Object.entries(PET_TEXT)) if (k !== 'park') text(k, max);
      o.ids = JSON.stringify(M.readIds(b.ids, 'animals'));
    }
    o.details = JSON.stringify(det);
    o.qr_on = b.qr_on === false ? 0 : 1;
    o.qr_photo = b.qr_photo ? 1 : 0; o.qr_phone = b.qr_phone ? 1 : 0;
    o.qr_note = str(b.qr_note, 300);
    return o;
  }

  app.get('/api/wards', needAuth, h((req, res) => {
    const rows = all('SELECT * FROM wards WHERE user_id = ? OR (family_id IS NOT NULL AND family_id = ?) ORDER BY id', req.user.id, req.user.family_id || -1);
    res.json({ items: rows.map(dto), max: MAX_WARDS });
  }));
  app.get('/api/wards/:id', needAuth, h((req, res) => res.json({ item: dto(own(req.params.id, req.user)) })));
  app.post('/api/wards', needAuth, h((req, res) => {
    rateLimit('ward:' + req.user.id, 30, 3600e3);
    if (get('SELECT COUNT(*) c FROM wards WHERE user_id = ?', req.user.id).c >= MAX_WARDS) fail(400, 'limit', 'Не более 10 карточек близких');
    const o = readWard(req.body, true);
    if (o.kind === 'person' && !req.body.consent) fail(400, 'consent_required', 'Подтвердите, что вы родственник или законный представитель и даёте согласие на обработку данных');
    o.user_id = req.user.id;
    o.family_id = req.body.family && req.user.family_id ? req.user.family_id : null;
    o.qr_token = newToken();
    const keys = Object.keys(o);
    const id = run(`INSERT INTO wards (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`, ...keys.map((k) => o[k])).lastInsertRowid;
    audit(req, 'ward.create', 'ward:' + id, { kind: o.kind });
    res.json({ item: dto(get('SELECT * FROM wards WHERE id = ?', id)) });
  }));
  app.patch('/api/wards/:id', needAuth, h((req, res) => {
    const w = own(req.params.id, req.user);
    const o = readWard(req.body, false, w);
    if (req.body.family !== undefined) o.family_id = req.body.family && req.user.family_id ? req.user.family_id : null;
    o.updated_at = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const keys = Object.keys(o);
    run(`UPDATE wards SET ${keys.map((k) => k + ' = ?').join(', ')} WHERE id = ?`, ...keys.map((k) => o[k]), w.id);
    audit(req, 'ward.update', 'ward:' + w.id);
    res.json({ item: dto(get('SELECT * FROM wards WHERE id = ?', w.id)) });
  }));
  app.delete('/api/wards/:id', needAuth, h((req, res) => {
    const w = own(req.params.id, req.user);
    tx(() => { run('UPDATE applications SET ward_id = NULL WHERE ward_id = ?', w.id); run('DELETE FROM ward_alerts WHERE ward_id = ?', w.id); run('DELETE FROM wards WHERE id = ?', w.id); });
    audit(req, 'ward.delete', 'ward:' + w.id);
    res.json({ ok: true });
  }));
  // Новый QR-код: старая ссылка перестаёт работать (например, браслет потерян)
  app.post('/api/wards/:id/qr/reset', needAuth, h((req, res) => {
    const w = own(req.params.id, req.user);
    run('UPDATE wards SET qr_token = ? WHERE id = ?', newToken(), w.id);
    audit(req, 'ward.qr_reset', 'ward:' + w.id);
    res.json({ item: dto(get('SELECT * FROM wards WHERE id = ?', w.id)) });
  }));
  app.get('/api/wards/:id/qr.svg', needAuth, h((req, res) => {
    const w = own(req.params.id, req.user);
    res.set('Cache-Control', 'private, no-store').type('image/svg+xml').send(qrSvg(qrUrl(w)));
  }));

  /* ---------- публичная страница QR (без входа) ---------- */
  const byToken = (token) => {
    const w = /^[A-Za-z0-9_-]{16}$/.test(String(token || '')) && get('SELECT * FROM wards WHERE qr_token = ?', String(token));
    if (!w || !w.qr_on) fail(404, 'not_found', 'Карточка не найдена или отключена');
    return w;
  };
  app.get('/api/w/:token', h((req, res) => {
    rateLimit('wq:' + req.ip, 120, 600e3);
    const w = byToken(req.params.token);
    const det = JSON.parse(w.details || '{}');
    const a = activeApp(w);
    res.set('X-Robots-Tag', 'noindex, nofollow').json({
      kind: w.kind, name: w.name, note: w.qr_note, species: w.species, breed: det.breed || '', color: det.color || '',
      photo: w.qr_photo ? JSON.parse(w.photos || '[]')[0] || '' : '',
      phone: w.qr_phone ? w.contact : '',
      searching: a && a.status === 'published' ? { id: a.id } : null
    });
  }));
  app.post('/api/w/:token/alert', h((req, res) => {
    rateLimit('wa:' + req.ip, 5, 3600e3);
    const w = byToken(req.params.token);
    rateLimit('wat:' + w.id, 30, 24 * 3600e3);
    const message = str(req.body.message, 1000), contact = str(req.body.contact, 120);
    let lat = num(req.body.lat), lng = num(req.body.lng);
    if (lat == null || lng == null || Math.abs(lat) > 90 || Math.abs(lng) > 180) { lat = null; lng = null; }
    if (!message && lat == null) fail(400, 'required', 'Напишите, где вы и что случилось, или отправьте место');
    run('INSERT INTO ward_alerts (ward_id, message, contact, lat, lng, ip) VALUES (?,?,?,?,?,?)', w.id, message, contact, lat, lng, String(req.ip || '').slice(0, 64));
    const who = w.kind === 'pet' ? `Нашли питомца «${w.name}» по QR-коду` : `Нашли по QR-коду: ${w.name}`;
    const body = [message, lat != null ? 'Нашедший отправил место на карте.' : '', contact ? `Контакт нашедшего: ${contact}` : ''].filter(Boolean).join(' ');
    const ids = new Set([w.user_id, ...(w.family_id ? all('SELECT id FROM users WHERE family_id = ?', w.family_id).map((x) => x.id) : [])]);
    for (const uid of ids) S.notify(uid, { type: 'ward', title: who, body, link: `#/ward/${w.id}`, pushTitle: 'Сработал QR-код близкого', pushBody: 'Нашедший оставил сообщение. Откройте платформу' });
    res.json({ ok: true });
  }));
  // короткая ссылка из QR-кода → страница приложения
  app.get(['/w/:token', '/w/:token/'], (req, res) => { res.set('X-Robots-Tag', 'noindex, nofollow'); res.redirect(302, '/#/w/' + encodeURIComponent(String(req.params.token).slice(0, 32))); });
  // QR-код заявки для листовки (только опубликованные заявки)
  app.get('/api/applications/:id/qr.svg', h((req, res) => {
    const a = get("SELECT id FROM applications WHERE id = ? AND status IN ('published','found')", Number(req.params.id));
    if (!a) fail(404, 'not_found', 'Заявка не найдена');
    res.set('Cache-Control', 'public, max-age=86400').type('image/svg+xml').send(qrSvg(`${BASE}/a/${a.id}`));
  }));
}

module.exports = { register, qrSvg, MAX_WARDS };
