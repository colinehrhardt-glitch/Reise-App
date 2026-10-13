import { load, save } from './storage.js';

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const WIKIDATA_URL = 'https://www.wikidata.org/w/api.php';
const OVERPASS_URLS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter'
];
const NOMINATIM_INTERVAL = 1100;
const CACHE_TTL = 12 * 60 * 60 * 1000;
const CACHE_SIZE = 40;
const BBOX_PADDING = 0.1;
const FIRST_TIMEOUT = 20000;
const RETRY_TIMEOUT = 25000;
const MAX_SLOT_WAIT = 30;
const FALLBACK_TYPES = [['hotel', 'hotel'], ['hostel', 'hostel'], ['guest house', 'guest_house'], ['motel', 'motel']];
const PERSIST_KEY = 'areaCache';
const PERSIST_MAX = 4;
const PERSIST_ITEMS = 1500;

export const ACCOMMODATION_TYPES = ['hotel', 'hostel', 'guest_house', 'apartment', 'motel'];

export const CATEGORIES = {
  accommodation: { rules: [{ key: 'tourism', values: ACCOMMODATION_TYPES }], limit: 1000 },
  money: { rules: [{ key: 'amenity', values: ['atm', 'bank', 'bureau_de_change'] }], limit: 400 },
  shopping: { rules: [{ key: 'shop', values: ['supermarket', 'convenience', 'kiosk'] }], limit: 400 },
  health: { rules: [{ key: 'amenity', values: ['pharmacy', 'hospital', 'clinic', 'doctors'] }], limit: 400 },
  food: { rules: [{ key: 'amenity', values: ['restaurant', 'cafe', 'fast_food'] }], limit: 600 },
  transport: {
    rules: [
      { key: 'aeroway', values: ['aerodrome'], require: 'iata', type: 'airport' },
      { key: 'railway', values: ['station'], exclude: ['subway', 'light_rail', 'monorail', 'funicular', 'miniature'], type: 'train_station' },
      { key: 'amenity', values: ['bus_station'] },
      { key: 'amenity', values: ['ferry_terminal'] }
    ],
    limit: 400
  }
};

export const POI_CATEGORIES = ['transport', 'money', 'shopping', 'health', 'food'];

function ruleFilter(rule) {
  const value = rule.values.length === 1 ? `="${rule.values[0]}"` : `~"^(${rule.values.join('|')})$"`;
  const require = rule.require ? `["${rule.require}"]` : '';
  const exclude = rule.exclude ? `["station"!~"^(${rule.exclude.join('|')})$"]` : '';
  return `nwr["${rule.key}"${value}]${require}${exclude}`;
}

export function classify(tags, category) {
  for (const rule of CATEGORIES[category].rules) {
    if (!rule.values.includes(tags[rule.key])) continue;
    if (rule.require && !tags[rule.require]) continue;
    if (rule.exclude && rule.exclude.includes(tags.station)) continue;
    return rule.type || tags[rule.key];
  }
  return null;
}

