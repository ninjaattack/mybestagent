// Шаблоны заявок, «за границей», объяснение совпадений, «Мои близкие» (карточки с QR-кодом) и листовка для печати.
import {
  state, t, tr, h, raw, mount, $, $$, icon, GET, POST, PATCH, DEL, route, go, query, toast, toastErr, sheet, sheetHead, confirmBox,
  photoField, makeMap, pinIcon, getPosition, formData, busy, plural, fmtDate, ago, onLeave, mediaPh, km, money, dict, kindName, catName, refreshMe
} from './core.js';
import { OPT, optName, appCard } from './views.js';

/* =================== шаблоны заявок =================== */
// [код, иконка, название RU, EN, подпись RU, EN]. Шаблон задаёт категорию и предзаполняет вид животного или тип вещи.
export const TPL = {
  people: [
    ['elderly', 'walk', 'Пожилой человек', 'Elderly person', 'В том числе с деменцией', 'Including dementia'],
    ['child', 'baby', 'Ребёнок', 'Child', 'Подаёт законный представитель', 'Filed by a legal guardian'],
    ['adult', 'user', 'Взрослый', 'Adult', 'Подросток или взрослый', 'Teenager or adult']
  ],
  animals: [
    ['dog', 'dog', 'Собака', 'Dog', 'Порода, окрас, чип', 'Breed, colour, chip'],
    ['cat', 'cat', 'Кошка', 'Cat', 'Порода, окрас, чип', 'Breed, colour, chip'],
    ['pet_other', 'bird', 'Другое животное', 'Other animal', 'Птица, грызун и другие', 'Bird, rodent and others']
  ],
  things: [
    ['documents', 'idcard', 'Документы', 'Documents', 'Паспорт, права, карты', 'Passport, licence, cards'],
    ['electronics', 'mobile', 'Телефон, электроника', 'Phone, electronics', 'IMEI — скрыто', 'IMEI kept hidden'],
    ['keys', 'key', 'Ключи', 'Keys', 'Брелок, сколько ключей', 'Key ring, how many'],
    ['accessories', 'wallet', 'Сумка, кошелёк', 'Bag, wallet', 'И другие аксессуары', 'And other accessories'],
    ['jewelry', 'diamond', 'Украшения', 'Jewellery', 'Металл, камни, гравировка', 'Metal, stones, engraving'],
    ['clothes', 'shirt', 'Одежда', 'Clothing', 'Размер, цвет, бренд', 'Size, colour, brand'],
    ['bike', 'bike', 'Велосипед, самокат', 'Bicycle, scooter', 'Номер рамы — скрыто', 'Frame number kept hidden'],
    ['auto', 'car', 'Авто', 'Car', 'Марка, госномер', 'Make, licence plate'],
    ['things_other', 'box', 'Другая вещь', 'Other item', 'Зонт, игрушка, очки…', 'Umbrella, toy, glasses…']
  ]
};
const TPL_CAT = Object.fromEntries(Object.entries(TPL).flatMap(([c, list]) => list.map((x) => [x[0], c])));
const speciesBy = (ru) => { const e = (state.config?.dicts?.species || []).find((x) => x.ru === ru); return e ? (state.lang === 'en' ? e.en : e.ru) : ru; };
// Применить шаблон к черновику заявки
export function applyTemplate(d, code) {
  const cat = TPL_CAT[code]; if (!cat) return;
  if (d.category !== cat) { d.thing_type = undefined; }
  d.category = cat; d.template = code;
  if (code === 'dog') d.species = speciesBy('Собака');
  else if (code === 'cat') d.species = speciesBy('Кошка');
  else if (code === 'pet_other' && (d.species === speciesBy('Собака') || d.species === speciesBy('Кошка'))) d.species = '';
  if (cat === 'things') d.thing_type = code === 'things_other' ? 'other' : code;
  if (code === 'child' && !d.relation) d.relation = 'legal_rep';
}
export const tplName = (code) => { for (const list of Object.values(TPL)) for (const x of list) if (x[0] === code) return tr(x[2], x[3]); return ''; };
// Плитки подвидов одной категории — раскрываются под большой кнопкой на первом шаге мастера
export const tplList = (d, cat) => h`<div class="tpl-grid">${TPL[cat].map(([code, ic, ru, en, sru, sen]) => h`<button type="button" class="tpl c-${cat} ${d.template === code ? 'on' : ''}" data-tpl="${code}" aria-pressed="${d.template === code ? 'true' : 'false'}">
    <span class="tpl-ic">${icon(ic)}</span><span class="tpl-t"><b>${tr(ru, en)}</b><small>${tr(sru, sen)}</small></span></button>`)}</div>`;
// Подсказка шаблона на шаге «Описание»
export function tplHint(code, kind) {
  const lost = kind === 'lost';
  const H = {
    elderly: lost ? tr('Сразу позвоните в полицию: 102 или 112 — заявление принимают без ожидания. Отметьте деменцию на шаге «Приметы», если она есть, и укажите места, где человек любит бывать: пожилые люди часто идут привычным маршрутом.', 'Call the police right away: 102 or 112 — no waiting period. Mark dementia on the “Appearance” step if relevant and list places the person likes to go: elderly people often follow a familiar route.')
      : tr('Побудьте рядом и позвоните 112. Спросите имя и адрес, но не настаивайте: человек может не помнить. Опишите одежду и приметы — по ним родные узнают его.', 'Stay close and call 112. Ask for a name and address but don’t press: they may not remember. Describe clothes and features so relatives can recognise them.'),
    child: lost ? tr('Сразу звоните 102 или 112: розыск ребёнка начинают немедленно. Заявку о несовершеннолетнем подаёт только законный представитель.', 'Call 102 or 112 right away: a search for a child starts immediately. Only a legal guardian can report a minor.')
      : tr('Оставайтесь с ребёнком в людном месте и позвоните 112. Не публикуйте фото ребёнка — модератор проверит заявку.', 'Stay with the child in a public place and call 112. Don’t post a photo of the child — a moderator will review the report.'),
    dog: tr('Номер чипа и клеймо не публикуются: по ним система находит точное совпадение. Ветклиника считает чип бесплатно.', 'The chip number and tattoo are not published: they let the system find an exact match. Vets scan chips for free.'),
    cat: tr('Номер чипа и клеймо не публикуются: по ним система находит точное совпадение. Кошки обычно прячутся рядом с домом — проверьте подвалы и подъезды.', 'The chip number and tattoo are not published: they give an exact match. Cats usually hide near home — check basements and stairwells.'),
    documents: lost ? tr('Не публикуйте серию и номер. ФИО владельца впишите в скрытое поле — его увидите только вы, а система сверит с находками.', 'Don’t publish the series and number. Enter the owner’s name in the hidden field — only you see it, and the system checks it against finds.')
      : tr('Не выкладывайте фото документа целиком. ФИО с документа впишите в скрытое поле — владелец найдётся по точному совпадению.', 'Don’t post a full photo of the document. Enter the name from it in the hidden field — the owner is found by an exact match.'),
    electronics: tr('IMEI или серийный номер — в скрытом поле: найдём точное совпадение, а посторонние его не увидят. IMEI есть на коробке и в чеке.', 'IMEI or serial number goes in the hidden field: it gives an exact match and strangers won’t see it. IMEI is on the box and the receipt.'),
    keys: tr('Опишите брелок и сколько ключей: по брелоку ключи узнают быстрее всего.', 'Describe the key ring and how many keys: the key ring is the fastest way to recognise them.'),
    bike: tr('Номер рамы — в скрытом поле: он выбит снизу каретки. По нему найдём точное совпадение.', 'The frame number goes in the hidden field: it is stamped under the bottom bracket. It gives an exact match.'),
    auto: tr('Госномер сверяется точно, с любой раскладкой: «А123ВС» и «A123BC» — одно и то же.', 'The plate is matched exactly in any script: Cyrillic and Latin look-alikes are treated the same.'),
    adult: lost ? tr('Звоните 102 или 112 сразу: ждать трое суток не нужно, заявление о пропаже принимают в любой момент. Опишите одежду и приложите свежее фото.', 'Call 102 or 112 right away: there is no need to wait three days. Describe the clothes and add a recent photo.')
      : tr('Если человеку нужна помощь — позвоните 112 и побудьте рядом. Опишите, где он сейчас и во что одет.', 'If the person needs help, call 112 and stay close. Describe where they are now and what they wear.'),
    pet_other: tr('Укажите вид и окрас. У птиц — кольцо на лапе и слова, которые она говорит: это скрытая примета для проверки владельца.', 'Give the species and colour. For birds — the leg ring and words it says: a hidden detail to verify the owner.'),
    accessories: tr('Цвет, материал и бренд — в описании. Что лежало внутри — в скрытой примете: по ней система проверит владельца.', 'Colour, material and brand go in the description. What was inside goes in the hidden detail — the system uses it to verify the owner.'),
    jewelry: tr('Металл и камни — в описании. Гравировку и пробу лучше оставить скрытой приметой: их знает только владелец.', 'Metal and stones go in the description. Keep the engraving and hallmark as a hidden detail — only the owner knows them.'),
    clothes: tr('Размер, цвет и бренд — в описании. Пятна, нашивки или что было в карманах — в скрытой примете.', 'Size, colour and brand go in the description. Stains, patches or pocket contents go in the hidden detail.'),
    things_other: tr('Опишите цвет, размер и особенности. Деталь, которую знает только владелец, впишите в скрытую примету на последнем шаге.', 'Describe the colour, size and features. Put a detail only the owner knows into the hidden detail on the last step.')
  };
  return H[code] || '';
}

