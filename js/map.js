export const ICONS = {
  hotel: '<path d="M3 19v-9"/><path d="M3 15h18v4"/><path d="M21 15v-2.5A3.5 3.5 0 0 0 17.5 9H11v6"/><circle cx="7" cy="12" r="1.8"/>',
  hostel: '<path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7"/><rect x="5.5" y="7" width="13" height="13.5" rx="4"/><path d="M9 14h6v3.5H9z"/>',
  guest_house: '<path d="M3.5 11 12 4l8.5 7"/><path d="M6 9.5V20h12V9.5"/><path d="M10 20v-5h4v5"/>',
  apartment: '<rect x="5" y="3.5" width="14" height="17" rx="1.5"/><path d="M9 7.5h1.5M13.5 7.5H15M9 11.5h1.5M13.5 11.5H15M9 15.5h1.5M13.5 15.5H15"/>',
  motel: '<path d="M4 13.5 6 8h12l2 5.5V18H4z"/><path d="M4 13.5h16"/><path d="M6.5 18v2M17.5 18v2"/><circle cx="7.5" cy="15.8" r=".6"/><circle cx="16.5" cy="15.8" r=".6"/>',
  money: '<rect x="3" y="6.5" width="18" height="11" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6.5 9.5v5M17.5 9.5v5"/>',
  shopping: '<path d="M3.5 4.5h2.2l2 10h10.1l2-7H7.1"/><circle cx="9.5" cy="19" r="1.3"/><circle cx="16.5" cy="19" r="1.3"/>',
  health: '<path d="M9.5 4h5v5.5H20v5h-5.5V20h-5v-5.5H4v-5h5.5z"/>',
  food: '<path d="M7 3v6.5a2 2 0 0 0 2 2V21M11 3v6.5a2 2 0 0 1-2 2M9 3v5"/><path d="M17 21V3c-2 1.5-3 4-3 7v3.5h3"/>',
  heart: '<path d="M12 20.2s-7.5-4.6-7.5-10.4A4.3 4.3 0 0 1 12 7a4.3 4.3 0 0 1 7.5 2.8c0 5.8-7.5 10.4-7.5 10.4z"/>',
  pin: '<path d="M12 21s-6.5-6-6.5-11.5a6.5 6.5 0 0 1 13 0C18.5 15 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.3"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.3 2.4 3.5 5.2 3.5 8.5s-1.2 6.1-3.5 8.5c-2.3-2.4-3.5-5.2-3.5-8.5S9.7 5.9 12 3.5z"/>',
  phone: '<path d="M6.5 3.5h3l1.5 4.5-2 1.3a10.5 10.5 0 0 0 5.7 5.7l1.3-2 4.5 1.5v3a2 2 0 0 1-2 2A15.5 15.5 0 0 1 4.5 5.5a2 2 0 0 1 2-2z"/>',
  mail: '<rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="m4 7 8 6 8-6"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  tag: '<path d="M3.5 12.5V4.5h8l9 9-8 8z"/><circle cx="8" cy="9" r="1.5"/>',
  route: '<path d="M4 11.5 20 4l-7.5 16-1.8-6.7z"/>',
  close: '<path d="M7 7l10 10M17 7 7 17"/>',
  place: '<path d="M12 21s-6.5-6-6.5-11.5a6.5 6.5 0 0 1 13 0C18.5 15 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.3"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>'
};

export const TYPES = {
  hotel: { color: '#3b5bdb' },
  hostel: { color: '#e8590c' },
  guest_house: { color: '#2f9e44' },
  apartment: { color: '#ae3ec9' },
  motel: { color: '#495057' }
};

export const LAYERS = {
  money: { color: '#0c8599' },
  shopping: { color: '#7048e8' },
  health: { color: '#e03131' },
  food: { color: '#f59f00' }
};

export const FAVORITE_COLOR = '#e64980';

const TILES = {
  light: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
  dark: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
};
const WORLD_VIEW = { center: [25, 10], zoom: 2 };
const FOCUS_ZOOM = 17;
const UNCLUSTER_ZOOM = 17;
const PIN_OFFSET = -32;
const POI_OFFSET = -12;

