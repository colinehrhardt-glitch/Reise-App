import { t, getLanguage, formatDistance } from './i18n.js';
import { load, save } from './storage.js';
import { reverseGeocode } from './api.js';
import { fetchSummary, fetchForecast, fetchClimate, fetchCountry, fetchRates, fetchPlaceAdvisories, fetchEmergency, fetchGuide, fetchSights, countryName, SIGHT_TYPES } from './info.js';
import { el, icon, distance, errorMessage, formatNumber, gallery } from './ui.js';

const CARDS = ['summary', 'weather', 'sights', 'country', 'safety', 'tips'];
const CARD_ICONS = { summary: 'info', weather: 'w-partly', sights: 'sights', country: 'flag', safety: 'shield', tips: 'book' };
const TIP_KEYS = ['around', 'eat', 'drink', 'respect', 'health'];
const TIP_ICONS = { around: 'bus', eat: 'food', drink: 'w-moon', respect: 'info', health: 'health' };
const SIGHT_PAGE = 20;
const FORECAST_DAYS = 7;

const state = {
  place: sanitizePlace(load('discoverPlace', null)),
  open: sanitizeOpen(load('discoverOpen', null)),
  results: new Map(),
  sightFilter: 'all',
  sightLimit: SIGHT_PAGE,
  allDays: false,
  tipTab: null,
  resolving: null
};
let options = {};
let root = null;

function sanitizePlace(raw) {
  if (!raw || typeof raw.name !== 'string' || !Number.isFinite(raw.lat) || !Number.isFinite(raw.lon)) return null;
  const bounds = raw.bounds && ['south', 'north', 'west', 'east'].every((key) => Number.isFinite(raw.bounds[key])) ? raw.bounds : null;
  return {
    name: raw.name.slice(0, 120),
    detail: typeof raw.detail === 'string' ? raw.detail.slice(0, 200) : '',
    lat: raw.lat,
    lon: raw.lon,
    country: typeof raw.country === 'string' && /^[a-z]{2}$/.test(raw.country) ? raw.country : null,
    wikidata: typeof raw.wikidata === 'string' && /^Q\d+$/.test(raw.wikidata) ? raw.wikidata : null,
    bounds,
    stopId: typeof raw.stopId === 'string' ? raw.stopId.slice(0, 40) : null,
    source: ['search', 'stop', 'center'].includes(raw.source) ? raw.source : 'search'
  };
}

function sanitizeOpen(raw) {
  const open = { summary: true, weather: true, sights: true, country: false, safety: false, tips: false };
  if (raw && typeof raw === 'object') for (const card of CARDS) if (typeof raw[card] === 'boolean') open[card] = raw[card];
  return open;
}

function placeKey(place) {
  return `${place.lat.toFixed(3)},${place.lon.toFixed(3)}`;
}

function flag(code) {
  if (!code || !/^[a-z]{2}$/.test(code)) return '';
  return String.fromCodePoint(...code.toUpperCase().split('').map((char) => 0x1f1e6 + char.charCodeAt(0) - 65));
}

function countryLabel(country) {
  if (!country) return '';
  return country.names[getLanguage()] || country.names.en || '';
}

function resultFor(card) {
  if (!state.place) return null;
  return state.results.get(`${card}|${getLanguage()}|${placeKey(state.place)}`) || null;
}

function setResult(card, place, lang, value) {
  state.results.set(`${card}|${lang}|${placeKey(place)}`, value);
}

function current(place, lang) {
  return state.place === place && getLanguage() === lang;
}

export function discoverTitle() {
  return state.place ? t('discover.titleIn', { place: state.place.name }) : t('discover.title');
}

export function discoverSubtitle() {
  const data = state.place && state.place.country ? resultValue('country') : null;
  return data && data.country ? `${flag(state.place.country)} ${countryLabel(data.country)}` : '';
}

function resultValue(card) {
  const result = resultFor(card);
  return result && result.status === 'ok' ? result.data : null;
}