/* =================== уникальные номера (не публикуются) =================== */
// поле → [подпись RU, EN, подсказка RU, EN]
const ID_LABEL = {
  chip: ['Номер чипа', 'Microchip number', '15 цифр, например 643094100123456', '15 digits, e.g. 643094100123456'],
  tattoo: ['Клеймо', 'Tattoo', 'Буквы и цифры на ухе или в паху', 'Letters and digits on the ear or groin'],
  serial: ['IMEI или серийный номер', 'IMEI or serial number', 'Можно последние 6+ знаков', 'The last 6+ characters will do'],
  doc_name: ['ФИО в документе', 'Name on the document', 'Иванов Иван Иванович', 'Ivan Ivanov']
};
export function idFieldsFor(category, thingType) {
  if (category === 'animals') return ['chip', 'tattoo'];
  if (category === 'things') return { electronics: ['serial'], bike: ['serial'], documents: ['doc_name'] }[thingType] || [];
  return [];
}
export const idsBox = (d, fields) => fields.length ? h`<div class="private-box">
  <div class="private-h">${icon('eyeOff')}<div><b>${tr('Видите только вы', 'Only you can see this')}</b><span>${tr('Не публикуется. Нужно для точного совпадения: одинаковый номер — та же вещь, разный — точно не она.', 'Not published. Used for an exact match: same number — same item, different — definitely not it.')}</span></div></div>
  <div class="grid-2">${fields.map((k) => h`<label class="field"><span>${d.category === 'things' && d.thing_type === 'bike' && k === 'serial' ? tr('Номер рамы', 'Frame number') : tr(ID_LABEL[k][0], ID_LABEL[k][1])}</span><input name="id_${k}" value="${(d.ids || {})[k] || d['id_' + k] || ''}" maxlength="${k === 'doc_name' ? 120 : 40}" autocomplete="off" placeholder="${tr(ID_LABEL[k][2], ID_LABEL[k][3])}"></label>`)}</div></div>` : '';
export const idName = (k) => (ID_LABEL[k] ? tr(ID_LABEL[k][0], ID_LABEL[k][1]) : k);

/* =================== страны =================== */
export const countries = () => state.config?.countries || [];
export const countryOf = (code) => countries().find((c) => c.code === code);
export const countryName = (code, fallback = '') => { const c = countryOf(code); return c ? tr(c.ru, c.en) : fallback || code; };
const NUM_LABEL = { all: ['Единый номер', 'Emergency'], police: ['Полиция', 'Police'], amb: ['Скорая', 'Ambulance'], tour: ['Туристическая полиция', 'Tourist police'] };
// Карточка «Что делать за границей»: местные экстренные номера, горячая линия МИД России, посольства
export function countryCard(code, name) {
  const c = countryOf(code), mfa = state.config?.mfa || {};
  const nums = c ? c.n : [['112', 'all']];
  return h`<div class="abroad-card">
    <div class="abroad-h">${icon('globe')}<div><b>${tr('Что делать', 'What to do')}: ${c ? tr(c.ru, c.en) : name || tr('за границей', 'abroad')}</b><span>${tr('Сначала — местная полиция, затем посольство или консульство России.', 'First the local police, then the Russian embassy or consulate.')}</span></div></div>
    <div class="abroad-nums">${nums.map(([n, k]) => h`<a class="abroad-num" href="tel:${n}"><small>${tr(...NUM_LABEL[k])}</small><b>${n}</b></a>`)}</div>
    ${mfa.phone ? h`<a class="abroad-row" href="tel:${mfa.phone.replace(/[^+\d]/g, '')}">${icon('phone')}<span class="grow"><b>${mfa.phone}</b><small>${tr('Горячая линия МИД России для граждан в беде — круглосуточно', 'Russian Foreign Ministry hotline for citizens in trouble — 24/7')}</small></span></a>` : ''}
    ${mfa.embassies ? h`<a class="abroad-row" href="${mfa.embassies}" target="_blank" rel="noopener">${icon('shield')}<span class="grow"><b>${tr('Посольства и консульства России', 'Russian embassies and consulates')}</b><small>${tr('Адреса и экстренные телефоны — на сайте консульского департамента МИД', 'Addresses and emergency phones on the consular department site')}</small></span>${icon('arrowUR', 'ic-sm')}</a>` : ''}
    <p class="xs muted">${tr('Номера могут меняться — уточните у отеля, гида или туроператора. С мобильного почти везде работает 112.', 'Numbers may change — check with your hotel, guide or tour operator. 112 works from mobiles almost everywhere.')}</p>
  </div>`;
}
export const countrySelect = (cur) => h`<select name="country"><option value="">${tr('Выберите страну', 'Choose a country')}</option>${countries().map((c) => h`<option value="${c.code}" ${cur === c.code ? 'selected' : ''}>${tr(c.ru, c.en)}</option>`)}${cur && !countryOf(cur) ? h`<option value="${cur}" selected>${cur}</option>` : ''}</select>`;

/* =================== цвета и отпечаток фото (в браузере, без внешних сервисов) =================== */
const loadImg = (src) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
function colorName(r, g, b) {
  const mx = Math.max(r, g, b) / 255, mn = Math.min(r, g, b) / 255, l = (mx + mn) / 2, dd = mx - mn;
  const s = dd === 0 ? 0 : dd / (1 - Math.abs(2 * l - 1));
  if (l < 0.16) return 'black';
  if (l > 0.86 && s < 0.3) return 'white';
  if (s < 0.14) return l > 0.7 ? 'white' : l < 0.28 ? 'black' : 'gray';
  let hh = 0; const R = r / 255, G = g / 255, B = b / 255;
  if (mx === R) hh = 60 * (((G - B) / dd) % 6); else if (mx === G) hh = 60 * ((B - R) / dd + 2); else hh = 60 * ((R - G) / dd + 4);
  if (hh < 0) hh += 360;
  if (hh < 15 || hh >= 345) return l < 0.3 ? 'brown' : 'red';
  if (hh < 42) return l < 0.38 ? 'brown' : s < 0.45 ? 'beige' : 'ginger';
  if (hh < 65) return s < 0.4 ? 'beige' : 'yellow';
  if (hh < 165) return 'green';
  if (hh < 255) return 'blue';
  if (hh < 290) return 'purple';
  return 'pink';
}
// Основные цвета первого фото (центр кадра, без фона по краям) и отпечатки всех фото (для поиска одинаковых снимков)
export async function photoMeta(urls) {
  const out = { photo_colors: [], photo_hash: [] };
  const c = document.createElement('canvas'), ctx = c.getContext('2d', { willReadFrequently: true });
  for (const [i, u] of (urls || []).slice(0, 5).entries()) {
    const img = await loadImg(u); if (!img || !img.naturalWidth) continue;
    try {
      c.width = 9; c.height = 8; ctx.drawImage(img, 0, 0, 9, 8);
      const p = ctx.getImageData(0, 0, 9, 8).data; let bits = '';
      // dHash: яркость соседних точек слева направо
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { const a = (y * 9 + x) * 4, b = a + 4; bits += (p[a] * .3 + p[a + 1] * .59 + p[a + 2] * .11) > (p[b] * .3 + p[b + 1] * .59 + p[b + 2] * .11) ? '1' : '0'; }
      out.photo_hash.push(bits.match(/.{4}/g).map((x) => parseInt(x, 2).toString(16)).join(''));
      if (i === 0) {
        const W = img.naturalWidth, H = img.naturalHeight;
        c.width = 24; c.height = 24; ctx.drawImage(img, W * .2, H * .2, W * .6, H * .6, 0, 0, 24, 24);
        const q = ctx.getImageData(0, 0, 24, 24).data, cnt = {};
        for (let k = 0; k < q.length; k += 4) { const n = colorName(q[k], q[k + 1], q[k + 2]); cnt[n] = (cnt[n] || 0) + 1; }
        out.photo_colors = Object.entries(cnt).filter(([, v]) => v / 576 >= 0.2).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k]) => k);
      }
    } catch (e) { /* фото с другого сайта — пропускаем */ }
  }
  return out;
}

