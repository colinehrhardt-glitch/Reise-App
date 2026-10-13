import { t, tCount, getLanguage, formatDistance } from './i18n.js';
import { load, save } from './storage.js';
import { searchPlaces, routeStreet, routeTransit, reverseGeocode } from './api.js';
import * as mapView from './map.js';
import { el, icon, distance, errorMessage, toast } from './ui.js';

export const MODES = ['walk', 'car', 'bus', 'train', 'ferry', 'flight'];

const STORAGE_KEY = 'route';
const BRUTE_FORCE_LIMIT = 7;
const TRANSIT_ICON = {
  BUS: 'bus', COACH: 'bus', TRAM: 'train', SUBWAY: 'train', FERRY: 'ferry', AIRPLANE: 'flight',
  HIGHSPEED_RAIL: 'train', LONG_DISTANCE: 'train', NIGHT_RAIL: 'train', REGIONAL_FAST_RAIL: 'train',
  REGIONAL_RAIL: 'train', RAIL: 'train', SUBURBAN: 'train', METRO: 'train', WALK: 'walk'
};

const state = {
  startMode: 'gps',
  startPlace: null,
  stops: [],
  modes: {},
  auto: {},
  results: {},
  picker: null,
  expanded: null,
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

function newId() {
  return `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

function restore() {
  const raw = load(STORAGE_KEY, null);
  if (!raw || typeof raw !== 'object') return;
  state.startMode = raw.startMode === 'custom' ? 'custom' : 'gps';
  state.startPlace = validPlace(raw.startPlace);
  state.stops = Array.isArray(raw.stops) ? raw.stops.map(validPlace).filter(Boolean).slice(0, 40) : [];
  state.modes = {};
  if (raw.modes && typeof raw.modes === 'object') {
    for (const [pair, mode] of Object.entries(raw.modes)) {
      if (MODES.includes(mode) && pair.length < 100) state.modes[pair] = mode;
    }
  }
}

function persist() {
  const ok = save(STORAGE_KEY, {
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
  return state.startPlace ? { ...state.startPlace, key: 'start', start: true } : null;
}

function points() {
  const start = startPoint();
  const stops = state.stops.map((stop) => ({ ...stop, key: stop.id }));
  return start ? [start, ...stops] : stops;
}

function pairKey(a, b) {
  return `${a.key}>${b.key}`;
}

function suggestMode(a, b) {
  const km = distance(a, b) / 1000;
  if (km < 2) return 'walk';
  if (km < 50) return 'bus';
  if (km < 700) return 'train';
  return 'flight';
}

function legMode(a, b) {
  const pair = pairKey(a, b);
  return state.modes[pair] || state.auto[pair] || suggestMode(a, b);
}

function legKey(a, b, mode) {
  return `${pairKey(a, b)}|${mode}|${a.lat.toFixed(4)},${a.lon.toFixed(4)}|${b.lat.toFixed(4)},${b.lon.toFixed(4)}`;
}

function legs() {
  const list = points();
  const result = [];
  for (let i = 0; i < list.length - 1; i += 1) {
    const a = list[i];
    const b = list[i + 1];
    const mode = legMode(a, b);
    const key = legKey(a, b, mode);
    result.push({ index: i, a, b, mode, key, pair: pairKey(a, b), result: state.results[key] || null });
  }
  return result;
}

function straight(a, b) {
  return [[a.lat, a.lon], [b.lat, b.lon]];
}

async function computeLeg(leg, signal) {
  const { a, b, mode, pair } = leg;
  const km = distance(a, b) / 1000;
  if (mode === 'car' || mode === 'walk') {
    const route = await routeStreet(mode, a, b, signal);
    return { status: 'ok', distance: route.distance, duration: route.duration, coords: route.coords };
  }
  if (mode === 'flight') {
    return { status: 'estimate', distance: km * 1000, duration: (km / 800 + 0.5) * 3600, coords: mapView.arcCoords(a, b), note: 'route.flightNote' };
  }
  let itineraries = [];
  try {
    itineraries = await routeTransit(mode, a, b, signal);
  } catch (error) {
    if (error.code === 'aborted') throw error;
  }
  if (itineraries.length) {
    const best = itineraries[0];
    const coords = best.legs.flatMap((part) => part.coords);
    const travelled = best.legs.reduce((sum, part) => sum + part.distance, 0);
    return {
      status: 'ok',
      distance: travelled || km * 1000,
      duration: best.duration,
      coords: coords.length > 1 ? coords : straight(a, b),
      itineraries
    };
  }
  if (mode === 'ferry') {
    return { status: 'estimate', distance: km * 1000, duration: (km * 1.1 / 30 + 0.5) * 3600, coords: straight(a, b), note: 'route.ferryNote' };
  }
  try {
    const road = await routeStreet('car', a, b, signal);
    const duration = mode === 'bus' ? road.duration * 1.35 : Math.max(road.duration * 0.8, (road.distance / 1000 / 85) * 3600);
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

function compute() {
  if (state.run) state.run.abort();
  const controller = new AbortController();
  state.run = controller;
  const jobs = legs().filter((leg) => !leg.result || leg.result.status === 'loading');
  for (const job of jobs) state.results[job.key] = { status: 'loading' };
  render();
  if (!jobs.length) return;
  (async () => {
    let again = false;
    for (const job of jobs) {
      if (controller.signal.aborted) return;
      try {
        const result = await computeLeg(job, controller.signal);
        if (controller.signal.aborted) return;
        if (result.status === 'switch') {
          delete state.results[job.key];
          again = true;
        } else {
          state.results[job.key] = result;
        }
      } catch (error) {
        if (controller.signal.aborted || error.code === 'aborted') {
          delete state.results[job.key];
          return;
        }
        state.results[job.key] = { status: 'error', code: error.code || 'server' };
      }
      renderList();
      renderSummary();
      renderMap();
    }
    if (again && state.run === controller) compute();
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

export function summaryText() {
  const total = totals();
  if (!total.count) return state.stops.length ? t('route.needStart') : '';
  if (total.pending) return t('route.loading');
  const duration = formatDuration(total.seconds);
  return t('route.summary', {
    legs: tCount('route.legs', total.count),
    distance: formatDistance(total.meters),
    duration: total.estimated ? t('route.approx', { value: duration }) : duration
  });
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
        state.startPlace = { ...place, id: 'start' };
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
    const query = `${t('route.flightsQuery', { from: a.linkName || a.name, to: b.linkName || b.name })}`;
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

function legDetails(leg) {
  const result = leg.result;
  const children = [];
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
            renderList();
            if (!expanded) fitLeg(leg);
          }
        }, legInfo(leg), icon('chevron'))),
      state.picker === leg.index ? modePicker(leg) : null,
      expanded ? legDetails(leg) : null));
}

function stopRow(stop, number) {
  return el('li', { class: 'stop', 'data-id': stop.id },
    el('button', { type: 'button', class: 'stop__grip', 'aria-label': t('route.drag'), 'data-grip': stop.id }, icon('grip')),
    el('span', { class: 'stop__badge', text: String(number) }),
    el('button', {
      type: 'button',
      class: 'stop__text stop__text--button',
      onclick: () => mapView.fitCoords([[stop.lat, stop.lon]], 13)
    },
    el('span', { class: 'stop__name', text: stop.name }),
    stop.detail ? el('span', { class: 'stop__detail', text: stop.detail }) : null),
    el('button', {
      type: 'button',
      class: 'icon-btn stop__remove',
      'aria-label': `${t('route.remove')}: ${stop.name}`,
      onclick: () => removeStop(stop.id)
    }, icon('close')));
}

function renderList() {
  const list = points();
  const legList = legs();
  const rows = [];
  const offset = list[0] && list[0].start ? 1 : 0;
  list.forEach((point, index) => {
    if (!point.start) rows.push(stopRow(point, index + 1 - offset));
    if (legList[index]) rows.push(legRow(legList[index]));
  });
  if (list[0] && list[0].start && legList.length) {
    rows.unshift(el('li', { class: 'stop stop--start' },
      el('span', { class: 'stop__badge stop__badge--start', text: 'S' }),
      el('span', { class: 'stop__text' }, el('span', { class: 'stop__name', text: list[0].name }))));
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
  const stop = validPlace({ ...place, id: newId() });
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
    state.startPlace = validPlace({ ...startPlace, id: 'start' });
  }
  state.stops = stops.map((stop) => validPlace({ ...stop, id: newId() })).filter(Boolean);
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
  dom.start = el('section', { class: 'planner-section' });
  dom.list = el('ol', { class: 'route-list' });
  dom.empty = el('p', { class: 'empty empty--compact planner-empty' });
  dom.add = el('section', { class: 'planner-section planner-section--add' });
  dom.optimize = el('button', { type: 'button', class: 'btn btn--secondary btn--small', onclick: optimize });
  dom.clear = el('button', { type: 'button', class: 'btn btn--ghost btn--small', onclick: clearRoute });
  dom.actions = el('div', { class: 'route-actions' }, dom.optimize, dom.clear);
  container.replaceChildren(el('div', { class: 'planner' },
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
