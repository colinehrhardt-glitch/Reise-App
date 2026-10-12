import { t, tCount, getLanguage, setLanguage, onLanguageChange, applyTranslations, LANGUAGES, formatDistance } from './i18n.js';
import { load, save } from './storage.js';
import { searchPlaces, fetchAccommodations, OVERPASS_LIMIT, ACCOMMODATION_TYPES } from './api.js';
import * as mapView from './map.js';

const MIN_SEARCH_ZOOM = 13;
const LOCATE_ZOOM = 14;
const FAVORITE_SORTS = ['added', 'name', 'type', 'distance'];
const THEMES = ['auto', 'light', 'dark'];
const SHEET_ORDER = ['peek', 'half', 'full'];
const wideQuery = window.matchMedia('(min-width: 768px)');
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

const dom = {};
const state = {
  places: [],
  searched: false,
  filter: 'all',
  origin: null,
  loading: false,
  locating: false,
  user: null,
  popupPlace: null,
  sheet: 'peek',
  searchToken: 0,
  favorites: sanitizeFavorites(load('favorites', {})),
  showFavorites: load('showFavorites', true) !== false,
  favoriteSort: pick(load('favoriteSort', 'added'), FAVORITE_SORTS, 'added'),
  theme: pick(load('theme', 'auto'), THEMES, 'auto')
};

function pick(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function sanitizeFavorites(raw) {
  const result = {};
  if (!raw || typeof raw !== 'object') return result;
  for (const item of Object.values(raw)) {
    if (!item || typeof item.id !== 'string' || !ACCOMMODATION_TYPES.includes(item.type)) continue;
    if (!Number.isFinite(item.lat) || !Number.isFinite(item.lon)) continue;
    result[item.id] = {
      id: item.id,
      type: item.type,
      name: typeof item.name === 'string' ? item.name : null,
      lat: item.lat,
      lon: item.lon,
      stars: item.stars && Number.isFinite(item.stars.count) ? { count: item.stars.count, superior: Boolean(item.stars.superior) } : null,
      address: typeof item.address === 'string' ? item.address : null,
      website: typeof item.website === 'string' && /^https?:\/\//i.test(item.website) ? item.website : null,
      phone: typeof item.phone === 'string' ? item.phone : null,
      addedAt: Number.isFinite(item.addedAt) ? item.addedAt : 0
    };
  }
  return result;
}

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'style') node.style.cssText = value;
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child !== null && child !== undefined && child !== false) node.append(child);
  }
  return node;
}

function icon(name) {
  const template = document.createElement('template');
  template.innerHTML = mapView.svg(name);
  return template.content.firstElementChild;
}

function typeLabel(type, many = false) {
  return t(`types.${type}.${many ? 'many' : 'one'}`);
}

function placeName(place) {
  return place.name || t('place.unnamed');
}

function typeDot(type) {
  return el('span', { class: 'type-dot', style: `--c:${mapView.TYPES[type]?.color || mapView.FAVORITE_COLOR}` }, icon(type));
}

function starString(stars) {
  return '★'.repeat(Math.floor(stars.count));
}

function starLabel(stars) {
  const label = tCount('place.stars', stars.count);
  return stars.superior ? `${label} ${t('place.superior')}` : label;
}

