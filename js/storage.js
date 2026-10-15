const PREFIX = 'viaro:';
const CACHES = ['routes', 'areaCache', 'stations4'];

function isCache(key) {
  return CACHES.includes(key) || key.startsWith('info:');
}

function freeCaches() {
  try {
    const storage = window.localStorage;
    const keys = [];
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (key && key.startsWith(PREFIX) && isCache(key.slice(PREFIX.length))) keys.push(key);
    }
    keys.forEach((key) => storage.removeItem(key));
    return keys.length > 0;
  } catch {
    return false;
  }
}

export function load(key, fallback) {
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    window.localStorage.setItem(PREFIX + key, value);
    return true;
  } catch {
    return false;
  }
}

export function save(key, value) {
  let data;
  try {
    data = JSON.stringify(value);
  } catch {
    return false;
  }
  if (write(key, data)) return true;
  return !isCache(key) && freeCaches() && write(key, data);
}

export function remove(key) {
  try {
    window.localStorage.removeItem(PREFIX + key);
    return true;
  } catch {
    return false;
  }
}
