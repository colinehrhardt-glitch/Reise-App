import { t, tCount, getLanguage, setLanguage, onLanguageChange, applyTranslations, LANGUAGES, formatDistance } from './i18n.js';
import { load, save } from './storage.js';
import { searchPlaces, fetchCategories, fetchAccommodationsFallback, fetchPhoto, ACCOMMODATION_TYPES, POI_CATEGORIES } from './api.js';
import * as mapView from './map.js';
import { el, icon, link, formatNumber, distance, errorMessage, toast, gallery } from './ui.js';
import { getRecent, addRecent, clearRecent } from './recent.js';
import { initPlanner, renderPlanner, addStop, refreshStart, fitRoute, retryFailed, stayTargetFor, stayStatus, toggleStay, stayDatesFor, routePlaces, sightTargetFor, sightStatus, toggleSight } from './planner.js';
import { initDiscover, renderDiscover, activateDiscover, setDiscoverPlace, discoverTitle, discoverSubtitle, refreshSights, currentStopId } from './discover.js';
import { fetchSightSummary } from './info.js';

const MIN_SEARCH_ZOOM = 13;
const LOCATE_ZOOM = 14;
const FAVORITE_SORTS = ['added', 'name', 'type', 'distance'];
const RESULT_SORTS = ['recommended', 'stars', 'distance'];
const THEMES = ['auto', 'light', 'dark'];
const SHEET_ORDER = ['peek', 'half', 'full'];
const TABS = ['stays', 'route', 'discover'];
const PHOTO_KINDS = ['commons', 'wikidata', 'url'];
const HOSTELWORLD_TYPES = ['hostel', 'guest_house'];
const wideQuery = window.matchMedia('(min-width: 768px)');
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

const dom = {};
const state = {
  places: [],
  poi: {},
  poiRun: {},
  searched: false,
  filter: 'all',
  origin: null,
  areaLoading: false,
  pending: 0,
  locating: false,
  user: null,
  popupItem: null,
  lastSearch: null,
  tab: pick(load('tab', 'stays'), TABS, 'stays'),
  staysTitle: '',
  staysCount: '',
  routeCount: '',
  areaName: null,
  areaCountry: null,
  sights: [],
  areaController: null,
  loadFailed: null,
  sheet: 'peek',
  searchToken: 0,
  favorites: sanitizeFavorites(load('favorites', {})),
  showFavorites: load('showFavorites', true) !== false,
  favoriteSort: pick(load('favoriteSort', 'added'), FAVORITE_SORTS, 'added'),
  resultSort: pick(load('resultSort', 'recommended'), RESULT_SORTS, 'recommended'),
  theme: pick(load('theme', 'auto'), THEMES, 'auto'),
  layers: sanitizeLayers(load('layers', {})),
  view: sanitizeView(load('view', null))
};

function pick(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function sanitizeView(raw) {
  if (!raw || !Number.isFinite(raw.lat) || !Number.isFinite(raw.lon) || !Number.isFinite(raw.zoom)) return null;
  if (Math.abs(raw.lat) > 85 || Math.abs(raw.lon) > 180) return null;
  return { lat: raw.lat, lon: raw.lon, zoom: Math.min(19, Math.max(2, Math.round(raw.zoom))) };
}

let viewTimer = 0;

function rememberView() {
  clearTimeout(viewTimer);
  viewTimer = setTimeout(() => save('view', mapView.getView()), 600);
}

function sanitizeLayers(raw) {
  const layers = { accommodation: !raw || raw.accommodation !== false };
  for (const category of POI_CATEGORIES) layers[category] = Boolean(raw && raw[category] === true);
  return layers;
}

function text(value, max = 300) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;
}

function sanitizeFacts(raw) {
  const facts = {};
  if (!raw || typeof raw !== 'object') return facts;
  for (const key of ['rooms', 'beds']) {
    if (Number.isInteger(raw[key]) && raw[key] > 0) facts[key] = raw[key];
  }
  for (const key of ['checkIn', 'checkOut']) {
    const value = text(raw[key], 20);
    if (value) facts[key] = value;
  }
  if (raw.wifi === 'yes' || raw.wifi === 'free') facts.wifi = raw.wifi;
  if (raw.wheelchair === 'yes' || raw.wheelchair === 'limited') facts.wheelchair = raw.wheelchair;
  if (raw.nonSmoking === true) facts.nonSmoking = true;
  return facts;
}

function sanitizeDescription(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const result = {};
  for (const key of ['de', 'en', 'es', 'default']) {
    const value = text(raw[key]);
    if (value) result[key] = value;
  }
  return Object.keys(result).length ? result : null;
}

