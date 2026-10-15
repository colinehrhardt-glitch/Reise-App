import { t, tCount, getLanguage, formatDistance } from './i18n.js';
import { searchPlaces, routeStreet, routeTransit, reverseGeocode, nearestAirport, nearbyStations, shortLabel } from './api.js';
import * as mapView from './map.js';
import { el, icon, distance, errorMessage, toast } from './ui.js';
import { getRecent, addRecent } from './recent.js';
import { buildIcs, downloadFile, shareText, overviewList } from './overview.js';
import { SIGHT_TYPES } from './info.js';
import { loadTrips, saveTrip, initTrips, renderTrips, activeTripName } from './trips.js';

export const MODES = ['walk', 'car', 'bus', 'train', 'ferry', 'flight'];

const BRUTE_FORCE_LIMIT = 7;
const DEFAULT_NIGHTS = 2;
const MAX_NIGHTS = 90;
const MAX_STAYS = 12;
const MAX_SIGHTS = 30;
const MAX_STOPS = 40;
const STAY_RADIUS = 30000;
const TARGET_RADIUS = 60000;
const DAY = 24 * 60 * 60 * 1000;
const STAY_TYPES = ['hotel', 'hostel', 'guest_house', 'apartment', 'motel'];
const NO_PASSENGER_RAIL = new Set(['ad', 'bb', 'bh', 'bi', 'bn', 'bs', 'bt', 'bz', 'co', 'cy', 'do', 'fj', 'gm', 'gt', 'gw', 'hn', 'ht', 'is', 'jm', 'kw', 'lr', 'ly', 'mt', 'mv', 'ne', 'ni', 'om', 'pa', 'pg', 'py', 'qa', 'rw', 'sb', 'sl', 'sm', 'so', 'sv', 'td', 'tl', 've', 'ye']);
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
  avoid: [],
  stationChoice: {},
  auto: {},
  results: {},
  options: {},
  transfers: {},
  picker: null,
  expanded: null,
  stayOpen: null,
  stayTarget: null,
  run: null,
  gpsName: null,
  gpsCountry: null,
  gpsKey: null,
  locating: false,
  dragging: false,
  startEditing: false,
  overviewOpen: false,
  sightsOpen: null,
  modesOpen: false,
  tripRun: 0
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
    name: text(raw.name) || t('route.unnamed'),
    detail: text(raw.detail),
    country: typeof raw.country === 'string' && /^[a-z]{2}$/.test(raw.country) ? raw.country : null,
    wikidata: typeof raw.wikidata === 'string' && /^Q\d+$/.test(raw.wikidata) ? raw.wikidata : null,
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

function validSight(raw) {
  if (!raw || typeof raw.id !== 'string' || typeof raw.name !== 'string' || !Number.isFinite(raw.lat) || !Number.isFinite(raw.lon)) return null;
  return {
    id: raw.id.slice(0, 40),
    kind: 'sight',
    name: raw.name.slice(0, 120),
    type: SIGHT_TYPES.includes(raw.type) ? raw.type : 'attraction',
    lat: raw.lat,
    lon: raw.lon,
    wikidata: typeof raw.wikidata === 'string' && /^Q\d+$/.test(raw.wikidata) ? raw.wikidata : null,
    wikiTitle: typeof raw.wikiTitle === 'string' ? raw.wikiTitle.slice(0, 200) : null,
    wikiLang: typeof raw.wikiLang === 'string' && /^[a-z]{2}$/.test(raw.wikiLang) ? raw.wikiLang : null,
    image: typeof raw.image === 'string' && /^https:\/\//.test(raw.image) ? raw.image.slice(0, 400) : null
  };
}

function validStop(raw) {
  const place = validPlace(raw);
  if (!place) return null;
  const nights = Number.isInteger(raw.nights) ? Math.min(MAX_NIGHTS, Math.max(0, raw.nights)) : DEFAULT_NIGHTS;
  const stays = Array.isArray(raw.stays) ? raw.stays.map(validStay).filter(Boolean).slice(0, MAX_STAYS) : [];
  const chosen = typeof raw.chosen === 'string' && stays.some((stay) => stay.id === raw.chosen) ? raw.chosen : null;
  const sights = Array.isArray(raw.sights) ? raw.sights.map(validSight).filter(Boolean).slice(0, MAX_SIGHTS) : [];
  return { ...place, nights, noStay: raw.noStay === true, stays, chosen, sights };
}

function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T12:00:00`)) ? value : null;
}

function newId() {
  return `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

function sanitizeTrip(raw) {
  const data = raw && typeof raw === 'object' ? raw : {};
  const stations = {};
  if (data.stations && typeof data.stations === 'object') {
    for (const [key, value] of Object.entries(data.stations)) {
      if (key.length < 60 && value && typeof value.name === 'string' && Number.isFinite(value.lat) && Number.isFinite(value.lon)) {
        stations[key] = { name: value.name.slice(0, 80), lat: value.lat, lon: value.lon };
      }
    }
  }
  const modes = {};
  if (data.modes && typeof data.modes === 'object') {
    for (const [pair, mode] of Object.entries(data.modes)) {
      if (MODES.includes(mode) && pair.length < 100) modes[pair] = mode;
    }
  }
  const avoid = Array.isArray(data.avoid) ? MODES.filter((mode) => data.avoid.includes(mode)) : [];
  return {
    tripStart: validDate(data.tripStart),
    startMode: data.startMode === 'custom' ? 'custom' : 'gps',
    startPlace: data.startPlace ? validStop({ nights: 0, ...data.startPlace, id: 'start' }) : null,
    stops: Array.isArray(data.stops) ? data.stops.map(validStop).filter(Boolean).slice(0, MAX_STOPS) : [],
    modes,
    avoid: avoid.length === MODES.length ? [] : avoid,
    stations
  };
}

function applyTrip(data) {
  state.tripStart = data.tripStart;
  state.startMode = data.startMode;
  state.startPlace = data.startPlace;
  state.stops = data.stops;
  state.modes = data.modes;
  state.avoid = data.avoid;
  state.stationChoice = data.stations;
}

function tripData() {
  return {
    tripStart: state.tripStart,
    startMode: state.startMode,
    startPlace: state.startPlace,
    stops: state.stops,
    modes: state.modes,
    avoid: state.avoid,
    stations: state.stationChoice
  };
}

function persist() {
  if (!saveTrip(tripData())) toast(t('favorites.storageError'), { type: 'error', duration: 6000 });
}

function loadTrip(raw) {
  applyTrip(sanitizeTrip(raw));
  state.tripRun += 1;
  state.auto = {};
  state.picker = null;
  state.expanded = null;
  state.stayOpen = null;
  state.stayTarget = null;
  state.sightsOpen = null;
  state.overviewOpen = false;
  state.startEditing = false;
  state.modesOpen = false;
  dom.startView = null;
  renderStart();
  compute();
  fitRoute();
  if (options.onTripChange) options.onTripChange();
}

function validTrip(raw) {
  const data = sanitizeTrip(raw);
  return data.stops.length || data.startPlace ? data : null;
}