/* =================== объяснение совпадения =================== */
const COLOR = { black: ['чёрный', 'black'], white: ['белый', 'white'], gray: ['серый', 'grey'], ginger: ['рыжий', 'ginger'], orange: ['оранжевый', 'orange'], red: ['красный', 'red'], yellow: ['жёлтый', 'yellow'],
  green: ['зелёный', 'green'], blue: ['синий', 'blue'], purple: ['фиолетовый', 'purple'], pink: ['розовый', 'pink'], brown: ['коричневый', 'brown'], beige: ['бежевый', 'beige'], gold: ['золотистый', 'golden'] };
const GARM = { jacket: ['куртка', 'jacket'], coat: ['пальто', 'coat'], sweater: ['кофта', 'sweater'], shirt: ['рубашка', 'shirt'], vest: ['жилет', 'vest'], trousers: ['брюки', 'trousers'], skirt: ['юбка', 'skirt'],
  dress: ['платье', 'dress'], shorts: ['шорты', 'shorts'], hat: ['головной убор', 'headwear'], shoes: ['обувь', 'shoes'], scarf: ['шарф', 'scarf'], collar: ['ошейник', 'collar'], harness: ['шлейка', 'harness'] };
const PATTERN = { tabby: ['полосатый', 'tabby'], spotted: ['пятнистый', 'spotted'], tricolor: ['трёхцветный', 'tricolour'] };
const cName = (c) => tr(...(COLOR[c] || [c, c]));
const ID_HIT = { chip: ['Совпал номер чипа', 'Chip number matches'], tattoo: ['Совпало клеймо', 'Tattoo matches'], serial: ['Совпал серийный номер', 'Serial number matches'],
  doc_name: ['Совпали ФИО в документе', 'Name on the document matches'], plate: ['Совпал госномер', 'Licence plate matches'] };
// [текст, тип]: ok — сильная примета, warn — отличие
export function reasonText(r) {
  const v = r.v;
  switch (r.k) {
    case 'id': return [tr(...(ID_HIT[v] || ['Совпал номер', 'Number matches'])), 'ok'];
    case 'secret': return [tr('Совпала скрытая примета', 'Hidden detail matches'), 'ok'];
    case 'same_photo': return [tr('Одинаковое фото', 'Same photo'), 'ok'];
    case 'color': return [tr('Цвет', 'Colour') + ': ' + v.map(cName).join(', '), ''];
    case 'photo_colors': return [tr('Похожие цвета на фото', 'Similar colours in photos'), ''];
    case 'pattern': return [tr('Окрас', 'Coat') + ': ' + v.map((x) => tr(...(PATTERN[x] || [x, x]))).join(', '), ''];
    case 'breed': return [tr('Порода совпала', 'Same breed'), 'ok'];
    case 'collar': case 'clothes': return [v.map(([g, c]) => `${tr(...(GARM[g] || [g, g]))}, ${cName(c)}`).join('; '), ''];
    case 'age': return [tr('Возраст близкий', 'Similar age'), ''];
    case 'height': return [tr('Рост совпадает', 'Same height'), ''];
    case 'hair': return [tr('Цвет волос', 'Hair colour'), ''];
    case 'health': return [tr('Особенности здоровья', 'Health details'), ''];
    case 'brand': return [tr('Бренд', 'Brand') + ': ' + v, 'ok'];
    case 'model': return [tr('Модель', 'Model') + ': ' + v, ''];
    case 'doc_kind': return [tr('Документ', 'Document') + ': ' + v, ''];
    case 'engraving': return [tr('Гравировка совпала', 'Engraving matches'), 'ok'];
    case 'words': return [tr('Общие приметы', 'Shared details') + ': ' + v.join(', '), ''];
    case 'dist': return [v < 1 ? tr('Рядом', 'Nearby') + ' · ' + km(v) : km(v) + ' ' + tr('друг от друга', 'apart'), ''];
    case 'city': return [tr('Тот же город', 'Same city'), ''];
    case 'days': return [v === 0 ? tr('В тот же день', 'Same day') : tr(`Через ${v} ${plural(v, 'день', 'дня', 'дней')}`, `${v} ${v === 1 ? 'day' : 'days'} later`), ''];
    case 'color_diff': return [tr('Цвет отличается', 'Different colour'), 'warn'];
    case 'breed_diff': return [tr('Порода отличается', 'Different breed'), 'warn'];
    case 'height_diff': return [tr('Рост отличается', 'Different height'), 'warn'];
    default: return null;
  }
}
export const reasonChips = (list) => h`<ul class="why">${(list || []).map(reasonText).filter(Boolean).map(([txt, cls]) => h`<li class="${cls}">${cls === 'ok' ? icon('check', 'ic-sm') : cls === 'warn' ? icon('alert', 'ic-sm') : ''}${txt}</li>`)}</ul>`;

// Совпадения на странице заявки (для автора): карточка, причины, «Это оно» / «Не то»
export function matchSection(a) {
  if (!a.is_owner || !a.matches) return '';
  const strong = a.matches.filter((m) => !m.weak), weak = a.matches.filter((m) => m.weak);
  const card = (m, i) => h`<div class="mcard ${m.weak ? 'weak' : ''}" data-m="${m.match_id}">
    ${appCard(m, i, { score: m.score })}
    <div class="mcard-body">
      ${m.weak ? h`<span class="chip chip-weak">${tr('Возможно', 'Possible')}</span>` : ''}
      ${reasonChips(m.reasons)}
      ${m.their_vote === 'yes' ? h`<p class="xs mcard-their">${icon('check', 'ic-sm')}${a.kind === 'lost' ? tr('Нашедший считает, что это ваше', 'The finder thinks this is yours') : tr('Владелец узнал свою пропажу', 'The owner recognised it')}</p>` : ''}
      ${m.my_vote === 'yes' ? h`<div class="mcard-act"><span class="chip chip-ok">${icon('check')}${tr('Вы отметили: это оно', 'You marked: this is it')}</span>${m.status === 'published' ? h`<button type="button" class="btn btn-sm" data-chat="${m.id}">${icon('chat')}${tr('Написать', 'Message')}</button>` : ''}<button type="button" class="link xs" data-reset="${m.match_id}">${tr('Отменить', 'Undo')}</button></div>`
        : h`<div class="mcard-act"><button type="button" class="btn btn-sm btn-blue" data-yes="${m.match_id}" data-app="${m.id}" data-st="${m.status}">${icon('check')}${tr('Это оно', 'This is it')}</button><button type="button" class="btn btn-sm btn-ghost" data-no="${m.match_id}">${icon('x')}${tr('Не то', 'Not it')}</button></div>`}
    </div></div>`;
  return h`<div id="matchSec"><div class="sec-head" style="margin-bottom:12px"><h3>${t('a.matches', 'Возможные совпадения', 'Possible matches')}</h3><span class="chip">${strong.length}</span></div>
    <p class="small muted" style="margin:-4px 0 14px">${tr('Подбираем по приметам, номерам, месту и времени. Отметьте «Это оно» — второй стороне придёт уведомление, — или «Не то», и пара скроется.', 'We match by details, numbers, place and time. Mark “This is it” to notify the other side, or “Not it” to hide the pair.')}</p>
    ${strong.length ? h`<div class="mgrid">${strong.map(card)}</div>` : h`<div class="empty">${icon('match')}<b>${t('a.no_matches', 'Совпадений пока нет', 'No matches yet')}</b>${tr('Проверяем новые заявки сразу и каждые 6 часов — с каждым днём радиус поиска растёт.', 'We check new reports right away and every 6 hours — the search radius grows every day.')}</div>`}
    ${weak.length ? h`<h4 class="m-weak-h">${tr('Менее похожие', 'Less similar')} · ${weak.length}</h4><div class="mgrid">${weak.map((m, i) => card(m, i + strong.length))}</div>` : ''}
    ${a.weak_hidden ? h`<a class="upsell" href="#/tariffs">${icon('zap')}<span class="grow"><b>${tr(`Ещё ${a.weak_hidden} ${plural(a.weak_hidden, 'менее похожая заявка', 'менее похожие заявки', 'менее похожих заявок')}`, `${a.weak_hidden} more less-similar ${a.weak_hidden === 1 ? 'report' : 'reports'}`)}</b><small>${tr('С меньшим числом общих примет или дальше обычного радиуса — в тарифе «Расширенный поиск»', 'Fewer shared details or beyond the usual radius — in the Extended search plan')}</small></span>${icon('chevR')}</a>` : ''}
  </div>`;
}
export function bindMatches(view, a) {
  const box = $('#matchSec', view); if (!box) return;
  const vote = (id, v) => POST(`/matches/${id}/vote`, { vote: v });
  box.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.yes) busy(b, async () => {
      try {
        await vote(b.dataset.yes, 'yes');
        toast(tr('Отмечено: это оно. Вторая сторона получила уведомление', 'Marked. The other side has been notified'));
        if (b.dataset.st === 'published') { const r = await POST(`/applications/${b.dataset.app}/chat`); go('#/chat/' + r.id); } else go(location.hash);
      } catch (er) { toastErr(er); }
    });
    if (b.dataset.no) busy(b, async () => { try { await vote(b.dataset.no, 'no'); b.closest('.mcard').remove(); toast(tr('Пара скрыта и больше не появится', 'Hidden — it won’t show again')); } catch (er) { toastErr(er); } });
    if (b.dataset.reset) busy(b, async () => { try { await vote(b.dataset.reset, ''); go(location.hash); } catch (er) { toastErr(er); } });
    if (b.dataset.chat) busy(b, async () => { try { const r = await POST(`/applications/${b.dataset.chat}/chat`); go('#/chat/' + r.id); } catch (er) { toastErr(er); } });
  });
}