function sanitizePhoto(raw) {
  if (!raw || !PHOTO_KINDS.includes(raw.kind) || typeof raw.value !== 'string') return null;
  if (raw.kind === 'url' && !/^https:\/\//i.test(raw.value)) return null;
  if (raw.kind === 'wikidata' && !/^Q\d+$/.test(raw.value)) return null;
  return { kind: raw.kind, value: raw.value.slice(0, 300) };
}

function sanitizeFavorites(raw) {
  const result = {};
  if (!raw || typeof raw !== 'object') return result;
  for (const item of Object.values(raw)) {
    if (!item || typeof item.id !== 'string' || !ACCOMMODATION_TYPES.includes(item.type)) continue;
    if (!Number.isFinite(item.lat) || !Number.isFinite(item.lon)) continue;
    result[item.id] = {
      id: item.id,
      kind: 'accommodation',
      type: item.type,
      name: text(item.name),
      lat: item.lat,
      lon: item.lon,
      stars: item.stars && Number.isFinite(item.stars.count) ? { count: item.stars.count, superior: Boolean(item.stars.superior) } : null,
      address: text(item.address),
      city: text(item.city),
      website: typeof item.website === 'string' && /^https?:\/\//i.test(item.website) ? item.website : null,
      phone: text(item.phone, 60),
      email: typeof item.email === 'string' && /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(item.email) ? item.email : null,
      description: sanitizeDescription(item.description),
      photo: sanitizePhoto(item.photo),
      facts: sanitizeFacts(item.facts),
      addedAt: Number.isFinite(item.addedAt) ? item.addedAt : 0
    };
  }
  return result;
}

function typeLabel(type, many = false) {
  return t(`types.${type}.${many ? 'many' : 'one'}`);
}

function placeName(place) {
  return place.name || t('place.unnamed');
}

function dot(color, iconName) {
  return el('span', { class: 'type-dot', style: `--c:${color}` }, icon(iconName));
}

function typeDot(type) {
  return dot(mapView.TYPES[type]?.color || mapView.FAVORITE_COLOR, type);
}

function starString(stars) {
  return '★'.repeat(Math.floor(stars.count));
}

function starLabel(stars) {
  const label = tCount('place.stars', stars.count);
  return stars.superior ? `${label} ${t('place.superior')}` : label;
}

function isInside(point, bounds) {
  return point.lat >= bounds.south && point.lat <= bounds.north && point.lon >= bounds.west && point.lon <= bounds.east;
}

function isFavorite(id) {
  return Object.prototype.hasOwnProperty.call(state.favorites, id);
}

function isDark() {
  return state.theme === 'dark' || (state.theme === 'auto' && darkQuery.matches);
}

function applyTheme() {
  const root = document.documentElement;
  if (state.theme === 'auto') delete root.dataset.theme;
  else root.dataset.theme = state.theme;
  const dark = isDark();
  document.querySelector('meta[name="theme-color"]').setAttribute('content', dark ? '#0a1416' : '#e9efef');
  mapView.setMapTheme(dark);
}

function renderSegmented(container, items, active, onSelect) {
  container.replaceChildren(...items.map((item) => el('button', {
    type: 'button',
    class: 'segmented__btn',
    lang: item.lang,
    'aria-pressed': String(item.value === active),
    text: item.label,
    onclick: () => onSelect(item.value)
  })));
}

function renderLanguageSwitch() {
  renderSegmented(
    dom.languageSwitch,
    LANGUAGES.map((language) => ({ value: language.code, label: language.label, lang: language.code })),
    getLanguage(),
    (code) => setLanguage(code)
  );
}

function renderThemeSwitch() {
  renderSegmented(
    dom.themeSwitch,
    THEMES.map((theme) => ({ value: theme, label: t(`theme.${theme}`) })),
    state.theme,
    (theme) => {
      state.theme = theme;
      save('theme', theme);
      applyTheme();
      renderThemeSwitch();
    }
  );
}

function fillSelect(select, values, prefix, active) {
  select.replaceChildren(...values.map((value) => el('option', { value, text: t(`${prefix}.${value}`) })));
  select.value = active;
}

function renderSources() {
  dom.sources.replaceChildren(
    el('dt', { text: t('about.map') }),
    el('dd', {}, '© ', link('https://www.openstreetmap.org/copyright', t('attribution.osm'))),
    el('dt', { text: t('about.tiles') }),
    el('dd', {}, link('https://openfreemap.org', 'OpenFreeMap'), ', © ', link('https://www.openmaptiles.org', 'OpenMapTiles')),
    el('dt', { text: t('about.search') }),
    el('dd', {}, link('https://nominatim.org', 'Nominatim')),
    el('dt', { text: t('about.places') }),
    el('dd', {}, link('https://overpass-api.de', 'Overpass API')),
    el('dt', { text: t('about.routing') }),
    el('dd', {}, link('https://project-osrm.org', 'OSRM'), ', ', link('https://routing.openstreetmap.de', 'FOSSGIS'), ', ', link('https://transitous.org', 'Transitous')),
    el('dt', { text: t('about.airports') }),
    el('dd', {}, link('https://ourairports.com/data/', 'OurAirports'), ' (Public Domain)'),
    el('dt', { text: t('about.texts') }),
    el('dd', {}, link('https://www.wikipedia.org', 'Wikipedia'), ', ', link('https://www.wikivoyage.org', 'Wikivoyage'), ' (CC BY-SA)'),
    el('dt', { text: t('about.weather') }),
    el('dd', {}, link('https://open-meteo.com', 'Open-Meteo'), ' (CC BY 4.0)'),
    el('dt', { text: t('about.countries') }),
    el('dd', {}, link('https://restcountries.com', 'REST Countries'), ', ', link('https://www.exchangerate-api.com', 'ExchangeRate-API'), ', ', link('https://www.auswaertiges-amt.de', 'Auswärtiges Amt'), ', ', link('https://www.gov.uk/foreign-travel-advice', 'GOV.UK'), ', ', link('https://travel.state.gov', 'U.S. State Department'), ', ', link('https://mymemory.translated.net', 'MyMemory')),
    el('dt', { text: t('about.contact') }),
    el('dd', {}, link('https://github.com/colinehrhardt-glitch/Reise-App', 'GitHub')),
    el('dt', { text: t('about.photos') }),
    el('dd', {}, link('https://commons.wikimedia.org', 'Wikimedia Commons'), ', ', link('https://www.wikidata.org', 'Wikidata'))
  );
}

function renderAttribution() {
  mapView.setAttribution(`&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">${t('attribution.osm')}</a>`);
}

function layerRow({ title, desc, color, iconName, checked, onChange, extra = null }) {
  const input = el('input', { type: 'checkbox', class: 'switch' });
  input.checked = checked;
  input.addEventListener('change', () => onChange(input.checked));
  return el('label', { class: 'layer-row', style: `--c:${color}` },
    dot(color, iconName),
    el('span', { class: 'layer-row__text' },
      el('span', { class: 'layer-row__title', text: title }),
      desc ? el('span', { class: 'layer-row__desc', text: desc }) : null,
      extra),
    input);
}

function renderLayersPanel() {
  const legend = el('span', { class: 'legend-dots' }, ACCOMMODATION_TYPES.map((type) => el('span', { class: 'legend-dots__item' },
    el('span', { class: 'chip__dot', style: `--c:${mapView.TYPES[type].color}` }),
    el('span', { text: typeLabel(type) }))));
  dom.layersBase.replaceChildren(
    layerRow({
      title: t('layers.accommodation'),
      color: 'var(--accent)',
      iconName: 'hotel',
      checked: state.layers.accommodation,
      extra: legend,
      onChange: (checked) => {
        state.layers.accommodation = checked;
        save('layers', state.layers);
        applyStayLayers();
      }
    }),
    layerRow({
      title: t('layers.favorites'),
      color: mapView.FAVORITE_COLOR,
      iconName: 'heart',
      checked: state.showFavorites,
      onChange: setShowFavorites
    })
  );
  dom.layersExtra.replaceChildren(...POI_CATEGORIES.map((category) => layerRow({
    title: t(`layers.${category}`),
    desc: t(`layers.${category}.desc`),
    color: mapView.LAYERS[category].color,
    iconName: category,
    checked: state.layers[category],
    onChange: (checked) => setPoiLayer(category, checked)
  })));
}

function toggleLayers(force) {
  const open = typeof force === 'boolean' ? force : dom.layers.hidden;
  if (open) renderLayersPanel();
  dom.layers.hidden = !open;
  dom.layersBtn.setAttribute('aria-expanded', String(open));
}

function setShowFavorites(checked) {
  state.showFavorites = checked;
  save('showFavorites', checked);
  dom.favoritesToggle.checked = checked;
  renderMarkers();
}

function renderPoi(category) {
  mapView.renderPoiLayer(category, state.poi[category] || [], state.layers[category]);
}

function setPoiLayer(category, checked) {
  state.layers[category] = checked;
  save('layers', state.layers);
  renderPoi(category);
  if (checked) loadPoiLayer(category);
}

function tripExtras() {
  return {
    favorites: state.favorites,
    settings: { lang: getLanguage(), theme: state.theme, layers: state.layers, showFavorites: state.showFavorites }
  };
}

function mergeFavorites(raw) {
  const incoming = sanitizeFavorites(raw);
  const added = Object.keys(incoming).filter((id) => !state.favorites[id]);
  if (!added.length) return 0;
  for (const id of added) state.favorites[id] = incoming[id];
  if (!persistFavorites()) {
    for (const id of added) delete state.favorites[id];
    return 0;
  }
  renderMarkers();
  renderFavoritesList();
  return added.length;
}

function cleanSettings(raw) {
  return {
    lang: LANGUAGES.some((language) => language.code === raw.lang) ? raw.lang : null,
    theme: THEMES.includes(raw.theme) ? raw.theme : null,
    layers: raw.layers && typeof raw.layers === 'object' ? sanitizeLayers(raw.layers) : null,
    showFavorites: typeof raw.showFavorites === 'boolean' ? raw.showFavorites : null
  };
}

function settingsDiffer(raw) {
  const settings = cleanSettings(raw);
  return Boolean((settings.lang && settings.lang !== getLanguage())
    || (settings.theme && settings.theme !== state.theme)
    || (settings.layers && Object.keys(settings.layers).some((key) => settings.layers[key] !== state.layers[key]))
    || (settings.showFavorites !== null && settings.showFavorites !== state.showFavorites));
}

function applySettings(raw) {
  const settings = cleanSettings(raw);
  if (settings.theme && settings.theme !== state.theme) {
    state.theme = settings.theme;
    save('theme', settings.theme);
    applyTheme();
    renderThemeSwitch();
  }
  if (settings.layers) {
    if (settings.layers.accommodation !== state.layers.accommodation) {
      state.layers.accommodation = settings.layers.accommodation;
      save('layers', state.layers);
      applyStayLayers();
    }
    for (const category of POI_CATEGORIES) {
      if (settings.layers[category] !== state.layers[category]) setPoiLayer(category, settings.layers[category]);
    }
  }
  if (settings.showFavorites !== null && settings.showFavorites !== state.showFavorites) setShowFavorites(settings.showFavorites);
  if (settings.lang && settings.lang !== getLanguage()) setLanguage(settings.lang);
  toast(t('trips.settingsApplied'));
}

function beginRequest() {
  state.pending += 1;
  dom.progress.hidden = false;
}

function endRequest() {
  state.pending = Math.max(0, state.pending - 1);
  dom.progress.hidden = state.pending === 0;
}

function truncatedNotice() {
  toast(t('results.truncated'), { duration: 6000 });
}

async function loadPoiLayer(category, area = null, signal = null) {
  if (!area && mapView.getZoom() < MIN_SEARCH_ZOOM) {
    toast(t('layers.zoomIn'));
    return;
  }
  const bounds = area || mapView.getBounds();
  const run = (state.poiRun[category] || 0) + 1;
  state.poiRun[category] = run;
  beginRequest();
  try {
    const data = await fetchCategories([category], bounds, { signal });
    if ((signal && signal.aborted) || state.poiRun[category] !== run) return;
    state.poi[category] = data[category].items;
    renderPoi(category);
    if (data[category].truncated) truncatedNotice();
  } catch (error) {
    if (error.code === 'aborted' || (signal && signal.aborted)) return;
    toast(errorMessage(error), {
      type: 'error',
      duration: 8000,
      action: { label: t('common.retry'), onClick: () => loadPoiLayer(category, bounds) }
    });
  } finally {
    endRequest();
  }
}

function filteredPlaces() {
  return state.filter === 'all' ? state.places : state.places.filter((place) => place.type === state.filter);
}

function placeScore(place) {
  let score = 0;
  if (place.stars) score += place.stars.count * 10 + (place.stars.superior ? 3 : 0);
  if (place.photo) score += 4;
  if (place.website) score += 3;
  if (place.phone) score += 2;
  if (place.address) score += 2;
  if (place.email) score += 1;
  if (place.description) score += 1;
  score += Math.min(3, Object.keys(place.facts || {}).length);
  return score;
}

function sortPlaces(places) {
  const origin = state.origin;
  const named = (entry) => (entry.place.name ? 0 : 1);
  const starsOf = (entry) => entry.place.stars?.count || 0;
  const comparators = {
    recommended: (a, b) => named(a) - named(b) || b.score - a.score || a.d - b.d,
    stars: (a, b) => named(a) - named(b) || starsOf(b) - starsOf(a) || b.score - a.score || a.d - b.d,
    distance: (a, b) => named(a) - named(b) || a.d - b.d
  };
  return places
    .map((place) => ({ place, d: origin ? distance(origin, place) : 0, score: placeScore(place) }))
    .sort(comparators[state.resultSort])
    .map((entry) => entry.place);
}

function renderChips() {
  const counts = {};
  for (const place of state.places) counts[place.type] = (counts[place.type] || 0) + 1;
  const scroll = dom.chips.scrollLeft;
  const chip = (value, label) => {
    const count = value === 'all' ? state.places.length : counts[value] || 0;
    return el('button', {
      type: 'button',
      class: `chip${value === 'all' ? ' chip--all' : ''}`,
      'aria-pressed': String(state.filter === value),
      onclick: () => setFilter(value)
    },
    value === 'all' ? null : el('span', { class: 'chip__dot', style: `--c:${mapView.TYPES[value].color}` }),
    el('span', { text: label }),
    state.searched ? el('span', { class: 'chip__count', text: formatNumber(count) }) : null);
  };
  dom.chips.replaceChildren(chip('all', t('filter.all')), ...ACCOMMODATION_TYPES.map((type) => chip(type, typeLabel(type, true))));
  dom.chips.scrollLeft = scroll;
}

function setFilter(value) {
  if (state.filter === value) return;
  state.filter = value;
  renderResults();
  dom.sheetBody.scrollTop = 0;
}

function heartButton(place) {
  const button = el('button', {
    type: 'button',
    class: 'heart-btn',
    'data-fav-id': place.id,
    onclick: (event) => {
      event.stopPropagation();
      toggleFavorite(place);
    }
  }, icon('heart'));
  setHeartState(button, isFavorite(place.id));
  return button;
}

function setHeartState(button, active) {
  button.setAttribute('aria-pressed', String(active));
  button.setAttribute('aria-label', t(active ? 'place.favoriteRemove' : 'place.favoriteAdd'));
}

function placeItem(place, reference, context, top = false) {
  const meta = [el('span', { text: typeLabel(place.type) })];
  if (place.stars) meta.push(el('span', { class: 'stars', 'aria-label': starLabel(place.stars), text: starString(place.stars) }));
  if (reference) meta.push(el('span', { text: formatDistance(distance(reference, place)) }));
  return el('li', { class: 'place' },
    el('button', { type: 'button', class: 'place__main', onclick: () => selectPlace(place, context) },
      typeDot(place.type),
      el('span', { class: 'place__text' },
        el('span', { class: 'place__title' },
          el('span', { class: `place__name${place.name ? '' : ' is-unnamed'}`, text: placeName(place) }),
          top ? el('span', { class: 'top-badge', text: t('place.top') }) : null),
        el('span', { class: 'place__meta' }, meta))),
    heartButton(place));
}

function isTopPick(place, index) {
  return state.resultSort === 'recommended' && state.filter === 'all' && index < 3 && Boolean(place.name) && placeScore(place) > 0;
}

function renderMarkers() {
  const visible = filteredPlaces();
  mapView.renderResults(visible, isFavorite);
  const shown = new Set(state.layers.accommodation ? visible.map((place) => place.id) : []);
  mapView.renderFavorites(state.showFavorites ? Object.values(state.favorites).filter((place) => !shown.has(place.id)) : []);
}

function renderResults() {
  const visible = filteredPlaces();
  setStaysCount(state.searched ? tCount('results.count', visible.length) : '');
  let empty = '';
  dom.resultsRetry.hidden = !state.loadFailed;
  if (state.loadFailed) empty = t('results.failed');
  else if (!state.searched) empty = t('results.initial');
  else if (!state.places.length) empty = t('results.none');
  else if (!visible.length) empty = t('results.noneFiltered');
  dom.resultsEmpty.textContent = empty;
  dom.listToolbar.hidden = visible.length < 2;
  setStaysTitle(state.areaName ? t('results.titleIn', { place: state.areaName }) : state.searched ? t('results.title') : t('results.welcome'));
  renderRecentChips();
  if (dom.chips.classList.contains('is-idle') === state.searched) {
    dom.chips.classList.toggle('is-idle', !state.searched);
    setSheet(state.sheet, false);
  }
  dom.resultsList.replaceChildren(...visible.map((place, index) => placeItem(place, state.origin, 'results', isTopPick(place, index))));
  renderChips();
  renderMarkers();
}

function sortedFavorites(reference) {
  const list = Object.values(state.favorites);
  const collator = new Intl.Collator(getLanguage(), { sensitivity: 'base' });
  const byName = (a, b) => (a.name ? 0 : 1) - (b.name ? 0 : 1) || collator.compare(placeName(a), placeName(b));
  switch (state.favoriteSort) {
    case 'name':
      return list.sort(byName);
    case 'type':
      return list.sort((a, b) => ACCOMMODATION_TYPES.indexOf(a.type) - ACCOMMODATION_TYPES.indexOf(b.type) || byName(a, b));
    case 'distance':
      return list.sort((a, b) => distance(reference, a) - distance(reference, b));
    default:
      return list.sort((a, b) => b.addedAt - a.addedAt);
  }
}

function renderFavoritesList() {
  const reference = state.user || mapView.getVisibleCenter();
  const list = sortedFavorites(reference);
  dom.favoritesCount.textContent = list.length ? formatNumber(list.length) : '';
  dom.favoritesEmpty.textContent = list.length ? '' : t('favorites.empty');
  dom.favoritesList.replaceChildren(...list.map((place) => placeItem(place, reference, 'favorites')));
  dom.favoritesToggle.checked = state.showFavorites;
}

function toFavorite(place) {
  const { id, type, name, lat, lon, stars, address, city, website, phone, email, description, photo, facts } = place;
  return { id, kind: 'accommodation', type, name, lat, lon, stars, address, city, website, phone, email, description, photo, facts, addedAt: Date.now() };
}

function persistFavorites() {
  if (!save('favorites', state.favorites)) {
    toast(t('favorites.storageError'), { type: 'error', duration: 6000 });
    return false;
  }
  return true;
}

function syncFavoriteViews(id, bump = false) {
  const active = isFavorite(id);
  document.querySelectorAll(`[data-fav-id="${CSS.escape(id)}"]`).forEach((button) => {
    setHeartState(button, active);
    if (bump) {
      button.classList.remove('is-bump');
      void button.offsetWidth;
      button.classList.add('is-bump');
    }
  });
  renderMarkers();
  renderFavoritesList();
}

function toggleFavorite(place) {
  const previous = state.favorites[place.id];
  if (previous) delete state.favorites[place.id];
  else state.favorites[place.id] = toFavorite(place);
  if (!persistFavorites()) {
    if (previous) state.favorites[place.id] = previous;
    else delete state.favorites[place.id];
    syncFavoriteViews(place.id);
    return;
  }
  syncFavoriteViews(place.id, true);
  if (previous) {
    toast(t('favorites.removed'), {
      action: {
        label: t('favorites.undo'),
        onClick: () => {
          state.favorites[previous.id] = previous;
          persistFavorites();
          syncFavoriteViews(previous.id);
        }
      },
      duration: 5000
    });
  } else {
    toast(t('favorites.added'));
  }
}

function popupRow(name, content) {
  return el('li', { class: 'popup__row' }, icon(name), content);
}

function displayHost(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function setStaysTitle(value) {
  state.staysTitle = value;
  applyHeader();
}

function setStaysCount(value) {
  state.staysCount = value;
  applyHeader();
}

function applyHeader() {
  if (state.tab === 'discover') {
    dom.sheetTitle.textContent = discoverTitle();
    dom.resultsCount.textContent = discoverSubtitle();
    return;
  }
  const route = state.tab === 'route';
  dom.sheetTitle.textContent = route ? t('route.title') : state.staysTitle;
  dom.resultsCount.textContent = route ? state.routeCount : state.staysCount;
}

function renderSightLayer() {
  mapView.renderPoiLayer('sights', state.sights, state.tab === 'discover');
}

function applyStayLayers() {
  const discover = state.tab === 'discover';
  mapView.setAccommodationsVisible(state.layers.accommodation && !discover);
  mapView.setFavoritesVisible(!discover);
}

function setTab(tab, { fit = true } = {}) {
  const changed = state.tab !== tab;
  state.tab = tab;
  if (changed) mapView.closePopup();
  mapView.setRouteDimmed(tab !== 'route');
  save('tab', tab);
  const route = tab === 'route';
  const discover = tab === 'discover';
  dom.tabStays.setAttribute('aria-selected', String(tab === 'stays'));
  dom.tabRoute.setAttribute('aria-selected', String(route));
  dom.tabDiscover.setAttribute('aria-selected', String(discover));
  dom.chips.hidden = tab !== 'stays';
  dom.sheetBody.hidden = tab !== 'stays';
  dom.routeBody.hidden = !route;
  dom.discoverBody.hidden = !discover;
  dom.sheetHeader.setAttribute('aria-controls', route ? 'route-body' : discover ? 'discover-body' : 'sheet-body');
  document.body.dataset.tab = tab;
  dom.sheet.dataset.tab = tab;
  applyHeader();
  renderSightLayer();
  applyStayLayers();
  if (!wideQuery.matches && state.sheet === 'peek' && (route || discover)) setSheet('half');
  else setSheet(state.sheet, false);
  if (route && changed && fit) fitRoute();
  if (discover) {
    if (changed) renderDiscover();
    activateDiscover();
  }
}

function stayButton(place) {
  const stop = stayTargetFor(place);
  if (!stop) return null;
  const status = stayStatus(stop.id, place.id);
  return el('button', {
    type: 'button',
    class: `btn ${status.saved ? 'btn--secondary is-saved' : 'btn--primary'} popup__stay`,
    'aria-pressed': String(status.saved),
    onclick: () => {
      const added = toggleStay(stop.id, place);
      toast(t(added ? 'route.stayAdded' : 'route.stayRemoved', { name: placeName(place), place: stop.name }), added ? { action: { label: t('route.show'), onClick: () => setTab('route') } } : {});
      setTimeout(refreshOpenPopup, 0);
    }
  }, icon(status.saved ? 'check' : 'heart'), el('span', { text: t(status.chosen ? 'route.stayChosenFor' : status.saved ? 'route.stayForDone' : 'route.stayFor', { place: stop.name }) }));
}

function refreshOpenPopup() {
  if (state.popupItem && mapView.getOpenPopupId() === state.popupItem.id) {
    mapView.updatePopup(contentFor(state.popupItem));
  }
}

async function findStayFor(stop) {
  state.searchToken += 1;
  setTab('stays', { fit: false });
  mapView.closePopup();
  const result = { lat: stop.lat, lon: stop.lon, kind: 'city', rank: 16, name: stop.name, bounds: null };
  if (!wideQuery.matches) setSheet('half', false);
  const plan = mapView.planSearchResult(result);
  mapView.showSearchResult(result);
  searchArea({ areaName: stop.name, area: plan });
}

async function showStay(stay) {
  if (!wideQuery.matches) setSheet('peek');
  mapView.closePopup();
  await mapView.focusPlace(stay);
  openItemPopup(stay);
}

function addToRouteButton(item) {
  return el('button', {
    type: 'button',
    class: 'btn btn--secondary popup__add',
    onclick: () => {
      const name = item.name || (item.kind === 'poi' ? t(`poi.${item.type}`) : placeName(item));
      const country = state.areaCountry && state.origin && distance(state.origin, item) < 150000 ? state.areaCountry : null;
      if (addStop({ name, detail: item.address || item.city || null, country, lat: item.lat, lon: item.lon })) {
        toast(t('route.added', { name }), { action: { label: t('route.show'), onClick: () => setTab('route') } });
      }
    }
  }, icon('plus'), el('span', { text: t('route.addToRoute') }));
}

function routeButton(item) {
  const href = `https://www.google.com/maps/dir/?api=1&destination=${item.lat.toFixed(6)},${item.lon.toFixed(6)}`;
  return el('a', { class: 'btn btn--primary', href, target: '_blank', rel: 'noopener noreferrer' },
    icon('route'), el('span', { text: t('place.route') }));
}

function closeButton() {
  return el('button', { type: 'button', class: 'popup__close', 'aria-label': t('place.close'), onclick: () => mapView.closePopup() }, icon('close'));
}

function contactRows(item) {
  const rows = [];
  if (item.openingHours) rows.push(popupRow('clock', el('span', { text: item.openingHours })));
  if (item.address) rows.push(popupRow('pin', el('span', { text: item.address })));
  if (item.website) rows.push(popupRow('globe', link(item.website, displayHost(item.website))));
  if (item.phone) rows.push(popupRow('phone', el('a', { href: `tel:${item.phone.replace(/[^\d+]/g, '')}`, text: item.phone })));
  if (item.email) rows.push(popupRow('mail', el('a', { href: `mailto:${item.email}`, text: item.email })));
  return rows.length ? el('ul', { class: 'popup__rows' }, rows) : null;
}

function factChips(list) {
  return list.length ? el('ul', { class: 'facts' }, list.map((label) => el('li', { class: 'fact', text: label }))) : null;
}

function accommodationFacts(facts = {}) {
  const list = [];
  if (facts.wifi) list.push(t(facts.wifi === 'free' ? 'fact.wifiFree' : 'fact.wifi'));
  if (facts.checkIn) list.push(t('fact.checkIn', { time: facts.checkIn }));
  if (facts.checkOut) list.push(t('fact.checkOut', { time: facts.checkOut }));
  if (facts.rooms) list.push(tCount('fact.rooms', facts.rooms));
  if (facts.beds) list.push(tCount('fact.beds', facts.beds));
  if (facts.wheelchair) list.push(t(facts.wheelchair === 'yes' ? 'fact.wheelchair' : 'fact.wheelchairLimited'));
  if (facts.nonSmoking) list.push(t('fact.nonSmoking'));
  return list;
}

function poiFacts(facts = {}) {
  const list = [];
  if (facts.allDay) list.push(t('fact.allDay'));
  if (facts.emergency) list.push(t('fact.emergency'));
  if (facts.atm) list.push(t('fact.atm'));
  if (facts.iata) list.push(t('fact.iata', { code: facts.iata }));
  if (facts.fee) list.push(t(facts.fee === 'yes' ? 'fact.fee' : 'fact.noFee'));
  if (facts.wheelchair) list.push(t(facts.wheelchair === 'yes' ? 'fact.wheelchair' : 'fact.wheelchairLimited'));
  return list;
}

function descriptionFor(place) {
  if (!place.description) return null;
  return place.description[getLanguage()] || place.description.default || place.description.en || null;
}

function priceSection(place) {
  if (!place.name) return null;
  const query = [place.name, place.city].filter(Boolean).join(', ');
  const lang = getLanguage();
  const dates = stayDatesFor(place);
  const bookingParams = new URLSearchParams({ ss: query, lang: { de: 'de', en: 'en-gb', es: 'es' }[lang] || 'en-gb' });
  if (dates) {
    bookingParams.set('checkin', dates.checkin);
    bookingParams.set('checkout', dates.checkout);
  }
  const booking = `https://www.booking.com/searchresults.html?${bookingParams}`;
  const google = `https://www.google.com/travel/search?${new URLSearchParams({ q: query, hl: lang })}`;
  const button = (href, label, extra = '') => el('a', { class: `btn btn--secondary${extra}`, href, target: '_blank', rel: 'noopener noreferrer', title: t('prices.note') },
    el('span', { text: label }), icon('external'));
  const hostelworld = HOSTELWORLD_TYPES.includes(place.type)
    ? button(`https://www.google.com/search?${new URLSearchParams({ q: `site:hostelworld.com ${query}`, hl: lang })}`, 'Hostelworld', ' btn--wide')
    : null;
  return el('div', { class: 'prices' },
    el('div', { class: 'prices__title' }, icon('tag'), el('span', { text: t('prices.title') })),
    el('div', { class: 'prices__buttons' }, hostelworld, button(booking, 'Booking.com'), button(google, 'Google')));
}

async function loadPhoto(item, figure) {
  let photo = null;
  try {
    photo = await fetchPhoto(item.photo);
  } catch {
    photo = null;
  }
  if (!photo) {
    figure.remove();
    mapView.refreshPopup();
    return;
  }
  const img = el('img', { alt: '', decoding: 'async', referrerpolicy: 'no-referrer' });
  img.addEventListener('load', () => figure.classList.remove('is-loading'));
  img.addEventListener('error', () => {
    figure.remove();
    mapView.refreshPopup();
  });
  img.src = photo.src;
  figure.append(img, el('figcaption', { class: 'popup__credit' }, link(photo.link, t('photo.credit', { source: photo.credit }))));
}

function popupContent(place) {
  const figure = place.photo ? el('figure', { class: 'popup__photo is-loading' }) : null;
  const description = descriptionFor(place);
  const content = el('div', { class: 'popup' },
    figure,
    el('div', { class: 'popup__body' },
      el('div', { class: 'popup__head' },
        el('span', { class: 'type-badge', style: `--c:${mapView.TYPES[place.type]?.color}` }, typeDot(place.type), el('span', { text: typeLabel(place.type) })),
        heartButton(place),
        closeButton()),
      el('h3', { class: `popup__title${place.name ? '' : ' is-unnamed'}`, text: placeName(place) }),
      place.stars ? el('div', { class: 'popup__stars' },
        el('span', { class: 'stars', 'aria-hidden': 'true', text: starString(place.stars) }),
        el('span', { text: starLabel(place.stars) })) : null,
      factChips(accommodationFacts(place.facts)),
      description ? el('p', { class: 'popup__desc', text: description }) : null,
      contactRows(place),
      priceSection(place),
      stayButton(place) || addToRouteButton(place),
      routeButton(place)));
  if (figure) loadPhoto(place, figure);
  return content;
}

function poiContent(item) {
  const typeText = t(`poi.${item.type}`);
  const color = mapView.LAYERS[item.category].color;
  return el('div', { class: 'popup' },
    el('div', { class: 'popup__body' },
      el('div', { class: 'popup__head' },
        el('span', { class: 'type-badge', style: `--c:${color}` }, dot(color, item.category), el('span', { text: typeText })),
        closeButton()),
      el('h3', { class: 'popup__title', text: item.name || typeText }),
      item.operator && item.operator !== item.name ? el('p', { class: 'popup__subtitle', text: item.operator }) : null,
      factChips(poiFacts(item.facts)),
      contactRows(item),
      addToRouteButton(item),
      routeButton(item)));
}

function sightSaveButton(item) {
  const stop = sightTargetFor(item, currentStopId());
  if (!stop) return null;
  const saved = sightStatus(stop.id, item.id);
  return el('button', {
    type: 'button',
    class: `btn ${saved ? 'btn--secondary is-saved' : 'btn--primary'} popup__stay`,
    'aria-pressed': String(saved),
    onclick: () => {
      const added = toggleSight(stop.id, item);
      toast(t(added ? 'sights.added' : 'sights.removed', { name: item.name, place: stop.name }), added ? { action: { label: t('route.show'), onClick: () => setTab('route') } } : {});
      setTimeout(refreshOpenPopup, 0);
    }
  }, icon(saved ? 'check' : 'plus'), el('span', { text: t(saved ? 'sights.savedFor' : 'sights.saveFor', { place: stop.name }) }));
}

function sightPhoto(item) {
  const holder = el('div', { class: 'popup__gallery' });
  if (item.image) holder.append(gallery([{ src: item.image, link: item.image, credit: 'Wikimedia Commons', label: item.name }]));
  else if (item.photo) {
    const figure = el('figure', { class: 'popup__photo is-loading' });
    holder.append(figure);
    loadPhoto(item, figure);
  }
  return holder;
}

function sightContent(item) {
  const color = mapView.LAYERS.sights.color;
  const typeText = t(`sights.type.${item.type}`);
  const description = el('p', { class: 'popup__desc is-loading', text: t('sights.loadingText') });
  const lang = getLanguage();
  const photos = sightPhoto(item);
  if (item.wikidata || item.wikiTitle) {
    fetchSightSummary(item, lang).then((summary) => {
      if (!summary) {
        description.remove();
      } else {
        description.classList.remove('is-loading');
        description.textContent = summary.text;
        const images = [item.image ? { src: item.image, link: item.image, credit: 'Wikimedia Commons', label: item.name } : null, ...(summary.images || [])].filter(Boolean)
          .filter((image, index, all) => all.findIndex((other) => other.src.split('?')[0] === image.src.split('?')[0]) === index);
        if (images.length > (item.image ? 1 : 0)) photos.replaceChildren(gallery(images));
      }
      mapView.refreshPopup();
    }).catch(() => {
      description.remove();
      mapView.refreshPopup();
    });
  } else {
    description.remove();
  }
  const facts = [];
  if (item.fee === 'no') facts.push(t('sights.free'));
  if (item.fee === 'yes') facts.push(t('sights.fee'));
  return el('div', { class: 'popup' },
    photos,
    el('div', { class: 'popup__body' },
      el('div', { class: 'popup__head' },
        el('span', { class: 'type-badge', style: `--c:${color}` }, dot(color, `sight-${item.type}`), el('span', { text: typeText })),
        closeButton()),
      el('h3', { class: 'popup__title', text: item.name }),
      factChips(facts),
      description,
      contactRows(item),
      sightSaveButton(item) || addToRouteButton(item),
      routeButton(item)));
}

function contentFor(item) {
  if (item.kind === 'sight') return sightContent(item);
  return item.kind === 'poi' ? poiContent(item) : popupContent(item);
}

async function showSight(item) {
  if (!wideQuery.matches) setSheet('peek');
  mapView.closePopup();
  await mapView.focusPlace(item);
  openItemPopup(item);
}

function openItemPopup(item) {
  hideSearchPanel();
  toggleLayers(false);
  if (!wideQuery.matches && state.sheet !== 'peek' && dom.sheet.getBoundingClientRect().top - dom.areaBtn.getBoundingClientRect().bottom < 300) setSheet('peek');
  mapView.openPopup(item, contentFor(item));
  state.popupItem = item;
}

async function selectPlace(place, context) {
  if (context === 'favorites') closeDrawer();
  if (!wideQuery.matches) setSheet('peek');
  mapView.closePopup();
  await mapView.focusPlace(place);
  openItemPopup(place);
}

function covers(outer, inner) {
  const latPad = (outer.north - outer.south) * 0.25;
  const lonPad = (outer.east - outer.west) * 0.25;
  return inner.south >= outer.south - latPad && inner.north <= outer.north + latPad
    && inner.west >= outer.west - lonPad && inner.east <= outer.east + lonPad;
}

function updateAreaButton() {
  const zoomedOut = mapView.getZoom() < MIN_SEARCH_ZOOM;
  const covered = Boolean(state.lastSearch) && !zoomedOut && covers(state.lastSearch, mapView.getBounds());
  const hidden = covered && !state.areaLoading;
  dom.areaBtn.classList.toggle('is-hidden', hidden);
  dom.areaBtn.setAttribute('aria-hidden', String(hidden));
  dom.areaBtn.tabIndex = hidden ? -1 : 0;
  dom.areaBtn.classList.toggle('is-disabled', zoomedOut && !state.areaLoading);
  dom.areaBtn.classList.toggle('is-loading', state.areaLoading);
  dom.areaBtn.setAttribute('aria-busy', String(state.areaLoading));
  dom.areaLabel.textContent = state.areaLoading ? t('area.loading') : zoomedOut ? t('area.zoomIn') : t('area.search');
}

function skeletonItem() {
  return el('li', { class: 'place place--skeleton', 'aria-hidden': 'true' },
    el('span', { class: 'place__main' },
      el('span', { class: 'type-dot skeleton' }),
      el('span', { class: 'place__text' },
        el('span', { class: 'skeleton skeleton--line' }),
        el('span', { class: 'skeleton skeleton--short' }))));
}

function renderLoading(areaName) {
  setStaysTitle(areaName ? t('results.titleIn', { place: areaName }) : t('results.title'));
  setStaysCount(t('area.loading'));
  dom.resultsEmpty.textContent = '';
  dom.recent.hidden = true;
  dom.listToolbar.hidden = true;
  dom.resultsList.replaceChildren(...Array.from({ length: 5 }, skeletonItem));
  dom.sheetBody.scrollTop = 0;
}

async function loadPoiLayers(bounds, signal) {
  const categories = POI_CATEGORIES.filter((key) => state.layers[key]);
  if (!categories.length || signal.aborted) return;
  const runs = Object.fromEntries(categories.map((category) => [category, (state.poiRun[category] || 0) + 1]));
  Object.assign(state.poiRun, runs);
  beginRequest();
  try {
    const data = await fetchCategories(categories, bounds, { signal });
    if (signal.aborted) return;
    for (const category of categories) {
      if (state.poiRun[category] !== runs[category]) continue;
      state.poi[category] = data[category].items;
      renderPoi(category);
    }
    if (categories.some((category) => data[category].truncated)) truncatedNotice();
  } catch (error) {
    if (error.code === 'aborted' || signal.aborted) return;
    toast(errorMessage(error), {
      type: 'error',
      duration: 8000,
      action: { label: t('common.retry'), onClick: () => loadPoiLayers(bounds, signal) }
    });
  } finally {
    endRequest();
  }
}

function showAccommodations(items, { bounds, center, areaName }, partial = false) {
  state.origin = state.user && isInside(state.user, bounds) ? state.user : center;
  state.places = sortPlaces(items);
  state.searched = true;
  state.lastSearch = partial ? null : bounds;
  if (areaName) state.filter = 'all';
  renderResults();
  dom.sheetBody.scrollTop = 0;
  if (areaName && !wideQuery.matches && state.places.length && state.sheet === 'peek') setSheet('half');
}

async function searchArea({ areaName = null, area = null } = {}) {
  if (!area && mapView.getZoom() < MIN_SEARCH_ZOOM) {
    mapView.zoomInTo(MIN_SEARCH_ZOOM);
    return;
  }
  if (state.areaController) state.areaController.abort();
  const controller = new AbortController();
  const { signal } = controller;
  state.areaController = controller;
  hideSearchPanel();
  toggleLayers(false);
  const bounds = area ? area.bounds : mapView.getBounds();
  const center = area ? area.center : mapView.getVisibleCenter();
  const context = { bounds, center, areaName };
  const current = () => state.areaController === controller;
  state.areaLoading = true;
  state.loadFailed = null;
  state.places = [];
  state.areaName = areaName;
  state.lastSearch = null;
  renderMarkers();
  updateAreaButton();
  renderLoading(areaName);
  beginRequest();
  let loaded = false;
  try {
    const data = await fetchCategories(['accommodation'], bounds, {
      signal,
      onWait: (seconds) => {
        if (current()) setStaysCount(t('area.waiting', { s: seconds }));
      }
    });
    if (!current()) return;
    loaded = true;
    showAccommodations(data.accommodation.items, context);
    if (data.accommodation.truncated) truncatedNotice();
  } catch (error) {
    if (!current() || error.code === 'aborted') return;
    if (error.code !== 'offline') {
      setStaysCount(t('area.fallback'));
      try {
        const items = await fetchAccommodationsFallback(bounds, getLanguage(), signal);
        if (!current()) return;
        if (items.length) {
          showAccommodations(items, context, true);
          toast(t('results.partial'), { duration: 7000 });
          return;
        }
      } catch (fallbackError) {
        if (!current() || fallbackError.code === 'aborted') return;
      }
    }
    const retry = () => searchArea({ areaName, area: { bounds, center } });
    state.loadFailed = retry;
    renderResults();
    toast(errorMessage(error), {
      type: 'error',
      duration: 8000,
      action: { label: t('common.retry'), onClick: retry }
    });
  } finally {
    endRequest();
    if (current()) {
      state.areaLoading = false;
      updateAreaButton();
    }
  }
  if (loaded) loadPoiLayers(bounds, signal);
}

function showSearchMessage(message, isError = false) {
  dom.searchMessage.textContent = message;
  dom.searchMessage.classList.toggle('is-error', isError);
  dom.searchMessage.classList.remove('is-label');
  dom.searchPanel.dataset.mode = 'message';
  dom.searchResults.replaceChildren();
  dom.searchPanel.hidden = false;
}

function hideSearchPanel() {
  dom.searchPanel.hidden = true;
}

function searchHit(result, iconName) {
  return el('li', {},
    el('button', { type: 'button', class: 'search-hit', onclick: () => chooseSearchResult(result) },
      el('span', { class: 'search-hit__icon' }, icon(iconName)),
      el('span', { class: 'search-hit__text' },
        el('span', { class: 'search-hit__name', text: result.name }),
        result.detail ? el('span', { class: 'search-hit__detail', text: result.detail }) : null)));
}

function renderSearchResults(results) {
  dom.searchMessage.textContent = '';
  dom.searchMessage.classList.remove('is-error', 'is-label');
  dom.searchPanel.dataset.mode = 'results';
  dom.searchResults.replaceChildren(...results.map((result) => searchHit(result, 'place')));
  dom.searchPanel.hidden = false;
}

function showRecent() {
  const recent = getRecent(dom.searchInput.value);
  if (!recent.length) {
    if (dom.searchPanel.dataset.mode !== 'results' || !dom.searchInput.value) hideSearchPanel();
    return;
  }
  dom.searchMessage.textContent = t('recent.title');
  dom.searchMessage.classList.remove('is-error');
  dom.searchMessage.classList.add('is-label');
  dom.searchPanel.dataset.mode = 'recent';
  dom.searchResults.replaceChildren(...recent.map((result) => searchHit(result, 'clock')),
    el('li', { class: 'search-panel__footer' }, el('button', {
      type: 'button',
      class: 'link-btn',
      text: t('recent.clear'),
      onclick: () => {
        clearRecent();
        hideSearchPanel();
        renderResults();
        dom.searchInput.focus();
      }
    })));
  dom.searchPanel.hidden = false;
}

function renderRecentChips() {
  const recent = state.searched || state.loadFailed ? [] : getRecent();
  dom.recent.hidden = !recent.length;
  if (!recent.length) {
    dom.recent.replaceChildren();
    return;
  }
  dom.recent.replaceChildren(
    el('p', { class: 'recent__title', text: t('recent.title') }),
    el('div', { class: 'recent__list' }, recent.map((result) => el('button', {
      type: 'button',
      class: 'recent__chip',
      onclick: () => {
        dom.searchInput.value = result.name;
        chooseSearchResult(result);
      }
    }, icon('clock'), el('span', { text: result.name })))));
}

async function chooseSearchResult(result) {
  const token = ++state.searchToken;
  hideSearchPanel();
  addRecent(result);
  state.areaCountry = result.country || null;
  setDiscoverPlace({ ...result, source: 'search' }, { silent: state.tab !== 'discover' });
  if (state.tab === 'discover') activateDiscover();
  dom.searchInput.value = result.name;
  updateClearButton();
  dom.searchInput.blur();
  mapView.closePopup();
  const local = mapView.searchResultZoom(result) !== null || !result.bounds;
  if (!wideQuery.matches) setSheet(local ? 'half' : 'peek', false);
  const plan = mapView.planSearchResult(result);
  const moving = mapView.showSearchResult(result);
  if (plan) {
    searchArea({ areaName: result.name, area: plan });
    return;
  }
  await moving;
  if (token !== state.searchToken) return;
  if (mapView.getZoom() >= MIN_SEARCH_ZOOM) searchArea({ areaName: result.name });
  else toast(t('search.zoomHint'), { duration: 5000 });
}

function isClearWinner(results) {
  if (results.length === 1) return true;
  const [first, second] = results;
  return first.importance >= 0.4 && first.importance >= second.importance * 1.25;
}

async function handleSearch(event) {
  event.preventDefault();
  const query = dom.searchInput.value.trim();
  if (query.length < 2) {
    showSearchMessage(t('search.tooShort'), true);
    return;
  }
  const token = ++state.searchToken;
  showSearchMessage(t('search.searching'));
  dom.searchInput.blur();
  try {
    const results = await searchPlaces(query, getLanguage());
    if (token !== state.searchToken) return;
    if (!results.length) showSearchMessage(t('search.noResults'), true);
    else if (isClearWinner(results)) chooseSearchResult(results[0]);
    else renderSearchResults(results);
  } catch (error) {
    if (token !== state.searchToken) return;
    showSearchMessage(errorMessage(error), true);
  }
}

function updateClearButton() {
  dom.searchClear.hidden = dom.searchInput.value.length === 0;
}

function requestLocation() {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new Error('unsupported'));
      return;
    }
    navigator.geolocation.getCurrentPosition((position) => {
      const { latitude, longitude, accuracy } = position.coords;
      state.user = { lat: latitude, lon: longitude };
      mapView.showUser(latitude, longitude, accuracy);
      dom.locateBtn.classList.add('is-active');
      refreshStart();
      resolve(state.user);
    }, reject, { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
  });
}

