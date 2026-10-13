const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const WIKIDATA_URL = 'https://www.wikidata.org/w/api.php';
const OVERPASS_URLS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter'
];
const NOMINATIM_INTERVAL = 1100;
const CACHE_TTL = 30 * 60 * 1000;
const CACHE_SIZE = 40;
const BBOX_PADDING = 0.15;

export const ACCOMMODATION_TYPES = ['hotel', 'hostel', 'guest_house', 'apartment', 'motel'];

export const CATEGORIES = {
  accommodation: { key: 'tourism', values: ACCOMMODATION_TYPES, limit: 1000 },
  money: { key: 'amenity', values: ['atm', 'bank', 'bureau_de_change'], limit: 400 },
  shopping: { key: 'shop', values: ['supermarket', 'convenience', 'kiosk'], limit: 400 },
  health: { key: 'amenity', values: ['pharmacy', 'hospital', 'clinic', 'doctors'], limit: 400 },
  food: { key: 'amenity', values: ['restaurant', 'cafe', 'fast_food'], limit: 600 }
};

export const POI_CATEGORIES = ['money', 'shopping', 'health', 'food'];

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
const overpassCache = [];
let lastNominatimCall = 0;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function request(url, options = {}, timeout = 30000) {
  if (navigator.onLine === false) throw new ApiError('offline');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    let response;
    try {
      response = await fetch(url, { ...options, signal: controller.signal });
    } catch (error) {
      if (error.name === 'AbortError') throw new ApiError('timeout');
      throw new ApiError(navigator.onLine === false ? 'offline' : 'network');
    }
    if (response.status === 429) throw new ApiError('busy', 429);
    if (response.status === 504 || response.status === 408) throw new ApiError('timeout', response.status);
    if (!response.ok) throw new ApiError('server', response.status);
    try {
      return await response.json();
    } catch (error) {
      if (error.name === 'AbortError') throw new ApiError('timeout');
      throw new ApiError('server', response.status);
    }
  } finally {
    clearTimeout(timer);
  }
}

export async function searchPlaces(query, lang) {
  const key = `${lang}|${query.trim().toLowerCase()}`;
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
  const data = await request(`${NOMINATIM_URL}?${params}`, { headers: { Accept: 'application/json' } }, 15000);
  const results = (Array.isArray(data) ? data : []).map(normalizeSearchResult).filter(Boolean);
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
    const { key, values, limit } = CATEGORIES[category];
    return `nwr["${key}"~"^(${values.join('|')})$"](${box})->.s${index};.s${index} out tags center ${limit};`;
  });
  return `[out:json][timeout:25];${parts.join('')}`;
}

async function queryOverpass(query) {
  let lastError = null;
  for (const url of OVERPASS_URLS) {
    try {
      const data = await request(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
        body: `data=${encodeURIComponent(query)}`
      }, 35000);
      const remark = String(data.remark || '');
      if (/timed out|timeout/i.test(remark)) throw new ApiError('timeout');
      if (/out of memory|too many|rate_limited/i.test(remark)) throw new ApiError('busy');
      return Array.isArray(data.elements) ? data.elements : [];
    } catch (error) {
      lastError = error instanceof ApiError ? error : new ApiError('server');
      if (lastError.code === 'offline') break;
    }
  }
  throw lastError || new ApiError('server');
}

function findCached(category, bounds) {
  return overpassCache.find((entry) => entry.category === category
    && contains(entry.bounds, bounds)
    && (!entry.truncated || contains(bounds, entry.query)));
}

export async function fetchCategories(categories, bounds) {
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
  const elements = await queryOverpass(buildQuery(missing, padded));
  const grouped = Object.fromEntries(missing.map((category) => [category, new Map()]));
  for (const element of elements) {
    const tags = element.tags || {};
    for (const category of missing) {
      const { key, values } = CATEGORIES[category];
      if (!values.includes(tags[key])) continue;
      const id = `${element.type}/${element.id}`;
      if (grouped[category].has(id)) continue;
      const item = category === 'accommodation' ? normalizeAccommodation(element) : normalizePoi(element, category);
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

function normalizePoi(element, category) {
  const tags = element.tags || {};
  const position = coordinates(element);
  if (!position) return null;
  const { key } = CATEGORIES[category];
  return {
    id: `${element.type}/${element.id}`,
    kind: 'poi',
    category,
    type: tags[key],
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