/* =================== «Мои близкие» =================== */
const ageOf = (y) => (y ? new Date().getFullYear() - y : null);
const wardKind = (w) => (w.kind === 'pet' ? (w.species || tr('Питомец', 'Pet')) : w.relation === 'legal_rep' ? tr('Подопечный', 'Ward') : tr('Родственник', 'Relative'));
const wardPh = (w, cls = '') => (w.photos && w.photos[0] ? h`<img src="${w.photos[0]}" alt="" loading="lazy">` : mediaPh(w.kind === 'pet' ? 'animals' : 'people', cls));
export async function meWards(el) {
  const { items, max } = await GET('/wards');
  mount(el, h`<div class="stack-lg">
    <div><h2>${tr('Мои близкие', 'My loved ones')}</h2><p class="muted" style="margin-top:8px">${tr('Заполните карточку заранее — для пожилого родственника, человека с деменцией, ребёнка или питомца. Если человек или питомец потеряется, заявка соберётся из карточки за минуту, а QR-код на браслете или ошейнике поможет нашедшему связаться с вами.', 'Fill in a card in advance — for an elderly relative, a person with dementia, a child or a pet. If they get lost, a report is built from the card in a minute, and the QR code on a bracelet or collar lets the finder reach you.')}</p></div>
    ${items.length ? h`<div class="wards">${items.map((w) => h`<article class="ward card">
      <a class="ward-ph" href="#/ward/${w.id}">${wardPh(w)}</a>
      <div class="ward-b">
        <a class="ward-name" href="#/ward/${w.id}"><b>${w.name}</b><span class="xs muted">${wardKind(w)}${ageOf(w.birth_year) != null ? ` · ${ageOf(w.birth_year)} ${tr(plural(ageOf(w.birth_year), 'год', 'года', 'лет'), 'y.o.')}` : ''}${w.family ? ' · ' + tr('семейная', 'family') : ''}</span></a>
        ${w.active_app ? h`<a class="chip chip-em" href="#/a/${w.active_app.id}">${icon('siren')}${tr('Сейчас в поиске', 'Being searched for')}</a>` : ''}
        ${w.alerts.length ? h`<span class="chip chip-warn">${icon('qr')}${tr('Сообщения по QR', 'QR messages')}: ${w.alerts.length}</span>` : ''}
        <div class="ward-act">
          ${w.active_app ? h`<a class="btn btn-sm" href="#/a/${w.active_app.id}">${tr('Открыть заявку', 'Open report')}</a>` : h`<a class="btn btn-sm btn-red" href="#/new/lost?ward=${w.id}">${icon('siren')}${tr('Пропал', 'Missing')}</a>`}
          <a class="btn btn-sm btn-ghost" href="#/ward/${w.id}">${icon('qr')}${tr('QR-код', 'QR code')}</a>
          <a class="btn btn-sm btn-ghost" href="#/ward/${w.id}/edit">${icon('edit')}<span class="sr-only">${tr('Изменить', 'Edit')}</span></a>
        </div>
      </div></article>`)}</div>` : h`<div class="ward-empty card pad">
        <ul class="fam-pros">
          <li><span class="fam-pro-ic">${icon('siren')}</span><div><b>${tr('Заявка за минуту', 'A report in a minute')}</b><span>${tr('Фото, приметы и особенности уже заполнены — в стрессе не нужно ничего вспоминать.', 'Photos, features and health notes are already filled in — nothing to recall under stress.')}</span></div></li>
          <li><span class="fam-pro-ic">${icon('qr')}</span><div><b>${tr('QR-код для браслета и ошейника', 'A QR code for a bracelet or collar')}</b><span>${tr('Нашедший сканирует код телефоном и сообщает вам, где человек, — без регистрации.', 'The finder scans it with a phone and tells you where they are — no sign-up.')}</span></div></li>
          <li><span class="fam-pro-ic">${icon('lock')}</span><div><b>${tr('Видите только вы и семья', 'Only you and your family see it')}</b><span>${tr('На странице QR — только то, что вы разрешили показать.', 'The QR page shows only what you allow.')}</span></div></li>
        </ul></div>`}
    ${items.length < max ? h`<div class="row-wrap"><a class="btn" href="#/ward/new?kind=person">${icon('plus')}${tr('Добавить человека', 'Add a person')}</a><a class="btn btn-ghost" href="#/ward/new?kind=pet">${icon('paw')}${tr('Добавить питомца', 'Add a pet')}</a></div>` : h`<p class="small muted">${tr('Добавлено максимум карточек', 'Maximum number of cards reached')}: ${max}</p>`}
  </div>`);
}