function startPoint() {
  if (state.startMode === 'gps') {
    const user = options.getUser();
    if (!user) return null;
    return {
      key: 'gps',
      name: state.gpsName ? t('route.myLocationIn', { place: state.gpsName }) : t('route.startGps'),
      linkName: state.gpsName,
      country: state.gpsCountry,
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
    const day = offset;
    offset += nights;
    return { arrival, departure: base ? addDays(base, offset) : null, nights, day, leave: offset };
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

function firstAllowed(order) {
  return order.find((mode) => !state.avoid.includes(mode)) || order[0];
}

function suggestMode(a, b) {
  const km = distance(a, b) / 1000;
  if (km < 2) return firstAllowed(['walk', 'bus', 'car', 'train', 'ferry', 'flight']);
  if (km < 700) return firstAllowed(['bus', 'train', 'car', 'ferry', 'flight', 'walk']);
  return firstAllowed(['flight', 'train', 'bus', 'car', 'ferry', 'walk']);
}

function pickOption(list, km) {
  const allowed = list.filter((option) => !state.avoid.includes(option.mode));
  return chooseOption(allowed.length ? allowed : list, km);
}

function chooseOption(list, km) {
  const has = (mode) => list.find((option) => option.mode === mode);
  if (km < 2 && has('walk')) return 'walk';
  const flight = has('flight');
  const surface = list.filter((option) => option.mode !== 'flight' && option.mode !== 'car');
  const fastestSurface = surface.length ? Math.min(...surface.map((option) => option.duration)) : Infinity;
  if (km >= 450 && flight && flight.duration * 2 < fastestSurface) return 'flight';
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

const TERMINAL_KIND = { bus: 'bus_station', train: 'train_station', flight: 'airport', ferry: 'ferry_terminal' };
const TERMINAL_ICON = { bus_station: 'bus', train_station: 'train', airport: 'flight', ferry_terminal: 'ferry' };

function partCoords(part) {
  if (part.mode !== 'AIRPLANE' || part.coords.length < 2) return part.coords;
  const first = part.coords[0];
  const last = part.coords[part.coords.length - 1];
  return mapView.arcCoords({ lat: first[0], lon: first[1] }, { lat: last[0], lon: last[1] });
}

function terminalFromPart(part, end, kind) {
  const point = end === 'from' ? part.coords[0] : part.coords[part.coords.length - 1];
  if (!point) return null;
  const name = (end === 'from' ? part.from : part.to) || '';
  return { kind, name, label: shortLabel(name), lat: point[0], lon: point[1] };
}

function transitResult(itineraries, a, b, mode) {
  const best = itineraries[0];
  const segments = best.legs
    .filter((part) => part.coords.length > 1)
    .map((part) => ({ kind: part.mode === 'WALK' ? 'ground' : 'main', coords: partCoords(part) }));
  const coords = segments.flatMap((segment) => segment.coords);
  const travelled = best.legs.reduce((sum, part) => sum + part.distance, 0);
  const rides = best.legs.filter((part) => part.mode !== 'WALK' && part.coords.length > 1);
  const kind = TERMINAL_KIND[mode] || 'bus_station';
  const terminals = rides.length ? [terminalFromPart(rides[0], 'from', kind), terminalFromPart(rides[rides.length - 1], 'to', kind)] : null;
  return {
    status: 'ok',
    distance: travelled || distance(a, b),
    duration: best.duration,
    coords: coords.length > 1 ? coords : straight(a, b),
    segments: segments.length ? segments : null,
    terminals: terminals && terminals.every(Boolean) ? terminals : null,
    itineraries
  };
}

function flightEstimate(a, b) {
  const km = distance(a, b) / 1000;
  return { status: 'estimate', distance: km * 1000, duration: (km / 800 + 0.5) * 3600, coords: mapView.arcCoords(a, b), note: 'route.flightNote' };
}

async function safely(task) {
  try {
    return await task();
  } catch (error) {
    if (error.code === 'aborted') throw error;
    return null;
  }
}

function withTerminals(a, b, from, to, main, extra) {
  return {
    coords: [[a.lat, a.lon], ...main, [b.lat, b.lon]],
    segments: [
      { kind: 'ground', coords: [[a.lat, a.lon], [from.lat, from.lon]] },
      { kind: 'main', coords: main },
      { kind: 'ground', coords: [[to.lat, to.lon], [b.lat, b.lon]] }
    ],
    terminals: [from, to],
    ...extra
  };
}

async function computeFlight(a, b) {
  const from = await safely(() => nearestAirport(a));
  const to = await safely(() => nearestAirport(b));
  if (!from || !to || from.iata === to.iata) return flightEstimate(a, b);
  const air = distance(from, to);
  const groundA = distance(a, from);
  const groundB = distance(to, b);
  const flightTime = (air / 1000 / 800 + 0.5) * 3600;
  const groundTime = ((groundA + groundB) / 1000 / 35) * 3600;
  return {
    status: 'estimate',
    distance: air + groundA + groundB,
    duration: flightTime + groundTime + 5400,
    flightTime,
    airports: [from, to],
    note: 'route.flightNoteAirports',
    ...withTerminals(a, b, from, to, mapView.arcCoords(from, to))
  };
}

function stationKey(point, type) {
  return `${type}|${point.lat.toFixed(2)},${point.lon.toFixed(2)}`;
}

function chosenStation(point, type, list) {
  const choice = state.stationChoice[stationKey(point, type)];
  const match = choice ? list.find((station) => Math.abs(station.lat - choice.lat) < 1e-5 && Math.abs(station.lon - choice.lon) < 1e-5) : null;
  return match || list[0] || null;
}

async function stationsFor(a, b, type, signal) {
  const [listA, listB] = await Promise.all([
    safely(() => nearbyStations(a, type, signal)),
    safely(() => nearbyStations(b, type, signal))
  ]);
  const lists = [listA || [], listB || []];
  const from = chosenStation(a, type, lists[0]);
  const to = chosenStation(b, type, lists[1]);
  if (!from || !to || distance(from, to) < 2000) return null;
  return { from, to, choices: { type, lists } };
}

function chooseStation(point, type, station) {
  const key = stationKey(point, type);
  state.stationChoice[key] = { name: station.name, lat: station.lat, lon: station.lon };
  persist();
  for (const leg of legs()) {
    if (stationKey(leg.a, type) !== key && stationKey(leg.b, type) !== key) continue;
    delete state.options[leg.base];
    for (const resultKey of Object.keys(state.results)) {
      if (resultKey.startsWith(`${leg.base}|`)) delete state.results[resultKey];
    }
  }
  compute();
}

function stationPicker(leg, end) {
  const choices = leg.result.stationChoices;
  const index = end === 'depart' ? 0 : 1;
  const list = choices && choices.lists[index];
  if (!list || list.length < 2) return null;
  const point = end === 'depart' ? leg.a : leg.b;
  const current = leg.result.terminals[index];
  const label = t(end === 'depart' ? 'route.stationFrom' : 'route.stationTo');
  const select = el('select', { class: 'select select--compact transfer__select', 'aria-label': label },
    list.map((station, position) => {
      const option = el('option', { value: String(position), text: `${station.name} · ${formatDistance(distance(point, station))}` });
      option.selected = Math.abs(station.lat - current.lat) < 1e-5 && Math.abs(station.lon - current.lon) < 1e-5;
      return option;
    }));
  select.addEventListener('change', () => {
    const station = list[Number(select.value)];
    if (station) chooseStation(point, choices.type, station);
  });
  return el('label', { class: 'transfer__pick' }, el('span', { class: 'transfer__pick-label', text: label }), select);
}

async function stationEstimate(a, b, mode, signal, road = null) {
  const type = mode === 'train' ? 'train' : 'bus';
  const stations = await stationsFor(a, b, type, signal);
  if (!stations) {
    if (mode === 'bus' && road) return { ...busEstimate(road), note: 'route.busNoStation' };
    return null;
  }
  const { from, to, choices } = stations;
  const ground = ((distance(a, from) + distance(to, b)) / 1000 / 30) * 3600;
  if (mode === 'bus') {
    const between = await safely(() => routeStreet('car', from, to, signal));
    const base = between || road;
    if (!base) return null;
    return {
      status: 'estimate',
      distance: base.distance,
      duration: base.duration * 1.35 + ground,
      note: 'route.busStationNote',
      stationChoices: choices,
      ...withTerminals(a, b, from, to, between ? between.coords : base.coords)
    };
  }
  const km = distance(from, to) / 1000;
  return {
    status: 'estimate',
    distance: km * 1250,
    duration: (km * 1.25 / 80) * 3600 + ground,
    note: 'route.trainStationNote',
    stationChoices: choices,
    ...withTerminals(a, b, from, to, straight(from, to))
  };
}

function railPossible(a, b) {
  return !NO_PASSENGER_RAIL.has(a.country) && !NO_PASSENGER_RAIL.has(b.country);
}

function ferryEstimate(a, b) {
  const km = distance(a, b) / 1000;
  return { status: 'estimate', distance: km * 1000, duration: (km * 1.1 / 30 + 0.5) * 3600, coords: straight(a, b), note: 'route.ferryNote' };
}

function busEstimate(road) {
  return { status: 'estimate', distance: road.distance, duration: road.duration * 1.35, coords: road.coords, note: 'route.estimateNote' };
}

async function roadOrError(a, b, signal) {
  try {
    return { road: await routeStreet('car', a, b, signal), error: null };
  } catch (error) {
    if (error.code === 'aborted') throw error;
    return { road: null, error };
  }
}

async function computeOptions(leg, signal) {
  const { a, b, time } = leg;
  const km = distance(a, b) / 1000;
  const found = new Map();
  const [walk, roadResult, itineraries, flight] = await Promise.all([
    km <= 12 ? safely(() => routeStreet('walk', a, b, signal)) : null,
    roadOrError(a, b, signal),
    km >= 1 ? safely(() => routeTransit('all', a, b, signal, time)) : null,
    km >= 250 ? computeFlight(a, b) : null
  ]);
  const road = roadResult.road;
  const noRoad = !road && roadResult.error && roadResult.error.code === 'noroute';
  if (walk) found.set('walk', { status: 'ok', distance: walk.distance, duration: walk.duration, coords: walk.coords });
  if (road) found.set('car', { status: 'ok', distance: road.distance, duration: road.duration, coords: road.coords });
  const groups = {};
  for (const itinerary of itineraries || []) {
    const mode = mainMode(itinerary);
    if (!mode) continue;
    (groups[mode] = groups[mode] || []).push(itinerary);
  }
  for (const [mode, list] of Object.entries(groups)) {
    list.sort((x, y) => x.duration - y.duration);
    found.set(mode, transitResult(list, a, b, mode));
  }
  const [bus, train] = await Promise.all([
    !found.has('bus') && road && km >= 3 ? (km >= 20 ? stationEstimate(a, b, 'bus', signal, road) : busEstimate(road)) : null,
    !found.has('train') && km >= 30 && km <= 1500 && railPossible(a, b) ? stationEstimate(a, b, 'train', signal) : null
  ]);
  if (bus) found.set('bus', bus);
  if (train) found.set('train', train);
  if (!found.has('ferry') && noRoad && km < 600) found.set('ferry', ferryEstimate(a, b));
  if (!found.has('flight')) {
    if (flight) found.set('flight', flight);
    else if (noRoad && km >= 600) found.set('flight', await computeFlight(a, b));
  }
  if (!road && !noRoad && !found.size) throw roadResult.error;
  return MODES.filter((mode) => found.has(mode))
    .map((mode) => ({ mode, ...found.get(mode) }))
    .sort((x, y) => x.duration - y.duration);
}

function straight(a, b) {
  return [[a.lat, a.lon], [b.lat, b.lon]];
}

function originOf(point) {
  const source = point.holder ? holder('start') : point.start ? null : state.stops.find((stop) => stop.id === point.key);
  const stay = source && source.chosen ? source.stays.find((item) => item.id === source.chosen) : null;
  if (stay) return { lat: stay.lat, lon: stay.lon, name: stay.name || t('place.unnamed'), stay: true };
  return { lat: point.lat, lon: point.lon, name: point.linkName || point.name, stay: false };
}

function transferKey(leg, end) {
  const result = leg.result;
  const terminal = result.terminals[end === 'depart' ? 0 : 1];
  const origin = originOf(end === 'depart' ? leg.a : leg.b);
  return `${end}|${origin.lat.toFixed(4)},${origin.lon.toFixed(4)}|${terminal.lat.toFixed(4)},${terminal.lon.toFixed(4)}`;
}

async function computeTransfer(from, to) {
  const car = await safely(() => routeStreet('car', from, to));
  const walk = distance(from, to) <= 3500 ? await safely(() => routeStreet('walk', from, to)) : null;
  return { status: 'ok', car, walk };
}

function ensureTransfers(leg) {
  if (!leg.result || !leg.result.terminals) return;
  for (const end of ['depart', 'arrive']) {
    const key = transferKey(leg, end);
    if (state.transfers[key]) continue;
    const origin = originOf(end === 'depart' ? leg.a : leg.b);
    const terminal = leg.result.terminals[end === 'depart' ? 0 : 1];
    const [from, to] = end === 'depart' ? [origin, terminal] : [terminal, origin];
    state.transfers[key] = { status: 'loading' };
    computeTransfer(from, to).then((value) => {
      state.transfers[key] = value;
    }).catch(() => {
      state.transfers[key] = { status: 'error' };
    }).finally(() => {
      renderList();
      renderMap();
    });
  }
}

function transferSegments(leg, result) {
  if (!result.segments || !result.terminals) return result.segments;
  const segments = result.segments.map((segment) => ({ ...segment }));
  const depart = state.transfers[transferKey(leg, 'depart')];
  const arrive = state.transfers[transferKey(leg, 'arrive')];
  const first = segments[0];
  const last = segments[segments.length - 1];
  if (first.kind === 'ground' && depart && depart.car) first.coords = depart.car.coords;
  if (last.kind === 'ground' && arrive && arrive.car) last.coords = arrive.car.coords;
  return segments;
}

function uberLink(from, to) {
  const value = (number) => number.toFixed(6);
  const name = (text) => encodeURIComponent(String(text || '').slice(0, 60));
  return `https://m.uber.com/ul/?action=setPickup&pickup[latitude]=${value(from.lat)}&pickup[longitude]=${value(from.lon)}&pickup[nickname]=${name(from.name)}&dropoff[latitude]=${value(to.lat)}&dropoff[longitude]=${value(to.lon)}&dropoff[nickname]=${name(to.name)}`;
}

function transferBlock(leg, end) {
  const terminal = leg.result.terminals[end === 'depart' ? 0 : 1];
  const origin = originOf(end === 'depart' ? leg.a : leg.b);
  const [from, to] = end === 'depart' ? [origin, terminal] : [terminal, origin];
  const data = state.transfers[transferKey(leg, end)];
  const terminalName = terminal.iata ? `${terminal.iata} · ${terminal.name}` : terminal.name;
  const title = end === 'depart'
    ? t('route.transferTo', { place: terminalName })
    : t(origin.stay ? 'route.transferToStay' : 'route.transferToCity', { place: origin.name });
  const rows = [];
  if (!data || data.status === 'loading') {
    rows.push(el('p', { class: 'leg__loading' }, el('span', { class: 'spinner' }), el('span', { text: t('route.transferLoading') })));
  } else {
    if (data.car) {
      rows.push(el('div', { class: 'transfer__option' }, icon('car'),
        el('span', { class: 'transfer__label', text: t('route.taxi') }),
        el('span', { class: 'transfer__value', text: `${formatDuration(data.car.duration)} · ${formatDistance(data.car.distance)}` })));
    }
    if (data.walk) {
      rows.push(el('div', { class: 'transfer__option' }, icon('walk'),
        el('span', { class: 'transfer__label', text: t('modes.walk') }),
        el('span', { class: 'transfer__value', text: formatDuration(data.walk.duration) })));
    }
    if (!data.car && !data.walk) {
      const km = distance(from, to);
      rows.push(el('p', { class: 'leg__note', text: t('route.transferApprox', { distance: formatDistance(km), time: formatDuration((km / 1000 / 30) * 3600) }) }));
    }
  }
  const transit = new URLSearchParams({ api: '1', origin: `${from.lat},${from.lon}`, destination: `${to.lat},${to.lon}`, travelmode: 'transit' });
  return el('div', { class: 'transfer' },
    el('p', { class: 'transfer__title' }, icon(end === 'depart' ? TERMINAL_ICON[terminal.kind] || 'place' : origin.stay ? 'hotel' : 'place'), el('span', { text: title })),
    stationPicker(leg, end),
    el('p', { class: 'transfer__route', text: `${from.name} → ${to.name}` }),
    rows,
    el('div', { class: 'leg__links-row' },
      el('a', { class: 'btn btn--secondary btn--small', href: uberLink(from, to), target: '_blank', rel: 'noopener noreferrer' }, el('span', { text: 'Uber' }), icon('external')),
      el('a', { class: 'btn btn--secondary btn--small', href: `https://www.google.com/maps/dir/?${transit}`, target: '_blank', rel: 'noopener noreferrer' }, el('span', { text: t('route.publicTransport') }), icon('external'))));
}

async function computeLeg(leg, signal) {
  const { a, b, mode, pair, time } = leg;
  const km = distance(a, b) / 1000;
  if (mode === 'car' || mode === 'walk') {
    const route = await routeStreet(mode, a, b, signal);
    return { status: 'ok', distance: route.distance, duration: route.duration, coords: route.coords };
  }
  if (mode === 'flight') return computeFlight(a, b);
  let itineraries = [];
  try {
    itineraries = await routeTransit(mode, a, b, signal, time);
  } catch (error) {
    if (error.code === 'aborted') throw error;
  }
  if (itineraries.length) return transitResult(itineraries, a, b, mode);
  if (mode === 'ferry') return ferryEstimate(a, b);
  const { road, error } = await roadOrError(a, b, signal);
  if (!road && error && error.code !== 'noroute') throw error;
  if (!road && !state.modes[pair]) {
    state.auto[pair] = firstAllowed(km < 500 ? ['ferry', 'flight'] : ['flight', 'ferry']);
    return { status: 'switch' };
  }
  const viaStations = await stationEstimate(a, b, mode, signal, road);
  if (viaStations) return viaStations;
  if (road) {
    const duration = mode === 'bus' ? road.duration * 1.35 : Math.max(road.duration * 0.8, (road.distance / 1000 / 85) * 3600);
    return { status: 'estimate', distance: road.distance, duration, coords: road.coords, note: 'route.estimateNote' };
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

const CONCURRENCY = 3;

async function computeOne(initial, controller) {
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
  if (controller.signal.aborted) return;
  renderList();
  renderSummary();
  renderMap();
}

function compute() {
  if (state.run) state.run.abort();
  const controller = new AbortController();
  state.run = controller;
  const pending = legs().filter((leg) => !leg.options || leg.options.status !== 'ok' || !leg.result || leg.result.status === 'loading');
  for (const leg of pending) {
    if (!leg.result) state.results[leg.key] = { status: 'loading' };
  }
  render();
  if (!pending.length) return;
  const queue = [...pending];
  const worker = async () => {
    while (queue.length && !controller.signal.aborted) await computeOne(queue.shift(), controller);
  };
  Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker)).then(() => {
    if (state.run === controller && !controller.signal.aborted && legs().some((leg) => !leg.result)) compute();
  });
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
  let failed = 0;
  for (const leg of list) {
    const result = leg.result;
    if (!result || result.status === 'loading') pending = true;
    else if (result.status === 'error') failed += 1;
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
  const failedText = total.failed ? ` · ${tCount('route.failedLegs', total.failed)}` : '';
  if (total.failed === total.count) return `${tCount('route.failedLegs', total.failed)}${nightsText}`;
  const duration = formatDuration(total.seconds);
  return t('route.summary', {
    legs: tCount('route.legs', total.count),
    distance: formatDistance(total.meters),
    duration: total.estimated ? t('route.approx', { value: duration }) : duration
  }) + failedText + nightsText;
}

function renderSummary() {
  if (options.onSummary) options.onSummary(summaryText());
}

function renderMap() {
  const list = state.stops.length || state.startMode === 'custom' ? points() : [];
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
    return { mode: leg.mode, coords: result.coords, segments: transferSegments(leg, result), terminals: result.terminals, estimate: result.status === 'estimate' };
  });
  const stays = holders().filter((stop) => stop.chosen && stop.nights > 0 && !stop.noStay).map((stop) => {
    const stay = stop.stays.find((item) => item.id === stop.chosen);
    return stay ? { lat: stay.lat, lon: stay.lon, name: stay.name || t('place.unnamed'), stop: stop.name, item: stay } : null;
  }).filter(Boolean);
  const selected = legs().findIndex((leg) => leg.pair === state.expanded);
  mapView.renderRoute(mapPoints, mapLegs, selected >= 0 ? selected : null, stays);
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
  let showingRecent = false;
  const pick = (result) => {
    input.value = '';
    results.replaceChildren();
    message.textContent = '';
    showingRecent = false;
    addRecent(result);
    onPick({ name: result.name, detail: result.detail, lat: result.lat, lon: result.lon, country: result.country, wikidata: result.wikidata });
  };
  const hit = (result, iconName) => el('li', {},
    el('button', { type: 'button', class: 'search-hit', onclick: () => pick(result) },
      el('span', { class: 'search-hit__icon' }, icon(iconName)),
      el('span', { class: 'search-hit__text' },
        el('span', { class: 'search-hit__name', text: result.name }),
        result.detail ? el('span', { class: 'search-hit__detail', text: result.detail }) : null)));
  const showRecent = () => {
    if (results.children.length && !showingRecent) return;
    const recent = getRecent(input.value);
    showingRecent = recent.length > 0;
    results.replaceChildren(...(showingRecent ? [el('li', { class: 'planner-search__label', text: t('recent.title') }), ...recent.map((result) => hit(result, 'clock'))] : []));
  };
  input.addEventListener('focus', showRecent);
  input.addEventListener('input', () => {
    message.textContent = '';
    if (!showingRecent) results.replaceChildren();
    showingRecent = true;
    showRecent();
  });
  input.addEventListener('blur', () => {
    setTimeout(() => {
      if (showingRecent && document.activeElement !== input) {
        results.replaceChildren();
        showingRecent = false;
      }
    }, 250);
  });
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
      showingRecent = false;
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
        results.replaceChildren(...found.map((result) => hit(result, 'place')));
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

function resetStartModes() {
  for (const store of [state.modes, state.auto]) {
    for (const pair of Object.keys(store)) {
      if (pair.startsWith('start>')) delete store[pair];
    }
  }
}

function renderStart() {
  const listed = state.stops.length > 0;
  const point = startPoint();
  if (listed && point && !state.startEditing && !state.locating) {
    dom.startView = null;
    dom.start.hidden = true;
    dom.start.replaceChildren();
    return;
  }
  dom.start.hidden = false;
  if (!(state.startMode === 'custom' && (!state.startPlace || (listed && point)))) dom.startView = null;
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
  const editing = listed && point;
  if (state.startMode === 'gps') {
    const user = options.getUser();
    if (state.locating) body = el('p', { class: 'planner-hint', text: t('route.locating') });
    else if (user) body = editing ? null : startRow(point);
    else {
      body = el('button', { type: 'button', class: 'btn btn--secondary planner-locate', onclick: useGps },
        icon('locate'), el('span', { text: t('route.useLocation') }));
    }
  } else if (state.startPlace && !editing) {
    body = startRow(point, () => {
      state.startPlace = null;
      resetStartModes();
      persist();
      update();
    });
  } else {
    const view = `search|${listed && point ? 'done' : ''}`;
    if (dom.startView === view && dom.start.querySelector('.planner-search')) return;
    dom.startView = view;
    body = makeSearch({
      placeholder: t('route.startSearch'),
      compact: true,
      onPick: (place) => {
        state.startPlace = validStop({ ...place, id: 'start', nights: 0 });
        state.startEditing = false;
        resetStartModes();
        persist();
        update();
        fitRoute();
      }
    });
  }
  const done = listed && point ? el('button', {
    type: 'button',
    class: 'link-btn',
    text: t('route.done'),
    onclick: () => {
      state.startEditing = false;
      renderStart();
      renderList();
    }
  }) : null;
  dom.start.replaceChildren(...[
    el('div', { class: 'planner-label planner-label--row' }, el('span', { text: t('route.start') }), done),
    el('div', { class: 'segmented', role: 'group', 'aria-label': t('route.start') },
      segment('gps', t('route.startGps')), segment('custom', t('route.startCustom'))),
    body
  ].filter(Boolean));
}

function startRow(point, onChange = null) {
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
    'aria-expanded': String(state.picker === leg.pair),
    'aria-label': `${t('route.mode')}: ${t(`modes.${leg.mode}`)}`,
    onclick: () => {
      state.picker = state.picker === leg.pair ? null : leg.pair;
      renderList();
    }
  }, icon(leg.mode), el('span', { text: t(`modes.${leg.mode}`) }));
}

function modePicker(leg) {
  const manual = Boolean(state.modes[leg.pair]);
  return el('div', { class: 'leg__picker', role: 'group', 'aria-label': t('route.mode') },
    el('button', {
      type: 'button',
      class: 'mode-option mode-option--auto',
      style: '--c:var(--accent)',
      'aria-pressed': String(!manual),
      onclick: () => {
        delete state.modes[leg.pair];
        delete state.auto[leg.pair];
        state.picker = null;
        state.expanded = leg.pair;
        persist();
        reapplyAuto();
        compute();
      }
    }, icon('sparkle'), el('span', { text: t('route.autoMode') })),
    MODES.map((mode) => el('button', {
      type: 'button',
      class: 'mode-option',
      style: `--c:${mapView.ROUTE_MODES[mode].color}`,
      'aria-pressed': String(manual && leg.mode === mode),
      onclick: () => {
        state.modes[leg.pair] = mode;
        delete state.auto[leg.pair];
        state.picker = null;
        state.expanded = leg.pair;
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
    const key = result.code === 'noroute' ? 'route.noRoad' : result.code === 'offline' ? 'route.offline' : 'route.error';
    return el('span', { class: 'leg__info leg__info--error', text: t(key) });
  }
  const duration = formatDuration(result.duration);
  return el('span', { class: 'leg__info leg__info--done' },
    el('span', { class: 'leg__time', text: result.status === 'estimate' ? t('route.approx', { value: duration }) : duration }),
    el('span', { class: 'leg__distance', text: formatDistance(result.distance) }));
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
    const airports = leg.result && leg.result.airports;
    const names = airports ? { from: airports[0].iata, to: airports[1].iata } : { from: a.linkName || a.name, to: b.linkName || b.name };
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
  if (result && result.airports) {
    const [from, to] = result.airports;
    children.push(el('div', { class: 'flight-route' },
      el('span', { class: 'flight-route__code', text: from.iata }),
      el('span', { class: 'flight-route__line', 'aria-hidden': 'true' }, icon('flight')),
      el('span', { class: 'flight-route__code', text: to.iata }),
      el('span', { class: 'flight-route__names', text: `${from.name} → ${to.name}` }),
      el('span', { class: 'flight-route__time', text: t('route.flightTime', { time: formatDuration(result.flightTime) }) })));
  }
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
  if (result && result.terminals && result.status !== 'loading') {
    ensureTransfers(leg);
    children.push(el('div', { class: 'transfers' }, transferBlock(leg, 'depart'), transferBlock(leg, 'arrive')));
  }
  children.push(bookingLinks(leg));
  return el('div', { class: 'leg__details' }, children);
}

function legRow(leg) {
  const expanded = state.expanded === leg.pair;
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
            state.expanded = expanded ? null : leg.pair;
            if (!expanded) fitLeg(leg);
            renderList();
            renderMap();
          }
        }, legInfo(leg), icon('chevron'))),
      state.picker === leg.pair ? modePicker(leg) : null,
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
    el('span', { class: 'nights__value', text: stop.nights ? tCount('route.nights', stop.nights) : t(stop.id === 'start' ? 'route.noOvernight' : 'route.passThrough') }),
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
    lines.length = 0;
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
    el('div', { class: 'stop__extra' }, nightsControl(stop), stayBlock(stop), sightsBlock(stop)));
}

function sightsBlock(stop) {
  if (!stop.sights || !stop.sights.length) return null;
  const open = state.sightsOpen === stop.id;
  return el('div', { class: 'stop-sights' },
    el('button', {
      type: 'button',
      class: 'stop-sights__toggle',
      'aria-expanded': String(open),
      onclick: () => {
        state.sightsOpen = open ? null : stop.id;
        renderList();
      }
    }, icon('sights'), el('span', { text: tCount('route.sightsCount', stop.sights.length) }), icon('chevron')),
    open ? el('ul', { class: 'stop-sights__list' }, stop.sights.map((sight) => el('li', { class: 'stop-sights__item' },
      el('button', { type: 'button', class: 'stop-sights__name', text: sight.name, onclick: () => options.onShowSight && options.onShowSight(sight) }),
      el('button', { type: 'button', class: 'icon-btn stop-sights__remove', 'aria-label': `${t('route.removeSight')}: ${sight.name}`, onclick: () => toggleSight(stop.id, sight) }, icon('close'))))) : null);
}

function editStart() {
  state.startEditing = true;
  renderStart();
  requestAnimationFrame(() => dom.start.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
}

function startListRow(point, plan) {
  const head = el('div', { class: 'stop__head' },
    el('span', { class: 'stop__badge stop__badge--start', text: 'S' }),
    el('span', { class: 'stop__text' },
      el('span', { class: 'stop__name', text: point.name }),
      plan && plan.arrival ? el('span', { class: 'stop__detail', text: point.nights ? formatRange(plan.arrival, plan.departure) : t('route.departure', { date: formatDay(plan.arrival, true) }) }) : null),
    el('button', { type: 'button', class: 'link-btn', text: t('route.changeStart'), 'aria-expanded': String(state.startEditing), onclick: editStart }));
  if (!point.holder) return el('li', { class: 'stop stop--start' }, head);
  const stop = holder('start');
  return el('li', { class: `stop stop--start stop--full${needsStay(stop) ? ' needs-stay' : ''}` },
    head,
    el('div', { class: 'stop__extra' }, nightsControl(stop), stayBlock(stop), sightsBlock(stop)));
}

function reapplyAuto() {
  for (const leg of legs()) {
    if (state.modes[leg.pair]) continue;
    if (leg.options && leg.options.status === 'ok') {
      const picked = pickOption(leg.options.list, distance(leg.a, leg.b) / 1000);
      if (picked) state.auto[leg.pair] = picked;
    } else {
      delete state.auto[leg.pair];
    }
  }
}

function toggleAvoid(mode) {
  const avoided = state.avoid.includes(mode);
  if (!avoided && MODES.length - state.avoid.length <= 1) {
    toast(t('route.keepOneMode'));
    return;
  }
  state.avoid = avoided ? state.avoid.filter((item) => item !== mode) : [...state.avoid, mode];
  persist();
  reapplyAuto();
  compute();
}

function modeToggles() {
  const allowed = MODES.length - state.avoid.length;
  const head = el('button', {
    type: 'button',
    class: 'planner-label planner-label--sub planner-toggle',
    'aria-expanded': String(state.modesOpen),
    onclick: () => {
      state.modesOpen = !state.modesOpen;
      renderTrip();
      const next = dom.trip.querySelector('.planner-toggle');
      if (next) next.focus({ preventScroll: true });
    }
  },
  el('span', { text: t('route.autoModes') }),
  el('span', { class: 'planner-toggle__value', text: state.avoid.length ? t('route.modesSome', { n: allowed, total: MODES.length }) : t('route.modesAll') }),
  icon('chevron'));
  if (!state.modesOpen) return [head];
  return [
    head,
    el('div', { class: 'mode-toggles', role: 'group', 'aria-label': t('route.autoModes') }, MODES.map((mode) => {
      const allowed = !state.avoid.includes(mode);
      return el('button', {
        type: 'button',
        class: 'mode-toggle',
        style: `--c:${mapView.ROUTE_MODES[mode].color}`,
        'aria-pressed': String(allowed),
        'aria-label': t(`modes.${mode}`),
        title: t(`modes.${mode}`),
        onclick: () => toggleAvoid(mode)
      }, icon(mode));
    })),
    state.avoid.length ? el('p', { class: 'planner-hint', text: t('route.autoModesHint') }) : null
  ];
}

function renderTrip() {
  dom.trip.hidden = !state.stops.length;
  if (!state.stops.length) {
    dom.trip.replaceChildren();
    return;
  }
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
    missing ? el('p', { class: 'trip-warning' }, icon('alert'), el('span', { text: tCount('route.missingStays', missing) })) : null,
    ...modeToggles()
  ].filter(Boolean));
}

