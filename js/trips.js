import { t, tCount, getLanguage } from './i18n.js';
import { load, save, remove } from './storage.js';
import { el, icon, toast } from './ui.js';
import { downloadFile } from './overview.js';

const KEY = 'trips';
const LEGACY = 'route';
const MAX_TRIPS = 30;
const MAX_FILE = 2 * 1024 * 1024;
const FORMAT = 1;

let store = { active: null, items: [] };
let hooks = {};
let root = null;
let open = false;
let fileInput = null;

function newId() {
  return `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function cleanName(value) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 60) : null;
}

function validItem(raw) {
  if (!raw || typeof raw.id !== 'string' || !raw.data || typeof raw.data !== 'object') return null;
  return { id: raw.id.slice(0, 40), name: cleanName(raw.name), updated: Number.isFinite(raw.updated) ? raw.updated : Date.now(), data: raw.data };
}

function persistStore() {
  return save(KEY, store);
}

function activeItem() {
  return store.items.find((item) => item.id === store.active) || store.items[0];
}

export function loadTrips() {
  const raw = load(KEY, null);
  const items = raw && Array.isArray(raw.items) ? raw.items.map(validItem).filter(Boolean).slice(0, MAX_TRIPS) : [];
  const fresh = !items.length;
  if (fresh) {
    const legacy = load(LEGACY, null);
    items.push({ id: newId(), name: null, updated: Date.now(), data: legacy && typeof legacy === 'object' ? legacy : {} });
  }
  store = { active: raw && items.some((item) => item.id === raw.active) ? raw.active : items[0].id, items };
  if (fresh && persistStore()) remove(LEGACY);
  return activeItem().data;
}

export function saveTrip(data) {
  const item = activeItem();
  item.data = data;
  item.updated = Date.now();
  const ok = persistStore();
  renderTrips();
  return ok;
}

export function activeTripName() {
  return activeItem().name;
}

function placeNames(data) {
  const stops = Array.isArray(data.stops) ? data.stops : [];
  const start = data.startMode === 'custom' && data.startPlace ? [data.startPlace] : [];
  return [...start, ...stops].map((point) => (point && typeof point.name === 'string' ? point.name : null)).filter(Boolean);
}

function autoName(data) {
  const names = placeNames(data);
  if (!names.length) return t('trips.untitled');
  if (names.length === 1) return names[0];
  return t('route.calendarName', { from: names[0], to: names[names.length - 1] });
}

function displayName(item) {
  return item.name || autoName(item.data);
}

function tripMeta(data) {
  const stops = Array.isArray(data.stops) ? data.stops : [];
  const nights = [...stops, data.startMode === 'custom' && data.startPlace ? data.startPlace : null]
    .reduce((sum, stop) => sum + (stop && Number.isInteger(stop.nights) ? stop.nights : 0), 0);
  const parts = [];
  if (typeof data.tripStart === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(data.tripStart)) {
    parts.push(new Intl.DateTimeFormat(getLanguage(), { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${data.tripStart}T12:00:00`)));
  }
  parts.push(tCount('trips.places', stops.length));
  if (nights) parts.push(tCount('route.nights', nights));
  return parts.join(' · ');
}

function slug(value) {
  return String(value).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'reise';
}

function switchTo(id) {
  if (!store.items.some((item) => item.id === id)) return;
  store.active = id;
  persistStore();
  open = false;
  hooks.load(activeItem().data);
  renderTrips();
}

function addItem(item) {
  if (store.items.length >= MAX_TRIPS) {
    toast(t('trips.tooMany', { n: MAX_TRIPS }), { type: 'error' });
    return false;
  }
  store.items.push(item);
  switchTo(item.id);
  return true;
}

function newTrip() {
  addItem({ id: newId(), name: null, updated: Date.now(), data: {} });
}

function duplicateTrip() {
  const item = activeItem();
  if (addItem({ id: newId(), name: t('trips.copyName', { name: displayName(item) }).slice(0, 60), updated: Date.now(), data: JSON.parse(JSON.stringify(item.data)) })) {
    toast(t('trips.duplicated'));
  }
}

function deleteTrip() {
  const item = activeItem();
  const index = store.items.indexOf(item);
  store.items.splice(index, 1);
  if (!store.items.length) store.items.push({ id: newId(), name: null, updated: Date.now(), data: {} });
  switchTo(store.items[Math.max(0, index - 1)].id);
  toast(t('trips.deleted', { name: displayName(item) }), {
    duration: 6000,
    action: {
      label: t('favorites.undo'),
      onClick: () => {
        if (store.items.some((entry) => entry.id === item.id)) return;
        const current = activeItem();
        if (store.items.length === 1 && !placeNames(current.data).length && !current.name) store.items = [];
        store.items.splice(Math.min(index, store.items.length), 0, item);
        switchTo(item.id);
      }
    }
  });
}

function renameTrip(value) {
  const item = activeItem();
  const name = cleanName(value);
  if (name === item.name) return;
  item.name = name;
  persistStore();
  renderTrips();
  if (hooks.onRename) hooks.onRename();
}