function locate(initial = false) {
  if (!('geolocation' in navigator)) {
    if (!initial) toast(t('locate.unsupported'), { type: 'error' });
    return;
  }
  if (state.locating) return;
  state.locating = true;
  dom.locateBtn.classList.add('is-busy');
  requestLocation().then((user) => {
    state.locating = false;
    dom.locateBtn.classList.remove('is-busy');
    if (initial && state.view) return;
    mapView.flyToLocation(user.lat, user.lon, Math.max(LOCATE_ZOOM, initial ? 0 : mapView.getZoom()), !initial);
  }).catch((error) => {
    state.locating = false;
    dom.locateBtn.classList.remove('is-busy');
    if (initial) return;
    toast(t(error && error.code === 1 ? 'locate.denied' : 'locate.unavailable'), { type: 'error', duration: 6000 });
  });
}

function sheetPositions() {
  const height = dom.sheet.offsetHeight;
  const safe = parseFloat(getComputedStyle(dom.sheet).paddingBottom) || 0;
  const peekVisible = dom.sheetHeader.offsetHeight + dom.sheetTabs.offsetHeight + dom.chips.offsetHeight + safe;
  const room = window.innerHeight - dom.areaBtn.getBoundingClientRect().bottom - 168;
  const halfVisible = Math.max(peekVisible, Math.min(Math.max(peekVisible + 80, Math.round(window.innerHeight * 0.48)), room));
  return {
    full: 0,
    half: Math.max(0, height - halfVisible),
    peek: Math.max(0, height - peekVisible)
  };
}