function dayLabel(date, day) {
  return date ? formatDay(date, true) : t('route.day', { n: day + 1 });
}

function dayRange(plan) {
  if (plan.arrival) return formatRange(plan.arrival, plan.departure);
  return t('route.dayRange', { from: plan.day + 1, to: plan.leave + 1 });
}

function uidPart(value) {
  return String(value).replace(/[^a-z0-9]+/gi, '-').slice(0, 60);
}

function stayEvent(source, point, plan) {
  const place = point.linkName || point.name;
  const stay = source.chosen ? source.stays.find((item) => item.id === source.chosen) : null;
  const meta = stay ? [stayName(stay), stay.address].filter(Boolean).join(', ') : t(source.noStay ? 'route.noStayNeeded' : 'route.noStayWarning');
  const title = t('route.overviewStay', { nights: tCount('route.nights', source.nights), place });
  return {
    type: 'stay',
    icon: stay ? stay.type : 'hotel',
    when: dayRange(plan),
    title,
    meta,
    warn: !stay && !source.noStay,
    calendar: plan.arrival ? {
      uid: `stay-${uidPart(source.id)}-${isoDate(plan.arrival)}`,
      allDay: true,
      start: plan.arrival,
      end: plan.departure,
      summary: stay ? `${title}: ${stayName(stay)}` : title,
      description: [stay ? [stayName(stay), stay.address, stay.phone, stay.website].filter(Boolean).join('\n') : meta, source.sights && source.sights.length ? `${t('route.overviewSightsLabel')}: ${source.sights.map((sight) => sight.name).join(', ')}` : null].filter(Boolean).join('\n'),
      location: stay ? [stayName(stay), stay.address || place].filter(Boolean).join(', ') : place,
      geo: stay ? { lat: stay.lat, lon: stay.lon } : { lat: point.lat, lon: point.lon }
    } : null
  };
}