export class ApiError extends Error {
  constructor(code, status = 0) {
    super(code);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

const nominatimCache = new Map();
const photoCache = new Map();
const overpassCache = restoreCache();
let preferredEndpoint = Math.min(OVERPASS_URLS.length - 1, Math.max(0, Number(load('overpassEndpoint', 0)) || 0));
let lastNominatimCall = 0;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function request(url, options = {}, timeout = 30000, signal = null) {
  if (signal && signal.aborted) throw new ApiError('aborted');
  if (navigator.onLine === false) throw new ApiError('offline');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  const cancel = () => controller.abort();
  if (signal) signal.addEventListener('abort', cancel, { once: true });
  try {
    let response;
    try {
      response = await fetch(url, { ...options, signal: controller.signal });
    } catch (error) {
      if (signal && signal.aborted) throw new ApiError('aborted');
      if (error.name === 'AbortError') throw new ApiError('timeout');
      throw new ApiError(navigator.onLine === false ? 'offline' : 'network');
    }
    if (response.status === 429) throw new ApiError('busy', 429);
    if (response.status === 504 || response.status === 503) throw new ApiError('busy', response.status);
    if (response.status === 408) throw new ApiError('timeout', response.status);
    if (!response.ok) throw new ApiError('server', response.status);
    try {
      return await response.json();
    } catch (error) {
      if (signal && signal.aborted) throw new ApiError('aborted');
      if (error.name === 'AbortError') throw new ApiError('timeout');
      throw new ApiError('server', response.status);
    }
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', cancel);
  }
}

export async function searchPlaces(query, lang, { countries = [] } = {}) {
  const codes = countries.map((code) => code.toLowerCase()).sort().join(',');
  const key = `${lang}|${codes}|${query.trim().toLowerCase()}`;
  if (nominatimCache.has(key)) return nominatimCache.get(key);

  const wait = lastNominatimCall + NOMINATIM_INTERVAL - Date.now();
  if (wait > 0) await sleep(wait);
  lastNominatimCall = Date.now();

  const params = new URLSearchParams({
    q: query.trim(),
    format: 'jsonv2',
    limit: '5',
    'accept-language': lang
  });
  if (codes) params.set('countrycodes', codes);
  const data = await request(`${NOMINATIM_URL}?${params}`, { headers: { Accept: 'application/json' } }, 15000);
  const results = dedupeResults((Array.isArray(data) ? data : []).map(normalizeSearchResult).filter(Boolean));
  nominatimCache.set(key, results);
  return results;
}

function normalizeSearchResult(item) {
  const lat = Number(item.lat);
  const lon = Number(item.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const display = String(item.display_name || '');
  const name = item.name || display.split(',')[0] || display;
  const detail = display.startsWith(name) ? display.slice(name.length).replace(/^,\s*/, '') : display;
  const box = Array.isArray(item.boundingbox) ? item.boundingbox.map(Number) : null;
  return {
    id: String(item.place_id ?? `${lat},${lon}`),
    name,
    detail,
    lat,
    lon,
    rank: Number(item.place_rank) || 0,
    kind: String(item.addresstype || item.type || ''),
    importance: Number(item.importance) || 0,
    bounds: box && box.every(Number.isFinite)
      ? { south: box[0], north: box[1], west: box[2], east: box[3] }
      : null
  };
}

function roughKm(a, b) {
  const x = (b.lon - a.lon) * Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180);
  const y = b.lat - a.lat;
  return Math.sqrt(x * x + y * y) * 111.2;
}

function dedupeResults(results) {
  const kept = [];
  for (const result of results) {
    const name = result.name.toLowerCase();
    const duplicate = kept.some((other) => other.name.toLowerCase() === name
      && (other.detail === result.detail || roughKm(other, result) < 15));
    if (!duplicate) kept.push(result);
  }
  return kept;
}

function padBounds(bounds) {
  const latPad = (bounds.north - bounds.south) * BBOX_PADDING;
  const lonPad = (bounds.east - bounds.west) * BBOX_PADDING;
  return {
    south: Math.max(-90, bounds.south - latPad),
    north: Math.min(90, bounds.north + latPad),
    west: Math.max(-180, bounds.west - lonPad),
    east: Math.min(180, bounds.east + lonPad)
  };
}

function contains(outer, inner) {
  return outer.south <= inner.south && outer.north >= inner.north && outer.west <= inner.west && outer.east >= inner.east;
}

function isInside(item, bounds) {
  return item.lat >= bounds.south && item.lat <= bounds.north && item.lon >= bounds.west && item.lon <= bounds.east;
}

function buildQuery(categories, bounds) {
  const box = [bounds.south, bounds.west, bounds.north, bounds.east].map((value) => value.toFixed(5)).join(',');
  const parts = categories.map((category, index) => {
    const { rules, limit } = CATEGORIES[category];
    const union = rules.map((rule) => `${ruleFilter(rule)}(${box});`).join('');
    return `(${union})->.s${index};.s${index} out tags center qt ${limit};`;
  });
  return `[out:json][timeout:22];${parts.join('')}`;
}

function abortableSleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) {
      reject(new ApiError('aborted'));
      return;
    }
    const timer = setTimeout(() => {
      if (signal) signal.removeEventListener('abort', stop);
      resolve();
    }, ms);
    const stop = () => {
      clearTimeout(timer);
      reject(new ApiError('aborted'));
    };
    if (signal) signal.addEventListener('abort', stop, { once: true });
  });
}

