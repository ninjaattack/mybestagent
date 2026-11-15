'use strict';
// Подбор совпадений «потерял ↔ нашёл» без ИИ: только правила и словари, работает мгновенно и бесплатно,
// данные никуда не уходят. Каждое совпадение объясняется списком причин (reasons) — их видит пользователь.
//
// Порядок проверки пары:
//  1) Запреты: разные категории, тип вещи, вид животного, пол, страна, далёкий возраст, находка раньше пропажи.
//  2) Уникальные номера (чип, клеймо, серийный номер/IMEI, госномер, ФИО в документе):
//     совпали — это точно та же вещь (100 %), различаются — точно разные (пары нет).
//  3) Приметы: цвета и окрас (словарь синонимов), порода, одежда «вещь + цвет», рост и возраст, бренд и модель,
//     общие слова с учётом опечаток, скрытая примета, цвета и отпечаток фото. Противоречия снижают оценку.
//  4) Место и время: допустимое расстояние растёт с каждым днём и зависит от того, кто или что пропало.
// Итог: 50–100 — совпадение, 35–49 — «возможно» (дальше или меньше общих примет).

const STRONG = 50, WEAK = 35;

/* ---------- текст: нормализация, стемминг, опечатки ---------- */
const low = (s) => String(s == null ? '' : s).toLowerCase().replace(/ё/g, 'е');
const tokens = (s) => low(s).match(/[a-zа-я0-9]+/g) || [];
const STOP = new Set(('и в во на с со по за из у от до для при не нет без это как что или его ее их был была было около очень ' +
  'найден найдена найдено найдены нашел нашла нашли потерян потеряна потеряно потерялся потерялась потерялись пропал пропала пропали улетел убежал убежала ' +
  'возле рядом сейчас домой дома меня мой моя мое мои лет года год где когда который которая есть была были будет тут там ' +
  'the and with near lost found missing').split(' '));
const END = /(иями|ями|ами|ого|его|ому|ему|ыми|ими|ая|яя|ое|ее|ые|ие|ий|ый|ой|ам|ям|ах|ях|ов|ев|ей|ом|ем|ью|ия|а|я|ы|и|о|е|у|ю|ь)$/;
function stem(w) { if (/^[0-9]+$/.test(w) || w.length <= 3) return w; const r = w.replace(END, ''); return r.length >= 3 ? r : w; }
// расстояние Левенштейна с ранним выходом: нам нужно только «0 или 1»
function lev1(a, b) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 1) return 2;
  let i = 0, j = 0, diff = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++diff > 1) return 2;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return diff + (a.length - i) + (b.length - j);
}

