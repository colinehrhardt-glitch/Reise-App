import { load, save } from './storage.js';
import { request, ApiError, queryOverpass, coordinates, photoSource } from './api.js';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const inflight = new Map();
const memory = new Map();

function readBucket(name) {
  const store = load(`info:${name}`, {});
  return store && typeof store === 'object' ? store : {};
}

function cachedValue(name, key, ttl) {
  const memo = memory.get(`${name}|${key}`);
  if (memo && Date.now() - memo.time < ttl) return memo.value;
  const entry = readBucket(name)[key];
  if (entry && Number.isFinite(entry.time) && Date.now() - entry.time < ttl) {
    memory.set(`${name}|${key}`, entry);
    return entry.value;
  }
  return undefined;
}

function storeValue(name, key, value, limit) {
  const entry = { time: Date.now(), value };
  memory.set(`${name}|${key}`, entry);
  const store = readBucket(name);
  store[key] = entry;
  const entries = Object.entries(store).filter(([, item]) => item && Number.isFinite(item.time)).sort((a, b) => b[1].time - a[1].time).slice(0, limit);
  while (entries.length && !save(`info:${name}`, Object.fromEntries(entries))) entries.pop();
  return value;
}

function once(key, task) {
  if (inflight.has(key)) return inflight.get(key);
  const promise = task().finally(() => inflight.delete(key));
  inflight.set(key, promise);
  return promise;
}

async function withCache(name, key, ttl, limit, task) {
  const hit = cachedValue(name, key, ttl);
  if (hit !== undefined) return hit;
  return once(`${name}|${key}`, async () => storeValue(name, key, await task(), limit));
}

function trimText(value, max) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  return `${end > max * 0.5 ? cut.slice(0, end + 1) : cut.replace(/\s+\S*$/, '')} …`;
}