// Текст для страницы QR по умолчанию: коротко и по делу
function defaultNote(d) {
  if (d.kind === 'pet') return tr(`Меня зовут ${d.name || '…'}. Я потерялся. Пожалуйста, нажмите «Сообщить хозяевам» — они быстро приедут.`, `My name is ${d.name || '…'}. I am lost. Please tap “Tell my owners” — they will come quickly.`);
  const parts = [tr(`Меня зовут ${d.name || '…'}.`, `My name is ${d.name || '…'}.`)];
  if (d.h_dementia) parts.push(tr('Я могу не помнить свой адрес и имя.', 'I may not remember my address or name.'));
  if (d.h_deaf) parts.push(tr('Я плохо слышу — пишите или говорите громко.', 'I am hard of hearing — please write or speak loudly.'));
  parts.push(tr('Пожалуйста, побудьте со мной и сообщите родным.', 'Please stay with me and tell my family.'));
  return parts.join(' ');
}
async function wardEditor(view, id) {
  const isNew = id === 'new';
  const w = isNew ? { kind: query().get('kind') === 'pet' ? 'pet' : 'person', photos: [], details: {}, ids: {}, qr_on: true, contact: state.user.phone || state.user.email || '' } : (await GET('/wards/' + id)).item;
  const person = w.kind === 'person', dt = w.details || {};
  const d = Object.assign({}, w, dt); for (const x of dt.health || []) d['h_' + x] = true;
  const sel = (name) => h`<select name="${name}"><option value="">${tr('Выберите', 'Choose')}</option>${Object.keys(OPT[name]).map((v) => h`<option value="${v}" ${d[name] === v ? 'selected' : ''}>${optName(name, v)}</option>`)}</select>`;
  const inp = (name, max, ph = '', type = 'text') => h`<input name="${name}" type="${type}" value="${d[name] ?? ''}" maxlength="${max}" placeholder="${ph}" autocomplete="off">`;
  mount(view, h`<div class="wrap" style="max-width:820px;padding-top:16px">
    <a class="back" href="${isNew ? '#/me/wards' : '#/ward/' + w.id}">${icon('arrowL', 'ic-sm')}${tr('Назад', 'Back')}</a>
    <h1 style="margin:10px 0 6px">${isNew ? (person ? tr('Карточка близкого человека', 'Loved one’s card') : tr('Карточка питомца', 'Pet card')) : tr('Изменить карточку', 'Edit card')}</h1>
    <p class="muted">${tr('Заполните то, что знаете. Карточку видите только вы и ваш семейный аккаунт.', 'Fill in what you know. Only you and your family account see the card.')}</p>
    <form id="wf" class="stack" style="margin-top:20px">
      <section class="card pad stack"><h3>${tr('Кто это', 'Who')}</h3>
        <div class="grid-2">
          <label class="field"><span>${person ? tr('Имя и отчество (или ФИО)', 'Name') : tr('Кличка', 'Name')} <em>*</em></span>${inp('name', 80, person ? tr('Мария Ивановна', 'Maria') : tr('Буся', 'Busya'))}</label>
          ${person ? h`<label class="field"><span>${tr('Кем вы приходитесь', 'Your relation')} <em>*</em></span><select name="relation"><option value="">${tr('Выберите', 'Choose')}</option><option value="relative" ${d.relation === 'relative' ? 'selected' : ''}>${tr('Родственник', 'Relative')}</option><option value="legal_rep" ${d.relation === 'legal_rep' ? 'selected' : ''}>${tr('Законный представитель, опекун', 'Legal representative, guardian')}</option></select></label>`
          : h`<label class="field"><span>${tr('Вид животного', 'Species')}</span><select name="species"><option value="">${tr('Выберите', 'Choose')}</option>${dict('species').map((v) => h`<option ${d.species === v ? 'selected' : ''}>${v}</option>`)}</select></label>`}
          <label class="field"><span>${tr('Год рождения', 'Year of birth')}</span>${inp('birth_year', 4, '', 'number')}</label>
          ${person ? h`<label class="field"><span>${t('wiz.sex', 'Пол', 'Sex')}</span>${sel('sex')}</label>` : h`<label class="field"><span>${t('wiz.breed', 'Порода', 'Breed')}</span>${inp('breed', 80)}</label>`}
          ${!person ? h`<label class="field"><span>${t('wiz.color', 'Окрас', 'Colour')}</span>${inp('color', 80, tr('Рыжий с белым', 'Ginger and white'))}</label><label class="field"><span>${tr('Ошейник, шлейка', 'Collar, harness')}</span>${inp('clothes', 150, tr('Красный ошейник с адресником', 'Red collar with a tag'))}</label>` : ''}
        </div>
        <div class="field"><span>${tr('Фото (до 5)', 'Photos (up to 5)')}</span><div id="wph"></div><p class="hint">${tr('Свежие фото в полный рост и лица — по ним узнают на улице.', 'Recent full-length and face photos help people recognise them.')}</p></div>
      </section>
      ${person ? h`<section class="card pad stack"><h3>${t('wiz.looks', 'Приметы', 'Appearance')}</h3>
        <div class="grid-pair">
          <label class="field"><span>${t('wiz.height', 'Рост, см', 'Height, cm')}</span>${inp('height', 3, '', 'number')}</label>
          <label class="field"><span>${t('wiz.build', 'Телосложение', 'Build')}</span>${sel('build')}</label>
          <label class="field"><span>${t('wiz.hair_color', 'Цвет волос', 'Hair colour')}</span>${sel('hair_color')}</label>
          <label class="field"><span>${t('wiz.eye_color', 'Цвет глаз', 'Eye colour')}</span>${sel('eye_color')}</label>
        </div>
        <label class="field"><span>${t('wiz.marks', 'Особые приметы', 'Distinguishing marks')}</span><textarea name="features" rows="3" maxlength="1000" placeholder="${tr('Шрамы, родинки, очки, трость, походка', 'Scars, moles, glasses, a cane, gait')}">${d.features || ''}</textarea></label>
        <fieldset class="chk-grid"><legend>${t('wiz.health', 'Состояние', 'Condition')}</legend>${Object.keys(OPT.health).map((x) => h`<label class="check"><input type="checkbox" name="h_${x}" ${d['h_' + x] ? 'checked' : ''}> <span>${optName('health', x)}</span></label>`)}</fieldset>
        <div class="grid-2">
          <label class="field"><span>${t('wiz.health_more', 'Что важно знать при встрече', 'What to know when you meet')}</span>${inp('health_note', 200, tr('Нужен приём лекарств в 18:00', 'Needs medication at 6 pm'))}</label>
          <label class="field"><span>${t('wiz.language', 'Язык общения', 'Language')}</span>${inp('language', 80, tr('Русский', 'Russian'))}</label>
        </div>
      </section>` : h`<section class="card pad stack"><h3>${t('wiz.marks', 'Особые приметы', 'Distinguishing marks')}</h3>
        <label class="field"><span>${tr('Приметы и характер', 'Features and temper')}</span><textarea name="features" rows="3" maxlength="1000" placeholder="${tr('Купированный хвост, боится громких звуков, откликается на кличку', 'Docked tail, scared of loud noises, responds to name')}">${d.features || ''}</textarea></label>
        ${idsBox({ category: 'animals', ids: w.ids }, ['chip', 'tattoo'])}
      </section>`}
      <section class="card pad stack"><h3>${tr('Где искать и как связаться', 'Where to look and how to reach you')}</h3>
        <div class="grid-2">
          <label class="field"><span>${t('wiz.city', 'Город', 'City')}</span>${inp('home_city', 80, state.user.city || '')}</label>
          <label class="field"><span>${tr('Контакт для связи', 'Contact')} <em>*</em></span>${inp('contact', 120)}</label>
        </div>
        <label class="field"><span>${tr('Где обычно бывает', 'Usual places')}</span><textarea name="places" rows="2" maxlength="300" placeholder="${tr('Парк у дома, рынок на Ленина, дача в Берёзовском, маршрут 25', 'The park near home, the market, the country house, bus 25')}">${d.places || ''}</textarea><p class="hint">${tr('Попадёт в заявку, если человек пропадёт: так искать быстрее.', 'Goes into the report if they go missing: it speeds up the search.')}</p></label>
        ${state.user.family_id ? h`<label class="check"><input type="checkbox" name="family" ${w.family ? 'checked' : ''}> <span>${tr('Семейная карточка — её видят и могут изменять члены семьи, им же приходят сообщения по QR', 'Family card — family members can view and edit it and get QR messages')}</span></label>` : ''}
      </section>
      <section class="card pad stack"><h3>${icon('qr')} ${tr('Страница QR-кода', 'QR code page')}</h3>
        <p class="small muted">${tr('Её видит любой, кто отсканирует код на браслете, бирке или ошейнике. Покажем только то, что вы отметили.', 'Anyone who scans the code on a bracelet, tag or collar sees it. We show only what you tick.')}</p>
        <label class="check"><input type="checkbox" name="qr_on" ${w.qr_on !== false ? 'checked' : ''}> <span>${tr('QR-код включён', 'QR code is on')}</span></label>
        <label class="check"><input type="checkbox" name="qr_photo" ${w.qr_photo ? 'checked' : ''}> <span>${tr('Показывать первое фото', 'Show the first photo')}</span></label>
        <label class="check"><input type="checkbox" name="qr_phone" ${w.qr_phone ? 'checked' : ''}> <span>${tr('Показывать контакт для связи — нашедший сможет сразу позвонить', 'Show the contact — the finder can call right away')}</span></label>
        <label class="field"><span>${tr('Текст для нашедшего', 'Message to the finder')}</span><textarea name="qr_note" rows="3" maxlength="300">${w.qr_note || defaultNote(d)}</textarea><p class="hint">${tr('Без адреса и диагнозов: только то, что поможет помочь.', 'No address or diagnoses: only what helps.')}</p></label>
      </section>
      ${isNew && person ? h`<label class="check"><input type="checkbox" name="consent"> <span>${tr('Я родственник или законный представитель этого человека и даю согласие на обработку его данных, включая сведения о здоровье, чтобы помочь найти его, если он потеряется.', 'I am a relative or legal representative of this person and consent to processing their data, including health details, to help find them if they get lost.')}</span></label>` : ''}
      <div class="row-wrap"><button class="btn btn-lg">${icon('check')}${isNew ? tr('Сохранить карточку', 'Save card') : tr('Сохранить изменения', 'Save changes')}</button>
        ${!isNew ? h`<button type="button" class="btn btn-ghost" id="wdel" style="color:var(--red)">${icon('trash')}${tr('Удалить карточку', 'Delete card')}</button>` : ''}</div>
    </form></div>`);
  const getPhotos = photoField($('#wph', view), w.photos || [], 5);
  const nameEl = $('[name=name]', view), noteEl = $('[name=qr_note]', view);
  let noteAuto = !w.qr_note;
  noteEl.addEventListener('input', () => { noteAuto = false; });
  const refreshNote = () => { if (noteAuto) noteEl.value = defaultNote(Object.assign({ kind: w.kind }, formData($('#wf', view)))); };
  nameEl.addEventListener('input', refreshNote); $$('[name^=h_]', view).forEach((x) => x.addEventListener('change', refreshNote));
  $('#wf', view).onsubmit = (e) => {
    e.preventDefault();
    const f = formData(e.target);
    const det = person
      ? Object.fromEntries(['height', 'build', 'hair_color', 'eye_color', 'health_note', 'language'].map((k) => [k, f[k] ?? '']).concat([['health', Object.keys(OPT.health).filter((x) => f['h_' + x])]]))
      : { breed: f.breed || '', color: f.color || '', clothes: f.clothes || '' };
    const body = {
      kind: w.kind, name: f.name, relation: f.relation, species: f.species, birth_year: f.birth_year, sex: f.sex, details: det, features: f.features,
      ids: { chip: f.id_chip || '', tattoo: f.id_tattoo || '' }, photos: getPhotos(), home_city: f.home_city, places: f.places, contact: f.contact,
      family: !!f.family, qr_on: !!f.qr_on, qr_photo: !!f.qr_photo, qr_phone: !!f.qr_phone, qr_note: f.qr_note, consent: !!f.consent
    };
    busy(e.submitter, async () => {
      try { const r = isNew ? await POST('/wards', body) : await PATCH('/wards/' + w.id, body); toast(tr('Карточка сохранена', 'Card saved')); go('#/ward/' + r.item.id); } catch (er) { toastErr(er); }
    });
  };
  const del = $('#wdel', view);
  if (del) del.onclick = async () => {
    if (!(await confirmBox(tr('Удалить карточку?', 'Delete the card?'), tr('QR-код перестанет работать, сообщения по нему удалятся.', 'The QR code will stop working and its messages will be deleted.'), { ok: tr('Удалить', 'Delete'), danger: true }))) return;
    try { await DEL('/wards/' + w.id); toast(tr('Карточка удалена', 'Card deleted')); go('#/me/wards'); } catch (er) { toastErr(er); }
  };
}
async function wardView(view, id) {
  const { item: w } = await GET('/wards/' + id);
  document.title = `${w.name} — ${tr('Мои близкие', 'My loved ones')}`;
  const dt = w.details || {};
  const facts = [];
  if (w.kind === 'pet') { if (w.species) facts.push([t('wiz.species', 'Вид животного', 'Species'), w.species]); if (dt.breed) facts.push([t('wiz.breed', 'Порода', 'Breed'), dt.breed]); if (dt.color) facts.push([t('wiz.color', 'Окрас', 'Colour'), dt.color]); }
  else { if (w.sex) facts.push([t('wiz.sex', 'Пол', 'Sex'), optName('sex', w.sex)]); if (dt.height) facts.push([t('wiz.height', 'Рост, см', 'Height, cm'), dt.height]); if (dt.health && dt.health.length) facts.push([t('wiz.health', 'Состояние', 'Condition'), dt.health.map((x) => optName('health', x)).join(', ')]); }
  if (ageOf(w.birth_year) != null) facts.push([tr('Возраст', 'Age'), ageOf(w.birth_year)]);
  if (w.home_city) facts.push([t('wiz.city', 'Город', 'City'), w.home_city]);
  for (const [k, v] of Object.entries(w.ids || {})) facts.push([h`${icon('eyeOff', 'ic-sm')} ${idName(k)}`, v]);
  mount(view, h`<div class="wrap" style="max-width:980px;padding-top:16px">
    <a class="back" href="#/me/wards">${icon('arrowL', 'ic-sm')}${tr('Мои близкие', 'My loved ones')}</a>
    <div class="ward-page">
      <div class="stack-lg">
        <div class="ward-hero card">
          <div class="ward-hero-ph">${wardPh(w)}</div>
          <div class="ward-hero-b"><h1>${w.name}</h1><p class="muted">${wardKind(w)}${w.family ? ' · ' + tr('семейная карточка', 'family card') : ''}</p>
            ${w.active_app ? h`<a class="btn btn-lg btn-block" href="#/a/${w.active_app.id}">${icon('siren')}${tr('Открыть заявку о пропаже', 'Open the missing report')}</a>`
              : h`<a class="btn btn-red btn-lg btn-block btn-urgent" href="#/new/lost?ward=${w.id}">${icon('siren')}${w.kind === 'pet' ? tr('Питомец пропал — подать заявку', 'My pet is missing — file a report') : tr('Человек пропал — подать заявку', 'Missing — file a report')}</a>`}
            <p class="xs muted">${tr('Все данные из карточки подставятся в заявку — останется указать место и одежду.', 'Everything from the card goes into the report — just add the place and clothes.')}</p>
          </div>
        </div>
        ${facts.length ? h`<div class="card pad"><dl class="kv">${facts.map(([k, v]) => h`<div><dt>${k}</dt><dd>${v}</dd></div>`)}</dl></div>` : ''}
        <section><h3 style="margin-bottom:10px">${tr('Сообщения нашедших', 'Messages from finders')}</h3>
          ${w.alerts.length ? h`<div class="list">${w.alerts.map((x) => h`<div class="alert-row"><span class="t-ic">${icon('qr')}</span><div class="grow"><b>${x.message || tr('Нашедший отправил место', 'The finder sent a location')}</b>
            <div class="xs muted">${fmtDate(x.created_at, true)}${x.contact ? ' · ' + tr('контакт', 'contact') + ': ' + x.contact : ''}</div></div>
            ${x.lat != null ? h`<button type="button" class="btn btn-sm btn-ghost" data-lat="${x.lat}" data-lng="${x.lng}">${icon('pin')}${tr('На карте', 'Map')}</button>` : ''}</div>`)}</div>`
          : h`<p class="small muted">${tr('Пока сообщений нет. Когда кто-то отсканирует QR-код и напишет вам, сообщение появится здесь и придёт уведомлением.', 'No messages yet. When someone scans the QR code and writes, it appears here and as a notification.')}</p>`}
        </section>
      </div>
      <aside class="card pad stack ward-qr">
        <h3>${icon('qr')} ${tr('QR-код', 'QR code')}</h3>
        ${w.qr_on ? h`<img class="qr-img" src="/api/wards/${w.id}/qr.svg?t=${encodeURIComponent(w.qr_url.slice(-6))}" alt="${tr('QR-код карточки', 'Card QR code')}" width="220" height="220">
          <p class="xs muted center">${tr('Нашедший отсканирует код камерой телефона — откроется страница, где он может сообщить вам, где человек.', 'The finder scans it with a phone camera and can tell you where they are.')}</p>
          <a class="btn btn-block" href="#/ward/${w.id}/print">${icon('printer')}${tr('Распечатать бирку и карточку', 'Print a tag and a card')}</a>
          <a class="btn btn-ghost btn-block" href="${w.qr_url}" target="_blank" rel="noopener">${icon('eye')}${tr('Как видит нашедший', 'See it as a finder')}</a>
          <button type="button" class="link xs" id="qrReset">${icon('refresh', 'ic-sm')}${tr('Выдать новый код (старый перестанет работать)', 'Issue a new code (the old one stops working)')}</button>`
        : h`<p class="small muted">${tr('QR-код выключен в настройках карточки.', 'The QR code is turned off in the card settings.')}</p>`}
        <a class="btn btn-ghost btn-block" href="#/ward/${w.id}/edit">${icon('edit')}${tr('Изменить карточку', 'Edit card')}</a>
      </aside>
    </div></div>`);
  $$('[data-lat]', view).forEach((b) => b.onclick = () => {
    const s = sheet(h`${sheetHead(tr('Где нашедший', 'Finder’s location'))}<div class="mini-map" style="height:340px" id="am"></div>`);
    const mm = makeMap($('#am', s.el), { center: [+b.dataset.lat, +b.dataset.lng], zoom: 16 });
    mm.lib.marker([+b.dataset.lat, +b.dataset.lng], { icon: pinIcon({ kind: 'found', category: w.kind === 'pet' ? 'animals' : 'people' }) }).addTo(mm);
  });
  const rs = $('#qrReset', view);
  if (rs) rs.onclick = async () => {
    if (!(await confirmBox(tr('Выдать новый QR-код?', 'Issue a new QR code?'), tr('Старый код на браслете или бирке перестанет работать — распечатайте новый.', 'The old code on the bracelet or tag will stop working — print a new one.'), { ok: tr('Выдать новый', 'Issue new') }))) return;
    try { await POST(`/wards/${w.id}/qr/reset`); toast(tr('Новый QR-код готов', 'New QR code is ready')); go(location.hash); } catch (er) { toastErr(er); }
  };
}
route('/ward/:id', (view, p) => (p.id === 'new' ? wardEditor(view, 'new') : wardView(view, p.id)), { auth: true });
route('/ward/:id/edit', (view, p) => wardEditor(view, p.id), { auth: true });
// Печать: бирка-кругляш для ошейника/брелока, карточка в кошелёк, наклейка на браслет
route('/ward/:id/print', async (view, p) => {
  const { item: w } = await GET('/wards/' + p.id);
  const qr = `/api/wards/${w.id}/qr.svg?t=${encodeURIComponent(w.qr_url.slice(-6))}`;
  const line = w.kind === 'pet' ? tr('Я потерялся. Отсканируйте — хозяева приедут', 'I am lost. Scan me — my owners will come') : tr('Если я потерялся — отсканируйте код', 'If I am lost — scan this code');
  mount(view, h`<div class="wrap print-page">
    <div class="no-print row between" style="padding:16px 0"><a class="back" href="#/ward/${w.id}">${icon('arrowL', 'ic-sm')}${tr('Назад', 'Back')}</a><button class="btn" id="pr">${icon('printer')}${tr('Печать', 'Print')}</button></div>
    <p class="no-print small muted">${tr('Вырежьте по контуру. Карточку положите в кошелёк или карман, бирку — в адресник или ламинируйте. Код читается с расстояния 20–30 см.', 'Cut along the outline. Put the card in a wallet or pocket and the tag into a collar tag holder or laminate it. The code reads at 20–30 cm.')}</p>
    <div class="print-sheet">
      <div class="p-card"><img src="${qr}" alt=""><div><b>${line}</b><span>${w.kind === 'pet' ? w.name : tr('Меня зовут', 'My name is') + ' ' + w.name}</span><small>my-bestagent.ru</small></div></div>
      <div class="p-card"><img src="${qr}" alt=""><div><b>${line}</b><span>${w.kind === 'pet' ? w.name : tr('Меня зовут', 'My name is') + ' ' + w.name}</span><small>my-bestagent.ru</small></div></div>
      <div class="p-tag"><img src="${qr}" alt=""><small>${tr('Отсканируйте', 'Scan me')}</small></div>
      <div class="p-tag"><img src="${qr}" alt=""><small>${tr('Отсканируйте', 'Scan me')}</small></div>
      <div class="p-band"><img src="${qr}" alt=""><b>${line}</b></div>
    </div></div>`);
  $('#pr', view).onclick = () => window.print();
}, { auth: true });