function legEvent(leg, plan, after = null) {
  const result = leg.result && leg.result.status !== 'loading' && leg.result.status !== 'error' ? leg.result : null;
  const itinerary = result && result.itineraries && result.itineraries[0];
  const timed = Boolean(itinerary && !Number.isNaN(Date.parse(itinerary.start)) && !Number.isNaN(Date.parse(itinerary.end)));
  const from = leg.a.linkName || leg.a.name;
  const to = leg.b.linkName || leg.b.name;
  const modeName = t(`modes.${leg.mode}`);
  const duration = result ? formatDuration(result.duration) : null;
  const meta = [
    modeName,
    timed ? `${formatClock(itinerary.start, itinerary.tz)} – ${formatClock(itinerary.end, itinerary.tz)}` : null,
    duration ? (result.status === 'estimate' ? t('route.approx', { value: duration }) : duration) : leg.result && leg.result.status === 'error' ? t('route.error') : t('route.loading'),
    result ? formatDistance(result.distance) : null
  ].filter(Boolean).join(' · ');
  const airports = result && result.airports ? ` (${result.airports[0].iata} → ${result.airports[1].iata})` : '';
  let calendar = null;
  let start = null;
  if (leg.time) {
    start = timed ? new Date(itinerary.start) : after && after > leg.time ? after : leg.time;
    const end = timed ? new Date(itinerary.end) : new Date(start.getTime() + (result ? result.duration : 3600) * 1000);
    calendar = {
      uid: `leg-${uidPart(leg.pair)}-${isoDate(leg.time)}`,
      utc: timed,
      start,
      end,
      summary: `${modeName}: ${from} → ${to}${airports}`,
      description: [meta, result && result.status === 'estimate' ? t('route.overviewEstimate') : null, timed ? null : t('route.overviewAssumed')].filter(Boolean).join('\n'),
      location: from,
      geo: { lat: leg.a.lat, lon: leg.a.lon }
    };
  }
  return { type: 'leg', icon: leg.mode, color: mapView.ROUTE_MODES[leg.mode].color, when: dayLabel(start, plan.leave), title: `${from} → ${to}${airports}`, meta, calendar };
}

