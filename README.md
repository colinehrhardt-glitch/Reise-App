# Viaro

Reise-Web-App (Arbeitstitel) zum Planen von Reisen – Stufe 1: Karte und Unterkünfte.

## Funktionen
- Vollbild-Karte (OSM-Daten, Vektorkarte von OpenFreeMap, Rückfall auf OSM-Kacheln), Start am eigenen Standort
- Ortssuche (Nominatim) mit Trefferliste
- „In diesem Bereich suchen“: Hotels, Hostels, Gästehäuser, Apartments, Motels (Overpass API)
- Filter, Sortierung (Empfohlen, Sterne, Entfernung), Marker-Clustering, ausziehbare Ergebnisliste
- Popups mit Foto (Wikimedia Commons/Wikidata), Ausstattung, Kontakt und Preis-Links (Booking.com, Google)
- Ebenen-Panel mit Legende: Geld, Einkaufen, Gesundheit, Essen & Trinken zuschaltbar
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
Kartendaten © OpenStreetMap-Mitwirkende (ODbL), Kartenstil OpenFreeMap © OpenMapTiles, Fotos Wikimedia Commons. Kostenlose Dienste ohne API-Schlüssel – bitte schonend nutzen. Bewertungen und echte Preise gibt es erst mit Partner-Anbindung (Stufe 6).

## Offene Punkte für Stufe 5 (eigener Server)
- **Ladezeit der Unterkünfte:** Der öffentliche Overpass-Server ist oft ausgelastet (Suchen dauern teils 10–20 s oder werden abgelehnt). Lösung: eigene, wöchentlich aktualisierte Kopie der OSM-Daten statt Live-Abfragen – entweder als fertige Datenpakete über GitHub (kostenlos) oder über den eigenen Server. Ein reiner Weiterleitungs-Server hilft nicht.
- **Zusatz-Ebenen** (Geld, Einkaufen, Gesundheit, Essen) hängen ebenfalls am Overpass-Server und sollen mit umziehen.
- **Hostelworld:** Partnerprogramm (partners.hostelworld.com) beantragen; Preise und Bilder nur mit Partner-Zugang und über den Server (Schlüssel nie im Frontend). Bis dahin führt der Button über eine Google-Suche zu Hostelworld.
- **Google-Maps-Karte** wäre mit API-Schlüssel möglich (Kosten, Kreditkarte) – vorerst bei OpenFreeMap geblieben.