/* =================== страница QR для нашедшего (без входа) =================== */
route('/w/:token', async (view, p) => {
  const w = await GET('/w/' + encodeURIComponent(p.token));
  const pet = w.kind === 'pet';
  document.title = pet ? tr('Найден питомец', 'Found a pet') : tr('Нужна помощь', 'Help needed');
  let pos = null;
  mount(view, h`<div class="wrap qr-page">
    <div class="card qr-card">
      <div class="qr-top">${icon(pet ? 'paw' : 'heart', 'ic-lg')}<div><h1>${pet ? tr('Вы нашли питомца', 'You found a pet') : tr('Этому человеку может понадобиться помощь', 'This person may need help')}</h1>
        <p>${tr('Спасибо, что остановились. Родные получат ваше сообщение сразу.', 'Thank you for stopping. Their family gets your message right away.')}</p></div></div>
      ${w.searching ? h`<a class="note note-red" href="#/a/${w.searching.id}">${icon('siren')}<div><b>${pet ? tr('Его ищут хозяева', 'The owners are looking for this pet') : tr('Его ищут родные', 'The family is looking for this person')}</b>${tr('Открыть заявку о пропаже', 'Open the missing report')}</div></a>` : ''}
      <div class="qr-who">${w.photo ? h`<img src="${w.photo}" alt="">` : ''}<div><b class="qr-name">${w.name}</b>${pet && (w.species || w.breed || w.color) ? h`<span class="muted">${[w.species, w.breed, w.color].filter(Boolean).join(', ')}</span>` : ''}</div></div>
      ${w.note ? h`<p class="qr-note">${w.note}</p>` : ''}
      <div class="qr-calls">
        ${w.phone ? h`<a class="btn btn-lg btn-blue" href="tel:${w.phone.replace(/[^+\d]/g, '')}">${icon('phone')}${pet ? tr('Позвонить хозяевам', 'Call the owners') : tr('Позвонить родным', 'Call the family')}</a>` : ''}
        ${!pet ? h`<a class="btn btn-lg btn-red" href="tel:112">${icon('siren')}112</a>` : ''}
      </div>
      <form id="qf" class="stack">
        <h2 style="font-size:20px">${pet ? tr('Сообщить хозяевам', 'Tell the owners') : tr('Сообщить родным', 'Tell the family')}</h2>
        <label class="field"><span>${tr('Где вы и что случилось', 'Where you are and what happened')}</span><textarea name="message" rows="3" maxlength="1000" placeholder="${tr('Стоим у входа в метро «Площадь 1905 года», жду вас', 'We are at the metro entrance, I will wait')}"></textarea></label>
        <label class="field"><span>${tr('Ваш телефон (необязательно)', 'Your phone (optional)')}</span><input name="contact" maxlength="120" autocomplete="tel" inputmode="tel"></label>
        <button type="button" class="btn btn-ghost" id="qloc">${icon('locate')}<span>${tr('Добавить моё местоположение', 'Add my location')}</span></button>
        <button class="btn btn-lg btn-block">${icon('send')}${tr('Отправить', 'Send')}</button>
        <p class="xs muted">${tr('Регистрация не нужна. Ваш телефон и место увидят только родные. Если человеку плохо — звоните 112.', 'No sign-up needed. Only the family sees your phone and location. If the person is unwell — call 112.')}</p>
      </form>
    </div></div>`);
  $('#qloc', view).onclick = async (e) => {
    const b = e.currentTarget;
    try { pos = await getPosition(); b.classList.add('btn-ok'); $('span', b).textContent = tr('Место добавлено', 'Location added'); } catch (er) { toastErr(er); }
  };
  $('#qf', view).onsubmit = (e) => {
    e.preventDefault();
    const f = formData(e.target);
    busy(e.submitter, async () => {
      try {
        await POST(`/w/${encodeURIComponent(p.token)}/alert`, { message: f.message, contact: f.contact, lat: pos ? pos[0] : null, lng: pos ? pos[1] : null });
        mount($('.qr-card', view), h`<div class="success" style="padding:24px 8px"><div class="big-ic">${icon('check')}</div><h2>${tr('Сообщение отправлено', 'Message sent')}</h2>
          <p class="muted" style="max-width:420px;margin:12px auto 0">${pet ? tr('Хозяева получили уведомление. Если можете — побудьте с питомцем рядом.', 'The owners have been notified. If you can, stay with the pet.') : tr('Родные получили уведомление. Пожалуйста, побудьте рядом. Если человеку плохо — позвоните 112.', 'The family has been notified. Please stay close. If the person is unwell — call 112.')}</p>
          ${w.phone ? h`<a class="btn btn-blue" style="margin-top:18px" href="tel:${w.phone.replace(/[^+\d]/g, '')}">${icon('phone')}${tr('Позвонить', 'Call')}</a>` : ''}</div>`);
      } catch (er) { toastErr(er); }
    });
  };
});