/* ---------- словари ---------- */
// Цвета: одно слово-код на группу синонимов. Окрас животных и цвет одежды/вещей — один словарь.
const COLORS = [
  ['black', /^(черн|black|ворон|антрацит)/],
  ['white', /^(бел(ый|ая|ое|ые|ого|ой|ую|ым|ых|ом|еньк|оснежн|о)$|white|снежн|молочн)/],
  ['gray', /^(сер(ый|ая|ое|ые|ого|ой|ую|ым|ых|ом|о|еньк\w*|ебр\w*)$|grey|gray|дымчат|пепельн|серебр|silver|графит|стальн|мышин)/],
  ['ginger', /^(рыж|огнен|ginger|медн|персиков|абрикос|apricot)/],
  ['orange', /^(оранж|orange)/],
  ['red', /^(красн|ал(ый|ая|ое|ые)$|бордо|бордов|вишнев|малинов|red$|maroon|burgundy|crimson|кирпичн)/],
  ['yellow', /^(желт|yellow|лимонн|горчичн)/],
  ['green', /^(зелен|green|хаки|khaki|оливк|olive|салатов|изумруд|мятн)/],
  ['blue', /^(син(ий|яя|ее|ие|его|ей|юю|им|их|ем|е|ева\w*|еват\w*)$|голуб|blue|navy|бирюз|turquoise|лазурн|индиго|джинсов|denim)/],
  ['purple', /^(фиолет|сиренев|лилов|purple|violet|лаванд)/],
  ['pink', /^(розов|pink|фукси|пудров)/],
  ['brown', /^(коричн|шоколад|бур(ый|ая|ое|ые)$|каштан|brown|chocolate|кофейн|коньячн|соболин)/],
  ['beige', /^(беж|палев|кремов|песочн|cream|beige|sand|бисквит|светло)/],
  ['gold', /^(золот|gold)/]
];
// узоры окраса: не цвет, но тоже примета (без противоречий)
const PATTERNS = [
  ['tabby', /^(полосат|тигров|tabby|striped|мраморн)/],
  ['spotted', /^(пятнист|пег(ий|ая|ое|ие)$|spotted|далматин)/],
  ['tricolor', /^(трехцвет|черепахов|calico|tortoise)/]
];
// близкие цвета: люди называют один окрас по-разному — частичное совпадение и не противоречие
const NEAR = new Set(['ginger:orange', 'ginger:gold', 'ginger:brown', 'ginger:beige', 'ginger:red', 'gold:yellow', 'gold:beige', 'beige:white',
  'beige:brown', 'beige:yellow', 'gray:blue', 'gray:black', 'gray:white', 'black:brown', 'red:pink', 'red:orange', 'red:brown', 'purple:pink', 'purple:blue', 'orange:yellow']
  .flatMap((p) => [p, p.split(':').reverse().join(':')]));
const near = (x, y) => NEAR.has(x + ':' + y);