let map = null;
let tiles = null;
let tileTheme = 'light';
let cluster = null;
let favoritesLayer = null;
let userMarker = null;
let userAccuracy = null;
let popup = null;
let currentAttribution = '';
let insets = { top: 0, right: 0, bottom: 0, left: 0 };
let handlers = {};
let accommodationsVisible = true;
const resultMarkers = new Map();
const favoriteMarkers = new Map();
const poiGroups = new Map();

export function svg(name, className = '') {
  const cls = className ? ` class="${className}"` : '';
  return `<svg viewBox="0 0 24 24"${cls} aria-hidden="true">${ICONS[name] || ''}</svg>`;
}

function colorFor(type) {
  return TYPES[type]?.color || '#0b7285';
}

function pinIcon(type, favorite) {
  const badge = favorite ? `<span class="pin__badge">${svg('heart')}</span>` : '';
  return L.divIcon({
    className: 'marker-icon',
    html: `<div class="pin" style="--c:${colorFor(type)}">${svg(type)}${badge}</div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 37]
  });
}

function favoriteIcon() {
  return L.divIcon({
    className: 'marker-icon',
    html: `<div class="pin" style="--c:${FAVORITE_COLOR}">${svg('heart')}</div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 37]
  });
}

function poiIcon(category) {
  return L.divIcon({
    className: 'marker-icon',
    html: `<div class="poi" style="--c:${LAYERS[category].color}">${svg(category)}</div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12]
  });
}

function clusterIconFactory(color) {
  return (group) => {
    const count = group.getChildCount();
    const size = count < 10 ? 32 : count < 100 ? 38 : count < 1000 ? 44 : 50;
    const style = color ? `--cc:${color};` : '';
    return L.divIcon({
      className: 'cluster-icon',
      html: `<div class="cluster${color ? ' cluster--layer' : ''}" style="${style}width:${size}px;height:${size}px">${count}</div>`,
      iconSize: [size, size]
    });
  };
}

function createCluster(color) {
  return L.markerClusterGroup({
    showCoverageOnHover: false,
    spiderfyOnMaxZoom: true,
    disableClusteringAtZoom: UNCLUSTER_ZOOM,
    maxClusterRadius: (zoom) => (zoom >= 15 ? 50 : 72),
    chunkedLoading: true,
    iconCreateFunction: clusterIconFactory(color)
  });
}

export function initMap(container, options = {}) {
  handlers = options;
  map = L.map(container, {
    zoomControl: false,
    worldCopyJump: true,
    minZoom: 2,
    maxZoom: 20,
    tapTolerance: 20
  });
  map.setView(WORLD_VIEW.center, WORLD_VIEW.zoom);
  map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>');
  setMapTheme(options.dark);

  cluster = createCluster(null).addTo(map);
  favoritesLayer = L.layerGroup().addTo(map);

  map.on('moveend zoomend', () => handlers.onViewChange?.());
  map.on('click', () => handlers.onMapClick?.());
  map.on('popupclose', (event) => {
    if (event.popup === popup) {
      popup = null;
      handlers.onPopupClose?.();
    }
  });
  return map;
}

export function setMapTheme(dark) {
  if (!map) return;
  const theme = dark ? 'dark' : 'light';
  if (tiles && theme === tileTheme) return;
  tileTheme = theme;
  const next = L.tileLayer(TILES[theme], {
    subdomains: 'abcd',
    maxZoom: 20,
    crossOrigin: true
  });
  next.addTo(map);
  next.bringToBack();
  if (tiles) {
    const previous = tiles;
    next.once('load', () => map.removeLayer(previous));
    setTimeout(() => {
      if (map.hasLayer(previous)) map.removeLayer(previous);
    }, 4000);
  }
  tiles = next;
  map.getContainer().dataset.mapTheme = theme;
}

export function setAttribution(html) {
  if (currentAttribution) map.attributionControl.removeAttribution(currentAttribution);
  currentAttribution = html;
  map.attributionControl.addAttribution(html);
}

export function setInsets(next) {
  insets = { ...insets, ...next };
}

export function getZoom() {
  return map.getZoom();
}

export function getBounds() {
  const size = map.getSize();
  const topLeft = map.containerPointToLatLng([insets.left, insets.top]);
  const bottomRight = map.containerPointToLatLng([size.x - insets.right, Math.max(insets.top + 1, size.y - insets.bottom)]);
  const west = Math.max(-180, L.Util.wrapNum(topLeft.lng, [-180, 180], true));
  let east = Math.min(180, L.Util.wrapNum(bottomRight.lng, [-180, 180], true));
  if (east < west) east = 180;
  return {
    south: Math.max(-90, bottomRight.lat),
    north: Math.min(90, topLeft.lat),
    west,
    east
  };
}

export function getVisibleCenter() {
  const size = map.getSize();
  const point = L.point(
    insets.left + (size.x - insets.left - insets.right) / 2,
    insets.top + (size.y - insets.top - insets.bottom) / 2
  );
  const latlng = map.containerPointToLatLng(point).wrap();
  return { lat: latlng.lat, lon: latlng.lng };
}

function centerFor(latlng, zoom) {
  const offset = L.point((insets.left - insets.right) / 2, (insets.top - insets.bottom) / 2);
  const projected = map.project(latlng, zoom).subtract(offset);
  return map.unproject(projected, zoom);
}

function moveTo(latlng, zoom, animate = true) {
  return new Promise((resolve) => {
    const target = centerFor(L.latLng(latlng), zoom);
    const already = map.getZoom() === zoom && map.latLngToContainerPoint(target).distanceTo(map.latLngToContainerPoint(map.getCenter())) < 2;
    if (already) {
      resolve();
      return;
    }
    map.once('moveend', () => resolve());
    if (animate) map.flyTo(target, zoom, { duration: 0.7 });
    else map.setView(target, zoom, { animate: false });
  });
}

export function flyToLocation(lat, lon, zoom, animate = true) {
  return moveTo([lat, lon], zoom, animate);
}

export function zoomInTo(minZoom) {
  return moveTo(map.getCenter(), Math.max(minZoom, map.getZoom() + 1));
}

export function showSearchResult(result) {
  if (result.rank >= 16 || !result.bounds) {
    const zoom = result.rank >= 26 ? 17 : result.rank >= 20 ? 15 : 14;
    return moveTo([result.lat, result.lon], zoom);
  }
  return new Promise((resolve) => {
    const bounds = L.latLngBounds([result.bounds.south, result.bounds.west], [result.bounds.north, result.bounds.east]);
    map.once('moveend', () => resolve());
    map.flyToBounds(bounds, {
      paddingTopLeft: [insets.left + 16, insets.top + 16],
      paddingBottomRight: [insets.right + 16, insets.bottom + 16],
      maxZoom: 14,
      duration: 0.9
    });
  });
}

export function focusPlace(place) {
  return moveTo([place.lat, place.lon], Math.max(map.getZoom(), FOCUS_ZOOM));
}

export function setAccommodationsVisible(visible) {
  accommodationsVisible = visible;
  if (visible && !map.hasLayer(cluster)) map.addLayer(cluster);
  if (!visible && map.hasLayer(cluster)) map.removeLayer(cluster);
}

export function renderResults(places, isFavorite) {
  const keep = new Set();
  const additions = [];
  for (const place of places) {
    keep.add(place.id);
    const favorite = isFavorite(place.id);
    const existing = resultMarkers.get(place.id);
    if (existing) {
      if (existing.favorite !== favorite) {
        existing.favorite = favorite;
        existing.marker.setIcon(pinIcon(place.type, favorite));
      }
      existing.place = place;
      continue;
    }
    const marker = L.marker([place.lat, place.lon], {
      icon: pinIcon(place.type, favorite),
      keyboard: true,
      title: place.name || '',
      riseOnHover: true
    });
    const entry = { marker, place, favorite };
    marker.on('click', () => handlers.onPlaceClick?.(entry.place));
    resultMarkers.set(place.id, entry);
    additions.push(marker);
  }
  const removals = [];
  for (const [id, entry] of resultMarkers) {
    if (!keep.has(id)) {
      removals.push(entry.marker);
      resultMarkers.delete(id);
    }
  }
  if (removals.length) cluster.removeLayers(removals);
  if (additions.length) cluster.addLayers(additions);
  if (!accommodationsVisible && map.hasLayer(cluster)) map.removeLayer(cluster);
}

export function renderFavorites(places) {
  const keep = new Set(places.map((place) => place.id));
  for (const [id, entry] of favoriteMarkers) {
    if (!keep.has(id)) {
      favoritesLayer.removeLayer(entry.marker);
      favoriteMarkers.delete(id);
    }
  }
  for (const place of places) {
    const existing = favoriteMarkers.get(place.id);
    if (existing) {
      existing.place = place;
      continue;
    }
    const marker = L.marker([place.lat, place.lon], {
      icon: favoriteIcon(),
      keyboard: true,
      title: place.name || '',
      riseOnHover: true,
      zIndexOffset: 500
    });
    const entry = { marker, place };
    marker.on('click', () => handlers.onPlaceClick?.(entry.place));
    favoriteMarkers.set(place.id, entry);
    favoritesLayer.addLayer(marker);
  }
}

export function renderPoiLayer(category, items, visible) {
  let group = poiGroups.get(category);
  if (!group) {
    group = { layer: createCluster(LAYERS[category].color), ids: '' };
    poiGroups.set(category, group);
  }
  const ids = items.map((item) => item.id).join(',');
  if (ids !== group.ids) {
    group.ids = ids;
    group.layer.clearLayers();
    group.layer.addLayers(items.map((item) => {
      const marker = L.marker([item.lat, item.lon], {
        icon: poiIcon(category),
        keyboard: true,
        title: item.name || '',
        riseOnHover: true
      });
      marker.on('click', () => handlers.onPoiClick?.(item));
      return marker;
    }));
  }
  if (visible && !map.hasLayer(group.layer)) map.addLayer(group.layer);
  if (!visible && map.hasLayer(group.layer)) map.removeLayer(group.layer);
}

export function openPopup(item, content) {
  const size = map.getSize();
  const options = {
    offset: [0, item.kind === 'poi' ? POI_OFFSET : PIN_OFFSET],
    maxWidth: 320,
    minWidth: 220,
    maxHeight: Math.max(240, size.y - insets.top - insets.bottom - 70),
    closeButton: false,
    autoPanPaddingTopLeft: [insets.left + 12, insets.top + 12],
    autoPanPaddingBottomRight: [insets.right + 12, insets.bottom + 12],
    className: 'place-popup'
  };
  const next = L.popup(options).setLatLng([item.lat, item.lon]).setContent(content);
  next.placeId = item.id;
  if (popup) map.closePopup(popup);
  popup = next;
  next.openOn(map);
  return next;
}

export function getOpenPopupId() {
  return popup ? popup.placeId : null;
}

export function updatePopup(content) {
  if (popup) popup.setContent(content);
}

export function refreshPopup() {
  if (popup) popup.update();
}

export function closePopup() {
  if (popup) map.closePopup(popup);
}

export function showUser(lat, lon, accuracy) {
  const latlng = [lat, lon];
  if (!userMarker) {
    userMarker = L.marker(latlng, {
      icon: L.divIcon({ className: 'marker-icon', html: '<div class="user-dot"></div>', iconSize: [20, 20], iconAnchor: [10, 10] }),
      interactive: false,
      keyboard: false,
      zIndexOffset: 1000
    }).addTo(map);
    userAccuracy = L.circle(latlng, {
      radius: Math.min(accuracy || 0, 500),
      interactive: false,
      weight: 0,
      fillColor: '#1c7ed6',
      fillOpacity: 0.08
    }).addTo(map);
  } else {
    userMarker.setLatLng(latlng);
    userAccuracy.setLatLng(latlng).setRadius(Math.min(accuracy || 0, 500));
  }
}

export function invalidateSize() {
  if (map) map.invalidateSize({ pan: false });
}