/* =================== листовка для печати =================== */
route('/a/:id/poster', async (view, p) => {
  const { item: a } = await GET('/applications/' + p.id);
  const abroad = !!a.country;
  let en = query().get('en') === '1' || abroad;
  const head = {
    lost: { people: ['ПРОПАЛ ЧЕЛОВЕК', 'MISSING PERSON'], animals: ['ПРОПАЛ ПИТОМЕЦ', 'LOST PET'], things: ['ПОТЕРЯНА ВЕЩЬ', 'LOST ITEM'] },
    found: { people: ['НАЙДЕН ЧЕЛОВЕК', 'FOUND PERSON'], animals: ['НАЙДЕН ПИТОМЕЦ', 'FOUND PET'], things: ['НАЙДЕНА ВЕЩЬ', 'FOUND ITEM'] }
  }[a.kind][a.category];
  const dt = a.details || {};
  const L = (ru, enT) => (en ? h`${ru} <i>/ ${enT}</i>` : ru);
  const rows = [];
  if (a.person_name) rows.push([L('Имя', 'Name'), a.person_name]);
  if (a.person_age != null) rows.push([L('Возраст', 'Age'), a.person_age]);
  if (dt.sex) rows.push([L('Пол', 'Sex'), en ? `${optName('sex', dt.sex)} / ${OPT.sex[dt.sex][1]}` : optName('sex', dt.sex)]);
  if (dt.height) rows.push([L('Рост', 'Height'), dt.height + ' cm']);
  if (a.species) rows.push([L(a.category === 'animals' ? 'Вид' : 'Тип', a.category === 'animals' ? 'Species' : 'Type'), a.species]);
  for (const [k, ru, e2] of [['breed', 'Порода', 'Breed'], ['color', 'Окрас / цвет', 'Colour'], ['clothes_top', 'Верх', 'Top'], ['clothes_bottom', 'Низ', 'Bottom'], ['headwear', 'Головной убор', 'Headwear'], ['shoes', 'Обувь', 'Shoes'], ['brand', 'Бренд', 'Brand'], ['model', 'Модель', 'Model']]) if (dt[k]) rows.push([L(ru, e2), dt[k]]);
  if (dt.health && dt.health.length) rows.push([L('Важно', 'Important'), dt.health.map((x) => en ? `${optName('health', x)} / ${OPT.health[x][1]}` : optName('health', x)).join('; ')]);
  rows.push([L(a.kind === 'lost' ? 'Где и когда' : 'Где и когда найден', a.kind === 'lost' ? 'Last seen' : 'Found'), [fmtDate(a.event_date), [a.address, a.city, abroad ? countryName(a.country) : ''].filter(Boolean).join(', ')].filter(Boolean).join(' · ')]);
  const draw = () => mount(view, h`<div class="wrap print-page">
    <div class="no-print row between" style="padding:16px 0;gap:10px;flex-wrap:wrap"><a class="back" href="#/a/${a.id}">${icon('arrowL', 'ic-sm')}${tr('К заявке', 'Back to report')}</a>
      <div class="row-wrap"><label class="check"><input type="checkbox" id="pEn" ${en ? 'checked' : ''}> <span>${tr('Добавить английский', 'Add English')}</span></label><button class="btn" id="pr">${icon('printer')}${tr('Печать', 'Print')}</button></div></div>
    <article class="poster poster-${a.kind}">
      <h1 class="poster-h">${head[0]}${en ? h`<span>${head[1]}</span>` : ''}</h1>
      <div class="poster-main">
        ${a.photos && a.photos[0] ? h`<img class="poster-ph" src="${a.photos[0]}" alt="">` : ''}
        <div class="poster-info"><h2>${a.title}</h2><dl>${rows.map(([k, v]) => h`<div><dt>${k}</dt><dd>${v}</dd></div>`)}</dl>
          ${a.features ? h`<p class="poster-f">${a.features}</p>` : ''}
          ${a.reward ? h`<p class="poster-reward">${L('Вознаграждение', 'Reward')}: ${money(a.reward)}</p>` : ''}</div>
      </div>
      <div class="poster-foot"><img src="/api/applications/${a.id}/qr.svg" alt="" width="150" height="150">
        <div><b>${a.kind === 'found' ? 'Это ваше? Напишите — анонимно' : a.category === 'things' ? 'Нашли? Напишите — анонимно' : 'Видели? Напишите — анонимно'}</b>${en ? h`<b class="en">${a.kind === 'found' ? 'Is it yours? Message us anonymously' : a.category === 'things' ? 'Found it? Message us anonymously' : 'Seen them? Message us anonymously'}</b>` : ''}
          <span>${location.host}/a/${a.id}</span>
          ${a.category === 'people' && !abroad ? h`<span>Полиция: 102 · Единый номер: 112</span>` : ''}
          ${abroad && countryOf(a.country) ? h`<span>${countryOf(a.country).n.map(([n, k]) => `${tr(...NUM_LABEL[k])}: ${n}`).join(' · ')}</span>` : ''}</div></div>
    </article></div>`);
  draw();
  const bind = () => { $('#pr', view).onclick = () => window.print(); $('#pEn', view).onchange = (e) => { en = e.target.checked; draw(); bind(); }; };
  bind();
});

