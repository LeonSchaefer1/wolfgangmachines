#!/usr/bin/env bash
# Builds the signed release APK.
#
#   scripts/build-apk.sh            release APK  -> release/WolfgangsTueftelwerkstatt.apk
#   scripts/build-apk.sh --debug    additionally a debug APK (WebView DevTools enabled)
#                                   -> release/WolfgangsTueftelwerkstatt-debug.apk
#   scripts/build-apk.sh --clean    run "gradlew clean" first
#   scripts/build-apk.sh --test-page   package the WebView diagnostic page
#                                   (android/webview-test/) instead of the game
#                                   -> release/webview-test.apk (same app id + key)
#
# android/app/src/main/assets/www/ is wiped and filled with game/dist/ if
# game/dist/index.html exists, otherwise (or with --test-page) with the WebGL2
# diagnostic page from android/webview-test/.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
# shellcheck source=android-env.sh
source "$HERE/android-env.sh"

WITH_DEBUG=0 CLEAN=0 TEST_PAGE=0
for a in "$@"; do
  case "$a" in
    --debug) WITH_DEBUG=1 ;;
    --clean) CLEAN=1 ;;
    --test-page) TEST_PAGE=1 ;;
    -h|--help) sed -n '2,/^set -euo/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option $a" >&2; exit 1 ;;
  esac
done

ANDROID_DIR="$ROOT/android"
WWW="$ANDROID_DIR/app/src/main/assets/www"
DIST="$ROOT/game/dist"
OUT_DIR="$ROOT/release"
OUT_APK="$OUT_DIR/WolfgangsTueftelwerkstatt.apk"

[[ -d "$ANDROID_SDK_ROOT/platforms/$ANDROID_PLATFORM" && -d "$ANDROID_SDK_ROOT/build-tools/$ANDROID_BUILD_TOOLS" ]] \
  || { echo "Android SDK incomplete in $ANDROID_SDK_ROOT - run scripts/setup-android-sdk.sh" >&2; exit 1; }

# --- 1. web assets -------------------------------------------------------------
if [[ $TEST_PAGE -eq 0 && -f "$DIST/index.html" ]]; then
  echo ">> copying game/dist -> android assets/www"
  SRC_WWW="$DIST"
else
  if [[ $TEST_PAGE -eq 1 ]]; then
    echo ">> --test-page: packaging the WebView diagnostic page (android/webview-test)"
  else
    echo ">> game/dist/index.html not found -> packaging the WebView diagnostic page (android/webview-test)"
  fi
  SRC_WWW="$ANDROID_DIR/webview-test"
  [[ -f "$SRC_WWW/index.html" ]] || { echo "no $SRC_WWW/index.html" >&2; exit 1; }
fi
rm -rf "$WWW"
mkdir -p "$WWW"
cp -a "$SRC_WWW"/. "$WWW"/
# never ship source maps
find "$WWW" -name '*.map' -delete
echo "   assets: $(find "$WWW" -type f | wc -l) files, $(du -sh "$WWW" | cut -f1)"

# --- 2. gradle -----------------------------------------------------------------
cd "$ANDROID_DIR"
tasks=()
[[ $CLEAN -eq 1 ]] && tasks+=(clean)
tasks+=(assembleRelease)
[[ $WITH_DEBUG -eq 1 ]] && tasks+=(assembleDebug)
echo ">> ./gradlew ${tasks[*]}"
./gradlew --console=plain -q "${tasks[@]}"

# --- 3. collect + verify -------------------------------------------------------
mkdir -p "$OUT_DIR"
if [[ $TEST_PAGE -eq 1 ]]; then
  # do not overwrite the real game APK with the diagnostic build
  OUT_APK="$OUT_DIR/webview-test.apk"
  WITH_DEBUG=0
fi
REL="$ANDROID_DIR/app/build/outputs/apk/release/app-release.apk"
[[ -f "$REL" ]] || { echo "release APK not found at $REL" >&2; exit 1; }
cp -f "$REL" "$OUT_APK"
if [[ $WITH_DEBUG -eq 1 ]]; then
  cp -f "$ANDROID_DIR/app/build/outputs/apk/debug/app-debug.apk" "$OUT_DIR/WolfgangsTueftelwerkstatt-debug.apk"
fi

APKSIGNER="$ANDROID_SDK_ROOT/build-tools/$ANDROID_BUILD_TOOLS/apksigner"
AAPT2="$ANDROID_SDK_ROOT/build-tools/$ANDROID_BUILD_TOOLS/aapt2"
echo
echo ">> APK: $OUT_APK"
echo "   size: $(du -h "$OUT_APK" | cut -f1) ($(stat -c %s "$OUT_APK") bytes)"
"$AAPT2" dump badging "$OUT_APK" 2>/dev/null \
  | grep -E "^(package:|sdkVersion|minSdkVersion|targetSdkVersion|application-label:|uses-permission)" | sed 's/^/   /' || true
echo ">> signature:"
env -u JAVA_TOOL_OPTIONS -u _JAVA_OPTIONS "$APKSIGNER" verify --verbose --print-certs --min-sdk-version 21 "$OUT_APK" 2>&1 \
  | grep -v -E '^WARNING: META-INF/.*not protected by signature' | sed 's/^/   /'
if [[ $WITH_DEBUG -eq 1 ]]; then
  echo ">> debug APK: $OUT_DIR/WolfgangsTueftelwerkstatt-debug.apk ($(du -h "$OUT_DIR/WolfgangsTueftelwerkstatt-debug.apk" | cut -f1))"
fi