export function setDiscoverPlace(raw, { silent = false } = {}) {
  const place = sanitizePlace(raw);
  if (!place) return;
  if (state.place && placeKey(state.place) === placeKey(place) && state.place.name === place.name) {
    state.place = { ...state.place, ...Object.fromEntries(Object.entries(place).filter(([, value]) => value)) };
  } else {
    state.place = place;
    state.sightFilter = 'all';
    state.sightLimit = SIGHT_PAGE;
    state.allDays = false;
    if (options.onSights) options.onSights([]);
  }
  save('discoverPlace', state.place);
  if (!silent) renderDiscover();
}

export function currentStopId() {
  return state.place && state.place.source === 'stop' ? state.place.stopId : null;
}

export function hasDiscoverPlace() {
  return Boolean(state.place);
}

function stopDates(place) {
  if (!place || !place.stopId || !options.getStops) return null;
  const stop = options.getStops().find((item) => item.id === place.stopId);
  return stop && stop.dates ? stop.dates : null;
}

async function resolvePlace(place) {
  if (place.country && place.wikidata) return place;
  if (state.resolving && state.resolving.place === place) return state.resolving.promise;
  const promise = reverseGeocode(place.lat, place.lon, getLanguage()).then((info) => {
    const merged = { ...place, country: place.country || info.country, detail: place.detail || info.region || '', wikidata: place.wikidata || (place.source !== 'search' ? info.wikidata : null) };
    if (state.place === place) {
      state.place = merged;
      save('discoverPlace', merged);
    }
    return merged;
  }).catch(() => place);
  state.resolving = { place, promise };
  return promise;
}

const LOADERS = {
  summary: async (place, lang) => fetchSummary({ ...place, countryName: countryName(place.country, lang) }, lang),
  weather: async (place) => fetchForecast(place.lat, place.lon),
  country: async (place, lang) => {
    if (!place.country) return null;
    const [country, rates] = await Promise.all([fetchCountry(place.country, lang), fetchRates().catch(() => null)]);
    return { country, rates };
  },
  safety: async (place, lang) => {
    const [advisories, emergency, guide] = await Promise.all([
      place.country ? fetchPlaceAdvisories(place).catch(() => ({ scope: 'none', items: [] })) : { scope: 'none', items: [] },
      place.country ? fetchEmergency(place.country).catch(() => null) : null,
      fetchGuide(place, lang).catch(() => null)
    ]);
    return { advisories, emergency, guide, country: place.country };
  },
  tips: async (place, lang) => fetchGuide(place, lang),
  sights: async (place, lang, initial) => fetchSights(place, lang, sightRadius(place), {
    onPartial: (items) => {
      if (!state.place || placeKey(state.place) !== placeKey(initial) || getLanguage() !== lang) return;
      const existing = resultFor('sights');
      if (existing && existing.status === 'ok' && !existing.partial) return;
      setResult('sights', initial, lang, { status: 'ok', data: items, partial: true });
      renderCard('sights');
      renderCard('summary');
      if (options.onSights) options.onSights(items);
    }
  })
};

function sightRadius(place) {
  if (!place.bounds) return 8000;
  const diagonal = distance({ lat: place.bounds.south, lon: place.bounds.west }, { lat: place.bounds.north, lon: place.bounds.east });
  return Math.min(15000, Math.max(3000, diagonal / 2));
}

async function loadCard(card, force = false) {
  const initial = state.place;
  const lang = getLanguage();
  if (!initial) return;
  const existing = resultFor(card);
  if (existing && !force && existing.status !== 'error') return;
  setResult(card, initial, lang, { status: 'loading' });
  renderCard(card);
  try {
    const place = await resolvePlace(initial);
    const data = await LOADERS[card](place, lang, initial);
    setResult(card, initial, lang, { status: 'ok', data });
    if (state.place && placeKey(state.place) === placeKey(initial)) {
      if (card === 'sights' && options.onSights) options.onSights(data || []);
      if (card === 'country' && options.onHeader) options.onHeader();
    }
  } catch (error) {
    setResult(card, initial, lang, { status: 'error', error });
  }
  if (state.place && placeKey(state.place) === placeKey(initial) && getLanguage() === lang) {
    renderCard(card);
    if (card === 'weather') renderCard('country');
    if (card === 'weather' || card === 'country' || card === 'sights') renderCard('summary');
  }
}