async function slotWait(index, signal) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  const cancel = () => controller.abort();
  if (signal) signal.addEventListener('abort', cancel, { once: true });
  try {
    const response = await fetch(OVERPASS_URLS[index].replace(/interpreter$/, 'status'), { signal: controller.signal });
    const text = await response.text();
    if (/\d+\s+slots?\s+available\s+now/i.test(text)) return 1;
    const waits = [...text.matchAll(/in\s+(-?\d+)\s+seconds?/gi)].map((match) => Number(match[1]));
    return waits.length ? Math.min(MAX_SLOT_WAIT, Math.max(1, Math.min(...waits) + 1)) : 10;
  } catch {
    if (signal && signal.aborted) throw new ApiError('aborted');
    return 10;
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', cancel);
  }
}

async function overpassAttempt(index, query, timeout, signal) {
  const data = await request(OVERPASS_URLS[index], {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
    body: `data=${encodeURIComponent(query)}`
  }, timeout, signal);
  const remark = String(data.remark || '');
  if (/timed out|timeout/i.test(remark)) throw new ApiError('timeout');
  if (/out of memory|too many|rate_limited|too busy/i.test(remark)) throw new ApiError('busy');
  if (index !== preferredEndpoint) {
    preferredEndpoint = index;
    save('overpassEndpoint', index);
  }
  return Array.isArray(data.elements) ? data.elements : [];
}

async function queryOverpass(query, signal, onWait, { patient = true } = {}) {
  let lastError = null;
  let allBusy = true;
  const order = [preferredEndpoint, ...OVERPASS_URLS.keys()].filter((index, position, list) => list.indexOf(index) === position);
  for (const [attempt, index] of order.entries()) {
    try {
      return await overpassAttempt(index, query, attempt === 0 ? FIRST_TIMEOUT : RETRY_TIMEOUT, signal);
    } catch (error) {
      lastError = error instanceof ApiError ? error : new ApiError('server');
      if (lastError.code === 'offline' || lastError.code === 'aborted') throw lastError;
      if (lastError.code !== 'busy') allBusy = false;
    }
  }
  if (allBusy && patient) {
    const seconds = await slotWait(preferredEndpoint, signal);
    if (onWait) onWait(seconds);
    await abortableSleep(seconds * 1000, signal);
    return overpassAttempt(preferredEndpoint, query, RETRY_TIMEOUT, signal);
  }
  throw lastError || new ApiError('server');
}

function fallbackTags(item, tourism) {
  const address = item.address || {};
  const tags = { ...(item.extratags || {}), tourism, name: item.name || '' };
  if (address.road) tags['addr:street'] = address.road;
  if (address.house_number) tags['addr:housenumber'] = address.house_number;
  if (address.postcode) tags['addr:postcode'] = address.postcode;
  const city = address.city || address.town || address.village;
  if (city) tags['addr:city'] = city;
  return tags;
}

export async function fetchAccommodationsFallback(bounds, lang, signal = null) {
  const places = new Map();
  for (const [phrase, tourism] of FALLBACK_TYPES) {
    if (signal && signal.aborted) throw new ApiError('aborted');
    const wait = lastNominatimCall + NOMINATIM_INTERVAL - Date.now();
    if (wait > 0) await abortableSleep(wait, signal);
    lastNominatimCall = Date.now();
    const params = new URLSearchParams({
      q: phrase,
      format: 'jsonv2',
      limit: '40',
      bounded: '1',
      viewbox: [bounds.west, bounds.north, bounds.east, bounds.south].map((value) => value.toFixed(5)).join(','),
      extratags: '1',
      addressdetails: '1',
      'accept-language': lang
    });
    let data = [];
    try {
      data = await request(`${NOMINATIM_URL}?${params}`, { headers: { Accept: 'application/json' } }, 12000, signal);
    } catch (error) {
      if (error.code === 'aborted' || error.code === 'offline') throw error;
      continue;
    }
    for (const item of Array.isArray(data) ? data : []) {
      if (item.category !== 'tourism' || item.type !== tourism) continue;
      const element = { type: item.osm_type, id: item.osm_id, lat: Number(item.lat), lon: Number(item.lon), tags: fallbackTags(item, tourism) };
      const place = normalizeAccommodation(element);
      if (place && isInside(place, bounds)) places.set(place.id, place);
    }
  }
  return [...places.values()];
}