// Одежда: вид вещи — для сравнения пар «синяя куртка» = «куртка синяя»
const GARMENTS = [
  ['jacket', /^(куртк|курточ|пуховик|ветровк|бомбер|анорак|jacket|parka)/],
  ['coat', /^(пальт|шуб|дубленк|плащ|тренч|coat)/],
  ['sweater', /^(свитер|кофт|джемпер|толстовк|худи|свитшот|кардиган|водолазк|hoodie|sweater|cardigan)/],
  ['shirt', /^(рубаш|рубах|футболк|майк|блуз|поло$|сорочк|shirt|tshirt|blouse)/],
  ['vest', /^(жилет|vest)/],
  ['trousers', /^(брюк|штан|джинсы$|джинсах$|джинс$|jeans|trousers|pants|леггинс|лосин|трико)/],
  ['skirt', /^(юбк|skirt)/],
  ['dress', /^(плать|сарафан|халат|dress)/],
  ['shorts', /^(шорт|shorts)/],
  ['hat', /^(шапк|кепк|бейсболк|панам|шляп|берет|платок|косынк|hat$|cap$|beanie)/],
  ['shoes', /^(ботин|кроссовк|кросовк|туфл|сапог|сапож|кед|тапк|тапоч|сандал|валенк|галош|шлепанц|мокасин|угги|boots|shoes|sneakers|trainers|sandals)/],
  ['scarf', /^(шарф|scarf)/],
  ['collar', /^(ошейник|collar)/],
  ['harness', /^(шлейк|harness)/]
];
// Вещи: синонимы названий, чтобы «смартфон» совпал с «телефоном», а «портмоне» — с «кошельком»
const ITEMS = [
  ['phone', /^(телефон|смартфон|айфон|iphone|мобильн|сотов|phone|smartphone|android|андроид|самсунг|samsung|xiaomi|сяоми|редми|redmi)/],
  ['wallet', /^(кошел|портмоне|бумажник|кардхолдер|wallet|purse)/],
  ['bag', /^(сумк|сумоч|клатч|bag$|handbag|авоськ|шоппер)/],
  ['backpack', /^(рюкзак|ранец|backpack)/],
  ['keys', /^(ключ|keys?$)/],
  ['passport', /^(паспорт|загранпаспорт|passport)/],
  ['license', /^(права$|правах$|водительск|удостоверени|license)/],
  ['card', /^(карт(а|у|ой|очк\w*)$|банковск|card$)/],
  ['glasses', /^(очк|glasses|sunglasses)/],
  ['earphones', /^(наушник|airpods|эйрподс|earbuds|headphones)/],
  ['watch', /^(часы$|часики|watch$|smartwatch)/],
  ['ring', /^(кольц|колечк|перстен|ring$)/],
  ['earrings', /^(серьг|серьж|сережк|earring)/],
  ['chain', /^(цепочк|цепь|chain)/],
  ['pendant', /^(кулон|подвеск|медальон|pendant)/],
  ['bracelet', /^(браслет|bracelet)/],
  ['umbrella', /^(зонт|umbrella)/],
  ['laptop', /^(ноутбук|ноут$|макбук|macbook|laptop)/],
  ['tablet', /^(планшет|айпад|ipad|tablet)/],
  ['camera', /^(фотоаппарат|камер|camera)/],
  ['scooter', /^(самокат|scooter)/],
  ['bike', /^(велосипед|велик|bike|bicycle)/],
  ['toy', /^(игрушк|toy$)/],
  ['documents', /^(документ|папк|documents?)/]
];
// Породы: синонимы и сокращения. «Дворняга»/«метис» — не порода, противоречий не даёт.
const DOG_BREEDS = [
  ['mix', /^(дворняг|дворняж|метис|беспородн|двортерьер|mongrel|mixed|mutt)/],
  ['labrador', /^(лабрадор|лабрик|labrador)/], ['golden', /^(голден|golden)/],
  ['caucasian', /^(кавказ|алабай|среднеазиат|alabai)/], ['shepherd', /^(овчарк|shepherd)/],
  ['husky', /^(хаски|husky|маламут|malamute)/], ['laika', /^(лайк(а|и|у|ой)$|laika)/],
  ['spitz', /^(шпиц|померан|spitz|pomeranian)/], ['dachshund', /^(такс(а|ы|у|ой|е|ик\w*|очк\w*)$|dachshund)$/],
  ['yorkie', /^(йорк|yorkie|yorkshire)/], ['chihuahua', /^(чихуа|chihuahua)/], ['pug', /^(мопс|pug$)/],
  ['frenchie', /^(француз|french)/], ['bulldog', /^(бульдог|bulldog)/], ['corgi', /^(корги|corgi)/], ['beagle', /^(бигл|beagle)/],
  ['spaniel', /^(спаниел|spaniel)/], ['poodle', /^(пудел|poodle)/], ['jackrussell', /^(джек|jack$|рассел|russell)/],
  ['rottweiler', /^(ротвейл|rottweiler)/], ['doberman', /^(доберман|doberman)/], ['boxer', /^(боксер|boxer)/],
  ['collie', /^(шелти|колли|sheltie|collie)/], ['maltese', /^(мальтез|болонк|maltese|bichon|бишон)/], ['corso', /^(корсо|corso)/],
  ['akita', /^(акит|шиба|сиба|shiba|akita)/], ['terrier', /^(терьер|terrier)/]
];
const CAT_BREEDS = [
  ['mix', /^(дворов|беспородн|метис|mixed)/],
  ['british', /^(британ|british)/], ['scottish', /^(шотланд|вислоух|скоттиш|scottish|fold$)/], ['mainecoon', /^(мейн|maine|coon)/],
  ['sphynx', /^(сфинкс|sphynx|sphinx)/], ['siamese', /^(сиам|тайск|siamese|thai$)/], ['persian', /^(персидск|перс$|персы$|persian)/],
  ['bengal', /^(бенгал|bengal)/], ['siberian', /^(сибирск|невск|siberian)/], ['ragdoll', /^(рэгдол|регдол|ragdoll)/]
];
// Вид животного: собака ≠ кошка — такие пары не совпадают, даже если рядом и в один день
const SPECIES = [['dog', /соба|пес|пёс|щен|шпиц|лабрад|овчар|терьер|хаски|такс|dog|puppy/], ['cat', /кот|кош|котен|котён|cat|kitten/],
  ['bird', /птиц|попуг|корелл|голуб|bird|parrot/], ['rodent', /хомя|крыс|морск.*свин|шинш|rodent|hamster/]];