export function activateDiscover() {
  if (!state.place || !options.isActive || !options.isActive()) return;
  for (const card of CARDS) if (state.open[card]) loadCard(card);
  if (!state.open.sights) loadCard('sights');
  if (!state.open.country && state.place.country) loadCard('country');
  const sights = resultValue('sights');
  if (sights && options.onSights) options.onSights(sights);
}

function cardBody(card) {
  const result = resultFor(card);
  if (!result || result.status === 'loading') {
    return el('p', { class: 'discover__loading' }, el('span', { class: 'spinner' }), el('span', { text: t('discover.loading') }));
  }
  if (result.status === 'error') {
    return el('div', { class: 'discover__error' },
      el('p', { text: errorMessage(result.error) }),
      el('button', { type: 'button', class: 'btn btn--secondary btn--small', onclick: () => loadCard(card, true) }, el('span', { text: t('common.retry') })));
  }
  return RENDERERS[card](result.data);
}

function renderCard(card) {
  if (!root) return;
  const node = root.querySelector(`[data-card="${card}"]`);
  if (!node) return;
  const body = node.querySelector('.discover-card__body');
  if (body) body.replaceChildren(cardBody(card));
}

function cardNode(card) {
  const open = state.open[card];
  const header = el('button', {
    type: 'button',
    class: 'discover-card__head',
    'aria-expanded': String(open),
    onclick: () => {
      state.open[card] = !state.open[card];
      save('discoverOpen', state.open);
      renderDiscover();
      if (state.open[card]) loadCard(card);
    }
  },
  el('span', { class: 'discover-card__icon', 'aria-hidden': 'true' }, icon(CARD_ICONS[card])),
  el('span', { class: 'discover-card__title', text: card === 'safety' || card === 'tips' ? t(`discover.${card}In`, { place: state.place.name }) : t(`discover.${card}`) }),
  icon('chevron'));
  return el('section', { class: `discover-card${open ? ' is-open' : ''}`, 'data-card': card },
    header,
    open ? el('div', { class: 'discover-card__body' }, cardBody(card)) : null);
}

function empty(text) {
  return el('p', { class: 'discover__empty', text });
}

function glanceItems() {
  const items = [];
  const weather = resultValue('weather');
  if (weather && weather.current && Number.isFinite(weather.current.temp)) {
    const info = weatherInfo(weather.current.code, weather.current.day);
    items.push([info.icon, `${temp(weather.current.temp)} · ${info.label}`]);
  }
  if (weather && weather.timezone) {
    const time = localTime(weather.timezone);
    if (time) items.push(['clock', time]);
  }
  const data = resultValue('country');
  if (data && data.country) {
    const main = data.country.currencies[0];
    const rate = main && data.rates && data.rates.rates ? data.rates.rates[main.code] : null;
    if (main && main.code !== 'EUR' && rate) items.push(['money', `1 € = ${money(rate, main.code)}`]);
    if (data.country.languages[0]) items.push(['globe', languageName(data.country.languages[0].code, data.country.languages[0].name)]);
  }
  return items;
}

function cityImages(data) {
  const images = [];
  const seen = new Set();
  const add = (image) => {
    if (!image || !image.src) return;
    const key = image.src.split('?')[0];
    if (seen.has(key)) return;
    seen.add(key);
    images.push(image);
  };
  if (data && data.images && data.images[0]) add({ ...data.images[0], label: state.place.name });
  const sights = resultValue('sights') || [];
  for (const item of sights) {
    if (images.length >= 10) break;
    if (item.image) add({ src: item.image, label: item.name, link: item.image, credit: 'Wikimedia Commons' });
  }
  if (images.length < 3 && data && data.images) data.images.slice(1).forEach((image) => images.length < 6 && add(image));
  return images;
}

function renderSummary(data) {
  const glance = glanceItems();
  const chips = glance.length ? el('ul', { class: 'glance' }, glance.map(([name, text]) => el('li', { class: 'glance__item' }, icon(name), el('span', { text })))) : null;
  const images = cityImages(data);
  if (!data) return el('div', { class: 'summary' }, images.length ? gallery(images) : null, chips, empty(t('discover.noSummary')));
  return el('div', { class: 'summary' },
    images.length ? gallery(images) : null,
    el('p', { class: 'summary__text', text: data.text }),
    chips);
}

