#!/usr/bin/env bash
# Headless Android emulator helper (software emulation, works without KVM).
#
# Full run (boot if needed -> install -> launch -> wait -> screenshot -> logcat):
#   scripts/emulator-test.sh [SECONDS=25] [SCREENSHOT=release/emulator-screenshot.png]
#   scripts/emulator-test.sh run [SECONDS] [SCREENSHOT]
#
# Pieces:
#   scripts/emulator-test.sh boot                 start emulator (if not running) and wait until booted
#   scripts/emulator-test.sh status               is it running / booted?
#   scripts/emulator-test.sh install [APK]        (re)install the APK (default release/WolfgangsTueftelwerkstatt.apk)
#   scripts/emulator-test.sh launch               start the activity (force-stops a running instance first)
#   scripts/emulator-test.sh shot [FILE]          screenshot (PNG) -> FILE
#   scripts/emulator-test.sh tap X Y              tap at screenshot pixel coordinates
#   scripts/emulator-test.sh swipe X1 Y1 X2 Y2 [MS=300]   swipe / drag
#   scripts/emulator-test.sh longpress X Y [MS=800]
#   scripts/emulator-test.sh key KEYCODE          e.g. key KEYCODE_BACK
#   scripts/emulator-test.sh back                 press the back button
#   scripts/emulator-test.sh home                 press home (app -> background, tests onAppPause)
#   scripts/emulator-test.sh resume               bring the app to the foreground again (no restart)
#   scripts/emulator-test.sh logcat [FILE]        dump filtered logcat (app + JS console) to FILE (default: stdout)
#   scripts/emulator-test.sh clearlog             clear the logcat buffer
#   scripts/emulator-test.sh cleardata            wipe the app's data (localStorage!)
#   scripts/emulator-test.sh devtools [PORT=9222] forward the WebView DevTools socket (debug APK only)
#   scripts/emulator-test.sh shell CMD...         adb shell passthrough
#   scripts/emulator-test.sh stop                 shut the emulator down
#   scripts/emulator-test.sh create-avd           (re)create the AVD only
#
# Environment (see scripts/android-env.sh): EMU_AVD_NAME, EMU_PORT, EMU_SYSTEM_IMAGE,
#   EMU_GPU (default swiftshader_indirect), EMU_RAM_MB (3072), EMU_CORES (1),
#   EMU_WIDTH/EMU_HEIGHT/EMU_DENSITY (portrait-native panel, default 540x1170 @ 210dpi),
#   EMU_BOOT_TIMEOUT (seconds, default 3600), EMU_EXTRA_ARGS.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
# shellcheck source=android-env.sh
source "$HERE/android-env.sh"

EMU_GPU="${EMU_GPU:-swiftshader_indirect}"
EMU_RAM_MB="${EMU_RAM_MB:-3072}"
# Without KVM the emulator runs all guest CPUs on ONE host thread (TCG), so
# more than 1 guest core only adds overhead. (Multi-threaded TCG via
# "-qemu -accel tcg,thread=multi" was tried: much slower, not booted after 30 min.)
EMU_CORES="${EMU_CORES:-1}"
# Galaxy A54 is 1080x2340 @ ~2.625x  ->  411 x 891 dp.  Half the pixels per
# axis with density 210 (1.3125x) gives the same 411 x 891 dp layout.
EMU_WIDTH="${EMU_WIDTH:-540}"
EMU_HEIGHT="${EMU_HEIGHT:-1170}"
EMU_DENSITY="${EMU_DENSITY:-210}"
EMU_BOOT_TIMEOUT="${EMU_BOOT_TIMEOUT:-3600}"
EMU_EXTRA_ARGS="${EMU_EXTRA_ARGS:-}"
EMU_LOG="${EMU_LOG:-$ANDROID_AVD_HOME/$EMU_AVD_NAME.emulator.log}"
DEFAULT_APK="$ROOT/release/WolfgangsTueftelwerkstatt.apk"
DEFAULT_SHOT="$ROOT/release/emulator-screenshot.png"

ADB=(adb -s "$EMU_SERIAL")

log() { echo "[emulator-test] $*" >&2; }
die() { echo "[emulator-test] ERROR: $*" >&2; exit 1; }

need_sdk() {
  command -v adb >/dev/null 2>&1 || die "adb not found - run scripts/setup-android-sdk.sh first"
  [[ -x "$ANDROID_SDK_ROOT/emulator/emulator" ]] || die "emulator not installed - run scripts/setup-android-sdk.sh"
}

