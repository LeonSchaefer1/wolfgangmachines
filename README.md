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
- Gemessene Last pro Bild (`node game/tests/drive.cjs game/tests/s-perf.cjs`, alle zehn Level mit laufender Lösung,
  CPU vierfach gedrosselt): höchstens 40 Zeichenaufrufe und 12 400 Dreiecke (inklusive Schattendurchgang),
  16 Shader-Programme, 14 Texturen; Physik unter 0,5 ms und Szenen-Update unter 0,1 ms pro Takt.
  Die GPU-Zeit lässt sich ohne echtes Gerät nicht messen.

## Test im Android-Emulator

**Empfohlen: GitHub Actions** (`.github/workflows/android.yml`). Bei jedem Push prüft der Lauf alle Level, baut die
signierte APK und spielt Level 1 in einem Emulator **mit Hardware-Beschleunigung** durch – mit normalen Tipp- und
Wischgesten (`scripts/ci-emulator-smoke.sh`). APK und Bildschirmfotos hängen als Downloads am Lauf.
Letztes Ergebnis: `docs/emulator-github-level1.png` (Android 14, Pixel-6-Profil, unveränderte Release-APK).

Lokal:

Mit Hardware-Beschleunigung (KVM) genügt:

```bash
scripts/emulator-test.sh boot
```

```bash
scripts/emulator-test.sh install release/WolfgangsTueftelwerkstatt-debug.apk && scripts/emulator-test.sh launch
```

**Ohne KVM** (reine CPU-Emulation, so wurde hier getestet) sind drei Dinge nötig:

1. **Normales Abbild statt „ATD"** – die ATD-Abbilder zeichnen nichts auf das Display (Bildschirmfotos bleiben schwarz):
   `EMU_AVD_NAME=wolfgang34d EMU_SYSTEM_IMAGE="system-images;android-34;default;x86_64" EMU_GPU=swangle_indirect EMU_EXTRA_ARGS=-writable-system scripts/emulator-test.sh boot`
   (mit `swiftshader_indirect` blieb der WebView-Inhalt auf dem Display schwarz, mit `swangle_indirect` erscheint er).
2. **WebView-Korrektur nur im Emulator:** Der System-WebView (113 auf API 34, 124 auf API 35) beendet dort seinen Renderer bei
   *jeder* Webseite, weil die Prüfsummen-Selbstprüfung beim Start der JavaScript-Engine fehlschlägt (vermutlich rechnet die
   emulierte CPU die SSSE3-Variante von Adler-32 falsch). `scripts/emulator-webview-fix.sh 191356a` (API 34) ersetzt den
   einen Sprungbefehl dieser Prüfung in einer Kopie des Emulator-WebViews. Das Skript fasst die von Hand ausgeführten
   Schritte zusammen; als Skript wurde es noch nicht erneut durchlaufen. App und APK bleiben unverändert.
3. **Eingaben über DevTools:** Ein Bild braucht 1–5 Sekunden, deshalb beendet Android die App bei `adb shell input tap`
   mit „reagiert nicht". `scripts/emulator-test.sh devtools`, dann
   `cd game && EMU_SHOT=1 node tests/cdp-play.cjs <ordner>` schickt Touch-Ereignisse direkt in den WebView, spielt Level 1
   durch und fotografiert nach jedem Schritt das Emulator-Display.

Ergebnis des letzten Laufs (Android 14, WebView 113): `docs/emulator-display-title.png` und
`docs/emulator-display-level1.png` (Display-Fotos), `docs/emulator-test-level1.png` (Bilder aus dem Spiel, Android 15).
Ohne Grafikchip schaltet das Spiel automatisch in einen sparsamen Modus (kleine Auflösung, keine Schatten);
auf einem echten Telefon ist dieser Modus nie aktiv.