const WEATHER_GROUPS = [
  [[0], 'clear', 'w-sun'],
  [[1, 2], 'partly', 'w-partly'],
  [[3], 'cloudy', 'w-cloud'],
  [[45, 48], 'fog', 'w-fog'],
  [[51, 53, 55, 56, 57], 'drizzle', 'w-rain'],
  [[61, 63, 65, 66, 67], 'rain', 'w-rain'],
  [[71, 73, 75, 77, 85, 86], 'snow', 'w-snow'],
  [[80, 81, 82], 'showers', 'w-rain'],
  [[95, 96, 99], 'storm', 'w-storm']
];

function weatherInfo(code, day = true) {
  const group = WEATHER_GROUPS.find(([codes]) => codes.includes(code));
  if (!group) return { label: t('weather.unknown'), icon: 'w-cloud' };
  return { label: t(`weather.${group[1]}`), icon: group[2] === 'w-sun' && !day ? 'w-moon' : group[2] };
}

function temp(value) {
  return Number.isFinite(value) ? `${Math.round(value)}°` : '–';
}

function dayLabel(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Intl.DateTimeFormat(getLanguage(), { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, d)));
}

function localTime(timezone) {
  try {
    return new Intl.DateTimeFormat(getLanguage(), { hour: '2-digit', minute: '2-digit', timeZone: timezone }).format(new Date());
  } catch {
    return null;
  }
}

function climateBlock(dates, forecast) {
  if (!dates) return null;
  const last = forecast.days.length ? forecast.days[forecast.days.length - 1].date : null;
  if (last && dates.from <= last) return null;
  const to = dates.to > dates.from ? dates.to : dates.from;
  const key = `climate|${dates.from}|${to}`;
  const holder = el('div', { class: 'climate' }, el('p', { class: 'discover__loading' }, el('span', { class: 'spinner' }), el('span', { text: t('discover.loading') })));
  const place = state.place;
  const cached = state.results.get(`${key}|${placeKey(place)}`);
  const fill = (value) => {
    if (!value || value.status === 'error') {
      holder.replaceChildren(empty(t('weather.climateFailed')));
      return;
    }
    const data = value.data;
    holder.replaceChildren(
      el('p', { class: 'climate__title', text: t('weather.climateTitle', { range: rangeLabel(dates.from, to) }) }),
      el('div', { class: 'climate__values' },
        el('span', { class: 'climate__temp', text: `${temp(data.max)} / ${temp(data.min)}` }),
        data.rain !== null ? el('span', { text: t('weather.climateRain', { mm: formatNumber(Math.round(data.rain * 10) / 10), share: Math.round(data.rainyShare * 100) }) }) : null),
      null);
  };
  if (cached) fill(cached);
  else {
    fetchClimate(place.lat, place.lon, dates.from, clampRange(dates.from, to))
      .then((data) => ({ status: 'ok', data }), (error) => ({ status: 'error', error }))
      .then((value) => {
        state.results.set(`${key}|${placeKey(place)}`, value);
        fill(value);
      });
  }
  return holder;
}

function clampRange(from, to) {
  const start = Date.parse(`${from}T12:00:00Z`);
  const end = Math.min(Date.parse(`${to}T12:00:00Z`), start + 20 * 86400000);
  return new Date(end).toISOString().slice(0, 10);
}

function rangeLabel(from, to) {
  const toDate = (iso) => {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d));
  };
  const format = new Intl.DateTimeFormat(getLanguage(), { day: 'numeric', month: 'short', timeZone: 'UTC' });
  if (from === to) return format.format(toDate(from));
  return typeof format.formatRange === 'function' ? format.formatRange(toDate(from), toDate(to)) : `${format.format(toDate(from))} – ${format.format(toDate(to))}`;
}

