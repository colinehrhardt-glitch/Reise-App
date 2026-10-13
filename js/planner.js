import { t, tCount, getLanguage, formatDistance } from './i18n.js';
import { load, save } from './storage.js';
import { searchPlaces, routeStreet, routeTransit, reverseGeocode } from './api.js';
import * as mapView from './map.js';
import { el, icon, distance, errorMessage, toast } from './ui.js';

export const MODES = ['walk', 'car', 'bus', 'train', 'ferry', 'flight'];

const STORAGE_KEY = 'route';
const BRUTE_FORCE_LIMIT = 7;
const DEFAULT_NIGHTS = 2;
const MAX_NIGHTS = 90;
const MAX_STAYS = 12;
const STAY_RADIUS = 30000;
const TARGET_RADIUS = 60000;
const DAY = 24 * 60 * 60 * 1000;
const STAY_TYPES = ['hotel', 'hostel', 'guest_house', 'apartment', 'motel'];
const MAIN_MODE = {
  AIRPLANE: 'flight', FERRY: 'ferry', BUS: 'bus', COACH: 'bus',
  HIGHSPEED_RAIL: 'train', LONG_DISTANCE: 'train', NIGHT_RAIL: 'train', REGIONAL_FAST_RAIL: 'train',
  REGIONAL_RAIL: 'train', RAIL: 'train', SUBURBAN: 'train', METRO: 'train', SUBWAY: 'train', TRAM: 'train',
  FUNICULAR: 'train', AERIAL_LIFT: 'bus', CABLE_CAR: 'bus', OTHER: 'bus'
};
const TRANSIT_ICON = {
  BUS: 'bus', COACH: 'bus', TRAM: 'train', SUBWAY: 'train', FERRY: 'ferry', AIRPLANE: 'flight',
  HIGHSPEED_RAIL: 'train', LONG_DISTANCE: 'train', NIGHT_RAIL: 'train', REGIONAL_FAST_RAIL: 'train',
  REGIONAL_RAIL: 'train', RAIL: 'train', SUBURBAN: 'train', METRO: 'train', WALK: 'walk'
};

const state = {
  tripStart: null,
  startMode: 'gps',
  startPlace: null,
  stops: [],
  modes: {},
  auto: {},
  results: {},
  options: {},
  picker: null,
  expanded: null,
  stayOpen: null,
  stayTarget: null,
  run: null,
  gpsName: null,
  gpsKey: null,
  locating: false
};
let options = {};
const dom = {};

function text(value, max = 200) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;
}

function validPlace(raw) {
  if (!raw || !Number.isFinite(raw.lat) || !Number.isFinite(raw.lon)) return null;
  return {
    id: typeof raw.id === 'string' ? raw.id.slice(0, 40) : newId(),
    name: text(raw.name) || '?',
    detail: text(raw.detail),
    lat: raw.lat,
    lon: raw.lon
  };
}

function validStay(raw) {
  if (!raw || typeof raw.id !== 'string' || !STAY_TYPES.includes(raw.type)) return null;
  if (!Number.isFinite(raw.lat) || !Number.isFinite(raw.lon)) return null;
  return {
    id: raw.id.slice(0, 40),
    kind: 'accommodation',
    type: raw.type,
    name: text(raw.name),
    lat: raw.lat,
    lon: raw.lon,
    stars: raw.stars && Number.isFinite(raw.stars.count) ? { count: raw.stars.count, superior: Boolean(raw.stars.superior) } : null,
    address: text(raw.address),
    city: text(raw.city),
    website: typeof raw.website === 'string' && /^https?:\/\//i.test(raw.website) ? raw.website.slice(0, 300) : null,
    phone: text(raw.phone, 60),
    email: typeof raw.email === 'string' && /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(raw.email) ? raw.email : null,
    photo: raw.photo && ['commons', 'wikidata', 'url'].includes(raw.photo.kind) && typeof raw.photo.value === 'string' ? { kind: raw.photo.kind, value: raw.photo.value.slice(0, 300) } : null,
    facts: raw.facts && typeof raw.facts === 'object' ? raw.facts : {},
    description: raw.description && typeof raw.description === 'object' ? raw.description : null
  };
}

function validStop(raw) {
  const place = validPlace(raw);
  if (!place) return null;
  const nights = Number.isInteger(raw.nights) ? Math.min(MAX_NIGHTS, Math.max(0, raw.nights)) : DEFAULT_NIGHTS;
  const stays = Array.isArray(raw.stays) ? raw.stays.map(validStay).filter(Boolean).slice(0, MAX_STAYS) : [];
  const chosen = typeof raw.chosen === 'string' && stays.some((stay) => stay.id === raw.chosen) ? raw.chosen : null;
  return { ...place, nights, noStay: raw.noStay === true, stays, chosen };
}

function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T12:00:00`)) ? value : null;
}

function newId() {
  return `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

function restore() {
  const raw = load(STORAGE_KEY, null);
  if (!raw || typeof raw !== 'object') return;
  state.tripStart = validDate(raw.tripStart);
  state.startMode = raw.startMode === 'custom' ? 'custom' : 'gps';
  state.startPlace = raw.startPlace ? validStop({ nights: 0, ...raw.startPlace, id: 'start' }) : null;
  state.stops = Array.isArray(raw.stops) ? raw.stops.map(validStop).filter(Boolean).slice(0, 40) : [];
  state.modes = {};
  if (raw.modes && typeof raw.modes === 'object') {
    for (const [pair, mode] of Object.entries(raw.modes)) {
      if (MODES.includes(mode) && pair.length < 100) state.modes[pair] = mode;
    }
  }
}

function persist() {
  const ok = save(STORAGE_KEY, {
    tripStart: state.tripStart,
    startMode: state.startMode,
    startPlace: state.startPlace,
    stops: state.stops,
    modes: state.modes
  });
  if (!ok) toast(t('favorites.storageError'), { type: 'error', duration: 6000 });
}

function startPoint() {
  if (state.startMode === 'gps') {
    const user = options.getUser();
    if (!user) return null;
    return {
      key: 'gps',
      name: state.gpsName ? t('route.myLocationIn', { place: state.gpsName }) : t('route.startGps'),
      linkName: state.gpsName,
      lat: user.lat,
      lon: user.lon,
      start: true
    };
  }
  return state.startPlace ? { ...state.startPlace, key: 'start', start: true, holder: true } : null;
}

function points() {
  const start = startPoint();
  const stops = state.stops.map((stop) => ({ ...stop, key: stop.id }));
  return start ? [start, ...stops] : stops;
}