function applySheetOffset(offset, animate) {
  dom.sheet.classList.toggle('is-animated', animate);
  dom.sheet.style.transform = `translateY(${offset}px)`;
  const visible = Math.max(0, dom.sheet.offsetHeight - offset);
  const wide = wideQuery.matches;
  document.documentElement.style.setProperty('--sheet-visible', `${wide ? 0 : visible}px`);
  const top = dom.areaBtn.getBoundingClientRect().bottom + 8;
  const left = wide ? dom.sheet.offsetLeft + dom.sheet.offsetWidth : 0;
  mapView.setInsets({ top, left, bottom: wide ? 0 : visible, right: wide ? 64 : 0 });
}

function setSheet(name, animate = true) {
  state.sheet = name;
  const offset = sheetPositions()[name];
  applySheetOffset(offset, animate);
  dom.sheet.style.setProperty('--sheet-hidden', `${offset}px`);
  dom.sheet.dataset.state = name;
  document.body.dataset.sheet = name;
  dom.sheetHeader.setAttribute('aria-expanded', String(name !== 'peek'));
}

function cycleSheet() {
  const index = SHEET_ORDER.indexOf(state.sheet);
  setSheet(SHEET_ORDER[(index + 1) % SHEET_ORDER.length]);
}

function initSheet() {
  let drag = null;
  dom.sheetHeader.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    const positions = sheetPositions();
    drag = {
      id: event.pointerId,
      startY: event.clientY,
      base: positions[state.sheet],
      positions,
      lastY: event.clientY,
      lastTime: event.timeStamp,
      velocity: 0,
      moved: false
    };
    dom.sheetHeader.setPointerCapture(event.pointerId);
  });
  dom.sheetHeader.addEventListener('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    const delta = event.clientY - drag.startY;
    if (!drag.moved && Math.abs(delta) < 6) return;
    drag.moved = true;
    const dt = Math.max(1, event.timeStamp - drag.lastTime);
    drag.velocity = (event.clientY - drag.lastY) / dt;
    drag.lastY = event.clientY;
    drag.lastTime = event.timeStamp;
    const offset = Math.min(drag.positions.peek, Math.max(0, drag.base + delta));
    applySheetOffset(offset, false);
  });
  const finish = (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    const current = drag;
    drag = null;
    if (!current.moved) {
      if (event.type === 'pointerup') cycleSheet();
      return;
    }
    const offset = current.base + (event.clientY - current.startY);
    const projected = offset + current.velocity * 180;
    let nearest = 'peek';
    let best = Infinity;
    for (const name of SHEET_ORDER) {
      const gap = Math.abs(current.positions[name] - projected);
      if (gap < best) {
        best = gap;
        nearest = name;
      }
    }
    setSheet(nearest);
  };
  dom.sheetHeader.addEventListener('pointerup', finish);
  dom.sheetHeader.addEventListener('pointercancel', finish);
  dom.sheetHeader.addEventListener('click', (event) => {
    if (event.detail === 0) cycleSheet();
  });
  if ('ResizeObserver' in window) {
    let sizes = '';
    const observer = new ResizeObserver(() => {
      const next = [dom.sheetHeader.offsetHeight, dom.sheetTabs.offsetHeight, dom.chips.offsetHeight].join('|');
      if (next === sizes) return;
      sizes = next;
      if (!drag) setSheet(state.sheet, false);
    });
    [dom.sheetHeader, dom.sheetTabs, dom.chips].forEach((node) => observer.observe(node));
  }
  dom.sheetHeader.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      cycleSheet();
    }
  });
}