function renderWeather(data) {
  if (!data || !data.days.length) return empty(t('weather.none'));
  const now = data.current;
  const info = weatherInfo(now.code, now.day);
  const dates = stopDates(state.place);
  const today = data.days[0];
  const inStay = (date) => dates && date >= dates.from && date <= dates.to;
  const days = state.allDays ? data.days : data.days.slice(0, FORECAST_DAYS);
  const time = data.timezone ? localTime(data.timezone) : null;
  return el('div', { class: 'weather' },
    el('div', { class: 'weather__now' },
      el('span', { class: 'weather__icon' }, icon(info.icon)),
      el('span', { class: 'weather__temp', text: temp(now.temp) }),
      el('span', { class: 'weather__text' },
        el('span', { class: 'weather__label', text: info.label }),
        el('span', { class: 'weather__meta', text: [t('weather.feels', { temp: temp(now.feels) }), Number.isFinite(now.humidity) ? t('weather.humidity', { value: Math.round(now.humidity) }) : null, Number.isFinite(now.wind) ? t('weather.wind', { value: Math.round(now.wind) }) : null].filter(Boolean).join(' · ') }))),
    el('p', { class: 'weather__sun', text: [time ? t('weather.localTime', { time }) : null, today.sunrise ? t('weather.sunrise', { time: today.sunrise.slice(11, 16) }) : null, today.sunset ? t('weather.sunset', { time: today.sunset.slice(11, 16) }) : null, Number.isFinite(today.uv) ? t('weather.uv', { value: Math.round(today.uv) }) : null].filter(Boolean).join(' · ') }),
    el('ul', { class: 'forecast' }, days.map((day, index) => {
      const dayInfo = weatherInfo(day.code);
      return el('li', { class: `forecast__day${inStay(day.date) ? ' is-stay' : ''}` },
        el('span', { class: 'forecast__date', text: index === 0 ? t('weather.today') : dayLabel(day.date) }),
        el('span', { class: 'forecast__icon', title: dayInfo.label }, icon(dayInfo.icon)),
        el('span', { class: 'forecast__rain', text: Number.isFinite(day.rainChance) ? `${day.rainChance} %` : '' }),
        el('span', { class: 'forecast__temp' }, el('strong', { text: temp(day.max) }), el('span', { text: temp(day.min) })));
    })),
    data.days.length > FORECAST_DAYS ? el('button', {
      type: 'button',
      class: 'link-btn',
      text: state.allDays ? t('weather.lessDays') : t('weather.moreDays', { n: data.days.length }),
      onclick: () => {
        state.allDays = !state.allDays;
        renderCard('weather');
      }
    }) : null,
    climateBlock(dates, data));
}

function infoRow(label, value) {
  if (!value) return null;
  return el('div', { class: 'facts-table__row' }, el('dt', { text: label }), el('dd', { text: value }));
}

function languageName(code, fallback) {
  try {
    const name = new Intl.DisplayNames(getLanguage(), { type: 'language' }).of(code);
    return name && name !== code ? name : fallback;
  } catch {
    return fallback;
  }
}

function currencyName(code, fallback) {
  try {
    const name = new Intl.DisplayNames(getLanguage(), { type: 'currency' }).of(code);
    return name && name !== code ? name : fallback;
  } catch {
    return fallback;
  }
}

function money(value, currency) {
  try {
    return new Intl.NumberFormat(getLanguage(), { style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: value >= 100 ? 0 : 2 }).format(value);
  } catch {
    return `${formatNumber(Math.round(value))} ${currency}`;
  }
}

function niceAmount(rate) {
  const target = 10 * rate;
  const power = 10 ** Math.floor(Math.log10(Math.max(1, target)));
  return Math.max(1, Math.round(target / power) * power);
}

function rateBlock(currencies, rates) {
  const main = currencies[0];
  if (!main) return null;
  if (main.code === 'EUR') return el('p', { class: 'discover__note', text: t('country.euro') });
  const rate = rates && rates.rates ? rates.rates[main.code] : null;
  if (!rate) return el('p', { class: 'discover__note', text: t('country.noRate') });
  const amounts = [10, 50, 100];
  const local = niceAmount(rate);
  return el('div', { class: 'rates' },
    el('p', { class: 'rates__main', text: `1 € = ${money(rate, main.code)}` }),
    el('ul', { class: 'rates__list' },
      amounts.map((amount) => el('li', { text: `${money(amount, 'EUR')} ≈ ${money(amount * rate, main.code)}` })),
      el('li', { text: `${money(local, main.code)} ≈ ${money(local / rate, 'EUR')}` })),
    null);
}