function pairKey(a, b) {
  return `${a.key}>${b.key}`;
}

function startDate() {
  return state.tripStart ? new Date(`${state.tripStart}T12:00:00`) : null;
}

function addDays(date, days) {
  return new Date(date.getTime() + days * DAY);
}

function isoDate(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function schedule() {
  const base = startDate();
  const list = points();
  let offset = 0;
  return list.map((point) => {
    const nights = point.start && !point.holder ? 0 : point.nights || 0;
    const arrival = base ? addDays(base, offset) : null;
    offset += nights;
    return { arrival, departure: base ? addDays(base, offset) : null, nights };
  });
}

function departureFor(index) {
  const plan = schedule()[index];
  if (!plan || !plan.departure) return null;
  const date = new Date(plan.departure);
  date.setHours(8, 0, 0, 0);
  return date;
}

function formatDay(date, withWeekday = false) {
  return new Intl.DateTimeFormat(getLanguage(), withWeekday ? { weekday: 'short', day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short' }).format(date);
}

function formatRange(from, to) {
  const format = new Intl.DateTimeFormat(getLanguage(), { day: 'numeric', month: 'short' });
  if (typeof format.formatRange === 'function') return format.formatRange(from, to);
  return `${format.format(from)} – ${format.format(to)}`;
}

function needsStay(stop) {
  return stop.nights > 0 && !stop.noStay && !stop.chosen;
}

function suggestMode(a, b) {
  const km = distance(a, b) / 1000;
  if (km < 2) return 'walk';
  if (km < 700) return 'bus';
  return 'flight';
}

function pickOption(list, km) {
  const has = (mode) => list.find((option) => option.mode === mode);
  if (km < 2 && has('walk')) return 'walk';
  const timetable = list.filter((option) => option.itineraries && option.mode !== 'walk');
  if (timetable.length) return timetable.reduce((best, option) => (option.duration < best.duration ? option : best)).mode;
  if (km >= 700 && has('flight')) return 'flight';
  if (has('bus')) return 'bus';
  if (has('ferry')) return 'ferry';
  if (has('car')) return 'car';
  return list.length ? list[0].mode : null;
}

function legMode(a, b) {
  const pair = pairKey(a, b);
  return state.modes[pair] || state.auto[pair] || suggestMode(a, b);
}

function legBase(a, b, time) {
  return `${pairKey(a, b)}|${a.lat.toFixed(4)},${a.lon.toFixed(4)}|${b.lat.toFixed(4)},${b.lon.toFixed(4)}|${time ? isoDate(time) : 'now'}`;
}

function legs() {
  const list = points();
  const result = [];
  for (let i = 0; i < list.length - 1; i += 1) {
    const a = list[i];
    const b = list[i + 1];
    const mode = legMode(a, b);
    const time = departureFor(i);
    const base = legBase(a, b, time);
    const key = `${base}|${mode}`;
    result.push({ index: i, a, b, mode, key, base, time, pair: pairKey(a, b), result: state.results[key] || null, options: state.options[base] || null });
  }
  return result;
}

function mainMode(itinerary) {
  let best = null;
  for (const part of itinerary.legs) {
    if (!MAIN_MODE[part.mode]) continue;
    const length = part.distance || 0;
    if (!best || length > best.length) best = { mode: MAIN_MODE[part.mode], length };
  }
  return best ? best.mode : null;
}

function transitResult(itineraries, a, b) {
  const best = itineraries[0];
  const coords = best.legs.flatMap((part) => part.coords);
  const travelled = best.legs.reduce((sum, part) => sum + part.distance, 0);
  return {
    status: 'ok',
    distance: travelled || distance(a, b),
    duration: best.duration,
    coords: coords.length > 1 ? coords : straight(a, b),
    itineraries
  };
}

function flightEstimate(a, b) {
  const km = distance(a, b) / 1000;
  return { status: 'estimate', distance: km * 1000, duration: (km / 800 + 0.5) * 3600, coords: mapView.arcCoords(a, b), note: 'route.flightNote' };
}

function ferryEstimate(a, b) {
  const km = distance(a, b) / 1000;
  return { status: 'estimate', distance: km * 1000, duration: (km * 1.1 / 30 + 0.5) * 3600, coords: straight(a, b), note: 'route.ferryNote' };
}

function busEstimate(road) {
  return { status: 'estimate', distance: road.distance, duration: road.duration * 1.35, coords: road.coords, note: 'route.estimateNote' };
}

async function computeOptions(leg, signal) {
  const { a, b, time } = leg;
  const km = distance(a, b) / 1000;
  const found = new Map();
  const attempt = async (task) => {
    try {
      return await task();
    } catch (error) {
      if (error.code === 'aborted') throw error;
      return null;
    }
  };
  if (km <= 12) {
    const walk = await attempt(() => routeStreet('walk', a, b, signal));
    if (walk) found.set('walk', { status: 'ok', distance: walk.distance, duration: walk.duration, coords: walk.coords });
  }
  const road = await attempt(() => routeStreet('car', a, b, signal));
  if (road) found.set('car', { status: 'ok', distance: road.distance, duration: road.duration, coords: road.coords });
  if (km >= 1) {
    const itineraries = (await attempt(() => routeTransit('all', a, b, signal, time))) || [];
    const groups = {};
    for (const itinerary of itineraries) {
      const mode = mainMode(itinerary);
      if (!mode) continue;
      (groups[mode] = groups[mode] || []).push(itinerary);
    }
    for (const [mode, list] of Object.entries(groups)) {
      list.sort((x, y) => x.duration - y.duration);
      found.set(mode, transitResult(list, a, b));
    }
  }
  if (!found.has('bus') && road && km >= 3) found.set('bus', busEstimate(road));
  if (!found.has('ferry') && !road && km < 600) found.set('ferry', ferryEstimate(a, b));
  if (!found.has('flight') && (km >= 250 || (!road && km >= 600))) found.set('flight', flightEstimate(a, b));
  return MODES.filter((mode) => found.has(mode))
    .map((mode) => ({ mode, ...found.get(mode) }))
    .sort((x, y) => x.duration - y.duration);
}

function straight(a, b) {
  return [[a.lat, a.lon], [b.lat, b.lon]];
}

async function computeLeg(leg, signal) {
  const { a, b, mode, pair, time } = leg;
  const km = distance(a, b) / 1000;
  if (mode === 'car' || mode === 'walk') {
    const route = await routeStreet(mode, a, b, signal);
    return { status: 'ok', distance: route.distance, duration: route.duration, coords: route.coords };
  }
  if (mode === 'flight') return flightEstimate(a, b);
  let itineraries = [];
  try {
    itineraries = await routeTransit(mode, a, b, signal, time);
  } catch (error) {
    if (error.code === 'aborted') throw error;
  }
  if (itineraries.length) return transitResult(itineraries, a, b);
  if (mode === 'ferry') return ferryEstimate(a, b);
  try {
    const road = await routeStreet('car', a, b, signal);
    if (mode === 'bus') return busEstimate(road);
    const duration = Math.max(road.duration * 0.8, (road.distance / 1000 / 85) * 3600);
    return { status: 'estimate', distance: road.distance, duration, coords: road.coords, note: 'route.estimateNote' };
  } catch (error) {
    if (error.code === 'aborted') throw error;
    if (error.code === 'noroute' && !state.modes[pair]) {
      state.auto[pair] = km < 500 ? 'ferry' : 'flight';
      return { status: 'switch' };
    }
  }
  const factor = mode === 'bus' ? 55 : 80;
  return { status: 'estimate', distance: km * 1250, duration: (km * 1.25 / factor) * 3600, coords: straight(a, b), note: 'route.estimateNote' };
}

function storeOptions(base, list) {
  state.options[base] = { status: 'ok', list };
  for (const option of list) {
    const key = `${base}|${option.mode}`;
    const current = state.results[key];
    if (!current || current.status === 'loading' || current.status === 'error') {
      const { mode, ...result } = option;
      state.results[key] = result;
    }
  }
}

function compute() {
  if (state.run) state.run.abort();
  const controller = new AbortController();
  state.run = controller;
  const pending = legs().filter((leg) => !leg.options || !leg.result || leg.result.status === 'loading');
  for (const leg of pending) {
    if (!leg.result) state.results[leg.key] = { status: 'loading' };
  }
  render();
  if (!pending.length) return;
  (async () => {
    for (const initial of pending) {
      if (controller.signal.aborted) return;
      let leg = legs().find((item) => item.base === initial.base) || initial;
      try {
        if (!state.options[leg.base] || state.options[leg.base].status !== 'ok') {
          state.options[leg.base] = { status: 'loading' };
          const list = await computeOptions(leg, controller.signal);
          if (controller.signal.aborted) return;
          storeOptions(leg.base, list);
          if (!state.modes[leg.pair]) {
            const picked = pickOption(list, distance(leg.a, leg.b) / 1000);
            if (picked) state.auto[leg.pair] = picked;
          }
          for (const key of Object.keys(state.results)) {
            if (key.startsWith(`${leg.base}|`) && state.results[key].status === 'loading') delete state.results[key];
          }
          leg = legs().find((item) => item.base === initial.base) || leg;
        }
        if (!leg.result || leg.result.status === 'loading') {
          state.results[leg.key] = { status: 'loading' };
          const result = await computeLeg(leg, controller.signal);
          if (controller.signal.aborted) return;
          if (result.status === 'switch') delete state.results[leg.key];
          else state.results[leg.key] = result;
        }
      } catch (error) {
        if (controller.signal.aborted || error.code === 'aborted') {
          if (state.options[leg.base] && state.options[leg.base].status === 'loading') delete state.options[leg.base];
          if (state.results[leg.key] && state.results[leg.key].status === 'loading') delete state.results[leg.key];
          return;
        }
        if (state.options[leg.base] && state.options[leg.base].status === 'loading') state.options[leg.base] = { status: 'error' };
        state.results[leg.key] = { status: 'error', code: error.code || 'server' };
      }
      renderList();
      renderSummary();
      renderMap();
    }
    if (state.run === controller && legs().some((leg) => !leg.result)) compute();
  })();
}

export function formatDuration(seconds) {
  const minutes = Math.max(1, Math.round(seconds / 60));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const rest = minutes % 60;
  if (days) return t('time.dh', { d: days, h: hours });
  if (hours && rest) return t('time.hm', { h: hours, m: rest });
  if (hours) return t('time.h', { h: hours });
  return t('time.m', { m: rest });
}

function formatClock(iso, tz) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const base = { hour: '2-digit', minute: '2-digit' };
  const sameDay = new Date().toDateString() === date.toDateString();
  const format = sameDay ? base : { ...base, weekday: 'short' };
  try {
    return new Intl.DateTimeFormat(getLanguage(), tz ? { ...format, timeZone: tz } : format).format(date);
  } catch {
    return new Intl.DateTimeFormat(getLanguage(), format).format(date);
  }
}

function totals() {
  const list = legs();
  let meters = 0;
  let seconds = 0;
  let estimated = false;
  let pending = false;
  let failed = false;
  for (const leg of list) {
    const result = leg.result;
    if (!result || result.status === 'loading') pending = true;
    else if (result.status === 'error') failed = true;
    else {
      meters += result.distance;
      seconds += result.duration;
      if (result.status === 'estimate') estimated = true;
    }
  }
  return { count: list.length, meters, seconds, estimated, pending, failed };
}

function holders() {
  return state.startMode === 'custom' && state.startPlace ? [state.startPlace, ...state.stops] : state.stops;
}

function holder(id) {
  return holders().find((item) => item.id === id) || null;
}

function totalNights() {
  return holders().reduce((sum, stop) => sum + stop.nights, 0);
}

export function summaryText() {
  const total = totals();
  const nights = totalNights();
  const nightsText = nights ? ` · ${tCount('route.nights', nights)}` : '';
  if (!total.count) return state.stops.length ? `${t('route.needStart')}${nightsText}` : '';
  if (total.pending) return t('route.loading');
  const duration = formatDuration(total.seconds);
  return t('route.summary', {
    legs: tCount('route.legs', total.count),
    distance: formatDistance(total.meters),
    duration: total.estimated ? t('route.approx', { value: duration }) : duration
  }) + nightsText;
}

function renderSummary() {
  if (options.onSummary) options.onSummary(summaryText());
}

function renderMap() {
  const list = points();
  const mapPoints = list.map((point, index) => ({
    lat: point.lat,
    lon: point.lon,
    name: point.name,
    start: Boolean(point.start),
    label: point.start ? 'S' : String(list[0] && list[0].start ? index : index + 1)
  }));
  const mapLegs = legs().map((leg) => {
    const result = leg.result;
    if (!result || result.status === 'loading' || result.status === 'error') {
      return { mode: leg.mode, coords: leg.mode === 'flight' ? mapView.arcCoords(leg.a, leg.b) : straight(leg.a, leg.b), estimate: true };
    }
    return { mode: leg.mode, coords: result.coords, estimate: result.status === 'estimate' };
  });
  mapView.renderRoute(mapPoints, mapLegs);
}

export function fitRoute() {
  const coords = [];
  for (const leg of legs()) {
    const result = leg.result;
    coords.push(...(result && result.coords ? result.coords : straight(leg.a, leg.b)));
  }
  if (!coords.length) for (const point of points()) coords.push([point.lat, point.lon]);
  mapView.fitCoords(coords, 13);
}

function fitLeg(leg) {
  const result = leg.result;
  mapView.fitCoords(result && result.coords ? result.coords : straight(leg.a, leg.b), 15);
}

function makeSearch({ placeholder, onPick, compact = false }) {
  const input = el('input', {
    class: 'planner-search__input',
    type: 'search',
    enterkeyhint: 'search',
    autocomplete: 'off',
    spellcheck: 'false',
    placeholder,
    'aria-label': placeholder
  });
  const results = el('ul', { class: 'planner-search__results' });
  const message = el('p', { class: 'planner-search__message', role: 'status' });
  let token = 0;
  const pick = (result) => {
    input.value = '';
    results.replaceChildren();
    message.textContent = '';
    onPick({ name: result.name, detail: result.detail, lat: result.lat, lon: result.lon });
  };
  const form = el('form', {
    class: `planner-search${compact ? ' planner-search--compact' : ''}`,
    role: 'search',
    onsubmit: async (event) => {
      event.preventDefault();
      const query = input.value.trim();
      if (query.length < 2) {
        message.textContent = t('search.tooShort');
        return;
      }
      const current = ++token;
      message.textContent = t('search.searching');
      results.replaceChildren();
      try {
        const found = await searchPlaces(query, getLanguage());
        if (current !== token) return;
        if (!found.length) {
          message.textContent = t('search.noResults');
          return;
        }
        if (found.length === 1) {
          pick(found[0]);
          return;
        }
        message.textContent = '';
        results.replaceChildren(...found.map((result) => el('li', {},
          el('button', { type: 'button', class: 'search-hit', onclick: () => pick(result) },
            el('span', { class: 'search-hit__icon' }, icon('place')),
            el('span', { class: 'search-hit__text' },
              el('span', { class: 'search-hit__name', text: result.name }),
              result.detail ? el('span', { class: 'search-hit__detail', text: result.detail }) : null)))));
      } catch (error) {
        if (current === token) message.textContent = errorMessage(error);
      }
    }
  },
  el('div', { class: 'planner-search__row' },
    input,
    el('button', { type: 'submit', class: 'icon-btn icon-btn--accent', 'aria-label': t('search.submit') }, icon('plus'))),
  message,
  results);
  return form;
}

async function useGps() {
  if (state.locating) return;
  state.locating = true;
  renderStart();
  try {
    await options.requestLocation();
  } catch {
    toast(t('route.noLocation'), { type: 'error', duration: 6000 });
  } finally {
    state.locating = false;
    refreshStart();
  }
}

function renderStart() {
  const segment = (mode, label) => el('button', {
    type: 'button',
    class: 'segmented__btn',
    'aria-pressed': String(state.startMode === mode),
    text: label,
    onclick: () => {
      if (state.startMode === mode) return;
      state.startMode = mode;
      persist();
      update();
      if (mode === 'gps' && !options.getUser()) useGps();
    }
  });
  let body = null;
  const listed = state.stops.length > 0;
  if (state.startMode === 'gps') {
    const user = options.getUser();
    if (state.locating) body = el('p', { class: 'planner-hint', text: t('route.locating') });
    else if (user) body = listed ? null : startRow(startPoint());
    else {
      body = el('button', { type: 'button', class: 'btn btn--secondary planner-locate', onclick: useGps },
        icon('locate'), el('span', { text: t('route.useLocation') }));
    }
  } else if (state.startPlace) {
    body = startRow(startPoint(), () => {
      state.startPlace = null;
      persist();
      update();
    }, listed);
  } else {
    body = makeSearch({
      placeholder: t('route.startSearch'),
      compact: true,
      onPick: (place) => {
        state.startPlace = validStop({ ...place, id: 'start', nights: 0 });
        persist();
        update();
        fitRoute();
      }
    });
  }
  dom.start.replaceChildren(...[
    el('div', { class: 'planner-label' }, el('span', { text: t('route.start') })),
    el('div', { class: 'segmented', role: 'group', 'aria-label': t('route.start') },
      segment('gps', t('route.startGps')), segment('custom', t('route.startCustom'))),
    body
  ].filter(Boolean));
}

function startRow(point, onChange = null, compact = false) {
  if (compact) {
    return el('div', { class: 'start-row start-row--compact' },
      el('span', { class: 'stop__text' }, el('span', { class: 'stop__detail', text: point.name })),
      el('button', { type: 'button', class: 'link-btn', text: t('route.changeStart'), onclick: onChange }));
  }
  return el('div', { class: 'start-row' },
    el('span', { class: 'stop__badge stop__badge--start', text: 'S' }),
    el('span', { class: 'stop__text' },
      el('span', { class: 'stop__name', text: point.name }),
      point.detail ? el('span', { class: 'stop__detail', text: point.detail }) : null),
    onChange ? el('button', { type: 'button', class: 'link-btn', text: t('route.changeStart'), onclick: onChange }) : null);
}

function modeButton(leg) {
  const color = mapView.ROUTE_MODES[leg.mode].color;
  return el('button', {
    type: 'button',
    class: 'leg__mode',
    style: `--c:${color}`,
    'aria-expanded': String(state.picker === leg.index),
    'aria-label': `${t('route.mode')}: ${t(`modes.${leg.mode}`)}`,
    onclick: () => {
      state.picker = state.picker === leg.index ? null : leg.index;
      renderList();
    }
  }, icon(leg.mode), el('span', { text: t(`modes.${leg.mode}`) }));
}

function modePicker(leg) {
  return el('div', { class: 'leg__picker', role: 'group', 'aria-label': t('route.mode') },
    MODES.map((mode) => el('button', {
      type: 'button',
      class: 'mode-option',
      style: `--c:${mapView.ROUTE_MODES[mode].color}`,
      'aria-pressed': String(leg.mode === mode),
      onclick: () => {
        state.modes[leg.pair] = mode;
        delete state.auto[leg.pair];
        state.picker = null;
        state.expanded = leg.index;
        persist();
        compute();
      }
    }, icon(mode), el('span', { text: t(`modes.${mode}`) }))));
}

function legInfo(leg) {
  const result = leg.result;
  if (!result || result.status === 'loading') {
    return el('span', { class: 'leg__info leg__info--loading' }, el('span', { class: 'spinner' }), el('span', { text: t('route.loading') }));
  }
  if (result.status === 'error') {
    return el('span', { class: 'leg__info leg__info--error', text: result.code === 'noroute' ? t('route.noRoad') : t('route.error') });
  }
  const duration = formatDuration(result.duration);
  return el('span', { class: 'leg__info' },
    el('span', { text: formatDistance(result.distance) }),
    el('span', { text: result.status === 'estimate' ? t('route.approx', { value: duration }) : duration }));
}

function encodeName(point) {
  return encodeURIComponent(String(point.linkName || point.name || `${point.lat.toFixed(4)},${point.lon.toFixed(4)}`).replace(/\s+/g, '-'));
}

function bookingLinks(leg) {
  const { a, b, mode } = leg;
  const lang = getLanguage();
  const travelmode = { car: 'driving', walk: 'walking', bus: 'transit', train: 'transit', ferry: 'transit' }[mode];
  const links = [];
  if (travelmode) {
    const params = new URLSearchParams({ api: '1', origin: `${a.lat},${a.lon}`, destination: `${b.lat},${b.lon}`, travelmode });
    links.push(['Google Maps', `https://www.google.com/maps/dir/?${params}`]);
  }
  if (mode === 'flight') {
    const names = { from: a.linkName || a.name, to: b.linkName || b.name };
    const query = leg.time ? t('route.flightsQueryDate', { ...names, date: isoDate(leg.time) }) : t('route.flightsQuery', names);
    links.push(['Google Flights', `https://www.google.com/travel/flights?${new URLSearchParams({ q: query, hl: lang })}`]);
  }
  if (['bus', 'train', 'ferry', 'flight'].includes(mode)) {
    links.push(['Rome2Rio', `https://www.rome2rio.com/map/${encodeName(a)}/${encodeName(b)}`]);
  }
  return el('div', { class: 'leg__links' },
    el('span', { class: 'leg__links-title', text: t('route.book') }),
    el('div', { class: 'leg__links-row' }, links.map(([label, href]) => el('a', {
      class: 'btn btn--secondary btn--small', href, target: '_blank', rel: 'noopener noreferrer'
    }, el('span', { text: label }), icon('external')))));
}

function itineraryItem(itinerary) {
  const parts = itinerary.legs.filter((part) => part.mode !== 'WALK');
  return el('li', { class: 'itinerary' },
    el('div', { class: 'itinerary__head' },
      el('span', { class: 'itinerary__time', text: `${formatClock(itinerary.start, itinerary.tz)} – ${formatClock(itinerary.end, itinerary.tz)}` }),
      el('span', { class: 'itinerary__meta', text: `${formatDuration(itinerary.duration)} · ${itinerary.transfers ? tCount('route.transfers', itinerary.transfers) : t('route.direct')}` })),
    el('div', { class: 'itinerary__legs' }, parts.map((part) => el('span', {
      class: 'transit-chip',
      title: [part.agency, part.headsign && `→ ${part.headsign}`].filter(Boolean).join(' ')
    }, icon(TRANSIT_ICON[part.mode] || 'bus'), el('span', { text: part.name || t(`modes.${TRANSIT_ICON[part.mode] || 'bus'}`) })))));
}

function optionRow(leg, option) {
  const selected = option.mode === leg.mode;
  const duration = formatDuration(option.duration);
  const badge = option.status === 'ok'
    ? (option.itineraries ? t('route.timetable') : t('route.road'))
    : t('route.estimated');
  return el('li', {},
    el('button', {
      type: 'button',
      class: `option${selected ? ' is-selected' : ''}`,
      style: `--c:${mapView.ROUTE_MODES[option.mode].color}`,
      'aria-pressed': String(selected),
      onclick: () => {
        if (selected) return;
        state.modes[leg.pair] = option.mode;
        delete state.auto[leg.pair];
        persist();
        compute();
      }
    },
    el('span', { class: 'option__icon' }, icon(option.mode)),
    el('span', { class: 'option__text' },
      el('span', { class: 'option__name', text: t(`modes.${option.mode}`) }),
      el('span', { class: 'option__meta', text: option.itineraries ? `${formatDistance(option.distance)} · ${tCount('route.connectionsCount', option.itineraries.length)}` : formatDistance(option.distance) })),
    el('span', { class: 'option__side' },
      el('span', { class: 'option__time', text: option.status === 'estimate' ? t('route.approx', { value: duration }) : duration }),
      el('span', { class: `option__badge option__badge--${option.status === 'ok' && option.itineraries ? 'timetable' : option.status}`, text: badge })),
    selected ? el('span', { class: 'option__check', 'aria-hidden': 'true' }, icon('check')) : null));
}

function optionsBlock(leg) {
  const options = leg.options;
  const title = el('p', { class: 'leg__subtitle', text: t('route.options') });
  if (!options || options.status === 'loading') {
    return el('div', { class: 'leg__options' }, title,
      el('p', { class: 'leg__loading' }, el('span', { class: 'spinner' }), el('span', { text: t('route.optionsLoading') })));
  }
  if (options.status === 'error' || !options.list.length) {
    return el('div', { class: 'leg__options' }, title, el('p', { class: 'leg__note', text: t('route.noOptions') }));
  }
  return el('div', { class: 'leg__options' }, title,
    el('ul', { class: 'options' }, options.list.map((option) => optionRow(leg, option))));
}

function legDetails(leg) {
  const result = leg.result;
  const children = [optionsBlock(leg)];
  if (leg.time) children.unshift(el('p', { class: 'leg__date', text: t('route.departure', { date: formatDay(leg.time, true) }) }));
  if (result && result.note) children.push(el('p', { class: 'leg__note', text: t(result.note) }));
  if (result && result.status === 'error') {
    children.push(el('button', {
      type: 'button',
      class: 'link-btn',
      text: t('common.retry'),
      onclick: () => {
        delete state.results[leg.key];
        compute();
      }
    }));
  }
  if (result && result.itineraries && result.itineraries.length) {
    children.push(el('p', { class: 'leg__subtitle', text: t('route.connections') }));
    children.push(el('ul', { class: 'itineraries' }, result.itineraries.slice(0, 3).map(itineraryItem)));
  }
  children.push(bookingLinks(leg));
  return el('div', { class: 'leg__details' }, children);
}

function legRow(leg) {
  const expanded = state.expanded === leg.index;
  return el('li', { class: `leg${expanded ? ' is-expanded' : ''}`, style: `--c:${mapView.ROUTE_MODES[leg.mode].color}`, 'data-leg': leg.index },
    el('div', { class: 'leg__rail', 'aria-hidden': 'true' }),
    el('div', { class: 'leg__body' },
      el('div', { class: 'leg__top' },
        modeButton(leg),
        el('button', {
          type: 'button',
          class: 'leg__summary',
          'aria-expanded': String(expanded),
          onclick: () => {
            state.expanded = expanded ? null : leg.index;
            if (!expanded) fitLeg(leg);
            renderList();
          }
        }, legInfo(leg), icon('chevron'))),
      state.picker === leg.index ? modePicker(leg) : null,
      expanded ? legDetails(leg) : null));
}

function nightsControl(stop) {
  const change = (delta) => {
    const next = Math.min(MAX_NIGHTS, Math.max(0, stop.nights + delta));
    if (next === stop.nights) return;
    const target = holder(stop.id);
    target.nights = next;
    persist();
    compute();
  };
  return el('div', { class: 'nights', role: 'group', 'aria-label': t('route.nightsLabel') },
    el('button', { type: 'button', class: 'nights__btn', 'aria-label': t('route.nightsLess'), disabled: stop.nights <= 0, onclick: () => change(-1) }, icon('minus')),
    el('span', { class: 'nights__value', text: stop.nights ? tCount('route.nights', stop.nights) : t('route.passThrough') }),
    el('button', { type: 'button', class: 'nights__btn', 'aria-label': t('route.nightsMore'), disabled: stop.nights >= MAX_NIGHTS, onclick: () => change(1) }, icon('plus')));
}

function stayName(stay) {
  return stay.name || t('place.unnamed');
}

function stayCandidate(stop, stay) {
  const chosen = stop.chosen === stay.id;
  return el('li', { class: `candidate${chosen ? ' is-chosen' : ''}` },
    el('button', { type: 'button', class: 'candidate__main', onclick: () => options.onShowStay && options.onShowStay(stay) },
      el('span', { class: 'candidate__name', text: stayName(stay) }),
      el('span', { class: 'candidate__meta', text: [t(`types.${stay.type}.one`), stay.stars ? '★'.repeat(Math.floor(stay.stars.count)) : null, formatDistance(distance(stop, stay))].filter(Boolean).join(' · ') })),
    el('button', {
      type: 'button',
      class: `btn btn--small ${chosen ? 'btn--primary candidate__pick' : 'btn--secondary candidate__pick'}`,
      'aria-pressed': String(chosen),
      onclick: () => chooseStay(stop.id, chosen ? null : stay.id)
    }, chosen ? icon('check') : null, el('span', { text: chosen ? t('route.chosen') : t('route.choose') })),
    el('button', { type: 'button', class: 'icon-btn candidate__remove', 'aria-label': `${t('route.removeCandidate')}: ${stayName(stay)}`, onclick: () => removeStay(stop.id, stay.id) }, icon('close')));
}

function stayBlock(stop) {
  if (stop.nights === 0) return null;
  const chosen = stop.stays.find((stay) => stay.id === stop.chosen);
  const open = state.stayOpen === stop.id;
  const lines = [];
  if (stop.noStay) {
    lines.push(el('p', { class: 'stay__status stay__status--none', text: t('route.noStayNeeded') }));
  } else if (chosen) {
    lines.push(el('button', { type: 'button', class: 'stay__chosen', onclick: () => options.onShowStay && options.onShowStay(chosen) },
      icon(chosen.type), el('span', { text: stayName(chosen) }), icon('check')));
  } else {
    lines.push(el('p', { class: 'stay__status stay__status--warn' }, icon('alert'), el('span', { text: stop.stays.length ? t('route.noStayChosen') : t('route.noStayWarning') })));
  }
  const actions = [];
  if (!stop.noStay) {
    actions.push(el('button', { type: 'button', class: 'btn btn--secondary btn--small', onclick: () => findStay(stop) }, icon('search'), el('span', { text: t('route.findStay') })));
    if (stop.stays.length) {
      actions.push(el('button', {
        type: 'button',
        class: 'link-btn',
        'aria-expanded': String(open),
        text: tCount('route.candidates', stop.stays.length),
        onclick: () => {
          state.stayOpen = open ? null : stop.id;
          renderList();
        }
      }));
    }
  }
  const toggle = el('input', { type: 'checkbox', class: 'stay__check' });
  toggle.checked = stop.noStay;
  toggle.addEventListener('change', () => {
    const target = holder(stop.id);
    target.noStay = toggle.checked;
    persist();
    render();
  });
  return el('div', { class: 'stay' },
    lines,
    actions.length ? el('div', { class: 'stay__actions' }, actions) : null,
    open && !stop.noStay ? el('ul', { class: 'candidates' }, stop.stays.map((stay) => stayCandidate(stop, stay))) : null,
    el('label', { class: 'stay__toggle' }, toggle, el('span', { text: t('route.noStayNeeded') })));
}

function stopRow(stop, number, plan) {
  const dates = plan && plan.arrival
    ? (stop.nights ? formatRange(plan.arrival, plan.departure) : formatDay(plan.arrival))
    : null;
  return el('li', { class: `stop stop--full${needsStay(stop) ? ' needs-stay' : ''}`, 'data-id': stop.id },
    el('div', { class: 'stop__head' },
      el('button', { type: 'button', class: 'stop__grip', 'aria-label': t('route.drag'), 'data-grip': stop.id }, icon('grip')),
      el('span', { class: 'stop__badge', text: String(number) }),
      el('button', {
        type: 'button',
        class: 'stop__text stop__text--button',
        onclick: () => mapView.fitCoords([[stop.lat, stop.lon]], 13)
      },
      el('span', { class: 'stop__name', text: stop.name }),
      el('span', { class: 'stop__detail', text: [dates, stop.detail].filter(Boolean).join(' · ') })),
      el('button', {
        type: 'button',
        class: 'icon-btn stop__remove',
        'aria-label': `${t('route.remove')}: ${stop.name}`,
        onclick: () => removeStop(stop.id)
      }, icon('close'))),
    el('div', { class: 'stop__extra' }, nightsControl(stop), stayBlock(stop)));
}

function startListRow(point, plan) {
  const head = el('div', { class: 'stop__head' },
    el('span', { class: 'stop__badge stop__badge--start', text: 'S' }),
    el('span', { class: 'stop__text' },
      el('span', { class: 'stop__name', text: point.name }),
      plan && plan.arrival ? el('span', { class: 'stop__detail', text: point.nights ? formatRange(plan.arrival, plan.departure) : t('route.departure', { date: formatDay(plan.arrival, true) }) }) : null));
  if (!point.holder) return el('li', { class: 'stop stop--start' }, head);
  const stop = holder('start');
  return el('li', { class: `stop stop--start stop--full${needsStay(stop) ? ' needs-stay' : ''}` },
    head,
    el('div', { class: 'stop__extra' }, nightsControl(stop), stayBlock(stop)));
}

function renderTrip() {
  const input = el('input', { type: 'date', class: 'date-input', 'aria-label': t('route.tripStart') });
  input.value = state.tripStart || '';
  input.addEventListener('change', () => {
    state.tripStart = validDate(input.value);
    persist();
    compute();
  });
  const base = startDate();
  const nights = totalNights();
  const missing = holders().filter(needsStay).length;
  dom.trip.replaceChildren(...[
    el('div', { class: 'planner-label' }, el('span', { text: t('route.tripStart') })),
    el('div', { class: 'trip-row' },
      input,
      base && nights ? el('span', { class: 'trip-row__end', text: t('route.tripEnd', { date: formatDay(addDays(base, nights), true) }) }) : null),
    missing ? el('p', { class: 'trip-warning' }, icon('alert'), el('span', { text: tCount('route.missingStays', missing) })) : null
  ].filter(Boolean));
}

function renderList() {
  renderTrip();
  const list = points();
  const legList = legs();
  const plans = schedule();
  const rows = [];
  const offset = list[0] && list[0].start ? 1 : 0;
  list.forEach((point, index) => {
    if (!point.start) rows.push(stopRow(point, index + 1 - offset, plans[index]));
    if (legList[index]) rows.push(legRow(legList[index]));
  });
  if (list[0] && list[0].start && (legList.length || list[0].holder)) {
    rows.unshift(startListRow(list[0], plans[0]));
  }
  dom.list.replaceChildren(...rows);
  dom.empty.textContent = state.stops.length ? '' : t('route.empty');
  dom.actions.hidden = !state.stops.length;
  dom.optimize.disabled = list.length < 3;
}

function render() {
  if (!(state.startMode === 'custom' && !state.startPlace)) renderStart();
  renderList();
  renderSummary();
  renderMap();
}

function update() {
  renderStart();
  compute();
}

export function refreshStart() {
  const user = options.getUser();
  const key = user ? `${user.lat.toFixed(3)},${user.lon.toFixed(3)}` : null;
  if (user && key !== state.gpsKey) {
    state.gpsKey = key;
    reverseGeocode(user.lat, user.lon, getLanguage()).then((name) => {
      if (name && name !== state.gpsName) {
        state.gpsName = name;
        renderStart();
        renderList();
      }
    }).catch(() => {});
  }
  renderStart();
  if (state.startMode === 'gps') compute();
}

function removeStop(id) {
  const index = state.stops.findIndex((stop) => stop.id === id);
  if (index < 0) return;
  const [removed] = state.stops.splice(index, 1);
  state.expanded = null;
  state.picker = null;
  persist();
  compute();
  toast(t('route.removedStop', { name: removed.name }), {
    duration: 5000,
    action: {
      label: t('favorites.undo'),
      onClick: () => {
        state.stops.splice(Math.min(index, state.stops.length), 0, removed);
        persist();
        compute();
      }
    }
  });
}

export function addStop(place) {
  const stop = validStop({ ...place, id: newId() });
  if (!stop) return false;
  const duplicate = state.stops.some((item) => distance(item, stop) < 50);
  if (duplicate) {
    toast(t('route.duplicate', { name: stop.name }));
    return false;
  }
  state.stops.push(stop);
  persist();
  compute();
  return true;
}

export function applyPlan({ startPlace = null, stops = [] } = {}) {
  if (startPlace) {
    state.startMode = 'custom';
    state.startPlace = validStop({ nights: 0, ...startPlace, id: 'start' });
  }
  state.stops = stops.map((stop) => validStop({ ...stop, id: newId() })).filter(Boolean);
  state.modes = {};
  state.auto = {};
  persist();
  update();
  fitRoute();
}

function routeLength(order, start) {
  let total = 0;
  let previous = start;
  for (const stop of order) {
    if (previous) total += distance(previous, stop);
    previous = stop;
  }
  return total;
}

function permutations(items) {
  if (items.length <= 1) return [items];
  const result = [];
  items.forEach((item, index) => {
    const rest = [...items.slice(0, index), ...items.slice(index + 1)];
    for (const tail of permutations(rest)) result.push([item, ...tail]);
  });
  return result;
}

function bestOrder(middle, first, last) {
  const cost = (order) => routeLength([...order, last], first);
  if (middle.length <= BRUTE_FORCE_LIMIT) {
    let best = middle;
    let bestCost = cost(middle);
    for (const order of permutations(middle)) {
      const value = cost(order);
      if (value < bestCost - 1) {
        best = order;
        bestCost = value;
      }
    }
    return best;
  }
  const remaining = [...middle];
  const order = [];
  let current = first;
  while (remaining.length) {
    let index = 0;
    for (let i = 1; i < remaining.length; i += 1) {
      if (distance(current, remaining[i]) < distance(current, remaining[index])) index = i;
    }
    current = remaining.splice(index, 1)[0];
    order.push(current);
  }
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 0; i < order.length - 1; i += 1) {
      for (let j = i + 1; j < order.length; j += 1) {
        const candidate = [...order.slice(0, i), ...order.slice(i, j + 1).reverse(), ...order.slice(j + 1)];
        if (cost(candidate) < cost(order) - 1) {
          order.splice(0, order.length, ...candidate);
          improved = true;
        }
      }
    }
  }
  return order;
}