function openDrawer() {
  renderFavoritesList();
  hideSearchPanel();
  toggleLayers(false);
  dom.drawer.removeAttribute('inert');
  dom.drawer.setAttribute('aria-hidden', 'false');
  dom.scrim.hidden = false;
  dom.menuBtn.setAttribute('aria-expanded', 'true');
  requestAnimationFrame(() => {
    dom.scrim.classList.add('is-visible');
    dom.drawer.classList.add('is-open');
  });
  setTimeout(() => dom.drawerClose.focus({ preventScroll: true }), 50);
}

function closeDrawer() {
  if (!dom.drawer.classList.contains('is-open')) return;
  dom.drawer.classList.remove('is-open');
  dom.scrim.classList.remove('is-visible');
  dom.drawer.setAttribute('aria-hidden', 'true');
  dom.drawer.setAttribute('inert', '');
  dom.menuBtn.setAttribute('aria-expanded', 'false');
  setTimeout(() => {
    if (!dom.drawer.classList.contains('is-open')) dom.scrim.hidden = true;
  }, 300);
  dom.menuBtn.focus({ preventScroll: true });
}

function renderAll() {
  applyTranslations();
  renderLanguageSwitch();
  renderThemeSwitch();
  fillSelect(dom.favoritesSort, FAVORITE_SORTS, 'favorites.sort', state.favoriteSort);
  fillSelect(dom.resultsSort, RESULT_SORTS, 'sort', state.resultSort);
  renderSources();
  renderAttribution();
  if (!dom.layers.hidden) renderLayersPanel();
  if (state.areaLoading) renderLoading(state.areaName);
  else renderResults();
  renderFavoritesList();
  updateAreaButton();
}

