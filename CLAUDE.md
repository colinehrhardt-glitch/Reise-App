# Viaro – Regeln für die Arbeit an der App

## Grundsatz
- Die App soll **einfach aufgebaut** sein: wenig Text, nur das Wichtigste zeigen, keine Quellen- oder Hinweiszeilen im Inhalt (Quellen stehen im Menü unter „Datenquellen“), kurze vollständige Sätze statt langer Texte, nichts mit „…“ abschneiden.
- Bevor neue Funktionen oder größere Änderungen gebaut werden: Vorschläge und Fragen an den Nutzer (als Auswahl), kurzer Plan, auf OK warten.

## Technik
- Vanilla HTML/CSS/JS, kein Framework, kein Build-Tool; Leaflet und MapLibre über unpkg mit SRI.
- Keine Code-Kommentare.
- Alle UI-Texte in `js/i18n.js` (Deutsch, Englisch, Spanisch, gleiche Schlüssel und Platzhalter).
- localStorage nur über `js/storage.js` (mit try/catch).
- Nur kostenlose Dienste ohne API-Schlüssel, Server schonen (Cache, Abfragen erst bei Bedarf). Alles mit Kosten oder Schlüsseln erst ab Stufe 5/6 (eigener Server), Schlüssel nie im Frontend.
- Daten, die der Browser nicht direkt abrufen darf (CORS), holt eine GitHub Action und legt sie unter `data/` ab (siehe `tools/advisories.py`).
- Mobile-first (iPhone/iPad als PWA), Hell- und Dunkelmodus, klare Lade- und Fehlerzustände.
- Bei Änderungen an App-Dateien die Version in `sw.js` erhöhen.

## Ablauf
- Commit-Nachrichten auf Deutsch, Push auf `main` (GitHub Pages).
- README auf Deutsch aktuell halten, offene Punkte für Stufe 5 dort sammeln.
- Nach jeder Änderung: geänderte Dateien und kurze Test-Checkliste nennen, dann auf Rückmeldung warten.