function renderCountry(data) {
  if (!data || !data.country) return empty(t('country.none'));
  const { country, rates } = data;
  const weather = resultValue('weather');
  const time = weather && weather.timezone ? localTime(weather.timezone) : null;
  const currencies = country.currencies.map((item) => `${currencyName(item.code, item.name)} (${item.code}${item.symbol ? `, ${item.symbol}` : ''})`).join(', ');
  return el('div', { class: 'country' },
    el('p', { class: 'country__name' }, el('span', { class: 'country__flag', 'aria-hidden': 'true', text: flag(country.code) }), el('span', { text: countryLabel(country) })),
    el('dl', { class: 'facts-table' },
      infoRow(t('country.capital'), country.capital),
      infoRow(t('country.population'), country.population ? new Intl.NumberFormat(getLanguage(), { notation: 'compact', maximumFractionDigits: 1 }).format(country.population) : null),
      infoRow(t('country.languages'), country.languages.map((item) => languageName(item.code, item.name)).join(', ')),
      infoRow(t('country.currency'), currencies),
      infoRow(t('country.calling'), country.calling),
      infoRow(t('country.time'), time ? `${time} (${weather.timezone.replace(/_/g, ' ')})` : country.timezones.join(', ')),
      infoRow(t('country.driving'), t(country.side === 'left' ? 'country.left' : 'country.right'))),
    rateBlock(country.currencies, rates));
}

const LEVEL_KEYS = ['', 'low', 'medium', 'high', 'severe'];

function levelDots(level) {
  return el('span', { class: `level-dots level-dots--${LEVEL_KEYS[level]}`, 'aria-hidden': 'true' }, [1, 2, 3, 4].map((step) => el('span', { class: step <= level ? 'is-on' : null })));
}

function safetyGauge(advisories, scope) {
  const average = advisories.reduce((sum, item) => sum + item.level, 0) / advisories.length;
  const level = Math.min(4, Math.max(1, Math.round(average)));
  const position = ((average - 1) / 3) * 100;
  return el('div', { class: `gauge gauge--${LEVEL_KEYS[level]}` },
    el('div', { class: 'gauge__head' },
      el('span', { class: 'gauge__label', text: t(`safety.overall.${LEVEL_KEYS[level]}`) }),
      el('span', { class: 'gauge__value', text: t('safety.scale', { value: formatNumber(Math.round(average * 10) / 10) }) })),
    el('p', { class: 'gauge__scope', text: scope === 'place' ? t('safety.forPlace', { place: state.place.name }) : t('safety.forCountry', { country: countryName(state.place.country, getLanguage()) || '' }) }),
    el('div', { class: 'gauge__bar', role: 'img', 'aria-label': t(`safety.overall.${LEVEL_KEYS[level]}`) },
      [1, 2, 3, 4].map((step) => el('span', { class: `gauge__segment gauge__segment--${LEVEL_KEYS[step]}` })),
      el('span', { class: 'gauge__marker', style: `left:${position}%` })),
    el('div', { class: 'gauge__ticks', 'aria-hidden': 'true' }, [1, 2, 3, 4].map((step) => el('span', { text: t(`safety.tick.${LEVEL_KEYS[step]}`) }))));
}

function advisoryRow(item) {
  return el('li', { class: 'advisory' },
    el('span', { class: 'advisory__source', text: t(`safety.source.${item.id}`) }),
    levelDots(item.level),
    el('a', { class: 'advisory__text', href: item.url, target: '_blank', rel: 'noopener noreferrer', text: item.match ? t(item.city ? `safety.areaText.${item.level}` : 'safety.regionText') : item.known && item.level < item.countryLevel ? t('safety.notListed') : t(`safety.levelText.${item.id}.${item.level}`) }));
}