// вид животного: сначала поле «Вид», и только если оно пустое или нестандартное — заголовок
function speciesOf(a) {
  for (const v of [a.species, a.title]) { const txt = low(v || ''); const m = txt && SPECIES.find(([, re]) => re.test(txt)); if (m) return m[0]; }
  return null;
}

const firstHit = (list, w) => { for (const [k, re] of list) if (re.test(w)) return k; return null; };
const setOf = (list, s) => new Set(tokens(s).map((w) => firstHit(list, w)).filter(Boolean));
const colorsOf = (s) => setOf(COLORS, s);
const patternsOf = (s) => setOf(PATTERNS, s);
// канонический ключ слова: синоним вещи/цвета/одежды или основа слова
const keyOf = (w) => { const k = firstHit(ITEMS, w) || firstHit(GARMENTS, w) || firstHit(COLORS, w); return k ? '#' + k : stem(w); };
// слова-виды и общие слова приметой не считаются
const GENERIC = /^(соба|пес|кот|кош|птиц|живот|вещ|предм|человек|мужчин|женщин|парен|девушк|девочк|мальчик|ребен|бабушк|дедушк|dog|cat|person|man|woman|item|thing)/;

// Одежда: пары «вид + цвет» из одного поля («синяя куртка, чёрные брюки»): части через запятую/«и»
function garmentPairs(...fields) {
  const pairs = [];
  for (const f of fields) for (const part of low(f).split(/[,;/]|\sи\s|\sс\s|\sand\s/)) {
    const g = [...setOf(GARMENTS, part)], c = [...colorsOf(part)];
    for (const gg of g) pairs.push({ g: gg, c: new Set(c) });
  }
  return pairs;
}

/* ---------- уникальные номера ---------- */
// Латиница и кириллица в номерах выглядят одинаково (А123ВС = A123BC): приводим к латинице
const LOOK = { а: 'a', в: 'b', е: 'e', к: 'k', м: 'm', н: 'h', о: 'o', р: 'p', с: 'c', т: 't', у: 'y', х: 'x' };
const normId = (v) => low(v).replace(/[авекмнорстух]/g, (ch) => LOOK[ch]).replace(/[^a-z0-9]/g, '').toUpperCase();
const nameWords = (v) => new Set(tokens(v).filter((w) => w.length >= 2));
// Какие номера бывают у категории/типа вещи; private — номер видят только автор заявки и модератор
const ID_FIELDS = {
  animals: { chip: 20, tattoo: 20 },
  electronics: { serial: 40 }, bike: { serial: 40 }, documents: { doc_name: 120 }
};
function idFields(category, thingType) { return category === 'animals' ? ID_FIELDS.animals : category === 'things' ? ID_FIELDS[thingType] || {} : {}; }
// Номера из формы: только известные поля, чистим пробелы; ФИО — как есть (сравниваем по словам)
function readIds(src, category, thingType) {
  const out = {};
  if (!src || typeof src !== 'object') return out;
  for (const [k, max] of Object.entries(idFields(category, thingType))) {
    const v = String(src[k] == null ? '' : src[k]).replace(/\s+/g, ' ').trim().slice(0, max);
    if (!v) continue;
    if (k === 'doc_name') { if (nameWords(v).size >= 2) out[k] = v; } else if (normId(v).length >= 4) out[k] = v;
  }
  return out;
}
// Сравнение одного номера: 'same' | 'diff' | null (нечего сравнивать).
// Нашедший мог разобрать только часть номера — совпадение хвоста от 6 знаков тоже считается.
function cmpId(k, x, y) {
  if (!x || !y) return null;
  if (k === 'doc_name') {
    const A = nameWords(x), B = nameWords(y); const [s, l] = A.size <= B.size ? [A, B] : [B, A];
    let hit = 0; for (const w of s) if ([...l].some((v) => v === w || (w.length >= 5 && lev1(v, w) <= 1))) hit++;
    return hit >= 2 && hit >= s.size - (s.size > 2 ? 1 : 0) ? 'same' : 'diff';
  }
  const a = normId(x), b = normId(y);
  if (a === b) return 'same';
  const [s, l] = a.length <= b.length ? [a, b] : [b, a];
  if (s.length >= 6 && l.endsWith(s)) return 'same';
  return 'diff';
}