function sightsEvent(source, point, plan) {
  const names = source.sights.map((sight) => sight.name);
  const shown = names.slice(0, 5).join(', ');
  return {
    type: 'sights',
    icon: 'sights',
    when: source.nights > 0 ? dayRange(plan) : dayLabel(plan.arrival, plan.day),
    title: t('route.overviewSights', { place: point.linkName || point.name }),
    meta: names.length > 5 ? `${shown} ${t('route.andMore', { n: names.length - 5 })}` : shown
  };
}

function tripEvents() {
  const list = points();
  const plans = schedule();
  const legList = legs();
  const events = [];
  let arrived = null;
  list.forEach((point, index) => {
    const plan = plans[index];
    const source = point.holder ? holder('start') : point.start ? null : state.stops.find((stop) => stop.id === point.key);
    if (source && source.nights > 0) events.push(stayEvent(source, point, plan));
    if (source && source.sights && source.sights.length) events.push(sightsEvent(source, point, plan));
    if (legList[index]) {
      const after = index > 0 && plan.nights === 0 && arrived ? new Date(arrived.getTime() + 30 * 60 * 1000) : null;
      const event = legEvent(legList[index], plan, after);
      arrived = event.calendar ? event.calendar.end : null;
      events.push(event);
    }
  });
  if (list.length > 1) {
    const last = plans[plans.length - 1];
    events.push({ type: 'end', icon: 'check', when: last.departure ? formatDay(last.departure, true) : t('route.day', { n: last.leave + 1 }), title: t('route.overviewEnd'), meta: null });
  }
  return events;
}