function optimize() {
  const start = startPoint();
  const all = [...state.stops];
  const first = start || all.shift();
  if (!first || all.length < 2) {
    toast(t('route.optimizeNeed'));
    return;
  }
  const last = all.pop();
  const before = routeLength([...all, last], first);
  const order = bestOrder(all, first, last);
  const after = routeLength([...order, last], first);
  if (before - after < 1000) {
    toast(t('route.alreadyOptimal'));
    return;
  }
  state.stops = start ? [...order, last] : [first, ...order, last];
  state.expanded = null;
  persist();
  compute();
  toast(t('route.optimized', { d: formatDistance(before - after) }));
}

function clearRoute() {
  const previous = { stops: state.stops, modes: state.modes };
  state.stops = [];
  state.modes = {};
  state.auto = {};
  state.expanded = null;
  persist();
  compute();
  toast(t('route.cleared'), {
    duration: 6000,
    action: {
      label: t('favorites.undo'),
      onClick: () => {
        state.stops = previous.stops;
        state.modes = previous.modes;
        persist();
        compute();
        fitRoute();
      }
    }
  });
}

function initDrag() {
  let drag = null;
  dom.list.addEventListener('pointerdown', (event) => {
    const grip = event.target.closest('[data-grip]');
    if (!grip || event.button !== 0) return;
    event.preventDefault();
    const row = grip.closest('.stop');
    dom.list.classList.add('is-sorting');
    row.classList.add('is-dragging');
    drag = { id: grip.dataset.grip, row, startY: event.clientY, pointer: event.pointerId, target: null };
    grip.setPointerCapture(event.pointerId);
  });
  dom.list.addEventListener('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.pointer) return;
    drag.row.style.transform = `translateY(${event.clientY - drag.startY}px)`;
    const others = [...dom.list.querySelectorAll('.stop[data-id]')].filter((row) => row !== drag.row);
    let target = others.length;
    for (let i = 0; i < others.length; i += 1) {
      const rect = others[i].getBoundingClientRect();
      if (event.clientY < rect.top + rect.height / 2) {
        target = i;
        break;
      }
    }
    drag.target = target;
    others.forEach((row, i) => {
      row.classList.toggle('drop-before', i === target);
      row.classList.toggle('drop-after', target === others.length && i === others.length - 1);
    });
  });
  const finish = (event) => {
    if (!drag || event.pointerId !== drag.pointer) return;
    const { id, target } = drag;
    drag = null;
    dom.list.classList.remove('is-sorting');
    if (target === null) {
      renderList();
      return;
    }
    const index = state.stops.findIndex((stop) => stop.id === id);
    const [moved] = state.stops.splice(index, 1);
    state.stops.splice(target, 0, moved);
    state.expanded = null;
    state.picker = null;
    persist();
    compute();
  };
  dom.list.addEventListener('pointerup', finish);
  dom.list.addEventListener('pointercancel', finish);
}