function validBounds(value) {
  return value && ['south', 'north', 'west', 'east'].every((key) => Number.isFinite(value[key]));
}

function restoreCache() {
  const raw = load(PERSIST_KEY, []);
  if (!Array.isArray(raw)) return [];
  const now = Date.now();
  return raw.filter((entry) => entry && entry.category === 'accommodation'
    && validBounds(entry.bounds) && validBounds(entry.query) && Array.isArray(entry.items)
    && Number.isFinite(entry.time) && now - entry.time < CACHE_TTL);
}

function persistCache() {
  const entries = overpassCache
    .filter((entry) => entry.category === 'accommodation' && entry.items.length <= PERSIST_ITEMS)
    .slice(-PERSIST_MAX);
  while (entries.length && !save(PERSIST_KEY, entries)) entries.shift();
}

function findCached(category, bounds) {
  return overpassCache.find((entry) => entry.category === category
    && contains(entry.bounds, bounds)
    && (!entry.truncated || contains(bounds, entry.query)));
}

export async function fetchCategories(categories, bounds, { signal = null, onWait = null } = {}) {
  const now = Date.now();
  for (let i = overpassCache.length - 1; i >= 0; i -= 1) {
    if (now - overpassCache[i].time > CACHE_TTL) overpassCache.splice(i, 1);
  }

  const result = {};
  const missing = [];
  for (const category of categories) {
    const hit = findCached(category, bounds);
    if (hit) result[category] = { items: hit.items.filter((item) => isInside(item, bounds)), truncated: hit.truncated };
    else missing.push(category);
  }
  if (!missing.length) return result;

  const padded = padBounds(bounds);
  const elements = await queryOverpass(buildQuery(missing, padded), signal, onWait);
  const grouped = Object.fromEntries(missing.map((category) => [category, new Map()]));
  for (const element of elements) {
    const tags = element.tags || {};
    for (const category of missing) {
      const type = classify(tags, category);
      if (!type) continue;
      const id = `${element.type}/${element.id}`;
      if (grouped[category].has(id)) continue;
      const item = category === 'accommodation' ? normalizeAccommodation(element) : normalizePoi(element, category, type);
      if (item) grouped[category].set(id, item);
    }
  }
  for (const category of missing) {
    const items = [...grouped[category].values()];
    const truncated = items.length >= CATEGORIES[category].limit;
    overpassCache.push({ category, bounds: padded, query: bounds, items, truncated, time: now });
    result[category] = { items: items.filter((item) => isInside(item, bounds)), truncated };
  }
  while (overpassCache.length > CACHE_SIZE) overpassCache.shift();
  if (missing.includes('accommodation')) persistCache();
  return result;
}

function coordinates(element) {
  const lat = element.lat ?? element.center?.lat;
  const lon = element.lon ?? element.center?.lon;
  return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
}

function normalizeAccommodation(element) {
  const tags = element.tags || {};
  const position = coordinates(element);
  if (!position) return null;
  return {
    id: `${element.type}/${element.id}`,
    kind: 'accommodation',
    type: tags.tourism,
    name: cleanText(tags.name) || null,
    lat: position.lat,
    lon: position.lon,
    stars: parseStars(tags.stars),
    address: formatAddress(tags),
    city: cleanText(tags['addr:city']) || cleanText(tags['addr:postcode']) || null,
    website: safeUrl(tags.website || tags['contact:website'] || tags.url),
    phone: firstValue(tags.phone || tags['contact:phone'] || tags['contact:mobile']),
    email: safeEmail(tags.email || tags['contact:email']),
    description: descriptions(tags),
    photo: photoSource(tags),
    facts: accommodationFacts(tags)
  };
}