emu_process_running() {
  pgrep -f "qemu-system.*-avd $EMU_AVD_NAME( |\$)" >/dev/null 2>&1 \
    || pgrep -f "qemu-system.*@$EMU_AVD_NAME( |\$)" >/dev/null 2>&1
}

emu_online() {
  [[ "$("${ADB[@]}" get-state 2>/dev/null || true)" == "device" ]]
}

emu_booted() {
  emu_online && [[ "$("${ADB[@]}" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r\n')" == "1" ]]
}

create_avd() {
  need_sdk
  local img_dir="$ANDROID_SDK_ROOT/${EMU_SYSTEM_IMAGE//;//}"
  [[ -d "$img_dir" ]] || die "system image $EMU_SYSTEM_IMAGE not installed - run scripts/setup-android-sdk.sh"
  mkdir -p "$ANDROID_AVD_HOME" "$ANDROID_EMULATOR_HOME"
  local avd_dir="$ANDROID_AVD_HOME/$EMU_AVD_NAME.avd"
  local sysdir="${EMU_SYSTEM_IMAGE//;//}/"
  # (the emulator rewrites config.ini as "key = value", so ignore blanks)
  if [[ -f "$avd_dir/config.ini" ]] && ! tr -d ' ' < "$avd_dir/config.ini" | grep -q -F "image.sysdir.1=$sysdir"; then
    emu_process_running && die "AVD '$EMU_AVD_NAME' uses a different system image and is running - stop it first"
    log "AVD '$EMU_AVD_NAME' was created from a different system image -> recreating"
    rm -rf "$avd_dir" "$ANDROID_AVD_HOME/$EMU_AVD_NAME.ini"
  fi
  if [[ ! -f "$avd_dir/config.ini" ]]; then
    log "creating AVD '$EMU_AVD_NAME' from $EMU_SYSTEM_IMAGE"
    echo no | avdmanager create avd --force -n "$EMU_AVD_NAME" -k "$EMU_SYSTEM_IMAGE" \
      -d pixel_5 -p "$avd_dir" >/dev/null 2>&1 \
      || die "avdmanager failed"
  fi
  # (Re)apply our hardware settings - idempotent.
  local cfg="$avd_dir/config.ini" tmp
  tmp="$(mktemp)"
  grep -v -E '^(hw\.lcd\.(width|height|density)|hw\.ramSize|hw\.cpu\.ncore|vm\.heapSize|hw\.keyboard|hw\.gpu\.(enabled|mode)|hw\.initialOrientation|disk\.dataPartition\.size|showDeviceFrame|skin\.(name|path|dynamic)|hw\.audioInput|hw\.audioOutput|hw\.camera\.(back|front)|fastboot\.forceColdBoot|fastboot\.forceFastBoot|hw\.sensors\.orientation|hw\.accelerometer|hw\.mainKeys|hw\.device\.name)[ =]' "$cfg" > "$tmp" || true
  cat >> "$tmp" <<EOF
hw.lcd.width=$EMU_WIDTH
hw.lcd.height=$EMU_HEIGHT
hw.lcd.density=$EMU_DENSITY
hw.ramSize=$EMU_RAM_MB
hw.cpu.ncore=$EMU_CORES
vm.heapSize=384
hw.keyboard=yes
hw.mainKeys=no
hw.gpu.enabled=yes
hw.gpu.mode=$EMU_GPU
hw.initialOrientation=portrait
hw.sensors.orientation=yes
hw.accelerometer=yes
disk.dataPartition.size=4G
showDeviceFrame=no
skin.name=${EMU_WIDTH}x${EMU_HEIGHT}
skin.path=_no_skin
skin.dynamic=yes
hw.audioInput=no
hw.audioOutput=yes
hw.camera.back=none
hw.camera.front=none
fastboot.forceColdBoot=yes
fastboot.forceFastBoot=no
EOF
  mv "$tmp" "$cfg"
}

post_boot_setup() {
  log "applying device settings (animations off, screen always on, ...)"
  "${ADB[@]}" shell '
    settings put global window_animation_scale 0
    settings put global transition_animation_scale 0
    settings put global animator_duration_scale 0
    settings put system screen_off_timeout 2147483647
    settings put secure immersive_mode_confirmations confirmed
    settings put global stay_on_while_plugged_in 7
    settings put system accelerometer_rotation 1
    settings put secure show_ime_with_hard_keyboard 0
    settings put global package_verifier_enable 0
    settings put global verifier_verify_adb_installs 0
    settings put global hide_error_dialogs 1
    svc power stayon true
    input keyevent KEYCODE_WAKEUP
    wm dismiss-keyguard
  ' >/dev/null 2>&1 || true
}