function bindEvents() {
  dom.sheet.addEventListener('focusin', (event) => {
    if (!wideQuery.matches && state.sheet !== 'full' && event.target.matches('input[type="search"], input[type="text"]')) setSheet('full');
  });
  dom.searchForm.addEventListener('submit', handleSearch);
  dom.searchInput.addEventListener('input', () => {
    updateClearButton();
    showRecent();
  });
  dom.searchInput.addEventListener('focus', () => {
    toggleLayers(false);
    if (!dom.searchInput.value) showRecent();
    else if (dom.searchResults.children.length && dom.searchPanel.dataset.mode === 'results') dom.searchPanel.hidden = false;
  });
  dom.searchClear.addEventListener('click', () => {
    dom.searchInput.value = '';
    updateClearButton();
    dom.searchResults.replaceChildren();
    hideSearchPanel();
    dom.searchInput.focus();
    showRecent();
  });
  dom.areaBtn.addEventListener('click', () => {
    state.searchToken += 1;
    searchArea();
  });
  dom.tabStays.addEventListener('click', () => setTab('stays'));
  dom.tabRoute.addEventListener('click', () => setTab('route'));
  dom.tabDiscover.addEventListener('click', () => setTab('discover'));
  dom.resultsRetry.addEventListener('click', () => {
    if (state.loadFailed) state.loadFailed();
  });
  dom.locateBtn.addEventListener('click', () => locate(false));
  dom.layersBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    toggleLayers();
  });
  dom.menuBtn.addEventListener('click', openDrawer);
  dom.drawerClose.addEventListener('click', closeDrawer);
  dom.scrim.addEventListener('click', closeDrawer);
  dom.favoritesToggle.addEventListener('change', () => setShowFavorites(dom.favoritesToggle.checked));
  dom.favoritesSort.addEventListener('change', () => {
    state.favoriteSort = pick(dom.favoritesSort.value, FAVORITE_SORTS, 'added');
    save('favoriteSort', state.favoriteSort);
    renderFavoritesList();
  });
  dom.resultsSort.addEventListener('change', () => {
    state.resultSort = pick(dom.resultsSort.value, RESULT_SORTS, 'recommended');
    save('resultSort', state.resultSort);
    state.places = sortPlaces(state.places);
    renderResults();
    dom.sheetBody.scrollTop = 0;
  });
  document.addEventListener('pointerdown', (event) => {
    if (!dom.layers.hidden && !dom.layers.contains(event.target) && !dom.layersBtn.contains(event.target)) toggleLayers(false);
    if (!dom.searchPanel.hidden && !dom.topbar.contains(event.target)) hideSearchPanel();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (dom.drawer.classList.contains('is-open')) closeDrawer();
    else if (!dom.layers.hidden) toggleLayers(false);
    else if (!dom.searchPanel.hidden) hideSearchPanel();
    else mapView.closePopup();
  });
  darkQuery.addEventListener('change', applyTheme);
  wideQuery.addEventListener('change', () => setSheet(wideQuery.matches ? 'full' : 'peek', false));
  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      setSheet(state.sheet, false);
      mapView.invalidateSize();
    }, 120);
  });
  window.addEventListener('offline', () => toast(t('errors.offline'), { type: 'error', duration: 6000 }));
  window.addEventListener('online', () => {
    toast(t('common.online'), { duration: 3000 });
    retryFailed();
    if (state.loadFailed && !state.areaLoading) state.loadFailed();
  });
  onLanguageChange(() => {
    renderAll();
    renderPlanner();
    renderDiscover();
    activateDiscover();
    if (state.popupItem && mapView.getOpenPopupId() === state.popupItem.id) {
      mapView.updatePopup(contentFor(state.popupItem));
    }
    hideSearchPanel();
    setSheet(state.sheet, false);
  });
}

