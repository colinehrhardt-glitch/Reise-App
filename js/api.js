const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const OVERPASS_URLS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter'
];
const NOMINATIM_INTERVAL = 1100;
const CACHE_TTL = 30 * 60 * 1000;
const CACHE_SIZE = 20;
const BBOX_PADDING = 0.15;

export const OVERPASS_LIMIT = 1000;
export const ACCOMMODATION_TYPES = ['hotel', 'hostel', 'guest_house', 'apartment', 'motel'];

export class ApiError extends Error {
  constructor(code, status = 0) {
    super(code);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

const nominatimCache = new Map();
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

function isInside(place, bounds) {
  return place.lat >= bounds.south && place.lat <= bounds.north && place.lon >= bounds.west && place.lon <= bounds.east;
}

function buildQuery(bounds) {
  const box = [bounds.south, bounds.west, bounds.north, bounds.east].map((value) => value.toFixed(5)).join(',');
  const pattern = ACCOMMODATION_TYPES.join('|');
  return `[out:json][timeout:25];nwr["tourism"~"^(${pattern})$"](${box});out tags center ${OVERPASS_LIMIT};`;
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

export async function fetchAccommodations(bounds) {
  const now = Date.now();
  for (let i = overpassCache.length - 1; i >= 0; i -= 1) {
    if (now - overpassCache[i].time > CACHE_TTL) overpassCache.splice(i, 1);
  }
  const hit = overpassCache.find((entry) => contains(entry.bounds, bounds) && (!entry.truncated || contains(bounds, entry.query)));
  if (hit) {
    return { places: hit.places.filter((place) => isInside(place, bounds)), truncated: hit.truncated, cached: true };
  }

  const padded = padBounds(bounds);
  const elements = await queryOverpass(buildQuery(padded));
  const seen = new Set();
  const places = [];
  for (const element of elements) {
    const place = normalizeElement(element);
    if (!place || seen.has(place.id)) continue;
    seen.add(place.id);
    places.push(place);
  }
  const truncated = elements.length >= OVERPASS_LIMIT;
  overpassCache.push({ bounds: padded, query: bounds, places, truncated, time: now });
  if (overpassCache.length > CACHE_SIZE) overpassCache.shift();
  return { places: places.filter((place) => isInside(place, bounds)), truncated, cached: false };
}

function normalizeElement(element) {
  const tags = element.tags || {};
  if (!ACCOMMODATION_TYPES.includes(tags.tourism)) return null;
  const lat = element.lat ?? element.center?.lat;
  const lon = element.lon ?? element.center?.lon;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return {
    id: `${element.type}/${element.id}`,
    type: tags.tourism,
    name: cleanText(tags.name) || null,
    lat,
    lon,
    stars: parseStars(tags.stars),
    address: formatAddress(tags),
    website: safeUrl(tags.website || tags['contact:website'] || tags.url),
    phone: firstValue(tags.phone || tags['contact:phone'] || tags['contact:mobile'])
  };
}

function cleanText(value) {
  return typeof value === 'string' ? value.trim().slice(0, 200) : '';
}

function firstValue(value) {
  return cleanText(String(value || '').split(';')[0]) || null;
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
