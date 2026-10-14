import { load, save } from './storage.js';

const KEY = 'recent';
const LIMIT = 6;

function finite(value) {
  return Number.isFinite(value) ? value : 0;
}

function validBounds(bounds) {
  if (!bounds || typeof bounds !== 'object') return null;
  const keys = ['south', 'north', 'west', 'east'];
  return keys.every((key) => Number.isFinite(bounds[key])) ? Object.fromEntries(keys.map((key) => [key, bounds[key]])) : null;
}

function valid(raw) {
  if (!raw || typeof raw.name !== 'string' || !raw.name.trim()) return null;
  if (!Number.isFinite(raw.lat) || !Number.isFinite(raw.lon)) return null;
  return {
    id: String(raw.id || `${raw.lat},${raw.lon}`).slice(0, 40),
    name: raw.name.trim().slice(0, 120),
    detail: typeof raw.detail === 'string' ? raw.detail.slice(0, 200) : '',
    lat: raw.lat,
    lon: raw.lon,
    kind: typeof raw.kind === 'string' ? raw.kind.slice(0, 40) : '',
    rank: finite(raw.rank),
    importance: finite(raw.importance),
    country: typeof raw.country === 'string' && /^[a-z]{2}$/.test(raw.country) ? raw.country : null,
    bounds: validBounds(raw.bounds)
  };
}

function same(a, b) {
  return a.name === b.name && Math.abs(a.lat - b.lat) < 0.01 && Math.abs(a.lon - b.lon) < 0.01;
}

export function getRecent(query = '') {
  const raw = load(KEY, []);
  const list = Array.isArray(raw) ? raw.map(valid).filter(Boolean).slice(0, LIMIT) : [];
  const needle = query.trim().toLowerCase();
  return needle ? list.filter((item) => item.name.toLowerCase().includes(needle)) : list;
}

export function addRecent(result) {
  const entry = valid(result);
  if (!entry) return;
  save(KEY, [entry, ...getRecent().filter((item) => !same(item, entry))].slice(0, LIMIT));
}

export function clearRecent() {
  save(KEY, []);
}
