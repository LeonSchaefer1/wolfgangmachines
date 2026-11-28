#!/usr/bin/env bash
# Helper for .github/workflows/online-emulator.yml (runs on a GitHub runner with KVM).
#   start      boot a landscape Android 14 emulator on a virtual display, install + launch the game
#   link       expose that display as a web page (noVNC) through a temporary Cloudflare tunnel
#   keepalive  keep everything up for N minutes
# Nothing here needs an account. The link is random and stops working when the run ends.
set -euo pipefail
export DISPLAY=:99
SDK="${ANDROID_HOME:?ANDROID_HOME not set}"
export PATH="$SDK/platform-tools:$SDK/emulator:$SDK/cmdline-tools/latest/bin:$PATH"
AVD=wolfgang-online
# pin the AVD location: runners differ in where avdmanager puts it by default
export ANDROID_AVD_HOME="$HOME/.android/avd"
mkdir -p "$ANDROID_AVD_HOME"
PKG=de.wolfgang.tueftelwerkstatt
APK=release/WolfgangsTueftelwerkstatt.apk
OUT=online-emulator
mkdir -p "$OUT"

case "${1:-}" in
  start)
    Xvfb :99 -screen 0 1280x640x24 -nolisten tcp > /dev/null 2>&1 &
    sleep 2
    openbox > /dev/null 2>&1 &
    echo no | avdmanager create avd --force -n "$AVD" -k "system-images;android-34;default;x86_64" > /dev/null
    CFG="$ANDROID_AVD_HOME/$AVD.avd/config.ini"
    # Galaxy-A54-like screen, shown lying on its side so the landscape game is upright
    sed -i -E '/^(hw\.lcd\.(width|height|density)|hw\.initialOrientation|hw\.ramSize|hw\.keyboard|hw\.gpu\.(enabled|mode)|showDeviceFrame)[ =]/d' "$CFG"
    cat >> "$CFG" <<CONF
hw.lcd.width=1080
hw.lcd.height=2340
hw.lcd.density=420
hw.initialOrientation=landscape
hw.ramSize=3072
hw.keyboard=yes
hw.gpu.enabled=yes
hw.gpu.mode=swiftshader_indirect
showDeviceFrame=no
CONF
    nohup emulator -avd "$AVD" -no-snapshot -noaudio -no-boot-anim -no-metrics -gpu swiftshader_indirect \
      -camera-back none -camera-front none > "$OUT/emulator.log" 2>&1 &
    fail() { echo "--- emulator.log ---"; tail -n 60 "$OUT/emulator.log" || true; echo "$1" >&2; exit 1; }
    timeout 150 adb wait-for-device || fail "emulator never showed up in adb"
    BOOTED=0
    for _ in $(seq 1 100); do
      pgrep -f qemu-system > /dev/null || fail "emulator process died"
      if [[ "$(timeout 10 adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" == "1" ]]; then BOOTED=1; break; fi
      sleep 3
    done
    (( BOOTED == 1 )) || fail "emulator did not finish booting"
    echo "emulator booted"; grep -iE "gles|graphics adapter|accel|kvm" "$OUT/emulator.log" | head -8 || true
    adb shell settings put secure immersive_mode_confirmations confirmed
    adb shell settings put system screen_off_timeout 2147483647
    adb shell svc power stayon true || true
    adb install -r "$APK"
    adb shell am start -W -n "$PKG/.MainActivity"
    sleep 8
    # tidy up what visitors see: close the emulator's info dialog, turn the phone on its side, enlarge the window
    for _ in 1 2 3; do
      xdotool search --name "Nested Virtualization" windowclose 2>/dev/null || true
      sleep 1
    done
    adb emu rotate || true
    sleep 4
    WIN="$(xdotool search --name "Android Emulator - " 2>/dev/null | head -1 || true)"
    if [[ -n "$WIN" ]]; then
      xdotool windowmove "$WIN" 0 0 windowsize "$WIN" 1200 560 || true
      sleep 2
      xdotool getwindowgeometry "$WIN" || true
    fi
    sleep 8
    adb exec-out screencap -p > "$OUT/device-screen.png" || true
    ;;
  link)
    x11vnc -display :99 -forever -shared -nopw -quiet -bg -rfbport 5900 -o "$OUT/x11vnc.log"
    nohup websockify --web /usr/share/novnc 6080 localhost:5900 > "$OUT/websockify.log" 2>&1 &
    nohup ./cloudflared tunnel --no-autoupdate --url http://localhost:6080 > "$OUT/cloudflared.log" 2>&1 &
    URL=""
    for _ in $(seq 1 40); do
      URL="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$OUT/cloudflared.log" | head -1 || true)"
      [[ -n "$URL" ]] && break
      sleep 2
    done
    [[ -n "$URL" ]] || { cat "$OUT/cloudflared.log"; echo "no tunnel URL" >&2; exit 1; }
    LINK="$URL/vnc.html?autoconnect=1&resize=scale&reconnect=1"
    echo "$LINK" > "$OUT/link.txt"
    # a picture of the whole virtual display: this is what visitors of the link see
    import -display :99 -window root "$OUT/browser-view.png" || true
    {
      echo "## Online-Emulator läuft"
      echo
      echo "**[Hier klicken, um Wolfgangs Tüftelwerkstatt im Emulator zu bedienen]($LINK)**"
      echo
      echo "Mit der Maus (oder dem Finger) klicken und ziehen wie auf dem Telefon. Der Link gilt nur, solange dieser Lauf aktiv ist."
    } >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
    echo "::notice title=Online-Emulator::$LINK"
    ;;
  keepalive)
    MIN="${2:-30}"
    [[ "$MIN" =~ ^[0-9]+$ ]] || MIN=30
    (( MIN > 90 )) && MIN=90
    echo "Emulator bleibt $MIN Minuten erreichbar: $(cat "$OUT/link.txt")"
    END=$(( $(date +%s) + MIN * 60 ))
    while (( $(date +%s) < END )); do
      # bring the game back if it was closed
      adb shell pidof "$PKG" > /dev/null 2>&1 || adb shell am start -n "$PKG/.MainActivity" > /dev/null 2>&1 || true
      sleep 30
    done
    ;;
  *)
    echo "usage: online-emulator.sh start|link|keepalive [minutes]" >&2
    exit 1
    ;;
esac
