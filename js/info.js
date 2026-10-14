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

export async function wikidataLinks(id) {
  if (!/^Q\d+$/.test(id || '')) return { wiki: {}, voyage: {} };
  return withCache('links', id, 30 * DAY, 60, async () => {
    const params = new URLSearchParams({
      action: 'wbgetentities',
      ids: id,
      props: 'sitelinks',
      sitefilter: LANGS.flatMap((lang) => [`${lang}wiki`, `${lang}wikivoyage`]).join('|'),
      format: 'json',
      origin: '*'
    });
    const data = await request(`https://www.wikidata.org/w/api.php?${params}`, {}, 10000);
    const links = (data && data.entities && data.entities[id] && data.entities[id].sitelinks) || {};
    const result = { wiki: {}, voyage: {} };
    for (const lang of LANGS) {
      if (links[`${lang}wiki`]) result.wiki[lang] = links[`${lang}wiki`].title;
      if (links[`${lang}wikivoyage`]) result.voyage[lang] = links[`${lang}wikivoyage`].title;
    }
    return result;
  });
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
    extract: trimText(data.extract, 1100),
    image: httpsUrl(data.thumbnail && data.thumbnail.source),
    url: httpsUrl((data.content_urls && data.content_urls.mobile && data.content_urls.mobile.page) || (data.content_urls && data.content_urls.desktop && data.content_urls.desktop.page)),
    lang
  };
}

export async function fetchSummary(place, lang) {
  const key = `${lang}|${place.wikidata || `${place.name}|${place.lat.toFixed(2)},${place.lon.toFixed(2)}`}`;
  return withCache('summary', key, 7 * DAY, 20, async () => {
    let title = null;
    let wikiLang = lang;
    if (place.wikidata) {
      const links = await wikidataLinks(place.wikidata);
      title = links.wiki[lang] || null;
      if (!title && links.wiki.en) {
        title = links.wiki.en;
        wikiLang = 'en';
      }
    }
    if (!title) title = await searchWikipedia(lang, [place.name, place.countryName].filter(Boolean).join(' '));
    if (!title) return null;
    return wikipediaSummary(wikiLang, title);
  });
}