export function initPlanner(container, opts) {
  options = opts;
  restore();
  dom.trip = el('section', { class: 'planner-section' });
  dom.start = el('section', { class: 'planner-section' });
  dom.list = el('ol', { class: 'route-list' });
  dom.empty = el('p', { class: 'empty empty--compact planner-empty' });
  dom.add = el('section', { class: 'planner-section planner-section--add' });
  dom.optimize = el('button', { type: 'button', class: 'btn btn--secondary btn--small', onclick: optimize });
  dom.clear = el('button', { type: 'button', class: 'btn btn--ghost btn--small', onclick: clearRoute });
  dom.actions = el('div', { class: 'route-actions' }, dom.optimize, dom.clear);
  container.replaceChildren(el('div', { class: 'planner' },
    dom.trip,
    dom.start,
    el('section', { class: 'planner-section planner-section--route' }, dom.list, dom.empty),
    dom.add,
    dom.actions));
  initDrag();
  mapView.setRouteHandlers({
    onLegClick: (index) => {
      state.expanded = index;
      renderList();
      if (options.onShow) options.onShow();
      const row = dom.list.querySelector(`[data-leg="${index}"]`);
      if (row) row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    },
    onStopClick: () => {
      if (options.onShow) options.onShow();
    }
  });
  renderPlanner();
}