async function exportTrip() {
  const item = activeItem();
  const name = displayName(item);
  const payload = { app: 'viaro', format: FORMAT, exported: new Date().toISOString(), trip: { name, data: item.data }, ...hooks.extras() };
  const text = JSON.stringify(payload, null, 2);
  const filename = `viaro-${slug(name)}.json`;
  let file = null;
  try {
    file = new File([text], filename, { type: 'application/json' });
  } catch {
    file = null;
  }
  if (file && navigator.canShare && navigator.share && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      return;
    } catch (error) {
      if (error && error.name === 'AbortError') return;
    }
  }
  downloadFile(filename, text, 'application/json');
  toast(t('trips.exported'));
}

function importError() {
  toast(t('trips.importInvalid'), { type: 'error', duration: 6000 });
}

export async function importFile(file) {
  if (!file) return;
  if (file.size > MAX_FILE) {
    importError();
    return;
  }
  let payload = null;
  try {
    payload = JSON.parse(await file.text());
  } catch {
    importError();
    return;
  }
  if (!payload || payload.app !== 'viaro' || !payload.trip || !payload.trip.data || typeof payload.trip.data !== 'object') {
    importError();
    return;
  }
  const data = hooks.validate(payload.trip.data);
  if (!data) {
    importError();
    return;
  }
  const item = { id: newId(), name: cleanName(payload.trip.name), updated: Date.now(), data };
  if (!addItem(item)) return;
  const added = payload.favorites && typeof payload.favorites === 'object' ? hooks.mergeFavorites(payload.favorites) : 0;
  const message = [t('trips.imported', { name: displayName(item) }), added ? tCount('trips.favoritesAdded', added) : null].filter(Boolean).join(' ');
  if (payload.settings && typeof payload.settings === 'object' && hooks.settingsDiffer(payload.settings)) {
    toast(message, { duration: 10000, action: { label: t('trips.applySettings'), onClick: () => hooks.applySettings(payload.settings) } });
  } else {
    toast(message, { duration: 5000 });
  }
}

function actionButton(iconName, label, onClick, extra = '') {
  return el('button', { type: 'button', class: `trips__action${extra}`, onclick: onClick }, icon(iconName), el('span', { text: label }));
}

function renderMenu() {
  const item = activeItem();
  const input = el('input', {
    class: 'trips__name',
    type: 'text',
    value: item.name || '',
    placeholder: autoName(item.data),
    maxlength: '60',
    enterkeyhint: 'done',
    'aria-label': t('trips.name')
  });
  input.addEventListener('change', () => renameTrip(input.value));
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') input.blur();
  });
  const others = store.items.length > 1 ? el('ul', { class: 'trips__list' }, store.items.map((entry) => el('li', {},
    el('button', {
      type: 'button',
      class: 'trips__item',
      'aria-current': entry.id === item.id ? 'true' : null,
      onclick: () => switchTo(entry.id)
    },
    el('span', { class: 'trips__item-text' },
      el('span', { class: 'trips__item-name', text: displayName(entry) }),
      el('span', { class: 'trips__item-meta', text: tripMeta(entry.data) })),
    entry.id === item.id ? icon('check') : null)))) : null;
  return el('div', { class: 'trips__menu', id: 'trips-menu' },
    el('label', { class: 'planner-label', text: t('trips.name') }),
    input,
    others,
    el('div', { class: 'trips__actions' },
      actionButton('plus', t('trips.new'), newTrip),
      actionButton('copy', t('trips.duplicate'), duplicateTrip),
      actionButton('share', t('trips.export'), exportTrip),
      actionButton('download', t('trips.import'), () => fileInput.click()),
      actionButton('trash', t('trips.delete'), deleteTrip, ' trips__action--danger')));
}

export function renderTrips() {
  if (!root) return;
  const active = document.activeElement;
  if (active && root.contains(active) && active.classList.contains('trips__name')) return;
  const item = activeItem();
  const toggle = el('button', {
    type: 'button',
    class: 'trips__current',
    'aria-expanded': String(open),
    'aria-controls': 'trips-menu',
    onclick: () => {
      open = !open;
      renderTrips();
      const next = root.querySelector('.trips__current');
      if (next) next.focus({ preventScroll: true });
    }
  },
  el('span', { class: 'trips__icon', 'aria-hidden': 'true' }, icon('suitcase')),
  el('span', { class: 'trips__text' },
    el('span', { class: 'trips__title', text: displayName(item) }),
    el('span', { class: 'trips__meta', text: store.items.length > 1 ? tCount('trips.count', store.items.length) : t('trips.manage') })),
  icon('chevron'));
  root.replaceChildren(...[toggle, open ? renderMenu() : null, fileInput].filter(Boolean));
}

export function initTrips(container, opts) {
  root = container;
  hooks = opts;
  fileInput = el('input', { type: 'file', accept: 'application/json,.json', hidden: true, 'aria-hidden': 'true', tabindex: '-1' });
  fileInput.addEventListener('change', () => {
    const [file] = fileInput.files || [];
    fileInput.value = '';
    importFile(file);
  });
  if (opts.dropTarget) {
    opts.dropTarget.addEventListener('dragover', (event) => {
      if (event.dataTransfer && [...event.dataTransfer.types].includes('Files')) event.preventDefault();
    });
    opts.dropTarget.addEventListener('drop', (event) => {
      const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
      if (!file) return;
      event.preventDefault();
      importFile(file);
    });
  }
  renderTrips();
}