function collectDom() {
  const ids = {
    map: 'map', progress: 'progress', topbar: 'topbar', searchForm: 'search-form', searchInput: 'search-input',
    searchClear: 'search-clear', searchPanel: 'search-panel', searchMessage: 'search-message', searchResults: 'search-results',
    areaBtn: 'area-btn', areaLabel: 'area-label', layersBtn: 'layers-btn', locateBtn: 'locate-btn', layers: 'layers',
    layersBase: 'layers-base', layersExtra: 'layers-extra', sheet: 'sheet', sheetHeader: 'sheet-header',
    resultsCount: 'results-count', chips: 'chips', sheetBody: 'sheet-body', sheetTitle: 'sheet-title', sheetTabs: 'sheet-tabs', tabStays: 'tab-stays', tabRoute: 'tab-route', tabDiscover: 'tab-discover', routeBody: 'route-body', discoverBody: 'discover-body', resultsRetry: 'results-retry', listToolbar: 'list-toolbar',
    resultsSort: 'results-sort', resultsEmpty: 'results-empty', recent: 'recent', resultsList: 'results-list', scrim: 'scrim', drawer: 'drawer',
    drawerClose: 'drawer-close', menuBtn: 'menu-btn', favoritesCount: 'favorites-count', favoritesToggle: 'favorites-toggle',
    favoritesSort: 'favorites-sort', favoritesEmpty: 'favorites-empty', favoritesList: 'favorites-list',
    languageSwitch: 'language-switch', themeSwitch: 'theme-switch', sources: 'sources'
  };
  for (const [key, id] of Object.entries(ids)) dom[key] = document.getElementById(id);
}