cmd_boot() {
  need_sdk
  if emu_booted; then
    log "emulator $EMU_SERIAL already running and booted"
    return 0
  fi
  if ! emu_process_running; then
    create_avd
    local accel=()
    if [[ ! -w /dev/kvm ]]; then
      log "no /dev/kvm -> pure software emulation (-accel off); boot takes many minutes"
      accel=(-accel off)
      # Emulator >= 36 refuses TCG unless this is set.
      export ANDROID_I_WANT_MY_TCG=yes
    fi
    log "starting emulator (gpu=$EMU_GPU ram=${EMU_RAM_MB}M cores=$EMU_CORES ${EMU_WIDTH}x${EMU_HEIGHT}@${EMU_DENSITY}dpi), log: $EMU_LOG"
    adb start-server >/dev/null 2>&1 || true
    # shellcheck disable=SC2086
    setsid nohup "$ANDROID_SDK_ROOT/emulator/emulator" -avd "$EMU_AVD_NAME" \
      -port "$EMU_PORT" \
      -no-window -no-audio -no-boot-anim -no-snapshot -no-metrics \
      -gpu "$EMU_GPU" "${accel[@]}" \
      -memory "$EMU_RAM_MB" -cores "$EMU_CORES" \
      -camera-back none -camera-front none \
      -netfast -skip-adb-auth \
      $EMU_EXTRA_ARGS \
      > "$EMU_LOG" 2>&1 < /dev/null &
    disown || true
    sleep 5
    emu_process_running || { tail -n 40 "$EMU_LOG" >&2; die "emulator process died right after start"; }
  else
    log "emulator process exists, waiting for boot"
  fi

  local start=$SECONDS last=-60
  while ! emu_booted; do
    emu_process_running || { tail -n 40 "$EMU_LOG" >&2; die "emulator process died during boot"; }
    if (( SECONDS - start > EMU_BOOT_TIMEOUT )); then
      tail -n 40 "$EMU_LOG" >&2
      die "boot not completed after ${EMU_BOOT_TIMEOUT}s"
    fi
    if (( SECONDS - last >= 60 )); then
      last=$SECONDS
      log "waiting for boot... $((SECONDS - start))s (adb state: $("${ADB[@]}" get-state 2>/dev/null || echo offline), bootanim: $("${ADB[@]}" shell getprop init.svc.bootanim 2>/dev/null | tr -d '\r\n' || true))"
    fi
    sleep 5
  done
  log "boot completed after $((SECONDS - start))s"
  post_boot_setup
}

require_booted() {
  need_sdk
  emu_booted || die "emulator $EMU_SERIAL is not booted - run: scripts/emulator-test.sh boot"
}

cmd_status() {
  need_sdk
  if emu_booted; then
    echo "booted  serial=$EMU_SERIAL  android=$("${ADB[@]}" shell getprop ro.build.version.release | tr -d '\r')  api=$("${ADB[@]}" shell getprop ro.build.version.sdk | tr -d '\r')"
  elif emu_process_running; then
    echo "starting (process is running, boot not completed)"
    return 2
  else
    echo "stopped"
    return 1
  fi
}

cmd_install() {
  require_booted
  local apk="${1:-$DEFAULT_APK}"
  [[ -f "$apk" ]] || die "APK not found: $apk (run scripts/build-apk.sh)"
  log "installing $apk"
  # --no-streaming is the most robust variant on the slow software emulator.
  if ! timeout 900 "${ADB[@]}" install -r --no-streaming "$apk"; then
    log "install -r failed, retrying after uninstall"
    "${ADB[@]}" uninstall "$APP_ID" >/dev/null 2>&1 || true
    timeout 900 "${ADB[@]}" install --no-streaming "$apk"
  fi
}

cmd_launch() {
  require_booted
  "${ADB[@]}" shell input keyevent KEYCODE_WAKEUP >/dev/null 2>&1 || true
  "${ADB[@]}" shell wm dismiss-keyguard >/dev/null 2>&1 || true
  "${ADB[@]}" shell am force-stop "$APP_ID" || true
  "${ADB[@]}" shell am start -W -n "$APP_ACTIVITY" | tr -d '\r'
}