function httpsUrl(value) {
  if (typeof value !== 'string') return null;
  const url = value.replace(/^http:\/\//i, 'https://');
  return /^https:\/\//i.test(url) ? url : null;
}

const LANGS = ['de', 'en', 'es'];

export function countryName(code, lang) {
  if (!/^[a-z]{2}$/.test(code || '')) return null;
  try {
    const name = new Intl.DisplayNames(lang, { type: 'region' }).of(code.toUpperCase());
    return name && name !== code.toUpperCase() ? name : null;
  } catch {
    return null;
  }
}

export async function wikidataLinks(id) {
  if (!/^Q\d+$/.test(id || '')) return { wiki: {}, voyage: {}, descriptions: {} };
  return withCache('links2', id, 30 * DAY, 60, async () => {
    const params = new URLSearchParams({
      action: 'wbgetentities',
      ids: id,
      props: 'sitelinks|descriptions',
      languages: LANGS.join('|'),
      sitefilter: LANGS.flatMap((lang) => [`${lang}wiki`, `${lang}wikivoyage`]).join('|'),
      format: 'json',
      origin: '*'
    });
    const data = await request(`https://www.wikidata.org/w/api.php?${params}`, {}, 10000);
    const entity = (data && data.entities && data.entities[id]) || {};
    const links = entity.sitelinks || {};
    const result = { wiki: {}, voyage: {}, descriptions: {} };
    for (const lang of LANGS) {
      if (links[`${lang}wiki`]) result.wiki[lang] = links[`${lang}wiki`].title;
      if (links[`${lang}wikivoyage`]) result.voyage[lang] = links[`${lang}wikivoyage`].title;
      if (entity.descriptions && entity.descriptions[lang]) result.descriptions[lang] = String(entity.descriptions[lang].value).slice(0, 120);
    }
    return result;
  });
}

export async function translateText(text, from, to) {
  const source = String(text || '').trim();
  if (!source || from === to) return source;
  const key = `${from}|${to}|${source.slice(0, 160)}|${source.length}`;
  return withCache('translate', key, 30 * DAY, 120, async () => {
    const parts = [];
    let rest = source;
    while (rest.length) {
      let cut = rest.length > 480 ? rest.lastIndexOf('. ', 480) + 1 : rest.length;
      if (cut <= 0) cut = Math.min(480, rest.length);
      parts.push(rest.slice(0, cut).trim());
      rest = rest.slice(cut).trim();
    }
    const translated = [];
    for (const part of parts.slice(0, 3)) {
      const params = new URLSearchParams({ q: part, langpair: `${from}|${to}` });
      const data = await request(`https://api.mymemory.translated.net/get?${params}`, {}, 10000);
      const value = data && data.responseData && data.responseData.translatedText;
      if (!value || Number(data.responseStatus) !== 200 || /MYMEMORY WARNING|QUERY LENGTH LIMIT/i.test(value)) throw new ApiError('server');
      translated.push(value);
    }
    return translated.join(' ');
  });
}

async function translated(text, from, to) {
  if (from === to) return { text, translated: false };
  try {
    return { text: await translateText(text, from, to), translated: true };
  } catch (error) {
    if (error.code === 'offline') throw error;
    return { text, translated: false, foreign: from };
  }
}

function sentences(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .replace(/\s*\([^)]*\)/g, '')
    .replace(/([^\s.]{2}[.!?])\s+(?=[A-ZÄÖÜÁÉÍÓÚÑ¿¡0-9"„«])/g, '$1\u0001')
    .split('\u0001')
    .map((item) => item.trim())
    .filter((item) => item.length > 2);
}

export function shortText(text, count = 2, max = 260) {
  const list = sentences(text);
  let result = '';
  for (const sentence of list) {
    if (result && (result.length + sentence.length > max || sentences(result).length >= count)) break;
    result = result ? `${result} ${sentence}` : sentence;
  }
  return trimText(result || text, max);
}

async function searchWikipedia(lang, query) {
  const params = new URLSearchParams({ action: 'query', list: 'search', srsearch: query, srlimit: '1', format: 'json', origin: '*' });
  const data = await request(`https://${lang}.wikipedia.org/w/api.php?${params}`, {}, 10000);
  const hit = data && data.query && data.query.search && data.query.search[0];
  return hit ? hit.title : null;
}

async function wikipediaSummary(lang, title) {
  const data = await request(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`, {}, 10000);
  if (!data || data.type === 'disambiguation' || !data.extract) return null;
  return {
    title: String(data.title || title).slice(0, 120),
    description: typeof data.description === 'string' ? data.description.slice(0, 120) : null,
    extract: String(data.extract),
    image: httpsUrl(data.thumbnail && data.thumbnail.source),
    url: httpsUrl((data.content_urls && data.content_urls.mobile && data.content_urls.mobile.page) || (data.content_urls && data.content_urls.desktop && data.content_urls.desktop.page)),
    lang
  };
}

const BAD_IMAGE = /flag|bandera|flagge|coat[_ ]of[_ ]arms|escudo|wappen|logo|map|mapa|karte|locator|location|lage|icon|symbol|seal|sello|signature|firma|commons-|wiki|stub|disambig|question|edit|\.svg$|\.gif$|\.tif/i;

export async function fetchGallery(lang, title, limit = 8) {
  if (!title) return [];
  return withCache('gallery', `${lang}|${title}`, 7 * DAY, 30, async () => {
    const params = new URLSearchParams({
      action: 'query',
      generator: 'images',
      titles: title,
      gimlimit: '40',
      prop: 'imageinfo',
      iiprop: 'url|mime|size',
      iiurlwidth: '800',
      redirects: '1',
      format: 'json',
      origin: '*'
    });
    const data = await request(`https://${lang}.wikipedia.org/w/api.php?${params}`, {}, 10000);
    const pages = Object.values((data && data.query && data.query.pages) || {});
    const list = [];
    for (const page of pages) {
      const info = page.imageinfo && page.imageinfo[0];
      if (!info || BAD_IMAGE.test(page.title || '')) continue;
      if (!/^image\/(jpeg|png|webp)$/.test(info.mime || '')) continue;
      if ((info.width || 0) < 500 || (info.height || 0) < 300) continue;
      const ratio = info.width / info.height;
      if (ratio > 3.2 || ratio < 0.45) continue;
      const src = httpsUrl(info.thumburl || info.url);
      if (!src) continue;
      list.push({ src, link: httpsUrl(info.descriptionurl) || src, credit: 'Wikimedia Commons' });
    }
    return list.slice(0, limit);
  });
}

export async function fetchSummary(place, lang) {
  const key = `${lang}|${place.wikidata || `${place.name}|${place.lat.toFixed(2)},${place.lon.toFixed(2)}`}`;
  return withCache('summary2', key, 7 * DAY, 20, async () => {
    let title = null;
    let wikiLang = lang;
    let description = null;
    if (place.wikidata) {
      const links = await wikidataLinks(place.wikidata);
      description = links.descriptions[lang] || null;
      title = links.wiki[lang] || null;
      if (!title && links.wiki.en) {
        title = links.wiki.en;
        wikiLang = 'en';
      }
    }
    if (!title) title = await searchWikipedia(lang, [place.name, place.countryName].filter(Boolean).join(' '));
    if (!title) return null;
    const summary = await wikipediaSummary(wikiLang, title);
    if (!summary) return null;
    const short = shortText(summary.extract, 2, 260);
    const text = await translated(short, wikiLang, lang);
    let gallery = [];
    try {
      gallery = await fetchGallery(wikiLang, summary.title);
    } catch (error) {
      if (error.code === 'offline') throw error;
    }
    const images = [summary.image ? { src: summary.image, link: summary.url, credit: 'Wikipedia' } : null, ...gallery].filter(Boolean)
      .filter((image, index, all) => all.findIndex((other) => other.src === image.src) === index);
    const subtitle = description || (wikiLang === lang ? summary.description : null);
    return { title: summary.title, description: subtitle, text: text.text, translated: text.translated, foreign: text.foreign || null, url: summary.url, images };
  });
}

export async function fetchSightSummary(item, lang) {
  const key = `${lang}|${item.wikidata || item.wikiTitle || item.id}`;
  return withCache('sightSummary2', key, 7 * DAY, 40, async () => {
    let wikiLang = null;
    let title = null;
    if (item.wikiTitle && item.wikiLang) {
      wikiLang = item.wikiLang;
      title = item.wikiTitle;
    }
    if (item.wikidata && (!title || wikiLang !== lang)) {
      const links = await wikidataLinks(item.wikidata);
      if (links.wiki[lang]) {
        wikiLang = lang;
        title = links.wiki[lang];
      } else if (!title && links.wiki.en) {
        wikiLang = 'en';
        title = links.wiki.en;
      }
    }
    if (!title) return null;
    const summary = await wikipediaSummary(wikiLang, title);
    if (!summary) return null;
    const text = await translated(shortText(summary.extract, 2, 240), wikiLang, lang);
    let gallery = [];
    try {
      gallery = await fetchGallery(wikiLang, summary.title, 6);
    } catch (error) {
      if (error.code === 'offline') throw error;
    }
    return { text: text.text, translated: text.translated, url: summary.url, images: gallery };
  });
}

async function sparql(query, timeout = 15000) {
  const data = await request(`https://query.wikidata.org/sparql?${new URLSearchParams({ query, format: 'json' })}`, { headers: { Accept: 'application/sparql-results+json' } }, timeout);
  return (data && data.results && data.results.bindings) || [];
}

const sparqlValue = (row, key) => (row[key] ? row[key].value : null);

async function countryFromRest(id) {
  const fields = 'name,capital,currencies,languages,idd,timezones,car,population,cca2';
  const raw = await request(`https://restcountries.com/v3.1/alpha/${id}?fields=${fields}`, {}, 8000);
  const data = Array.isArray(raw) ? raw[0] : raw;
  if (!data || !data.name) throw new ApiError('server');
  const suffixes = data.idd && Array.isArray(data.idd.suffixes) ? data.idd.suffixes : [];
  return {
    capital: Array.isArray(data.capital) ? data.capital[0] || null : null,
    currencies: Object.entries(data.currencies || {}).map(([currency, info]) => ({ code: currency, name: info && info.name, symbol: info && info.symbol })),
    languages: Object.entries(data.languages || {}).map(([language, name]) => ({ code: language, name })),
    calling: data.idd && data.idd.root ? `${data.idd.root}${suffixes.length === 1 ? suffixes[0] : ''}` : null,
    timezones: Array.isArray(data.timezones) ? data.timezones.slice(0, 6) : [],
    side: data.car && data.car.side === 'left' ? 'left' : 'right',
    population: Number(data.population) || null
  };
}

async function countryFromWikidata(id, lang) {
  const rows = await sparql(`SELECT ?capitalLabel ?population ?currency ?language ?calling ?side WHERE {
    ?country wdt:P297 "${id.toUpperCase()}" .
    OPTIONAL { ?country wdt:P36 ?capital . }
    OPTIONAL { ?country wdt:P1082 ?population . }
    OPTIONAL { ?country wdt:P38 ?cur . ?cur wdt:P498 ?currency . }
    OPTIONAL { ?country wdt:P37 ?lang . ?lang wdt:P218 ?language . }
    OPTIONAL { ?country wdt:P474 ?calling . }
    OPTIONAL { ?country wdt:P1622 ?side . }
    SERVICE wikibase:label { bd:serviceParam wikibase:language "${lang},en". }
  } LIMIT 80`, 12000);
  if (!rows.length) throw new ApiError('server');
  const unique = (key) => [...new Set(rows.map((row) => sparqlValue(row, key)).filter(Boolean))];
  const populations = unique('population').map(Number).filter(Number.isFinite);
  const side = unique('side')[0] || '';
  return {
    capital: unique('capitalLabel')[0] || null,
    currencies: unique('currency').slice(0, 3).map((code) => ({ code, name: code, symbol: null })),
    languages: unique('language').slice(0, 4).map((code) => ({ code, name: code })),
    calling: unique('calling')[0] ? `+${String(unique('calling')[0]).replace(/^\+/, '')}` : null,
    timezones: [],
    side: side.endsWith('Q13196750') ? 'left' : 'right',
    population: populations.length ? Math.max(...populations) : null
  };
}

export async function fetchCountry(code, lang = 'en') {
  const id = String(code || '').toLowerCase();
  if (!/^[a-z]{2}$/.test(id)) throw new ApiError('server');
  return withCache('country2', `${id}|${lang}`, 30 * DAY, 30, async () => {
    let base = null;
    try {
      base = await countryFromRest(id);
    } catch (error) {
      if (error.code === 'offline') throw error;
      base = await countryFromWikidata(id, lang);
    }
    return { code: id, names: Object.fromEntries(LANGS.map((item) => [item, countryName(id, item)])), ...base };
  });
}

export async function fetchEmergency(code) {
  const id = String(code || '').toUpperCase();
  if (!/^[A-Z]{2}$/.test(id)) return null;
  return withCache('emergency', id, 30 * DAY, 30, async () => {
    const rows = await sparql(`SELECT ?number WHERE { ?country wdt:P297 "${id}" ; p:P2852 ?st . ?st ps:P2852 ?service . ?service wdt:P1329 ?number . } LIMIT 10`, 10000);
    const numbers = [...new Set(rows.map((row) => sparqlValue(row, 'number')).filter((value) => /^[\d +-]{2,12}$/.test(value || '')))];
    return numbers.slice(0, 4);
  });
}

const UK_LEVELS = [
  [/avoid_all_travel_to_whole_country/, 4],
  [/avoid_all_but_essential_travel_to_whole_country/, 4],
  [/avoid_all_travel_to_parts/, 3],
  [/avoid_all_but_essential_travel_to_parts/, 2]
];

async function ukAdvice(code) {
  const name = countryName(code, 'en');
  if (!name) return null;
  const slug = name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/&/g, 'and').replace(/[^a-z]+/g, '-').replace(/^-|-$/g, '');
  const data = await request(`https://www.gov.uk/api/content/foreign-travel-advice/${slug}`, {}, 10000);
  const status = (data && data.details && Array.isArray(data.details.alert_status) ? data.details.alert_status : []).join(' ');
  const match = UK_LEVELS.find(([pattern]) => pattern.test(status));
  return { id: 'uk', level: match ? match[1] : 1, url: `https://www.gov.uk/foreign-travel-advice/${slug}`, updated: Date.parse(data && data.public_updated_at) || null };
}

async function usAdvice(code) {
  const list = await withCache('usAdvice', 'all', 12 * HOUR, 1, async () => {
    const data = await request('https://cadataapi.state.gov/api/TravelAdvisories', { headers: { Accept: 'application/json' } }, 10000);
    return (Array.isArray(data) ? data : []).map((item) => ({
      codes: Array.isArray(item.Category) ? item.Category.map((value) => String(value).toLowerCase()) : [],
      level: Number((/Level\s*(\d)/i.exec(item.Title || '') || [])[1]) || null,
      url: httpsUrl(item.Link),
      updated: Date.parse(item.Updated || item.Published) || null
    })).filter((item) => item.level);
  });
  const hit = list.find((item) => item.codes.includes(code));
  return hit ? { id: 'us', level: hit.level, url: hit.url || 'https://travel.state.gov/content/travel/en/traveladvisories/traveladvisories.html', updated: hit.updated } : null;
}

async function germanAdvice(code) {
  const value = await fetchTravelWarning(code);
  if (!value) return null;
  const level = value.warning ? 4 : value.partial ? 3 : value.situation || value.situationPart ? 2 : 1;
  return { id: 'de', level, url: 'https://www.auswaertiges-amt.de/de/ReiseUndSicherheit/reise-und-sicherheitshinweise', updated: value.modified };
}

export async function fetchAdvisories(code) {
  const id = String(code || '').toLowerCase();
  if (!/^[a-z]{2}$/.test(id)) return [];
  const results = await Promise.allSettled([germanAdvice(id), ukAdvice(id), usAdvice(id)]);
  return results.filter((result) => result.status === 'fulfilled' && result.value).map((result) => result.value);
}

const GUIDE_SECTIONS = {
  safety: /^(stay safe|sicherheit|seguridad|mantente seguro|precauciones)/i,
  around: /^(get around|mobilität|unterwegs|cómo moverse|moverse|desplazarse|transporte)/i,
  eat: /^(eat|küche|essen|comer|gastronomía)/i,
  drink: /^(drink|nachtleben|ausgehen|beber|salir|vida nocturna)/i,
  respect: /^(respect|respekt|verhalten|umgangsformen|respeto)/i,
  health: /^(stay healthy|gesundheit|salud)/i
};
const COUNTRY_FALLBACK = ['safety', 'respect', 'health'];
const KEYWORDS = {
  safety: /taxi|uber|nacht|night|noche|dieb|theft|robo|ladr|pickpocket|taschendieb|überfall|raub|robbery|asalto|atraco|meid|avoid|evit|drog|drug|betrug|scam|estafa|gefähr|danger|peligr|unsicher|unsafe|insegur|wertsach|valuable|objetos|allein|alone|solo|polizei|police|polic/i,
  around: /taxi|uber|\bbus|buseta|colectivo|metro|tram|zu fuß|walk|a pie|caminar|preis|price|precio|kostet|cuesta|\d[\d.,]*\s?(?:cop|usd|eur|€|\$|pesos?)|fahrrad|bike|bici|mototaxi|ticket|tarjeta/i,
  eat: /typisch|typical|típic|gericht|dish|plato|fisch|fish|pescado|seafood|meeresfr|mariscos|markt|market|mercado|\d[\d.,]*\s?(?:cop|usd|eur|€|\$|pesos?)|spezialit|specialt|especialidad|frühstück|breakfast|desayuno|streetfood|street food|callejer|kokos|coco|arepa|empanada/i,
  drink: /bar|club|disco|nacht|night|noche|viertel|area|zona|barrio|bier|beer|cerveza|rum|ron|cocktail|tanz|danc|bail|salsa|live/i,
  respect: /höflich|polite|cortés|educad|kleid|dress|ropa|vest|trinkgeld|tip|propina|grüß|greet|salud|foto|photo|sprache|spanish|spanisch|español|idioma|language|religi|indigen|kirche|church|iglesia|respekt|respect|respet/i,
  health: /impf|vaccin|vacun|mück|mosquito|zancudo|dengue|malaria|zika|gelbfieber|yellow fever|fiebre amarilla|wasser|water|agua|sonne|sun|sol|apothek|pharmac|farmac|krankenhaus|hospital|clínic|clinic|höhe|altitude|altura/i
};

function sectionLines(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('h1,h2,h3,h4,h5,.mw-editsection,table,style,script,figure,.thumb,.noprint,sup,.mw-empty-elt,.pp_infobox,.listing-metadata').forEach((node) => node.remove());
  const paragraphs = [];
  const listings = [];
  for (const node of doc.querySelectorAll('p, li, dd')) {
    if (node.tagName !== 'LI' && node.closest('li')) continue;
    if (node.tagName === 'LI' && node.parentElement && node.parentElement.closest('li')) continue;
    const text = node.textContent.replace(/\s+/g, ' ').trim();
    if (text.length < 3) continue;
    if (node.tagName === 'LI') {
      const name = node.querySelector('.listing-name, .fn, b, strong');
      listings.push({ name: (name ? name.textContent : text.split(/[,.(–—:]/)[0]).trim().slice(0, 60), text });
    } else {
      paragraphs.push(text);
    }
  }
  return { paragraphs, listings };
}

function keyPoints(lines, topic, max = 3) {
  const candidates = [];
  lines.paragraphs.forEach((paragraph, pIndex) => {
    sentences(paragraph).forEach((sentence, sIndex) => {
      if (sentence.length < 25) return;
      const hits = (sentence.match(new RegExp(KEYWORDS[topic].source, 'gi')) || []).length;
      if (!hits) return;
      const score = hits * 2 + (pIndex === 0 ? 0.5 : 0) - Math.max(0, sentence.length - 160) / 60;
      candidates.push({ sentence, score, order: pIndex * 100 + sIndex });
    });
  });
  if (topic !== 'eat' && topic !== 'drink') {
    lines.listings.forEach((item, index) => {
      const hits = (item.text.match(new RegExp(KEYWORDS[topic].source, 'gi')) || []).length;
      if (hits) candidates.push({ sentence: item.text, score: hits * 1.5, order: 10000 + index });
    });
  }
  const chosen = candidates.filter((item) => item.score > 0).sort((a, b) => b.score - a.score).slice(0, max).sort((a, b) => a.order - b.order);
  const points = chosen.map((item) => trimText(item.sentence, 115));
  if ((topic === 'eat' || topic === 'drink') && lines.listings.length) {
    const names = lines.listings.map((item) => item.name).filter((name) => name.length > 1).slice(0, 3);
    if (names.length) {
      if (points.length >= max) points.pop();
      points.push({ names });
    }
  }
  if (!points.length && lines.paragraphs.length) points.push(trimText(sentences(lines.paragraphs[0])[0] || lines.paragraphs[0], 115));
  return points;
}

async function guideSections(lang, title) {
  const params = new URLSearchParams({ action: 'parse', page: title, prop: 'sections', redirects: '1', format: 'json', origin: '*' });
  const data = await request(`https://${lang}.wikivoyage.org/w/api.php?${params}`, {}, 10000);
  if (!data || !data.parse) return null;
  return { title: data.parse.title || title, sections: data.parse.sections || [] };
}

async function guideSection(lang, title, index) {
  const params = new URLSearchParams({ action: 'parse', page: title, section: String(index), prop: 'text', redirects: '1', disabletoc: '1', format: 'json', origin: '*' });
  const data = await request(`https://${lang}.wikivoyage.org/w/api.php?${params}`, {}, 10000);
  const html = data && data.parse && data.parse.text ? data.parse.text['*'] || data.parse.text : '';
  return typeof html === 'string' ? sectionLines(html) : { paragraphs: [], listings: [] };
}

function pageUrl(lang, title, anchor = null) {
  const path = encodeURIComponent(title.replace(/ /g, '_'));
  return `https://${lang}.wikivoyage.org/wiki/${path}${anchor ? `#${encodeURIComponent(anchor.replace(/ /g, '_'))}` : ''}`;
}

async function readGuide(lang, title, keys) {
  const page = await guideSections(lang, title);
  if (!page) return null;
  const result = { title: page.title, url: pageUrl(lang, page.title), lang, sections: {} };
  await Promise.all(keys.map(async (key) => {
    const section = page.sections.find((item) => Number(item.toclevel) === 1 && GUIDE_SECTIONS[key].test(String(item.line || '').replace(/<[^>]*>/g, '').trim()));
    if (!section) return;
    const lines = await guideSection(lang, page.title, section.index);
    const points = keyPoints(lines, key);
    if (points.length) {
      const heading = String(section.line).replace(/<[^>]*>/g, '').trim();
      result.sections[key] = { points, url: pageUrl(lang, page.title, section.anchor || heading) };
    }
  }));
  return result;
}

async function translatePoints(points, from, to) {
  if (from === to) return { points, translated: false };
  let done = false;
  const list = await Promise.all(points.map(async (point) => {
    if (typeof point !== 'string') return point;
    const result = await translated(point, from, to);
    if (result.translated) done = true;
    return result.text;
  }));
  return { points: list, translated: done };
}

async function guideFor(lang, title, keys) {
  try {
    return await readGuide(lang, title, keys);
  } catch (error) {
    if (error.code === 'offline') throw error;
    return null;
  }
}

export async function fetchGuide(place, lang, countryCode = null) {
  const key = `${lang}|${place.wikidata || `${place.name}|${place.lat.toFixed(1)},${place.lon.toFixed(1)}`}`;
  return withCache('guide2', key, 7 * DAY, 10, async () => {
    const links = place.wikidata ? await wikidataLinks(place.wikidata).catch(() => ({ voyage: {} })) : { voyage: {} };
    const keys = Object.keys(GUIDE_SECTIONS);
    const sources = [];
    const local = await guideFor(lang, links.voyage[lang] || place.name, keys);
    if (local) sources.push(local);
    const missing = () => keys.filter((item) => !sources.some((source) => source.sections[item]));
    if (missing().length && lang !== 'en' && (links.voyage.en || !local)) {
      const english = await guideFor('en', links.voyage.en || place.name, missing());
      if (english) sources.push(english);
    }
    const countryMissing = missing().filter((item) => COUNTRY_FALLBACK.includes(item));
    if (countryCode && countryMissing.length) {
      const name = countryName(countryCode, lang);
      const country = name && name !== place.name ? await guideFor(lang, name, countryMissing) : null;
      if (country) sources.push(country);
      const still = missing().filter((item) => COUNTRY_FALLBACK.includes(item));
      const englishName = countryName(countryCode, 'en');
      if (still.length && lang !== 'en' && englishName) {
        const englishCountry = await guideFor('en', englishName, still);
        if (englishCountry) sources.push(englishCountry);
      }
    }
    if (!sources.length) return null;
    const sections = {};
    for (const item of keys) {
      const source = sources.find((entry) => entry.sections[item]);
      if (!source) continue;
      const section = source.sections[item];
      const result = await translatePoints(section.points, source.lang, lang);
      sections[item] = { points: result.points, translated: result.translated, url: section.url, source: source.title };
    }
    return { title: sources[0].title, url: sources[0].url, sections };
  });
}

const SIGHT_RULES = [
  { key: 'tourism', values: ['attraction', 'museum', 'viewpoint', 'gallery', 'zoo', 'theme_park', 'aquarium'] },
  { key: 'historic', values: ['monument', 'castle', 'fort', 'ruins', 'archaeological_site', 'memorial', 'city_gate', 'building', 'manor', 'monastery', 'church'], wikidata: true },
  { key: 'natural', values: ['beach', 'waterfall', 'bay'] },
  { key: 'leisure', values: ['park', 'nature_reserve', 'garden'], wikidata: true },
  { key: 'amenity', values: ['place_of_worship'], wikidata: true }
];
export const SIGHT_TYPES = ['attraction', 'museum', 'history', 'religion', 'nature', 'beach', 'viewpoint', 'fun'];
const NOT_SIGHT = new RegExp(`\\b(?:${['stadt', 'gemeinde', 'ortsteil', 'stadtteil', 'stadtviertel', 'barrio', 'neighbourhood', 'neighborhood', 'district', 'bezirk', 'municipality', 'municipio', 'corregimiento', 'comuna', 'village', 'dorf', 'town', 'city', 'ciudad', 'localidad', 'settlement', 'river', 'fluss', 'río', 'street', 'straße', 'calle', 'road', 'avenue', 'avenida', 'bank', 'banco', 'hotel', 'band', 'album', 'film', 'radio'].join('|')})\\b|\\b(?:${['school', 'schule', 'colegio', 'escuela', 'universit', 'universidad', 'hospital', 'krankenhaus', 'clínica', 'clinic', 'airport', 'aeropuerto', 'flughafen', 'station', 'estación', 'bahnhof', 'company', 'unternehmen', 'empresa', 'club', 'footballer', 'fußballspieler', 'futbolista', 'politic', 'politik', 'polític', 'singer', 'sänger', 'cantante', 'stadium', 'stadion', 'estadio', 'película', 'newspaper', 'zeitung', 'periódico', 'diocese', 'diözese', 'diócesis', 'electoral', 'wahlkreis', 'organi', 'television', 'fernseh', 'televisión'].join('|')})`, 'i');

function typeFromText(text) {
  const value = String(text || '').toLowerCase();
  if (/muse|galer|gallery/.test(value)) return 'museum';
  if (/kirche|church|iglesia|kathedral|cathedral|catedral|kapelle|chapel|capilla|kloster|monaster|convent|templ|mosque|moschee|mezquita|basilic/.test(value)) return 'religion';
  if (/strand|beach|playa|bucht|bay|bahía/.test(value)) return 'beach';
  if (/aussicht|viewpoint|mirador|lookout/.test(value)) return 'viewpoint';
  if (/park|parque|nationalpark|reserve|reserva|wasserfall|waterfall|cascada|berg|mountain|montaña|cerro|insel|island|isla|garten|garden|jardín|lagune|lagoon|laguna/.test(value)) return 'nature';
  if (/festung|fort|castillo|castle|burg|denkmal|monument|ruin|archäolog|archaeolog|arqueol|histor|plaza|platz|square|haus|house|casa|quinta|palast|palace|palacio|leuchtturm|lighthouse|faro|brücke|bridge|puente/.test(value)) return 'history';
  if (/zoo|aquari|freizeit|theme park|parque temático|acuario/.test(value)) return 'fun';
  return 'attraction';
}

function sightType(tags) {
  if (tags.tourism === 'museum' || tags.tourism === 'gallery') return 'museum';
  if (tags.tourism === 'viewpoint') return 'viewpoint';
  if (['zoo', 'theme_park', 'aquarium'].includes(tags.tourism)) return 'fun';
  if (tags.natural === 'beach' || tags.natural === 'bay') return 'beach';
  if (tags.natural || tags.leisure) return 'nature';
  if (tags.amenity === 'place_of_worship' || tags.historic === 'church' || tags.historic === 'monastery') return 'religion';
  if (tags.historic) return 'history';
  return 'attraction';
}

function boxAround(lat, lon, radius) {
  const dLat = radius / 111320;
  const dLon = radius / (111320 * Math.max(0.2, Math.cos(lat * Math.PI / 180)));
  return [lat - dLat, lon - dLon, lat + dLat, lon + dLon].map((value) => value.toFixed(5)).join(',');
}

async function wikiSights(place, lang, radius) {
  const params = new URLSearchParams({
    action: 'query',
    generator: 'geosearch',
    ggscoord: `${place.lat.toFixed(5)}|${place.lon.toFixed(5)}`,
    ggsradius: String(Math.min(10000, Math.round(radius))),
    ggslimit: '100',
    prop: 'coordinates|pageimages|description|pageprops',
    piprop: 'thumbnail',
    pithumbsize: '320',
    ppprop: 'wikibase_item',
    format: 'json',
    origin: '*'
  });
  const data = await request(`https://${lang}.wikipedia.org/w/api.php?${params}`, {}, 12000);
  const pages = Object.values((data && data.query && data.query.pages) || {});
  const items = [];
  for (const page of pages) {
    const coord = page.coordinates && page.coordinates[0];
    if (!coord) continue;
    const description = page.description || '';
    const head = description.split(/\s+/).slice(0, 2).join(' ');
    const firstWord = String(page.title).split(/\s+/)[0];
    if (NOT_SIGHT.test(head) || NOT_SIGHT.test(firstWord)) continue;
    if (Math.abs(coord.lat - place.lat) < 0.0005 && Math.abs(coord.lon - place.lon) < 0.0005) continue;
    const wikidata = page.pageprops && /^Q\d+$/.test(page.pageprops.wikibase_item || '') ? page.pageprops.wikibase_item : null;
    items.push({
      id: wikidata ? `wd/${wikidata}` : `wp/${lang}/${page.pageid}`,
      kind: 'sight',
      type: typeFromText(`${description} ${page.title}`),
      name: String(page.title).replace(/\s*\([^)]*\)\s*$/, '').slice(0, 120),
      lat: coord.lat,
      lon: coord.lon,
      wikidata,
      wikiTitle: page.title,
      wikiLang: lang,
      popularity: 1,
      image: httpsUrl(page.thumbnail && page.thumbnail.source),
      photo: null,
      openingHours: null,
      fee: null,
      website: null
    });
  }
  return items;
}

async function osmSights(place, radius, signal) {
  const box = `(${boxAround(place.lat, place.lon, radius)})`;
  const parts = SIGHT_RULES.map((rule) => {
    const value = rule.values.length === 1 ? `="${rule.values[0]}"` : `~"^(${rule.values.join('|')})$"`;
    return `nw["${rule.key}"${value}]["name"]${rule.wikidata ? '["wikidata"]' : ''}${box};`;
  });
  const elements = await queryOverpass(`[out:json][timeout:15];(${parts.join('')});out tags center 300;`, signal, null, { patient: false, timeout: 12000 });
  const items = [];
  for (const element of elements) {
    const tags = element.tags || {};
    const position = coordinates(element);
    const name = typeof tags.name === 'string' ? tags.name.trim().slice(0, 120) : '';
    if (!position || !name) continue;
    const wikipedia = typeof tags.wikipedia === 'string' ? /^([a-z]{2,3}):(.+)$/.exec(tags.wikipedia) : null;
    items.push({
      id: `${element.type}/${element.id}`,
      kind: 'sight',
      type: sightType(tags),
      name,
      lat: position.lat,
      lon: position.lon,
      wikidata: /^Q\d+$/.test(tags.wikidata || '') ? tags.wikidata : null,
      wikiTitle: wikipedia ? wikipedia[2].slice(0, 200) : null,
      wikiLang: wikipedia && LANGS.includes(wikipedia[1]) ? wikipedia[1] : null,
      popularity: tags.wikidata ? 1 : wikipedia ? 0.8 : ['attraction', 'museum'].includes(tags.tourism) ? 0.5 : 0.2,
      image: null,
      photo: photoSource(tags),
      openingHours: typeof tags.opening_hours === 'string' ? tags.opening_hours.slice(0, 120) : null,
      fee: tags.fee === 'no' ? 'no' : tags.fee === 'yes' ? 'yes' : null,
      website: typeof tags.website === 'string' && /^https?:\/\//i.test(tags.website) ? tags.website.slice(0, 300) : null
    });
  }
  return items;
}

function closeTo(a, b) {
  return Math.abs(a.lat - b.lat) < 0.003 && Math.abs(a.lon - b.lon) < 0.004;
}

export function mergeSights(...groups) {
  const merged = [];
  for (const item of groups.flat()) {
    const match = merged.find((other) => (item.wikidata && other.wikidata === item.wikidata)
      || (other.name.toLowerCase() === item.name.toLowerCase() && closeTo(other, item)));
    if (!match) {
      merged.push({ ...item });
      continue;
    }
    if (match.type === 'attraction' && item.type !== 'attraction') match.type = item.type;
    for (const field of ['wikidata', 'wikiTitle', 'wikiLang', 'image', 'photo', 'openingHours', 'fee', 'website']) {
      if (!match[field] && item[field]) match[field] = item[field];
    }
    match.popularity = Math.max(match.popularity, item.popularity);
  }
  return merged;
}

async function rankSights(items, lang) {
  const ids = [...new Set(items.filter((item) => item.wikidata).map((item) => item.wikidata))].slice(0, 180);
  if (ids.length) {
    try {
      const rows = await sparql(`SELECT ?item ?links ?image ?title WHERE { VALUES ?item { ${ids.map((id) => `wd:${id}`).join(' ')} } ?item wikibase:sitelinks ?links. OPTIONAL { ?item wdt:P18 ?image. } OPTIONAL { ?article schema:about ?item; schema:isPartOf <https://${lang}.wikipedia.org/>; schema:name ?title. } }`);
      const info = new Map();
      for (const row of rows) {
        const id = String(sparqlValue(row, 'item') || '').split('/').pop();
        if (!/^Q\d+$/.test(id) || info.has(id)) continue;
        info.set(id, { links: Number(sparqlValue(row, 'links')) || 0, image: httpsUrl(sparqlValue(row, 'image')), title: sparqlValue(row, 'title') });
      }
      for (const item of items) {
        const entry = item.wikidata ? info.get(item.wikidata) : null;
        if (!entry) continue;
        item.popularity = 1 + entry.links;
        if (!item.image && entry.image) item.image = `${entry.image}${entry.image.includes('?') ? '&' : '?'}width=320`;
        if (entry.title) {
          item.wikiTitle = entry.title;
          item.wikiLang = lang;
        }
      }
    } catch (error) {
      if (error.code === 'offline') throw error;
    }
  }
  return items.sort((a, b) => b.popularity - a.popularity || a.name.localeCompare(b.name)).slice(0, 80);
}

export async function fetchSights(place, lang, radius, { onPartial = null } = {}) {
  const key = `${lang}|${place.lat.toFixed(2)},${place.lon.toFixed(2)}|${Math.round(radius / 1000)}`;
  return withCache('sights2', key, DAY, 6, async () => {
    const osm = osmSights(place, radius).then((value) => ({ ok: true, value }), (error) => ({ ok: false, error }));
    const wiki = Promise.all([
      wikiSights(place, lang, radius).catch((error) => (error.code === 'offline' ? Promise.reject(error) : [])),
      lang === 'en' ? [] : wikiSights(place, 'en', radius).catch(() => [])
    ]).then(([local, english]) => mergeSights(local, english));
    const quick = await wiki;
    if (onPartial && quick.length) {
      try {
        onPartial(await rankSights(mergeSights(quick), lang));
      } catch {
        onPartial(quick);
      }
    }
    const full = await osm;
    if (!full.ok && !quick.length) throw full.error;
    return rankSights(mergeSights(quick, full.ok ? full.value : []), lang);
  });
}

function roundCoord(value) {
  return value.toFixed(2);
}

export async function fetchForecast(lat, lon) {
  const key = `${roundCoord(lat)},${roundCoord(lon)}`;
  return withCache('weather', key, HOUR, 8, async () => {
    const params = new URLSearchParams({
      latitude: roundCoord(lat),
      longitude: roundCoord(lon),
      current: 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day',
      daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,uv_index_max,sunrise,sunset',
      timezone: 'auto',
      forecast_days: '16'
    });
    const data = await request(`https://api.open-meteo.com/v1/forecast?${params}`, {}, 12000);
    const daily = data.daily || {};
    const days = (daily.time || []).map((date, index) => ({
      date,
      code: daily.weather_code ? daily.weather_code[index] : null,
      max: daily.temperature_2m_max ? daily.temperature_2m_max[index] : null,
      min: daily.temperature_2m_min ? daily.temperature_2m_min[index] : null,
      rainChance: daily.precipitation_probability_max ? daily.precipitation_probability_max[index] : null,
      rain: daily.precipitation_sum ? daily.precipitation_sum[index] : null,
      uv: daily.uv_index_max ? daily.uv_index_max[index] : null,
      sunrise: daily.sunrise ? daily.sunrise[index] : null,
      sunset: daily.sunset ? daily.sunset[index] : null
    }));
    const current = data.current || {};
    return {
      timezone: typeof data.timezone === 'string' ? data.timezone : null,
      offset: Number(data.utc_offset_seconds) || 0,
      current: {
        temp: current.temperature_2m,
        feels: current.apparent_temperature,
        humidity: current.relative_humidity_2m,
        code: current.weather_code,
        wind: current.wind_speed_10m,
        day: current.is_day !== 0
      },
      days
    };
  });
}

function shiftYear(iso, years) {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(y - years, m - 1, Math.min(d, 28)));
  if (d > 28) date.setUTCDate(Math.min(d, new Date(Date.UTC(y - years, m, 0)).getUTCDate()));
  return date.toISOString().slice(0, 10);
}

