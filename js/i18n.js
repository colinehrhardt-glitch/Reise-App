import { load, save } from './storage.js';

export const LANGUAGES = [
  { code: 'de', label: 'Deutsch' },
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' }
];

const FALLBACK = 'en';

const dictionaries = {
  de: {
    'app.name': 'Viaro',
    'app.tagline': 'Dein Reisebegleiter',
    'map.label': 'Karte',
    'menu.open': 'Menü öffnen',
    'menu.close': 'Menü schließen',
    'search.placeholder': 'Stadt oder Ort suchen',
    'search.submit': 'Suchen',
    'search.clear': 'Eingabe löschen',
    'search.searching': 'Orte werden gesucht …',
    'search.noResults': 'Kein Ort gefunden. Prüfe die Schreibweise oder versuche einen anderen Namen.',
    'search.tooShort': 'Bitte gib mindestens 2 Zeichen ein.',
    'search.resultsLabel': 'Suchergebnisse',
    'area.search': 'In diesem Bereich suchen',
    'area.zoomIn': 'Zum Suchen näher heranzoomen',
    'area.loading': 'Unterkünfte werden geladen …',
    'locate.button': 'Mein Standort',
    'locate.denied': 'Kein Zugriff auf deinen Standort. Du kannst ihn in den Einstellungen deines Geräts erlauben.',
    'locate.unavailable': 'Dein Standort konnte gerade nicht ermittelt werden.',
    'locate.unsupported': 'Dein Gerät unterstützt keine Standortabfrage.',
    'legend.button': 'Legende anzeigen',
    'legend.title': 'Legende',
    'legend.favorite': 'Favorit',
    'types.hotel.one': 'Hotel',
    'types.hotel.many': 'Hotels',
    'types.hostel.one': 'Hostel',
    'types.hostel.many': 'Hostels',
    'types.guest_house.one': 'Gästehaus',
    'types.guest_house.many': 'Gästehäuser',
    'types.apartment.one': 'Apartment',
    'types.apartment.many': 'Apartments',
    'types.motel.one': 'Motel',
    'types.motel.many': 'Motels',
    'filter.all': 'Alle',
    'filter.label': 'Nach Unterkunftsart filtern',
    'results.title': 'Unterkünfte',
    'results.count.one': '{n} Ergebnis',
    'results.count.other': '{n} Ergebnisse',
    'results.initial': 'Tippe auf „In diesem Bereich suchen“, um Unterkünfte im sichtbaren Kartenausschnitt zu finden.',
    'results.none': 'Keine Unterkünfte in diesem Bereich gefunden. Verschiebe die Karte und suche erneut.',
    'results.noneFiltered': 'Für diesen Filter gibt es hier keine Ergebnisse.',
    'results.truncated': 'Sehr viele Treffer – angezeigt werden die ersten {n}. Zoome hinein, um alle zu sehen.',
    'results.listLabel': 'Ergebnisliste',
    'sheet.toggle': 'Ergebnisliste ein- oder ausklappen',
    'place.unnamed': 'Unterkunft ohne Namen',
    'place.stars.one': '{n} Stern',
    'place.stars.other': '{n} Sterne',
    'place.superior': 'Superior',
    'place.route': 'Route in Google Maps öffnen',
    'place.favoriteAdd': 'Zu Favoriten hinzufügen',
    'place.favoriteRemove': 'Aus Favoriten entfernen',
    'place.close': 'Schließen',
    'favorites.title': 'Favoriten',
    'favorites.showOnMap': 'Auf der Karte zeigen',
    'favorites.sort': 'Sortieren nach',
    'favorites.sort.added': 'Zuletzt hinzugefügt',
    'favorites.sort.name': 'Name',
    'favorites.sort.type': 'Unterkunftsart',
    'favorites.sort.distance': 'Entfernung',
    'favorites.empty': 'Noch keine Favoriten. Tippe bei einer Unterkunft auf das Herz, um sie dir zu merken.',
    'favorites.added': 'Zu Favoriten hinzugefügt',
    'favorites.removed': 'Aus Favoriten entfernt',
    'favorites.undo': 'Rückgängig',
    'favorites.storageError': 'Speichern nicht möglich – dein Browser blockiert den lokalen Speicher (z. B. im privaten Modus).',
    'settings.language': 'Sprache',
    'settings.appearance': 'Darstellung',
    'theme.auto': 'Automatisch',
    'theme.light': 'Hell',
    'theme.dark': 'Dunkel',
    'about.title': 'Datenquellen',
    'about.map': 'Kartendaten',
    'about.search': 'Ortssuche',
    'about.places': 'Unterkünfte',
    'about.note': 'Alle Angaben stammen aus OpenStreetMap und können unvollständig sein.',
    'attribution.osm': 'OpenStreetMap-Mitwirkende',
    'errors.offline': 'Keine Internetverbindung. Bitte prüfe dein Netz und versuche es erneut.',
    'errors.network': 'Der Server ist nicht erreichbar. Bitte prüfe deine Verbindung und versuche es erneut.',
    'errors.timeout': 'Der Server antwortet zu langsam. Versuche es gleich noch einmal oder zoome weiter hinein.',
    'errors.busy': 'Der Kartendienst ist gerade ausgelastet. Bitte warte einen Moment und versuche es erneut.',
    'errors.server': 'Beim Laden ist ein Fehler aufgetreten. Bitte versuche es später erneut.',
    'common.retry': 'Erneut versuchen',
    'common.close': 'Schließen'
  },
  en: {
    'app.name': 'Viaro',
    'app.tagline': 'Your travel companion',
    'map.label': 'Map',
    'menu.open': 'Open menu',
    'menu.close': 'Close menu',
    'search.placeholder': 'Search city or place',
    'search.submit': 'Search',
    'search.clear': 'Clear input',
    'search.searching': 'Searching places …',
    'search.noResults': 'No place found. Check the spelling or try a different name.',
    'search.tooShort': 'Please enter at least 2 characters.',
    'search.resultsLabel': 'Search results',
    'area.search': 'Search this area',
    'area.zoomIn': 'Zoom in to search',
    'area.loading': 'Loading places to stay …',
    'locate.button': 'My location',
    'locate.denied': 'No access to your location. You can allow it in your device settings.',
    'locate.unavailable': 'Your location could not be determined right now.',
    'locate.unsupported': 'Your device does not support location services.',
    'legend.button': 'Show legend',
    'legend.title': 'Legend',
    'legend.favorite': 'Favorite',
    'types.hotel.one': 'Hotel',
    'types.hotel.many': 'Hotels',
    'types.hostel.one': 'Hostel',
    'types.hostel.many': 'Hostels',
    'types.guest_house.one': 'Guest house',
    'types.guest_house.many': 'Guest houses',
    'types.apartment.one': 'Apartment',
    'types.apartment.many': 'Apartments',
    'types.motel.one': 'Motel',
    'types.motel.many': 'Motels',
    'filter.all': 'All',
    'filter.label': 'Filter by type of stay',
    'results.title': 'Places to stay',
    'results.count.one': '{n} result',
    'results.count.other': '{n} results',
    'results.initial': 'Tap “Search this area” to find places to stay in the visible part of the map.',
    'results.none': 'No places to stay found in this area. Move the map and search again.',
    'results.noneFiltered': 'No results for this filter here.',
    'results.truncated': 'Lots of results – showing the first {n}. Zoom in to see them all.',
    'results.listLabel': 'Result list',
    'sheet.toggle': 'Expand or collapse the result list',
    'place.unnamed': 'Unnamed place to stay',
    'place.stars.one': '{n} star',
    'place.stars.other': '{n} stars',
    'place.superior': 'Superior',
    'place.route': 'Open route in Google Maps',
    'place.favoriteAdd': 'Add to favorites',
    'place.favoriteRemove': 'Remove from favorites',
    'place.close': 'Close',
    'favorites.title': 'Favorites',
    'favorites.showOnMap': 'Show on map',
    'favorites.sort': 'Sort by',
    'favorites.sort.added': 'Recently added',
    'favorites.sort.name': 'Name',
    'favorites.sort.type': 'Type of stay',
    'favorites.sort.distance': 'Distance',
    'favorites.empty': 'No favorites yet. Tap the heart on a place to stay to save it.',
    'favorites.added': 'Added to favorites',
    'favorites.removed': 'Removed from favorites',
    'favorites.undo': 'Undo',
    'favorites.storageError': 'Saving is not possible – your browser blocks local storage (e.g. in private mode).',
    'settings.language': 'Language',
    'settings.appearance': 'Appearance',
    'theme.auto': 'Automatic',
    'theme.light': 'Light',
    'theme.dark': 'Dark',
    'about.title': 'Data sources',
    'about.map': 'Map data',
    'about.search': 'Place search',
    'about.places': 'Places to stay',
    'about.note': 'All information comes from OpenStreetMap and may be incomplete.',
    'attribution.osm': 'OpenStreetMap contributors',
    'errors.offline': 'No internet connection. Please check your network and try again.',
    'errors.network': 'The server cannot be reached. Please check your connection and try again.',
    'errors.timeout': 'The server is responding too slowly. Try again in a moment or zoom in further.',
    'errors.busy': 'The map service is busy right now. Please wait a moment and try again.',
    'errors.server': 'Something went wrong while loading. Please try again later.',
    'common.retry': 'Try again',
    'common.close': 'Close'
  },
  es: {
    'app.name': 'Viaro',
    'app.tagline': 'Tu compañero de viaje',
    'map.label': 'Mapa',
    'menu.open': 'Abrir menú',
    'menu.close': 'Cerrar menú',
    'search.placeholder': 'Buscar ciudad o lugar',
    'search.submit': 'Buscar',
    'search.clear': 'Borrar texto',
    'search.searching': 'Buscando lugares …',
    'search.noResults': 'No se encontró ningún lugar. Revisa la ortografía o prueba con otro nombre.',
    'search.tooShort': 'Escribe al menos 2 caracteres.',
    'search.resultsLabel': 'Resultados de búsqueda',
    'area.search': 'Buscar en esta zona',
    'area.zoomIn': 'Acerca el mapa para buscar',
    'area.loading': 'Cargando alojamientos …',
    'locate.button': 'Mi ubicación',
    'locate.denied': 'Sin acceso a tu ubicación. Puedes permitirlo en los ajustes de tu dispositivo.',
    'locate.unavailable': 'No se pudo determinar tu ubicación en este momento.',
    'locate.unsupported': 'Tu dispositivo no admite la ubicación.',
    'legend.button': 'Mostrar leyenda',
    'legend.title': 'Leyenda',
    'legend.favorite': 'Favorito',
    'types.hotel.one': 'Hotel',
    'types.hotel.many': 'Hoteles',
    'types.hostel.one': 'Hostel',
    'types.hostel.many': 'Hostels',
    'types.guest_house.one': 'Casa de huéspedes',
    'types.guest_house.many': 'Casas de huéspedes',
    'types.apartment.one': 'Apartamento',
    'types.apartment.many': 'Apartamentos',
    'types.motel.one': 'Motel',
    'types.motel.many': 'Moteles',
    'filter.all': 'Todos',
    'filter.label': 'Filtrar por tipo de alojamiento',
    'results.title': 'Alojamientos',
    'results.count.one': '{n} resultado',
    'results.count.other': '{n} resultados',
    'results.initial': 'Toca «Buscar en esta zona» para encontrar alojamientos en la parte visible del mapa.',
    'results.none': 'No se encontraron alojamientos en esta zona. Mueve el mapa y busca de nuevo.',
    'results.noneFiltered': 'No hay resultados para este filtro aquí.',
    'results.truncated': 'Hay muchísimos resultados: se muestran los primeros {n}. Acerca el mapa para verlos todos.',
    'results.listLabel': 'Lista de resultados',
    'sheet.toggle': 'Desplegar o plegar la lista de resultados',
    'place.unnamed': 'Alojamiento sin nombre',
    'place.stars.one': '{n} estrella',
    'place.stars.other': '{n} estrellas',
    'place.superior': 'Superior',
    'place.route': 'Abrir ruta en Google Maps',
    'place.favoriteAdd': 'Añadir a favoritos',
    'place.favoriteRemove': 'Quitar de favoritos',
    'place.close': 'Cerrar',
    'favorites.title': 'Favoritos',
    'favorites.showOnMap': 'Mostrar en el mapa',
    'favorites.sort': 'Ordenar por',
    'favorites.sort.added': 'Añadidos recientemente',
    'favorites.sort.name': 'Nombre',
    'favorites.sort.type': 'Tipo de alojamiento',
    'favorites.sort.distance': 'Distancia',
    'favorites.empty': 'Aún no tienes favoritos. Toca el corazón de un alojamiento para guardarlo.',
    'favorites.added': 'Añadido a favoritos',
    'favorites.removed': 'Quitado de favoritos',
    'favorites.undo': 'Deshacer',
    'favorites.storageError': 'No se puede guardar: tu navegador bloquea el almacenamiento local (p. ej. en modo privado).',
    'settings.language': 'Idioma',
    'settings.appearance': 'Apariencia',
    'theme.auto': 'Automático',
    'theme.light': 'Claro',
    'theme.dark': 'Oscuro',
    'about.title': 'Fuentes de datos',
    'about.map': 'Datos del mapa',
    'about.search': 'Búsqueda de lugares',
    'about.places': 'Alojamientos',
    'about.note': 'Toda la información procede de OpenStreetMap y puede estar incompleta.',
    'attribution.osm': 'colaboradores de OpenStreetMap',
    'errors.offline': 'Sin conexión a internet. Revisa tu red y vuelve a intentarlo.',
    'errors.network': 'No se puede contactar con el servidor. Revisa tu conexión y vuelve a intentarlo.',
    'errors.timeout': 'El servidor tarda demasiado en responder. Inténtalo de nuevo o acerca más el mapa.',
    'errors.busy': 'El servicio de mapas está saturado ahora mismo. Espera un momento y vuelve a intentarlo.',
    'errors.server': 'Se produjo un error al cargar. Inténtalo de nuevo más tarde.',
    'common.retry': 'Reintentar',
    'common.close': 'Cerrar'
  }
};