function pointList(points, className = 'points') {
  return el('ul', { class: className }, points.map((point) => el('li', {
    text: typeof point === 'string' ? point : t('tips.recommended', { names: point.names.join(', ') })
  })));
}

function capitalize(value) {
  return value ? value.replace(/(^|\s)\S/g, (char) => char.toUpperCase()) : value;
}

function renderSafety(data) {
  if (!data) return empty(t('safety.none'));
  const section = data.guide && data.guide.sections.safety;
  const advice = data.advisories || { items: [] };
  const items = advice.items || [];
  const points = [];
  if (advice.match) points.push(t(advice.cityMatch ? 'safety.pointListed' : 'safety.pointRegion', { region: capitalize(advice.match) }));
  else if (advice.scope === 'place' && advice.partial) points.push(t('safety.pointNotListed', { place: state.place.name }));
  if (section) points.push(...section.points);
  return el('div', { class: 'safety' },
    items.length ? safetyGauge(items, advice.scope) : null,
    items.length ? el('ul', { class: 'advisories' }, items.map(advisoryRow)) : el('p', { class: 'discover__note', text: t('safety.adviceUnavailable') }),
    data.emergency && data.emergency.length ? el('div', { class: 'emergency' },
      icon('phone'),
      el('span', { class: 'emergency__label', text: t('safety.emergency') }),
      data.emergency.map((number) => el('a', { class: 'emergency__number', href: `tel:${number.replace(/[^\d+]/g, '')}`, text: number }))) : null,
    points.length ? el('p', { class: 'discover__subtitle', text: t('safety.inShort') }) : null,
    points.length ? pointList(points) : null);
}

function renderTips(data) {
  const sections = data ? TIP_KEYS.filter((key) => data.sections[key]) : [];
  if (!sections.length) return empty(t('tips.none'));
  const active = sections.includes(state.tipTab) ? state.tipTab : sections[0];
  return el('div', { class: 'tips' },
    el('div', { class: 'tips__tabs', role: 'tablist', 'aria-label': t('discover.tips') }, sections.map((key) => el('button', {
      type: 'button',
      class: 'tips__tab',
      role: 'tab',
      'aria-selected': String(key === active),
      onclick: () => {
        state.tipTab = key;
        renderCard('tips');
      }
    }, icon(TIP_ICONS[key]), el('span', { text: t(`tips.${key}`) })))),
    el('div', { class: 'tips__panel', role: 'tabpanel' }, pointList(data.sections[active].points)));
}

