# Viaro

Reise-Web-App (Arbeitstitel) zum Planen von Reisen – Stufe 1: Karte und Unterkünfte.

## Funktionen
- Vollbild-Karte (OpenStreetMap), Start am eigenen Standort
- Ortssuche (Nominatim) mit Trefferliste
- „In diesem Bereich suchen“: Hotels, Hostels, Gästehäuser, Apartments, Motels (Overpass API)
- Filter, Legende, Marker-Clustering, ausziehbare Ergebnisliste
- Favoriten (lokal gespeichert), sortierbar und auf der Karte sichtbar
- Deutsch, Englisch, Spanisch – Hell-, Dunkel- und Automatikmodus

## Starten
Kein Build nötig. Die App braucht HTTPS (für den Standort), z. B. über GitHub Pages:
*Settings → Pages → Deploy from branch → `main` / `(root)`*.

Lokal: `python3 -m http.server` im Projektordner, dann `http://localhost:8000` öffnen.

## Dateien
- `index.html` – Grundgerüst
- `css/style.css` – Gestaltung
- `js/app.js` – Start und Steuerung
- `js/map.js` – Karte, Marker, Popups
- `js/api.js` – Abfragen an Nominatim und Overpass (mit Cache)
- `js/i18n.js` – Übersetzungen
- `js/storage.js` – localStorage

## Datenquellen
Kartendaten © OpenStreetMap-Mitwirkende (ODbL). Kostenlose Dienste ohne API-Schlüssel – bitte schonend nutzen.