cmd_resume() {
  require_booted
  "${ADB[@]}" shell am start -n "$APP_ACTIVITY" | tr -d '\r'
}

cmd_shot() {
  require_booted
  local out="${1:-$DEFAULT_SHOT}"
  mkdir -p "$(dirname "$out")"
  "${ADB[@]}" exec-out screencap -p > "$out.tmp"
  # sanity check: PNG magic
  if [[ "$(head -c 4 "$out.tmp" | od -An -tx1 | tr -d ' \n')" != "89504e47" ]]; then
    rm -f "$out.tmp"
    die "screencap did not return a PNG"
  fi
  mv "$out.tmp" "$out"
  log "screenshot -> $out"
}

LOG_FILTER='Tueftelwerkstatt|tueftelwerkstatt|chromium|cr_[A-Za-z]|AndroidRuntime|WebViewFactory|FATAL|ActivityManager: (Start proc|Displayed|Killing|Process).*tueftel'

cmd_logcat() {
  require_booted
  local out="${1:-}"
  if [[ -n "$out" ]]; then
    mkdir -p "$(dirname "$out")"
    "${ADB[@]}" logcat -d -v time 2>/dev/null | tr -d '\r' | grep -E "$LOG_FILTER" > "$out" || true
    log "logcat ($(wc -l < "$out") lines) -> $out"
  else
    "${ADB[@]}" logcat -d -v time 2>/dev/null | tr -d '\r' | grep -E "$LOG_FILTER" || true
  fi
}

cmd_devtools() {
  require_booted
  local port="${1:-9222}" pid
  pid="$("${ADB[@]}" shell pidof "$APP_ID" | tr -d '\r\n')"
  [[ -n "$pid" ]] || die "app is not running"
  "${ADB[@]}" forward "tcp:$port" "localabstract:webview_devtools_remote_$pid" >/dev/null
  log "DevTools (debug APK only): http://127.0.0.1:$port/json"
}

cmd_stop() {
  need_sdk
  if emu_online; then
    "${ADB[@]}" emu kill >/dev/null 2>&1 || true
  fi
  for _ in $(seq 1 30); do
    emu_process_running || break
    sleep 1
  done
  if emu_process_running; then
    pkill -f "qemu-system.*-avd $EMU_AVD_NAME" || true
  fi
  log "emulator stopped"
}

cmd_run() {
  local secs="${1:-25}" shot="${2:-$DEFAULT_SHOT}"
  cmd_boot
  cmd_install
  "${ADB[@]}" logcat -c >/dev/null 2>&1 || true
  cmd_launch
  log "waiting ${secs}s for the game to settle"
  sleep "$secs"
  cmd_shot "$shot"
  cmd_logcat "${shot%.*}.log"
}

cmd="${1:-run}"
case "$cmd" in
  ''|run)       shift || true; cmd_run "$@" ;;
  [0-9]*)       cmd_run "$@" ;;
  boot)         cmd_boot ;;
  status)       cmd_status ;;
  create-avd)   create_avd ;;
  install)      shift; cmd_install "$@" ;;
  launch)       cmd_launch ;;
  resume)       cmd_resume ;;
  shot|screenshot) shift; cmd_shot "$@" ;;
  tap)          require_booted; "${ADB[@]}" shell input tap "$2" "$3" ;;
  swipe)        require_booted; "${ADB[@]}" shell input swipe "$2" "$3" "$4" "$5" "${6:-300}" ;;
  longpress)    require_booted; "${ADB[@]}" shell input swipe "$2" "$3" "$2" "$3" "${4:-800}" ;;
  key)          require_booted; "${ADB[@]}" shell input keyevent "$2" ;;
  back)         require_booted; "${ADB[@]}" shell input keyevent KEYCODE_BACK ;;
  home)         require_booted; "${ADB[@]}" shell input keyevent KEYCODE_HOME ;;
  logcat)       shift; cmd_logcat "$@" ;;
  clearlog)     require_booted; "${ADB[@]}" logcat -c ;;
  cleardata)    require_booted; "${ADB[@]}" shell pm clear "$APP_ID" ;;
  devtools)     shift; cmd_devtools "$@" ;;
  shell)        shift; require_booted; "${ADB[@]}" shell "$@" ;;
  stop)         cmd_stop ;;
  -h|--help|help) sed -n '2,/^set -euo/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//' ;;
  *)            die "unknown command '$cmd' (try --help)" ;;
esac