function tripName() {
  const list = points();
  if (!list.length) return activeTripName() || t('route.title');
  const custom = activeTripName();
  if (custom) return custom;
  const name = (point) => point.linkName || point.name;
  if (list.length === 1) return name(list[0]);
  return t('route.calendarName', { from: name(list[0]), to: name(list[list.length - 1]) });
}

function exportCalendar() {
  if (!state.tripStart) {
    toast(t('route.calendarNeedsDate'));
    return;
  }
  const ics = buildIcs(tripName(), tripEvents());
  downloadFile(`viaro-${state.tripStart}.ics`, ics, 'text/calendar;charset=utf-8');
  toast(t('route.calendarDone'), { duration: 6000 });
}

async function shareTrip() {
  const url = window.location.href.split('#')[0];
  const summary = totals().count ? summaryText() : '';
  const text = shareText([tripName(), summary].filter(Boolean).join(' · '), tripEvents(), t('route.shareFooter', { url }));
  if (navigator.share) {
    try {
      await navigator.share({ title: tripName(), text });
      return;
    } catch (error) {
      if (error && error.name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    toast(t('route.copied'));
  } catch {
    toast(t('route.shareFailed'), { type: 'error' });
  }
}

function toggleOverview() {
  state.overviewOpen = !state.overviewOpen;
  renderList();
  if (state.overviewOpen) requestAnimationFrame(() => dom.overview.scrollIntoView({ block: 'start', behavior: 'smooth' }));
}

function renderOverview() {
  dom.overviewBtn.setAttribute('aria-expanded', String(state.overviewOpen));
  if (!state.overviewOpen || !state.stops.length) {
    dom.overview.hidden = true;
    dom.overview.replaceChildren();
    return;
  }
  dom.overview.hidden = false;
  dom.overview.replaceChildren(...[
    el('div', { class: 'planner-label planner-label--row' },
      el('span', { text: t('route.overview') }),
      el('button', { type: 'button', class: 'link-btn', text: t('common.close'), onclick: toggleOverview })),
    overviewList(tripEvents()),
    el('div', { class: 'overview__actions' },
      el('button', { type: 'button', class: 'btn btn--secondary btn--small', 'aria-disabled': String(!state.tripStart), onclick: exportCalendar }, icon('calendar'), el('span', { text: t('route.calendar') })),
      el('button', { type: 'button', class: 'btn btn--secondary btn--small', onclick: shareTrip }, icon('share'), el('span', { text: t('route.share') }))),
    state.tripStart ? null : el('p', { class: 'planner-hint', text: t('route.calendarNeedsDate') })
  ].filter(Boolean));
}

function editingField() {
  const active = document.activeElement;
  if (!active || !dom.root || !dom.root.contains(active)) return null;
  if (active.tagName === 'SELECT' || (active.tagName === 'INPUT' && active.type === 'date')) return active;
  return null;
}

function renderList() {
  if (state.dragging) return;
  const field = editingField();
  if (field && !field.dataset.pending) {
    field.dataset.pending = '1';
    field.addEventListener('blur', () => setTimeout(renderList, 0), { once: true });
  }
  if (field && !dom.trip.contains(field)) return;
  if (!field) renderTrip();
  const list = points();
  const legList = legs();
  const plans = schedule();
  const rows = [];
  const offset = list[0] && list[0].start ? 1 : 0;
  list.forEach((point, index) => {
    if (!point.start) rows.push(stopRow(point, index + 1 - offset, plans[index]));
    if (legList[index]) rows.push(legRow(legList[index]));
  });
  if (list[0] && list[0].start && legList.length) {
    rows.unshift(startListRow(list[0], plans[0]));
  }
  dom.list.replaceChildren(...rows);
  dom.empty.textContent = state.stops.length ? '' : t('route.empty');
  dom.actions.hidden = !state.stops.length;
  dom.optimize.disabled = list.length < 4;
  renderOverview();
}

function render() {
  renderStart();
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
    reverseGeocode(user.lat, user.lon, getLanguage()).then((place) => {
      state.gpsCountry = place.country;
      if (place.name && place.name !== state.gpsName) {
        state.gpsName = place.name;
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
  const run = state.tripRun;
  state.expanded = null;
  state.picker = null;
  persist();
  compute();
  toast(t('route.removedStop', { name: removed.name }), {
    duration: 5000,
    action: {
      label: t('favorites.undo'),
      onClick: () => {
        if (run !== state.tripRun || state.stops.some((stop) => stop.id === removed.id)) return;
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
  if (state.stops.length >= MAX_STOPS) {
    toast(t('route.tooMany', { n: MAX_STOPS }), { type: 'error' });
    return false;
  }
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
  const previous = { stops: state.stops, modes: state.modes, auto: state.auto };
  const run = state.tripRun;
  let undone = false;
  state.stops = [];
  state.modes = {};
  state.auto = {};
  state.expanded = null;
  state.picker = null;
  persist();
  compute();
  toast(t('route.cleared'), {
    duration: 6000,
    action: {
      label: t('favorites.undo'),
      onClick: () => {
        if (undone || run !== state.tripRun) return;
        undone = true;
        const added = state.stops.filter((stop) => !previous.stops.some((item) => item.id === stop.id));
        state.stops = [...previous.stops, ...added].slice(0, MAX_STOPS);
        state.modes = { ...previous.modes, ...state.modes };
        state.auto = { ...previous.auto, ...state.auto };
        persist();
        compute();
        fitRoute();
      }
    }
  });
}

function moveStop(id, target) {
  const index = state.stops.findIndex((stop) => stop.id === id);
  if (index < 0 || target === index || target < 0 || target >= state.stops.length + 1) return false;
  const [moved] = state.stops.splice(index, 1);
  state.stops.splice(Math.min(target, state.stops.length), 0, moved);
  persist();
  compute();
  return true;
}

function initDrag() {
  let drag = null;
  const end = (event, apply) => {
    if (!drag || (event && event.pointerId !== drag.pointer)) return;
    const { id, target } = drag;
    drag = null;
    state.dragging = false;
    dom.list.classList.remove('is-sorting');
    if (!apply || target === null || !moveStop(id, target)) renderList();
  };
  dom.list.addEventListener('pointerdown', (event) => {
    const grip = event.target.closest('[data-grip]');
    if (!grip || event.button !== 0) return;
    event.preventDefault();
    const row = grip.closest('.stop');
    dom.list.classList.add('is-sorting');
    row.classList.add('is-dragging');
    state.dragging = true;
    drag = { id: grip.dataset.grip, row, startY: event.clientY, pointer: event.pointerId, target: null };
    grip.setPointerCapture(event.pointerId);
  });
  window.addEventListener('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.pointer) return;
    drag.row.style.transform = `translateY(${event.clientY - drag.startY}px)`;
    const others = [...dom.list.querySelectorAll('.stop[data-id]')].filter((row) => row.dataset.id !== drag.id);
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
  window.addEventListener('pointerup', (event) => end(event, true));
  window.addEventListener('pointercancel', (event) => end(event, false));
  dom.list.addEventListener('keydown', (event) => {
    const grip = event.target.closest('[data-grip]');
    if (!grip || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
    event.preventDefault();
    const id = grip.dataset.grip;
    const index = state.stops.findIndex((stop) => stop.id === id);
    if (!moveStop(id, index + (event.key === 'ArrowUp' ? -1 : 1))) return;
    requestAnimationFrame(() => {
      const next = dom.list.querySelector(`[data-grip="${CSS.escape(id)}"]`);
      if (next) next.focus();
    });
  });
}

export function initPlanner(container, opts) {
  options = opts;
  applyTrip(sanitizeTrip(loadTrips()));
  dom.trips = el('section', { class: 'planner-section trips' });
  dom.trip = el('section', { class: 'planner-section' });
  dom.start = el('section', { class: 'planner-section' });
  dom.list = el('ol', { class: 'route-list' });
  dom.empty = el('p', { class: 'empty empty--compact planner-empty' });
  dom.add = el('section', { class: 'planner-section planner-section--add' });
  dom.overview = el('section', { class: 'planner-section planner-section--overview', hidden: true });
  dom.overviewBtn = el('button', { type: 'button', class: 'btn btn--secondary btn--small', onclick: toggleOverview });
  dom.optimize = el('button', { type: 'button', class: 'btn btn--secondary btn--small', onclick: optimize });
  dom.clear = el('button', { type: 'button', class: 'btn btn--ghost btn--small', onclick: clearRoute });
  dom.actions = el('div', { class: 'route-actions' }, dom.overviewBtn, dom.optimize, dom.clear);
  dom.root = container;
  container.replaceChildren(el('div', { class: 'planner' },
    dom.trips,
    dom.trip,
    dom.start,
    el('section', { class: 'planner-section planner-section--route' }, dom.list, dom.empty),
    dom.overview,
    dom.add,
    dom.actions));
  initDrag();
  initTrips(dom.trips, {
    load: loadTrip,
    validate: validTrip,
    extras: () => (options.tripExtras ? options.tripExtras() : {}),
    mergeFavorites: (raw) => (options.mergeFavorites ? options.mergeFavorites(raw) : 0),
    settingsDiffer: (raw) => Boolean(options.settingsDiffer && options.settingsDiffer(raw)),
    applySettings: (raw) => options.applySettings && options.applySettings(raw),
    onRename: () => renderOverview(),
    dropTarget: container
  });
  mapView.setRouteHandlers({
    onLegClick: (index) => {
      const leg = legs()[index];
      state.expanded = leg ? leg.pair : null;
      state.picker = null;
      if (options.onShow) options.onShow();
      render();
      requestAnimationFrame(() => {
        const row = dom.list.querySelector(`[data-leg="${index}"]`);
        if (row) row.scrollIntoView({ block: 'start', behavior: 'smooth' });
      });
    },
    onStopClick: (index) => {
      if (options.onShow) options.onShow();
      const point = points()[index];
      requestAnimationFrame(() => {
        const row = point && !point.start ? dom.list.querySelector(`[data-id="${CSS.escape(point.key)}"]`) : dom.list.firstElementChild;
        if (row) row.scrollIntoView({ block: 'start', behavior: 'smooth' });
      });
    },
    onStayClick: (stay) => {
      if (options.onShowStay) options.onShowStay(stay.item);
    }
  });
  renderPlanner();
}

export function renderPlanner() {
  renderTrips();
  renderStart();
  dom.add.replaceChildren(
    el('div', { class: 'planner-label' }, el('span', { text: t('route.addStop') })),
    makeSearch({
      placeholder: t('route.stopSearch'),
      onPick: (place) => {
        if (addStop(place)) fitRoute();
      }
    }));
  dom.overviewBtn.replaceChildren(icon('list'), el('span', { text: t('route.overview') }));
  dom.optimize.replaceChildren(icon('sparkle'), el('span', { text: t('route.optimize') }));
  dom.clear.textContent = t('route.clear');
  compute();
}

export function retryFailed() {
  let changed = false;
  for (const [key, result] of Object.entries(state.results)) {
    if (result.status === 'error') {
      delete state.results[key];
      changed = true;
    }
  }
  for (const [key, value] of Object.entries(state.options)) {
    if (value.status === 'error') {
      delete state.options[key];
      changed = true;
    }
  }
  if (changed) compute();
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

export function routePlaces() {
  const list = points();
  const plans = schedule();
  return holders().map((stop) => {
    const index = list.findIndex((point) => point.key === stop.id);
    const plan = index >= 0 ? plans[index] : null;
    return {
      id: stop.id,
      name: stop.name,
      detail: stop.detail,
      lat: stop.lat,
      lon: stop.lon,
      country: stop.country,
      wikidata: stop.wikidata,
      dates: plan && plan.arrival ? { from: isoDate(plan.arrival), to: isoDate(plan.departure) } : null
    };
  });
}

export function sightTargetFor(place, preferred = null) {
  const candidates = holders();
  const explicit = preferred ? candidates.find((stop) => stop.id === preferred) : null;
  if (explicit && distance(explicit, place) <= TARGET_RADIUS) return explicit;
  let best = null;
  for (const stop of candidates) {
    const d = distance(stop, place);
    if (d <= STAY_RADIUS && (!best || d < best.d)) best = { stop, d };
  }
  return best ? best.stop : null;
}

export function sightStatus(stopId, sightId) {
  const stop = holder(stopId);
  return Boolean(stop && stop.sights && stop.sights.some((sight) => sight.id === sightId));
}

export function toggleSight(stopId, item) {
  const stop = holder(stopId);
  if (!stop) return false;
  stop.sights = stop.sights || [];
  const index = stop.sights.findIndex((sight) => sight.id === item.id);
  if (index >= 0) {
    stop.sights.splice(index, 1);
  } else {
    const sight = validSight(item);
    if (!sight) return false;
    if (stop.sights.length >= MAX_SIGHTS) stop.sights.shift();
    stop.sights.push(sight);
  }
  persist();
  render();
  if (options.onSightsChanged) options.onSightsChanged();
  return index < 0;
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
    if (stop.stays.length >= MAX_STAYS) {
      const oldest = stop.stays.findIndex((item) => item.id !== stop.chosen);
      stop.stays.splice(oldest < 0 ? 0 : oldest, 1);
    }
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
