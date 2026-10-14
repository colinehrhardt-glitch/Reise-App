# Viaro

Reise-Web-App (Arbeitstitel) zum Planen von Reisen – Stufe 1: Karte und Unterkünfte, Stufe 2: Transport und Routen-Planer.

## Funktionen
- Vollbild-Karte (OSM-Daten, Vektorkarte von OpenFreeMap, Rückfall auf OSM-Kacheln); öffnet an der zuletzt angesehenen Stelle, der Standort wird nur auf Wunsch abgefragt
- Ortssuche (Nominatim) mit Trefferliste und „Zuletzt gesucht“ (auch im Routen-Planer, Verlauf löschbar)
- Als App auf dem Home-Bildschirm installierbar (PWA); öffnet auch offline mit gespeicherter Route, Favoriten und Reiseplan
- „In diesem Bereich suchen“: Hotels, Hostels, Gästehäuser, Apartments, Motels (Overpass API)
- Filter, Sortierung (Empfohlen, Sterne, Entfernung), Marker-Clustering, ausziehbare Ergebnisliste
- Popups mit Foto (Wikimedia Commons/Wikidata), Ausstattung, Kontakt und Preis-Links (Booking.com, Google)
- Ebenen-Panel (auf dem iPhone als Panel von unten) mit Legende: Transport (Flughäfen, Bahnhöfe, Busbahnhöfe, Fährterminals), Geld, Einkaufen, Gesundheit, Essen & Trinken zuschaltbar
- Routen-Planer (Reiter „Route“): Reisebeginn, Start (eigener Standort oder eigener Ort), Orte hinzufügen, per Ziehen sortieren oder optimieren
- Nächte pro Ort (auch am Startort) mit automatisch berechneten An- und Abreisetagen
- Reiseplan Tag für Tag (Fahrten und Übernachtungen), Export in den Kalender (.ics) und Teilen als Text
- „Automatisch wählen aus“: Verkehrsmittel für die automatische Auswahl ausschließen (z. B. keine Flüge); pro Etappe bleiben alle wählbar
- Unterkunft pro Ort: „Unterkunft suchen“ lädt die Unterkünfte dort, im Popup „Für <Ort> merken“, Merkliste mit Auswahl, Haken „Keine Unterkunft nötig“, Warnhinweis bei Orten ohne Unterkunft; Booking.com-Links mit Check-in/Check-out
- Routen als Pfeilketten in Reiserichtung; Flüge von Flughafen zu Flughafen (Großkreis), Bus und Bahn von Busbahnhof bzw. Bahnhof, Anfahrt als Punktlinie
- Busbahnhof bzw. Bahnhof pro Ort wählbar, wenn es mehrere gibt (Auswahl wird gemerkt)
- Transfers: Anreise von der Unterkunft zum Flughafen/Bahnhof/Busbahnhof und weiter zur nächsten Unterkunft mit Taxi-/Uber-Fahrzeit, Fußweg und Links zu Uber und Bus & Bahn
- Transport-Vergleich pro Etappe: Auto, zu Fuß, Bus, Bahn, Fähre, Flug mit Dauer, Distanz und Kennzeichnung „Fahrplan“, „Straße“ oder „geschätzt“; Bus/Bahn-Verbindungen zum Abreisetag; Vorschlag aus den gefundenen Verbindungen; keine geschätzte Bahn in Ländern ohne Personenzüge (z. B. Kolumbien)
- Verkehrsmittel je Etappe: Auto und zu Fuß mit echter Strecke (OSRM, FOSSGIS), Bus/Bahn/Fähre mit Verbindungen über Transitous (wo verfügbar, sonst Schätzung), Flug als Bogenlinie mit geschätzter Flugzeit; Links zu Google Maps, Google Flights und Rome2Rio
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
- `js/api.js` – Abfragen an Nominatim, Overpass, Routing und Transitous (mit Cache)
- `js/planner.js` – Routen-Planer
- `js/overview.js` – Reiseplan, Kalender-Export, Teilen
- `js/recent.js` – zuletzt gesuchte Orte
- `sw.js`, `manifest.webmanifest`, `icons/` – App-Installation und Offline-Start
- `js/ui.js` – gemeinsame Bausteine (Elemente, Symbole, Hinweise)
- `data/airports.json` – Flughäfen mit Linienverkehr (aus OurAirports, gemeinfrei)
- `js/i18n.js` – Übersetzungen
- `js/storage.js` – localStorage

## Datenquellen
Kartendaten © OpenStreetMap-Mitwirkende (ODbL), Kartenstil OpenFreeMap © OpenMapTiles, Fotos Wikimedia Commons, Flughäfen OurAirports (Public Domain), Routen OSRM und FOSSGIS, Bus/Bahn Transitous (ehrenamtlicher Dienst für Open-Source-Projekte). Kostenlose Dienste ohne API-Schlüssel – bitte schonend nutzen. Bewertungen und echte Preise gibt es erst mit Partner-Anbindung (Stufe 6).

## Lizenz
MIT – siehe `LICENSE`.

## Offene Punkte für Stufe 5 (eigener Server)
- **KI-Reiseplanung:** Vor der Reise fragt die App, welche Länder und Städte dabei sein sollen. Die KI schlägt daraus Routen, weitere Orte und Aktivitäten vor; alles bleibt danach von Hand änderbar. Die Länder-Auswahl gehört zu diesem Schritt (nicht in den Planer). Der Planer übernimmt das Ergebnis über `applyPlan({ startPlace, stops })` in `js/planner.js`. Schlüssel nur auf dem Server, nie im Frontend.
- **Ladezeit der Unterkünfte:** Der öffentliche Overpass-Server ist oft ausgelastet (Suchen dauern teils 10–20 s oder werden abgelehnt). Lösung: eigene, wöchentlich aktualisierte Kopie der OSM-Daten statt Live-Abfragen – entweder als fertige Datenpakete über GitHub (kostenlos) oder über den eigenen Server. Ein reiner Weiterleitungs-Server hilft nicht.
- **Zusatz-Ebenen** (Geld, Einkaufen, Gesundheit, Essen) hängen ebenfalls am Overpass-Server und sollen mit umziehen.
- **Hostelworld:** Partnerprogramm (partners.hostelworld.com) beantragen; Preise und Bilder nur mit Partner-Zugang und über den Server (Schlüssel nie im Frontend). Bis dahin führt der Button über eine Google-Suche zu Hostelworld.
- **Rome2Rio:** Zugang zur Routen-API anfragen (Bedingungen und mögliche Kosten klären, sonst Stufe 6). Liefert echte Abfahrtsorte je Busfirma (z. B. Terminal oder eigenes Büro), Fahrzeiten und ungefähre Preise – damit wird die Busbahnhof-Auswahl genauer als die heutige Schätzung aus OSM-Daten. Abfrage nur über den eigenen Server (Schlüssel nie im Frontend), Ergebnis ersetzt `stationEstimate` in `js/planner.js`.
- **Google-Maps-Karte** wäre mit API-Schlüssel möglich (Kosten, Kreditkarte) – vorerst bei OpenFreeMap geblieben.