/* =================== проверка скрытой приметы в чате =================== */
export function verifyBar(chat) {
  const v = chat.verify; if (!v || chat.side === 'moderator') return '';
  if (v.ok) return h`<div class="verify ok">${icon('check')}<span>${tr('Скрытая примета подтверждена', 'Hidden detail confirmed')}</span></div>`;
  if (chat.side === 'owner') return h`<div class="verify">${icon('eyeOff')}<span>${tr('Вы указали скрытую примету. Собеседник может назвать её — система сверит и покажет результат.', 'You set a hidden detail. The other person can name it — the system checks it and shows the result.')}</span></div>`;
  if (!v.left) return h`<div class="verify warn">${icon('alert')}<span>${tr('Попытки проверки закончились — договоритесь в чате.', 'No check attempts left — agree in the chat.')}</span></div>`;
  return h`<div class="verify">${icon('eyeOff')}<span class="grow">${chat.application.kind === 'found' ? tr('Подтвердите, что это ваше: назовите деталь, которую знает только владелец.', 'Prove it is yours: name a detail only the owner knows.') : tr('Подтвердите находку: назовите скрытую примету, которую указал владелец.', 'Confirm the find: name the hidden detail the owner set.')}</span><button type="button" class="btn btn-sm" id="vrf">${tr('Назвать', 'Answer')}</button></div>`;
}
export function bindVerify(el, chat, onMsg) {
  const b = $('#vrf', el); if (!b) return;
  b.onclick = () => {
    const s = sheet(h`${sheetHead(tr('Скрытая примета', 'Hidden detail'), tr(`Осталось попыток: ${chat.verify.left}. Ответ увидит автор заявки, а система сверит его с приметой.`, `Attempts left: ${chat.verify.left}. The report author sees your answer and the system checks it.`))}
      <form class="stack"><label class="field"><span>${tr('Ваш ответ', 'Your answer')}</span><input name="answer" maxlength="300" required autocomplete="off" placeholder="${tr('Например: надпись «Навсегда» внутри', 'E.g. “Forever” engraved inside')}"></label><button class="btn btn-block">${tr('Проверить', 'Check')}</button></form>`);
    $('form', s.el).onsubmit = (e) => {
      e.preventDefault();
      busy(e.submitter, async () => {
        try {
          const r = await POST(`/chats/${chat.id}/verify`, formData(e.target));
          s.close(); chat.verify = r.verify; onMsg(r.message);
          toast(r.ok ? tr('Совпало! Автор заявки увидит подтверждение', 'It matches! The author will see the confirmation') : tr('Не совпало', 'No match'), r.ok ? 'ok' : 'err');
        } catch (er) { toastErr(er); }
      });
    };
  };
}