function init() {
  collectDom();
  applyTheme();
  applyTranslations();
  if (typeof window.L === 'undefined' || typeof window.L.markerClusterGroup !== 'function') {
    toast(t('errors.network'), { type: 'error', duration: 600000 });
    return;
  }
  mapView.initMap(dom.map, {
    dark: isDark(),
    view: state.view,
    onViewChange: () => {
      updateAreaButton();
      rememberView();
    },
    onMapClick: () => {
      hideSearchPanel();
      toggleLayers(false);
      dom.searchInput.blur();
    },
    onPlaceClick: openItemPopup,
    onPoiClick: openItemPopup,
    onPopupClose: () => {
      state.popupItem = null;
    }
  });
  applyStayLayers();
  initPlanner(dom.routeBody, {
    getUser: () => state.user,
    requestLocation,
    onSummary: (summary) => {
      state.routeCount = summary;
      applyHeader();
    },
    onShow: () => setTab('route', { fit: false }),
    onFindStay: findStayFor,
    onShowStay: showStay,
    onShowSight: showSight,
    onStaysChanged: refreshOpenPopup,
    onSightsChanged: () => {
      refreshSights();
      refreshOpenPopup();
    },
    onTripChange: () => {
      mapView.closePopup();
      renderDiscover();
      refreshSights();
      if (state.tab === 'discover') activateDiscover();
    },
    tripExtras,
    mergeFavorites,
    settingsDiffer,
    applySettings
  });
  initDiscover(dom.discoverBody, {
    isActive: () => state.tab === 'discover',
    getStops: routePlaces,
    getCenter: () => mapView.getVisibleCenter(),
    onShowSight: showSight,
    sightTarget: (item) => sightTargetFor(item, currentStopId()),
    sightSaved: sightStatus,
    toggleSight: (stopId, item) => toggleSight(stopId, item),
    onSights: (items) => {
      state.sights = items;
      renderSightLayer();
    },
    onHeader: applyHeader,
    onPlaceChange: (place) => {
      if (!wideQuery.matches && state.sheet === 'full') setSheet('half');
      mapView.flyToLocation(place.lat, place.lon, Math.max(12, Math.min(mapView.getZoom(), 14)));
    }
  });
  renderAll();
  initSheet();
  setSheet(wideQuery.matches ? 'full' : 'peek', false);
  setTab(state.tab, { fit: false });
  bindEvents();
  updateClearButton();
  locateIfAllowed();
  registerWorker();
}

function locateIfAllowed() {
  if (!('geolocation' in navigator) || !navigator.permissions || typeof navigator.permissions.query !== 'function') return;
  navigator.permissions.query({ name: 'geolocation' }).then((status) => {
    if (status.state === 'granted') locate(true);
  }).catch(() => {});
}

function registerWorker() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  const started = Date.now();
  const hadController = Boolean(navigator.serviceWorker.controller);
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloaded || !hadController || Date.now() - started > 20000) return;
    reloaded = true;
    window.location.reload();
  });
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

init();