function sightRow(item, index) {
  const target = options.sightTarget ? options.sightTarget(item) : null;
  const saved = target ? options.sightSaved(target.id, item.id) : false;
  const thumb = item.image
    ? el('img', { class: 'sight__thumb', src: item.image, alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' })
    : el('span', { class: 'sight__thumb sight__thumb--icon', 'aria-hidden': 'true' }, icon(`sight-${item.type}`));
  if (item.image) thumb.addEventListener('error', () => thumb.replaceWith(el('span', { class: 'sight__thumb sight__thumb--icon', 'aria-hidden': 'true' }, icon(`sight-${item.type}`))));
  return el('li', { class: 'sight' },
    el('button', { type: 'button', class: 'sight__main', onclick: () => options.onShowSight && options.onShowSight(item) },
      thumb,
      el('span', { class: 'sight__text' },
        el('span', { class: 'sight__name' }, el('span', { text: item.name })),
        el('span', { class: 'sight__meta' },
          index < 3 && item.popularity > 5 ? el('span', { class: 'badge', text: t('sights.top') }) : null,
          el('span', { text: [t(`sights.type.${item.type}`), formatDistance(distance(state.place, item))].join(' · ') })))),
    target ? el('button', {
      type: 'button',
      class: `icon-btn sight__save${saved ? ' is-saved' : ''}`,
      'aria-pressed': String(saved),
      'aria-label': t(saved ? 'sights.savedFor' : 'sights.saveFor', { place: target.name }),
      title: t(saved ? 'sights.savedFor' : 'sights.saveFor', { place: target.name }),
      onclick: () => {
        options.toggleSight(target.id, item);
        renderCard('sights');
      }
    }, icon(saved ? 'check' : 'plus')) : null);
}

function renderSights(items) {
  if (!items || !items.length) return empty(t('sights.none'));
  const types = SIGHT_TYPES.filter((type) => items.some((item) => item.type === type));
  const visible = state.sightFilter === 'all' ? items : items.filter((item) => item.type === state.sightFilter);
  const shown = visible.slice(0, state.sightLimit);
  const chip = (value, label, count) => el('button', {
    type: 'button',
    class: 'chip',
    'aria-pressed': String(state.sightFilter === value),
    onclick: () => {
      state.sightFilter = value;
      state.sightLimit = SIGHT_PAGE;
      renderCard('sights');
    }
  }, el('span', { text: label }), el('span', { class: 'chip__count', text: formatNumber(count) }));
  const target = options.sightTarget && items[0] ? options.sightTarget(items[0]) : null;
  return el('div', { class: 'sights' },
    types.length > 1 ? el('div', { class: 'sights__filters' }, chip('all', t('filter.all'), items.length), types.map((type) => chip(type, t(`sights.type.${type}`), items.filter((item) => item.type === type).length))) : null,

    el('ul', { class: 'sight-list' }, shown.map(sightRow)),
    visible.length > shown.length ? el('button', {
      type: 'button',
      class: 'btn btn--secondary btn--small sights__more',
      onclick: () => {
        state.sightLimit += SIGHT_PAGE;
        renderCard('sights');
      }
    }, el('span', { text: t('sights.more', { n: visible.length - shown.length }) })) : null,
    resultFor('sights') && resultFor('sights').partial ? el('p', { class: 'discover__loading discover__loading--inline' }, el('span', { class: 'spinner' }), el('span', { text: t('sights.loadingMore') })) : null,
    null);
}

const RENDERERS = { summary: renderSummary, weather: renderWeather, country: renderCountry, safety: renderSafety, tips: renderTips, sights: renderSights };

function placeChips() {
  const stops = options.getStops ? options.getStops() : [];
  const chips = [];
  const active = state.place;
  const chip = (label, place, isActive, iconName) => el('button', {
    type: 'button',
    class: 'chip',
    'aria-pressed': String(isActive),
    onclick: () => {
      setDiscoverPlace(place);
      activateDiscover();
      if (options.onPlaceChange) options.onPlaceChange(state.place);
    }
  }, iconName ? icon(iconName) : null, el('span', { text: label }));
  if (active && active.source !== 'stop') chips.push(chip(active.name, active, true, active.source === 'center' ? 'locate' : 'search'));
  for (const stop of stops) {
    const isActive = Boolean(active && active.source === 'stop' && active.stopId === stop.id);
    chips.push(chip(stop.name, { ...stop, stopId: stop.id, source: 'stop' }, isActive, null));
  }
  chips.push(el('button', {
    type: 'button',
    class: 'chip chip--action',
    onclick: async () => {
      const center = options.getCenter();
      let info = null;
      try {
        info = await reverseGeocode(center.lat, center.lon, getLanguage());
      } catch {
        info = null;
      }
      setDiscoverPlace({ name: (info && info.name) || t('discover.mapCenter'), detail: info && info.region, lat: center.lat, lon: center.lon, country: info && info.country, wikidata: info && info.wikidata, source: 'center' });
      activateDiscover();
      if (options.onPlaceChange) options.onPlaceChange(state.place);
    }
  }, icon('locate'), el('span', { text: t('discover.mapCenter') })));
  return el('div', { class: 'discover__places', role: 'toolbar', 'aria-label': t('discover.places') }, chips);
}

export function renderDiscover() {
  if (!root) return;
  if (!state.place) {
    root.replaceChildren(el('div', { class: 'discover' }, placeChips(), empty(t('discover.empty'))));
    if (options.onHeader) options.onHeader();
    return;
  }
  root.replaceChildren(el('div', { class: 'discover' },
    placeChips(),
    CARDS.map(cardNode)));
  if (options.onHeader) options.onHeader();
}

export function refreshSights() {
  renderCard('sights');
}

export function initDiscover(container, opts) {
  root = container;
  options = opts;
  renderDiscover();
}