export async function fetchClimate(lat, lon, from, to) {
  const key = `${roundCoord(lat)},${roundCoord(lon)}|${from.slice(5)}|${to.slice(5)}`;
  return withCache('climate', key, 30 * DAY, 20, async () => {
    const results = await Promise.all([1, 2, 3].map(async (years) => {
      const params = new URLSearchParams({
        latitude: roundCoord(lat),
        longitude: roundCoord(lon),
        start_date: shiftYear(from, years),
        end_date: shiftYear(to, years),
        daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum',
        timezone: 'auto'
      });
      try {
        const data = await request(`https://archive-api.open-meteo.com/v1/archive?${params}`, {}, 15000);
        return data.daily || null;
      } catch (error) {
        if (error.code === 'offline') throw error;
        return null;
      }
    }));
    const max = [];
    const min = [];
    const rain = [];
    for (const daily of results.filter(Boolean)) {
      (daily.temperature_2m_max || []).forEach((value) => Number.isFinite(value) && max.push(value));
      (daily.temperature_2m_min || []).forEach((value) => Number.isFinite(value) && min.push(value));
      (daily.precipitation_sum || []).forEach((value) => Number.isFinite(value) && rain.push(value));
    }
    if (!max.length) throw new ApiError('server');
    const average = (list) => list.reduce((sum, value) => sum + value, 0) / list.length;
    return {
      years: results.filter(Boolean).length,
      max: average(max),
      min: average(min),
      rain: rain.length ? average(rain) : null,
      rainyShare: rain.length ? rain.filter((value) => value >= 1).length / rain.length : null
    };
  });
}