function distance(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

function isInside(point, bounds) {
  return point.lat >= bounds.south && point.lat <= bounds.north && point.lon >= bounds.west && point.lon <= bounds.east;
}

function isFavorite(id) {
  return Object.prototype.hasOwnProperty.call(state.favorites, id);
}

function errorMessage(error) {
  const code = error && error.code ? error.code : 'server';
  const key = `errors.${code}`;
  const text = t(key);
  return text === key ? t('errors.server') : text;
}

function toast(message, { type = 'info', action = null, duration = 4000 } = {}) {
  for (const existing of dom.toasts.querySelectorAll('.toast')) {
    if (existing.dataset.message === message) existing.remove();
  }
  const node = el('div', {
    class: `toast${type === 'error' ? ' toast--error' : ''}`,
    role: type === 'error' ? 'alert' : 'status',
    'data-message': message
  }, el('span', { class: 'toast__text', text: message }));
  let timer = 0;
  const dismiss = () => {
    clearTimeout(timer);
    node.classList.add('is-leaving');
    setTimeout(() => node.remove(), 260);
  };
  if (action) {
    node.append(el('button', {
      type: 'button',
      class: 'toast__action',
      text: action.label,
      onclick: () => {
        dismiss();
        action.onClick();
      }
    }));
  }
  dom.toasts.append(node);
  while (dom.toasts.children.length > 3) dom.toasts.firstElementChild.remove();
  timer = setTimeout(dismiss, duration);
}

function applyTheme() {
  const root = document.documentElement;
  if (state.theme === 'auto') delete root.dataset.theme;
  else root.dataset.theme = state.theme;
  const dark = state.theme === 'dark' || (state.theme === 'auto' && darkQuery.matches);
  document.querySelector('meta[name="theme-color"]').setAttribute('content', dark ? '#0a1416' : '#e9efef');
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

function renderSortOptions() {
  dom.favoritesSort.replaceChildren(...FAVORITE_SORTS.map((value) => el('option', {
    value,
    text: t(`favorites.sort.${value}`)
  })));
  dom.favoritesSort.value = state.favoriteSort;
}

function link(href, text) {
  return el('a', { href, target: '_blank', rel: 'noopener noreferrer', text });
}

function renderSources() {
  dom.sources.replaceChildren(
    el('dt', { text: t('about.map') }),
    el('dd', {}, '© ', link('https://www.openstreetmap.org/copyright', t('attribution.osm'))),
    el('dt', { text: t('about.search') }),
    el('dd', {}, link('https://nominatim.org', 'Nominatim')),
    el('dt', { text: t('about.places') }),
    el('dd', {}, link('https://overpass-api.de', 'Overpass API'))
  );
}

function renderAttribution() {
  mapView.setAttribution(`&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">${t('attribution.osm')}</a>`);
}

function renderLegend() {
  const items = ACCOMMODATION_TYPES.map((type) => el('li', { class: 'legend__item' }, typeDot(type), el('span', { text: typeLabel(type) })));
  items.push(el('li', { class: 'legend__item' },
    el('span', { class: 'type-dot', style: `--c:${mapView.FAVORITE_COLOR}` }, icon('heart')),
    el('span', { text: t('legend.favorite') })));
  dom.legendList.replaceChildren(...items);
}

function toggleLegend(force) {
  const open = typeof force === 'boolean' ? force : dom.legend.hidden;
  dom.legend.hidden = !open;
  dom.legendBtn.setAttribute('aria-expanded', String(open));
}

function filteredPlaces() {
  return state.filter === 'all' ? state.places : state.places.filter((place) => place.type === state.filter);
}

function sortPlaces(places, origin) {
  return places
    .map((place) => ({ place, d: distance(origin, place) }))
    .sort((a, b) => (a.place.name ? 0 : 1) - (b.place.name ? 0 : 1) || a.d - b.d)
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
    state.searched ? el('span', { class: 'chip__count', text: new Intl.NumberFormat(getLanguage()).format(count) }) : null);
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

function placeItem(place, reference, context) {
  const meta = [el('span', { text: typeLabel(place.type) })];
  if (place.stars) meta.push(el('span', { class: 'stars', 'aria-label': starLabel(place.stars), text: starString(place.stars) }));
  if (reference) meta.push(el('span', { text: formatDistance(distance(reference, place)) }));
  return el('li', { class: 'place' },
    el('button', { type: 'button', class: 'place__main', onclick: () => selectPlace(place, context) },
      typeDot(place.type),
      el('span', { class: 'place__text' },
        el('span', { class: `place__name${place.name ? '' : ' is-unnamed'}`, text: placeName(place) }),
        el('span', { class: 'place__meta' }, meta))),
    heartButton(place));
}

function renderMarkers() {
  const visible = filteredPlaces();
  mapView.renderResults(visible, isFavorite);
  const shown = new Set(visible.map((place) => place.id));
  mapView.renderFavorites(state.showFavorites ? Object.values(state.favorites).filter((place) => !shown.has(place.id)) : []);
}

function renderResults() {
  const visible = filteredPlaces();
  dom.resultsCount.textContent = state.searched ? tCount('results.count', visible.length) : '';
  let empty = '';
  if (!state.searched) empty = t('results.initial');
  else if (!state.places.length) empty = t('results.none');
  else if (!visible.length) empty = t('results.noneFiltered');
  dom.resultsEmpty.textContent = empty;
  dom.resultsList.replaceChildren(...visible.map((place) => placeItem(place, state.origin, 'results')));
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
  dom.favoritesCount.textContent = list.length ? new Intl.NumberFormat(getLanguage()).format(list.length) : '';
  dom.favoritesEmpty.textContent = list.length ? '' : t('favorites.empty');
  dom.favoritesList.replaceChildren(...list.map((place) => placeItem(place, reference, 'favorites')));
  dom.favoritesToggle.checked = state.showFavorites;
}

function toFavorite(place) {
  const { id, type, name, lat, lon, stars, address, website, phone } = place;
  return { id, type, name, lat, lon, stars, address, website, phone, addedAt: Date.now() };
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
  const stored = persistFavorites();
  syncFavoriteViews(place.id, true);
  if (!stored) return;
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

function routeUrl(place) {
  return `https://www.google.com/maps/dir/?api=1&destination=${place.lat.toFixed(6)},${place.lon.toFixed(6)}`;
}

function popupContent(place) {
  const rows = [];
  if (place.address) rows.push(popupRow('pin', el('span', { text: place.address })));
  if (place.website) rows.push(popupRow('globe', link(place.website, displayHost(place.website))));
  if (place.phone) rows.push(popupRow('phone', el('a', { href: `tel:${place.phone.replace(/[^\d+]/g, '')}`, text: place.phone })));
  const color = mapView.TYPES[place.type]?.color;
  return el('div', { class: 'popup' },
    el('div', { class: 'popup__head' },
      el('span', { class: 'type-badge', style: `--c:${color}` }, typeDot(place.type), el('span', { text: typeLabel(place.type) })),
      heartButton(place),
      el('button', { type: 'button', class: 'popup__close', 'aria-label': t('place.close'), onclick: () => mapView.closePopup() }, icon('close'))),
    el('h3', { class: `popup__title${place.name ? '' : ' is-unnamed'}`, text: placeName(place) }),
    place.stars ? el('div', { class: 'popup__stars' },
      el('span', { class: 'stars', 'aria-hidden': 'true', text: starString(place.stars) }),
      el('span', { text: starLabel(place.stars) })) : null,
    rows.length ? el('ul', { class: 'popup__rows' }, rows) : null,
    el('a', { class: 'btn btn--primary', href: routeUrl(place), target: '_blank', rel: 'noopener noreferrer' },
      icon('route'), el('span', { text: t('place.route') })));
}

function openPlacePopup(place) {
  hideSearchPanel();
  toggleLegend(false);
  mapView.openPopup(place, popupContent(place));
  state.popupPlace = place;
}

async function selectPlace(place, context) {
  if (context === 'favorites') closeDrawer();
  if (!wideQuery.matches) setSheet('peek');
  mapView.closePopup();
  await mapView.focusPlace(place);
  openPlacePopup(place);
}

function updateAreaButton() {
  const zoomedOut = mapView.getZoom() < MIN_SEARCH_ZOOM;
  dom.areaBtn.classList.toggle('is-disabled', zoomedOut && !state.loading);
  dom.areaBtn.classList.toggle('is-loading', state.loading);
  dom.areaBtn.setAttribute('aria-busy', String(state.loading));
  dom.areaLabel.textContent = state.loading ? t('area.loading') : zoomedOut ? t('area.zoomIn') : t('area.search');
}

function setLoading(loading) {
  state.loading = loading;
  dom.progress.hidden = !loading;
  updateAreaButton();
}

async function searchArea() {
  if (state.loading) return;
  if (mapView.getZoom() < MIN_SEARCH_ZOOM) {
    mapView.zoomInTo(MIN_SEARCH_ZOOM);
    return;
  }
  hideSearchPanel();
  const bounds = mapView.getBounds();
  const center = mapView.getVisibleCenter();
  setLoading(true);
  try {
    const { places, truncated } = await fetchAccommodations(bounds);
    state.origin = state.user && isInside(state.user, bounds) ? state.user : center;
    state.places = sortPlaces(places, state.origin);
    state.searched = true;
    renderResults();
    dom.sheetBody.scrollTop = 0;
    if (truncated) {
      toast(t('results.truncated', { n: new Intl.NumberFormat(getLanguage()).format(OVERPASS_LIMIT) }), { duration: 6000 });
    }
  } catch (error) {
    toast(errorMessage(error), {
      type: 'error',
      duration: 8000,
      action: { label: t('common.retry'), onClick: searchArea }
    });
  } finally {
    setLoading(false);
  }
}

function showSearchMessage(text, isError = false) {
  dom.searchMessage.textContent = text;
  dom.searchMessage.classList.toggle('is-error', isError);
  dom.searchResults.replaceChildren();
  dom.searchPanel.hidden = false;
}

function hideSearchPanel() {
  dom.searchPanel.hidden = true;
}

function renderSearchResults(results) {
  dom.searchMessage.textContent = '';
  dom.searchResults.replaceChildren(...results.map((result) => el('li', {},
    el('button', { type: 'button', class: 'search-hit', onclick: () => chooseSearchResult(result) },
      el('span', { class: 'search-hit__icon' }, icon('place')),
      el('span', { class: 'search-hit__text' },
        el('span', { class: 'search-hit__name', text: result.name }),
        result.detail ? el('span', { class: 'search-hit__detail', text: result.detail }) : null)))));
  dom.searchPanel.hidden = false;
}

function chooseSearchResult(result) {
  hideSearchPanel();
  dom.searchInput.value = result.name;
  updateClearButton();
  dom.searchInput.blur();
  mapView.closePopup();
  if (!wideQuery.matches && state.sheet !== 'peek') setSheet('peek');
  mapView.showSearchResult(result);
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
    else if (results.length === 1) chooseSearchResult(results[0]);
    else renderSearchResults(results);
  } catch (error) {
    if (token !== state.searchToken) return;
    showSearchMessage(errorMessage(error), true);
  }
}

function updateClearButton() {
  dom.searchClear.hidden = dom.searchInput.value.length === 0;
}

function locate(initial = false) {
  if (!('geolocation' in navigator)) {
    if (!initial) toast(t('locate.unsupported'), { type: 'error' });
    return;
  }
  if (state.locating) return;
  state.locating = true;
  dom.locateBtn.classList.add('is-busy');
  navigator.geolocation.getCurrentPosition((position) => {
    state.locating = false;
    dom.locateBtn.classList.remove('is-busy');
    dom.locateBtn.classList.add('is-active');
    const { latitude, longitude, accuracy } = position.coords;
    state.user = { lat: latitude, lon: longitude };
    mapView.showUser(latitude, longitude, accuracy);
    mapView.flyToLocation(latitude, longitude, Math.max(LOCATE_ZOOM, initial ? 0 : mapView.getZoom()), !initial);
  }, (error) => {
    state.locating = false;
    dom.locateBtn.classList.remove('is-busy');
    if (initial) return;
    toast(t(error.code === 1 ? 'locate.denied' : 'locate.unavailable'), { type: 'error', duration: 6000 });
  }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
}

function sheetPositions() {
  const height = dom.sheet.offsetHeight;
  const safe = parseFloat(getComputedStyle(dom.sheet).paddingBottom) || 0;
  const peekVisible = dom.sheetHeader.offsetHeight + dom.chips.offsetHeight + safe;
  const halfVisible = Math.max(peekVisible + 80, Math.round(window.innerHeight * 0.48));
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
  applySheetOffset(sheetPositions()[name], animate);
  dom.sheet.dataset.state = name;
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
  toggleLegend(false);
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
  renderSortOptions();
  renderSources();
  renderLegend();
  renderAttribution();
  renderResults();
  renderFavoritesList();
  updateAreaButton();
}

function bindEvents() {
  dom.searchForm.addEventListener('submit', handleSearch);
  dom.searchInput.addEventListener('input', () => {
    updateClearButton();
    if (dom.searchMessage.classList.contains('is-error')) hideSearchPanel();
  });
  dom.searchInput.addEventListener('focus', () => {
    toggleLegend(false);
    if (dom.searchResults.children.length) dom.searchPanel.hidden = false;
  });
  dom.searchClear.addEventListener('click', () => {
    dom.searchInput.value = '';
    updateClearButton();
    dom.searchResults.replaceChildren();
    hideSearchPanel();
    dom.searchInput.focus();
  });
  dom.areaBtn.addEventListener('click', searchArea);
  dom.locateBtn.addEventListener('click', () => locate(false));
  dom.legendBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    toggleLegend();
  });
  dom.menuBtn.addEventListener('click', openDrawer);
  dom.drawerClose.addEventListener('click', closeDrawer);
  dom.scrim.addEventListener('click', closeDrawer);
  dom.favoritesToggle.addEventListener('change', () => {
    state.showFavorites = dom.favoritesToggle.checked;
    save('showFavorites', state.showFavorites);
    renderMarkers();
  });
  dom.favoritesSort.addEventListener('change', () => {
    state.favoriteSort = pick(dom.favoritesSort.value, FAVORITE_SORTS, 'added');
    save('favoriteSort', state.favoriteSort);
    renderFavoritesList();
  });
  document.addEventListener('pointerdown', (event) => {
    if (!dom.legend.hidden && !dom.legend.contains(event.target) && !dom.legendBtn.contains(event.target)) toggleLegend(false);
    if (!dom.searchPanel.hidden && !dom.topbar.contains(event.target)) hideSearchPanel();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (dom.drawer.classList.contains('is-open')) closeDrawer();
    else if (!dom.legend.hidden) toggleLegend(false);
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
  onLanguageChange(() => {
    renderAll();
    if (state.popupPlace && mapView.getOpenPopupId() === state.popupPlace.id) {
      mapView.updatePopup(popupContent(state.popupPlace));
    }
    hideSearchPanel();
    setSheet(state.sheet, false);
  });
}

function collectDom() {
  const ids = {
    map: 'map', progress: 'progress', topbar: 'topbar', searchForm: 'search-form', searchInput: 'search-input',
    searchClear: 'search-clear', searchPanel: 'search-panel', searchMessage: 'search-message', searchResults: 'search-results',
    areaBtn: 'area-btn', areaLabel: 'area-label', legendBtn: 'legend-btn', locateBtn: 'locate-btn', legend: 'legend',
    legendList: 'legend-list', sheet: 'sheet', sheetHeader: 'sheet-header', resultsCount: 'results-count', chips: 'chips',
    sheetBody: 'sheet-body', resultsEmpty: 'results-empty', resultsList: 'results-list', scrim: 'scrim', drawer: 'drawer',
    drawerClose: 'drawer-close', menuBtn: 'menu-btn', favoritesCount: 'favorites-count', favoritesToggle: 'favorites-toggle',
    favoritesSort: 'favorites-sort', favoritesEmpty: 'favorites-empty', favoritesList: 'favorites-list',
    languageSwitch: 'language-switch', themeSwitch: 'theme-switch', sources: 'sources', toasts: 'toasts'
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
    onViewChange: updateAreaButton,
    onMapClick: () => {
      hideSearchPanel();
      toggleLegend(false);
      dom.searchInput.blur();
    },
    onPlaceClick: openPlacePopup,
    onPopupClose: () => {
      state.popupPlace = null;
    }
  });
  renderAll();
  initSheet();
  setSheet(wideQuery.matches ? 'full' : 'peek', false);
  bindEvents();
  updateClearButton();
  locate(true);
}

init();
