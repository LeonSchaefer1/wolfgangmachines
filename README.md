# Wolfgangs Tüftelwerkstatt

Ein Physik-Knobelspiel für Android (entwickelt für das Samsung Galaxy A54), gemacht für Spieler ab 70:
Teile aus der Kiste auf die Werkstattwand legen, „Start“ drücken und zusehen, wie die Kettenreaktion
die Aufgabe löst – Kugeln, Bretter, Dominosteine, Trampolin, Wippe, Ventilator, Luftballons,
Schalter, Förderband und eine Rakete. Zehn Maschinen, komplett offline, ohne Werbung, ohne Konto.

## Bedienkonzept (für ältere Spieler)

- Querformat, große Knöpfe, große Schrift, alles auf Deutsch.
- Teile per Finger aus der Kiste ziehen **oder** einfach antippen; das Teil schwebt beim Ziehen über dem Finger.
- Teile rasten in ein Raster ein, drehen sich per Knopf in festen Schritten, ungültige Positionen korrigieren sich selbst.
- Kein Zeitdruck, keine Strafen. Drei Hilfestufen: Text-Tipps → „Zeig es mir“ (hellblaue Umrisse, Teile rasten ein).
- Level 1 führt mit einer animierten Hand durch die Bedienung.

## Aufbau

| Ordner | Inhalt |
|---|---|
| `game/` | Das Spiel (TypeScript, three.js für die 2,5D-Grafik, planck.js für die Physik, Vite) |
| `game/src/core/` | Simulation, Bauteile, Level – läuft auch ohne Grafik (für Tests) |
| `game/src/render/` | 3D-Modelle, Texturen und Effekte – alles prozedural erzeugt, keine Bilddateien |
| `game/tests/` | `verify-levels.ts` prüft jedes Level automatisch (lösbar, nicht trivial, fehlertolerant) |
| `tools/audio/` | Erzeugt Musik und alle Geräusche per Synthese (`python3 tools/audio/build_audio.py`) |
| `android/` | Schlanke Android-Hülle (WebView, Vollbild, Querformat, offline) |
| `scripts/` | Build- und Testskripte |
| `release/` | Fertige APK und die Ein-Datei-Webversion |

## Bauen

```bash
cd game && npm install && npm run verify && npm run build
```

```bash
scripts/setup-android-sdk.sh
```

```bash
scripts/build-apk.sh
```

Die signierte APK liegt danach unter `release/WolfgangsTueftelwerkstatt.apk`.
Der Signaturschlüssel (`android/signing/release.jks`) liegt bewusst im Repository, damit spätere
Versionen die installierte App aktualisieren können.

Webversion in einer einzigen HTML-Datei:

```bash
node scripts/build-single-html.mjs
```

## Leistung

- Fester Physik-Takt (60 Hz, zwei Teilschritte), Darstellung auf 60 Bilder/s begrenzt, im Bau-Modus 30 Bilder/s (schont Akku).
- Wenige Materialien, zusammengefasste Geometrie, eine Schattenlichtquelle.
- Automatische Qualitätsanpassung: hält das Gerät die Bildrate nicht, werden Auflösung und Schatten stufenweise reduziert.