/* ---------- расстояние ---------- */
function distKm(aLat, aLng, bLat, bLng) {
  if ([aLat, aLng, bLat, bLng].some((v) => v == null || isNaN(v))) return null;
  const R = 6371, toR = Math.PI / 180;
  const dLat = (bLat - aLat) * toR, dLng = (bLng - aLng) * toR;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * toR) * Math.cos(bLat * toR) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
// Сколько километров «разумно» между местом пропажи и находки через days дней
function allowedKm(lost, found, days, dl, df) {
  const transport = dl.transport || df.transport;
  if (lost.category === 'people') {
    if (transport) return 2000;
    const age = lost.person_age;
    const frail = (dl.health || []).includes('dementia') || (age != null && (age >= 65 || age < 7)) || dl.template === 'elderly' || dl.template === 'child';
    return frail ? Math.min(150, 5 + 10 * days) : Math.min(600, 15 + 40 * days);
  }
  if (lost.category === 'animals') {
    const sp = speciesOf(lost) || speciesOf(found);
    if (sp === 'cat') return Math.min(15, 3 + 1.5 * days);
    if (sp === 'bird') return Math.min(150, 10 + 15 * days);
    if (sp === 'dog') return Math.min(80, 8 + 6 * days);
    return Math.min(40, 5 + 3 * days);
  }
  const tt = dl.thing_type || df.thing_type;
  if (tt === 'auto') return Math.min(3000, 100 + 300 * days);
  if (transport) return 500; // забыли в автобусе, поезде, такси
  return Math.min(150, 10 + 10 * days);
}

/* ---------- сравнение пары ---------- */
const json = (v, def) => { if (v && typeof v === 'object') return v; try { return JSON.parse(v || def); } catch (e) { return JSON.parse(def); } };
const inter = (A, B) => [...A].filter((x) => B.has(x));
const anyNear = (A, B) => [...A].some((x) => [...B].some((y) => near(x, y)));
const country = (a) => (a.country && a.country !== 'RU' ? a.country : '');
const hammingHex = (x, y) => { let n = 0; for (let i = 0; i < 16; i++) { let v = parseInt(x[i], 16) ^ parseInt(y[i], 16); while (v) { n += v & 1; v >>= 1; } } return n; };
// Текст для общих слов: у вещи — название и уточнения; у человека и животного — описание и приметы
const THING_KEYS = ['brand', 'model', 'color', 'size', 'material', 'metal', 'stones', 'engraving', 'doc_kind', 'keyring', 'landmark'];
const PERSON_KEYS = ['clothes_top', 'clothes_bottom', 'headwear', 'shoes', 'landmark', 'health_note'];
const PET_KEYS = ['breed', 'color', 'clothes', 'park', 'landmark'];
function textOf(a, d) {
  const keys = a.category === 'things' ? THING_KEYS : a.category === 'people' ? PERSON_KEYS : PET_KEYS;
  return [a.title, a.features, a.description, a.category === 'things' ? '' : a.species, ...keys.map((k) => d[k])].filter(Boolean).join(' ');
}
// Общие слова: синонимы и опечатки (одна буква в словах от 5 букв); возвращает слова из первой заявки
function commonWords(ta, tb) {
  const B = new Map();
  for (const w of tokens(tb)) if (w.length > 2 && !STOP.has(w) && !GENERIC.test(w)) B.set(keyOf(w), w);
  const keysB = [...B.keys()];
  const hit = new Map();
  for (const w of tokens(ta)) {
    if (w.length <= 2 || STOP.has(w) || GENERIC.test(w)) continue;
    const k = keyOf(w);
    if (hit.has(k)) continue;
    if (B.has(k) || (k[0] !== '#' && k.length >= 5 && keysB.some((x) => x[0] !== '#' && lev1(x, k) <= 1))) hit.set(k, w);
  }
  return [...hit.values()];
}