export async function fetchSightSummary(item, lang) {
  const key = `${lang}|${item.wikidata || item.wikiTitle || item.id}`;
  return withCache('sightSummary', key, 7 * DAY, 40, async () => {
    if (item.wikiTitle && item.wikiLang === lang) return wikipediaSummary(lang, item.wikiTitle);
    if (!item.wikidata) return null;
    const links = await wikidataLinks(item.wikidata);
    if (links.wiki[lang]) return wikipediaSummary(lang, links.wiki[lang]);
    if (links.wiki.en) return wikipediaSummary('en', links.wiki.en);
    return null;
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

export async function fetchCountry(code) {
  const id = String(code || '').toLowerCase();
  if (!/^[a-z]{2}$/.test(id)) throw new ApiError('server');
  return withCache('country', id, 30 * DAY, 30, async () => {
    const fields = 'name,translations,capital,currencies,languages,idd,timezones,car,population,cca2';
    const raw = await request(`https://restcountries.com/v3.1/alpha/${id}?fields=${fields}`, {}, 12000);
    const data = Array.isArray(raw) ? raw[0] : raw;
    if (!data || !data.name) throw new ApiError('server');
    const translations = data.translations || {};
    const suffixes = (data.idd && Array.isArray(data.idd.suffixes)) ? data.idd.suffixes : [];
    return {
      code: id,
      names: {
        en: data.name.common || null,
        de: (translations.deu && translations.deu.common) || data.name.common || null,
        es: (translations.spa && translations.spa.common) || data.name.common || null
      },
      capital: Array.isArray(data.capital) ? data.capital[0] || null : null,
      currencies: Object.entries(data.currencies || {}).map(([currency, info]) => ({ code: currency, name: info && info.name, symbol: info && info.symbol })),
      languages: Object.entries(data.languages || {}).map(([language, name]) => ({ code: language, name })),
      calling: data.idd && data.idd.root ? `${data.idd.root}${suffixes.length === 1 ? suffixes[0] : ''}` : null,
      timezones: Array.isArray(data.timezones) ? data.timezones.slice(0, 6) : [],
      side: data.car && data.car.side === 'left' ? 'left' : 'right',
      population: Number(data.population) || null
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

const GUIDE_SECTIONS = {
  safety: /^(stay safe|sicherheit|seguridad|mantente seguro|precauciones)/i,
  around: /^(get around|mobilität|unterwegs|cómo moverse|moverse|desplazarse)/i,
  eat: /^(eat|küche|essen|comer|gastronomía)/i,
  drink: /^(drink|nachtleben|ausgehen|beber|salir|vida nocturna)/i,
  respect: /^(respect|respekt|verhalten|umgangsformen|respeto)/i,
  health: /^(stay healthy|gesundheit|salud)/i
};
const COUNTRY_FALLBACK = ['safety', 'respect', 'health'];

function htmlToText(html, max) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('h1,h2,h3,h4,h5,.mw-editsection,table,style,script,figure,.thumb,.noprint,sup,.mw-empty-elt,.pp_infobox,.listing-metadata').forEach((node) => node.remove());
  const parts = [];
  for (const node of doc.querySelectorAll('p, li, dd')) {
    if (node.closest('li') && node.tagName !== 'LI') continue;
    if (node.tagName === 'LI' && node.parentElement && node.parentElement.closest('li')) continue;
    const text = node.textContent.replace(/\s+/g, ' ').trim();
    if (text.length < 3) continue;
    parts.push(node.tagName === 'LI' ? `• ${trimText(text, 180)}` : text);
    if (parts.join('\n').length > max) break;
  }
  const joined = parts.join('\n');
  return joined.length > max ? `${joined.slice(0, max).replace(/\s+\S*$/, '')} …` : joined;
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
  return typeof html === 'string' ? htmlToText(html, 1100) : '';
}

function pageUrl(lang, title, anchor = null) {
  const path = encodeURIComponent(title.replace(/ /g, '_'));
  return `https://${lang}.wikivoyage.org/wiki/${path}${anchor ? `#${encodeURIComponent(anchor.replace(/ /g, '_'))}` : ''}`;
}

async function readGuide(lang, title, keys) {
  const page = await guideSections(lang, title);
  if (!page) return null;
  const result = { title: page.title, url: pageUrl(lang, page.title), sections: {} };
  await Promise.all(keys.map(async (key) => {
    const section = page.sections.find((item) => Number(item.toclevel) === 1 && GUIDE_SECTIONS[key].test(String(item.line || '').replace(/<[^>]*>/g, '').trim()));
    if (!section) return;
    const text = await guideSection(lang, page.title, section.index);
    if (text) {
      const heading = String(section.line).replace(/<[^>]*>/g, '').trim();
      result.sections[key] = { text, heading, url: pageUrl(lang, page.title, section.anchor || heading) };
    }
  }));
  return result;
}

export async function fetchGuide(place, lang, countryName = null) {
  const key = `${lang}|${place.wikidata || `${place.name}|${place.lat.toFixed(1)},${place.lon.toFixed(1)}`}`;
  return withCache('guide', key, 7 * DAY, 10, async () => {
    let title = null;
    if (place.wikidata) {
      const links = await wikidataLinks(place.wikidata);
      title = links.voyage[lang] || null;
    }
    const keys = Object.keys(GUIDE_SECTIONS);
    let city = null;
    try {
      city = await readGuide(lang, title || place.name, keys);
    } catch (error) {
      if (error.code === 'offline') throw error;
    }
    const missing = COUNTRY_FALLBACK.filter((item) => !city || !city.sections[item]);
    let country = null;
    if (countryName && missing.length && countryName !== place.name) {
      try {
        country = await readGuide(lang, countryName, missing);
      } catch (error) {
        if (error.code === 'offline') throw error;
      }
    }
    if (!city && !country) return null;
    const sections = {};
    for (const item of keys) {
      if (city && city.sections[item]) sections[item] = { ...city.sections[item], source: city.title };
      else if (country && country.sections[item]) sections[item] = { ...country.sections[item], source: country.title };
    }
    return { title: city ? city.title : country.title, url: city ? city.url : country.url, sections };
  });
}

const SIGHT_RULES = [
  { key: 'tourism', values: ['attraction', 'museum', 'viewpoint', 'gallery', 'zoo', 'theme_park', 'aquarium'] },
  { key: 'historic', values: ['monument', 'castle', 'fort', 'ruins', 'archaeological_site', 'memorial', 'city_gate', 'building', 'manor', 'monastery', 'church', 'citywalls'], wikidata: true },
  { key: 'natural', values: ['beach', 'waterfall', 'bay'] },
  { key: 'natural', values: ['peak', 'volcano', 'cave_entrance'], wikidata: true },
  { key: 'leisure', values: ['park', 'nature_reserve', 'garden'], wikidata: true },
  { key: 'amenity', values: ['place_of_worship'], wikidata: true },
  { key: 'boundary', values: ['national_park', 'protected_area'], wikidata: true }
];
export const SIGHT_TYPES = ['attraction', 'museum', 'history', 'religion', 'nature', 'beach', 'viewpoint', 'fun'];

function sightType(tags) {
  if (tags.tourism === 'museum' || tags.tourism === 'gallery') return 'museum';
  if (tags.tourism === 'viewpoint') return 'viewpoint';
  if (['zoo', 'theme_park', 'aquarium'].includes(tags.tourism)) return 'fun';
  if (tags.natural === 'beach' || tags.natural === 'bay') return 'beach';
  if (tags.natural || tags.leisure || tags.boundary) return 'nature';
  if (tags.amenity === 'place_of_worship' || tags.historic === 'church' || tags.historic === 'monastery') return 'religion';
  if (tags.historic) return 'history';
  return 'attraction';
}

function sightQuery(lat, lon, radius) {
  const around = `(around:${Math.round(radius)},${lat.toFixed(5)},${lon.toFixed(5)})`;
  const parts = SIGHT_RULES.map((rule) => {
    const value = rule.values.length === 1 ? `="${rule.values[0]}"` : `~"^(${rule.values.join('|')})$"`;
    return `nwr["${rule.key}"${value}]["name"]${rule.wikidata ? '["wikidata"]' : ''}${around};`;
  });
  return `[out:json][timeout:20];(${parts.join('')});out tags center 400;`;
}

async function sightLinks(ids, lang) {
  if (!ids.length) return new Map();
  const values = ids.map((id) => `wd:${id}`).join(' ');
  const query = `SELECT ?item ?links ?image ?title WHERE { VALUES ?item { ${values} } ?item wikibase:sitelinks ?links. OPTIONAL { ?item wdt:P18 ?image. } OPTIONAL { ?article schema:about ?item; schema:isPartOf <https://${lang}.wikipedia.org/>; schema:name ?title. } }`;
  const data = await request(`https://query.wikidata.org/sparql?${new URLSearchParams({ query, format: 'json' })}`, { headers: { Accept: 'application/sparql-results+json' } }, 15000);
  const result = new Map();
  for (const row of (data && data.results && data.results.bindings) || []) {
    const id = String(row.item && row.item.value || '').split('/').pop();
    if (!/^Q\d+$/.test(id)) continue;
    const previous = result.get(id) || {};
    result.set(id, {
      links: Number(row.links && row.links.value) || previous.links || 0,
      image: previous.image || (row.image ? httpsUrl(row.image.value) : null),
      title: previous.title || (row.title ? row.title.value : null)
    });
  }
  return result;
}

export async function fetchSights(place, lang, radius, signal = null) {
  const key = `${lang}|${place.lat.toFixed(2)},${place.lon.toFixed(2)}|${Math.round(radius / 1000)}`;
  return withCache('sights', key, DAY, 6, async () => {
    const elements = await queryOverpass(sightQuery(place.lat, place.lon, radius), signal, null, { patient: false, timeout: 22000 });
    const seen = new Set();
    const items = [];
    for (const element of elements) {
      const tags = element.tags || {};
      const position = coordinates(element);
      const name = typeof tags.name === 'string' ? tags.name.trim().slice(0, 120) : '';
      if (!position || !name) continue;
      const wikidata = /^Q\d+$/.test(tags.wikidata || '') ? tags.wikidata : null;
      const dedupe = wikidata || `${name.toLowerCase()}|${position.lat.toFixed(3)},${position.lon.toFixed(3)}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      const wikipedia = typeof tags.wikipedia === 'string' ? /^([a-z]{2,3}):(.+)$/.exec(tags.wikipedia) : null;
      items.push({
        id: `${element.type}/${element.id}`,
        kind: 'sight',
        type: sightType(tags),
        name,
        lat: position.lat,
        lon: position.lon,
        wikidata,
        wikiTitle: wikipedia && wikipedia[1] === lang ? wikipedia[2].slice(0, 200) : null,
        wikiLang: wikipedia && wikipedia[1] === lang ? lang : null,
        popularity: wikidata ? 1 : wikipedia ? 0.8 : ['attraction', 'museum'].includes(tags.tourism) ? 0.5 : 0,
        image: null,
        photo: photoSource(tags),
        openingHours: typeof tags.opening_hours === 'string' ? tags.opening_hours.slice(0, 120) : null,
        fee: tags.fee === 'no' ? 'no' : tags.fee === 'yes' ? 'yes' : null,
        website: typeof tags.website === 'string' && /^https?:\/\//i.test(tags.website) ? tags.website.slice(0, 300) : null
      });
    }
    const ids = items.filter((item) => item.wikidata).map((item) => item.wikidata).slice(0, 180);
    let links = new Map();
    try {
      links = await sightLinks(ids, lang);
    } catch (error) {
      if (error.code === 'aborted' || error.code === 'offline') throw error;
    }
    for (const item of items) {
      const info = item.wikidata ? links.get(item.wikidata) : null;
      if (!info) continue;
      item.popularity = 1 + info.links;
      if (info.image) item.image = `${info.image}${info.image.includes('?') ? '&' : '?'}width=320`;
      if (info.title) {
        item.wikiTitle = info.title;
        item.wikiLang = lang;
      }
    }
    items.sort((a, b) => b.popularity - a.popularity || a.name.localeCompare(b.name));
    return items.slice(0, 80);
  });
}