function normalizePoi(element, category, type) {
  const tags = element.tags || {};
  const position = coordinates(element);
  if (!position) return null;
  return {
    id: `${element.type}/${element.id}`,
    kind: 'poi',
    category,
    type,
    name: cleanText(tags.name) || null,
    lat: position.lat,
    lon: position.lon,
    operator: cleanText(tags.operator || tags.brand) || null,
    openingHours: cleanText(tags.opening_hours) || null,
    address: formatAddress(tags),
    website: safeUrl(tags.website || tags['contact:website'] || tags.url),
    phone: firstValue(tags.phone || tags['contact:phone']),
    facts: poiFacts(tags)
  };
}

function accommodationFacts(tags) {
  const facts = {};
  const rooms = parseInt(tags.rooms, 10);
  const beds = parseInt(tags.beds, 10);
  if (rooms > 0 && rooms < 10000) facts.rooms = rooms;
  if (beds > 0 && beds < 10000) facts.beds = beds;
  const checkIn = cleanText(tags.check_in || tags.checkin).slice(0, 20);
  const checkOut = cleanText(tags.check_out || tags.checkout).slice(0, 20);
  if (checkIn) facts.checkIn = checkIn;
  if (checkOut) facts.checkOut = checkOut;
  if (/^(wlan|yes|wifi)$/i.test(tags.internet_access || '')) facts.wifi = tags['internet_access:fee'] === 'no' ? 'free' : 'yes';
  if (tags.wheelchair === 'yes' || tags.wheelchair === 'limited') facts.wheelchair = tags.wheelchair;
  if (tags.smoking === 'no') facts.nonSmoking = true;
  return facts;
}

function poiFacts(tags) {
  const facts = {};
  if (tags.wheelchair === 'yes' || tags.wheelchair === 'limited') facts.wheelchair = tags.wheelchair;
  if (tags.opening_hours === '24/7') facts.allDay = true;
  if (tags.emergency === 'yes') facts.emergency = true;
  if (tags.amenity === 'bank' && tags.atm === 'yes') facts.atm = true;
  if (tags.amenity === 'atm' && (tags.fee === 'no' || tags.fee === 'yes')) facts.fee = tags.fee;
  if (tags.aeroway === 'aerodrome' && /^[A-Z]{3}$/.test(tags.iata || '')) facts.iata = tags.iata;
  return facts;
}

function descriptions(tags) {
  const result = {};
  for (const lang of ['de', 'en', 'es']) {
    const text = cleanText(tags[`description:${lang}`]);
    if (text) result[lang] = text;
  }
  const fallback = cleanText(tags.description);
  if (fallback) result.default = fallback;
  return Object.keys(result).length ? result : null;
}