export async function fetchRates() {
  return withCache('rates', 'EUR', 12 * HOUR, 1, async () => {
    const data = await request('https://open.er-api.com/v6/latest/EUR', {}, 10000);
    if (!data || data.result !== 'success' || !data.rates) throw new ApiError('server');
    return { time: Number(data.time_last_update_unix) * 1000 || Date.now(), rates: data.rates };
  });
}

function warningEntries(data) {
  const root = data && typeof data === 'object' ? (data.response && typeof data.response === 'object' ? data.response : data) : {};
  const list = [];
  for (const [id, value] of Object.entries(root)) {
    if (!value || typeof value !== 'object' || !value.countryCode) continue;
    const modified = Number(value.lastModified);
    list.push({
      id,
      code: String(value.countryCode).toLowerCase(),
      warning: value.warning === true,
      partial: value.partialWarning === true,
      situation: value.situationWarning === true,
      situationPart: value.situationPartWarning === true,
      modified: Number.isFinite(modified) && modified > 0 ? (modified < 1e12 ? modified * 1000 : modified) : null
    });
  }
  return list;
}

export async function fetchTravelWarning(code) {
  const id = String(code || '').toLowerCase();
  const list = await withCache('advice', 'all', 6 * HOUR, 1, async () => {
    const data = await request('https://www.auswaertiges-amt.de/opendata/travelwarning', { headers: { Accept: 'application/json' } }, 12000);
    const entries = warningEntries(data);
    if (!entries.length) throw new ApiError('server');
    return entries;
  });
  return list.find((entry) => entry.code === id) || null;
}