export function renderPlanner() {
  renderStart();
  dom.add.replaceChildren(
    el('div', { class: 'planner-label' }, el('span', { text: t('route.addStop') })),
    makeSearch({
      placeholder: t('route.stopSearch'),
      onPick: (place) => {
        if (addStop(place)) fitRoute();
      }
    }));
  dom.optimize.replaceChildren(icon('sparkle'), el('span', { text: t('route.optimize') }));
  dom.clear.textContent = t('route.clear');
  compute();
}

export function hasRoute() {
  return state.stops.length > 0;
}

function findStay(stop) {
  state.stayTarget = stop.id;
  if (options.onFindStay) options.onFindStay(stop);
}

function chooseStay(stopId, stayId) {
  const stop = holder(stopId);
  if (!stop) return;
  stop.chosen = stayId;
  if (stayId) stop.noStay = false;
  persist();
  render();
  if (options.onStaysChanged) options.onStaysChanged();
}

function removeStay(stopId, stayId) {
  const stop = holder(stopId);
  if (!stop) return;
  stop.stays = stop.stays.filter((stay) => stay.id !== stayId);
  if (stop.chosen === stayId) stop.chosen = null;
  persist();
  render();
  if (options.onStaysChanged) options.onStaysChanged();
}

export function stayTargetFor(place) {
  const candidates = holders().filter((stop) => stop.nights > 0);
  const explicit = candidates.find((stop) => stop.id === state.stayTarget);
  if (explicit && distance(explicit, place) <= TARGET_RADIUS) return explicit;
  let best = null;
  for (const stop of candidates) {
    const d = distance(stop, place);
    if (d <= STAY_RADIUS && (!best || d < best.d)) best = { stop, d };
  }
  return best ? best.stop : null;
}