function photoSource(tags) {
  const commons = cleanText(tags.wikimedia_commons);
  if (/^File:/i.test(commons)) return { kind: 'commons', value: commons };
  const image = cleanText(tags.image);
  if (image) {
    if (/^File:/i.test(image)) return { kind: 'commons', value: image };
    const match = /commons\.wikimedia\.org\/wiki\/(File:[^?#]+)/i.exec(image);
    if (match) {
      try {
        return { kind: 'commons', value: decodeURIComponent(match[1]) };
      } catch {
        return null;
      }
    }
    if (/^https:\/\/\S+\.(jpe?g|png|webp)(\?\S*)?$/i.test(image)) return { kind: 'url', value: image };
  }
  const wikidata = cleanText(tags.wikidata);
  if (/^Q\d+$/.test(wikidata)) return { kind: 'wikidata', value: wikidata };
  return null;
}

function commonsPhoto(file) {
  const name = String(file).replace(/^(File|Datei|Image|Archivo):/i, '').trim();
  if (!name) return null;
  return {
    src: `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(name)}?width=640`,
    link: `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(name.replace(/ /g, '_'))}`,
    credit: 'Wikimedia Commons'
  };
}

export async function fetchPhoto(source) {
  if (!source) return null;
  const key = `${source.kind}:${source.value}`;
  if (photoCache.has(key)) return photoCache.get(key);
  let photo = null;
  if (source.kind === 'url') {
    let host = '';
    try {
      host = new URL(source.value).hostname.replace(/^www\./, '');
    } catch {
      return null;
    }
    photo = { src: source.value, link: source.value, credit: host };
  } else if (source.kind === 'commons') {
    photo = commonsPhoto(source.value);
  } else if (source.kind === 'wikidata') {
    const params = new URLSearchParams({
      action: 'wbgetclaims',
      entity: source.value,
      property: 'P18',
      format: 'json',
      origin: '*'
    });
    const data = await request(`${WIKIDATA_URL}?${params}`, {}, 10000);
    const file = data?.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
    photo = typeof file === 'string' ? commonsPhoto(file) : null;
  }
  photoCache.set(key, photo);
  return photo;
}

function cleanText(value) {
  return typeof value === 'string' ? value.trim().slice(0, 300) : '';
}

function firstValue(value) {
  return cleanText(String(value || '').split(';')[0]) || null;
}

function safeEmail(value) {
  const email = firstValue(value);
  return email && /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(email) ? email : null;
}

function parseStars(value) {
  const match = /^\s*(\d(?:[.,]5)?)\s*(s)?\s*$/i.exec(String(value || ''));
  if (!match) return null;
  const count = Number(match[1].replace(',', '.'));
  if (!(count >= 1 && count <= 7)) return null;
  return { count, superior: Boolean(match[2]) };
}

function formatAddress(tags) {
  const street = [tags['addr:street'] || tags['addr:place'], tags['addr:housenumber']].filter(Boolean).join(' ');
  const city = [tags['addr:postcode'], tags['addr:city']].filter(Boolean).join(' ');
  const full = [street, city].filter(Boolean).join(', ');
  return cleanText(full || tags['addr:full']) || null;
}

function safeUrl(value) {
  let raw = firstValue(value);
  if (!raw) return null;
  if (!/^https?:\/\//i.test(raw)) raw = `https://${raw.replace(/^\/+/, '')}`;
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

const REVERSE_URL = 'https://nominatim.openstreetmap.org/reverse';
const OSRM_URL = 'https://router.project-osrm.org/route/v1/driving/';
const FOSSGIS_URLS = {
  car: 'https://routing.openstreetmap.de/routed-car/route/v1/driving/',
  walk: 'https://routing.openstreetmap.de/routed-foot/route/v1/driving/'
};
const TRANSITOUS_URL = 'https://api.transitous.org/api/';
const TRANSITOUS_VERSIONS = ['v5', 'v4', 'v2'];
const ROUTE_TTL = 15 * 60 * 1000;
const routeCache = new Map();
const reverseCache = new Map();

export const TRANSIT_MODES = {
  all: ['TRANSIT'],
  bus: ['BUS', 'COACH', 'TRAM', 'SUBWAY'],
  train: ['HIGHSPEED_RAIL', 'LONG_DISTANCE', 'NIGHT_RAIL', 'REGIONAL_FAST_RAIL', 'REGIONAL_RAIL', 'RAIL', 'SUBURBAN', 'SUBWAY', 'TRAM', 'BUS'],
  ferry: ['FERRY', 'BUS', 'TRAM', 'SUBWAY', 'REGIONAL_RAIL', 'SUBURBAN']
};

function pointKey(point) {
  return `${point.lat.toFixed(4)},${point.lon.toFixed(4)}`;
}

function cached(key) {
  const entry = routeCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.time > ROUTE_TTL) {
    routeCache.delete(key);
    return null;
  }
  return entry.value;
}

function remember(key, value) {
  routeCache.set(key, { value, time: Date.now() });
  if (routeCache.size > 200) routeCache.delete(routeCache.keys().next().value);
  return value;
}

export async function routeStreet(mode, from, to, signal = null) {
  const key = `street|${mode}|${pointKey(from)}|${pointKey(to)}`;
  const hit = cached(key);
  if (hit) return hit;
  const coords = `${from.lon.toFixed(6)},${from.lat.toFixed(6)};${to.lon.toFixed(6)},${to.lat.toFixed(6)}`;
  const overview = roughKm(from, to) > 150 ? 'simplified' : 'full';
  const urls = mode === 'car' ? [OSRM_URL, FOSSGIS_URLS.car] : [FOSSGIS_URLS.walk];
  let lastError = null;
  for (const url of urls) {
    try {
      const data = await request(`${url}${coords}?overview=${overview}&geometries=geojson&steps=false&alternatives=false`, {}, 20000, signal);
      if (data.code === 'NoRoute' || data.code === 'NoSegment' || !Array.isArray(data.routes) || !data.routes.length) throw new ApiError('noroute');
      if (data.code !== 'Ok') throw new ApiError('server');
      const route = data.routes[0];
      return remember(key, {
        distance: route.distance,
        duration: route.duration,
        coords: route.geometry.coordinates.map(([lon, lat]) => [lat, lon])
      });
    } catch (error) {
      lastError = error instanceof ApiError ? error : new ApiError('server');
      if (lastError.code === 'server' && lastError.status === 400) lastError = new ApiError('noroute');
      if (['aborted', 'offline', 'noroute'].includes(lastError.code)) throw lastError;
    }
  }
  throw lastError || new ApiError('server');
}

export function decodePolyline(encoded, precision = 6) {
  if (typeof encoded !== 'string') return [];
  const factor = 10 ** precision;
  const coords = [];
  let index = 0;
  let lat = 0;
  let lon = 0;
  while (index < encoded.length) {
    for (const axis of [0, 1]) {
      let result = 0;
      let shift = 0;
      let byte;
      do {
        byte = encoded.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20 && index < encoded.length);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (axis === 0) lat += delta;
      else lon += delta;
    }
    coords.push([lat / factor, lon / factor]);
  }
  return coords;
}

function transitLeg(leg) {
  const geometry = leg.legGeometry || {};
  return {
    mode: String(leg.mode || ''),
    name: cleanText(leg.displayName || leg.routeShortName || leg.tripShortName || '').slice(0, 40),
    headsign: cleanText(leg.headsign).slice(0, 60),
    agency: cleanText(leg.agencyName).slice(0, 60),
    from: cleanText(leg.from && leg.from.name).slice(0, 80),
    to: cleanText(leg.to && leg.to.name).slice(0, 80),
    start: leg.startTime,
    end: leg.endTime,
    distance: Number(leg.distance) || 0,
    coords: decodePolyline(geometry.points, Number.isFinite(geometry.precision) ? geometry.precision : 6)
  };
}

export async function routeTransit(mode, from, to, signal = null, time = null) {
  const when = time instanceof Date && time.getTime() > Date.now() ? time : new Date();
  const key = `transit|${mode}|${pointKey(from)}|${pointKey(to)}|${when.toISOString().slice(0, 13)}`;
  const hit = cached(key);
  if (hit) return hit;
  const params = new URLSearchParams({
    fromPlace: `${from.lat.toFixed(6)},${from.lon.toFixed(6)}`,
    toPlace: `${to.lat.toFixed(6)},${to.lon.toFixed(6)}`,
    time: when.toISOString(),
    transitModes: TRANSIT_MODES[mode].join(','),
    numItineraries: mode === 'all' ? '6' : '3'
  });
  let data = null;
  for (const version of TRANSITOUS_VERSIONS) {
    try {
      data = await request(`${TRANSITOUS_URL}${version}/plan?${params}`, { headers: { Accept: 'application/json' } }, 25000, signal);
      break;
    } catch (error) {
      if (error.code === 'server' && error.status === 404) continue;
      throw error;
    }
  }
  const itineraries = (data && Array.isArray(data.itineraries) ? data.itineraries : [])
    .map((itinerary) => ({
      duration: Number(itinerary.duration) || 0,
      start: itinerary.startTime,
      end: itinerary.endTime,
      transfers: Number(itinerary.transfers) || 0,
      tz: itinerary.legs && itinerary.legs[0] && itinerary.legs[0].from ? itinerary.legs[0].from.tz : null,
      legs: (Array.isArray(itinerary.legs) ? itinerary.legs : []).map(transitLeg)
    }))
    .filter((itinerary) => itinerary.legs.some((leg) => !['WALK', 'BIKE', 'CAR', 'RENTAL'].includes(leg.mode)));
  return remember(key, itineraries);
}

export async function reverseGeocode(lat, lon, lang) {
  const key = `${lang}|${lat.toFixed(2)},${lon.toFixed(2)}`;
  if (reverseCache.has(key)) return reverseCache.get(key);
  const wait = lastNominatimCall + NOMINATIM_INTERVAL - Date.now();
  if (wait > 0) await sleep(wait);
  lastNominatimCall = Date.now();
  const params = new URLSearchParams({ lat: lat.toFixed(5), lon: lon.toFixed(5), format: 'jsonv2', zoom: '10', 'accept-language': lang });
  const data = await request(`${REVERSE_URL}?${params}`, { headers: { Accept: 'application/json' } }, 10000);
  const address = (data && data.address) || {};
  const name = cleanText(address.city || address.town || address.village || address.municipality || address.county || data.name || '') || null;
  reverseCache.set(key, name);
  return name;
}

const AIRPORT_RADIUS = 150;
const STATION_RADIUS = 15000;
const AIRPORT_WEIGHT = { 3: 0.5, 2: 0.85, 1: 1.4 };
let airportList = null;
const stationCache = new Map(Object.entries(load('stations', {}) || {}));

async function airports() {
  if (airportList) return airportList;
  const response = await fetch('data/airports.json');
  if (!response.ok) throw new ApiError('server', response.status);
  const rows = await response.json();
  airportList = rows.map(([iata, name, lat, lon, size, city]) => ({ iata, name, lat, lon, size, city }));
  return airportList;
}

export async function nearestAirport(point) {
  const list = await airports();
  let best = null;
  for (const airport of list) {
    if (Math.abs(airport.lat - point.lat) > 2 || Math.abs(airport.lon - point.lon) > 3) continue;
    const km = roughKm(point, airport);
    if (km > AIRPORT_RADIUS) continue;
    const score = km * (AIRPORT_WEIGHT[airport.size] || 1);
    if (!best || score < best.score) best = { airport, score };
  }
  if (!best) return null;
  const { iata, name, lat, lon, city } = best.airport;
  return { kind: 'airport', iata, name, lat, lon, city, label: iata };
}

const STATION_FILTERS = {
  bus: 'nwr["amenity"="bus_station"]',
  train: 'nwr["railway"="station"]["station"!~"^(subway|light_rail|monorail|funicular|miniature|tram)$"]["usage"!="tourism"]'
};

function shortLabel(name) {
  return name.length > 22 ? `${name.slice(0, 21)}…` : name;
}

export async function nearestStation(point, type, signal = null) {
  const key = `${type}|${point.lat.toFixed(2)},${point.lon.toFixed(2)}`;
  if (stationCache.has(key)) return stationCache.get(key);
  const query = `[out:json][timeout:15];${STATION_FILTERS[type]}(around:${STATION_RADIUS},${point.lat.toFixed(5)},${point.lon.toFixed(5)});out tags center 25;`;
  const elements = await queryOverpass(query, signal, null, { patient: false });
  let best = null;
  for (const element of elements) {
    const position = coordinates(element);
    const tags = element.tags || {};
    const name = cleanText(tags.name);
    if (!position || !name) continue;
    let score = roughKm(point, position);
    if (type === 'train' && (tags.train === 'yes' || tags.public_transport === 'station')) score *= 0.7;
    if (type === 'bus' && /terminal|central|rodoviária|terminal de transporte/i.test(name)) score *= 0.7;
    if (!best || score < best.score) best = { score, station: { kind: type === 'bus' ? 'bus_station' : 'train_station', name: name.slice(0, 80), label: shortLabel(name), lat: position.lat, lon: position.lon } };
  }
  const station = best ? best.station : null;
  stationCache.set(key, station);
  save('stations', Object.fromEntries([...stationCache.entries()].slice(-120)));
  return station;
}