// Главная функция: { score 0..100, reasons: [{k, v?}], far } — far: дальше «разумного» расстояния (только «возможно»)
function matchInfo(a, b) {
  const NO = { score: 0, reasons: [] };
  if (!a || !b || a.category !== b.category || a.kind === b.kind) return NO;
  const lost = a.kind === 'lost' ? a : b, found = a.kind === 'lost' ? b : a;
  const dl = json(lost.details, '{}'), df = json(found.details, '{}');
  const il = json(lost.ids, '{}'), iF = json(found.ids, '{}');
  if (country(lost) !== country(found)) return NO;
  if (a.category === 'animals') { const sa = speciesOf(lost), sb = speciesOf(found); if (sa && sb && sa !== sb) return NO; }
  if (a.category === 'things' && dl.thing_type && df.thing_type && dl.thing_type !== df.thing_type && dl.thing_type !== 'other' && df.thing_type !== 'other') return NO;
  if (a.category === 'people') {
    if (dl.sex && df.sex && dl.sex !== df.sex) return NO;
    if (lost.person_age != null && found.person_age != null && Math.abs(lost.person_age - found.person_age) > 15) return NO;
  }
  // дата: находка не раньше пропажи (на сутки — допуск на часовые пояса и неточность)
  let days = null;
  if (lost.event_date && found.event_date) {
    days = (new Date(found.event_date) - new Date(lost.event_date)) / 864e5;
    if (days < -1) return NO;
    days = Math.max(0, days);
  }
  const reasons = [];
  const add = (k, v) => reasons.push(v === undefined ? { k } : { k, v });

  // уникальные номера и госномер
  const ids = Object.assign({}, il, dl.plate ? { plate: dl.plate } : {});
  const idsF = Object.assign({}, iF, df.plate ? { plate: df.plate } : {});
  let idSame = null;
  for (const k of Object.keys(ids)) {
    const r = cmpId(k, ids[k], idsF[k]);
    if (r === 'diff') return NO; // номер разный — точно разные вещи или животные
    if (r === 'same') idSame = idSame || k;
  }

  let attr = 0, penalty = 0;
  // скрытая примета: сравнивается со скрытой и с открытыми приметами другой стороны; текст не раскрывается
  const ta = textOf(lost, dl), tb = textOf(found, df);
  for (const [sec, other] of [[lost.secret, tb + ' ' + (found.secret || '')], [found.secret, ta + ' ' + (lost.secret || '')]]) {
    if (sec && commonWords(sec, other).length) { attr += 15; add('secret'); break; }
  }

  if (a.category === 'animals') {
    const cl = colorsOf([dl.color, lost.title].join(' ')), cf = colorsOf([df.color, found.title].join(' '));
    const pl = new Set([...(dl.photo_colors || [])]), pf = new Set([...(df.photo_colors || [])]);
    const same = inter(cl, cf);
    if (same.length) { attr += 12; add('color', same); } else if (cl.size && cf.size) {
      if (anyNear(cl, cf)) attr += 6; else { penalty += 12; add('color_diff'); }
    } else {
      // окрас указан только с одной стороны (или ни с одной) — сверяем с цветами на фото
      const A = cl.size ? cl : pl, B = cf.size ? cf : pf;
      const ph = inter(A, B); if (ph.length && (pl.size || pf.size)) { attr += 6; add('photo_colors', ph); }
    }
    const pat = inter(patternsOf([dl.color, lost.title, lost.features].join(' ')), patternsOf([df.color, found.title, found.features].join(' ')));
    if (pat.length) { attr += 5; add('pattern', pat); }
    const list = speciesOf(lost) === 'cat' || speciesOf(found) === 'cat' ? CAT_BREEDS : DOG_BREEDS;
    const bl = firstHitIn(list, [dl.breed, lost.title].join(' ')), bf = firstHitIn(list, [df.breed, found.title].join(' '));
    if (bl && bf && bl !== 'mix' && bf !== 'mix') { if (bl === bf) { attr += 15; add('breed', bl); } else { penalty += 20; add('breed_diff'); } }
    const coll = matchGarments(garmentPairs(dl.clothes, lost.features), garmentPairs(df.clothes, found.features), 99);
    if (coll.hit.length) { attr += Math.min(16, coll.hit.length * 8); add('collar', coll.hit); }
  }

  if (a.category === 'people') {
    if (lost.person_age != null && found.person_age != null) {
      const da = Math.abs(lost.person_age - found.person_age);
      if (da <= 3) { attr += 8; add('age'); } else if (da <= 7) attr += 5; else if (da > 12) penalty += 5;
    }
    if (dl.height && df.height) {
      const dh = Math.abs(dl.height - df.height);
      if (dh <= 5) { attr += 8; add('height'); } else if (dh <= 10) attr += 4; else if (dh > 20) { penalty += 15; add('height_diff'); }
    }
    if (dl.hair_color && df.hair_color && dl.hair_color !== 'other' && df.hair_color !== 'other') {
      const HAIR_NEAR = new Set(['blond:light_brown', 'light_brown:brown', 'brown:black', 'gray:blond', 'red:light_brown', 'red:brown']);
      if (dl.hair_color === df.hair_color) { attr += 6; add('hair'); } else if (!HAIR_NEAR.has(dl.hair_color + ':' + df.hair_color) && !HAIR_NEAR.has(df.hair_color + ':' + dl.hair_color)) penalty += 8;
    }
    if (dl.eye_color && dl.eye_color === df.eye_color && dl.eye_color !== 'other') attr += 3;
    if (dl.build && dl.build === df.build) attr += 3;
    if ((dl.health || []).some((x) => (df.health || []).includes(x))) { attr += 5; add('health'); }
    // одежда: сравниваем, только если прошло не больше трёх дней — потом человек мог переодеться
    const cg = matchGarments(garmentPairs(dl.clothes_top, dl.clothes_bottom, dl.headwear, dl.shoes, lost.features), garmentPairs(df.clothes_top, df.clothes_bottom, df.headwear, df.shoes, found.features, found.description), days);
    if (cg.hit.length) { attr += Math.min(30, cg.hit.length * 10); add('clothes', cg.hit); }
    penalty += cg.diff * 8;
  }

  if (a.category === 'things') {
    const eq = (k) => dl[k] && df[k] && normId(dl[k]) === normId(df[k]);
    if (eq('brand')) { attr += 15; add('brand', dl.brand); } else if (dl.brand && df.brand && !commonWords(dl.brand, df.brand).length) penalty += 15;
    if (eq('model')) { attr += 10; add('model', dl.model); }
    if (eq('doc_kind') || (dl.doc_kind && df.doc_kind && commonWords(dl.doc_kind, df.doc_kind).length)) { attr += 10; add('doc_kind', dl.doc_kind); }
    const cl = colorsOf([dl.color, lost.title].join(' ')), cf = colorsOf([df.color, found.title].join(' '));
    const same = inter(cl, cf);
    if (same.length) { attr += 10; add('color', same); } else if (cl.size && cf.size) { if (anyNear(cl, cf)) attr += 4; else { penalty += 10; add('color_diff'); } }
    if (dl.engraving && df.engraving && commonWords(dl.engraving, df.engraving).length) { attr += 15; add('engraving'); }
  }

  // общие слова (с синонимами и опечатками) — по 9 баллов, не больше трёх
  const words = commonWords(ta, tb).filter((w) => !COLORS.some(([, re]) => re.test(w)));
  if (words.length) { attr += Math.min(27, words.length * 9); add('words', words.slice(0, 4)); }

  // одно и то же фото (отпечаток почти совпадает)
  const hl = dl.photo_hash || [], hf = df.photo_hash || [];
  if (hl.some((x) => hf.some((y) => hammingHex(x, y) <= 5))) { attr += 25; add('same_photo'); }

  // место и время
  const d = distKm(lost.lat, lost.lng, found.lat, found.lng);
  const allowed = allowedKm(lost, found, days == null ? 0 : days, dl, df);
  let place = 0, far = false;
  if (d != null) {
    if (d > allowed * 3) return NO;
    if (d > allowed) far = true;
    else { const r = d / allowed; place = r <= 0.1 ? 25 : r <= 0.3 ? 20 : r <= 0.6 ? 12 : 6; }
    add('dist', Math.round(d * 10) / 10);
  } else if (lost.city && found.city && low(lost.city) === low(found.city)) { place = 10; add('city', lost.city); }
  let time = 0;
  if (days != null) { time = days <= 1 ? 15 : days <= 3 ? 12 : days <= 7 ? 8 : days <= 30 ? 4 : days <= 90 ? 1 : 0; add('days', Math.round(days)); }

  if (idSame) return { score: 100, reasons: [{ k: 'id', v: idSame }, ...reasons], far: false };
  // без общих примет совпадением не считаем — одного места и даты недостаточно
  if (attr < 9) return NO;
  let score = Math.min(60, attr) - penalty + place + time;
  score = Math.max(0, Math.min(99, Math.round(score)));
  if (far) score = Math.min(score, STRONG - 1);
  return { score, reasons, far };
}
function firstHitIn(list, s) { for (const w of tokens(s)) { const k = firstHit(list, w); if (k) return k; } return null; }
// Пары одежды: совпали вид и цвет — примета; тот же вид, но цвета разные — противоречие (если прошло ≤ 3 дней)
function matchGarments(A, B, days) {
  const hit = [], seen = new Set(); let diff = 0;
  for (const x of A) for (const y of B) {
    if (x.g !== y.g) continue;
    const c = inter(x.c, y.c);
    if (c.length) { const key = x.g + ':' + c[0]; if (!seen.has(key)) { seen.add(key); hit.push([x.g, c[0]]); } } else if (x.c.size && y.c.size && !anyNear(x.c, y.c) && (days == null || days <= 3)) diff++;
  }
  return { hit, diff };
}
const matchScore = (a, b) => matchInfo(a, b).score;

/* ---------- цвета и отпечаток фото (присылает браузер) ---------- */
const COLOR_CODES = COLORS.map(([k]) => k);
function readPhotoMeta(src) {
  const out = {};
  if (Array.isArray(src.photo_colors)) { const c = [...new Set(src.photo_colors.filter((x) => COLOR_CODES.includes(x)))].slice(0, 3); if (c.length) out.photo_colors = c; }
  if (Array.isArray(src.photo_hash)) { const hs = src.photo_hash.filter((x) => typeof x === 'string' && /^[0-9a-f]{16}$/.test(x)).slice(0, 5); if (hs.length) out.photo_hash = hs; }
  return out;
}

module.exports = { matchInfo, matchScore, readIds, idFields, readPhotoMeta, normId, cmpId, colorsOf, allowedKm, distKm, speciesOf, stem, tokens, low, STOP, commonWords, STRONG, WEAK, COLOR_CODES };