export function stayStatus(stopId, placeId) {
  const stop = holder(stopId);
  if (!stop) return { saved: false, chosen: false };
  return { saved: stop.stays.some((stay) => stay.id === placeId), chosen: stop.chosen === placeId };
}

export function toggleStay(stopId, place) {
  const stop = holder(stopId);
  if (!stop) return false;
  const index = stop.stays.findIndex((stay) => stay.id === place.id);
  if (index >= 0) {
    stop.stays.splice(index, 1);
    if (stop.chosen === place.id) stop.chosen = null;
  } else {
    const stay = validStay(place);
    if (!stay) return false;
    if (stop.stays.length >= MAX_STAYS) stop.stays.shift();
    stop.stays.push(stay);
    stop.noStay = false;
    if (!stop.chosen && stop.stays.length === 1) stop.chosen = stay.id;
    state.stayOpen = stop.id;
  }
  persist();
  render();
  return index < 0;
}

export function stayDatesFor(place) {
  const stop = stayTargetFor(place);
  if (!stop || !state.tripStart) return null;
  const list = points();
  const index = list.findIndex((point) => point.key === stop.id);
  const plan = schedule()[index];
  if (!plan || !plan.arrival || !stop.nights) return null;
  return { checkin: isoDate(plan.arrival), checkout: isoDate(plan.departure), stop: stop.name };
}