const listeners = new Set();
let current = detectLanguage();

function isSupported(code) {
  return Object.prototype.hasOwnProperty.call(dictionaries, code);
}

function detectLanguage() {
  const saved = load('lang', null);
  if (saved && isSupported(saved)) return saved;
  const preferred = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language];
  for (const tag of preferred) {
    const code = String(tag || '').slice(0, 2).toLowerCase();
    if (isSupported(code)) return code;
  }
  return FALLBACK;
}

export function getLanguage() {
  return current;
}

export function setLanguage(code) {
  if (!isSupported(code) || code === current) return;
  current = code;
  save('lang', code);
  applyTranslations();
  listeners.forEach((fn) => fn(code));
}

export function onLanguageChange(fn) {
  listeners.add(fn);
}

export function t(key, params = {}) {
  const text = dictionaries[current][key] ?? dictionaries[FALLBACK][key] ?? key;
  return text.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match));
}

export function tCount(key, n) {
  const rule = new Intl.PluralRules(current).select(n);
  const formatted = new Intl.NumberFormat(current).format(n);
  const specific = `${key}.${rule}`;
  const hasRule = dictionaries[current][specific] !== undefined;
  return t(hasRule ? specific : `${key}.other`, { n: formatted });
}

export function formatDistance(meters) {
  if (!Number.isFinite(meters)) return '';
  if (meters < 1000) {
    const rounded = Math.max(10, Math.round(meters / 10) * 10);
    return new Intl.NumberFormat(current, { style: 'unit', unit: 'meter', maximumFractionDigits: 0 }).format(rounded);
  }
  const km = meters / 1000;
  return new Intl.NumberFormat(current, { style: 'unit', unit: 'kilometer', maximumFractionDigits: km < 10 ? 1 : 0 }).format(km);
}

export function applyTranslations(root = document) {
  document.documentElement.lang = current;
  root.querySelectorAll('[data-i18n]').forEach((node) => {
    node.textContent = t(node.dataset.i18n);
  });
  root.querySelectorAll('[data-i18n-attr]').forEach((node) => {
    node.dataset.i18nAttr.split(';').forEach((pair) => {
      const [attr, key] = pair.split(':').map((part) => part.trim());
      if (attr && key) node.setAttribute(attr, t(key));
    });
  });
}
