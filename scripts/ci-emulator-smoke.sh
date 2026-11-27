#!/usr/bin/env bash
# Runs inside the CI emulator (hardware accelerated): installs the release APK, plays level 1 with
# real touch gestures (adb input) and saves a screenshot after every step to emulator-screens/.
# Fractions below are positions on the landscape screen (x/1000, y/1000) of the game's own layout.
set -euo pipefail
APK="${1:-release/WolfgangsTueftelwerkstatt.apk}"
PKG=de.wolfgang.tueftelwerkstatt
OUT=emulator-screens
mkdir -p "$OUT"

adb install -r "$APK"
adb logcat -c || true
adb shell am start -W -n "$PKG/.MainActivity"
sleep 30

size="$(adb shell wm size | tr -d '\r' | tail -1 | grep -oE '[0-9]+x[0-9]+')"
a="${size%x*}"; b="${size#*x}"
if (( a > b )); then W=$a; H=$b; else W=$b; H=$a; fi   # the game forces landscape
echo "screen ${W}x${H}"
px() { echo $(( W * $1 / 1000 )); }
py() { echo $(( H * $1 / 1000 )); }
shot() { adb exec-out screencap -p > "$OUT/$1.png"; echo "saved $1"; }
tap() { adb shell input tap "$(px "$1")" "$(py "$2")"; }

shot 1-title
tap 500 537                      # "Spielen"
sleep 6;  shot 2-intro
tap 500 668                      # "Los geht's!"
sleep 5;  shot 3-level1
# drag the plank out of the toolbox onto the light-blue outline (it snaps in)
adb shell input swipe "$(px 906)" "$(py 444)" "$(px 309)" "$(py 585)" 1800
sleep 3;  shot 4-placed
tap 906 900                      # "Start"
sleep 5;  shot 5-running
sleep 6;  shot 6-result

adb logcat -d > "$OUT/logcat-full.txt" || true
grep -E "Tueftelwerkstatt|chromium" "$OUT/logcat-full.txt" > "$OUT/logcat-app.txt" || true
if grep -q "render process gone" "$OUT/logcat-app.txt"; then echo "WebView renderer crashed" >&2; exit 1; fi
adb shell pidof "$PKG" > /dev/null || { echo "app is not running any more" >&2; exit 1; }
echo "smoke test finished"
